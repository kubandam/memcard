CREATE TABLE libraries (
  id TEXT PRIMARY KEY,
  auth_verifier TEXT NOT NULL,
  manifest_etag TEXT,
  bytes_used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE objects (
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (library_id, key)
);
CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL,
  key TEXT NOT NULL,
  upload_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
