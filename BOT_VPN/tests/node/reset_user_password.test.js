const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const { hashPassword, passwordMatches, updateLocalPassword } = require('../../scripts/reset-user-password');

test('resets the local password without changing the user role or status', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantum-fx-password-'));
  const databasePath = path.join(tempDir, 'users.sqlite3');
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE app_users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO app_users (username, password_hash, role, status, updated_at)
    VALUES ('V8', 'old-hash', 'ADMIN', 'ACTIVE', 'old-date');
  `);
  database.close();

  try {
    const newPassword = 'un-nuevo-secreto-largo';
    const passwordHash = await hashPassword(newPassword);
    assert.equal(updateLocalPassword(databasePath, 'v8', passwordHash), 1);

    const updatedDb = new DatabaseSync(databasePath, { readOnly: true });
    const user = updatedDb.prepare(
      'SELECT password_hash, role, status FROM app_users WHERE username = ?'
    ).get('V8');
    updatedDb.close();

    assert.equal(await passwordMatches(newPassword, user.password_hash), true);
    assert.equal(await passwordMatches('old-password', user.password_hash), false);
    assert.equal(user.role, 'ADMIN');
    assert.equal(user.status, 'ACTIVE');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
