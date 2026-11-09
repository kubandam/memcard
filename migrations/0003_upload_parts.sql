CREATE TABLE upload_parts (
  upload_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  PRIMARY KEY (upload_id, part)
);
CREATE INDEX uploads_created ON uploads(created_at);
