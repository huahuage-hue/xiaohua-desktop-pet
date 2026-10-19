// 小嬅桌宠 · Tauri 2 宿主（一期）
// - 透明 / 无边框 / 置顶 / 不进任务栏的窗口，加载 web/pet.html
// - 点击穿透：网页按光标处像素透明度调用 set_passthrough；本进程每 30ms 推送全局光标位置（穿透时网页收不到鼠标事件）
// - 拖动：网页调用 start_drag → 系统拖窗口；轮询检测左键松开 → 贴边 → 通知网页播放落地
// - 贴边：离工作区左右边缘 < 40px 时吸附并藏起 40%；光标进入窗口时滑出，离开 1.5s 后缩回
// - 托盘：显示/隐藏、置顶、大小 75/100/125%、退出；位置和大小由 window-state 插件记住
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod agent;
mod autostart;
mod chat;
mod scene;

/// 托盘「开机自启」勾选项（面板切换时同步勾选状态）
struct AutoItem(Mutex<Option<CheckMenuItem<tauri::Wry>>>);

pub fn sync_autostart_menu(app: &AppHandle, on: bool) {
    if let Some(s) = app.try_state::<AutoItem>() {
        if let Ok(g) = s.0.lock() {
            if let Some(i) = g.as_ref() {
                let _ = i.set_checked(on);
            }
        }
    }
}

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// 基准窗口尺寸（逻辑像素）；角色图 1200×2133，留一点边。
/// v0.2.0 起顶部多留 BUBBLE_H 给对话气泡（网页里角色画布下移同样高度，角色本身大小不变）
const BASE_W: f64 = 300.0;
const BASE_H: f64 = 610.0;
/// 贴边吸附距离（逻辑像素）
const SNAP: f64 = 40.0;
/// 所有 WebView 窗口必须用完全相同的参数（共用同一个 WebView2 环境），也要和 tauri.conf.json 主窗口一致
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";
/// 侧边聊天窗（v0.6.0）默认大小（逻辑像素）
const CHAT_W: f64 = 340.0;
const CHAT_H: f64 = 520.0;
/// 聊天窗压进桌宠窗口的宽度（逻辑像素）：桌宠窗口两边是透明留白，贴紧一点更像在她身边
const CHAT_OVERLAP: f64 = 28.0;
/// 聊天窗在她哪一侧：0 未定 / 1 左 / 2 右（带回差，拖过屏幕中线一点才换边）
static CHAT_SIDE: AtomicU8 = AtomicU8::new(0);
/// 藏起时露在屏幕内的比例
const SHOW_RATIO: f64 = 0.6;
/// 自己走动：速度（逻辑像素/秒）与节奏（秒）
#[derive(Clone, Copy, PartialEq, Default)]
enum Side {
    #[default]
    None,
    Left,
    Right,
}

#[derive(Default)]
struct Tuck {
    side: Side,
    out: bool,
    last_inside: Option<Instant>,
}

struct Pet {
    dragging: AtomicBool,
    tuck: Mutex<Tuck>,
}

impl Default for Pet {
    fn default() -> Self {
        Self {
            dragging: AtomicBool::new(false),
            tuck: Mutex::new(Tuck::default()),
        }
    }
}

#[derive(Clone, Serialize)]
struct Cursor {
    x: f64,
    y: f64,
    inside: bool,
}

#[tauri::command]
fn set_passthrough(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}

#[tauri::command]
fn start_drag(window: WebviewWindow, pet: tauri::State<'_, Arc<Pet>>) -> Result<(), String> {
    /* 系统拖动循环结束后，WebView 会补发积压的指针事件，看起来像“又开始拖”——此时左键早已松开，忽略 */
    if !left_button_down() {
        return Err("not-pressed".into());
    }
    if pet.dragging.load(Ordering::SeqCst) {
        return Ok(());
    }
    pet.dragging.store(true, Ordering::SeqCst);
    if let Ok(mut t) = pet.tuck.lock() {
        t.side = Side::None;
        t.out = false;
    }
    window.start_dragging().map_err(|e| e.to_string())
}

#[cfg(windows)]
fn left_button_down() -> bool {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
    unsafe { (GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000) != 0 }
}
#[cfg(not(windows))]
fn left_button_down() -> bool {
    false // 一期只做 Windows；其它平台松手判定待二期
}

/// 当前显示器工作区（物理像素）：x, y, w, h
fn work_area(win: &WebviewWindow) -> Option<(i32, i32, i32, i32)> {
    let m = win.current_monitor().ok()??;
    let wa = m.work_area();
    Some((wa.position.x, wa.position.y, wa.size.width as i32, wa.size.height as i32))
}

/// 平滑移动窗口（约 120ms）
fn slide(win: &WebviewWindow, from: i32, to: i32, y: i32) {
    const STEPS: i32 = 8;
    for i in 1..=STEPS {
        let k = i as f64 / STEPS as f64;
        let e = 1.0 - (1.0 - k) * (1.0 - k);
        let x = from + ((to - from) as f64 * e).round() as i32;
        let _ = win.set_position(PhysicalPosition::new(x, y));
        std::thread::sleep(Duration::from_millis(15));
    }
}

/// 拖动结束：上下限制在工作区内；靠近左右边缘则吸附并藏起一部分
fn snap(win: &WebviewWindow, pet: &Pet) {
    let (Ok(pos), Ok(size), Some((ax, ay, aw, ah))) = (win.outer_position(), win.outer_size(), work_area(win)) else {
        return;
    };
    let sf = win.scale_factor().unwrap_or(1.0);
    let (w, h) = (size.width as i32, size.height as i32);
    let edge = (SNAP * sf) as i32;
    let y = pos.y.max(ay - h / 5).min(ay + ah - h * 4 / 5);
    let mut x = pos.x.max(ax - w * 3 / 5).min(ax + aw - w * 2 / 5);
    let mut side = Side::None;
    if x - ax < edge {
        side = Side::Left;
        x = ax - (w as f64 * (1.0 - SHOW_RATIO)) as i32;
    } else if ax + aw - (x + w) < edge {
        side = Side::Right;
        x = ax + aw - (w as f64 * SHOW_RATIO) as i32;
    }
    if x != pos.x || y != pos.y {
        slide(win, pos.x, x, y);
    }
    if let Ok(mut t) = pet.tuck.lock() {
        t.side = side;
        t.out = false;
        t.last_inside = None;
    }
}

/// 贴边时：光标进入窗口 → 滑出来；离开 1.5s → 缩回去
fn peek(win: &WebviewWindow, pet: &Pet, inside: bool, pos: PhysicalPosition<i32>, size: PhysicalSize<u32>) {
    let Ok(mut t) = pet.tuck.lock() else { return };
    if t.side == Side::None {
        return;
    }
    let Some((ax, _, aw, _)) = work_area(win) else { return };
    let w = size.width as i32;
    let (shown, hidden) = match t.side {
        Side::Left => (ax, ax - (w as f64 * (1.0 - SHOW_RATIO)) as i32),
        _ => (ax + aw - w, ax + aw - (w as f64 * SHOW_RATIO) as i32),
    };
    if inside {
        t.last_inside = Some(Instant::now());
        if !t.out {
            t.out = true;
            drop(t);
            slide(win, pos.x, shown, pos.y);
        }
    } else if t.out && t.last_inside.map_or(true, |i| i.elapsed() > Duration::from_millis(1500)) {
        t.out = false;
        drop(t);
        slide(win, pos.x, hidden, pos.y);
    }
}

fn cursor_inside(win: &WebviewWindow) -> bool {
    let (Ok(cur), Ok(pos), Ok(size)) = (win.cursor_position(), win.outer_position(), win.outer_size()) else {
        return false;
    };
    let (rx, ry) = (cur.x - pos.x as f64, cur.y - pos.y as f64);
    rx >= 0.0 && ry >= 0.0 && rx < size.width as f64 && ry < size.height as f64
}

/// 后台轮询：全局光标 → 网页；拖动中检测松手
fn spawn_poll(app: AppHandle, pet: Arc<Pet>) {
    std::thread::spawn(move || {
        let mut last_pos: Option<PhysicalPosition<i32>> = None;
        let mut last_sent = (i32::MIN, i32::MIN, false);
        let mut up_count = 0u32;
        loop {
            std::thread::sleep(Duration::from_millis(30));
            let Some(win) = app.get_webview_window("main") else { continue };
            if !win.is_visible().unwrap_or(false) {
                /* 她被藏起来了（托盘隐藏 / 全屏躲起来）：聊天窗也一起收起 */
                if app.get_webview_window("chat").is_some_and(|c| c.is_visible().unwrap_or(false)) {
                    hide_chat(&app);
                }
                continue;
            }
            let (Ok(cur), Ok(pos), Ok(size)) = (win.cursor_position(), win.outer_position(), win.outer_size()) else {
                continue;
            };
            dock_chat(&app, &win);
            let (rx, ry) = (cur.x - pos.x as f64, cur.y - pos.y as f64);
            let inside = rx >= 0.0 && ry >= 0.0 && rx < size.width as f64 && ry < size.height as f64;
            let key = (rx.round() as i32, ry.round() as i32, inside);
            if key != last_sent {
                last_sent = key;
                let _ = win.emit("pet://cursor", Cursor { x: rx, y: ry, inside });
            }
            if pet.dragging.load(Ordering::SeqCst) {
                if let Some(lp) = last_pos {
                    /* 每次轮询都发（含 0）：网页靠连续的位移算速度 / 加速度，急停时 0 也是信号 */
                    let _ = win.emit("pet://drag-move", [pos.x - lp.x, pos.y - lp.y]);
                }
                last_pos = Some(pos);
                /* 系统拖窗口的模态循环里偶尔会读到一次“没按下”：连续 3 次（≈90ms）才算松手，
                   否则一次拖动会被切成好几段，每段都播落地、摇摆被打断 */
                up_count = if left_button_down() { 0 } else { up_count + 1 };
                if up_count >= 3 {
                    up_count = 0;
                    pet.dragging.store(false, Ordering::SeqCst);
                    last_pos = None;
                    snap(&win, &pet);
                    let _ = win.emit("pet://drag-end", ());
                }
                continue;
            }
            peek(&win, &pet, inside, pos, size);
        }
    });
}

/// 窗口不在任何显示器上（显示器被拔掉 / 首次启动）→ 放到主屏工作区右下角
fn ensure_on_screen(win: &WebviewWindow) {
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else { return };
    let cx = pos.x + size.width as i32 / 2;
    let cy = pos.y + size.height as i32 / 2;
    let visible = win.available_monitors().unwrap_or_default().iter().any(|m| {
        let (p, s) = (m.position(), m.size());
        cx >= p.x && cy >= p.y && cx < p.x + s.width as i32 && cy < p.y + s.height as i32
    });
    if visible {
        return;
    }
    if let Ok(Some(m)) = win.primary_monitor() {
        let wa = m.work_area();
        let x = wa.position.x + wa.size.width as i32 - size.width as i32 - 24;
        let y = wa.position.y + wa.size.height as i32 - size.height as i32;
        let _ = win.set_position(PhysicalPosition::new(x, y));
    }
}

/// 打开（或聚焦）控制面板窗口：有标题栏、可拖动；关闭只是隐藏
fn show_panel(app: &AppHandle) -> tauri::Result<()> {
    if let Some(p) = app.get_webview_window("panel") {
        p.show()?;
        p.unminimize()?;
        p.set_focus()?;
        return Ok(());
    }
    let mut b = tauri::WebviewWindowBuilder::new(app, "panel", tauri::WebviewUrl::App("panel.html".into()))
        .title("小嬅 · 控制面板")
        .inner_size(380.0, 640.0)
        .min_inner_size(340.0, 480.0)
        .resizable(true)
        .maximizable(false)
        .always_on_top(true)
        .focused(true)
        /* 必须和 tauri.conf.json 里主窗口的 additionalBrowserArgs 完全一致（共用同一个 WebView2 环境） */
        .additional_browser_args(BROWSER_ARGS);
    /* 放在桌宠旁边：桌宠在屏幕右半边就放左侧，否则放右侧 */
    if let Some(pet) = app.get_webview_window("main") {
        if let (Ok(pos), Ok(size), Some((ax, ay, aw, ah))) = (pet.outer_position(), pet.outer_size(), work_area(&pet)) {
            let sf = pet.scale_factor().unwrap_or(1.0);
            let (pw, ph) = ((380.0 * sf) as i32, (640.0 * sf) as i32);
            let x = if pos.x + size.width as i32 / 2 > ax + aw / 2 { pos.x - pw - 8 } else { pos.x + size.width as i32 + 8 };
            let x = x.max(ax).min(ax + aw - pw);
            let y = pos.y.max(ay).min(ay + ah - ph);
            b = b.position(x as f64 / sf, y as f64 / sf);
        }
    }
    let w = b.build()?;
    let w2 = w.clone();
    w.on_window_event(move |e| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            let _ = w2.hide();
        }
    });
    Ok(())
}

/// 侧边聊天窗该放的位置（物理像素）：她在屏幕右半边就放左侧，否则放右侧；那一侧放不下就换边；底边对齐她脚边
fn chat_target(pet: &WebviewWindow, chat: &WebviewWindow) -> Option<PhysicalPosition<i32>> {
    let (pos, size, csize) = (pet.outer_position().ok()?, pet.outer_size().ok()?, chat.outer_size().ok()?);
    let (ax, ay, aw, ah) = work_area(pet)?;
    let sf = pet.scale_factor().unwrap_or(1.0);
    let (w, h, cw, ch) = (size.width as i32, size.height as i32, csize.width as i32, csize.height as i32);
    let ov = (CHAT_OVERLAP * sf) as i32;
    let (cx, mid, hyst) = (pos.x + w / 2, ax + aw / 2, (60.0 * sf) as i32);
    let mut side = CHAT_SIDE.load(Ordering::Relaxed);
    if side == 0 {
        side = if cx > mid { 1 } else { 2 };
    } else if side == 1 && cx < mid - hyst {
        side = 2;
    } else if side == 2 && cx > mid + hyst {
        side = 1;
    }
    let (left_x, right_x) = (pos.x - cw + ov, pos.x + w - ov);
    if side == 1 && left_x < ax && right_x + cw <= ax + aw {
        side = 2;
    } else if side == 2 && right_x + cw > ax + aw && left_x >= ax {
        side = 1;
    }
    CHAT_SIDE.store(side, Ordering::Relaxed);
    let x = if side == 1 { left_x } else { right_x }.max(ax).min(ax + aw - cw);
    let y = (pos.y + h - ch - (12.0 * sf) as i32).max(ay).min(ay + ah - ch);
    Some(PhysicalPosition::new(x, y))
}

/// 轮询里调用：聊天窗开着就跟着她（拖动、贴边、缩放后都会对齐）
fn dock_chat(app: &AppHandle, pet: &WebviewWindow) {
    let Some(c) = app.get_webview_window("chat") else { return };
    if !c.is_visible().unwrap_or(false) {
        return;
    }
    if let (Some(t), Ok(p)) = (chat_target(pet, &c), c.outer_position()) {
        if t != p {
            let _ = c.set_position(t);
        }
    }
}

/// 收起聊天窗（只隐藏不销毁），并告诉桌宠窗口
fn hide_chat(app: &AppHandle) {
    if let Some(c) = app.get_webview_window("chat") {
        let _ = c.hide();
    }
    let _ = app.emit_to("main", "pet://cmd", serde_json::json!({ "type": "chatwin", "open": false }));
}

fn show_chat(app: &AppHandle) -> tauri::Result<()> {
    let c = match app.get_webview_window("chat") {
        Some(c) => c,
        None => {
            let c = tauri::WebviewWindowBuilder::new(app, "chat", tauri::WebviewUrl::App("chatwin.html".into()))
                .title("和小嬅聊天")
                .inner_size(CHAT_W, CHAT_H)
                .min_inner_size(280.0, 360.0)
                .decorations(false)
                .resizable(true)
                .maximizable(false)
                .minimizable(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .shadow(true)
                .visible(false)
                .focused(true)
                .additional_browser_args(BROWSER_ARGS)
                .build()?;
            let h = app.clone();
            c.on_window_event(move |e| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                    api.prevent_close();
                    hide_chat(&h);
                }
            });
            c
        }
    };
    CHAT_SIDE.store(0, Ordering::Relaxed);
    if let Some(p) = app.get_webview_window("main") {
        if let Some(t) = chat_target(&p, &c) {
            c.set_position(t)?;
        }
    }
    c.show()?;
    c.unminimize()?;
    c.set_focus()?;
    Ok(())
}

/// 和面板一样必须是 async（同步命令里建 WebView 会死锁）
#[tauri::command]
async fn chatwin_open(app: AppHandle) -> Result<(), String> {
    show_chat(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn chatwin_hide(app: AppHandle) {
    hide_chat(&app);
}

/// 注意：Windows 上在同步命令 / 事件回调里创建 WebView 窗口会死锁（WebView2 限制），
/// 所以命令写成 async，托盘菜单里则放到新线程中创建
#[tauri::command]
async fn open_panel(app: AppHandle) -> Result<(), String> {
    show_panel(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_scale(app: AppHandle, pct: f64) -> Result<(), String> {
    let k = (pct / 100.0).clamp(0.5, 1.5);
    let w = app.get_webview_window("main").ok_or("no main")?;
    w.set_size(LogicalSize::new(BASE_W * k, BASE_H * k)).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_top(app: AppHandle, on: bool) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("no main")?;
    w.set_always_on_top(on).map_err(|e| e.to_string())
}

#[tauri::command]
fn move_home(app: AppHandle, pet: tauri::State<'_, Arc<Pet>>) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("no main")?;
    if let Ok(mut t) = pet.tuck.lock() {
        t.side = Side::None;
        t.out = false;
    }
    let _ = w.show();
    let m = w.primary_monitor().map_err(|e| e.to_string())?.ok_or("no monitor")?;
    let size = w.outer_size().map_err(|e| e.to_string())?;
    let wa = m.work_area();
    let x = wa.position.x + wa.size.width as i32 - size.width as i32 - 24;
    let y = wa.position.y + wa.size.height as i32 - size.height as i32;
    w.set_position(PhysicalPosition::new(x, y)).map_err(|e| e.to_string())
}

/// 聊天输入框：需要键盘焦点（窗口创建时 focus=false）。on=false 时不主动还焦点，由用户点别处自然切走
#[tauri::command]
fn pet_focus(window: WebviewWindow, on: bool) -> Result<(), String> {
    if on {
        let _ = window.set_ignore_cursor_events(false);
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn toggle_pet(app: AppHandle) {
    toggle_visible(&app);
}

/// 全屏自动隐藏用：明确显示 / 隐藏，不会把用户手动隐藏的状态弄反
#[tauri::command]
fn pet_show(app: AppHandle, on: bool) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or("no main")?;
    if on { w.show() } else { w.hide() }.map_err(|e| e.to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    let _ = app.save_window_state(StateFlags::POSITION | StateFlags::SIZE);
    app.exit(0);
}

fn toggle_visible(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
        }
    }
}

fn main() {
    let pet = Arc::new(Pet::default());
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
                .build(),
        )
        .manage(pet.clone())
        .manage(AutoItem(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            set_passthrough, start_drag, open_panel, set_scale, set_top, move_home, toggle_pet, pet_show, quit_app, pet_focus,
            chatwin_open, chatwin_hide,
            autostart::autostart_get, autostart::autostart_set, autostart::launched_autostart,
            chat::chat_send, chat::chat_cancel, chat::chat_key_set, chat::chat_key_info,
            scene::scene_now, scene::scene_watch,
            agent::agent_find_app, agent::agent_launch, agent::agent_open_url, agent::agent_clip_get, agent::agent_clip_set
        ])
        .setup(move |app| {
            let win = app.get_webview_window("main").expect("main window");
            /* 升级迁移：旧版窗口是 300×540 比例（window-state 记住的），补上顶部气泡区，并上移同样高度，角色位置不变 */
            if let (Ok(sz), Ok(pos), Ok(sf)) = (win.outer_size(), win.outer_position(), win.scale_factor()) {
                let (w, h) = (sz.width as f64 / sf, sz.height as f64 / sf);
                if (h / w - BASE_H / BASE_W).abs() > 0.02 {
                    let nh = w * BASE_H / BASE_W;
                    let _ = win.set_size(LogicalSize::new(w, nh));
                    let _ = win.set_position(PhysicalPosition::new(pos.x, pos.y - ((nh - h) * sf) as i32));
                }
            }
            ensure_on_screen(&win);
            autostart::repair();

            /* 托盘菜单 */
            let toggle = MenuItem::with_id(app, "toggle", "显示 / 隐藏", true, None::<&str>)?;
            let panel = MenuItem::with_id(app, "panel", "控制面板…", true, None::<&str>)?;
            let chat_item = MenuItem::with_id(app, "chat", "和她聊天", true, None::<&str>)?;
            let top = CheckMenuItem::with_id(app, "top", "置顶", true, true, None::<&str>)?;
            let cur_w = win.outer_size().map(|s| s.width as f64 / win.scale_factor().unwrap_or(1.0)).unwrap_or(BASE_W);
            let sizes: Vec<(f64, CheckMenuItem<tauri::Wry>)> = [0.75, 1.0, 1.25]
                .iter()
                .map(|&k| {
                    let on = (cur_w / BASE_W - k).abs() < 0.05;
                    let item = CheckMenuItem::with_id(app, format!("size{}", (k * 100.0) as i32), format!("{}%", (k * 100.0) as i32), true, on, None::<&str>);
                    item.map(|i| (k, i))
                })
                .collect::<Result<_, _>>()?;
            let size_refs: Vec<&dyn tauri::menu::IsMenuItem<tauri::Wry>> = sizes.iter().map(|(_, i)| i as &dyn tauri::menu::IsMenuItem<tauri::Wry>).collect();
            let size_menu = Submenu::with_items(app, "大小", true, &size_refs)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let auto = CheckMenuItem::with_id(app, "autostart", "开机自启", true, autostart::is_enabled(), None::<&str>)?;
            if let Ok(mut g) = app.state::<AutoItem>().0.lock() {
                *g = Some(auto.clone());
            }
            let menu = Menu::with_items(app, &[&chat_item, &panel, &toggle, &top, &auto, &size_menu, &sep, &quit])?;

            let top_c = top.clone();
            let auto_c = auto.clone();
            let sizes_c: Vec<(f64, CheckMenuItem<tauri::Wry>)> = sizes.iter().map(|(k, i)| (*k, i.clone())).collect();
            TrayIconBuilder::with_id("main")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("小嬅")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, ev| {
                    let id = ev.id().as_ref();
                    let win = app.get_webview_window("main");
                    match id {
                        "toggle" => toggle_visible(app),
                        "chat" => {
                            if let Some(w) = &win {
                                let _ = w.show();
                                let _ = w.emit("pet://cmd", serde_json::json!({ "type": "chat" }));
                            }
                        }
                        "panel" => {
                            let h = app.clone();
                            std::thread::spawn(move || {
                                let _ = show_panel(&h);
                            });
                        }
                        "top" => {
                            if let Some(w) = win {
                                let on = top_c.is_checked().unwrap_or(true);
                                let _ = w.set_always_on_top(on);
                            }
                        }
                        "autostart" => {
                            /* CheckMenuItem 点击后已自动翻转勾选；按翻转后的值写注册表，再用实际结果校正 */
                            let want = auto_c.is_checked().unwrap_or(false);
                            let real = autostart::set_enabled(want).unwrap_or_else(|_| autostart::is_enabled());
                            let _ = auto_c.set_checked(real);
                            let _ = app.emit("pet://autostart", real);
                        }
                        "quit" => {
                            let _ = app.save_window_state(StateFlags::POSITION | StateFlags::SIZE);
                            app.exit(0);
                        }
                        _ if id.starts_with("size") => {
                            for (k, item) in &sizes_c {
                                let hit = item.id().as_ref() == id;
                                let _ = item.set_checked(hit);
                                if hit {
                                    if let Some(w) = &win {
                                        let _ = w.set_size(LogicalSize::new(BASE_W * k, BASE_H * k));
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, ev| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                        toggle_visible(tray.app_handle());
                    }
                })
                .build(app)?;

            spawn_poll(app.handle().clone(), pet.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动小嬅桌宠失败");
}
