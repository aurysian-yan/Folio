CREATE TABLE library_roots (
            id            BLOB    PRIMARY KEY NOT NULL,
            path_platform TEXT    NOT NULL,
            path_bytes    BLOB    NOT NULL,
            display_path  TEXT    NOT NULL,
            recursive     INTEGER NOT NULL,
            created_at_ns INTEGER NOT NULL
        );
CREATE TABLE source_files (
            id              INTEGER PRIMARY KEY,
            root_id         BLOB    NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
            path_platform   TEXT    NOT NULL,
            path_bytes      BLOB    NOT NULL,
            display_path    TEXT    NOT NULL,
            file_size       INTEGER NOT NULL,
            mtime_ns        INTEGER,
            content_hash    BLOB,
            status          TEXT    NOT NULL,
            format          TEXT,
            payload_version INTEGER,
            payload         BLOB,
            error_message   TEXT
        );
CREATE UNIQUE INDEX library_roots_path
            ON library_roots (path_platform, path_bytes);
CREATE UNIQUE INDEX source_files_root_path
            ON source_files (root_id, path_platform, path_bytes);
PRAGMA user_version = 1;
