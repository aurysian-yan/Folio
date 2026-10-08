//! 本机来源与云目录按二进制修订合并，不依据显示名称关联文件。

use super::*;
use folio_core::{
    Catalog, FaceMetadata, FontFace, FontFaceId, FontFamily, FontFamilyId, FontFormat,
    FontRevisionId,
};
use folio_query::{FontFileLocation, FontLocation, FontQueryIndex, LocalFontLocation};

pub struct UnifiedLibrary {
    pub catalog: Catalog,
    pub locations: BTreeMap<FontFaceId, FontLocation>,
    pub unidentified_families: BTreeSet<FontFamilyId>,
}

pub fn managed_directory(db: &FolioDatabase) -> PathBuf {
    db.sync_metadata("managed_directory")
        .ok()
        .flatten()
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            db.path()
                .parent()
                .unwrap_or(Path::new("."))
                .join("ManagedFonts")
        })
}

pub fn unified_library(db: &FolioDatabase, local: &Catalog) -> Result<UnifiedLibrary, SyncError> {
    let readable = db.readable_font_files()?;
    let excluded_sources = db.excluded_file_sources()?;
    let root = managed_directory(db);
    let root = root.canonicalize().unwrap_or(root);
    let remote = cloud_fonts(db)?;
    let cloud: BTreeSet<_> = remote
        .iter()
        .filter(|file| !file.deleted)
        .map(|file| file.fingerprint.clone())
        .collect();
    let assets = db.list_sync_assets()?;
    let policies = db
        .file_policies()?
        .into_iter()
        .map(|policy| (policy.fingerprint.clone(), policy))
        .collect::<BTreeMap<_, _>>();
    let remote_assets = assets
        .iter()
        .filter(|asset| !asset.deleted && cloud.contains(&asset.fingerprint))
        .map(|asset| {
            Ok((
                asset,
                serde_json::from_str::<RemoteAsset>(&asset.remote_payload)?,
            ))
        })
        .collect::<Result<Vec<_>, SyncError>>()?;
    let mut remote_faces = BTreeMap::<FontFaceId, Vec<_>>::new();
    for (asset, metadata) in &remote_assets {
        for face in &metadata.faces {
            let id =
                FontFaceId::from_revision(FontRevisionId::from_bytes(parse_id(&face.revision_id)?));
            remote_faces
                .entry(id)
                .or_default()
                .push((*asset, metadata, face));
        }
    }
    let mut catalog = local.clone();
    for family in &mut catalog.families {
        for face in &mut family.faces {
            face.sources
                .retain(|source| readable.contains_key(source.path()));
        }
        family.faces.retain(|face| !face.sources.is_empty());
    }
    catalog.families.retain(|family| !family.faces.is_empty());
    let mut unidentified = BTreeSet::new();
    let mut incomplete_faces = BTreeSet::new();
    let mut known_faces = catalog.faces().map(|face| face.id).collect::<BTreeSet<_>>();
    let known_families = catalog
        .faces()
        .map(|face| (face.identity_id, face.family_id))
        .collect::<BTreeMap<_, _>>();
    let mut family_indices = catalog
        .families
        .iter()
        .enumerate()
        .map(|(index, family)| (family.id, index))
        .collect::<BTreeMap<_, _>>();
    for (asset, metadata) in &remote_assets {
        for remote_face in &metadata.faces {
            let revision = FontRevisionId::from_bytes(parse_id(&remote_face.revision_id)?);
            let face_id = FontFaceId::from_revision(revision);
            if !known_faces.insert(face_id) {
                continue;
            }
            let identity = FontIdentityId::from_bytes(parse_id(&remote_face.identity_id)?);
            let known = known_families.get(&identity).copied();
            let details = remote_face.details.as_ref();
            let full_metadata = details
                .and_then(|value| value.get("metadata"))
                .and_then(|value| serde_json::from_value::<FaceMetadata>(value.clone()).ok());
            let family = details
                .and_then(|value| value.get("familyId"))
                .and_then(|value| value.as_str())
                .and_then(|value| parse_id(value).ok())
                .map(FontFamilyId::from_bytes)
                .or_else(|| known)
                .unwrap_or_else(|| {
                    FontFamilyId::from_family_key(&format!("cloud-file\0{}", asset.fingerprint))
                });
            let complete = full_metadata.is_some();
            let m = full_metadata.unwrap_or_else(|| FaceMetadata {
                full_name: Some(remote_face.display_name.clone()),
                subfamily_name: Some(remote_face.style_name.clone()),
                ..Default::default()
            });
            if !complete {
                incomplete_faces.insert(face_id);
            }
            if !complete && known.is_none() {
                unidentified.insert(family);
            }
            let format = details
                .and_then(|value| value.get("format"))
                .and_then(|value| serde_json::from_value(value.clone()).ok())
                .unwrap_or_else(|| {
                    FontFormat::from_extension(&asset.extension).unwrap_or(FontFormat::TrueType)
                });
            let face = FontFace {
                id: face_id,
                identity_id: identity,
                revision_id: revision,
                family_id: family,
                format,
                classification: folio_core::classify_names(
                    m.postscript_name.as_deref(),
                    m.family_name.as_deref(),
                ),
                metadata: m,
                sources: Vec::new(),
            };
            if let Some(index) = family_indices.get(&family) {
                catalog.families[*index].faces.push(face);
            } else {
                family_indices.insert(family, catalog.families.len());
                catalog.families.push(FontFamily {
                    id: family,
                    display_name: Some(remote_face.display_name.clone()),
                    localized_names: Vec::new(),
                    faces: vec![face],
                });
            }
        }
    }
    let confirmed = db
        .sync_metadata("last_directory_sync_ms")?
        .or(db.sync_metadata("last_successful_sync_ms")?)
        .and_then(|value| value.parse().ok());
    let mut locations = BTreeMap::new();
    for face in catalog.faces() {
        let mut files = BTreeMap::<String, FontFileLocation>::new();
        for source in &face.sources {
            let fingerprint = readable.get(source.path()).unwrap().clone();
            let mut policy = match policies.get(&fingerprint) {
                Some(policy) => policy.clone(),
                None => db.file_policy(&fingerprint)?,
            };
            policy.upload_excluded |= excluded_sources.contains(source.path());
            let file = files
                .entry(fingerprint.clone())
                .or_insert_with(|| FontFileLocation {
                    fingerprint: fingerprint.clone(),
                    filename: source
                        .path()
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                    file_size: std::fs::metadata(source.path()).map_or(0, |value| value.len()),
                    face_index: source.face_index(),
                    cloud_available: cloud.contains(&fingerprint),
                    upload_excluded: policy.upload_excluded,
                    download_policy: policy.download_policy,
                    transfer_action: policy.transfer_action,
                    transfer_status: policy.transfer_status,
                    transfer_error: policy.transfer_error,
                    ..Default::default()
                });
            file.local_sources.push(LocalFontLocation {
                path: source.path().to_string_lossy().into_owned(),
                kind: if source.path().starts_with(&root) {
                    "managed"
                } else {
                    "reference"
                }
                .to_owned(),
                preview_source: false,
            });
        }
        for (asset, remote, item) in remote_faces.get(&face.id).into_iter().flatten() {
            if files.contains_key(&asset.fingerprint) {
                continue;
            }
            let policy = match policies.get(&asset.fingerprint) {
                Some(policy) => policy.clone(),
                None => db.file_policy(&asset.fingerprint)?,
            };
            files.insert(
                asset.fingerprint.clone(),
                FontFileLocation {
                    fingerprint: asset.fingerprint.clone(),
                    filename: asset.filename.clone(),
                    file_size: remote.file_size,
                    face_index: item
                        .details
                        .as_ref()
                        .and_then(|value| value.get("faceIndex"))
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0) as u32,
                    cloud_available: true,
                    upload_excluded: policy.upload_excluded,
                    download_policy: policy.download_policy,
                    transfer_action: policy.transfer_action,
                    transfer_status: policy.transfer_status,
                    transfer_error: policy.transfer_error,
                    ..Default::default()
                },
            );
        }
        let preview = face
            .sources
            .first()
            .map(|source| source.path().to_string_lossy());
        for file in files.values_mut() {
            for source in &mut file.local_sources {
                source.preview_source = preview.as_deref() == Some(source.path.as_str());
            }
        }
        let files: Vec<_> = files.into_values().collect();
        let local_available = files.iter().any(|file| !file.local_sources.is_empty());
        let cloud_available = files.iter().any(|file| file.cloud_available);
        let pending = files.iter().any(|file| {
            !file.cloud_available
                && !file.upload_excluded
                && file
                    .local_sources
                    .iter()
                    .any(|source| source.kind == "managed")
        });
        locations.insert(
            face.id,
            FontLocation {
                state: if local_available && cloud_available {
                    "both"
                } else if cloud_available {
                    "cloudOnly"
                } else if pending {
                    "pendingUpload"
                } else {
                    "excluded"
                }
                .to_owned(),
                local_available,
                cloud_available,
                cloud_confirmed_at_ms: confirmed,
                metadata_complete: !incomplete_faces.contains(&face.id),
                files,
            },
        );
    }
    Ok(UnifiedLibrary {
        catalog,
        locations,
        unidentified_families: unidentified,
    })
}

impl UnifiedLibrary {
    pub fn index(&self, db: &mut FolioDatabase) -> Result<FontQueryIndex, SyncError> {
        let mut index = FontQueryIndex::build(&self.catalog, &db.library_state_snapshot()?)
            .map_err(|_| SyncError::InvalidId)?;
        index.set_locations(self.locations.clone());
        Ok(index)
    }
    pub fn recognized_family_count(&self) -> usize {
        self.catalog.family_count() - self.unidentified_families.len()
    }
}
