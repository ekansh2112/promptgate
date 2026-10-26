-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER NOT NULL UNIQUE,
  username TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_users_github_id ON users(github_id);

-- Repositories table
CREATE TABLE IF NOT EXISTS repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL UNIQUE,
  is_private INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_repositories_full_name ON repositories(full_name);

-- Runs table
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  pr_number INTEGER,
  base_ref TEXT NOT NULL,
  head_ref TEXT NOT NULL,
  passed INTEGER NOT NULL,
  total_cost REAL NOT NULL,
  timestamp TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (repository_id) REFERENCES repositories(id)
);

CREATE INDEX idx_runs_repository_id ON runs(repository_id);
CREATE INDEX idx_runs_pr_number ON runs(pr_number);
CREATE INDEX idx_runs_created_at ON runs(created_at);

-- Prompt results table
CREATE TABLE IF NOT EXISTS prompt_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  prompt_name TEXT NOT NULL,
  prompt_path TEXT NOT NULL,
  model TEXT NOT NULL,
  total_cases INTEGER NOT NULL,
  passed_cases INTEGER NOT NULL,
  failed_cases INTEGER NOT NULL,
  critical_failures INTEGER NOT NULL,
  flaky_count INTEGER NOT NULL,
  base_pass_rate REAL NOT NULL,
  head_pass_rate REAL NOT NULL,
  pass_rate_delta REAL NOT NULL,
  total_cost_base REAL NOT NULL,
  total_cost_head REAL NOT NULL,
  avg_latency_base REAL NOT NULL,
  avg_latency_head REAL NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(id)
);

CREATE INDEX idx_prompt_results_run_id ON prompt_results(run_id);

-- Case results table
CREATE TABLE IF NOT EXISTS case_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_result_id INTEGER NOT NULL,
  case_name TEXT,
  inputs TEXT NOT NULL,
  critical INTEGER NOT NULL DEFAULT 0,
  base_output TEXT NOT NULL,
  head_output TEXT NOT NULL,
  flaky INTEGER NOT NULL DEFAULT 0,
  judge_result TEXT,
  FOREIGN KEY (prompt_result_id) REFERENCES prompt_results(id)
);

CREATE INDEX idx_case_results_prompt_result_id ON case_results(prompt_result_id);

-- Quotas table
CREATE TABLE IF NOT EXISTS quotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository TEXT NOT NULL,
  date TEXT NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 0,
  token_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(repository, date)
);

CREATE INDEX idx_quotas_repository_date ON quotas(repository, date);

-- Cache table
CREATE TABLE IF NOT EXISTS cache (
  hash TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_cache_created_at ON cache(created_at);

-- Calibration labels table
CREATE TABLE IF NOT EXISTS calibration_labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id INTEGER NOT NULL,
  prompt_name TEXT NOT NULL,
  case_id INTEGER NOT NULL,
  output TEXT NOT NULL,
  label TEXT NOT NULL CHECK(label IN ('good', 'bad')),
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (repository_id) REFERENCES repositories(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX idx_calibration_labels_repository_id ON calibration_labels(repository_id);
CREATE INDEX idx_calibration_labels_prompt_name ON calibration_labels(prompt_name);
