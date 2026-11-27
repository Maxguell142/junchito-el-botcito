const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
const {
  PersistenceConflict,
  sanitizeLegacySnapshot,
  encryptIdentityFields,
  decryptIdentityFields,
  parseIdentityKey
} = require('./database');

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

class NeonStore {
  constructor(connectionString = process.env.QUANTUM_FX_POSTGRES_URL_NON_POOLING || process.env.QUANTUM_FX_POSTGRES_URL) {
    if (!connectionString) throw new Error('Falta QUANTUM_FX_POSTGRES_URL.');
    this.sql = neon(connectionString);
    this.piiEncryptionKey = parseIdentityKey(process.env.BOT_VPN_PII_ENCRYPTION_KEY);
    this.canEncryptIdentityPii = Boolean(this.piiEncryptionKey);
    this.revision = 0;
  }

  async initialize(initialSnapshot) {
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS quantum_fx_state (
        id smallint PRIMARY KEY CHECK (id = 1),
        revision bigint NOT NULL,
        snapshot jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.sql.query(`
      CREATE TABLE IF NOT EXISTS quantum_fx_sessions (
        token_hash char(64) PRIMARY KEY,
        username text NOT NULL,
        role text NOT NULL,
        expires_at timestamptz NOT NULL
      )
    `);
    const seed = this.encodeSnapshot(initialSnapshot);
    await this.sql.query(
      'INSERT INTO quantum_fx_state (id, revision, snapshot) VALUES (1, 0, $1::jsonb) ON CONFLICT (id) DO NOTHING',
      [JSON.stringify(seed)]
    );
    return this.load();
  }

  encodeSnapshot(snapshot) {
    const safe = sanitizeLegacySnapshot(snapshot, true);
    safe.identities = safe.identities.map(identity => encryptIdentityFields(identity, this.piiEncryptionKey));
    if (Array.isArray(safe.ledger_transactions)) {
      const encryptedLedger = encryptIdentityFields(
        { ledger_transactions: safe.ledger_transactions },
        this.piiEncryptionKey
      );
      safe.ledger_transactions = encryptedLedger;
    }
    return safe;
  }

  decodeSnapshot(snapshot) {
    const decoded = { ...snapshot };
    decoded.identities = (decoded.identities || []).map(identity => decryptIdentityFields(identity, this.piiEncryptionKey));
    if (decoded.ledger_transactions && !Array.isArray(decoded.ledger_transactions)) {
      decoded.ledger_transactions = decryptIdentityFields(
        decoded.ledger_transactions,
        this.piiEncryptionKey
      ).ledger_transactions;
    }
    return decoded;
  }

  async load() {
    const rows = await this.sql.query('SELECT revision, snapshot FROM quantum_fx_state WHERE id = 1');
    if (!rows.length) throw new Error('No se pudo inicializar el estado de QUANTUM FX en Neon.');
    this.revision = Number(rows[0].revision);
    return { snapshot: this.decodeSnapshot(rows[0].snapshot), revision: this.revision };
  }

  async save(snapshot, expectedRevision) {
    const safe = this.encodeSnapshot(snapshot);
    const rows = await this.sql.query(
      `UPDATE quantum_fx_state
       SET snapshot = $1::jsonb, revision = revision + 1, updated_at = now()
       WHERE id = 1 AND revision = $2
       RETURNING revision`,
      [JSON.stringify(safe), expectedRevision]
    );
    if (!rows.length) throw new PersistenceConflict();
    this.revision = Number(rows[0].revision);
    return this.revision;
  }

  async createSession(token, { username, role, expiresAt }) {
    await this.sql.query('DELETE FROM quantum_fx_sessions WHERE expires_at <= now()');
    await this.sql.query(
      `INSERT INTO quantum_fx_sessions (token_hash, username, role, expires_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (token_hash) DO UPDATE SET username = EXCLUDED.username, role = EXCLUDED.role, expires_at = EXCLUDED.expires_at`,
      [tokenHash(token), username, role, new Date(expiresAt)]
    );
  }

  async getSession(token, refresh = true) {
    if (!token || typeof token !== 'string' || token.length > 256) return null;
    const rows = await this.sql.query(
      `SELECT username, role, expires_at FROM quantum_fx_sessions
       WHERE token_hash = $1 AND expires_at > now()`,
      [tokenHash(token)]
    );
    if (!rows.length) return null;
    const row = rows[0];
    const session = { username: row.username, role: row.role, expiresAt: new Date(row.expires_at).getTime() };
    if (refresh) {
      session.expiresAt = Date.now() + 12 * 60 * 60 * 1000;
      await this.sql.query(
        'UPDATE quantum_fx_sessions SET expires_at = $2 WHERE token_hash = $1',
        [tokenHash(token), new Date(session.expiresAt)]
      );
    }
    return session;
  }

  async deleteSession(token) {
    if (!token || typeof token !== 'string') return;
    await this.sql.query('DELETE FROM quantum_fx_sessions WHERE token_hash = $1', [tokenHash(token)]);
  }

  async healthCheck() {
    const rows = await this.sql.query('SELECT 1 FROM quantum_fx_state WHERE id = 1');
    return rows.length === 1;
  }
}

module.exports = { NeonStore };
