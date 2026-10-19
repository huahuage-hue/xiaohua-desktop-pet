// 开机自启动（v0.2.1）
// 写入 HKCU\Software\Microsoft\Windows\CurrentVersion\Run 下的「小嬅桌宠」= "exe路径" --autostart
// - 只影响当前用户，不需要管理员权限；默认不开启
// - 状态每次都实时读注册表（任务管理器「启动」页里改了也能同步）
// - exe 挪了位置：启动时发现路径不一致，自动改成当前路径

pub const FLAG: &str = "--autostart";

/// 本次是否由开机自启拉起
pub fn launched_by_autostart() -> bool {
    std::env::args().any(|a| a == FLAG)
}

fn command_line() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(format!("\"{}\" {}", exe.display(), FLAG))
}

#[cfg(windows)]
mod reg {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY,
        HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE, REG_SZ,
    };

    const RUN: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const NAME: &str = "小嬅桌宠";

    fn w(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    struct Key(HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            unsafe { RegCloseKey(self.0) };
        }
    }

    fn open(write: bool) -> Result<Key, String> {
        let path = w(RUN);
        let mut h: HKEY = std::ptr::null_mut();
        let r = unsafe {
            if write {
                RegCreateKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, std::ptr::null(), REG_OPTION_NON_VOLATILE,
                    KEY_SET_VALUE | KEY_READ, std::ptr::null(), &mut h, std::ptr::null_mut())
            } else {
                RegOpenKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, KEY_READ, &mut h)
            }
        };
        if r != ERROR_SUCCESS {
            return Err(format!("打开注册表失败（{r}）"));
        }
        Ok(Key(h))
    }

    /// 读取当前值；没有这一项返回 None
    pub fn get() -> Option<String> {
        let k = open(false).ok()?;
        let name = w(NAME);
        let mut ty = 0u32;
        let mut len = 0u32;
        let r = unsafe { RegQueryValueExW(k.0, name.as_ptr(), std::ptr::null(), &mut ty, std::ptr::null_mut(), &mut len) };
        if r != ERROR_SUCCESS || len == 0 {
            return None;
        }
        let mut buf = vec![0u16; (len as usize + 1) / 2 + 1];
        let mut len2 = (buf.len() * 2) as u32;
        let r = unsafe { RegQueryValueExW(k.0, name.as_ptr(), std::ptr::null(), &mut ty, buf.as_mut_ptr() as *mut u8, &mut len2) };
        if r != ERROR_SUCCESS {
            return None;
        }
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        Some(String::from_utf16_lossy(&buf[..end]))
    }

    pub fn set(val: &str) -> Result<(), String> {
        let k = open(true)?;
        let name = w(NAME);
        let data = w(val);
        let r = unsafe { RegSetValueExW(k.0, name.as_ptr(), 0, REG_SZ, data.as_ptr() as *const u8, (data.len() * 2) as u32) };
        if r != ERROR_SUCCESS {
            return Err(format!("写入注册表失败（{r}）"));
        }
        Ok(())
    }

    pub fn del() -> Result<(), String> {
        let Ok(k) = open(true) else { return Ok(()) };
        let name = w(NAME);
        let r = unsafe { RegDeleteValueW(k.0, name.as_ptr()) };
        /* 2 = ERROR_FILE_NOT_FOUND：本来就没有，算成功 */
        if r != ERROR_SUCCESS && r != 2 {
            return Err(format!("删除注册表项失败（{r}）"));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod reg {
    pub fn get() -> Option<String> { None }
    pub fn set(_: &str) -> Result<(), String> { Err("仅支持 Windows".into()) }
    pub fn del() -> Result<(), String> { Ok(()) }
}

pub fn is_enabled() -> bool {
    reg::get().is_some()
}

pub fn set_enabled(on: bool) -> Result<bool, String> {
    if on { reg::set(&command_line()?)?; } else { reg::del()?; }
    Ok(is_enabled())
}

/// 已开启但路径和当前 exe 不一致（被挪动过）→ 改成当前路径
pub fn repair() {
    if let (Some(cur), Ok(want)) = (reg::get(), command_line()) {
        if !cur.eq_ignore_ascii_case(&want) {
            let _ = reg::set(&want);
        }
    }
}

#[tauri::command]
pub fn autostart_get() -> bool {
    is_enabled()
}

/// 返回切换后的实际状态
#[tauri::command]
pub fn autostart_set(app: tauri::AppHandle, on: bool) -> Result<bool, String> {
    let r = set_enabled(on)?;
    crate::sync_autostart_menu(&app, r);
    Ok(r)
}

/// 网页查询：本次是否开机自启拉起（用来跳过开场招呼）
#[tauri::command]
pub fn launched_autostart() -> bool {
    launched_by_autostart()
}
