//! Windows 当前会话注册及当前用户安装；只撤销 Folio 自有记录。

use super::{copy_verified, err, Result};
use folio_storage::{FolioDatabase, PlatformFontOperation};
use std::{
    path::{Path, PathBuf},
    ptr,
};
use windows_sys::Win32::{
    Foundation::ERROR_SUCCESS,
    Graphics::Gdi::{AddFontResourceExW, RemoveFontResourceExW},
    System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW,
        RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_SZ,
    },
    UI::WindowsAndMessaging::{
        SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_FONTCHANGE,
    },
};
fn wide(value: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.as_ref().encode_wide().chain(Some(0)).collect()
}
const KEY: &str = "Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts";
struct Registry(HKEY);
impl Drop for Registry {
    fn drop(&mut self) {
        unsafe {
            RegCloseKey(self.0);
        }
    }
}
fn registry(create: bool) -> Result<Registry> {
    let mut key = ptr::null_mut();
    let status = unsafe {
        if create {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                wide(KEY).as_ptr(),
                0,
                ptr::null(),
                0,
                KEY_READ | KEY_SET_VALUE,
                ptr::null(),
                &mut key,
                ptr::null_mut(),
            )
        } else {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                wide(KEY).as_ptr(),
                0,
                KEY_READ | KEY_SET_VALUE,
                &mut key,
            )
        }
    };
    if status != ERROR_SUCCESS {
        return Err("workflow.error.permission".into());
    }
    Ok(Registry(key))
}
fn registered_path(name: &str) -> Result<Option<PathBuf>> {
    let key = registry(true)?;
    let mut size = 0;
    let mut kind = 0;
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            wide(name).as_ptr(),
            ptr::null(),
            &mut kind,
            ptr::null_mut(),
            &mut size,
        )
    };
    if status == 2 {
        return Ok(None);
    }
    if status != ERROR_SUCCESS || kind != REG_SZ || size > 64 * 1024 {
        return Err("workflow.error.operationFailed".into());
    }
    let mut bytes = vec![0u16; (size as usize).div_ceil(2)];
    let status = unsafe {
        RegQueryValueExW(
            key.0,
            wide(name).as_ptr(),
            ptr::null(),
            &mut kind,
            bytes.as_mut_ptr().cast(),
            &mut size,
        )
    };
    if status != ERROR_SUCCESS {
        return Err("workflow.error.operationFailed".into());
    }
    use std::os::windows::ffi::OsStringExt;
    while bytes.last() == Some(&0) {
        bytes.pop();
    }
    Ok(Some(std::ffi::OsString::from_wide(&bytes).into()))
}
fn notify() {
    unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_FONTCHANGE,
            0,
            0,
            SMTO_ABORTIFHUNG,
            1000,
            ptr::null_mut(),
        );
    }
}
pub fn perform(database: &Path, source: &Path, persistent: bool, remove: bool) -> Result<()> {
    let db = FolioDatabase::open(database).map_err(err)?;
    let records = db.platform_font_operations().map_err(err)?;
    if remove {
        let record = records
            .into_iter()
            .find(|item| {
                item.persistent == persistent
                    && (Path::new(&item.source_path) == source
                        || Path::new(&item.installed_path) == source)
            })
            .ok_or("workflow.error.notOwned")?;
        remove_owned(&db, &record)?;
        return Ok(());
    }
    let parsed = folio_core::parse_font_file(source).map_err(|_| "workflow.error.invalidFont")?;
    let fingerprint = parsed.fingerprint.to_hex();
    let id = format!(
        "{}:{fingerprint}",
        if persistent { "install" } else { "activate" }
    );
    for record in records
        .iter()
        .filter(|item| item.id == id && item.registered)
    {
        let valid = folio_core::parse_font_file(&record.installed_path)
            .is_ok_and(|value| value.fingerprint.to_hex() == fingerprint);
        let registered = if let Some(name) = &record.registry_name {
            registered_path(name)?.as_deref() == Some(Path::new(&record.installed_path))
        } else {
            true
        };
        if valid && registered {
            return Ok(());
        }
    }
    let directory = if persistent {
        PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("workflow.error.permission")?)
            .join("Microsoft/Windows/Fonts")
    } else {
        database
            .parent()
            .ok_or("workflow.error.invalidRequest")?
            .join("ActiveFonts")
    };
    let extension = match parsed.format {
        folio_core::FontFormat::TrueType => "ttf",
        folio_core::FontFormat::OpenType => "otf",
        _ => "ttc",
    };
    let destination = directory.join(format!("Folio-{fingerprint}.{extension}"));
    copy_verified(source, &destination, &fingerprint, true)?;
    let registry_name = persistent.then(|| format!("Folio {fingerprint}"));
    let mut record = PlatformFontOperation {
        id,
        source_path: source.to_string_lossy().into_owned(),
        installed_path: destination.to_string_lossy().into_owned(),
        fingerprint,
        registry_name,
        persistent,
        registered: false,
    };
    if let Some(name) = &record.registry_name {
        if registered_path(name)?.is_some_and(|path| path != destination) {
            return Err("workflow.error.nameConflict".into());
        }
    }
    db.save_platform_font_operation(&record).map_err(err)?;
    if let Some(name) = &record.registry_name {
        let key = registry(true)?;
        let value = wide(&destination);
        let status = unsafe {
            RegSetValueExW(
                key.0,
                wide(name).as_ptr(),
                0,
                REG_SZ,
                value.as_ptr().cast(),
                (value.len() * 2) as u32,
            )
        };
        if status != ERROR_SUCCESS {
            return Err("workflow.error.permission".into());
        }
    }
    if unsafe { AddFontResourceExW(wide(&destination).as_ptr(), 0, ptr::null()) } == 0 {
        return Err("workflow.error.operationFailed".into());
    }
    record.registered = true;
    db.save_platform_font_operation(&record).map_err(err)?;
    notify();
    Ok(())
}
fn remove_owned(db: &FolioDatabase, record: &PlatformFontOperation) -> Result<()> {
    let path = Path::new(&record.installed_path);
    let expected = if record.persistent {
        PathBuf::from(std::env::var_os("LOCALAPPDATA").ok_or("workflow.error.permission")?)
            .join("Microsoft/Windows/Fonts")
    } else {
        db.path()
            .parent()
            .ok_or("workflow.error.invalidRequest")?
            .join("ActiveFonts")
    };
    if path.parent() != Some(expected.as_path())
        || !path.file_name().is_some_and(|name| {
            name.to_string_lossy()
                .starts_with(&format!("Folio-{}.", record.fingerprint))
        })
    {
        return Err("workflow.error.notOwned".into());
    }
    if path.exists()
        && !folio_core::parse_font_file(path)
            .is_ok_and(|value| value.fingerprint.to_hex() == record.fingerprint)
    {
        return Err("workflow.error.sourceChanged".into());
    }
    if let Some(name) = &record.registry_name {
        if let Some(registered) = registered_path(name)? {
            if registered != path {
                return Err("workflow.error.notOwned".into());
            }
            let key = registry(false)?;
            if unsafe { RegDeleteValueW(key.0, wide(name).as_ptr()) } != ERROR_SUCCESS {
                return Err("workflow.error.permission".into());
            }
        }
    }
    unsafe {
        RemoveFontResourceExW(wide(path).as_ptr(), 0, ptr::null());
    }
    notify();
    if path.exists() {
        std::fs::remove_file(path).map_err(|_| "workflow.error.fileInUse")?;
    }
    db.remove_platform_font_operation(&record.id).map_err(err)
}
pub fn cleanup(database: &Path) -> Result<()> {
    let db = FolioDatabase::open(database).map_err(err)?;
    for record in db
        .platform_font_operations()
        .map_err(err)?
        .into_iter()
        .filter(|item| !item.persistent)
    {
        remove_owned(&db, &record)?;
    }
    Ok(())
}

pub fn reconcile(database: &Path) -> Result<()> {
    let db = FolioDatabase::open(database).map_err(err)?;
    for mut record in db.platform_font_operations().map_err(err)? {
        let valid = folio_core::parse_font_file(&record.installed_path)
            .is_ok_and(|font| font.fingerprint.to_hex() == record.fingerprint);
        let registered = if let Some(name) = &record.registry_name {
            registered_path(name).ok().flatten().as_deref()
                == Some(Path::new(&record.installed_path))
        } else {
            false
        };
        if !record.persistent || !valid || !registered {
            record.registered = false;
            db.save_platform_font_operation(&record).map_err(err)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn windows_registration_install_and_owned_removal_preserve_originals() {
        let temp = tempfile::tempdir().unwrap();
        let database = temp.path().join("folio.sqlite");
        let original = temp.path().join("字体 有空格.ttf");
        let sample =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/fonts/Lato-Regular.ttf");
        let mut bytes = std::fs::read(sample).unwrap();
        bytes.extend_from_slice(folio_storage::new_operation_id().unwrap().as_bytes());
        std::fs::write(&original, &bytes).unwrap();
        for persistent in [false, true] {
            perform(&database, &original, persistent, false).unwrap();
            let db = FolioDatabase::open(&database).unwrap();
            let records = db.platform_font_operations().unwrap();
            let record = records
                .iter()
                .find(|item| item.persistent == persistent)
                .unwrap();
            assert!(record.registered);
            assert_ne!(Path::new(&record.installed_path), original);
            assert_eq!(std::fs::read(&record.installed_path).unwrap(), bytes);
            perform(&database, &original, persistent, false).unwrap();
            assert_eq!(db.platform_font_operations().unwrap().len(), 1);
            perform(&database, &original, persistent, true).unwrap();
            assert!(db.platform_font_operations().unwrap().is_empty());
            assert_eq!(std::fs::read(&original).unwrap(), bytes);
        }
        assert!(perform(&database, &original, true, true).is_err());
    }
}
