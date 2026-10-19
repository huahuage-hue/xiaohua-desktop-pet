// 自动更新（v0.6.0）：从 Gitee 读 latest.json，下载签名过的安装包，校验后安装
// - 版本清单地址写在 UPDATE_URLS；环境变量 XH_UPDATE_URL 可临时换成别的地址（本机测试用，允许 http）
// - 安装包用 cargo tauri signer 生成的私钥签名，公钥在 tauri.conf.json → plugins.updater.pubkey；签名对不上就不装
// - Windows 上安装时会退出桌宠、跑安装程序（passive 模式只显示进度条），装完自动重新打开
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// 版本清单地址：建好 Gitee 仓库后把 your-name / xiaohua-pet-release 换成真实的用户名 / 仓库名
/// （可以放多个，前一个连不上就试下一个）
pub const UPDATE_URLS: &[&str] = &["https://gitee.com/your-name/xiaohua-pet-release/raw/master/latest.json"];
const PLACEHOLDER: &str = "your-name";

/// 最近一次检查到的新版本（安装时用）
#[derive(Default)]
pub struct Pending(pub Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct UpdInfo {
    available: bool,
    current: String,
    version: String,
    notes: String,
    date: String,
}

/// 用哪些地址：XH_UPDATE_URL（本机测试）优先，否则 UPDATE_URLS
/// tauri.conf.json 里打开了 dangerousInsecureTransportProtocol（插件只能在配置里开），http 的把关放在这里：
/// 正式地址只认 https；http 只允许指向本机的测试地址。安装包本身无论如何都要过签名校验
fn urls() -> Result<Vec<tauri::Url>, String> {
    let list: Vec<String> = match std::env::var("XH_UPDATE_URL") {
        Ok(u) if !u.trim().is_empty() => vec![u.trim().to_string()],
        _ => UPDATE_URLS.iter().map(|s| s.to_string()).collect(),
    };
    if list.iter().all(|u| u.contains(PLACEHOLDER)) {
        return Err("还没配置更新地址（Gitee 仓库建好后再开）".into());
    }
    list.iter()
        .map(|u| {
            let url = u.parse::<tauri::Url>().map_err(|e| e.to_string())?;
            let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost"));
            match url.scheme() {
                "https" => Ok(url),
                "http" if local => Ok(url),
                _ => Err(format!("更新地址必须是 https：{u}")),
            }
        })
        .collect()
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let eps = urls()?;
    app.updater_builder()
        .endpoints(eps)
        .map_err(|e| e.to_string())?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

/// 把更新器的报错翻成人话
fn explain(e: tauri_plugin_updater::Error) -> String {
    let s = e.to_string();
    let l = s.to_lowercase();
    if l.contains("signature") || l.contains("minisign") {
        "安装包的签名对不上，可能被改过，已经放弃安装".into()
    } else if l.contains("dns") || l.contains("connect") || l.contains("timed out") || l.contains("timeout") || l.contains("network") {
        "连不上更新服务器…稍后再试".into()
    } else if l.contains("404") || l.contains("status") {
        format!("更新服务器返回出错：{s}")
    } else {
        format!("更新出错：{s}")
    }
}

#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, Pending>) -> Result<UpdInfo, String> {
    let current = app.package_info().version.to_string();
    let found = updater(&app)?.check().await.map_err(explain)?;
    let info = match &found {
        Some(u) => UpdInfo {
            available: true,
            current,
            version: u.version.clone(),
            notes: u.body.clone().unwrap_or_default(),
            date: u.date.map(|d| d.to_string()).unwrap_or_default(),
        },
        None => UpdInfo { available: false, version: current.clone(), current, notes: String::new(), date: String::new() },
    };
    if let Ok(mut g) = pending.0.lock() {
        *g = found;
    }
    Ok(info)
}

/// 下载并安装上次检查到的版本；dry = true 只下载并校验签名、不安装（测试用）
/// 进度通过 pet://update 推给面板：{kind: progress, got, total} / {kind: verified, size} / {kind: installing}
#[tauri::command]
pub async fn update_install(app: AppHandle, pending: State<'_, Pending>, dry: Option<bool>) -> Result<(), String> {
    let up = pending.0.lock().ok().and_then(|g| g.clone()).ok_or("先检查一下有没有新版本")?;
    let a = app.clone();
    let (mut got, mut last_pct) = (0u64, -1i64);
    let on_chunk = move |n: usize, total: Option<u64>| {
        got += n as u64;
        let pct = total.map(|t| (got * 100 / t.max(1)) as i64).unwrap_or(-1);
        if pct != last_pct {
            last_pct = pct;
            let _ = a.emit("pet://update", serde_json::json!({ "kind": "progress", "got": got, "total": total }));
        }
    };
    if dry == Some(true) {
        let bytes = up.download(on_chunk, || {}).await.map_err(explain)?; // download 内部已校验签名
        let _ = app.emit("pet://update", serde_json::json!({ "kind": "verified", "size": bytes.len() }));
        return Ok(());
    }
    let _ = app.save_window_state(StateFlags::POSITION | StateFlags::SIZE);
    let _ = app.emit("pet://update", serde_json::json!({ "kind": "installing" }));
    up.download_and_install(on_chunk, || {}).await.map_err(explain)?;
    app.restart(); // Windows 上安装程序会先把我们关掉，一般走不到这里
}
