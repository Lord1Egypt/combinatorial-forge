-- Combinatorial Forge logical schema v1. Shared verbatim by local SQLite (native CLI) and
-- the central libSQL/Turso deployment. All timestamps are integer milliseconds since the epoch.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  checksum   TEXT    NOT NULL,
  applied_at INTEGER NOT NULL
);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE problems (
  problem          TEXT PRIMARY KEY,
  title            TEXT    NOT NULL,
  status           TEXT    NOT NULL CHECK (status IN ('complete', 'partial', 'research')),
  description      TEXT    NOT NULL,
  required_matches INTEGER NOT NULL DEFAULT 2 CHECK (required_matches >= 1),
  lease_seconds    INTEGER NOT NULL DEFAULT 600 CHECK (lease_seconds >= 10),
  max_attempts     INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts >= 1)
);

CREATE TABLE solver_versions (
  problem        TEXT NOT NULL REFERENCES problems(problem),
  solver_version TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  source_commit  TEXT,
  source_hash    TEXT,
  compiler       TEXT,
  build_config   TEXT,
  platform       TEXT,
  created_at     INTEGER NOT NULL,
  PRIMARY KEY (problem, solver_version)
);

CREATE TABLE runs (
  run_id         TEXT PRIMARY KEY,
  problem        TEXT    NOT NULL REFERENCES problems(problem),
  solver_version TEXT    NOT NULL,
  parameters     TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'complete', 'cancelled')),
  total_jobs     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  completed_at   INTEGER
);

CREATE TABLE jobs (
  job_id                TEXT PRIMARY KEY,
  run_id                TEXT    NOT NULL REFERENCES runs(run_id),
  problem               TEXT    NOT NULL REFERENCES problems(problem),
  problem_version       TEXT    NOT NULL,
  solver_version        TEXT    NOT NULL,
  payload               TEXT    NOT NULL,
  status                TEXT    NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'running', 'submitted', 'verified', 'disputed', 'failed', 'cancelled')),
  priority              INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  lease_owner           TEXT,
  lease_until           INTEGER,
  attempts              INTEGER NOT NULL DEFAULT 0,
  submitted_result_hash TEXT,
  verified_result_hash  TEXT,
  verified_result       TEXT,
  nodes_processed       INTEGER NOT NULL DEFAULT 0,
  runtime_ms            INTEGER NOT NULL DEFAULT 0,
  platform              TEXT,
  verification_count    INTEGER NOT NULL DEFAULT 0,
  checkpoint            TEXT,
  checkpoint_at         INTEGER
);

CREATE TABLE job_leases (
  lease_id    TEXT PRIMARY KEY,
  job_id      TEXT    NOT NULL REFERENCES jobs(job_id),
  worker_id   TEXT    NOT NULL,
  token_hash  TEXT    NOT NULL,
  leased_at   INTEGER NOT NULL,
  lease_until INTEGER NOT NULL,
  released_at INTEGER,
  outcome     TEXT CHECK (outcome IN ('submitted', 'released', 'expired'))
);

CREATE TABLE submissions (
  submission_id   TEXT PRIMARY KEY,
  job_id          TEXT    NOT NULL REFERENCES jobs(job_id),
  worker_id       TEXT    NOT NULL,
  network_hash    TEXT,
  result_hash     TEXT    NOT NULL,
  result          TEXT    NOT NULL,
  nodes_processed INTEGER NOT NULL DEFAULT 0,
  runtime_ms      INTEGER NOT NULL DEFAULT 0,
  platform        TEXT,
  trusted         INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0, 1)),
  status          TEXT    NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'verified', 'rejected')),
  created_at      INTEGER NOT NULL,
  UNIQUE (job_id, worker_id)
);

CREATE TABLE verifications (
  verification_id TEXT PRIMARY KEY,
  job_id          TEXT    NOT NULL REFERENCES jobs(job_id),
  outcome         TEXT    NOT NULL CHECK (outcome IN ('verified', 'disputed', 'reopened')),
  result_hash     TEXT,
  submission_ids  TEXT    NOT NULL,
  method          TEXT    NOT NULL,
  created_at      INTEGER NOT NULL
);

CREATE TABLE aggregate_results (
  run_id        TEXT PRIMARY KEY REFERENCES runs(run_id),
  result        TEXT    NOT NULL,
  result_hash   TEXT    NOT NULL,
  verified_jobs INTEGER NOT NULL,
  total_jobs    INTEGER NOT NULL,
  complete      INTEGER NOT NULL CHECK (complete IN (0, 1)),
  updated_at    INTEGER NOT NULL
);

CREATE TABLE snapshots (
  snapshot_id     TEXT PRIMARY KEY,
  created_at      INTEGER NOT NULL,
  schema_version  INTEGER NOT NULL,
  project_commit  TEXT,
  manifest        TEXT    NOT NULL,
  manifest_sha256 TEXT    NOT NULL
);

-- Chess research data. A position row is an identity (placement, side, castling, legal ep).
CREATE TABLE chess_positions (
  position_id TEXT PRIMARY KEY,
  epd         TEXT    NOT NULL,
  first_ply   INTEGER NOT NULL,
  legal_moves INTEGER NOT NULL
);

CREATE TABLE chess_edges (
  parent_id TEXT NOT NULL,
  child_id  TEXT NOT NULL,
  uci       TEXT NOT NULL,
  PRIMARY KEY (parent_id, uci)
) WITHOUT ROWID;

CREATE TABLE chess_layers (
  run_id           TEXT    NOT NULL,
  ply              INTEGER NOT NULL,
  unique_positions INTEGER NOT NULL,
  move_sequences   INTEGER,
  status           TEXT    NOT NULL CHECK (status IN ('complete', 'partial')),
  PRIMARY KEY (run_id, ply)
) WITHOUT ROWID;

-- Working set for resumable layer enumeration (native only; never exported).
CREATE TABLE chess_layer_members (
  run_id      TEXT    NOT NULL,
  ply         INTEGER NOT NULL,
  position_id TEXT    NOT NULL,
  packed      BLOB    NOT NULL,
  expanded    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, ply, position_id)
) WITHOUT ROWID;

-- Native contributors: claims made on a remote deployment, kept so work can resume after a restart.
CREATE TABLE client_claims (
  job_id      TEXT PRIMARY KEY,
  base_url    TEXT    NOT NULL,
  lease_token TEXT    NOT NULL,
  lease_until INTEGER NOT NULL,
  payload     TEXT    NOT NULL,
  checkpoint  TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_jobs_claim    ON jobs (problem, status, priority DESC, created_at, job_id);
CREATE INDEX idx_jobs_run      ON jobs (run_id, status);
CREATE INDEX idx_jobs_lease    ON jobs (lease_until) WHERE status IN ('leased', 'running');
CREATE INDEX idx_submissions_job ON submissions (job_id, result_hash);
CREATE INDEX idx_leases_job    ON job_leases (job_id);
CREATE INDEX idx_verifications_job ON verifications (job_id);
CREATE INDEX idx_chess_positions_ply ON chess_positions (first_ply);
CREATE INDEX idx_chess_edges_child ON chess_edges (child_id);
CREATE INDEX idx_layer_members_open ON chess_layer_members (run_id, ply, expanded);
