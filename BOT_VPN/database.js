const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');

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
      ['id', 'full_name', 'alias', 'country', 'city', 'flag', 'kyc_status', 'email', 'notes']
        .filter(key => Object.hasOwn(identity, key))
        .map(key => [key, identity[key]])
    ));
  const bots = (Array.isArray(snapshot.bots) ? snapshot.bots : [])
    .filter(bot => bot && typeof bot.id === 'string')
    .map(bot => {
      const safeBot = Object.fromEntries(
        [
          'id', 'name', 'identity_id', 'strategy', 'outbound_ip', 'proxy_port',
          'isp_provider', 'node_location', 'geo_match_status', 'status',
          'jitter_min_ms', 'jitter_max_ms', 'jitter_ms', 'schedule', 'circuit_breaker',
          'net_pnl', 'today_pnl', 'total_trades', 'winning_trades',
          'losing_trades', 'max_drawdown', 'logs'
        ]
          .filter(key => Object.hasOwn(bot, key))
          .map(key => [key, bot[key]])
      );
      safeBot.proxy_url = sanitizeProxyUrl(bot.proxy_url);
      safeBot.accounts = (Array.isArray(bot.accounts) ? bot.accounts : [])
        .filter(account => account && typeof account.id === 'string')
        .map(account => {
          const safeAccount = Object.fromEntries(
            [
              'id', 'custom_name', 'broker', 'prop_firm', 'balance',
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
          safeAccount.password_masked = '••••••••';
          safeAccount.status = 'NOT_CONFIGURED';
          return safeAccount;
        });
      return safeBot;
    });
  const server = snapshot.server && typeof snapshot.server === 'object' ? snapshot.server : {};
  const auth = snapshot.auth && typeof snapshot.auth === 'object' ? snapshot.auth : {};
  return {
    server: { host: '127.0.0.1', port: server.port || 8000 },
    auth: { role: auth.role || 'ADMIN_TRADER' },
    identities,
    bots
  };
}

class SQLiteStore {
  constructor(databasePath = process.env.BOT_VPN_DB_PATH || path.join(__dirname, 'bot_vpn.sqlite3')) {
    this.databasePath = databasePath;
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
    const migrationDirectory = path.join(__dirname, 'migrations');
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
      addIdentity.run(identity.id, JSON.stringify(identity), timestamp);
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
    for (const key of ['server', 'auth']) {
      addSetting.run(key, JSON.stringify(snapshot[key] || {}), timestamp);
    }
  }

  readSnapshot() {
    const settings = Object.fromEntries(this.database.prepare(
      'SELECT key, value_json FROM app_settings'
    ).all().map(row => [row.key, JSON.parse(row.value_json)]));
    const identities = this.database.prepare(
      'SELECT data_json FROM identities ORDER BY rowid'
    ).all().map(row => JSON.parse(row.data_json));
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
    return {
      server: settings.server || { host: '127.0.0.1', port: 8000 },
      auth: settings.auth || { role: 'ADMIN_TRADER' },
      identities,
      bots
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

  close() {
    this.database.close();
  }
}

module.exports = { PersistenceConflict, SQLiteStore, sanitizeLegacySnapshot };
