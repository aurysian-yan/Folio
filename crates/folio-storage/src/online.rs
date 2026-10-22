//! 本机浏览配置、下载队列和字体来源；不参与同步事件。

use crate::{FolioDatabase, StorageError};
use rusqlite::{params, OptionalExtension};

impl FolioDatabase {
    pub fn online_setting(&self, key: &str) -> Result<Option<String>, StorageError> {
        Ok(self
            .conn
            .query_row(
                "SELECT value FROM online_settings WHERE key=?1",
                [key],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn save_online_setting(&self, key: &str, value: &str) -> Result<(), StorageError> {
        self.conn.execute("INSERT INTO online_settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key,value])?;
        Ok(())
    }

    pub fn transfer_records(&self) -> Result<Vec<(String, i64)>, StorageError> {
        let mut statement = self
            .conn
            .prepare("SELECT payload,revision FROM transfer_jobs ORDER BY rowid DESC")?;
        let rows = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn transfer_record(&self, id: &str) -> Result<Option<(String, i64)>, StorageError> {
        Ok(self
            .conn
            .query_row(
                "SELECT payload,revision FROM transfer_jobs WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?)
    }

    pub fn insert_transfer_record(&self, id: &str, payload: &str) -> Result<(), StorageError> {
        self.conn.execute(
            "INSERT INTO transfer_jobs(id,payload) VALUES(?1,?2)",
            params![id, payload],
        )?;
        Ok(())
    }

    pub fn update_transfer_record(
        &self,
        id: &str,
        revision: i64,
        payload: &str,
    ) -> Result<bool, StorageError> {
        Ok(self.conn.execute(
            "UPDATE transfer_jobs SET payload=?3,revision=revision+1 WHERE id=?1 AND revision=?2",
            params![id, revision, payload],
        )? == 1)
    }

    pub fn save_online_origin(
        &self,
        fingerprint: &str,
        id: &str,
        payload: &str,
    ) -> Result<(), StorageError> {
        self.conn.execute("INSERT INTO online_font_origins(fingerprint,origin_id,payload) VALUES(?1,?2,?3) ON CONFLICT(fingerprint,origin_id) DO UPDATE SET payload=excluded.payload",params![fingerprint,id,payload])?;
        Ok(())
    }

    pub fn online_origins(
        &self,
        fingerprint: &str,
    ) -> Result<Vec<folio_core::OnlineFontOrigin>, StorageError> {
        let mut statement = self.conn.prepare("SELECT DISTINCT payload FROM online_font_origins WHERE fingerprint=?1 ORDER BY payload")?;
        let rows = statement.query_map([fingerprint], |row| row.get::<_, String>(0))?;
        rows.map(|value| serde_json::from_str(&value?).map_err(|_| StorageError::InvalidOperation))
            .collect()
    }
}
