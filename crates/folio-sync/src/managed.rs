//! 托管来源规范化与移动沙盒重定位。

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use folio_core::parse_font_file;
use folio_storage::{FolioDatabase, LibraryRootKind, RefreshMode};

use crate::SyncError;

/// 先验证并建立目录缓存，再移除已替代的来源与旧副本。
pub fn prepare_managed_sources(database: &Path, directory: &Path) -> Result<(), SyncError> {
    std::fs::create_dir_all(directory)?;
    let directory = directory.canonicalize()?;
    let mut db = FolioDatabase::open(database)?;
    let roots = db.list_roots()?;
    let previous_catalog = db.load_cached_catalog()?;
    let suffix = format!(
        "/{}/{}/",
        directory
            .parent()
            .and_then(Path::file_name)
            .and_then(|s| s.to_str())
            .ok_or(SyncError::InvalidFont)?,
        directory
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or(SyncError::InvalidFont)?
    );
    let mut replacements = BTreeMap::<PathBuf, PathBuf>::new();
    let mut pending = vec![directory.clone()];
    let mut files = Vec::new();
    while let Some(parent) = pending.pop() {
        for entry in std::fs::read_dir(parent)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() {
                files.push(entry.path());
            }
        }
    }
    for path in files {
        if path
            .extension()
            .is_some_and(|s| s.eq_ignore_ascii_case("font"))
            && path.is_file()
        {
            let parsed = parse_font_file(&path)?;
            if parsed.faces.is_empty() {
                return Err(SyncError::InvalidFont);
            }
            let mut header = [0; 4];
            std::fs::File::open(&path)?.read_exact(&mut header)?;
            let extension = match &header {
                b"OTTO" => "otf",
                b"ttcf" => "ttc",
                b"\0\x01\0\0" | b"true" => "ttf",
                _ => return Err(SyncError::InvalidFont),
            };
            let target = directory.join(format!("{}.{}", parsed.fingerprint.to_hex(), extension));
            if !target.exists() {
                std::fs::copy(&path, &target)?;
            }
            if parse_font_file(&target)?.fingerprint != parsed.fingerprint {
                return Err(SyncError::InvalidFont);
            }
            replacements.insert(path, target);
        }
    }
    let new_root = match db.add_root(&directory, true)? {
        folio_storage::AddRootOutcome::Created(root)
        | folio_storage::AddRootOutcome::Existing(root) => root,
    };
    db.set_root_recursive(new_root.id, true)?;
    let refreshed = db.refresh(RefreshMode::Incremental)?;
    let candidate_paths = refreshed
        .catalog
        .faces()
        .flat_map(|face| {
            face.sources
                .iter()
                .map(|source| source.path().to_path_buf())
        })
        .collect::<std::collections::BTreeSet<_>>();
    let mut cached_paths = std::collections::BTreeSet::new();
    for path in candidate_paths {
        if db.source_root_ids(&path)?.contains(&new_root.id) {
            cached_paths.insert(path);
        }
    }
    // 只有当前目录中可解析、已进入缓存的来源可以替代旧记录。
    let mut obsolete = Vec::new();
    for root in roots {
        if root.id == new_root.id {
            continue;
        }
        let relative = root.display_path.split_once(&suffix).map(|(_, rest)| rest);
        let candidate = if root.path.starts_with(&directory) {
            Some(root.path.clone())
        } else {
            relative
                .filter(|name| safe_relative(name))
                .map(|name| directory.join(name))
        };
        if root.kind == LibraryRootKind::File {
            if let Some(path) = candidate {
                let target = replacements.get(&path).unwrap_or(&path);
                if cached_paths.contains(target) {
                    let parsed = parse_font_file(target)?;
                    if parsed.faces.is_empty() {
                        return Err(SyncError::InvalidFont);
                    }
                    // 仍可读取的旧来源必须与新来源内容一致。
                    if root.path.is_file()
                        && parse_font_file(&root.path)?.fingerprint != parsed.fingerprint
                    {
                        return Err(SyncError::InvalidFont);
                    }
                    let expected = previous_catalog
                        .faces()
                        .filter(|face| face.sources.iter().any(|source| source.path() == root.path))
                        .map(|face| face.id)
                        .collect::<std::collections::BTreeSet<_>>();
                    let actual = parsed
                        .faces
                        .iter()
                        .map(|face| face.id)
                        .collect::<std::collections::BTreeSet<_>>();
                    if !expected.is_subset(&actual) {
                        return Err(SyncError::InvalidFont);
                    }
                    obsolete.push(root.id);
                }
            }
        } else if root
            .path
            .canonicalize()
            .is_ok_and(|path| path.starts_with(&directory))
            || (root.display_path.ends_with(suffix.trim_end_matches('/')) && !root.path.exists())
        {
            let mut complete = true;
            for face in previous_catalog.faces() {
                for source in face
                    .sources
                    .iter()
                    .filter(|source| source.path().starts_with(&root.path))
                {
                    let relative = source
                        .path()
                        .strip_prefix(&root.path)
                        .map_err(|_| SyncError::InvalidFont)?;
                    let path = if root
                        .path
                        .canonicalize()
                        .is_ok_and(|path| path.starts_with(&directory))
                    {
                        source
                            .path()
                            .canonicalize()
                            .unwrap_or_else(|_| source.path().to_path_buf())
                    } else {
                        directory.join(relative)
                    };
                    let target = replacements.get(&path).unwrap_or(&path);
                    if !cached_paths.contains(target)
                        || !parse_font_file(target)?
                            .faces
                            .iter()
                            .any(|parsed| parsed.id == face.id)
                    {
                        complete = false;
                    }
                }
            }
            if complete {
                obsolete.push(root.id);
            }
        }
    }

    for (old, target) in &replacements {
        if !cached_paths.contains(target) {
            return Err(SyncError::InvalidFont);
        }
        let old_suffix = format!(
            "{}{}",
            suffix,
            old.strip_prefix(&directory)
                .map_err(|_| SyncError::InvalidFont)?
                .to_string_lossy()
        );
        for mut asset in db.list_sync_assets()? {
            let matches = asset
                .local_path
                .as_ref()
                .is_some_and(|path| path == &old.to_string_lossy() || path.ends_with(&old_suffix));
            if matches {
                if parse_font_file(target)?.fingerprint.to_hex() != asset.fingerprint {
                    return Err(SyncError::InvalidFont);
                }
                asset.local_path = Some(target.to_string_lossy().into_owned());
                db.upsert_sync_asset(&asset)?;
            }
        }
        std::fs::remove_file(old)?;
    }
    // 正常扩展名的同步资产也随沙盒移动恢复本地路径。
    for mut asset in db.list_sync_assets()? {
        if let Some(previous) = &asset.local_path {
            if let Some((_, name)) = previous.split_once(&suffix) {
                if safe_relative(name) {
                    let target = directory.join(name);
                    if cached_paths.contains(&target)
                        && parse_font_file(&target)?.fingerprint.to_hex() == asset.fingerprint
                    {
                        asset.local_path = Some(target.to_string_lossy().into_owned());
                        db.upsert_sync_asset(&asset)?;
                    }
                }
            }
        }
    }
    for id in obsolete {
        db.remove_root(id)?;
    }
    db.refresh(RefreshMode::Incremental)?;
    Ok(())
}

fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && Path::new(path)
            .components()
            .all(|part| matches!(part, std::path::Component::Normal(_)))
}
