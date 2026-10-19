// 帮你做事（v0.6.0）：只做安全动作——打开网页、打开开始菜单里的程序、读写剪贴板
// - 网页端（tools.js）执行前已经在聊天里问过用户；这里再做一遍白名单校验，模型给的参数不能直接变成任意路径
// - 不删文件、不跑命令
use serde::Serialize;
use std::path::{Path, PathBuf};

/// 系统自带、开始菜单里没有快捷方式的常用程序：(关键词, 显示名, 打开目标)
const ALIAS: &[(&str, &str, &str)] = &[
    ("记事本", "记事本", "notepad.exe"),
    ("notepad", "记事本", "notepad.exe"),
    ("计算器", "计算器", "calc.exe"),
    ("calculator", "计算器", "calc.exe"),
    ("calc", "计算器", "calc.exe"),
    ("画图", "画图", "mspaint.exe"),
    ("paint", "画图", "mspaint.exe"),
    ("资源管理器", "文件资源管理器", "explorer.exe"),
    ("文件管理", "文件资源管理器", "explorer.exe"),
    ("此电脑", "文件资源管理器", "explorer.exe"),
    ("explorer", "文件资源管理器", "explorer.exe"),
    ("设置", "Windows 设置", "ms-settings:"),
    ("settings", "Windows 设置", "ms-settings:"),
    ("任务管理器", "任务管理器", "taskmgr.exe"),
    ("截图", "截图工具", "ms-screenclip:"),
];
/// 名字里带这些的快捷方式不参与匹配（免得“打开 xx”打开了卸载程序）
const SKIP: &[&str] = &["卸载", "uninstall", "删除", "remove", "readme", "帮助", "help", "说明"];

#[derive(Serialize)]
pub struct AppHit {
    name: String,
    target: String,
}

fn start_dirs() -> Vec<PathBuf> {
    ["APPDATA", "PROGRAMDATA"]
        .iter()
        .filter_map(|k| std::env::var_os(k))
        .map(|b| PathBuf::from(b).join("Microsoft\\Windows\\Start Menu\\Programs"))
        .filter(|p| p.is_dir())
        .collect()
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<PathBuf>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth < 4 {
                walk(&p, depth + 1, out);
            }
        } else if matches!(p.extension().and_then(|x| x.to_str()).map(|x| x.to_ascii_lowercase()).as_deref(), Some("lnk" | "url")) {
            out.push(p);
        }
    }
}

fn score(q: &str, name: &str) -> i32 {
    let n = name.to_lowercase();
    if SKIP.iter().any(|s| n.contains(s)) {
        return 0;
    }
    if n == q {
        100
    } else if n.starts_with(q) {
        80
    } else if n.contains(q) {
        60
    } else if n.chars().count() >= 2 && q.contains(&n) {
        40
    } else {
        0
    }
}

/// 按名字找程序：先查系统自带别名，再模糊匹配开始菜单快捷方式
#[tauri::command]
pub fn agent_find_app(name: String) -> Result<AppHit, String> {
    let q = name.trim().to_lowercase();
    if q.is_empty() {
        return Err("没说要打开什么".into());
    }
    if let Some((_, n, t)) = ALIAS.iter().find(|(k, _, _)| q == *k || q.contains(k)) {
        return Ok(AppHit { name: n.to_string(), target: t.to_string() });
    }
    let mut all = Vec::new();
    for d in start_dirs() {
        walk(&d, 0, &mut all);
    }
    let best = all
        .iter()
        .filter_map(|p| {
            let stem = p.file_stem()?.to_string_lossy().to_string();
            let s = score(&q, &stem);
            (s > 0).then_some((s, stem, p))
        })
        .max_by(|a, b| a.0.cmp(&b.0).then(b.1.chars().count().cmp(&a.1.chars().count())));
    match best {
        Some((_, stem, p)) => Ok(AppHit { name: stem, target: p.to_string_lossy().to_string() }),
        None => Err(format!("开始菜单里没找到「{}」", name.trim())),
    }
}

/// 打开 agent_find_app 找到的目标：只认别名表里的目标，或开始菜单目录里的 .lnk / .url
#[tauri::command]
pub fn agent_launch(target: String) -> Result<(), String> {
    let ok = ALIAS.iter().any(|(_, _, t)| *t == target) || {
        let p = PathBuf::from(&target);
        let ext_ok = matches!(p.extension().and_then(|x| x.to_str()).map(|x| x.to_ascii_lowercase()).as_deref(), Some("lnk" | "url"));
        let real = std::fs::canonicalize(&p).ok();
        ext_ok
            && real.is_some_and(|r| start_dirs().iter().filter_map(|d| std::fs::canonicalize(d).ok()).any(|d| r.starts_with(d)))
    };
    if !ok {
        return Err("这个程序不在可以打开的范围里".into());
    }
    shell_open(&target)
}

/// 打开网页：只允许 http / https
#[tauri::command]
pub fn agent_open_url(url: String) -> Result<(), String> {
    let u = url.trim();
    let lower = u.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) || u.len() > 2048 || u.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"') {
        return Err("只能打开 http / https 网址".into());
    }
    shell_open(u)
}

#[cfg(windows)]
fn shell_open(target: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let w = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (op, t) = (w("open"), w(target));
    let r = unsafe { ShellExecuteW(std::ptr::null_mut(), op.as_ptr(), t.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
    if r as isize > 32 {
        Ok(())
    } else {
        Err("没打开…".into())
    }
}
#[cfg(not(windows))]
fn shell_open(_: &str) -> Result<(), String> {
    Err("只支持 Windows".into())
}

/* ---------- 剪贴板（纯文本） ---------- */
#[cfg(windows)]
fn open_clipboard() -> bool {
    use windows_sys::Win32::System::DataExchange::OpenClipboard;
    for _ in 0..10 {
        if unsafe { OpenClipboard(std::ptr::null_mut()) } != 0 {
            return true;
        }
        std::thread::sleep(std::time::Duration::from_millis(20)); // 别的程序正占着
    }
    false
}

const CF_UNICODETEXT: u32 = 13;

#[cfg(windows)]
#[tauri::command]
pub fn agent_clip_get() -> Result<String, String> {
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, GetClipboardData};
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    if !open_clipboard() {
        return Err("剪贴板被别的程序占着".into());
    }
    let mut out = String::new();
    unsafe {
        let h = GetClipboardData(CF_UNICODETEXT);
        if !h.is_null() {
            let p = GlobalLock(h) as *const u16;
            if !p.is_null() {
                let mut n = 0usize;
                while n < 20000 && *p.add(n) != 0 {
                    n += 1;
                }
                out = String::from_utf16_lossy(std::slice::from_raw_parts(p, n));
                GlobalUnlock(h);
            }
        }
        CloseClipboard();
    }
    Ok(out)
}

#[cfg(windows)]
#[tauri::command]
pub fn agent_clip_set(text: String) -> Result<(), String> {
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, SetClipboardData};
    use windows_sys::Win32::Foundation::GlobalFree;
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    let w: Vec<u16> = text.chars().take(5000).collect::<String>().encode_utf16().chain(std::iter::once(0)).collect();
    if !open_clipboard() {
        return Err("剪贴板被别的程序占着".into());
    }
    let ok = unsafe {
        EmptyClipboard();
        let h = GlobalAlloc(GMEM_MOVEABLE, w.len() * 2);
        let mut ok = false;
        if !h.is_null() {
            let p = GlobalLock(h) as *mut u16;
            if !p.is_null() {
                std::ptr::copy_nonoverlapping(w.as_ptr(), p, w.len());
                GlobalUnlock(h);
                ok = !SetClipboardData(CF_UNICODETEXT, h).is_null();
            }
            if !ok {
                GlobalFree(h);
            }
        }
        CloseClipboard();
        ok
    };
    if ok {
        Ok(())
    } else {
        Err("写剪贴板失败".into())
    }
}

#[cfg(not(windows))]
#[tauri::command]
pub fn agent_clip_get() -> Result<String, String> {
    Err("只支持 Windows".into())
}
#[cfg(not(windows))]
#[tauri::command]
pub fn agent_clip_set(_text: String) -> Result<(), String> {
    Err("只支持 Windows".into())
}
