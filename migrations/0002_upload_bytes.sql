ALTER TABLE uploads ADD COLUMN bytes INTEGER NOT NULL DEFAULT 0;
CREATE INDEX uploads_library ON uploads(library_id);
