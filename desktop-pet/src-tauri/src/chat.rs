// AI 对话（v0.2.0）：兼容 OpenAI 的 /chat/completions 流式接口（DeepSeek / 通义千问 / Kimi / 智谱 / Ollama / 自定义）
// - 密钥只存在本机应用数据目录的 chat.json 里，由 Rust 读写；网页（含面板）只能拿到“是否已设置 + 末 4 位”
// - 请求在后台线程里发，SSE 每段文字通过 pet://chat 事件推给桌宠窗口：{id, kind: delta|think|tool|done|error, text}
//   think = 深度思考过程；tool = 流结束时拼好的工具调用 JSON 数组 [{id, name, arguments}]（v0.6.0）
// - 不受浏览器跨域限制；总开关关掉时网页不会调用这里
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

/// 当前请求序号：新请求 / 取消会让旧请求的线程自己停下来
static CUR: AtomicU64 = AtomicU64::new(0);

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct Secret {
    #[serde(default)]
    pub keys: std::collections::HashMap<String, String>, // provider → key
}

fn secret_path(app: &AppHandle) -> Option<PathBuf> {
    let d = app.path().app_data_dir().ok()?;
    let _ = std::fs::create_dir_all(&d);
    Some(d.join("chat.json"))
}
fn load(app: &AppHandle) -> Secret {
    secret_path(app).and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
fn save(app: &AppHandle, s: &Secret) -> Result<(), String> {
    let p = secret_path(app).ok_or("no data dir")?;
    std::fs::write(p, serde_json::to_string(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct KeyInfo {
    set: bool,
    tail: String,
}

#[tauri::command]
pub fn chat_key_set(app: AppHandle, provider: String, key: String) -> Result<KeyInfo, String> {
    let mut s = load(&app);
    let k = key.trim().to_string();
    if k.is_empty() {
        s.keys.remove(&provider);
    } else {
        s.keys.insert(provider.clone(), k);
    }
    save(&app, &s)?;
    Ok(info(&s, &provider))
}
#[tauri::command]
pub fn chat_key_info(app: AppHandle, provider: String) -> KeyInfo {
    info(&load(&app), &provider)
}
fn info(s: &Secret, provider: &str) -> KeyInfo {
    match s.keys.get(provider) {
        Some(k) if !k.is_empty() => KeyInfo { set: true, tail: k.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect() },
        _ => KeyInfo { set: false, tail: String::new() },
    }
}

#[derive(Deserialize)]
pub struct ChatReq {
    id: u64,
    provider: String,
    base: String,  // 如 https://api.deepseek.com/v1
    model: String, // 如 deepseek-chat
    /// v0.6.0 起原样转发（工具调用要带 tool_calls / tool_call_id，之后还有图片）
    messages: Vec<serde_json::Value>,
    #[serde(default = "def_tokens")]
    max_tokens: u32,
    /// 测试连接：不流式，只要拿到一句就算通
    #[serde(default)]
    test: bool,
    /// 工具定义（OpenAI 格式）；为空就是纯聊天
    #[serde(default)]
    tools: Option<serde_json::Value>,
    /// 额外请求参数（深度思考开关等），逐个键合并进请求体
    #[serde(default)]
    extra: Option<serde_json::Map<String, serde_json::Value>>,
}
fn def_tokens() -> u32 {
    300
}

#[derive(Serialize, Clone)]
struct Ev {
    id: u64,
    kind: &'static str,
    text: String,
}

fn emit(app: &AppHandle, id: u64, kind: &'static str, text: String) {
    let _ = app.emit("pet://chat", Ev { id, kind, text });
}

/// 把 HTTP 错误翻成她能说的话
fn explain(code: u16, body: &str) -> String {
    let b = body.to_lowercase();
    match code {
        401 | 403 => "密钥好像不对哦，去控制面板检查一下吧".into(),
        402 => "账户余额不够了…".into(),
        404 => "找不到这个模型，检查一下模型名吧".into(),
        429 => "等一下下，我有点回不过来了…".into(),
        500..=599 => "对面的服务器好像累了，过会儿再试试".into(),
        /* 模型不认工具 / 思考参数：网页端看到这两个记号会去掉对应参数自动重试 */
        400 | 422 if b.contains("tool") || b.contains("function") => "__NO_TOOLS__".into(),
        400 | 422 if b.contains("thinking") || b.contains("reasoning") => "__NO_THINK__".into(),
        _ if b.contains("model") => "模型名好像不对…".into(),
        _ => format!("出错了（{code}）"),
    }
}

#[tauri::command]
pub fn chat_send(app: AppHandle, req: ChatReq) -> Result<(), String> {
    let key = load(&app).keys.get(&req.provider).cloned().unwrap_or_default();
    let local = req.base.contains("127.0.0.1") || req.base.contains("localhost");
    if key.is_empty() && !local {
        return Err("还没有填密钥哦，去控制面板「对话」里填一下吧".into());
    }
    CUR.store(req.id, Ordering::SeqCst);
    std::thread::spawn(move || {
        let id = req.id;
        let url = format!("{}/chat/completions", req.base.trim_end_matches('/'));
        let agent = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(10)).timeout_read(Duration::from_secs(30)).build();
        let mut body = serde_json::json!({
            "model": req.model,
            "messages": req.messages,
            "stream": !req.test,
            "max_tokens": if req.test { 16 } else { req.max_tokens },
            "temperature": 0.8,
        });
        if !req.test {
            if let Some(t) = &req.tools {
                body["tools"] = t.clone();
            }
            if let Some(x) = &req.extra {
                for (k, v) in x {
                    body[k.as_str()] = v.clone();
                }
            }
        }
        let mut r = agent.post(&url).set("Content-Type", "application/json");
        if !key.is_empty() {
            r = r.set("Authorization", &format!("Bearer {key}"));
        }
        let resp = match r.send_json(body) {
            Ok(x) => x,
            Err(ureq::Error::Status(code, resp)) => {
                let b = resp.into_string().unwrap_or_default();
                emit(&app, id, "error", explain(code, &b));
                return;
            }
            Err(e) => {
                let s = e.to_string();
                let t = if s.contains("timed out") || s.contains("timeout") { "等了好久都没有回音…" } else { "网络好像断了…连不上对面" };
                emit(&app, id, "error", t.into());
                return;
            }
        };
        if req.test {
            let v: serde_json::Value = resp.into_json().unwrap_or_default();
            let t = v["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();
            emit(&app, id, "done", if t.is_empty() { "（连上了）".into() } else { t });
            return;
        }
        let rd = BufReader::new(resp.into_reader());
        let mut got = false;
        /* 工具调用是分片流过来的：按 index 拼好 (id, 名字, 参数 JSON)，流结束时一次发出 */
        let mut calls: Vec<(String, String, String)> = Vec::new();
        for line in rd.lines() {
            if CUR.load(Ordering::SeqCst) != id {
                return; // 被新请求 / 取消顶掉了
            }
            let Ok(line) = line else {
                if !got {
                    emit(&app, id, "error", "等了好久都没有回音…".into());
                    return;
                }
                break;
            };
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data == "[DONE]" {
                break;
            }
            let Ok(v) = serde_json::from_str::<serde_json::Value>(data) else { continue };
            let d = &v["choices"][0]["delta"];
            if let Some(t) = d["content"].as_str() {
                if !t.is_empty() {
                    got = true;
                    emit(&app, id, "delta", t.to_string());
                }
            }
            /* 深度思考的过程：DeepSeek / 通义 / 智谱用 reasoning_content，部分兼容服务用 reasoning */
            if let Some(t) = d["reasoning_content"].as_str().or_else(|| d["reasoning"].as_str()) {
                if !t.is_empty() {
                    got = true;
                    emit(&app, id, "think", t.to_string());
                }
            }
            if let Some(arr) = d["tool_calls"].as_array() {
                got = true;
                for tc in arr {
                    let has_id = tc["id"].as_str().is_some_and(|s| !s.is_empty());
                    let i = match tc["index"].as_u64() {
                        Some(i) => i as usize,
                        None if has_id => calls.len(),
                        None => calls.len().saturating_sub(1),
                    };
                    while calls.len() <= i {
                        calls.push(Default::default());
                    }
                    let c = &mut calls[i];
                    if has_id {
                        c.0 = tc["id"].as_str().unwrap_or_default().to_string();
                    }
                    if let Some(s) = tc["function"]["name"].as_str() {
                        c.1.push_str(s);
                    }
                    if let Some(s) = tc["function"]["arguments"].as_str() {
                        c.2.push_str(s);
                    }
                }
            }
        }
        if !calls.is_empty() {
            let list: Vec<_> = calls
                .into_iter()
                .filter(|c| !c.1.is_empty())
                .map(|(i, n, a)| serde_json::json!({ "id": i, "name": n, "arguments": a }))
                .collect();
            emit(&app, id, "tool", serde_json::Value::Array(list).to_string());
        }
        emit(&app, id, "done", String::new());
    });
    Ok(())
}

#[tauri::command]
pub fn chat_cancel() {
    CUR.fetch_add(1 << 40, Ordering::SeqCst);
}
