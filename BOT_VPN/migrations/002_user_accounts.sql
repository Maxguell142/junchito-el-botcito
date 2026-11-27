CREATE TABLE app_users (
    username TEXT PRIMARY KEY COLLATE NOCASE,
    display_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('ADMIN', 'USER')),
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'FROZEN')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX app_users_status_idx ON app_users (status, role);
