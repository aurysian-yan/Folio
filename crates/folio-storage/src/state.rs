//! Collections、Favorites 与 Recent 的同步事务接口。

use crate::root::{id_bytes, system_time_to_nanos};
use crate::{cache, FolioDatabase, StorageError};
use folio_core::{
    normalize_search, Collection, CollectionColor, CollectionIcon, CollectionId, CollectionMembers,
    FontFaceId, FontIdentityId, LibraryStateSnapshot, RecentFont, RootMembership,
};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::{BTreeMap, BTreeSet};
use std::time::SystemTime;

fn now() -> Result<i64, StorageError> {
    system_time_to_nanos(SystemTime::now()).ok_or(StorageError::InvalidTimestamp)
}
fn valid_name(name: &str) -> Result<String, StorageError> {
    let key = normalize_search(name);
    if key.is_empty() {
        Err(StorageError::InvalidCollectionName)
    } else {
        Ok(key)
    }
}
fn require_collection(conn: &Connection, id: CollectionId) -> Result<(), StorageError> {
    if conn
        .query_row(
            "SELECT 1 FROM collections WHERE id=?1",
            [id.as_bytes().as_slice()],
            |_| Ok(()),
        )
        .optional()?
        .is_none()
    {
        return Err(StorageError::CollectionNotFound { id });
    }
    Ok(())
}
fn collection(row: &Row<'_>) -> Result<Collection, StorageError> {
    let id: Vec<u8> = row.get(0)?;
    let icon_key: String = row.get(4)?;
    let color_key: String = row.get(5)?;
    Ok(Collection {
        id: CollectionId::from_bytes(id_bytes(&id, "collections.id")?),
        name: row.get(1)?,
        created_at_ns: row.get(2)?,
        updated_at_ns: row.get(3)?,
        icon: CollectionIcon::from_key(&icon_key)
            .ok_or(StorageError::CorruptCollectionIcon(icon_key))?,
        color: CollectionColor::from_key(&color_key)
            .ok_or(StorageError::CorruptCollectionColor(color_key))?,
    })
}
fn name_conflict(error: rusqlite::Error) -> StorageError {
    if matches!(&error, rusqlite::Error::SqliteFailure(code, _) if code.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE)
    {
        StorageError::CollectionNameConflict
    } else {
        error.into()
    }
}
fn read_id(row: &Row<'_>, index: usize) -> Result<FontIdentityId, StorageError> {
    let bytes: Vec<u8> = row.get(index)?;
    Ok(FontIdentityId::from_bytes(id_bytes(
        &bytes,
        "durable identity_id",
    )?))
}
fn members(conn: &Connection, id: CollectionId) -> Result<Vec<FontIdentityId>, StorageError> {
    require_collection(conn, id)?;
    let mut stmt = conn.prepare(
        "SELECT identity_id FROM collection_members WHERE collection_id=?1 ORDER BY identity_id",
    )?;
    let mut rows = stmt.query([id.as_bytes().as_slice()])?;
    let mut ids = Vec::new();
    while let Some(row) = rows.next()? {
        ids.push(read_id(row, 0)?);
    }
    Ok(ids)
}

impl FolioDatabase {
    pub fn create_collection(&self, name: &str) -> Result<Collection, StorageError> {
        self.create_collection_with_style(name, CollectionIcon::Folder, CollectionColor::Gray)
    }

    pub fn create_collection_with_icon(
        &self,
        name: &str,
        icon: CollectionIcon,
    ) -> Result<Collection, StorageError> {
        self.create_collection_with_style(name, icon, CollectionColor::Gray)
    }

    pub fn create_collection_with_style(
        &self,
        name: &str,
        icon: CollectionIcon,
        color: CollectionColor,
    ) -> Result<Collection, StorageError> {
        let key = valid_name(name)?;
        let mut bytes = [0; 16];
        getrandom::fill(&mut bytes).map_err(StorageError::RandomId)?;
        let timestamp = now()?;
        let result = Collection {
            id: CollectionId::from_bytes(bytes),
            name: name.to_owned(),
            icon,
            color,
            created_at_ns: timestamp,
            updated_at_ns: timestamp,
        };
        self.conn
            .execute(
                "INSERT INTO collections (id,name,normalized_name,created_at_ns,updated_at_ns,icon,color) VALUES (?1,?2,?3,?4,?4,?5,?6)",
                params![
                    result.id.as_bytes().as_slice(),
                    name,
                    key,
                    result.created_at_ns,
                    icon.key(),
                    color.key(),
                ],
            )
            .map_err(name_conflict)?;
        Ok(result)
    }
    pub fn rename_collection(&self, id: CollectionId, name: &str) -> Result<(), StorageError> {
        let key = valid_name(name)?;
        let changed = self.conn.execute("UPDATE collections SET name=?2, normalized_name=?3, updated_at_ns=max(updated_at_ns,?4) WHERE id=?1", params![id.as_bytes().as_slice(), name, key, now()?]).map_err(name_conflict)?;
        if changed == 0 {
            return Err(StorageError::CollectionNotFound { id });
        }
        Ok(())
    }
    pub fn update_collection(
        &self,
        id: CollectionId,
        name: &str,
        icon: CollectionIcon,
        color: CollectionColor,
    ) -> Result<(), StorageError> {
        let key = valid_name(name)?;
        let changed = self
            .conn
            .execute(
                "UPDATE collections SET name=?2, normalized_name=?3, icon=?4, color=?5, updated_at_ns=max(updated_at_ns,?6) WHERE id=?1",
                params![id.as_bytes().as_slice(), name, key, icon.key(), color.key(), now()?],
            )
            .map_err(name_conflict)?;
        if changed == 0 {
            return Err(StorageError::CollectionNotFound { id });
        }
        Ok(())
    }
    pub fn delete_collection(&self, id: CollectionId) -> Result<(), StorageError> {
        if self.conn.execute(
            "DELETE FROM collections WHERE id=?1",
            [id.as_bytes().as_slice()],
        )? == 0
        {
            return Err(StorageError::CollectionNotFound { id });
        }
        Ok(())
    }
    pub fn list_collections(&self) -> Result<Vec<Collection>, StorageError> {
        let mut stmt = self.conn.prepare("SELECT id,name,created_at_ns,updated_at_ns,icon,color FROM collections ORDER BY normalized_name,id")?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(collection(row)?);
        }
        Ok(out)
    }
    pub fn list_collection_members(
        &self,
        id: CollectionId,
    ) -> Result<Vec<FontIdentityId>, StorageError> {
        members(&self.conn, id)
    }
    pub fn add_collection_members(
        &mut self,
        id: CollectionId,
        identities: &[FontIdentityId],
    ) -> Result<(), StorageError> {
        self.change_members(id, identities, true)
    }
    pub fn remove_collection_members(
        &mut self,
        id: CollectionId,
        identities: &[FontIdentityId],
    ) -> Result<(), StorageError> {
        self.change_members(id, identities, false)
    }
    fn change_members(
        &mut self,
        id: CollectionId,
        identities: &[FontIdentityId],
        add: bool,
    ) -> Result<(), StorageError> {
        let timestamp = now()?;
        let tx = self.conn.transaction()?;
        require_collection(&tx, id)?;
        {
            let sql = if add {
                "INSERT INTO collection_members VALUES (?1,?2) ON CONFLICT(collection_id,identity_id) DO NOTHING"
            } else {
                "DELETE FROM collection_members WHERE collection_id=?1 AND identity_id=?2"
            };
            let mut stmt = tx.prepare(sql)?;
            let mut changed = 0;
            for identity in identities {
                changed += stmt.execute(params![
                    id.as_bytes().as_slice(),
                    identity.as_bytes().as_slice()
                ])?;
            }
            if changed > 0 {
                tx.execute(
                    "UPDATE collections SET updated_at_ns=max(updated_at_ns,?2) WHERE id=?1",
                    params![id.as_bytes().as_slice(), timestamp],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }
    pub fn set_favorite(&mut self, id: FontIdentityId, favorite: bool) -> Result<(), StorageError> {
        self.bulk_set_favorite(&[id], favorite)
    }
    pub fn bulk_set_favorite(
        &mut self,
        identities: &[FontIdentityId],
        favorite: bool,
    ) -> Result<(), StorageError> {
        let tx = self.conn.transaction()?;
        {
            let sql = if favorite {
                "INSERT INTO favorites VALUES (?1) ON CONFLICT(identity_id) DO NOTHING"
            } else {
                "DELETE FROM favorites WHERE identity_id=?1"
            };
            let mut stmt = tx.prepare(sql)?;
            for identity in identities {
                stmt.execute([identity.as_bytes().as_slice()])?;
            }
        }
        tx.commit()?;
        Ok(())
    }
    pub fn is_favorite(&self, id: FontIdentityId) -> Result<bool, StorageError> {
        Ok(self
            .conn
            .query_row(
                "SELECT 1 FROM favorites WHERE identity_id=?1",
                [id.as_bytes().as_slice()],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }
    pub fn list_favorites(&self) -> Result<Vec<FontIdentityId>, StorageError> {
        let mut stmt = self
            .conn
            .prepare("SELECT identity_id FROM favorites ORDER BY identity_id")?;
        let mut rows = stmt.query([])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(read_id(row, 0)?);
        }
        Ok(out)
    }
    pub fn record_recent(&self, id: FontIdentityId) -> Result<(), StorageError> {
        self.conn.execute("INSERT INTO recent_fonts VALUES (?1,?2) ON CONFLICT(identity_id) DO UPDATE SET last_accessed_at_ns=max(last_accessed_at_ns,excluded.last_accessed_at_ns)", params![id.as_bytes().as_slice(), now()?])?;
        Ok(())
    }
    pub fn list_recent(&self, limit: usize) -> Result<Vec<RecentFont>, StorageError> {
        let mut stmt = self.conn.prepare("SELECT identity_id,last_accessed_at_ns FROM recent_fonts ORDER BY last_accessed_at_ns DESC,identity_id LIMIT ?1")?;
        let mut rows = stmt.query([i64::try_from(limit).unwrap_or(i64::MAX)])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            out.push(RecentFont {
                identity_id: read_id(row, 0)?,
                last_accessed_at_ns: row.get(1)?,
            });
        }
        Ok(out)
    }
    pub fn clear_recent(&self) -> Result<(), StorageError> {
        self.conn.execute("DELETE FROM recent_fonts", [])?;
        Ok(())
    }

    /// 一次读事务产生一致状态快照，不访问字体文件。
    pub fn library_state_snapshot(&mut self) -> Result<LibraryStateSnapshot, StorageError> {
        let tx = self.conn.unchecked_transaction()?;
        let favorites = self.list_favorites()?;
        let recent = self.list_recent(usize::MAX)?;
        let mut collections: BTreeMap<CollectionId, Vec<FontIdentityId>> = self
            .list_collections()?
            .into_iter()
            .map(|c| (c.id, Vec::new()))
            .collect();
        {
            let mut stmt = tx.prepare("SELECT collection_id,identity_id FROM collection_members ORDER BY collection_id,identity_id")?;
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                let bytes: Vec<u8> = row.get(0)?;
                let id =
                    CollectionId::from_bytes(id_bytes(&bytes, "collection_members.collection_id")?);
                collections
                    .get_mut(&id)
                    .ok_or(StorageError::CollectionNotFound { id })?
                    .push(read_id(row, 1)?);
            }
        }
        let mut roots: BTreeMap<_, BTreeSet<FontFaceId>> = BTreeMap::new();
        for row in cache::load_all_rows(&tx)? {
            if row.status != cache::SourceStatus::Parsed {
                continue;
            }
            let faces = roots.entry(row.root_id.into()).or_default();
            let payload = match cache::parsed_payload(&row) {
                Ok(payload) => payload,
                Err(StorageError::CacheIncompatible { .. }) => continue,
                Err(error) => return Err(error),
            };
            for face in payload.faces {
                faces.insert(FontFaceId::from_bytes(face.id));
            }
        }
        tx.commit()?;
        Ok(LibraryStateSnapshot {
            favorites,
            recent,
            collections: collections
                .into_iter()
                .map(|(collection_id, identities)| CollectionMembers {
                    collection_id,
                    identities,
                })
                .collect(),
            roots: roots
                .into_iter()
                .map(|(root_id, faces)| RootMembership {
                    root_id,
                    face_ids: faces.into_iter().collect(),
                })
                .collect(),
        })
    }
}
