-- Immutable snapshot contents (manifest.json, SHA256SUMS, statistics.json, verified-results.json).
CREATE TABLE snapshot_files (
  snapshot_id TEXT    NOT NULL REFERENCES snapshots(snapshot_id),
  name        TEXT    NOT NULL,
  sha256      TEXT    NOT NULL,
  bytes       INTEGER NOT NULL,
  content     TEXT    NOT NULL,
  PRIMARY KEY (snapshot_id, name)
) WITHOUT ROWID;
