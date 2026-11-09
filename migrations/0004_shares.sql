CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  game_id TEXT,
  allowed_keys TEXT NOT NULL DEFAULT '[]',
  wrapped BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX shares_library ON shares(library_id);
