const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { SQLiteStore } = require('./database');
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
const PORT = Number(process.env.PORT || 3008);
const SESSION_TTL_MS = 30 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
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

function hasValidSessionToken(token) {
  if (typeof token !== 'string' || token.length > 256) return false;
  const session = sessions.get(token);
  if (!session) return false;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }
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
    return res.status(429).json({ detail: 'Demasiados intentos. Espera 15 minutos.' });
  }
  next();
}

app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login' || req.path === '/auth/me') {
    return next();
  }

  const authorization = req.get('authorization') || '';
  const match = /^Bearer (.+)$/i.exec(authorization);
  if (!match || !hasValidSessionToken(match[1])) {
    return res.status(401).json({ detail: 'Autenticación requerida.' });
  }
  try {
    refreshConfigIfChanged();
    next();
  } catch (error) {
    next(error);
  }
});

// Ruta a la carpeta estática 'public'
const publicPath = path.join(__dirname, 'public');
app.use('/static', express.static(publicPath));
app.use(express.static(publicPath));

app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ======================================================================
// ESTADO EN MEMORIA Y TELEMETRÍA (QUANTUM FX)
// ======================================================================

const configFile = path.join(__dirname, 'config.json');
const database = new SQLiteStore(process.env.BOT_VPN_DB_PATH || path.join(__dirname, 'bot_vpn.sqlite3'));
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
  const ident = identities.find(i => i.id === b.identity_id) || null;
  return {
    id: b.id,
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
    isp_provider: 'No verificado',
    node_location: 'No verificado',
    geo_match_status: 'No verificado',
    proxy_ip: b.outbound_ip || '',
    proxy_ping_ms: 0,
    proxy_healthy: false,
    geo_consistent: false,
    geo_description: 'No verificado',
    jitter_min_ms: b.jitter_min_ms || b.jitter_ms || 50,
    jitter_max_ms: b.jitter_max_ms || 350,
    status: b.status || 'ACTIVE',
    schedule: b.schedule || { start_time: '09:30', end_time: '12:00', timezone: 'America/New_York' },
    accounts: (b.accounts || []).map(a => ({
      id: a.id,
      custom_name: a.custom_name,
      titular_name: a.titular_name || (ident ? ident.full_name : 'Titular'),
      environment: a.environment || 'EVALUATION',
      broker: a.broker || 'Tradovate',
      prop_firm: a.prop_firm || 'Apex Trader Funding',
      username: a.username || '',
      password_masked: a.password_masked || '••••••••',
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
      status: a.status === 'CONNECTED' ? 'NOT_CONFIGURED' : (a.status || 'NOT_CONFIGURED'),
      last_order_time: a.last_order_time || null
    })),
    net_pnl: b.net_pnl || 0.0,
    today_pnl: b.today_pnl || 0.0,
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
        message: `Bot inicializado // Titular: ${ident ? ident.full_name : 'Sin asignar'}`
      }
    ]
  };
}

function loadConfig() {
  const legacyConfig = fs.existsSync(configFile)
    ? JSON.parse(fs.readFileSync(configFile, 'utf-8'))
    : { server: { port: PORT }, identities: [], bots: [] };
  const loaded = database.loadOrImport(legacyConfig);
  persistenceRevision = loaded.revision;
  configData = {
    ...loaded.snapshot,
    server: { host: '127.0.0.1', port: PORT },
    auth: {
      username: process.env.BOT_VPN_AUTH_USERNAME || '',
      password: process.env.BOT_VPN_AUTH_PASSWORD || '',
      role: loaded.snapshot.auth.role || 'ADMIN_TRADER'
    }
  };
  identities = configData.identities || [];
  bots = (configData.bots || []).map(toRuntimeBot);
}
loadConfig();

let marketPrice = 18245.50;

function getAnalysisResultsForConfiguredBots() {
  const results = [];
  const analysisCache = new Map();
  for (const bot of bots) {
    const dataset = analysisDatasets.get(bot.analysis_symbol);
    if (!dataset) continue;
    const pairedSymbol = bot.analysis_symbol === 'NQ' ? 'ES' : 'NQ';
    const pairedDataset = analysisDatasets.get(pairedSymbol) || null;
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
    identities,
    bots: bots.map(b => ({
        id: b.id,
        name: b.name,
        identity_id: b.identity ? b.identity.id : null,
        strategy: b.strategy,
        analysis_symbol: b.analysis_symbol,
        analysis_timeframes: b.analysis_timeframes,
        proxy_url: sanitizeProxyUrl(b.proxy_url),
        status: b.status,
        jitter_ms: b.jitter_ms,
        jitter_min_ms: b.jitter_min_ms,
        jitter_max_ms: b.jitter_max_ms,
        schedule: b.schedule,
        net_pnl: b.net_pnl,
        today_pnl: b.today_pnl,
        total_trades: b.total_trades,
        winning_trades: b.winning_trades,
        losing_trades: b.losing_trades,
        max_drawdown: b.max_drawdown,
        accounts: b.accounts.map(account => ({
          ...account,
          username: account.username ? '••••' : ''
        }))
      }))
  };
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

function getSystemSnapshot() {
  const totalPnl = bots.reduce((sum, b) => sum + (b.net_pnl || 0), 0);
  const activeBotsCount = bots.filter(b => b.status === 'ACTIVE').length;
  const totalContracts = bots.reduce((sum, b) => sum + (b.total_active_contracts || 0), 0);

  return {
    type: 'SNAPSHOT',
    execution_mode: 'SIMULATED',
    paper_trading_available: false,
    risk_policy: { type: 'DEMO_ONLY', limits: DEMO_RISK_LIMITS },
    market_price_mnq: marketPrice,
    ny_time: getNewYorkTimeString(),
    global_stats: {
      total_pnl: Number(totalPnl.toFixed(2)),
      active_bots: activeBotsCount,
      total_bots: bots.length,
      total_active_contracts: totalContracts,
      total_identities: identities.length
    },
    identities: identities,
    bots: bots.map(bot => ({
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

// ======================================================================
// WEBSOCKET SERVER (/ws)
// ======================================================================

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });

function broadcastSnapshot() {
  const payload = JSON.stringify(getSystemSnapshot());
  wss.clients.forEach(client => {
    if (client.isAuthenticated && client.readyState === 1) {
      if (!hasValidSessionToken(client.sessionToken)) {
        client.close(4401, 'Session expired');
      } else {
        client.send(payload);
      }
    }
  });
}

// Simulación de fluctuación de mercado en vivo y reloj NY cada 1 seg
setInterval(() => {
  try {
    refreshConfigIfChanged();
  } catch (error) {
    console.error('[ERROR] No se pudo actualizar el estado SQLite.');
  }
  const delta = (Math.random() - 0.49) * 0.75;
  marketPrice = Number((marketPrice + delta).toFixed(2));

  // Actualizar flotante de cuentas activas
  bots.forEach(bot => {
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
      clearTimeout(authTimeout);
      try {
        refreshConfigIfChanged();
      } catch {
        ws.close(1011, 'Persistent state unavailable');
        return;
      }
      ws.send(JSON.stringify(getSystemSnapshot()));
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
  res.json(getSystemSnapshot());
});

app.get('/api/analysis/status', (req, res) => {
  latestAnalysisResults = getAnalysisResultsForConfiguredBots();
  res.json({
    source: 'CSV histórico importado',
    data_type: 'HISTORICAL',
    datasets: Object.fromEntries([...analysisDatasets].map(([symbol, dataset]) => [
      symbol,
      {
        source_timeframe: dataset.sourceTimeframe,
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
    let dataset;
    try {
      dataset = parseCsv(req.body, symbol, sourceTimeframe);
    } catch (error) {
      return res.status(400).json({ detail: error.message });
    }

    dataset.importedAt = new Date().toISOString();
    analysisDatasets.set(symbol, dataset);
    latestAnalysisResults = getAnalysisResultsForConfiguredBots();
    return res.json({
      symbol,
      source_timeframe: sourceTimeframe,
      candles: dataset.bars.length,
      imported_at: dataset.importedAt,
      data_type: 'HISTORICAL',
      results: latestAnalysisResults
    });
  }
);

app.get('/healthz', (req, res, next) => {
  try {
    if (!database.healthCheck()) {
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
    return next(error);
  }
});

// Autenticación
app.post('/api/auth/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  const auth = configData.auth || {};

  if (typeof username !== 'string' || username.length > 128
    || typeof password !== 'string' || password.length > 1024) {
    return res.status(400).json({ detail: 'Credenciales inválidas.' });
  }
  if (!auth.username || !auth.password) {
    return res.status(503).json({ detail: 'Autenticación no configurada.' });
  }

  if (secureEqual(username, auth.username) && secureEqual(password, auth.password)) {
    const key = req.socket.remoteAddress || 'unknown';
    loginAttempts.delete(key);
    for (const [activeToken, session] of sessions) {
      if (session.expiresAt <= Date.now()) sessions.delete(activeToken);
    }
    const token = crypto.randomBytes(32).toString('base64url');
    sessions.set(token, { username: auth.username, role: auth.role || 'ADMIN_TRADER', expiresAt: Date.now() + SESSION_TTL_MS });
    return res.json({
      status: 'SUCCESS',
      token,
      expires_in: SESSION_TTL_MS / 1000,
      user: { username: auth.username, role: auth.role || 'ADMIN_TRADER' }
    });
  }
  const key = req.socket.remoteAddress || 'unknown';
  loginAttempts.get(key).count += 1;
  res.status(401).json({ detail: 'Usuario o contraseña incorrectos.' });
});

app.get('/api/auth/me', (req, res) => {
  const token = getBearerToken(req);
  const session = sessions.get(token);
  if (hasValidSessionToken(token) && session) {
    return res.json({ authenticated: true, username: session.username, role: session.role });
  }
  res.status(401).json({ authenticated: false });
});

app.post('/api/auth/logout', (req, res) => {
  revokeSession(getBearerToken(req));
  res.sendStatus(204);
});

// Controles de Pánico Institucionales
app.post('/api/emergency/flatten-all', (req, res) => {
  let totalRealized = 0;
  const now = new Date().toLocaleTimeString();

  bots.forEach(bot => {
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
  }, bots.map(bot => ({
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

  bots.forEach(bot => {
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
  res.json(identities);
});

app.post('/api/identities', (req, res) => {
  const { id, full_name, alias, country, city, flag, kyc_status, email, notes } = req.body || {};
  if (!isValidId(id) || typeof full_name !== 'string' || !full_name.trim() || full_name.length > 160) {
    return res.status(400).json({ detail: 'ID o nombre inválido.' });
  }
  if ((alias !== undefined && (typeof alias !== 'string' || alias.length > 160))
    || (country !== undefined && (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)))
    || (city !== undefined && (typeof city !== 'string' || city.length > 120))
    || (email !== undefined && (typeof email !== 'string' || email.length > 254))
    || (notes !== undefined && (typeof notes !== 'string' || notes.length > 1000))
    || (kyc_status !== undefined && !['VERIFIED', 'PENDING', 'REJECTED'].includes(kyc_status))) {
    return res.status(400).json({ detail: 'Datos de identidad inválidos.' });
  }
  if (identities.some(identity => identity.id === id)) {
    return res.status(400).json({ detail: 'Esta identidad ya existe.' });
  }

  const newIdent = {
    id,
    full_name,
    alias: alias || full_name,
    country: country || 'US',
    city: city || '',
    flag: flag || '🌐',
    kyc_status: kyc_status || 'PENDING',
    email: email || '',
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

// Verificación de Proxy
app.post('/api/bots/:id/proxy-test', (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  bot.proxy_ping_ms = 0;
  bot.proxy_healthy = false;
  bot.geo_consistent = false;

  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({
    timestamp: now,
    level: 'WARNING',
    message: 'La verificación real del proxy no está implementada en el servidor Node.'
  });

  broadcastSnapshot();
  res.status(501).json({
    status: 'UNAVAILABLE',
    bot_id: bot.id,
    proxy_url: sanitizeProxyUrl(bot.proxy_url),
    detected_ip: null,
    ping_ms: null,
    is_healthy: false,
    geo_consistent: false,
    message: 'La verificación real del proxy no está implementada en el servidor Node.'
  });
});

// Control de Bots
app.post('/api/bots/:id/toggle', (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
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

app.post('/api/bots/:id/schedule', (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
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
  const bot = bots.find(b => b.id === req.params.id);
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
  const bot = bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  const { id, custom_name, titular_name, broker, prop_firm, environment, username, password, balance, max_contracts, daily_loss_limit } = req.body || {};
  if (!isValidId(id) || typeof custom_name !== 'string' || !custom_name.trim() || custom_name.length > 160) {
    return res.status(400).json({ detail: 'ID y nombre de cuenta inválidos.' });
  }
  if (bot.accounts.some(account => account.id === id)) {
    return res.status(400).json({ detail: 'Esta cuenta ya existe en el bot.' });
  }
  if (username || password) {
    return res.status(400).json({ detail: 'No se aceptan credenciales de broker hasta implementar un gestor seguro.' });
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

  const newAcc = {
    id,
    custom_name,
    titular_name: titular,
    environment: environment || 'EVALUATION',
    broker: broker || 'Tradovate',
    prop_firm: prop_firm || 'Apex Trader Funding',
    username: '',
    password_masked: '',
    balance: parsedBalance,
    max_contracts: parsedContracts,
    daily_loss_limit: parsedLossLimit,
    floating_pnl: 0.0,
    realized_pnl: 0.0,
    active_contracts: 0,
    current_position: 'FLAT',
    entry_price: 0.0,
    status: 'NOT_CONFIGURED',
    last_order_time: null
  };
  bot.accounts.push(newAcc);
  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({ timestamp: now, level: 'CONFIG', message: `Cuenta vinculada: ${custom_name} (${prop_firm} // ${titular})` });
  saveConfigToDisk({
    action: 'account_added',
    entity_type: 'account',
    entity_id: newAcc.id,
    details: { bot_id: bot.id }
  });
  broadcastSnapshot();
  res.json({
    message: 'Cuenta agregada con éxito',
    account: { ...newAcc, username: '' }
  });
});

// Crear Bot con Titular
app.post('/api/bots', (req, res) => {
  const body = req.body || {};
  const { id, name, identity_id, strategy, proxy_url, jitter_ms, start_time, end_time } = body;
  if (!isValidId(id) || typeof name !== 'string' || !name.trim() || name.length > 160) {
    return res.status(400).json({ detail: 'ID y nombre inválidos.' });
  }
  if (Object.hasOwn(body, 'accounts')) {
    return res.status(400).json({ detail: 'Crea las cuentas por separado sin incluir credenciales.' });
  }
  const selectedStrategy = strategy || 'ICTStrategy';
  const analysisSymbol = body.analysis_symbol === undefined ? 'NQ' : body.analysis_symbol;
  const analysisTimeframes = body.analysis_timeframes === undefined
    ? DEFAULT_ANALYSIS_TIMEFRAMES
    : body.analysis_timeframes;
  if (!Object.hasOwn(STRATEGIES, selectedStrategy)) {
    return res.status(400).json({ detail: 'Estrategia no válida.' });
  }
  if (!['NQ', 'ES'].includes(analysisSymbol) || !validAnalysisTimeframes(analysisTimeframes)) {
    return res.status(400).json({ detail: 'Instrumento o intervalos de análisis no válidos.' });
  }
  const parsedJitter = jitter_ms === undefined ? 120 : Number(jitter_ms);
  const requestedStart = start_time === undefined ? '09:30' : start_time;
  const requestedEnd = end_time === undefined ? '12:00' : end_time;
  if (!Number.isInteger(parsedJitter) || parsedJitter < 0 || parsedJitter > 5000
    || !isValidTime(requestedStart) || !isValidTime(requestedEnd)) {
    return res.status(400).json({ detail: 'Horario o jitter inválidos.' });
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

  const ident = identities.find(i => i.id === identity_id) || null;

  const newBot = {
    id,
    name,
    identity: ident,
    strategy: selectedStrategy,
    analysis_symbol: analysisSymbol,
    analysis_timeframes: [...analysisTimeframes],
    strategy_description: 'Estrategia algorítmica para MNQ',
    proxy_url: proxy_url || '',
    proxy_ip: '',
    proxy_ping_ms: 0,
    proxy_healthy: false,
    geo_consistent: false,
    geo_description: 'No verificado',
    jitter_ms: parsedJitter,
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
    logs: [
      {
        timestamp: new Date().toLocaleTimeString(),
        level: 'INFO',
        message: `Bot creado con éxito // Titular: ${ident ? ident.full_name : 'Sin asignar'}`
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`======================================================================`);
  console.log(`🚀 QUANTUM FX: SERVIDOR NODE.JS INSTITUCIONAL ACTIVO`);
  console.log(`📍 Web Dashboard: http://localhost:${PORT}`);
  console.log(`⚡ WebSocket:     ws://localhost:${PORT}/ws`);
  console.log(`👤 Identidades:   ${identities.length} Titulares KYC cargados`);
  console.log(`======================================================================`);
});
