CREATE TABLE app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    revision INTEGER NOT NULL CHECK (revision >= 0)
);

INSERT INTO app_state (id, revision) VALUES (1, 0);

CREATE TABLE app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE identities (
    id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE bots (
    id TEXT PRIMARY KEY,
    identity_id TEXT REFERENCES identities(id) ON DELETE SET NULL,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE accounts (
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (bot_id, account_id)
);

CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    status TEXT NOT NULL,
    details_json TEXT NOT NULL
);

CREATE INDEX audit_events_occurred_at_idx ON audit_events (occurred_at);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id);

CREATE TABLE operations (
    id TEXT PRIMARY KEY,
    bot_id TEXT,
    account_id TEXT,
    operation_type TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('SIMULATED', 'PAPER')),
    status TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    details_json TEXT NOT NULL,
    idempotency_key TEXT UNIQUE
);

CREATE INDEX operations_occurred_at_idx ON operations (occurred_at);
CREATE INDEX operations_bot_idx ON operations (bot_id, occurred_at);
