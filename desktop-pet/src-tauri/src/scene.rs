// 桌面场景感知（v0.5.0，方案 B）
// - 每 2 秒读一次前台窗口：进程名、标题、窗口是否正好铺满所在显示器
// - 只在变化时通过 pet://scene 广播给桌宠和面板；标题只在本机参与分类，不写盘
// - 默认关闭由网页控制（sceneOn），这里只负责采集
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static WATCH: AtomicBool = AtomicBool::new(false);
static GEN: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Serialize, Default)]
pub struct SceneInfo {
    pub title: String,
    pub proc: String,
    pub full: bool,
}

#[cfg(windows)]
fn read_foreground() -> SceneInfo {
    use windows_sys::Win32::Foundation::{CloseHandle, RECT};
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
    use windows_sys::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId};

    let mut out = SceneInfo::default();
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return out;
        }
        let len = GetWindowTextLengthW(hwnd);
        if len > 0 {
            let mut buf = vec![0u16; len as usize + 1];
            let n = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if n > 0 {
                out.title = String::from_utf16_lossy(&buf[..n as usize]).chars().take(200).collect();
            }
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != 0 {
            let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !h.is_null() {
                let mut pbuf = vec![0u16; 1024];
                let mut plen = pbuf.len() as u32;
                let ok = QueryFullProcessImageNameW(h, 0, pbuf.as_mut_ptr(), &mut plen);
                let _ = CloseHandle(h);
                if ok != 0 && plen > 0 {
                    let path = String::from_utf16_lossy(&pbuf[..plen as usize]);
                    out.proc = path.rsplit(['\\', '/']).next().unwrap_or("").to_string();
                }
            }
        }
        let mut wr = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        if GetWindowRect(hwnd, &mut wr) != 0 {
            let mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            if !mon.is_null() {
                let mut mi = MONITORINFO {
                    cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                    rcMonitor: RECT { left: 0, top: 0, right: 0, bottom: 0 },
                    rcWork: RECT { left: 0, top: 0, right: 0, bottom: 0 },
                    dwFlags: 0,
                };
                if GetMonitorInfoW(mon, &mut mi) != 0 {
                    let r = mi.rcMonitor;
                    let (w, h) = (wr.right - wr.left, wr.bottom - wr.top);
                    let (mw, mh) = (r.right - r.left, r.bottom - r.top);
                    out.full = (w - mw).abs() <= 2
                        && (h - mh).abs() <= 2
                        && (wr.left - r.left).abs() <= 2
                        && (wr.top - r.top).abs() <= 2;
                }
            }
        }
    }
    out
}

#[cfg(not(windows))]
fn read_foreground() -> SceneInfo {
    SceneInfo::default()
}

#[tauri::command]
pub fn scene_now() -> SceneInfo {
    read_foreground()
}

/// 开关采集；重复开启会先让旧线程退出（GEN 变化）
#[tauri::command]
pub fn scene_watch(app: AppHandle, on: bool) {
    WATCH.store(on, Ordering::SeqCst);
    let gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    if !on {
        return;
    }
    std::thread::spawn(move || {
        while WATCH.load(Ordering::SeqCst) && GEN.load(Ordering::SeqCst) == gen {
            let _ = app.emit("pet://scene", read_foreground());
            std::thread::sleep(Duration::from_millis(2000));
        }
    });
}
