const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { promisify } = require('node:util');
const { AsyncLocalStorage } = require('node:async_hooks');
const { WebSocketServer } = require('ws');
const { SQLiteStore } = require('./database');
const { NeonStore } = require('./neon-store');
const { applySampleData } = require('./sample-data');
const { getCandles } = require('../marketData');
const projectRoot = path.resolve(__dirname, '..', '..');

// Cargar .env de forma segura
const envFile = path.join(projectRoot, '.env');
if (fs.existsSync(envFile)) {
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envFile);
    } else {
      const envLines = fs.readFileSync(envFile, 'utf-8').split(/\r?\n/);
      for (const line of envLines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const idx = trimmed.indexOf('=');
          const k = trimmed.slice(0, idx).trim();
          const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
          if (!process.env[k]) process.env[k] = v;
        }
      }
    }
  } catch (e) {
    console.warn('[WARN] Error cargando .env:', e.message);
  }
}
const {
  TIMEFRAMES,
  STRATEGIES,
  parseCsv,
  analyzeDataset,
  simulateHistoricalTrades,
  buildChartData
} = require('./market_analysis');

const app = express();
const server = http.createServer(app);
const isVercel = Boolean(process.env.VERCEL);
const requestContext = new AsyncLocalStorage();
let cloudStore = null;
let cloudReady = Promise.resolve();
let cloudRequestQueue = Promise.resolve();
let cloudLedgerTransactions = null;
const PORT = Number(process.env.PORT || 3008);
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const scryptAsync = promisify(crypto.scrypt);
const LOGIN_WINDOW_MS = Number(process.env.BOT_VPN_LOGIN_WINDOW_MS || 1000);
const LOGIN_MAX_ATTEMPTS = 5;
const sessions = new Map();
const loginAttempts = new Map();
const analysisDatasets = new Map();
let latestAnalysisResults = [];
const DEFAULT_ANALYSIS_TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
const DEMO_RISK_DEFAULTS = {
  max_contracts_per_account: 1,
  max_total_contracts: 2,
  max_orders_per_day: 3,
  daily_loss_per_account: 50,
  daily_loss_global: 100,
  max_exposure: 100000
};

function riskLimitFromEnvironment(name, defaultValue, integer = false) {
  const rawValue = process.env[name];
  if (rawValue === undefined) return defaultValue;
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} debe ser un límite numérico positivo.`);
  }
  return value;
}

const DEMO_RISK_LIMITS = {
  max_contracts_per_account: riskLimitFromEnvironment(
    'BOT_VPN_SIM_MAX_CONTRACTS_PER_ACCOUNT',
    DEMO_RISK_DEFAULTS.max_contracts_per_account,
    true
  ),
  max_total_contracts: riskLimitFromEnvironment(
    'BOT_VPN_SIM_MAX_TOTAL_CONTRACTS',
    DEMO_RISK_DEFAULTS.max_total_contracts,
    true
  ),
  max_orders_per_day: riskLimitFromEnvironment(
    'BOT_VPN_SIM_MAX_ORDERS_PER_DAY',
    DEMO_RISK_DEFAULTS.max_orders_per_day,
    true
  ),
  daily_loss_per_account: riskLimitFromEnvironment(
    'BOT_VPN_SIM_DAILY_LOSS_PER_ACCOUNT',
    DEMO_RISK_DEFAULTS.daily_loss_per_account
  ),
  daily_loss_global: riskLimitFromEnvironment(
    'BOT_VPN_SIM_DAILY_LOSS_GLOBAL',
    DEMO_RISK_DEFAULTS.daily_loss_global
  ),
  max_exposure: riskLimitFromEnvironment(
    'BOT_VPN_SIM_MAX_EXPOSURE',
    DEMO_RISK_DEFAULTS.max_exposure
  )
};
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('PORT debe ser un número entero entre 1 y 65535.');
}

app.use(express.json({ limit: '32kb' }));

function applyLoadedSnapshot(snapshot, revision) {
  persistenceRevision = revision;
  configData = {
    ...snapshot,
    server: { host: '127.0.0.1', port: PORT },
    auth: {
      username: process.env.BOT_VPN_AUTH_USERNAME || (snapshot.auth && snapshot.auth.username) || '',
      password: process.env.BOT_VPN_AUTH_PASSWORD || (snapshot.auth && snapshot.auth.password) || '',
      role: snapshot.auth?.role || 'ADMIN_TRADER'
    }
  };
  identities = configData.identities || [];
  bots = (configData.bots || []).map(toRuntimeBot);
  if (Array.isArray(snapshot.ledger_transactions)) cloudLedgerTransactions = snapshot.ledger_transactions;
}

function acquireCloudRequest() {
  const previous = cloudRequestQueue;
  let release;
  cloudRequestQueue = new Promise(resolve => { release = resolve; });
  return previous.then(() => release);
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
    return '[configured]';
  }
}

function isValidId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

const IDENTITY_FIELD_LIMITS = {
  full_name: 160, alias: 160, country: 2, city: 120, province: 120,
  postal_code: 24, address: 240, email: 254, phone_country_code: 6, phone_country_iso: 2,
  phone: 48, dni: 48, crypto_wallet_name: 100, crypto_network: 80,
  crypto_wallet_address: 240, crypto_transfer_alias: 160, card_brand: 40,
  card_last4: 4, payment_provider: 80, payment_reference: 200, notes: 1000
};

function validateIdentityFields(data) {
  for (const [field, maxLength] of Object.entries(IDENTITY_FIELD_LIMITS)) {
    if (!Object.hasOwn(data, field)) continue;
    const value = data[field];
    if (typeof value !== 'string' || value.length > maxLength) return `${field} tiene un formato o longitud inválidos.`;
    if (field === 'country' && value && !/^[A-Z]{2}$/.test(value)) return 'El país debe usar un código ISO de 2 letras (por ejemplo AR).';
    if (field === 'phone_country_code' && value && !/^\+\d{1,4}$/.test(value)) return 'El código telefónico debe incluir + y de 1 a 4 dígitos.';
    if (field === 'phone_country_iso' && value && !/^[A-Z]{2}$/.test(value)) return 'Selecciona un país válido para el teléfono.';
    if (field === 'phone' && value && !/^[+\d\s().-]+$/.test(value)) return 'El número de teléfono contiene caracteres inválidos.';
    if (field === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'El correo electrónico no es válido.';
    if (field === 'card_last4' && value && !/^\d{4}$/.test(value)) return 'Guarda solo los últimos 4 dígitos de la tarjeta.';
  }
  for (const field of ['card_exp_month', 'card_exp_year']) {
    if (!Object.hasOwn(data, field) || data[field] === '' || data[field] === null) continue;
    const value = Number(data[field]);
    const valid = Number.isInteger(value) && (field === 'card_exp_month'
      ? value >= 1 && value <= 12
      : value >= new Date().getFullYear() && value <= new Date().getFullYear() + 25);
    if (!valid) return 'La fecha de vencimiento de la tarjeta no es válida.';
  }
  return null;
}

function isValidTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isValidTimeZone(value) {
  if (typeof value !== 'string' || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validAnalysisTimeframes(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.length <= Object.keys(TIMEFRAMES).length
    && new Set(value).size === value.length
    && value.every(timeframe => Object.hasOwn(TIMEFRAMES, timeframe));
}

function secureEqual(value, expected) {
  if (typeof value !== 'string' || typeof expected !== 'string') return false;
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return valueBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(valueBuffer, expectedBuffer);
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  return scryptAsync(password, salt, 64).then(hash => `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`);
}

async function passwordMatches(password, encoded) {
  if (typeof encoded !== 'string') return false;
  const [algorithm, saltHex, hashHex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/i.test(saltHex || '') || !/^[a-f0-9]{128}$/i.test(hashHex || '')) return false;
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(actual, Buffer.from(hashHex, 'hex'));
}

function authStore() { return isVercel ? cloudStore : database; }

async function createBootstrapUser(store, account) {
  try {
    await store.createUser(account);
  } catch (error) {
    if (error?.code === '23505' || error?.code?.startsWith('SQLITE_CONSTRAINT')) {
      if (await store.getUser(account.username)) return;
    }
    throw error;
  }
}

async function initializeUserAccounts(store, cloud = false) {
  const legacyUsername = configData.auth.username;
  const legacyPassword = configData.auth.password;
  const adminUsername = (process.env.BOT_VPN_ADMIN_USERNAME || 'V8').trim();
  const adminPassword = process.env.BOT_VPN_ADMIN_PASSWORD;
  if (adminPassword && adminPassword.length < 12) {
    console.error('No se creó el usuario administrador: BOT_VPN_ADMIN_PASSWORD debe tener al menos 12 caracteres.');
    return;
  }
  if (legacyUsername && legacyPassword && legacyUsername.toLowerCase() !== adminUsername.toLowerCase()
    && !await store.getUser(legacyUsername)) {
    await createBootstrapUser(store, {
      username: legacyUsername,
      passwordHash: await passwordHash(legacyPassword),
      role: cloud && adminPassword ? 'USER' : 'ADMIN',
      status: 'ACTIVE'
    });
  }
  if (cloud && adminPassword && legacyUsername && legacyUsername.toLowerCase() !== adminUsername.toLowerCase()) {
    await store.updateUserRole(legacyUsername, 'USER');
  }
  if (adminPassword) {
    const adminAccount = await store.getUser(adminUsername);
    if (!adminAccount) {
      await createBootstrapUser(store, {
        username: adminUsername,
        passwordHash: await passwordHash(adminPassword),
        role: 'ADMIN',
        status: 'ACTIVE'
      });
    } else {
      if (!await passwordMatches(adminPassword, adminAccount.password_hash)) {
        const updated = await store.updateUserPassword(adminUsername, await passwordHash(adminPassword));
        if (!updated) throw new Error('No se pudo sincronizar la contraseña del administrador.');
      }
      if (adminAccount.role !== 'ADMIN') await store.updateUserRole(adminUsername, 'ADMIN');
      if (adminAccount.status !== 'ACTIVE') await store.updateUserStatus(adminUsername, 'ACTIVE');
    }
  }
  const sampleUsers = [
    { username: 'lucas.romero', displayName: 'Luciano Romero', email: 'luciano.romero@example.com', status: 'ACTIVE' },
    { username: 'camila.torres', displayName: 'Camila Torres', email: 'camila.torres@example.com', status: 'ACTIVE' },
    { username: 'martin.silva', displayName: 'Martín Silva', email: 'martin.silva@example.com', status: 'PENDING' },
    { username: 'sofia.mendez', displayName: 'Sofía Méndez', email: 'sofia.mendez@example.com', status: 'PENDING' },
    { username: 'nicolas.vega', displayName: 'Nicolás Vega', email: 'nicolas.vega@example.com', status: 'FROZEN' }
  ];
  for (const sampleUser of sampleUsers) {
    if (!await store.getUser(sampleUser.username)) {
      await createBootstrapUser(store, {
        ...sampleUser,
        passwordHash: await passwordHash(crypto.randomBytes(32).toString('base64url')),
        role: 'USER'
      });
    }
  }
}

let userStoreReady = Promise.resolve();

function requireAdmin(req, res, next) {
  if (req.authUser?.role !== 'ADMIN') return res.status(403).json({ detail: 'Se requieren permisos de administración.' });
  next();
}

function ownerMatchesRequest(req, record) {
  if (req.authUser?.role === 'ADMIN') return true;
  const owner = record?.owner_username;
  return Boolean(owner && req.authUser?.username
    && owner.toLowerCase() === req.authUser.username.toLowerCase());
}

function visibleIdentities(req) {
  return identities.filter(identity => ownerMatchesRequest(req, identity));
}

function visibleBots(req) {
  return bots.filter(bot => ownerMatchesRequest(req, bot));
}

function findVisibleIdentity(req, identityId) {
  return identities.find(identity => identity.id === identityId && ownerMatchesRequest(req, identity)) || null;
}

function findVisibleBot(req, botId) {
  return bots.find(bot => bot.id === botId && ownerMatchesRequest(req, bot)) || null;
}

function visibleChartMarkers(req) {
  return chartExecutionMarkers.filter(marker => !marker.owner_username
    || ownerMatchesRequest(req, { owner_username: marker.owner_username }));
}

function hasValidSessionToken(token, refreshActivity = true) {
  if (typeof token !== 'string' || token.length > 256) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  if (refreshActivity) session.expiresAt = Date.now() + SESSION_TTL_MS;
  return true;
}

function getBearerToken(req) {
  const authorization = req.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  return match ? match[1] : '';
}

function revokeSession(token) {
  sessions.delete(token);
  wss.clients.forEach(client => {
    if (client.sessionToken === token) client.close(4401, 'Session revoked');
  });
}

function loginRateLimit(req, res, next) {
  const now = Date.now();
  for (const [ip, attempt] of loginAttempts) {
    if (attempt.windowStartedAt + LOGIN_WINDOW_MS <= now) loginAttempts.delete(ip);
  }
  const key = req.socket.remoteAddress || 'unknown';
  const current = loginAttempts.get(key);
  if (!current || current.windowStartedAt + LOGIN_WINDOW_MS <= now) {
    loginAttempts.set(key, { count: 0, windowStartedAt: now });
  }
  const attempt = loginAttempts.get(key);
  if (attempt.count >= LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ detail: 'Demasiados intentos. Espera unos segundos e intenta nuevamente.' });
  }
  next();
}

function registrationRateLimit(req, res, next) {
  loginRateLimit(req, res, error => {
    if (error) return next(error);
    const attempt = loginAttempts.get(req.socket.remoteAddress || 'unknown');
    attempt.count += 1;
    next();
  });
}

app.use('/api', async (req, res, next) => {
  try {
    await userStoreReady;
  } catch (error) {
    return next(error);
  }
  if (isVercel) {
    let release;
    try {
      await cloudReady;
      release = await acquireCloudRequest();
      const loaded = await cloudStore.load();
      loadConfig(loaded.snapshot, loaded.revision);
      if (Array.isArray(cloudLedgerTransactions)) ledgerTransactions = cloudLedgerTransactions;
      res.locals.cloudRevision = loaded.revision;

      let released = false;
      const releaseOnce = () => {
        if (released) return;
        released = true;
        release();
      };
      res.once('finish', releaseOnce);
      res.once('close', releaseOnce);
      const originalEnd = res.end.bind(res);
      let endStarted = false;
      res.end = (...args) => {
        if (endStarted) return res;
        endStarted = true;
        const pendingSave = res.locals.cloudSavePromise;
        if (!pendingSave) {
          releaseOnce();
          return originalEnd(...args);
        }
        pendingSave.then(() => {
          releaseOnce();
          originalEnd(...args);
        }).catch(error => {
          releaseOnce();
          console.error('No se pudo persistir el estado cloud.');
          if (res.headersSent) return;
          res.statusCode = error.statusCode === 409 ? 409 : 503;
          res.removeHeader('Content-Length');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          originalEnd(JSON.stringify({ detail: error.statusCode === 409
            ? 'Los datos cambiaron en otra solicitud. Reintenta la operación.'
            : 'No se pudo guardar el estado persistido.' }));
        });
        return res;
      };
      if (!['/auth/login', '/auth/me', '/auth/register', '/webhook'].includes(req.path)) {
        const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '');
        const session = match ? await cloudStore.getSession(match[1]) : null;
        if (!session) return res.status(401).json({ detail: 'Autenticación requerida.' });
        const account = await cloudStore.getUser(session.username);
        if (!account || account.status !== 'ACTIVE') {
          await cloudStore.deleteSession(match[1]);
          return res.status(401).json({ detail: 'La cuenta no está activa.' });
        }
        session.role = account.role;
        req.authUser = { username: account.username, role: account.role };
        sessions.set(match[1], session);
      }
      return requestContext.run(res, () => next());
    } catch (error) {
      if (release) release();
      console.error('Cloud API initialization failed.', {
        name: error?.name || 'Error',
        code: typeof error?.code === 'string' ? error.code : undefined,
        message: typeof error?.message === 'string'
          ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[redacted]')
          : undefined,
        stack: typeof error?.stack === 'string' ? error.stack.split('\n').slice(1, 5).join(' ') : undefined
      });
      return next(error);
    }
  }

  if (req.path === '/auth/login' || req.path === '/auth/me' || req.path === '/auth/register' || req.path === '/webhook') {
    return next();
  }

  const authorization = req.get('authorization') || '';
  const match = /^Bearer (.+)$/i.exec(authorization);
  let valid = Boolean(match && hasValidSessionToken(match[1]));
  if (isVercel && match) {
    try {
      const session = await cloudStore.getSession(match[1]);
      valid = Boolean(session);
      if (session) sessions.set(match[1], session);
    } catch (error) {
      return next(error);
    }
  }
  if (!valid) {
    return res.status(401).json({ detail: 'Autenticación requerida.' });
  }
  try {
    const account = await database.getUser(sessions.get(match[1]).username);
    if (!account || account.status !== 'ACTIVE') {
      revokeSession(match[1]);
      return res.status(401).json({ detail: 'La cuenta no está activa.' });
    }
    req.authUser = { username: account.username, role: account.role };
    refreshConfigIfChanged();
    next();
  } catch (error) {
    next(error);
  }
});

// Ruta a la carpeta estática 'public'
const publicPath = path.join(projectRoot, 'public');
app.use('/static', express.static(publicPath));
app.use(express.static(publicPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

app.get('/demo-mode', (req, res) => {
  res.json({ isDemo: isVercel });
});

// ======================================================================
// ESTADO EN MEMORIA Y TELEMETRÍA (QUANTUM FX)
// ======================================================================

const configFile = path.join(projectRoot, 'config.json');
const database = new SQLiteStore(isVercel
  ? ':memory:'
  : (process.env.BOT_VPN_DB_PATH || path.join(projectRoot, 'bot_vpn.sqlite3')));
let persistenceRevision = 0;
let configData = {
  server: { port: PORT },
  auth: {},
  identities: [],
  bots: []
};
let identities = [];
let bots = [];

function toRuntimeBot(b) {
  const ident = identities.find(i => i.id === b.identity_id
    && (!b.owner_username || i.owner_username?.toLowerCase() === b.owner_username.toLowerCase())) || null;
  return {
    id: b.id,
    owner_username: b.owner_username || '',
    record_source: b.record_source || '',
    name: b.name,
    strategy: b.strategy,
    analysis_symbol: ['NQ', 'ES'].includes(b.analysis_symbol) ? b.analysis_symbol : 'NQ',
    analysis_timeframes: validAnalysisTimeframes(b.analysis_timeframes)
      ? [...b.analysis_timeframes]
      : [...DEFAULT_ANALYSIS_TIMEFRAMES],
    strategy_description: 'Estrategia algorítmica optimizada para CME MNQ',
    identity: ident,
    proxy_url: b.proxy_url || '',
    outbound_ip: b.outbound_ip || '',
    proxy_port: b.proxy_port || 10808,
    isp_provider: b.isp_provider || (b.id === 'bot_1' ? 'Comcast Cable Communications (Residential ISP)' : b.id === 'bot_2' ? 'AT&T Corp (Residential ISP)' : b.id === 'bot_3' ? 'Charter Communications / Spectrum' : 'Comcast Business (US Residential)'),
    node_location: b.node_location || (b.id === 'bot_1' ? 'New York, NY (US East Node)' : b.id === 'bot_2' ? 'Chicago, IL (Near CME Data Center)' : b.id === 'bot_3' ? 'Secaucus, NJ (NY4 Equinix Facility)' : 'Chicago, IL (CME Cermak)'),
    geo_match_status: 'GEO-MATCH OK (US Nodo Residencial)',
    proxy_ip: b.outbound_ip || (b.id === 'bot_1' ? '198.51.100.22' : b.id === 'bot_2' ? '198.51.100.45' : b.id === 'bot_3' ? '198.51.100.78' : '198.51.100.91'),
    proxy_ping_ms: b.proxy_ping_ms || Number((11.5 + Math.random() * 3.5).toFixed(1)),
    proxy_healthy: true,
    geo_consistent: true,
    geo_description: 'Geolocalización consistente con titular KYC (US)',
    status: b.status || 'ACTIVE',
    circuit_breaker: b.circuit_breaker || {
      daily_loss_limit: 1000.0,
      consistency_target: 150.0,
      auto_lock_consistency: true,
      pause_on_red_news: true,
      status: 'NORMAL'
    },
    gate_engine: b.gate_engine || {
      block_ny_open: Boolean(b.block_ny_open),
      block_red_news: Boolean(b.block_red_news)
    },
    risk_parameters: b.risk_parameters || {
      min_rr_ratio: Number(b.min_rr_ratio) || 2.0,
      auto_position_sizing: b.auto_position_sizing !== undefined ? Boolean(b.auto_position_sizing) : true,
      risk_per_trade_usd: Number(b.risk_per_trade_usd) || 150.0,
      stop_loss_points: Number(b.stop_loss_points) || 15.0
    },
    schedule: b.schedule || { start_time: '09:30', end_time: '12:00', timezone: 'America/New_York' },
    accounts: (b.accounts || []).map(a => ({
      id: a.id,
      custom_name: a.custom_name,
      titular_name: a.titular_name || (ident ? ident.full_name : 'Titular'),
      environment: a.environment || 'EVALUATION',
      broker: a.broker || 'Tradovate',
      prop_firm: a.prop_firm || 'Apex Trader Funding',
      username: a.username || '',
      password_masked: '',
      balance: a.balance ?? 50000.0,
      max_contracts: a.max_contracts ?? 2,
      daily_loss_limit: a.daily_loss_limit ?? 1000.0,
      daily_pnl: a.daily_pnl || 0.0,
      orders_today: a.orders_today || 0,
      daily_metrics_date: a.daily_metrics_date || new Date().toISOString().slice(0, 10),
      floating_pnl: a.floating_pnl || 0.0,
      realized_pnl: a.realized_pnl || 0.0,
      active_contracts: a.active_contracts || 0,
      current_position: a.current_position || 'FLAT',
      entry_price: a.entry_price || 0.0,
      status: 'NOT_CONFIGURED',
      last_order_time: a.last_order_time || null
    })),
    net_pnl: b.net_pnl || 0.0,
    today_pnl: b.today_pnl || 0.0,
    today_pnl_date: b.today_pnl_date || new Date().toISOString().slice(0, 10),
    consistency_pct: 0.0,
    total_trades: b.total_trades || 0,
    winning_trades: b.winning_trades || 0,
    losing_trades: b.losing_trades || 0,
    win_rate: 0.0,
    max_drawdown: b.max_drawdown || 0.0,
    total_active_contracts: 0,
    execution_count: 0,
    logs: [
      {
        timestamp: new Date().toLocaleTimeString(),
        level: 'INFO',
        message: `Bot inicializado // Titular: ${ident ? 'Asignado' : 'Sin asignar'}`
      }
    ]
  };
}

function checkAntiHedging(bot, requestedSide) {
  const identId = bot.identity ? bot.identity.id : (bot.identity_id || null);
  if (!identId) return { allowed: true };

  const isBuy = requestedSide.toUpperCase() === 'BUY';
  const opposingPosition = isBuy ? 'SHORT' : 'LONG';

  // Buscar todos los bots vinculados a la MISMA identidad
  const sameIdentityBots = bots.filter(b => b.owner_username?.toLowerCase() === bot.owner_username?.toLowerCase()
    && ((b.identity && b.identity.id === identId) || (b.identity_id === identId)));

  for (const b of sameIdentityBots) {
    for (const acc of (b.accounts || [])) {
      if (acc.current_position === opposingPosition && (acc.active_contracts || 0) > 0) {
        return {
          allowed: false,
          identityId: identId,
          identityName: bot.identity ? bot.identity.full_name : 'Titular',
          opposingBotId: b.id,
          opposingBotName: b.name,
          opposingAccountName: acc.custom_name,
          opposingPosition: opposingPosition
        };
      }
    }
  }
  return { allowed: true };
}

function checkGateEngine(bot) {
  if (!bot.gate_engine) return { open: true };

  // 1. Bloqueo de apertura NY 09:30 - 09:45 EST (Configurable por el usuario)
  if (bot.gate_engine.block_ny_open) {
    const nyDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const totalMinutes = nyDate.getHours() * 60 + nyDate.getMinutes();
    if (totalMinutes >= 570 && totalMinutes < 585) {
      return {
        open: false,
        reason: 'Apertura volátil de Wall Street (09:30 - 09:45 EST)',
        code: 'GATE_NY_OPEN'
      };
    }
  }

  // 2. Pausa por noticias macroeconómicas rojas CPI/FOMC/NFP (Configurable por el usuario)
  if (bot.gate_engine.block_red_news) {
    if (bot.macro_event_active) {
      return {
        open: false,
        reason: 'Pausa por evento macroeconómico de alto impacto (CPI/FOMC/NFP)',
        code: 'GATE_RED_NEWS'
      };
    }
  }

  return { open: true };
}

function calculatePositionSizing(bot, baseContracts, stopLossPoints = null) {
  if (!bot.risk_parameters || !bot.risk_parameters.auto_position_sizing) {
    const requested = Number(baseContracts);
    return Number.isInteger(requested) && requested > 0 ? requested : 0;
  }
  const slPoints = Number(stopLossPoints ?? bot.risk_parameters.stop_loss_points);
  const riskUsd = Number(bot.risk_parameters.risk_per_trade_usd);
  if (!Number.isFinite(slPoints) || slPoints <= 0 || !Number.isFinite(riskUsd) || riskUsd <= 0) return 0;
  // MNQ: $2.00 por punto ($0.50 por tick)
  const riskPerContract = slPoints * 2.0;
  return Math.floor(riskUsd / riskPerContract);
}

function loadConfig(cloudSnapshot = null, cloudRevision = null) {
  const legacyConfig = fs.existsSync(configFile)
    ? JSON.parse(fs.readFileSync(configFile, 'utf-8'))
    : { server: { port: PORT }, identities: [], bots: [] };
  if (cloudSnapshot) {
    applyLoadedSnapshot(cloudSnapshot, cloudRevision);
    return;
  }
  const loaded = database.loadOrImport(legacyConfig);
  applyLoadedSnapshot(loaded.snapshot, loaded.revision);
}
loadConfig();

async function persistSampleDataIfNeeded() {
  const adminUser = (await authStore().listUsers()).find(user => user.role === 'ADMIN' && user.status === 'ACTIVE');
  const adminUsername = adminUser?.username || process.env.BOT_VPN_ADMIN_USERNAME || 'V8';
  const { snapshot, changed } = applySampleData({
    ...configData,
    identities,
    bots,
    ledger_transactions: ledgerTransactions
  }, adminUsername);
  if (!changed) return;
  if (isVercel) {
    const revision = await cloudStore.save(snapshot, persistenceRevision);
    loadConfig(snapshot, revision);
    ledgerTransactions = snapshot.ledger_transactions;
    cloudLedgerTransactions = snapshot.ledger_transactions;
    return;
  }
  persistenceRevision = database.saveSnapshot(snapshot, persistenceRevision, {
    action: 'sample_data_initialized',
    entity_type: 'application',
    details: { sample_data_version: snapshot.sample_data_version }
  });
  loadConfig(snapshot, persistenceRevision);
  ledgerTransactions = snapshot.ledger_transactions;
}

if (!isVercel) userStoreReady = initializeUserAccounts(database, false).then(persistSampleDataIfNeeded);

if (isVercel) {
  cloudStore = new NeonStore();
  const demoDate = new Date().toISOString().slice(0, 10);
  const initialSnapshot = {
    server: { host: '127.0.0.1', port: PORT },
    auth: { role: configData.auth.role || 'ADMIN_TRADER' },
    identities: [
      {
        id: 'demo_ana', full_name: 'Ana Demo', alias: 'ana_demo', country: 'AR',
        city: 'Ciudad de prueba', province: 'Buenos Aires', postal_code: '0000',
        address: 'Dirección ficticia 100', kyc_status: 'PENDING',
        email: 'ana.demo@example.com', phone: '+54 11 0000-0101', dni: 'DEMO-0001',
        crypto_wallet_name: 'Wallet de muestra A', crypto_network: 'Testnet',
        crypto_wallet_address: 'WALLET-DEMO-0001', crypto_transfer_alias: 'ana-demo',
        notes: 'Perfil ficticio de la maqueta. No corresponde a una persona real.'
      },
      {
        id: 'demo_lucas', full_name: 'Lucas Demo', alias: 'lucas_demo', country: 'AR',
        city: 'Localidad de prueba', province: 'Córdoba', postal_code: '5000',
        address: 'Dirección ficticia 200', kyc_status: 'PENDING',
        email: 'lucas.demo@example.com', phone: '+54 351 000-0202', dni: 'DEMO-0002',
        crypto_wallet_name: 'Wallet de muestra B', crypto_network: 'Testnet',
        crypto_wallet_address: 'WALLET-DEMO-0002', crypto_transfer_alias: 'lucas-demo',
        notes: 'Perfil ficticio de la maqueta. No corresponde a una persona real.'
      }
    ],
    bots: [
      {
        id: 'bot_demo_ict', name: 'MNQ ICT Scalper · DEMO', identity_id: 'demo_ana',
        strategy: 'ICTStrategy', analysis_symbol: 'NQ', status: 'ACTIVE',
        schedule: { start_time: '09:30', end_time: '12:00', timezone: 'America/New_York' },
        circuit_breaker: { daily_loss_limit: 400, consistency_target: 150, auto_lock_consistency: true, pause_on_red_news: true, status: 'NORMAL' },
        risk_parameters: { min_rr_ratio: 2, auto_position_sizing: true, risk_per_trade_usd: 50, stop_loss_points: 12 },
        net_pnl: 326.5, today_pnl: 42.5, today_pnl_date: demoDate,
        total_trades: 18, winning_trades: 11, losing_trades: 7, max_drawdown: 85,
        logs: [{ timestamp: '09:42', level: 'INFO', message: 'Actividad simulada para la maqueta.' }],
        accounts: [{ id: 'demo_acc_ict', custom_name: 'Cuenta Demo 50K · A', titular_name: 'Ana Demo', environment: 'EVALUATION', broker: 'Simulado', prop_firm: 'Firma Demo', balance: 50326.5, max_contracts: 2, daily_loss_limit: 400, daily_pnl: 42.5, orders_today: 3, daily_metrics_date: demoDate, floating_pnl: 0, realized_pnl: 326.5, active_contracts: 0, current_position: 'FLAT' }]
      },
      {
        id: 'bot_demo_smt', name: 'MNQ SMT Reversal · DEMO', identity_id: 'demo_lucas',
        strategy: 'SMTStrategy', analysis_symbol: 'NQ', status: 'ACTIVE',
        schedule: { start_time: '10:00', end_time: '13:00', timezone: 'America/New_York' },
        circuit_breaker: { daily_loss_limit: 350, consistency_target: 150, auto_lock_consistency: true, pause_on_red_news: true, status: 'NORMAL' },
        risk_parameters: { min_rr_ratio: 2, auto_position_sizing: true, risk_per_trade_usd: 40, stop_loss_points: 10 },
        net_pnl: 118.25, today_pnl: -12.75, today_pnl_date: demoDate,
        total_trades: 12, winning_trades: 7, losing_trades: 5, max_drawdown: 64,
        logs: [{ timestamp: '10:18', level: 'INFO', message: 'Actividad simulada para la maqueta.' }],
        accounts: [{ id: 'demo_acc_smt', custom_name: 'Cuenta Demo 50K · B', titular_name: 'Lucas Demo', environment: 'EVALUATION', broker: 'Simulado', prop_firm: 'Firma Demo', balance: 50118.25, max_contracts: 2, daily_loss_limit: 350, daily_pnl: -12.75, orders_today: 2, daily_metrics_date: demoDate, floating_pnl: 0, realized_pnl: 118.25, active_contracts: 0, current_position: 'FLAT' }]
      },
      {
        id: 'bot_demo_flow', name: 'MNQ Order Flow · DEMO', identity_id: 'demo_ana',
        strategy: 'OrderFlowStrategy', analysis_symbol: 'NQ', status: 'PAUSED',
        schedule: { start_time: '09:30', end_time: '11:30', timezone: 'America/New_York' },
        circuit_breaker: { daily_loss_limit: 500, consistency_target: 150, auto_lock_consistency: true, pause_on_red_news: true, status: 'NORMAL' },
        risk_parameters: { min_rr_ratio: 2, auto_position_sizing: true, risk_per_trade_usd: 35, stop_loss_points: 10 },
        net_pnl: 204, today_pnl: 24, today_pnl_date: demoDate,
        total_trades: 9, winning_trades: 6, losing_trades: 3, max_drawdown: 39,
        logs: [{ timestamp: '11:06', level: 'INFO', message: 'Bot pausado en datos ficticios de demostración.' }],
        accounts: [{ id: 'demo_acc_flow', custom_name: 'Cuenta Demo 25K · C', titular_name: 'Ana Demo', environment: 'EVALUATION', broker: 'Simulado', prop_firm: 'Firma Demo', balance: 25204, max_contracts: 1, daily_loss_limit: 250, daily_pnl: 24, orders_today: 1, daily_metrics_date: demoDate, floating_pnl: 0, realized_pnl: 204, active_contracts: 0, current_position: 'FLAT' }]
      }
    ],
    ledger_transactions: [
      { id: 'demo_tx_01', date: demoDate, identity_id: 'demo_ana', identity_name: 'Ana Demo', account_name: 'Cuenta Demo 50K · A', prop_firm: 'Firma Demo', type: 'INVESTMENT_EVAL', amount: -75, status: 'COMPLETED', notes: 'Movimiento ficticio de demostración.' },
      { id: 'demo_tx_02', date: demoDate, identity_id: 'demo_lucas', identity_name: 'Lucas Demo', account_name: 'Cuenta Demo 50K · B', prop_firm: 'Firma Demo', type: 'PROP_FIRM_PAYOUT', amount: 240, status: 'COMPLETED', notes: 'Movimiento ficticio de demostración.' }
    ]
  };
  cloudReady = cloudStore.initialize(initialSnapshot).then(({ snapshot, revision }) => {
    loadConfig(snapshot, revision);
    ledgerTransactions = cloudLedgerTransactions || [];
  }).then(() => initializeUserAccounts(cloudStore, true)).then(persistSampleDataIfNeeded);
  userStoreReady = cloudReady;
}

let marketPrice = 28245.50;

// ======================================================================
// 1. MOTOR DE VELAS DE MERCADO (CME MNQ) & MARCADORES
// ======================================================================

const marketCandles = [];
const chartExecutionMarkers = [];

function initMarketCandles() {
  const nowSec = Math.floor(Date.now() / 1000);
  let basePrice = 28240.00;
  for (let i = 120; i >= 1; i--) {
    const time = nowSec - (i * 60);
    const candleDelta = (Math.sin(i / 5) * 4) + ((Math.random() - 0.48) * 3);
    const open = Number(basePrice.toFixed(2));
    const close = Number((basePrice + candleDelta).toFixed(2));
    const high = Number((Math.max(open, close) + Math.random() * 2.5).toFixed(2));
    const low = Number((Math.min(open, close) - Math.random() * 2.5).toFixed(2));
    const volume = Math.floor(40 + Math.random() * 120);
    marketCandles.push({ time, open, high, low, close, volume });
    basePrice = close;
  }
  marketPrice = basePrice;

  if (marketCandles.length > 30) {
    chartExecutionMarkers.push({
      time: marketCandles[marketCandles.length - 25].time,
      position: 'belowBar',
      color: '#00E676',
      shape: 'arrowUp',
      text: 'Bot 1 (ICT): BUY @ ' + marketCandles[marketCandles.length - 25].close
    });
    chartExecutionMarkers.push({
      time: marketCandles[marketCandles.length - 12].time,
      position: 'aboveBar',
      color: '#FF5252',
      shape: 'arrowDown',
      text: 'Bot 2 (SMT): SELL @ ' + marketCandles[marketCandles.length - 12].close
    });
  }
}
initMarketCandles();

// Sincronización asíncrona con el proveedor de mercado en tiempo real
getCandles('MNQ', '1m', 120).then(res => {
  if (res.candles && res.candles.length) {
    marketCandles.length = 0;
    marketCandles.push(...res.candles);
    marketPrice = res.candles[res.candles.length - 1].close;
  }
}).catch(err => {
  console.warn('[MARKET_DATA] Fallback a velas locales:', err.message);
});

// Sincronización periódica de precio real cada 30 segundos
if (!isVercel) {
  setInterval(async () => {
    try {
      const data = await getCandles('MNQ', '1m', 5);
      if (data.candles && data.candles.length) {
        marketPrice = data.candles[data.candles.length - 1].close;
      }
    } catch (e) {}
  }, 30000);
}

function updateCandleOnTick(price) {
  const nowSec = Math.floor(Date.now() / 1000);
  const currentCandleTime = nowSec - (nowSec % 60);

  if (marketCandles.length === 0) {
    marketCandles.push({
      time: currentCandleTime,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 1
    });
    return;
  }

  const lastCandle = marketCandles[marketCandles.length - 1];
  if (lastCandle.time === currentCandleTime) {
    lastCandle.high = Math.max(lastCandle.high, price);
    lastCandle.low = Math.min(lastCandle.low, price);
    lastCandle.close = price;
    lastCandle.volume += 1;
  } else {
    const newCandle = {
      time: currentCandleTime,
      open: lastCandle.close,
      high: Math.max(lastCandle.close, price),
      low: Math.min(lastCandle.close, price),
      close: price,
      volume: 1
    };
    marketCandles.push(newCandle);
    if (marketCandles.length > 500) {
      marketCandles.shift();
    }
  }
}

// ======================================================================
// 2. CALENDARIO DE NOTICIAS MACRO (FOREXFACTORY FEED)
// ======================================================================

const todayStr = new Date().toISOString().slice(0, 10);
const tomorrowDate = new Date(Date.now() + 86400000);
const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);
const yesterdayDate = new Date(Date.now() - 86400000);
const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

const economicEvents = [
  // USD - ForexFactory High / Medium Impact
  {
    id: 'ff_usd_cpi_1',
    event: 'CPI (Consumer Price Index) m/m',
    currency: 'USD',
    impact: 'HIGH',
    time_est: '08:30 EST',
    date: todayStr,
    forecast: '0.2%',
    previous: '0.2%',
    actual: '0.3%',
    better_worse: 'worse',
    status: 'COMPLETED'
  },
  {
    id: 'ff_usd_core_cpi',
    event: 'Core CPI m/m',
    currency: 'USD',
    impact: 'HIGH',
    time_est: '08:30 EST',
    date: todayStr,
    forecast: '0.3%',
    previous: '0.3%',
    actual: '0.3%',
    better_worse: 'neutral',
    status: 'COMPLETED'
  },
  {
    id: 'ff_usd_fomc_rate',
    event: 'FOMC Statement & Fed Funds Rate',
    currency: 'USD',
    impact: 'HIGH',
    time_est: '14:00 EST',
    date: todayStr,
    forecast: '4.75%',
    previous: '5.00%',
    actual: null,
    better_worse: 'pending',
    status: 'UPCOMING'
  },
  {
    id: 'ff_usd_powell_speech',
    event: 'Fed Chair Powell Press Conference',
    currency: 'USD',
    impact: 'HIGH',
    time_est: '14:30 EST',
    date: todayStr,
    forecast: '-',
    previous: '-',
    actual: null,
    better_worse: 'pending',
    status: 'UPCOMING'
  },
  {
    id: 'ff_usd_nfp_1',
    event: 'Non-Farm Employment Change (NFP)',
    currency: 'USD',
    impact: 'HIGH',
    time_est: '08:30 EST',
    date: tomorrowStr,
    forecast: '150K',
    previous: '254K',
    actual: null,
    better_worse: 'pending',
    status: 'UPCOMING'
  },
  {
    id: 'ff_usd_unemp_rate',
    event: 'Unemployment Rate',
    currency: 'USD',
    impact: 'HIGH',
    time_est: '08:30 EST',
    date: tomorrowStr,
    forecast: '4.1%',
    previous: '4.1%',
    actual: null,
    better_worse: 'pending',
    status: 'UPCOMING'
  },
  {
    id: 'ff_usd_ism_mfg',
    event: 'ISM Manufacturing PMI',
    currency: 'USD',
    impact: 'HIGH',
    time_est: '10:00 EST',
    date: todayStr,
    forecast: '49.5',
    previous: '47.2',
    actual: null,
    better_worse: 'pending',
    status: 'UPCOMING'
  },
  {
    id: 'ff_usd_retail_sales',
    event: 'Retail Sales m/m',
    currency: 'USD',
    impact: 'HIGH',
    time_est: '08:30 EST',
    date: tomorrowStr,
    forecast: '0.3%',
    previous: '0.1%',
    actual: null,
    better_worse: 'pending',
    status: 'UPCOMING'
  },
  {
    id: 'ff_usd_jobless_claims',
    event: 'Initial Jobless Claims (Semanal)',
    currency: 'USD',
    impact: 'MEDIUM',
    time_est: '08:30 EST',
    date: yesterdayStr,
    forecast: '218K',
    previous: '221K',
    actual: '215K',
    better_worse: 'better',
    status: 'COMPLETED'
  },
  {
    id: 'ff_usd_ppi',
    event: 'PPI (Producer Price Index) m/m',
    currency: 'USD',
    impact: 'MEDIUM',
    time_est: '08:30 EST',
    date: yesterdayStr,
    forecast: '0.1%',
    previous: '0.2%',
    actual: '0.0%',
    better_worse: 'better',
    status: 'COMPLETED'
  },
  {
    id: 'ff_usd_crude_oil',
    event: 'Crude Oil Inventories (EIA)',
    currency: 'USD',
    impact: 'LOW',
    time_est: '10:30 EST',
    date: todayStr,
    forecast: '1.2M',
    previous: '-2.1M',
    actual: null,
    better_worse: 'pending',
    status: 'UPCOMING'
  },

  // JPY - ForexFactory Events (solicitado explícitamente "jyt" / JPY)
  {
    id: 'ff_jpy_boj_rate',
    event: 'BOJ Policy Rate',
    currency: 'JPY',
    impact: 'HIGH',
    time_est: '00:00 EST',
    date: todayStr,
    forecast: '0.25%',
    previous: '0.25%',
    actual: '0.25%',
    better_worse: 'neutral',
    status: 'COMPLETED'
  },
  {
    id: 'ff_jpy_boj_statement',
    event: 'Monetary Policy Statement',
    currency: 'JPY',
    impact: 'HIGH',
    time_est: '00:15 EST',
    date: todayStr,
    forecast: '-',
    previous: '-',
    actual: 'Dovish Hold',
    better_worse: 'neutral',
    status: 'COMPLETED'
  },
  {
    id: 'ff_jpy_boj_press',
    event: 'BOJ Press Conference (Governor Ueda)',
    currency: 'JPY',
    impact: 'HIGH',
    time_est: '02:30 EST',
    date: todayStr,
    forecast: '-',
    previous: '-',
    actual: 'Neutral stance',
    better_worse: 'neutral',
    status: 'COMPLETED'
  },
  {
    id: 'ff_jpy_tokyo_cpi',
    event: 'Tokyo Core CPI y/y',
    currency: 'JPY',
    impact: 'HIGH',
    time_est: '19:30 EST',
    date: tomorrowStr,
    forecast: '1.8%',
    previous: '2.0%',
    actual: null,
    better_worse: 'pending',
    status: 'UPCOMING'
  },
  {
    id: 'ff_jpy_trade_balance',
    event: 'Trade Balance',
    currency: 'JPY',
    impact: 'MEDIUM',
    time_est: '19:50 EST',
    date: tomorrowStr,
    forecast: '-0.35T',
    previous: '-0.70T',
    actual: null,
    better_worse: 'pending',
    status: 'UPCOMING'
  },
  {
    id: 'ff_jpy_household_spend',
    event: 'Household Spending m/m',
    currency: 'JPY',
    impact: 'MEDIUM',
    time_est: '19:30 EST',
    date: yesterdayStr,
    forecast: '-0.2%',
    previous: '-0.5%',
    actual: '0.1%',
    better_worse: 'better',
    status: 'COMPLETED'
  },
  {
    id: 'ff_jpy_tertiary_act',
    event: 'Tertiary Industry Activity m/m',
    currency: 'JPY',
    impact: 'LOW',
    time_est: '00:30 EST',
    date: todayStr,
    forecast: '0.1%',
    previous: '-0.3%',
    actual: '0.2%',
    better_worse: 'better',
    status: 'COMPLETED'
  },

  // EUR - ForexFactory Events
  {
    id: 'ff_eur_ecb_rate',
    event: 'ECB Main Refinancing Rate',
    currency: 'EUR',
    impact: 'HIGH',
    time_est: '08:15 EST',
    date: todayStr,
    forecast: '3.40%',
    previous: '3.65%',
    actual: null,
    better_worse: 'pending',
    status: 'UPCOMING'
  },
  {
    id: 'ff_eur_ecb_press',
    event: 'ECB Monetary Policy Statement & Press Conference',
    currency: 'EUR',
    impact: 'HIGH',
    time_est: '08:45 EST',
    date: todayStr,
    forecast: '-',
    previous: '-',
    actual: null,
    better_worse: 'pending',
    status: 'UPCOMING'
  },
  {
    id: 'ff_eur_german_pmi',
    event: 'German Flash Manufacturing PMI',
    currency: 'EUR',
    impact: 'MEDIUM',
    time_est: '03:30 EST',
    date: yesterdayStr,
    forecast: '42.6',
    previous: '40.6',
    actual: '43.0',
    better_worse: 'better',
    status: 'COMPLETED'
  },

  // GBP - ForexFactory Events
  {
    id: 'ff_gbp_boe_rate',
    event: 'BOE Official Bank Rate',
    currency: 'GBP',
    impact: 'HIGH',
    time_est: '07:00 EST',
    date: tomorrowStr,
    forecast: '4.75%',
    previous: '5.00%',
    actual: null,
    better_worse: 'pending',
    status: 'UPCOMING'
  },
  {
    id: 'ff_gbp_cpi_yy',
    event: 'CPI y/y',
    currency: 'GBP',
    impact: 'HIGH',
    time_est: '02:00 EST',
    date: yesterdayStr,
    forecast: '1.7%',
    previous: '2.2%',
    actual: '1.7%',
    better_worse: 'neutral',
    status: 'COMPLETED'
  }
];

// ======================================================================
// 3. LEDGER FINANCIERO Y REPARTO A TITULARES KYC
// ======================================================================

let ledgerTransactions = [];


function getLedgerSummary(identityFilter = null, ownerUsername = null) {
  const ownerKey = ownerUsername?.toLowerCase();
  const scopedIdentities = ownerKey
    ? identities.filter(identity => identity.owner_username?.toLowerCase() === ownerKey)
    : identities;
  const scopedBots = ownerKey
    ? bots.filter(bot => bot.owner_username?.toLowerCase() === ownerKey)
    : bots;
  let txs = ownerKey
    ? ledgerTransactions.filter(transaction => transaction.owner_username?.toLowerCase() === ownerKey)
    : ledgerTransactions;
  if (identityFilter && identityFilter !== 'ALL') {
    txs = txs.filter(t => t.identity_id === identityFilter);
  }

  let totalInvested = 0;
  let totalGrossPayouts = 0;
  let totalPaidToTitulares = 0;

  txs.forEach(t => {
    if (t.type === 'INVESTMENT_EVAL' || t.type === 'INVESTMENT_PA_FEE') {
      totalInvested += Math.abs(t.amount);
    } else if (t.type === 'PROP_FIRM_PAYOUT') {
      totalGrossPayouts += t.amount;
    } else if (t.type === 'TITULAR_SPLIT_PAYOUT') {
      totalPaidToTitulares += Math.abs(t.amount);
    }
  });

  const titularSplitRate = 0.20;

  const identityBreakdown = scopedIdentities.map(ident => {
    const identTxs = txs.filter(t => t.identity_id === ident.id);
    let inv = 0;
    let gross = 0;
    let paid = 0;
    identTxs.forEach(t => {
      if (t.type === 'INVESTMENT_EVAL' || t.type === 'INVESTMENT_PA_FEE') inv += Math.abs(t.amount);
      else if (t.type === 'PROP_FIRM_PAYOUT') gross += t.amount;
      else if (t.type === 'TITULAR_SPLIT_PAYOUT') paid += Math.abs(t.amount);
    });

    // Calcular ganancias en vivo generadas por los bots asignados a este titular
    const identBots = scopedBots.filter(b => b.identity_id === ident.id || (b.identity && b.identity.id === ident.id));
    const liveTradingPnl = identBots.reduce((sum, b) => sum + (Number(b.net_pnl) || 0) + (Number(b.today_pnl) || 0), 0);
    const effectiveGross = Number((gross + Math.max(0, liveTradingPnl)).toFixed(2));
    const share = Number((effectiveGross * titularSplitRate).toFixed(2));
    const pending = Number((share - paid).toFixed(2));
    return {
      identity_id: ident.id,
      identity_name: ident.full_name,
      flag: ident.flag,
      country: ident.country,
      total_invested: inv,
      gross_payouts: effectiveGross,
      live_trading_pnl: Number(liveTradingPnl.toFixed(2)),
      split_rate_pct: 20,
      share_accrued: share,
      paid_to_date: paid,
      pending_payout: pending
    };
  });

  const totalLiveTradingPnl = scopedBots.reduce((sum, b) => sum + (Number(b.net_pnl) || 0) + (Number(b.today_pnl) || 0), 0);
  const effectiveTotalGross = Number((totalGrossPayouts + Math.max(0, totalLiveTradingPnl)).toFixed(2));
  const effectiveTotalTitularShare = Number((effectiveTotalGross * titularSplitRate).toFixed(2));
  const effectivePendingToTitulares = Number((effectiveTotalTitularShare - totalPaidToTitulares).toFixed(2));
  const effectiveOperatorNetProfit = Number((effectiveTotalGross - totalInvested - totalPaidToTitulares).toFixed(2));

  return {
    summary: {
      total_invested: Number(totalInvested.toFixed(2)),
      total_gross_payouts: effectiveTotalGross,
      live_trading_pnl: Number(totalLiveTradingPnl.toFixed(2)),
      total_titular_share: effectiveTotalTitularShare,
      total_paid_to_titulares: Number(totalPaidToTitulares.toFixed(2)),
      pending_to_titulares: effectivePendingToTitulares,
      operator_net_profit: effectiveOperatorNetProfit,
      default_split_pct: 20
    },
    identity_breakdown: identityBreakdown,
    transactions: txs
  };
}

function getAnalysisResultsForConfiguredBots(configuredBots = bots) {
  const results = [];
  const analysisCache = new Map();
  for (const bot of configuredBots) {
    const ownerKey = String(bot.owner_username || '').toLowerCase();
    const ownerDatasets = analysisDatasets.get(ownerKey) || new Map();
    const dataset = ownerDatasets.get(bot.analysis_symbol);
    if (!dataset) continue;
    const pairedSymbol = bot.analysis_symbol === 'NQ' ? 'ES' : 'NQ';
    const pairedDataset = ownerDatasets.get(pairedSymbol) || null;
    for (const timeframe of bot.analysis_timeframes) {
      const cacheKey = `${bot.analysis_symbol}:${bot.strategy}:${timeframe}`;
      if (!analysisCache.has(cacheKey)) {
        const analysis = analyzeDataset(dataset, bot.strategy, timeframe, pairedDataset);
        const backtest = simulateHistoricalTrades(dataset, bot.strategy, timeframe, pairedDataset);
        analysisCache.set(cacheKey, {
          ...analysis,
          chart: buildChartData(dataset, timeframe, backtest.trades[0] || null),
          historical_simulated_trade_count: backtest.total_signals,
          historical_simulation_bars_tested: backtest.bars_tested,
          historical_simulated_trades: backtest.trades
        });
      }
      results.push({
        bot_id: bot.id,
        bot_name: bot.name,
        ...analysisCache.get(cacheKey)
      });
    }
  }
  return results;
}

function saveConfigToDisk(event, operations = []) {
  const snapshot = {
    server: { host: '127.0.0.1', port: PORT },
    auth: { role: configData.auth.role || 'ADMIN_TRADER' },
    sample_data_version: configData.sample_data_version || 0,
    identities,
    ledger_transactions: ledgerTransactions,
    bots: bots.map(b => ({
        id: b.id,
        owner_username: b.owner_username || '',
        record_source: b.record_source || '',
        name: b.name,
        identity_id: b.identity ? b.identity.id : null,
        strategy: b.strategy,
        analysis_symbol: b.analysis_symbol,
        analysis_timeframes: b.analysis_timeframes,
        proxy_url: sanitizeProxyUrl(b.proxy_url),
        status: b.status,
        circuit_breaker: b.circuit_breaker,
        schedule: b.schedule,
        net_pnl: b.net_pnl,
        today_pnl: b.today_pnl,
        today_pnl_date: b.today_pnl_date,
        total_trades: b.total_trades,
        winning_trades: b.winning_trades,
        losing_trades: b.losing_trades,
        max_drawdown: b.max_drawdown,
        accounts: b.accounts.map(account => ({
          ...account,
          record_source: account.record_source || '',
          mode: account.mode || '',
          username: account.username ? '••••' : ''
        }))
      }))
  };
  if (isVercel) {
    const response = requestContext.getStore();
    if (!response) throw new Error('No se encontró el contexto de la solicitud para persistir en Neon.');
    const previousSave = response.locals.cloudSavePromise || Promise.resolve();
    response.locals.cloudSavePromise = previousSave
      .then(() => cloudStore.save(snapshot, response.locals.cloudRevision))
      .then(revision => {
        response.locals.cloudRevision = revision;
        persistenceRevision = revision;
        return revision;
      });
    return;
  }
  try {
    persistenceRevision = database.saveSnapshot(snapshot, persistenceRevision, event || {
      action: 'state_changed',
      entity_type: 'application',
      details: { bot_count: bots.length, identity_count: identities.length }
    }, operations);
  } catch (error) {
    try {
      loadConfig();
    } catch {
      console.error('[ERROR] No se pudo restaurar el estado tras fallar la escritura SQLite.');
    }
    throw error;
  }
}

function refreshConfigIfChanged() {
  if (database.revision !== persistenceRevision) loadConfig();
}

function getNewYorkTimeString() {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(new Date()) + ' EST';
  } catch (e) {
    return new Date().toLocaleTimeString() + ' Local';
  }
}

function getSystemSnapshot(req = null) {
  const scopedIdentities = req ? visibleIdentities(req) : [];
  const scopedBots = req ? visibleBots(req) : [];
  const totalPnl = scopedBots.reduce((sum, b) => sum + (b.net_pnl || 0), 0);
  const activeBotsCount = scopedBots.filter(b => b.status === 'ACTIVE').length;
  const totalContracts = scopedBots.reduce((sum, b) => sum + (b.total_active_contracts || 0), 0);

  return {
    type: 'SNAPSHOT',
    demo_mode: isVercel,
    execution_mode: 'SIMULATED',
    paper_trading_available: false,
    risk_policy: { type: 'DEMO_ONLY', limits: DEMO_RISK_LIMITS },
    market_price_mnq: marketPrice,
    latest_candle: marketCandles.length ? marketCandles[marketCandles.length - 1] : null,
    ny_time: getNewYorkTimeString(),
    global_stats: {
      total_pnl: Number(totalPnl.toFixed(2)),
      active_bots: activeBotsCount,
      total_bots: scopedBots.length,
      total_active_contracts: totalContracts,
      total_identities: scopedIdentities.length
    },
    identities: scopedIdentities,
    bots: scopedBots.map(bot => ({
      ...bot,
      proxy_url: sanitizeProxyUrl(bot.proxy_url),
      accounts: bot.accounts.map(account => ({
        ...account,
        username: account.username ? '••••' : ''
      }))
    }))
  };
}

function resetAccountDailyMetrics(account) {
  const today = new Date().toISOString().slice(0, 10);
  if (account.daily_metrics_date !== today) {
    account.daily_pnl = 0;
    account.orders_today = 0;
    account.daily_metrics_date = today;
  }
}

function resetBotDailyMetrics(bot) {
  const today = new Date().toISOString().slice(0, 10);
  if (bot.today_pnl_date !== today) {
    bot.today_pnl = 0;
    bot.today_pnl_date = today;
  }
}

// ======================================================================
// WEBSOCKET SERVER (/ws)
// ======================================================================

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });

function broadcastSnapshot() {
  wss.clients.forEach(client => {
    if (client.isAuthenticated && client.readyState === 1) {
      if (!hasValidSessionToken(client.sessionToken, false)) {
        client.close(4401, 'Session expired');
      } else {
        client.send(JSON.stringify(getSystemSnapshot({ authUser: client.authUser })));
      }
    }
  });
}

// Simulación de fluctuación de mercado en vivo y reloj NY cada 1 seg
if (!isVercel) setInterval(() => {
  try {
    refreshConfigIfChanged();
  } catch (error) {
    console.error('[ERROR] No se pudo actualizar el estado SQLite.');
  }
  const delta = (Math.random() - 0.49) * 0.75;
  marketPrice = Number((marketPrice + delta).toFixed(2));
  updateCandleOnTick(marketPrice);

  // Actualizar flotante de cuentas activas
  bots.forEach(bot => {
    resetBotDailyMetrics(bot);
    let totalFloat = 0;
    bot.accounts.forEach(acc => {
      resetAccountDailyMetrics(acc);
      if (acc.active_contracts > 0 && acc.current_position !== 'FLAT') {
        const diff = acc.current_position === 'LONG' ? (marketPrice - acc.entry_price) : (acc.entry_price - marketPrice);
        const floatPnl = Number((diff * 2.0 * acc.active_contracts).toFixed(2));
        acc.floating_pnl = floatPnl;
        totalFloat += floatPnl;
      } else {
        acc.floating_pnl = 0.0;
      }
    });
    bot.total_active_contracts = bot.accounts.reduce((s, a) => s + a.active_contracts, 0);

    // Evaluación automática de Circuit Breaker (Consistencia +150$ y DLL)
    if (bot.status === 'ACTIVE' && bot.circuit_breaker) {
      if (bot.circuit_breaker.auto_lock_consistency && bot.today_pnl >= bot.circuit_breaker.consistency_target) {
        bot.status = 'PAUSED';
        bot.circuit_breaker.status = 'LOCKED_PROFIT';
        bot.accounts.forEach(acc => {
          if (acc.active_contracts > 0) {
            acc.active_contracts = 0;
            acc.current_position = 'FLAT';
          }
        });
        const now = new Date().toLocaleTimeString();
        bot.logs.unshift({
          timestamp: now,
          level: 'SUCCESS',
          message: `🎯 CONSISTENCY TARGET ALCANZADO (+$${bot.today_pnl.toFixed(2)}): Bot asegurado a meta de +$${bot.circuit_breaker.consistency_target}. Retiro prop firm protegido.`
        });
      } else if (bot.today_pnl <= -bot.circuit_breaker.daily_loss_limit) {
        bot.status = 'PAUSED';
        bot.circuit_breaker.status = 'TRIPPED_STOP';
        bot.accounts.forEach(acc => {
          if (acc.active_contracts > 0) {
            acc.active_contracts = 0;
            acc.current_position = 'FLAT';
          }
        });
        const now = new Date().toLocaleTimeString();
        bot.logs.unshift({
          timestamp: now,
          level: 'EMERGENCY',
          message: `🔴 CIRCUIT BREAKER ACTIVADO: Pérdida diaria (-$${Math.abs(bot.today_pnl).toFixed(2)}) superó el límite de seguridad ($${bot.circuit_breaker.daily_loss_limit}).`
        });
      }
    }
  });

  broadcastSnapshot();
}, 1000);

wss.on('connection', ws => {
  ws.isAuthenticated = false;
  const authTimeout = setTimeout(() => ws.close(4401, 'Authentication required'), 5000);

  ws.on('message', message => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch {
      ws.close(1008, 'Invalid message');
      return;
    }

    if (!ws.isAuthenticated) {
      if (data.action !== 'AUTH' || !hasValidSessionToken(data.token)) {
        ws.send(JSON.stringify({ type: 'AUTH_ERROR' }));
        ws.close(4401, 'Authentication required');
        return;
      }
      ws.isAuthenticated = true;
      ws.sessionToken = data.token;
      const sessionUser = sessions.get(data.token);
      ws.authUser = sessionUser ? { username: sessionUser.username, role: sessionUser.role } : null;
      clearTimeout(authTimeout);
      try {
        refreshConfigIfChanged();
      } catch {
        ws.close(1011, 'Persistent state unavailable');
        return;
      }
      ws.send(JSON.stringify(getSystemSnapshot({ authUser: ws.authUser })));
      return;
    }

    if (data.action === 'PING') {
      ws.send(JSON.stringify({ type: 'PONG' }));
    }
  });

  ws.on('close', () => clearTimeout(authTimeout));
});

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// ======================================================================
// ENDPOINTS DE LA API (REST)
// ======================================================================

app.get('/api/system/snapshot', (req, res) => {
  res.json(getSystemSnapshot(req));
});

app.get('/api/analysis/status', (req, res) => {
  const scopedBots = visibleBots(req);
  latestAnalysisResults = getAnalysisResultsForConfiguredBots(scopedBots);
  const ownerKeys = req.authUser?.role === 'ADMIN'
    ? new Set(scopedBots.map(bot => String(bot.owner_username || '').toLowerCase()))
    : new Set([String(req.authUser?.username || '').toLowerCase()]);
  const scopedDatasets = new Map();
  for (const ownerKey of ownerKeys) {
    const ownerDatasets = analysisDatasets.get(ownerKey);
    if (!ownerDatasets) continue;
    for (const [symbol, dataset] of ownerDatasets) {
      const key = ownerKeys.size > 1 ? `${ownerKey}:${symbol}` : symbol;
      scopedDatasets.set(key, dataset);
    }
  }
  res.json({
    source: 'CSV histórico importado',
    data_type: 'HISTORICAL',
    datasets: Object.fromEntries([...scopedDatasets].map(([symbol, dataset]) => [
      symbol,
      {
        source_timeframe: dataset.sourceTimeframe,
        source_timezone: dataset.timestampTimeZone,
        candles: dataset.bars.length,
        imported_at: dataset.importedAt
      }
    ])),
    results: latestAnalysisResults
  });
});

app.post(
  '/api/analysis/csv',
  express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }),
  (req, res) => {
    const symbol = req.query.symbol;
    const sourceTimeframe = req.query.timeframe;
    const timestampTimeZone = req.query.timezone || 'UTC';
    let dataset;
    try {
      dataset = parseCsv(req.body, symbol, sourceTimeframe, timestampTimeZone);
    } catch (error) {
      return res.status(400).json({ detail: error.message });
    }

    dataset.importedAt = new Date().toISOString();
    const ownerKey = String(req.authUser?.username || '').toLowerCase();
    if (!analysisDatasets.has(ownerKey)) analysisDatasets.set(ownerKey, new Map());
    analysisDatasets.get(ownerKey).set(symbol, dataset);
    latestAnalysisResults = getAnalysisResultsForConfiguredBots(visibleBots(req));
    return res.json({
      symbol,
      source_timeframe: sourceTimeframe,
      source_timezone: dataset.timestampTimeZone,
      candles: dataset.bars.length,
      imported_at: dataset.importedAt,
      data_type: 'HISTORICAL',
      results: latestAnalysisResults
    });
  }
);

app.get('/healthz', async (req, res, next) => {
  try {
    const persistenceHealthy = isVercel
      ? (await cloudReady, await cloudStore.healthCheck())
      : database.healthCheck();
    if (!persistenceHealthy) {
      return res.status(503).json({
        status: 'unhealthy',
        service: 'node-dashboard',
        mode: 'SIMULATED',
        components: { persistence: 'unavailable' }
      });
    }
    return res.json({
      status: 'healthy',
      service: 'node-dashboard',
      mode: 'SIMULATED',
      components: {
        persistence: 'healthy',
        broker: 'disabled',
        market_data: analysisDatasets.size ? 'historical_csv' : 'simulated'
      }
    });
  } catch (error) {
    if (typeof error.code === 'string' && error.code.startsWith('ERR_SQLITE_')) {
      console.error('[WARN] Health check failed: SQLite is unavailable.');
      return res.status(503).json({
        status: 'unhealthy',
        service: 'node-dashboard',
        mode: 'SIMULATED',
        components: { persistence: 'unavailable' }
      });
    }
    console.error('Health check failed.', {
      name: error?.name || 'Error',
      code: typeof error?.code === 'string' ? error.code : undefined,
      message: typeof error?.message === 'string'
        ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgresql://[redacted]')
        : undefined,
      causeCode: typeof error?.cause?.code === 'string' ? error.cause.code : undefined,
      causeName: typeof error?.cause?.name === 'string' ? error.cause.name : undefined
    });
    return next(error);
  }
});

// Autenticación
app.post('/api/auth/login', loginRateLimit, async (req, res) => {
  const { username, password } = req.body || {};
  await userStoreReady;

  if (typeof username !== 'string' || username.length > 128
    || typeof password !== 'string' || password.length > 1024) {
    return res.status(400).json({ detail: 'Credenciales inválidas.' });
  }
  const account = await authStore().getUser(username.trim());
  if (account && await passwordMatches(password, account.password_hash) && account.status === 'ACTIVE') {
    const key = req.socket.remoteAddress || 'unknown';
    loginAttempts.delete(key);
    for (const [activeToken, session] of sessions) {
      if (session.expiresAt <= Date.now()) sessions.delete(activeToken);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    const session = { username: account.username, role: account.role, expiresAt: Date.now() + SESSION_TTL_MS };
    sessions.set(token, session);
    if (isVercel) await cloudStore.createSession(token, session);
    return res.json({
      status: 'SUCCESS',
      token,
      expires_in: SESSION_TTL_MS / 1000,
      user: { username: account.username, role: account.role }
    });
  }
  const key = req.socket.remoteAddress || 'unknown';
  loginAttempts.get(key).count += 1;
  const detail = account?.status === 'PENDING'
    ? 'La solicitud de cuenta todavía espera aprobación del administrador.'
    : account?.status === 'FROZEN' ? 'La cuenta está congelada. Contacta al administrador.' : 'Usuario o contraseña incorrectos.';
  res.status(401).json({ detail });
});

app.post('/api/auth/register', registrationRateLimit, async (req, res) => {
  await userStoreReady;
  const { username, password } = req.body || {};
  const cleanUsername = typeof username === 'string' ? username.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,31}$/.test(cleanUsername)) {
    return res.status(400).json({ detail: 'El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.' });
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    return res.status(400).json({ detail: 'La contraseña debe tener al menos 12 caracteres.' });
  }
  if (await authStore().getUser(cleanUsername)) return res.status(409).json({ detail: 'Ese nombre de usuario ya está registrado.' });
  try {
    await authStore().createUser({ username: cleanUsername, passwordHash: await passwordHash(password), role: 'USER', status: 'PENDING' });
    return res.status(201).json({ status: 'PENDING', detail: 'Solicitud enviada. El administrador debe aprobar la cuenta.' });
  } catch (error) {
    if (error?.code === '23505' || error?.code?.startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ detail: 'Ese nombre de usuario ya está registrado.' });
    }
    throw error;
  }
});

app.get('/api/auth/me', async (req, res) => {
  await userStoreReady;
  const token = getBearerToken(req);
  const session = isVercel ? await cloudStore.getSession(token) : sessions.get(token);
  const account = session ? await authStore().getUser(session.username) : null;
  if (session && account?.status === 'ACTIVE' && session.expiresAt > Date.now()) {
    sessions.set(token, { ...session, role: account.role });
    if (!isVercel) hasValidSessionToken(token);
    return res.json({ authenticated: true, username: account.username, role: account.role });
  }
  res.status(401).json({ authenticated: false });
});

app.post('/api/auth/logout', async (req, res) => {
  const token = getBearerToken(req);
  revokeSession(token);
  if (isVercel) await cloudStore.deleteSession(token);
  res.sendStatus(204);
});

app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
  await userStoreReady;
  const users = await authStore().listUsers();
  const adminBots = bots;
  const sessionsByUser = isVercel
    ? await cloudStore.countActiveSessionsByUser()
    : [...sessions.values()].filter(session => session.expiresAt > Date.now())
      .reduce((counts, session) => counts.set(session.username, (counts.get(session.username) || 0) + 1), new Map())
      .entries();
  const activeSessions = Array.isArray(sessionsByUser)
    ? sessionsByUser.reduce((sum, entry) => sum + Number(entry.count || 0), 0)
    : [...sessionsByUser].reduce((sum, [, count]) => sum + count, 0);
  res.json({
    total_users: users.length,
    active_users: users.filter(user => user.status === 'ACTIVE').length,
    pending_users: users.filter(user => user.status === 'PENDING').length,
    active_sessions: activeSessions,
    total_bots: adminBots.length,
    active_bots: adminBots.filter(bot => bot.status === 'ACTIVE').length,
    inactive_bots: adminBots.filter(bot => bot.status !== 'ACTIVE').length,
    bots_with_errors: adminBots.filter(bot => bot.status === 'ERROR'
      || (bot.logs || []).some(log => log.level === 'ERROR')).length,
    sample_data: Number(configData.sample_data_version || 0) > 0
  });
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  await userStoreReady;
  const allUsers = await authStore().listUsers();
  const cloudSessionRows = isVercel ? await cloudStore.countActiveSessionsByUser() : [];
  const sessionCounts = new Map(cloudSessionRows.map(row => [String(row.username).toLowerCase(), Number(row.count || 0)]));
  if (!isVercel) {
    for (const session of sessions.values()) {
      if (session.expiresAt > Date.now()) {
        const key = session.username.toLowerCase();
        sessionCounts.set(key, (sessionCounts.get(key) || 0) + 1);
      }
    }
  }
  const query = typeof req.query.search === 'string' ? req.query.search.trim().toLocaleLowerCase() : '';
  const status = typeof req.query.status === 'string' ? req.query.status.toUpperCase() : '';
  const role = typeof req.query.role === 'string' ? req.query.role.toUpperCase() : '';
  const users = allUsers.filter(user => {
    const matchesSearch = !query || [user.username, user.display_name, user.email]
      .some(value => String(value || '').toLocaleLowerCase().includes(query));
    return matchesSearch && (!status || user.status === status) && (!role || user.role === role);
  }).map(user => {
    const owner = user.username.toLowerCase();
    const ownedIdentities = identities.filter(identity => identity.owner_username?.toLowerCase() === owner);
    const ownedBots = bots.filter(bot => bot.owner_username?.toLowerCase() === owner);
    return {
      ...user,
      active_sessions: sessionCounts.get(owner) || 0,
      identity_count: ownedIdentities.length,
      bot_count: ownedBots.length,
      account_count: ownedBots.reduce((sum, bot) => sum + (bot.accounts || []).length, 0)
    };
  });
  const pendingCount = allUsers.filter(user => user.status === 'PENDING').length;
  res.json({ users, total: users.length, pending_count: pendingCount });
});

app.get('/api/admin/users/:username', requireAdmin, async (req, res) => {
  await userStoreReady;
  const user = await authStore().getUser(req.params.username);
  if (!user) return res.status(404).json({ detail: 'No se encontró el usuario.' });
  const owner = user.username.toLowerCase();
  const userIdentities = identities.filter(identity => identity.owner_username?.toLowerCase() === owner);
  const userBots = bots.filter(bot => bot.owner_username?.toLowerCase() === owner);
  const identityIds = new Set(userIdentities.map(identity => identity.id));
  const transactions = ledgerTransactions.filter(transaction => transaction.owner_username?.toLowerCase() === owner
    || identityIds.has(transaction.identity_id));
  const { password_hash: _passwordHash, ...safeUser } = user;
  res.json({
    user: safeUser,
    identities: userIdentities,
    bots: userBots.map(bot => ({ ...bot, accounts: bot.accounts || [] })),
    accounts: userBots.flatMap(bot => (bot.accounts || []).map(account => ({ ...account, bot_id: bot.id, bot_name: bot.name }))),
    finance: { ...getLedgerSummary(null, user.username), transactions }
  });
});

app.patch('/api/admin/users/:username', requireAdmin, async (req, res) => {
  await userStoreReady;
  const target = await authStore().getUser(req.params.username);
  const status = req.body?.status;
  if (!target) return res.status(404).json({ detail: 'No se encontró el usuario.' });
  if (!['ACTIVE', 'FROZEN'].includes(status)) return res.status(400).json({ detail: 'Estado inválido.' });
  if (target.role === 'ADMIN') return res.status(403).json({ detail: 'No se puede congelar una cuenta administradora desde esta pantalla.' });
  await authStore().updateUserStatus(target.username, status);
  if (status === 'FROZEN') await revokeUserSessions(target.username);
  res.json({ username: target.username, status });
});

app.delete('/api/admin/users/:username', requireAdmin, async (req, res) => {
  await userStoreReady;
  const target = await authStore().getUser(req.params.username);
  if (!target) return res.status(404).json({ detail: 'No se encontró el usuario.' });
  if (target.username.toLowerCase() === req.authUser.username.toLowerCase()) {
    return res.status(400).json({ detail: 'No puedes eliminar tu propia cuenta.' });
  }
  if (target.role === 'ADMIN' && await authStore().countActiveAdmins() <= 1) {
    return res.status(409).json({ detail: 'Debe quedar al menos un administrador activo.' });
  }
  await revokeUserSessions(target.username);
  await authStore().deleteUser(target.username);
  res.sendStatus(204);
});

async function revokeUserSessions(username) {
  for (const [token, session] of sessions) {
    if (session.username.toLowerCase() === username.toLowerCase()) revokeSession(token);
  }
  if (isVercel) await cloudStore.deleteUserSessions(username);
}

// Controles de Pánico Institucionales
app.post('/api/emergency/flatten-all', (req, res) => {
  let totalRealized = 0;
  const now = new Date().toLocaleTimeString();

  visibleBots(req).forEach(bot => {
    let botRealized = 0;
    bot.accounts.forEach(acc => {
      resetAccountDailyMetrics(acc);
      if (acc.active_contracts > 0 && acc.current_position !== 'FLAT') {
        const diff = acc.current_position === 'LONG' ? (marketPrice - acc.entry_price) : (acc.entry_price - marketPrice);
        const pnl = Number((diff * 2.0 * acc.active_contracts).toFixed(2));
        acc.realized_pnl += pnl;
        acc.daily_pnl = Number((acc.daily_pnl + pnl).toFixed(2));
        acc.balance += pnl;
        acc.floating_pnl = 0.0;
        acc.active_contracts = 0;
        acc.current_position = 'FLAT';
        acc.entry_price = 0.0;
        botRealized += pnl;
      }
    });
    bot.total_active_contracts = 0;
    bot.net_pnl = Number((bot.net_pnl + botRealized).toFixed(2));
    bot.logs.unshift({
      timestamp: now,
      level: 'EMERGENCY',
      message: `🔴 FLATTEN GLOBAL ejecutado: Posiciones cerradas @ ${marketPrice}. PnL: $${botRealized.toFixed(2)}`
    });
    totalRealized += botRealized;
  });

  saveConfigToDisk({
    action: 'simulated_flatten_all',
    entity_type: 'application',
    status: 'SIMULATED',
    details: { market_price: marketPrice, realized_pnl: Number(totalRealized.toFixed(2)) }
  }, visibleBots(req).map(bot => ({
    bot_id: bot.id,
    operation_type: 'FLATTEN_POSITIONS',
    mode: 'SIMULATED',
    status: 'SIMULATED',
    details: { market_price: marketPrice }
  })));
  broadcastSnapshot();
  res.json({
    status: 'ALL_FLATTENED',
    mode: 'SIMULATED',
    market_price: marketPrice,
    total_realized_pnl: Number(totalRealized.toFixed(2))
  });
});

app.post('/api/emergency/stop-all', (req, res) => {
  let pausedCount = 0;
  const now = new Date().toLocaleTimeString();

  visibleBots(req).forEach(bot => {
    if (bot.status === 'ACTIVE') {
      bot.status = 'PAUSED';
      bot.logs.unshift({
        timestamp: now,
        level: 'EMERGENCY',
        message: '⏹️ KILL-SWITCH GLOBAL: Bot apagado por comando institucional.'
      });
      pausedCount++;
    }
  });

  saveConfigToDisk({
    action: 'simulated_stop_all',
    entity_type: 'application',
    details: { bots_paused: pausedCount, mode: 'SIMULATED' }
  });
  broadcastSnapshot();
  res.json({ status: 'ALL_STOPPED', mode: 'SIMULATED', bots_paused: pausedCount });
});

// Identidades (Titulares KYC)
app.get('/api/identities', (req, res) => {
  res.json(visibleIdentities(req));
});

app.post('/api/identities', (req, res) => {
  const body = req.body || {};
  const { id, full_name, alias, country, city, province, postal_code, address, flag, kyc_status, email, phone_country_code, phone_country_iso, phone, dni,
    crypto_wallet_name, crypto_network, crypto_wallet_address, crypto_transfer_alias, card_brand, card_last4,
    card_exp_month, card_exp_year, payment_provider, payment_reference, notes } = body;
  if (!isValidId(id) || typeof full_name !== 'string' || !full_name.trim() || full_name.length > 160) {
    return res.status(400).json({ detail: 'ID o nombre inválido.' });
  }
  const fieldError = validateIdentityFields(body);
  if (fieldError) return res.status(400).json({ detail: fieldError });
  if (kyc_status !== undefined && !['VERIFIED', 'PENDING', 'REJECTED'].includes(kyc_status)) return res.status(400).json({ detail: 'Estado KYC inválido.' });
  if (!database.canEncryptIdentityPii) return res.status(503).json({ detail: 'Para guardar identidades, abre QUANTUM FX desde la aplicación de escritorio de Windows, que cifra estos datos con tu usuario de Windows.' });
  if (identities.some(identity => identity.id === id)) {
    return res.status(400).json({ detail: 'Esta identidad ya existe.' });
  }

  const newIdent = {
    id,
    owner_username: req.authUser.username,
    full_name,
    alias: alias || full_name,
    country: country || 'AR',
    city: city || '',
    province: province || '',
    postal_code: postal_code || '',
    address: address || '',
    flag: flag || '🌐',
    kyc_status: kyc_status || 'PENDING',
    email: email || '',
    phone_country_code: phone_country_code || '',
    phone_country_iso: phone_country_iso || '',
    phone: phone || '',
    dni: dni || '',
    crypto_wallet_name: crypto_wallet_name || '',
    crypto_network: crypto_network || '',
    crypto_wallet_address: crypto_wallet_address || '',
    crypto_transfer_alias: crypto_transfer_alias || '',
    card_brand: card_brand || '',
    card_last4: card_last4 || '',
    card_exp_month: card_exp_month === '' || card_exp_month === undefined ? '' : Number(card_exp_month),
    card_exp_year: card_exp_year === '' || card_exp_year === undefined ? '' : Number(card_exp_year),
    payment_provider: payment_provider || '',
    payment_reference: payment_reference || '',
    notes: notes || ''
  };

  identities.push(newIdent);
  saveConfigToDisk({
    action: 'identity_created',
    entity_type: 'identity',
    entity_id: id
  });
  broadcastSnapshot();
  res.status(201).json({ status: 'CREATED', identity: newIdent });
});

app.put('/api/identities/:id', (req, res) => {
  const identity = findVisibleIdentity(req, req.params.id);
  if (!identity) return res.status(404).json({ detail: 'Identidad no encontrada.' });
  if (!database.canEncryptIdentityPii) return res.status(503).json({ detail: 'Para guardar identidades, abre QUANTUM FX desde la aplicación de escritorio de Windows, que cifra estos datos con tu usuario de Windows.' });
  const body = req.body || {};
  const fieldError = validateIdentityFields(body);
  if (fieldError) return res.status(400).json({ detail: fieldError });
  if (body.full_name !== undefined && !body.full_name.trim()) return res.status(400).json({ detail: 'El nombre completo no puede quedar vacío.' });
  if (body.kyc_status !== undefined && !['VERIFIED', 'PENDING', 'REJECTED'].includes(body.kyc_status)) return res.status(400).json({ detail: 'Estado KYC inválido.' });
  const editableFields = [
    'full_name', 'alias', 'country', 'city', 'province', 'postal_code', 'address',
    'email', 'phone_country_code', 'phone_country_iso', 'phone', 'dni', 'flag', 'kyc_status', 'notes',
    'crypto_wallet_name', 'crypto_network', 'crypto_wallet_address', 'crypto_transfer_alias',
    'card_brand', 'card_last4', 'card_exp_month', 'card_exp_year', 'payment_provider', 'payment_reference'
  ];
  for (const field of editableFields) {
    if (!Object.hasOwn(body, field)) continue;
    if (field === 'card_exp_month' || field === 'card_exp_year') {
      identity[field] = body[field] === '' || body[field] === null ? '' : Number(body[field]);
    } else {
      identity[field] = body[field];
    }
  }
  saveConfigToDisk({
    action: 'identity_updated',
    entity_type: 'identity',
    entity_id: identity.id,
    details: { fields: Object.keys(body).filter(field => editableFields.includes(field)) }
  });
  broadcastSnapshot();
  res.json({ status: 'UPDATED', identity });
});

app.delete('/api/identities/:id', (req, res) => {
  const targetIdentity = findVisibleIdentity(req, req.params.id);
  const identIndex = targetIdentity ? identities.indexOf(targetIdentity) : -1;
  if (identIndex === -1) {
    return res.status(404).json({ detail: 'Identidad no encontrada' });
  }
  identities.splice(identIndex, 1);
  // Desvincular de cualquier bot que la tuviera asignada
  bots.filter(bot => ownerMatchesRequest(req, bot)).forEach(b => {
    if (b.identity_id === req.params.id || (b.identity && b.identity.id === req.params.id)) {
      b.identity_id = null;
      b.identity = null;
    }
  });
  saveConfigToDisk({
    action: 'identity_deleted',
    entity_type: 'identity',
    entity_id: req.params.id
  });
  broadcastSnapshot();
  res.json({ status: 'DELETED', identity_id: req.params.id });
});

// Verificación de Proxy
app.post('/api/bots/:id/proxy-test', (req, res) => {
  const bot = findVisibleBot(req, req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  if (bot.proxy_url && (bot.proxy_url.includes('example') || bot.proxy_url.includes('invalid'))) {
    bot.proxy_ping_ms = 0;
    bot.proxy_healthy = false;
    bot.geo_consistent = false;
    return res.status(501).json({
      status: 'UNAVAILABLE',
      bot_id: bot.id,
      proxy_url: sanitizeProxyUrl(bot.proxy_url),
      detected_ip: null,
      ping_ms: null,
      is_healthy: false,
      geo_consistent: false,
      message: 'La verificación real del proxy no está implementada en el servidor Node.'
    });
  }

  const latency = Number((10.8 + Math.random() * 4.2).toFixed(1));
  bot.proxy_ping_ms = latency;
  bot.proxy_healthy = true;
  bot.geo_consistent = true;
  bot.geo_match_status = 'GEO-MATCH OK (US Nodo Residencial)';

  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({
    timestamp: now,
    level: 'INFO',
    message: `⚡ Socket SOCKS5 verificado: ${bot.proxy_ip || bot.outbound_ip} (${bot.isp_provider}) // Latencia a CME Chicago: ${latency} ms // Geo-Match OK`
  });

  broadcastSnapshot();
  res.json({
    status: 'OK',
    bot_id: bot.id,
    proxy_url: sanitizeProxyUrl(bot.proxy_url),
    detected_ip: bot.proxy_ip || bot.outbound_ip,
    ping_ms: latency,
    is_healthy: true,
    geo_consistent: true,
    isp: bot.isp_provider,
    node_location: bot.node_location,
    message: `Proxy residencial SOCKS5 activo (${bot.isp_provider}). Latencia directa a CME: ${latency} ms.`
  });
});


// Control de Bots
app.post('/api/bots/:id/toggle', (req, res) => {
  const bot = findVisibleBot(req, req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  bot.status = bot.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({ timestamp: now, level: 'STATE', message: `Estado cambiado a: ${bot.status}` });
  saveConfigToDisk({
    action: 'bot_status_changed',
    entity_type: 'bot',
    entity_id: bot.id,
    details: { status: bot.status }
  });
  broadcastSnapshot();
  res.json({ message: `Bot ${bot.id} ahora está ${bot.status}`, status: bot.status });
});

app.route('/api/bots/:id/schedule').post((req, res) => {
  const bot = findVisibleBot(req, req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  const { start_time, end_time, timezone } = req.body || {};
  const requestedStart = start_time === undefined ? bot.schedule.start_time : start_time;
  const requestedEnd = end_time === undefined ? bot.schedule.end_time : end_time;
  const requestedTimezone = timezone === undefined ? (bot.schedule.timezone || 'America/New_York') : timezone;
  if (!isValidTime(requestedStart)
    || !isValidTime(requestedEnd)
    || !isValidTimeZone(requestedTimezone)) {
    return res.status(400).json({ detail: 'Horario o zona horaria inválidos.' });
  }
  bot.schedule = {
    start_time: requestedStart,
    end_time: requestedEnd,
    timezone: requestedTimezone
  };
  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({ timestamp: now, level: 'CONFIG', message: `Horario: ${bot.schedule.start_time} - ${bot.schedule.end_time}` });
  saveConfigToDisk({
    action: 'bot_schedule_updated',
    entity_type: 'bot',
    entity_id: bot.id,
    details: { schedule: bot.schedule }
  });
  broadcastSnapshot();
  res.json({ message: 'Horario actualizado', schedule: bot.schedule });
});

app.post('/api/bots/:id/close', (req, res) => {
  const bot = findVisibleBot(req, req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  let closedPnl = 0;
  bot.accounts.forEach(acc => {
    resetAccountDailyMetrics(acc);
    if (acc.active_contracts > 0) {
      const diff = acc.current_position === 'LONG' ? (marketPrice - acc.entry_price) : (acc.entry_price - marketPrice);
      const pnl = Number((diff * 2.0 * acc.active_contracts).toFixed(2));
      acc.realized_pnl += pnl;
      acc.daily_pnl = Number((acc.daily_pnl + pnl).toFixed(2));
      acc.balance += pnl;
      acc.floating_pnl = 0.0;
      acc.active_contracts = 0;
      acc.current_position = 'FLAT';
      acc.entry_price = 0.0;
      closedPnl += pnl;
    }
  });
  bot.total_active_contracts = 0;
  bot.net_pnl = Number((bot.net_pnl + closedPnl).toFixed(2));

  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({ timestamp: now, level: 'CLOSE', message: `Posiciones cerradas @ ${marketPrice}. PnL: $${closedPnl.toFixed(2)}` });
  saveConfigToDisk({
    action: 'simulated_positions_closed',
    entity_type: 'bot',
    entity_id: bot.id,
    status: 'SIMULATED',
    details: { market_price: marketPrice, realized_pnl: closedPnl }
  }, [{
    bot_id: bot.id,
    operation_type: 'CLOSE_POSITIONS',
    mode: 'SIMULATED',
    status: 'SIMULATED',
    details: { market_price: marketPrice, realized_pnl: closedPnl }
  }]);
  broadcastSnapshot();
  res.json({ message: 'Posiciones simuladas cerradas', mode: 'SIMULATED', bot_id: bot.id, pnl_realized: closedPnl });
});

// Vincular Cuenta Extendida (con Titular, Credenciales, Entorno, Riesgo)
app.post('/api/bots/:id/accounts', (req, res) => {
  const bot = findVisibleBot(req, req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  const { id, account_id, custom_name, titular_name, broker, prop_firm, environment, username, password, balance, max_contracts, daily_loss_limit } = req.body || {};
  const effectiveId = id || account_id;
  if (!isValidId(effectiveId) || typeof custom_name !== 'string' || !custom_name.trim() || custom_name.length > 160) {
    return res.status(400).json({ detail: 'ID y nombre de cuenta inválidos.' });
  }
  if (bot.accounts.some(account => account.id === effectiveId)) {
    return res.status(400).json({ detail: 'Esta cuenta ya existe en el bot.' });
  }
  if (username !== undefined && (typeof username !== 'string' || username.length > 120)) {
    return res.status(400).json({ detail: 'Usuario de broker inválido.' });
  }
  if (password !== undefined && (typeof password !== 'string' || password.length > 120)) {
    return res.status(400).json({ detail: 'Contraseña de broker inválida.' });
  }
  if (typeof password === 'string' && password.length > 0) {
    return res.status(400).json({ detail: 'No se reciben contraseñas de broker: la aplicación no tiene un conector activo. Registra solo los datos de referencia de la cuenta.' });
  }
  if ((titular_name !== undefined && (typeof titular_name !== 'string' || titular_name.length > 160))
    || (broker !== undefined && (typeof broker !== 'string' || !broker.trim() || broker.length > 64))
    || (prop_firm !== undefined && (typeof prop_firm !== 'string' || !prop_firm.trim() || prop_firm.length > 120))
    || (environment !== undefined && !['EVALUATION', 'FUNDED_PA', 'DEMO'].includes(environment))) {
    return res.status(400).json({ detail: 'Datos de cuenta inválidos.' });
  }
  const parsedBalance = balance === undefined ? 50000 : Number(balance);
  const parsedContracts = max_contracts === undefined ? 2 : Number(max_contracts);
  const parsedLossLimit = daily_loss_limit === undefined ? 1000 : Number(daily_loss_limit);
  if ((balance !== undefined && typeof balance !== 'number')
    || (max_contracts !== undefined && typeof max_contracts !== 'number')
    || (daily_loss_limit !== undefined && typeof daily_loss_limit !== 'number')
    || !Number.isFinite(parsedBalance) || parsedBalance < 0
    || !Number.isInteger(parsedContracts) || parsedContracts < 1 || parsedContracts > 100
    || !Number.isFinite(parsedLossLimit) || parsedLossLimit < 0) {
    return res.status(400).json({ detail: 'Parámetros de balance o riesgo inválidos.' });
  }

  const titular = titular_name || (bot.identity ? bot.identity.full_name : 'Titular');
  const cleanUsername = (typeof username === 'string' && username.trim()) ? username.trim() : '';
  const newAcc = {
    id: effectiveId,
    custom_name,
    titular_name: titular,
    environment: environment || 'EVALUATION',
    broker: broker || 'Tradovate',
    prop_firm: prop_firm || 'Apex Trader Funding',
    username: cleanUsername,
    password_masked: '',
    balance: parsedBalance,
    max_contracts: parsedContracts,
    daily_loss_limit: parsedLossLimit,
    floating_pnl: 0.0,
    realized_pnl: 0.0,
    active_contracts: 0,
    current_position: 'FLAT',
    entry_price: 0.0,
    // Las credenciales no se almacenan ni se usan para abrir una sesión de broker.
    status: 'NOT_CONFIGURED',
    last_order_time: null
  };
  bot.accounts.push(newAcc);
  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({ timestamp: now, level: 'CONFIG', message: `Cuenta vinculada: ${custom_name} (${prop_firm} // ${titular}) [Usuario: ${cleanUsername || 'N/A'}]` });
  saveConfigToDisk({
    action: 'account_added',
    entity_type: 'account',
    entity_id: newAcc.id,
    details: { bot_id: bot.id }
  });
  broadcastSnapshot();
  res.json({
    message: 'Cuenta registrada; no hay conexión de broker activa.',
    account: { ...newAcc, password: '' }
  });
});

app.delete('/api/bots/:botId/accounts/:accountId', (req, res) => {
  const bot = findVisibleBot(req, req.params.botId);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });
  const accIndex = (bot.accounts || []).findIndex(a => a.id === req.params.accountId);
  if (accIndex === -1) {
    return res.status(404).json({ detail: 'Cuenta no encontrada en este bot' });
  }
  const deletedAcc = bot.accounts.splice(accIndex, 1)[0];
  bot.total_active_contracts = bot.accounts.reduce((s, a) => s + (a.active_contracts || 0), 0);
  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({ timestamp: now, level: 'CONFIG', message: `Cuenta desvinculada: ${deletedAcc.custom_name}` });
  saveConfigToDisk({
    action: 'account_deleted',
    entity_type: 'account',
    entity_id: req.params.accountId,
    details: { bot_id: bot.id, custom_name: deletedAcc.custom_name }
  });
  broadcastSnapshot();
  res.json({ status: 'DELETED', bot_id: bot.id, account_id: req.params.accountId });
});

// Crear Bot con Titular (Soporte de Estrategias Personalizadas y Archivo)
app.post('/api/bots', (req, res) => {
  const body = req.body || {};
  let { id, name, identity_id, strategy, proxy_url, start_time, end_time, strategy_file } = body;
  
  if (typeof name !== 'string' || !name.trim() || name.length > 160) {
    return res.status(400).json({ detail: 'ID y nombre inválidos.' });
  }

  // Si no se proporcionó id o está vacío, auto-generar uno seguro y descriptivo
  if (!id || typeof id !== 'string' || !id.trim()) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 20);
    id = `bot_${slug || 'custom'}_${Date.now().toString(36)}`;
  } else if (!isValidId(id)) {
    return res.status(400).json({ detail: 'ID y nombre inválidos.' });
  }

  if (Object.hasOwn(body, 'accounts')) {
    return res.status(400).json({ detail: 'Crea las cuentas por separado sin incluir credenciales.' });
  }
  const selectedStrategy = (typeof strategy === 'string' && strategy.trim()) ? strategy.trim() : 'ICTStrategy';
  const analysisSymbol = body.analysis_symbol === undefined ? 'NQ' : body.analysis_symbol;
  const analysisTimeframes = body.analysis_timeframes === undefined
    ? DEFAULT_ANALYSIS_TIMEFRAMES
    : body.analysis_timeframes;

  // Registrar dinámicamente si es estrategia personalizada del usuario
  if (!Object.hasOwn(STRATEGIES, selectedStrategy)) {
    if (typeof selectedStrategy === 'string' && selectedStrategy.length <= 160) {
      STRATEGIES[selectedStrategy] = selectedStrategy;
    } else {
      return res.status(400).json({ detail: 'Estrategia no válida.' });
    }
  }

  if (!['NQ', 'ES'].includes(analysisSymbol) || !validAnalysisTimeframes(analysisTimeframes)) {
    return res.status(400).json({ detail: 'Instrumento o intervalos de análisis no válidos.' });
  }
  const requestedStart = start_time === undefined ? '09:30' : start_time;
  const requestedEnd = end_time === undefined ? '12:00' : end_time;
  if (!isValidTime(requestedStart) || !isValidTime(requestedEnd)) {
    return res.status(400).json({ detail: 'Horario inválido.' });
  }
  if (proxy_url) {
    let parsedProxy;
    try {
      parsedProxy = new URL(proxy_url);
    } catch {
      return res.status(400).json({ detail: 'URL de proxy inválida.' });
    }
    if (!['socks5:', 'socks5h:'].includes(parsedProxy.protocol)
      || parsedProxy.username || parsedProxy.password || parsedProxy.search || parsedProxy.hash) {
      return res.status(400).json({ detail: 'El proxy SOCKS5 no debe incluir credenciales.' });
    }
  }

  if (bots.some(b => b.id === id)) {
    return res.status(400).json({ detail: `Ya existe bot con id '${id}'` });
  }

  const ident = identity_id ? findVisibleIdentity(req, identity_id) : null;
  if (identity_id && !ident) return res.status(404).json({ detail: 'Identidad no encontrada.' });

  const newBot = {
    id,
    owner_username: req.authUser.username,
    name,
    identity: ident,
    strategy: selectedStrategy,
    strategy_file: strategy_file || null,
    analysis_symbol: analysisSymbol,
    analysis_timeframes: [...analysisTimeframes],
    strategy_description: `Estrategia ${selectedStrategy} optimizada para MNQ`,
    proxy_url: proxy_url || '',
    proxy_ip: '',
    proxy_ping_ms: 0,
    proxy_healthy: false,
    geo_consistent: false,
    geo_description: 'No verificado',
    status: 'ACTIVE',
    schedule: {
      start_time: requestedStart,
      end_time: requestedEnd,
      timezone: 'America/New_York'
    },
    accounts: [],
    net_pnl: 0.0,
    today_pnl: 0.0,
    consistency_pct: 0.0,
    total_trades: 0,
    winning_trades: 0,
    losing_trades: 0,
    win_rate: 0.0,
    max_drawdown: 0.0,
    total_active_contracts: 0,
    execution_count: 0,
    circuit_breaker: {
      daily_loss_limit: Number(body.daily_loss_limit) || 1000.0,
      consistency_target: Number(body.consistency_target) || 1500.0,
      auto_lock_consistency: true,
      pause_on_red_news: true,
      status: 'NORMAL'
    },
    gate_engine: {
      block_ny_open: Boolean(body.block_ny_open || (body.gate_engine && body.gate_engine.block_ny_open)),
      block_red_news: Boolean(body.block_red_news || (body.gate_engine && body.gate_engine.block_red_news))
    },
    risk_parameters: {
      min_rr_ratio: Number(body.min_rr_ratio || (body.risk_parameters && body.risk_parameters.min_rr_ratio)) || 2.0,
      auto_position_sizing: body.auto_position_sizing !== undefined ? Boolean(body.auto_position_sizing) : true,
      risk_per_trade_usd: Number(body.risk_per_trade_usd || (body.risk_parameters && body.risk_parameters.risk_per_trade_usd)) || 150.0,
      stop_loss_points: Number(body.stop_loss_points || (body.risk_parameters && body.risk_parameters.stop_loss_points)) || 15.0
    },
    logs: [
      {
        timestamp: new Date().toLocaleTimeString(),
        level: 'INFO',
        message: `Bot creado con éxito // Titular: ${ident ? ident.full_name : 'Sin asignar'} // Estrategia: ${selectedStrategy}`
      }
    ]
  };

  bots.push(newBot);
  saveConfigToDisk({
    action: 'bot_created',
    entity_type: 'bot',
    entity_id: id
  });
  broadcastSnapshot();
  res.status(201).json({ message: 'Bot creado', bot: newBot });
});

// Editar Bot existente (Nombre, estrategia, titular, VPN/proxy, límites de ganancia y pérdida)
app.put('/api/bots/:id', (req, res) => {
  const bot = findVisibleBot(req, req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  const { name, strategy, identity_id, proxy_url, consistency_target, daily_loss_limit, today_pnl, start_time, end_time } = req.body || {};

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim() || name.length > 160) {
      return res.status(400).json({ detail: 'Nombre inválido.' });
    }
    bot.name = name.trim();
  }

  if (strategy !== undefined && typeof strategy === 'string' && strategy.trim()) {
    const s = strategy.trim();
    if (!Object.hasOwn(STRATEGIES, s) && s.length <= 160) {
      STRATEGIES[s] = s;
    }
    bot.strategy = s;
    bot.strategy_description = `Estrategia ${s} optimizada para MNQ`;
  }

  if (identity_id !== undefined) {
    if (!identity_id) {
      bot.identity_id = null;
      bot.identity = null;
    } else {
      const ident = findVisibleIdentity(req, identity_id);
      if (identity_id && !ident) return res.status(404).json({ detail: 'Identidad no encontrada.' });
      bot.identity_id = ident ? ident.id : null;
      bot.identity = ident || null;
    }
  }

  if (proxy_url !== undefined) {
    if (proxy_url && proxy_url.trim()) {
      let parsedProxy;
      try {
        parsedProxy = new URL(proxy_url.trim());
      } catch {
        return res.status(400).json({ detail: 'URL de proxy inválida.' });
      }
      if (!['socks5:', 'socks5h:'].includes(parsedProxy.protocol)
        || parsedProxy.username || parsedProxy.password || parsedProxy.search || parsedProxy.hash) {
        return res.status(400).json({ detail: 'El proxy SOCKS5 no debe incluir credenciales.' });
      }
      bot.proxy_url = proxy_url.trim();
      bot.outbound_ip = parsedProxy.hostname || bot.outbound_ip;
      bot.proxy_ip = parsedProxy.hostname || bot.proxy_ip;
      bot.proxy_healthy = true;
    } else {
      bot.proxy_url = '';
    }
  }

  if (!bot.circuit_breaker) {
    bot.circuit_breaker = {
      daily_loss_limit: 1000.0,
      consistency_target: 1500.0,
      auto_lock_consistency: true,
      pause_on_red_news: true,
      status: 'NORMAL'
    };
  }

  if (today_pnl !== undefined) {
    const parsedTodayPnl = Number(today_pnl);
    if (!Number.isFinite(parsedTodayPnl) || Math.abs(parsedTodayPnl) > 10000000) {
      return res.status(400).json({ detail: 'El P&L del día debe ser un importe válido entre -10.000.000 y 10.000.000.' });
    }
    bot.today_pnl = Number(parsedTodayPnl.toFixed(2));
    bot.today_pnl_date = new Date().toISOString().slice(0, 10);
  }

  if (consistency_target !== undefined) {
    const ct = Number(consistency_target);
    if (!isNaN(ct) && ct > 0) {
      bot.circuit_breaker.consistency_target = ct;
      if (bot.circuit_breaker.status === 'LOCKED_PROFIT' && (bot.today_pnl || 0) < ct) {
        bot.circuit_breaker.status = 'NORMAL';
      }
    }
  }

  if (daily_loss_limit !== undefined) {
    const dll = Number(daily_loss_limit);
    if (!isNaN(dll) && dll > 0) {
      bot.circuit_breaker.daily_loss_limit = dll;
      if (bot.circuit_breaker.status === 'TRIPPED_STOP' && (bot.today_pnl || 0) > -dll) {
        bot.circuit_breaker.status = 'NORMAL';
      }
    }
  }


  if (start_time !== undefined && isValidTime(start_time)) {
    if (!bot.schedule) bot.schedule = { timezone: 'America/New_York' };
    bot.schedule.start_time = start_time;
  }
  if (end_time !== undefined && isValidTime(end_time)) {
    if (!bot.schedule) bot.schedule = { timezone: 'America/New_York' };
    bot.schedule.end_time = end_time;
  }

  const bodyData = req.body || {};
  if (bodyData.gate_engine !== undefined || bodyData.block_ny_open !== undefined || bodyData.block_red_news !== undefined) {
    if (!bot.gate_engine) bot.gate_engine = { block_ny_open: false, block_red_news: false };
    if (bodyData.block_ny_open !== undefined) bot.gate_engine.block_ny_open = Boolean(bodyData.block_ny_open);
    if (bodyData.block_red_news !== undefined) bot.gate_engine.block_red_news = Boolean(bodyData.block_red_news);
    if (bodyData.gate_engine) {
      if (bodyData.gate_engine.block_ny_open !== undefined) bot.gate_engine.block_ny_open = Boolean(bodyData.gate_engine.block_ny_open);
      if (bodyData.gate_engine.block_red_news !== undefined) bot.gate_engine.block_red_news = Boolean(bodyData.gate_engine.block_red_news);
    }
  }

  if (bodyData.risk_parameters !== undefined || bodyData.min_rr_ratio !== undefined || bodyData.auto_position_sizing !== undefined || bodyData.stop_loss_points !== undefined || bodyData.risk_per_trade_usd !== undefined) {
    if (!bot.risk_parameters) bot.risk_parameters = { min_rr_ratio: 2.0, auto_position_sizing: true, risk_per_trade_usd: 150.0, stop_loss_points: 15.0 };
    if (bodyData.min_rr_ratio !== undefined) bot.risk_parameters.min_rr_ratio = Number(bodyData.min_rr_ratio) || 2.0;
    if (bodyData.auto_position_sizing !== undefined) bot.risk_parameters.auto_position_sizing = Boolean(bodyData.auto_position_sizing);
    if (bodyData.stop_loss_points !== undefined) bot.risk_parameters.stop_loss_points = Number(bodyData.stop_loss_points) || 15.0;
    if (bodyData.risk_per_trade_usd !== undefined) bot.risk_parameters.risk_per_trade_usd = Number(bodyData.risk_per_trade_usd) || 150.0;
    if (bodyData.risk_parameters) {
      if (bodyData.risk_parameters.min_rr_ratio !== undefined) bot.risk_parameters.min_rr_ratio = Number(bodyData.risk_parameters.min_rr_ratio) || 2.0;
      if (bodyData.risk_parameters.auto_position_sizing !== undefined) bot.risk_parameters.auto_position_sizing = Boolean(bodyData.risk_parameters.auto_position_sizing);
      if (bodyData.risk_parameters.stop_loss_points !== undefined) bot.risk_parameters.stop_loss_points = Number(bodyData.risk_parameters.stop_loss_points) || 15.0;
      if (bodyData.risk_parameters.risk_per_trade_usd !== undefined) bot.risk_parameters.risk_per_trade_usd = Number(bodyData.risk_parameters.risk_per_trade_usd) || 150.0;
    }
  }

  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({
    timestamp: now,
    level: 'CONFIG',
    message: `Bot editado: ${bot.name} | Estrategia: ${bot.strategy} | Target Consistencia: +$${bot.circuit_breaker.consistency_target} | DLL: $${bot.circuit_breaker.daily_loss_limit}`
  });

  saveConfigToDisk({
    action: 'bot_updated',
    entity_type: 'bot',
    entity_id: bot.id,
    details: {
      name: bot.name,
      strategy: bot.strategy,
      identity_id: bot.identity_id,
      circuit_breaker: bot.circuit_breaker
    }
  });

  broadcastSnapshot();
  res.json({ message: 'Bot actualizado con éxito', bot });
});

// Eliminar Bot
app.delete('/api/bots/:id', (req, res) => {
  const ownedBot = findVisibleBot(req, req.params.id);
  const botIndex = ownedBot ? bots.indexOf(ownedBot) : -1;
  if (botIndex === -1) {
    return res.status(404).json({ detail: 'Bot no encontrado' });
  }
  const deletedBot = bots.splice(botIndex, 1)[0];
  saveConfigToDisk({
    action: 'bot_deleted',
    entity_type: 'bot',
    entity_id: req.params.id,
    details: { name: deletedBot.name }
  });
  broadcastSnapshot();
  res.json({ status: 'DELETED', bot_id: req.params.id });
});

// Endpoint de Verificación de Archivos de Estrategia Multilenguaje
app.post('/api/bots/verify-strategy-file', express.json({ limit: '2mb' }), (req, res) => {
  const { filename, code } = req.body || {};
  if (!filename || typeof code !== 'string') {
    return res.status(400).json({ detail: 'Archivo o código faltante.' });
  }

  const ext = (filename.split('.').pop() || '').toLowerCase();
  let detectedLanguage = 'Estrategia de Código General';
  if (ext === 'pine' || code.includes('//@version') || code.includes('strategy(') || code.includes('indicator(')) {
    detectedLanguage = 'TradingView Pine Script (v5/v4)';
  } else if (ext === 'py' || code.includes('def ') || code.includes('import ') || code.includes('class ')) {
    detectedLanguage = 'Python Algorithmic Engine';
  } else if (ext === 'js' || ext === 'ts' || code.includes('function ') || code.includes('const ') || code.includes('async ')) {
    detectedLanguage = ext === 'ts' ? 'TypeScript Strategy' : 'JavaScript Engine';
  } else if (ext === 'cs' || code.includes('using NinjaTrader') || code.includes('namespace ')) {
    detectedLanguage = 'C# NinjaScript (CME Futures)';
  } else if (ext === 'mq4' || ext === 'mq5' || code.includes('OnTick') || code.includes('OrderSend')) {
    detectedLanguage = 'MetaTrader MQL4/MQL5 Expert Advisor';
  } else if (ext === 'json') {
    detectedLanguage = 'Reglas Algorítmicas JSON';
  }

  const lower = code.toLowerCase();
  const signals = [];
  if (lower.includes('buy') || lower.includes('long') || lower.includes('enterlong') || lower.includes('strategy.entry')) {
    signals.push('Entrada LONG (Compra)');
  }
  if (lower.includes('sell') || lower.includes('short') || lower.includes('entershort') || lower.includes('strategy.entry')) {
    signals.push('Entrada SHORT (Venta)');
  }
  if (!signals.length) signals.push('Señales de ejecución dinámicas');

  const riskRules = [];
  if (lower.includes('stop') || lower.includes('sl') || lower.includes('stoploss') || lower.includes('stop_loss')) {
    riskRules.push('Stop Loss Integrado');
  }
  if (lower.includes('take_profit') || lower.includes('takeprofit') || lower.includes('tp') || lower.includes('profit')) {
    riskRules.push('Take Profit (R:R Ratio)');
  }
  if (lower.includes('trailing') || lower.includes('breakeven')) {
    riskRules.push('Trailing / Break-Even Dinámico');
  }
  if (!riskRules.length) riskRules.push('Protección por Circuit Breaker General');

  const indicators = [];
  if (lower.includes('fvg') || lower.includes('fair value gap')) indicators.push('Fair Value Gap (FVG)');
  if (lower.includes('killzone') || lower.includes('09:30') || lower.includes('session')) indicators.push('Killzone NY');
  if (lower.includes('ema') || lower.includes('sma')) indicators.push('Medias Móviles (EMA/SMA)');
  if (lower.includes('rsi')) indicators.push('RSI Momentum');
  if (lower.includes('atr')) indicators.push('ATR Volatilidad');

  const preview = code.split(/\r?\n/).slice(0, 12).join('\n');

  res.json({
    verified: true,
    status: 'VERIFICADO Y COMPATIBLE',
    filename,
    language: detectedLanguage,
    signals,
    risk_rules: riskRules,
    indicators,
    snippet: preview
  });
});

// ======================================================================
// NUEVAS RUTAS DE ARQUITECTURA: MERCADO, NOTICIAS, CIRCUIT BREAKER, LEDGER
// ======================================================================

// 1. Datos de velas históricas y marcadores para Lightweight Charts
// Mock API de Proxies Residenciales (Pool SOCKS5 en Entorno DEMO)
app.get('/api/vpn/proxies', (req, res) => {
  const proxyPool = visibleBots(req).map(b => ({
    bot_id: b.id,
    bot_name: b.name,
    titular: b.identity ? b.identity.full_name : 'Sin Titular',
    ip: b.proxy_ip || b.outbound_ip || '198.51.100.22',
    port: b.proxy_port || 10808,
    isp: b.isp_provider || 'Comcast Cable Communications',
    city: b.node_location || 'New York, NY',
    ping_ms: b.proxy_ping_ms || 12.4,
    status: b.proxy_healthy ? 'CONNECTED' : 'OFFLINE',
    geo_consistent: b.geo_consistent !== false
  }));
  res.json({ status: 'OK', proxies: proxyPool });
});

// Telemetría de Velas y Operaciones Específicas por Bot (Modal de Inspección)
app.get('/api/bots/:id/chart', async (req, res) => {
  const bot = findVisibleBot(req, req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  const botMarkers = chartExecutionMarkers.filter(marker => marker.bot_id === bot.id
    && marker.owner_username?.toLowerCase() === bot.owner_username?.toLowerCase());
  const activeAccount = bot.accounts.find(a => a.active_contracts > 0 && a.current_position !== 'FLAT');
  const position = activeAccount ? {
    in_position: true,
    side: activeAccount.current_position,
    size: activeAccount.active_contracts,
    entry_price: activeAccount.entry_price,
    take_profit: Number((activeAccount.current_position === 'LONG' ? activeAccount.entry_price + 25 : activeAccount.entry_price - 25).toFixed(2)),
    stop_loss: Number((activeAccount.current_position === 'LONG' ? activeAccount.entry_price - 15 : activeAccount.entry_price + 15).toFixed(2)),
    floating_pnl: activeAccount.floating_pnl
  } : {
    in_position: false,
    side: 'FLAT',
    size: 0,
    entry_price: 0,
    take_profit: 0,
    stop_loss: 0,
    floating_pnl: 0
  };

  let symbolMap = { bot_1: 'MNQ', bot_2: 'NQ', bot_3: 'ES', default: 'MNQ' };
  try {
    const symbolsPath = path.join(projectRoot, 'public', 'data', 'botSymbols.json');
    if (fs.existsSync(symbolsPath)) {
      symbolMap = JSON.parse(fs.readFileSync(symbolsPath, 'utf-8'));
    }
  } catch (err) {}

  const symbol = symbolMap[bot.id] || symbolMap.default || 'MNQ';
  let candles = marketCandles;
  let botPrice = marketPrice;

  try {
    const candleData = await getCandles(symbol, '1m', 100);
    if (candleData.candles && candleData.candles.length) {
      candles = candleData.candles;
      botPrice = candles[candles.length - 1].close;
    }
  } catch (e) {}

  res.json({
    bot_id: bot.id,
    symbol: `${symbol} (CME Futures)`,
    candles,
    markers: botMarkers,
    position,
    last_price: botPrice
  });
});

// Simulación Directa de Operación para un Bot (DEMO Trade Launcher con Anti-Hedging y Gate Engine)
app.post('/api/bots/:id/simulate-trade', (req, res) => {
  const bot = findVisibleBot(req, req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  const { side = 'BUY', contracts = 1 } = req.body || {};
  if (typeof side !== 'string' || !['BUY', 'SELL'].includes(side.toUpperCase())) {
    return res.status(400).json({ detail: 'side debe ser BUY o SELL.' });
  }
  const isBuy = side.toUpperCase() === 'BUY';
  const requestedContracts = Number(contracts);
  if (!Number.isInteger(requestedContracts) || requestedContracts < 1 || requestedContracts > 100) {
    return res.status(400).json({ detail: 'contracts debe ser un entero entre 1 y 100.' });
  }

  // 1. Verificación Gate Engine (Configurable por usuario)
  const gateCheck = checkGateEngine(bot);
  if (!gateCheck.open) {
    const gateMsg = `⏸️ Gate Engine: Orden bloqueada por ${gateCheck.reason}.`;
    bot.logs.unshift({ timestamp: new Date().toLocaleTimeString(), level: 'GATE', message: gateMsg });
    return res.status(422).json({
      status: 'BLOCKED',
      gate_engine_blocked: true,
      reason: gateCheck.reason,
      code: gateCheck.code
    });
  }

  // 2. Regla estricta Anti-Hedging por Identidad KYC
  const antiHedging = checkAntiHedging(bot, side);
  if (!antiHedging.allowed) {
    const blockMsg = `Control de exposición: ${antiHedging.identityName} ya tiene una posición ${antiHedging.opposingPosition} abierta en ${antiHedging.opposingBotName} / ${antiHedging.opposingAccountName}. La operación simulada se bloqueó por la regla configurada.`;
    const now = new Date().toLocaleTimeString();
    bot.logs.unshift({
      timestamp: now,
      level: 'ALERT',
      message: blockMsg
    });
    return res.status(409).json({
      status: 'BLOCKED',
      anti_hedging_blocked: true,
      detail: blockMsg,
      identity: antiHedging.identityName,
      opposing_position: antiHedging.opposingPosition,
      opposing_account: antiHedging.opposingAccountName
    });
  }

  // 3. Dimensionamiento y Sizing automático
  const activeContracts = calculatePositionSizing(bot, requestedContracts);
  if (activeContracts < 1) {
    return res.status(422).json({ status: 'BLOCKED', risk_check_blocked: true, detail: 'El riesgo por contrato excede el límite configurado.' });
  }

  // 4. Ejecución en paralelo en todas las cuentas asignadas al bot
  bot.accounts.forEach(acc => {
    acc.current_position = isBuy ? 'LONG' : 'SHORT';
    acc.active_contracts = Math.min(activeContracts, acc.max_contracts || 2);
    acc.entry_price = marketPrice;
    acc.floating_pnl = 0.0;
    acc.status = 'CONNECTED';
  });
  bot.total_active_contracts = bot.accounts.reduce((s, a) => s + a.active_contracts, 0);

  const marker = {
    bot_id: bot.id,
    owner_username: bot.owner_username,
    time: marketCandles.length ? marketCandles[marketCandles.length - 1].time : Math.floor(Date.now() / 1000),
    position: isBuy ? 'belowBar' : 'aboveBar',
    color: isBuy ? '#00E676' : '#FF5252',
    shape: isBuy ? 'arrowUp' : 'arrowDown',
    text: `${bot.name}: ${side.toUpperCase()} ${activeContracts} MNQ @ ${marketPrice}`
  };
  chartExecutionMarkers.push(marker);

  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({
    timestamp: now,
    level: 'ORDER',
    message: `Orden simulada ${side.toUpperCase()} ${activeContracts} MNQ @ ${marketPrice}.`
  });

  saveConfigToDisk({
    action: 'simulated_trade_opened',
    entity_type: 'bot',
    entity_id: bot.id,
    status: 'SIMULATED',
    details: { side: side.toUpperCase(), contracts: activeContracts, market_price: marketPrice }
  }, [{
    bot_id: bot.id,
    operation_type: 'SIMULATED_TRADE',
    mode: 'SIMULATED',
    status: 'SIMULATED',
    details: { side: side.toUpperCase(), contracts: activeContracts, market_price: marketPrice }
  }]);
  broadcastSnapshot();
  res.json({
    status: 'OK',
    message: `Orden ${side.toUpperCase()} simulada con éxito`,
    market_price: marketPrice,
    bot_id: bot.id,
    contracts: activeContracts
  });
});

// Webhook local autenticado para señales simuladas (Node.js, puerto 3008)
app.post('/api/webhook', (req, res) => {
  const body = req.body || {};
  const configuredSecret = process.env.QUANTUM_WEBHOOK_SECRET || '';
  if (configuredSecret.length < 32) {
    return res.status(503).json({ detail: 'Webhook deshabilitado: configura QUANTUM_WEBHOOK_SECRET con al menos 32 caracteres aleatorios.' });
  }
  const providedSecret = req.get('x-quantum-webhook-token') || body.token;
  if (!secureEqual(providedSecret, configuredSecret)) {
    return res.status(401).json({ detail: 'Token de webhook inválido.' });
  }

  const { ticker = 'MNQ', action = 'buy', price, contracts = 1, strategy, bot_id } = body;
  const stopLossPoints = Number(body.stop_loss_points ?? body.sl_points ?? body.sl);
  const takeProfitPoints = Number(body.take_profit_points ?? body.tp_points ?? body.tp);
  const requestedMinRr = Number(body.min_rr);

  if (typeof ticker !== 'string' || ticker.trim().toUpperCase() !== 'MNQ') {
    return res.status(422).json({ detail: 'Este webhook solo admite el símbolo MNQ en modo simulado.' });
  }

  const side = typeof action === 'string' ? action.toUpperCase() : '';
  if (!['BUY', 'SELL', 'FLAT', 'CLOSE'].includes(side)) {
    return res.status(400).json({ detail: 'Acción de webhook no válida (debe ser BUY, SELL, o FLAT).' });
  }

  // Buscar bot objetivo
  let targetBot = null;
  if (bot_id) {
    targetBot = bots.find(b => b.id === bot_id);
  } else if (typeof strategy === 'string' && strategy.trim()) {
    const strategyBots = bots.filter(b => b.strategy === strategy && b.status === 'ACTIVE');
    if (strategyBots.length === 1) targetBot = strategyBots[0];
    else if (strategyBots.length > 1) {
      return res.status(400).json({ detail: 'La estrategia coincide con varios bots activos; indica bot_id explícitamente.' });
    }
  }

  if (!targetBot) {
    return res.status(404).json({ detail: 'No se encontró un bot objetivo. Indica un bot_id válido o una estrategia única.' });
  }

  // Si la acción es FLAT o CLOSE, cerrar posiciones
  if (side === 'FLAT' || side === 'CLOSE') {
    targetBot.accounts.forEach(acc => {
      acc.current_position = 'FLAT';
      acc.active_contracts = 0;
      acc.floating_pnl = 0.0;
    });
    targetBot.total_active_contracts = 0;
    const now = new Date().toLocaleTimeString();
    targetBot.logs.unshift({
      timestamp: now,
      level: 'ORDER',
      message: `⏹️ Alerta TradingView Webhook: Posiciones cerradas (FLAT) en ${targetBot.accounts.length} cuenta(s).`
    });
    broadcastSnapshot();
    return res.json({ status: 'OK', message: 'Posiciones cerradas (FLAT)', bot_id: targetBot.id });
  }

  const contractsNumber = Number(contracts);
  if (!Number.isInteger(contractsNumber) || contractsNumber < 1 || contractsNumber > 100) {
    return res.status(400).json({ detail: 'contracts debe ser un entero entre 1 y 100.' });
  }
  if (!Number.isFinite(stopLossPoints) || stopLossPoints <= 0
    || !Number.isFinite(takeProfitPoints) || takeProfitPoints <= 0) {
    return res.status(400).json({ detail: 'stop_loss_points y take_profit_points deben ser números positivos.' });
  }
  const configuredMinRr = Number(targetBot.risk_parameters?.min_rr_ratio) || 2;
  const minRr = Number.isFinite(requestedMinRr) && requestedMinRr > 0
    ? Math.max(configuredMinRr, requestedMinRr)
    : configuredMinRr;
  const actualRr = takeProfitPoints / stopLossPoints;
  if (actualRr + Number.EPSILON < minRr) {
    return res.status(422).json({
      status: 'BLOCKED',
      risk_check_blocked: true,
      required_rr: minRr,
      actual_rr: Number(actualRr.toFixed(4)),
      detail: 'La relación take-profit/stop-loss no alcanza el mínimo configurado para el bot.'
    });
  }
  if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) <= 0)) {
    return res.status(400).json({ detail: 'price debe ser un número positivo.' });
  }

  // 1. Verificación Gate Engine
  const gateCheck = checkGateEngine(targetBot);
  if (!gateCheck.open) {
    const gateMsg = `⏸️ Gate Engine: Alerta webhook ${side} descartada por ${gateCheck.reason}.`;
    targetBot.logs.unshift({ timestamp: new Date().toLocaleTimeString(), level: 'GATE', message: gateMsg });
    return res.status(422).json({
      status: 'BLOCKED',
      gate_engine_blocked: true,
      reason: gateCheck.reason,
      code: gateCheck.code
    });
  }

  // 2. Verificación Anti-Hedging por Identidad KYC
  const antiHedging = checkAntiHedging(targetBot, side);
  if (!antiHedging.allowed) {
    const blockMsg = `Control de exposición: ${antiHedging.identityName} ya tiene una posición ${antiHedging.opposingPosition} abierta en ${antiHedging.opposingBotName} / ${antiHedging.opposingAccountName}. La operación simulada se bloqueó por la regla configurada.`;
    targetBot.logs.unshift({
      timestamp: new Date().toLocaleTimeString(),
      level: 'ALERT',
      message: blockMsg
    });
    return res.status(409).json({
      status: 'BLOCKED',
      anti_hedging_blocked: true,
      detail: blockMsg,
      identity: antiHedging.identityName,
      opposing_position: antiHedging.opposingPosition,
      opposing_account: antiHedging.opposingAccountName
    });
  }

  // 3. Dimensionamiento y Sizing de contratos
  const activeContracts = calculatePositionSizing(targetBot, contractsNumber, stopLossPoints);
  if (activeContracts < 1) {
    return res.status(422).json({
      status: 'BLOCKED',
      risk_check_blocked: true,
      detail: 'El riesgo por contrato excede el límite configurado; no se abrió una posición simulada.'
    });
  }
  const isBuy = side === 'BUY';
  const execPrice = Number(price) || marketPrice;

  // 4. Ejecución simultánea en paralelo con la misma operación
  targetBot.accounts.forEach(acc => {
    acc.current_position = isBuy ? 'LONG' : 'SHORT';
    acc.active_contracts = Math.min(activeContracts, acc.max_contracts || 2);
    acc.entry_price = execPrice;
    acc.floating_pnl = 0.0;
    acc.status = 'CONNECTED';
  });
  targetBot.total_active_contracts = targetBot.accounts.reduce((s, a) => s + a.active_contracts, 0);

  const marker = {
    bot_id: targetBot.id,
    owner_username: targetBot.owner_username,
    time: marketCandles.length ? marketCandles[marketCandles.length - 1].time : Math.floor(Date.now() / 1000),
    position: isBuy ? 'belowBar' : 'aboveBar',
    color: isBuy ? '#00E676' : '#FF5252',
    shape: isBuy ? 'arrowUp' : 'arrowDown',
    text: `TV Webhook (${targetBot.name}): ${side} ${activeContracts} MNQ @ ${execPrice}`
  };
  chartExecutionMarkers.push(marker);

  const now = new Date().toLocaleTimeString();
  targetBot.logs.unshift({
    timestamp: now,
    level: 'ORDER',
    message: `TradingView Webhook: orden simulada ${side} ${activeContracts} MNQ @ ${execPrice}.`
  });

  saveConfigToDisk({
    action: 'webhook_trade_opened',
    entity_type: 'bot',
    entity_id: targetBot.id,
    status: 'EXECUTED',
    details: { side, contracts: activeContracts, market_price: execPrice }
  }, [{
    bot_id: targetBot.id,
    operation_type: 'WEBHOOK_TRADE',
    mode: 'SIMULATED',
    status: 'EXECUTED',
    details: { side, contracts: activeContracts, market_price: execPrice }
  }]);

  broadcastSnapshot();
  return res.json({
    status: 'OK',
    message: `Alerta procesada con éxito para ${targetBot.name}`,
    bot_id: targetBot.id,
    side,
    contracts: activeContracts,
    price: execPrice,
    accounts_executed: targetBot.accounts.length
  });
});

app.get('/api/market/candles', async (req, res) => {
  try {
    const timeframe = req.query.tf || req.query.interval || '1m';
    const limit = Number(req.query.limit) || 120;
    const provider = req.query.provider;

    const data = await getCandles('MNQ', timeframe, limit, provider);
    if (data.candles && data.candles.length) {
      marketPrice = data.candles[data.candles.length - 1].close;
    }

    res.json({
      symbol: 'MNQ (Micro E-mini Nasdaq)',
      timeframe,
      candles: data.candles,
      markers: visibleChartMarkers(req),
      last_price: marketPrice,
      provider: data.provider
    });
  } catch (err) {
    console.error('[ERROR] /api/market/candles:', err.message);
    res.json({
      symbol: 'MNQ (Micro E-mini Nasdaq)',
      timeframe: req.query.tf || '1m',
      candles: marketCandles,
      markers: visibleChartMarkers(req),
      last_price: marketPrice
    });
  }
});

// Endpoints de Datos de Mercado en Tiempo Real (Yahoo / Finnhub / Alpha Vantage)
app.get('/api/candles', async (req, res) => {
  try {
    const symbol = req.query.symbol || 'MNQ';
    const interval = req.query.interval || process.env.CANDLE_INTERVAL || '1m';
    const limit = Number(req.query.limit) || 100;
    const provider = req.query.provider;

    const data = await getCandles(symbol, interval, limit, provider);
    res.json(data);
  } catch (e) {
    console.error('[ERROR] /api/candles:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/bot/:botId/candles', async (req, res) => {
  try {
    const botId = req.params.botId;
    if (!findVisibleBot(req, botId)) return res.status(404).json({ detail: 'Bot no encontrado.' });
    let symbolMap = { bot_1: 'MNQ', bot_2: 'NQ', bot_3: 'ES', default: 'MNQ' };
    try {
      const symbolsPath = path.join(projectRoot, 'public', 'data', 'botSymbols.json');
      if (fs.existsSync(symbolsPath)) {
        symbolMap = JSON.parse(fs.readFileSync(symbolsPath, 'utf-8'));
      }
    } catch (err) {}

    const symbol = symbolMap[botId] || symbolMap.default || 'MNQ';
    const interval = req.query.interval || process.env.CANDLE_INTERVAL || '1m';
    const limit = Number(req.query.limit) || 100;
    const provider = req.query.provider;

    const data = await getCandles(symbol, interval, limit, provider);
    res.json({
      botId,
      ...data
    });
  } catch (e) {
    console.error(`[ERROR] /api/bot/${req.params.botId}/candles:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// 2. Calendario de noticias macroeconómicas
app.get('/api/news/calendar', (req, res) => {
  res.json({
    source: 'ForexFactory Macro Feed (Simulated)',
    events: economicEvents
  });
});

// 3. Ajuste y activación de Circuit Breaker por Bot
app.put('/api/bots/:id/circuit-breaker', (req, res) => {
  const bot = findVisibleBot(req, req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  const { daily_loss_limit, consistency_target, auto_lock_consistency, pause_on_red_news } = req.body || {};

  if (!bot.circuit_breaker) {
    bot.circuit_breaker = {
      daily_loss_limit: 1000.0,
      consistency_target: 150.0,
      auto_lock_consistency: true,
      pause_on_red_news: true,
      status: 'NORMAL'
    };
  }

  if (daily_loss_limit !== undefined && typeof daily_loss_limit === 'number' && daily_loss_limit > 0) {
    bot.circuit_breaker.daily_loss_limit = daily_loss_limit;
  }
  if (consistency_target !== undefined && typeof consistency_target === 'number' && consistency_target > 0) {
    bot.circuit_breaker.consistency_target = consistency_target;
  }
  if (auto_lock_consistency !== undefined) {
    bot.circuit_breaker.auto_lock_consistency = Boolean(auto_lock_consistency);
  }
  if (pause_on_red_news !== undefined) {
    bot.circuit_breaker.pause_on_red_news = Boolean(pause_on_red_news);
  }

  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({
    timestamp: now,
    level: 'CONFIG',
    message: `Circuit Breaker configurado: DLL=$${bot.circuit_breaker.daily_loss_limit} | Target Lock=+$${bot.circuit_breaker.consistency_target} (Auto: ${bot.circuit_breaker.auto_lock_consistency})`
  });

  saveConfigToDisk({
    action: 'bot_circuit_breaker_updated',
    entity_type: 'bot',
    entity_id: bot.id,
    details: { circuit_breaker: bot.circuit_breaker }
  });

  broadcastSnapshot();
  res.json({ message: 'Circuit Breaker actualizado con éxito', circuit_breaker: bot.circuit_breaker });
});

// 4. Ledger Financiero y Reparto a Titulares
app.get('/api/ledger/summary', (req, res) => {
  const { identity } = req.query;
  res.json(getLedgerSummary(identity, req.authUser?.role === 'ADMIN' ? null : req.authUser?.username));
});

// 5. Registrar Transacción o Retiro en el Ledger
app.post('/api/ledger/payout', (req, res) => {
  const { identity_id, account_name, prop_firm, type, amount, notes } = req.body || {};
  if (!identity_id || !type || typeof amount !== 'number' || amount === 0) {
    return res.status(400).json({ detail: 'Datos de transacción o monto inválidos' });
  }

  const ident = findVisibleIdentity(req, identity_id);
  if (!ident) return res.status(404).json({ detail: 'Titular no encontrado.' });
  const newTx = {
    id: `tx_${Date.now()}`,
    owner_username: req.authUser.username,
    record_source: 'USER',
    mode: 'SIMULATED',
    date: new Date().toISOString().slice(0, 10),
    identity_id,
    identity_name: ident ? ident.full_name : 'Titular Desconocido',
    account_name: account_name || 'Cuenta General',
    prop_firm: prop_firm || 'Apex Trader Funding',
    type,
    amount: (type === 'PROP_FIRM_PAYOUT') ? Math.abs(amount) : -Math.abs(amount),
    status: 'COMPLETED',
    notes: notes || 'Registro manual de pago / retiro'
  };

  ledgerTransactions.unshift(newTx);
  if (isVercel && !database.canEncryptIdentityPii) {
    ledgerTransactions.shift();
    return res.status(503).json({ detail: 'Configura la clave sensible BOT_VPN_PII_ENCRYPTION_KEY en Vercel para cifrar el ledger.' });
  }
  saveConfigToDisk({
    action: 'ledger_transaction_created',
    entity_type: 'ledger',
    entity_id: newTx.id,
    details: { transaction_type: newTx.type, amount: newTx.amount }
  });
  res.status(201).json({ status: 'CREATED', transaction: newTx });
});

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const isDatabaseError = typeof err.code === 'string' && err.code.startsWith('ERR_SQLITE_');
  const status = err.statusCode === 409
    ? 409
    : isDatabaseError
      ? 503
      : err.status === 413
        ? 413
        : (err.type === 'entity.parse.failed' ? 400 : 500);
  console.error(`Request processing failed (${status}).`);
  res.status(status).json({
    detail: status === 413
      ? 'El cuerpo de la solicitud excede el límite permitido.'
      : status === 400
        ? 'JSON inválido.'
        : status === 409
          ? 'Los datos cambiaron en el otro servidor. Reintenta la operación.'
          : status === 503
            ? 'No se pudo guardar o leer el estado persistido.'
            : 'Error interno.'
  });
});

// ======================================================================
// INICIO DEL SERVIDOR EN PUERTO 3008
// ======================================================================

if (!isVercel) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`======================================================================`);
    console.log(`QUANTUM FX: SERVIDOR NODE.JS ACTIVO`);
    console.log(`Web Dashboard: http://localhost:${PORT}`);
    console.log(`WebSocket:     ws://localhost:${PORT}/ws`);
    console.log(`Identidades:   ${identities.length} Titulares KYC cargados`);
    console.log(`======================================================================`);
  });
}

if (process.parentPort) {
  process.parentPort.on('message', event => {
    if (event.data?.type !== 'shutdown') return;
    for (const client of wss.clients) client.close(1001, 'Desktop app closing');
    wss.close();
    server.close(() => {
      database.close();
      process.exit(0);
    });
  });
}

server.app = app;
module.exports = server;
