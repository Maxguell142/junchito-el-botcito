const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomBytes, randomUUID, createCipheriv, createDecipheriv } = require('node:crypto');

const ENCRYPTED_IDENTITY_FIELDS = [
  'full_name', 'alias', 'country', 'city', 'province', 'postal_code', 'address',
  'email', 'phone_country_code', 'phone_country_iso', 'phone', 'dni', 'crypto_wallet_name',
  'crypto_network', 'crypto_wallet_address', 'crypto_transfer_alias',
  'card_brand', 'card_last4', 'card_exp_month', 'card_exp_year',
  'payment_provider', 'payment_reference', 'notes', 'ledger_transactions'
];

function parseIdentityKey(value = process.env.BOT_VPN_PII_ENCRYPTION_KEY) {
  if (!value) return null;
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('BOT_VPN_PII_ENCRYPTION_KEY debe contener 64 caracteres hexadecimales.');
  return Buffer.from(value, 'hex');
}

function encryptIdentityFields(identity, key) {
  const result = { ...identity };
  const payload = Object.fromEntries(ENCRYPTED_IDENTITY_FIELDS
    .filter(field => Object.hasOwn(result, field))
    .map(field => [field, result[field]]));
  if (!Object.keys(payload).length) return result;
  if (!key) return result;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  for (const field of Object.keys(payload)) delete result[field];
  result.__pii_encrypted_v1 = {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64')
  };
  return result;
}

function decryptIdentityFields(identity, key) {
  const envelope = identity.__pii_encrypted_v1;
  if (!envelope) return identity;
  if (!key) throw new Error('No se pudo descifrar el perfil. Inicia QUANTUM FX con el usuario de Windows que lo creó.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const cleartext = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final()
  ]).toString('utf8');
  const result = { ...identity, ...JSON.parse(cleartext) };
  delete result.__pii_encrypted_v1;
  return result;
}

class PersistenceConflict extends Error {
  constructor() {
    super('La base de datos cambió desde la última lectura.');
    this.name = 'PersistenceConflict';
    this.statusCode = 409;
  }
}

function now() {
  return new Date().toISOString();
}

function sanitizeProxyUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function sanitizeLegacySnapshot(snapshot, includeDailyMetrics = false) {
  const identities = (Array.isArray(snapshot.identities) ? snapshot.identities : [])
    .filter(identity => identity && typeof identity.id === 'string')
    .map(identity => Object.fromEntries(
      [
        'id', 'owner_username', 'record_source', 'full_name', 'alias', 'country', 'city', 'province', 'postal_code',
        'address', 'flag', 'kyc_status', 'email', 'phone_country_code', 'phone',
        'phone_country_iso', 'dni', 'crypto_wallet_name', 'crypto_network', 'crypto_wallet_address',
        'crypto_transfer_alias', 'card_brand', 'card_last4', 'card_exp_month',
        'card_exp_year', 'payment_provider', 'payment_reference', 'notes'
      ]
        .filter(key => Object.hasOwn(identity, key))
        .map(key => [key, identity[key]])
    ));
  const privateIdentityValues = (Array.isArray(snapshot.identities) ? snapshot.identities : [])
    .flatMap(identity => ENCRYPTED_IDENTITY_FIELDS
      .filter(field => field !== 'crypto_network')
      .map(field => identity && identity[field])
      .filter(value => typeof value === 'string' && value.length >= 4));
  const redactIdentityText = value => {
    if (Array.isArray(value)) return value.map(redactIdentityText);
    if (!value || typeof value !== 'object') {
      if (typeof value !== 'string') return value;
      return privateIdentityValues.reduce((text, secret) => text.split(secret).join('[dato personal]'), value);
    }
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactIdentityText(nested)]));
  };
  const bots = (Array.isArray(snapshot.bots) ? snapshot.bots : [])
    .filter(bot => bot && typeof bot.id === 'string')
    .map(bot => {
      const safeBot = Object.fromEntries(
        [
          'id', 'owner_username', 'record_source', 'name', 'identity_id', 'strategy', 'outbound_ip', 'proxy_port',
          'isp_provider', 'node_location', 'geo_match_status', 'status',
          'schedule', 'circuit_breaker',
          'gate_engine', 'risk_parameters',
          'net_pnl', 'today_pnl', 'today_pnl_date', 'total_trades', 'winning_trades',
          'losing_trades', 'max_drawdown', 'logs'
        ]
          .filter(key => Object.hasOwn(bot, key))
          .map(key => [key, bot[key]])
      );
      safeBot.proxy_url = sanitizeProxyUrl(bot.proxy_url);
      safeBot.logs = redactIdentityText(safeBot.logs || []);
      safeBot.accounts = (Array.isArray(bot.accounts) ? bot.accounts : [])
        .filter(account => account && typeof account.id === 'string')
        .map(account => {
          const safeAccount = Object.fromEntries(
            [
              'id', 'record_source', 'mode', 'custom_name', 'broker', 'prop_firm', 'balance',
              'floating_pnl', 'realized_pnl', 'active_contracts',
              'current_position', 'entry_price', 'last_order_time',
              'titular_name', 'environment', 'max_contracts',
              'daily_loss_limit'
            ]
              .filter(key => Object.hasOwn(account, key))
              .map(key => [key, account[key]])
          );
          const maxContracts = account.max_contracts ?? 2;
          const dailyLossLimit = account.daily_loss_limit ?? 1000;
          if (!Number.isInteger(maxContracts) || maxContracts < 1 || maxContracts > 100) {
            throw new TypeError(`Límite max_contracts inválido para la cuenta ${account.id}.`);
          }
          if (typeof dailyLossLimit !== 'number' || !Number.isFinite(dailyLossLimit) || dailyLossLimit < 0) {
            throw new TypeError(`Límite daily_loss_limit inválido para la cuenta ${account.id}.`);
          }
          safeAccount.max_contracts = maxContracts;
          safeAccount.daily_loss_limit = dailyLossLimit;
          if (includeDailyMetrics) {
            const dailyPnl = account.daily_pnl ?? 0;
            const ordersToday = account.orders_today ?? 0;
            const metricsDate = account.daily_metrics_date || new Date().toISOString().slice(0, 10);
            if (typeof dailyPnl !== 'number' || !Number.isFinite(dailyPnl)) {
              throw new TypeError(`daily_pnl inválido para la cuenta ${account.id}.`);
            }
            if (!Number.isInteger(ordersToday) || ordersToday < 0) {
              throw new TypeError(`orders_today inválido para la cuenta ${account.id}.`);
            }
            const parsedDate = new Date(`${metricsDate}T00:00:00Z`);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(metricsDate)
              || Number.isNaN(parsedDate.getTime())
              || parsedDate.toISOString().slice(0, 10) !== metricsDate) {
              throw new TypeError(`daily_metrics_date inválido para la cuenta ${account.id}.`);
            }
            safeAccount.daily_pnl = dailyPnl;
            safeAccount.orders_today = ordersToday;
            safeAccount.daily_metrics_date = metricsDate;
          }
          safeAccount.username = account.username ? '••••' : '';
          safeAccount.password_masked = '';
          safeAccount.status = 'NOT_CONFIGURED';
          return safeAccount;
        });
      return safeBot;
    });
  const server = snapshot.server && typeof snapshot.server === 'object' ? snapshot.server : {};
  const auth = snapshot.auth && typeof snapshot.auth === 'object' ? snapshot.auth : {};
  const safeSnapshot = {
    server: { host: '127.0.0.1', port: server.port || 8000 },
    auth: { role: auth.role || 'ADMIN_TRADER' },
    identities,
    bots
  };
  if (Number.isInteger(snapshot.sample_data_version)) safeSnapshot.sample_data_version = snapshot.sample_data_version;
  if (Array.isArray(snapshot.ledger_transactions)) {
    safeSnapshot.ledger_transactions = snapshot.ledger_transactions
      .filter(transaction => transaction && typeof transaction.id === 'string')
      .map(transaction => Object.fromEntries(
        ['id', 'owner_username', 'record_source', 'mode', 'date', 'identity_id', 'identity_name', 'account_name', 'prop_firm', 'type', 'amount', 'status', 'notes']
          .filter(key => Object.hasOwn(transaction, key))
          .map(key => [key, transaction[key]])
      ));
  }
  return safeSnapshot;
}

class SQLiteStore {
  constructor(databasePath = process.env.BOT_VPN_DB_PATH || path.resolve(__dirname, '..', '..', 'bot_vpn.sqlite3')) {
    this.databasePath = databasePath;
    this.piiEncryptionKey = parseIdentityKey();
    this.canEncryptIdentityPii = Boolean(this.piiEncryptionKey);
    if (databasePath !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    this.applyMigrations();
  }

  applyMigrations() {
    this.database.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations ' +
      '(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)'
    );
    const migrationDirectory = path.resolve(__dirname, '..', '..', 'migrations');
    const files = fs.readdirSync(migrationDirectory)
      .filter(name => /^\d{3}_.+\.sql$/.test(name))
      .sort();
    for (const name of files) {
      const version = Number(name.split('_', 1)[0]);
      this.database.exec('BEGIN IMMEDIATE');
      try {
        if (this.database.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(version)) {
          this.database.exec('COMMIT');
          continue;
        }
        this.database.exec(fs.readFileSync(path.join(migrationDirectory, name), 'utf8'));
        this.database.prepare(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)'
        ).run(version, name, now());
        this.database.exec('COMMIT');
      } catch (error) {
        try { this.database.exec('ROLLBACK'); } catch { /* no active transaction */ }
        throw error;
      }
    }
  }

  get revision() {
    return this.database.prepare('SELECT revision FROM app_state WHERE id = 1').get().revision;
  }

  healthCheck() {
    const state = this.database.prepare('SELECT revision FROM app_state WHERE id = 1').get();
    return Boolean(state && Number.isInteger(state.revision));
  }

  loadOrImport(legacySnapshot) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      let revision = this.revision;
      if (revision === 0) {
        this.replaceSnapshot(sanitizeLegacySnapshot(legacySnapshot));
        this.insertAuditEvent({
          action: 'legacy_config_imported',
          entity_type: 'application',
          status: 'SUCCEEDED',
          actor: 'system',
          details: { source: 'config.json' }
        });
        revision = 1;
        this.database.prepare('UPDATE app_state SET revision = ? WHERE id = 1').run(revision);
      }
      const snapshot = this.readSnapshot();
      this.database.exec('COMMIT');
      return { snapshot, revision };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  loadSnapshot() {
    return { snapshot: this.readSnapshot(), revision: this.revision };
  }

  saveSnapshot(snapshot, expectedRevision, event, operations = []) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const currentRevision = this.revision;
      if (currentRevision !== expectedRevision) throw new PersistenceConflict();
      this.replaceSnapshot(sanitizeLegacySnapshot(snapshot, true));
      if (event) this.insertAuditEvent(event);
      for (const operation of operations) this.insertOperation(operation);
      const nextRevision = currentRevision + 1;
      this.database.prepare('UPDATE app_state SET revision = ? WHERE id = 1').run(nextRevision);
      this.database.exec('COMMIT');
      return nextRevision;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  replaceSnapshot(snapshot) {
    const timestamp = now();
    this.database.exec('DELETE FROM accounts; DELETE FROM bots; DELETE FROM identities; DELETE FROM app_settings;');
    const addIdentity = this.database.prepare(
      'INSERT INTO identities (id, data_json, updated_at) VALUES (?, ?, ?)'
    );
    for (const identity of snapshot.identities) {
      addIdentity.run(identity.id, JSON.stringify(encryptIdentityFields(identity, this.piiEncryptionKey)), timestamp);
    }
    const identityIds = new Set(snapshot.identities.map(identity => identity.id));
    const addBot = this.database.prepare(
      'INSERT INTO bots (id, identity_id, data_json, updated_at) VALUES (?, ?, ?, ?)'
    );
    const addAccount = this.database.prepare(
      'INSERT INTO accounts (bot_id, account_id, data_json, updated_at) VALUES (?, ?, ?, ?)'
    );
    for (const bot of snapshot.bots) {
      const botData = { ...bot };
      const accounts = botData.accounts || [];
      delete botData.accounts;
      if (!identityIds.has(botData.identity_id)) botData.identity_id = null;
      addBot.run(botData.id, botData.identity_id, JSON.stringify(botData), timestamp);
      for (const account of accounts) {
        addAccount.run(botData.id, account.id, JSON.stringify(account), timestamp);
      }
    }
    const addSetting = this.database.prepare(
      'INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)'
    );
    for (const key of ['server', 'auth', 'sample_data_version']) {
      if (key === 'sample_data_version' && !Number.isInteger(snapshot.sample_data_version)) continue;
      addSetting.run(key, JSON.stringify(snapshot[key] || {}), timestamp);
    }
    const safeLedger = encryptIdentityFields({ ledger_transactions: snapshot.ledger_transactions || [] }, this.piiEncryptionKey);
    addSetting.run('ledger_transactions', JSON.stringify(safeLedger), timestamp);
  }

  readSnapshot() {
    const settings = Object.fromEntries(this.database.prepare(
      'SELECT key, value_json FROM app_settings'
    ).all().map(row => [row.key, JSON.parse(row.value_json)]));
    const identities = this.database.prepare(
      'SELECT data_json FROM identities ORDER BY rowid'
    ).all().map(row => decryptIdentityFields(JSON.parse(row.data_json), this.piiEncryptionKey));
    const readAccounts = this.database.prepare(
      'SELECT data_json FROM accounts WHERE bot_id = ? ORDER BY rowid'
    );
    const bots = this.database.prepare(
      'SELECT id, identity_id, data_json FROM bots ORDER BY rowid'
    ).all().map(row => ({
      ...JSON.parse(row.data_json),
      identity_id: row.identity_id,
      accounts: readAccounts.all(row.id).map(account => JSON.parse(account.data_json))
    }));
    const savedLedger = settings.ledger_transactions
      ? decryptIdentityFields(settings.ledger_transactions, this.piiEncryptionKey).ledger_transactions || []
      : [];
    return {
      server: settings.server || { host: '127.0.0.1', port: 8000 },
      auth: settings.auth || { role: 'ADMIN_TRADER' },
      ...(Number.isInteger(settings.sample_data_version) ? { sample_data_version: settings.sample_data_version } : {}),
      identities,
      bots,
      ledger_transactions: savedLedger
    };
  }

  insertAuditEvent(event) {
    this.database.prepare(
      'INSERT INTO audit_events ' +
      '(occurred_at, actor, action, entity_type, entity_id, status, details_json) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      event.occurred_at || now(),
      event.actor || 'local',
      event.action,
      event.entity_type || 'application',
      event.entity_id || null,
      event.status || 'SUCCEEDED',
      JSON.stringify(event.details || {})
    );
  }

  insertOperation(operation) {
    this.database.prepare(
      'INSERT INTO operations ' +
      '(id, bot_id, account_id, operation_type, mode, status, occurred_at, details_json, idempotency_key) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      operation.id || randomUUID(),
      operation.bot_id || null,
      operation.account_id || null,
      operation.operation_type,
      operation.mode || 'SIMULATED',
      operation.status || 'SIMULATED',
      operation.occurred_at || now(),
      JSON.stringify(operation.details || {}),
      operation.idempotency_key || null
    );
  }

  hasProcessedSignal(signalId) {
    const prefix = `${signalId}:`;
    return Boolean(this.database.prepare(
      'SELECT 1 FROM operations ' +
      'WHERE idempotency_key IS NOT NULL AND substr(idempotency_key, 1, ?) = ? LIMIT 1'
    ).get(prefix.length, prefix));
  }

  getUser(username) {
    return this.database.prepare(
      'SELECT username, display_name, email, password_hash, role, status, created_at FROM app_users WHERE username = ? COLLATE NOCASE'
    ).get(username) || null;
  }

  listUsers() {
    return this.database.prepare(
      'SELECT username, display_name, email, role, status, created_at FROM app_users ORDER BY created_at, username'
    ).all();
  }

  createUser({ username, displayName = '', email = '', passwordHash, role = 'USER', status = 'PENDING' }) {
    const timestamp = now();
    this.database.prepare(
      'INSERT INTO app_users (username, display_name, email, password_hash, role, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(username, displayName, email, passwordHash, role, status, timestamp, timestamp);
  }

  updateUserPassword(username, passwordHash) {
    return this.database.prepare(
      'UPDATE app_users SET password_hash = ?, updated_at = ? WHERE username = ? COLLATE NOCASE'
    ).run(passwordHash, now(), username).changes;
  }

  updateUserStatus(username, status) {
    return this.database.prepare(
      'UPDATE app_users SET status = ?, updated_at = ? WHERE username = ? COLLATE NOCASE'
    ).run(status, now(), username).changes;
  }

  updateUserRole(username, role) {
    return this.database.prepare(
      'UPDATE app_users SET role = ?, updated_at = ? WHERE username = ? COLLATE NOCASE'
    ).run(role, now(), username).changes;
  }

  deleteUser(username) {
    return this.database.prepare('DELETE FROM app_users WHERE username = ? COLLATE NOCASE').run(username).changes;
  }

  countActiveAdmins() {
    return this.database.prepare(
      "SELECT COUNT(*) AS count FROM app_users WHERE role = 'ADMIN' AND status = 'ACTIVE'"
    ).get().count;
  }

  close() {
    this.database.close();
  }
}

module.exports = {
  PersistenceConflict,
  SQLiteStore,
  sanitizeLegacySnapshot,
  parseIdentityKey,
  encryptIdentityFields,
  decryptIdentityFields
};
