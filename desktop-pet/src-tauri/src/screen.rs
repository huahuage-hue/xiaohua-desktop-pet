// 看屏幕（v0.6.0）：截你正在用的那个程序所在的显示器 → 缩到最长边 1280 → JPEG → base64
// - 只在内存里，不写盘；不碰任何窗口（小嬅自己的窗口可能在画面里，提示词里让视觉模型忽略）
// - 前台是小嬅自己的窗口时（你在聊天窗里打字），往下找你真正在用的那个窗口
// - 隐私硬闸：密码管理器 / 微信 / QQ / Telegram / 标题像网银支付无痕的窗口 / 面板黑名单，一律不截（网页端也会先判断一次）
use serde::Serialize;
use tauri::AppHandle;

const PRIVATE_PROC: &[&str] = &[
    "1password", "keepass", "bitwarden", "lastpass", "dashlane", "enpass", "authenticator", "wechat", "weixin", "qq.exe", "telegram",
];
const PRIVATE_TITLE: &[&str] = &["银行", "网银", "密码", "支付", "账单", "无痕", "隐私", "incognito", "private browsing"];

#[derive(Serialize)]
pub struct Shot {
    /// data:image/jpeg;base64,…
    image: String,
    w: u32,
    h: u32,
    /// 被截的那个程序（如 Code.exe），给提示词用；标题不返回
    proc: String,
}

#[tauri::command]
pub async fn screen_capture(app: AppHandle, block: Vec<String>) -> Result<Shot, String> {
    tauri::async_runtime::spawn_blocking(move || capture(&app, &block)).await.map_err(|e| e.to_string())?
}

#[cfg(not(windows))]
fn capture(_: &AppHandle, _: &[String]) -> Result<Shot, String> {
    Err("只支持 Windows".into())
}

#[cfg(windows)]
fn capture(_app: &AppHandle, block: &[String]) -> Result<Shot, String> {
    let (target, proc, title) = find_target();
    let p = proc.to_lowercase();
    let t = title.to_lowercase();
    let blocked = block.iter().map(|b| b.trim().to_lowercase()).any(|b| !b.is_empty() && p.contains(&b));
    if PRIVATE_PROC.iter().any(|x| p.contains(x)) || PRIVATE_TITLE.iter().any(|x| t.contains(x)) || blocked {
        return Err("__PRIVATE__".into());
    }
    /* 不再动小嬅自己窗口的显示属性（v0.6 测试版用 WDA_EXCLUDEFROMCAPTURE 时，用户那边会冒出空白面板）：
       她的窗口可能出现在截图里，由视觉提示词让模型忽略 */
    let (w, h, rgb) = grab(target)?;
    encode(w, h, rgb, proc)
}

/// 你正在用的窗口：前台窗口；前台是小嬅自己的就沿 Z 序往下找第一个看得见的普通窗口
#[cfg(windows)]
fn find_target() -> (windows_sys::Win32::Foundation::HWND, String, String) {
    use windows_sys::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, GWL_EXSTYLE, GW_HWNDNEXT, WS_EX_TOOLWINDOW,
    };
    let me = std::process::id();
    /* 小嬅的窗口（含同时开着的另一份便携版 / 安装版）都不算“你正在用的程序” */
    let self_exe = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase())).unwrap_or_default();
    let is_self = |pid: u32| {
        if pid == me {
            return true;
        }
        let n = crate::scene::proc_name(pid).to_lowercase();
        n == self_exe || n == "xiaohua-pet.exe" || n == "小嬅桌宠.exe"
    };
    unsafe {
        let mut h = GetForegroundWindow();
        for _ in 0..400 {
            if h.is_null() {
                break;
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, &mut pid);
            let mut cloaked = 0u32;
            let _ = DwmGetWindowAttribute(h, DWMWA_CLOAKED as _, &mut cloaked as *mut u32 as _, 4);
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
            let title = crate::scene::window_title(h);
            if IsWindowVisible(h) != 0 && IsIconic(h) == 0 && cloaked == 0 && ex & WS_EX_TOOLWINDOW == 0 && !title.is_empty() && !is_self(pid) {
                return (h, crate::scene::proc_name(pid), title);
            }
            h = GetWindow(h, GW_HWNDNEXT);
        }
    }
    (std::ptr::null_mut(), String::new(), String::new()) // 没找到：截主显示器
}

/// 截 target 所在显示器（target 为空 → 主显示器），返回 RGB
#[cfg(windows)]
fn grab(target: windows_sys::Win32::Foundation::HWND) -> Result<(u32, u32, Vec<u8>), String> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::*;
    unsafe {
        let mon = MonitorFromWindow(target, if target.is_null() { MONITOR_DEFAULTTOPRIMARY } else { MONITOR_DEFAULTTONEAREST });
        let mut mi = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, rcMonitor: RECT { left: 0, top: 0, right: 0, bottom: 0 }, rcWork: RECT { left: 0, top: 0, right: 0, bottom: 0 }, dwFlags: 0 };
        if GetMonitorInfoW(mon, &mut mi) == 0 {
            return Err("读不到显示器信息".into());
        }
        let r = mi.rcMonitor;
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        if w <= 0 || h <= 0 {
            return Err("显示器大小不对".into());
        }
        let screen = GetDC(std::ptr::null_mut());
        let mem = CreateCompatibleDC(screen);
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, bmp);
        let ok = BitBlt(mem, 0, 0, w, h, screen, r.left, r.top, SRCCOPY);
        let mut bi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // 负数 = 从上往下
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB as _,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [RGBQUAD { rgbBlue: 0, rgbGreen: 0, rgbRed: 0, rgbReserved: 0 }],
        };
        let mut bgra = vec![0u8; (w * h * 4) as usize];
        let lines = if ok != 0 { GetDIBits(mem, bmp, 0, h as u32, bgra.as_mut_ptr() as _, &mut bi, DIB_RGB_COLORS) } else { 0 };
        SelectObject(mem, old);
        DeleteObject(bmp);
        DeleteDC(mem);
        ReleaseDC(std::ptr::null_mut(), screen);
        if lines == 0 {
            return Err("截图失败".into());
        }
        let mut rgb = Vec::with_capacity((w * h * 3) as usize);
        for px in bgra.chunks_exact(4) {
            rgb.extend_from_slice(&[px[2], px[1], px[0]]);
        }
        Ok((w as u32, h as u32, rgb))
    }
}

fn encode(w: u32, h: u32, rgb: Vec<u8>, proc: String) -> Result<Shot, String> {
    use base64::Engine;
    let img = image::RgbImage::from_raw(w, h, rgb).ok_or("截图数据不对")?;
    let k = 1280.0 / w.max(h) as f64;
    let img = if k < 1.0 {
        let (nw, nh) = (((w as f64) * k).round().max(1.0) as u32, ((h as f64) * k).round().max(1.0) as u32);
        image::imageops::resize(&img, nw, nh, image::imageops::FilterType::Triangle)
    } else {
        img
    };
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, 70).encode_image(&img).map_err(|e| e.to_string())?;
    Ok(Shot { image: format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&out)), w: img.width(), h: img.height(), proc })
}
