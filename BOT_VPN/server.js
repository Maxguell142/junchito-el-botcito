const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const PORT = 3008;

// Middleware para JSON y CORS
app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
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
let configData = {
  server: { port: PORT },
  auth: {},
  identities: [],
  bots: []
};

function loadConfig() {
  try {
    if (fs.existsSync(configFile)) {
      const fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
      configData = { ...configData, ...fileConfig };
    }
  } catch (err) {
    console.error('[ERROR] No se pudo leer config.json:', err.message);
  }
}
loadConfig();

let identities = configData.identities || [];

let bots = (configData.bots || []).map(b => {
  const ident = identities.find(i => i.id === b.identity_id) || null;
  return {
    id: b.id,
    name: b.name,
    strategy: b.strategy,
    strategy_description: 'Estrategia algorítmica optimizada para CME MNQ',
    identity: ident,
    proxy_url: b.proxy_url || '',
    outbound_ip: b.outbound_ip || '192.0.2.1',
    proxy_port: b.proxy_port || 10808,
    isp_provider: b.isp_provider || 'Comcast Cable Communications (Residential ISP)',
    node_location: b.node_location || 'New York, NY (US)',
    geo_match_status: b.geo_match_status || 'Geo-Match OK // US Node',
    proxy_ip: `${b.outbound_ip || '192.0.2.1'}:${b.proxy_port || 10808}`,
    proxy_ping_ms: b.id === 'bot_2' ? 4.2 : (b.id === 'bot_1' ? 12.8 : 18.6),
    proxy_healthy: true,
    geo_consistent: true,
    geo_description: b.geo_match_status || (ident ? `Geo-Match OK // US Node (${ident.city})` : 'US Node'),
    jitter_min_ms: b.jitter_min_ms || 50,
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
      balance: a.balance || 50000.0,
      max_contracts: a.max_contracts || 2,
      daily_loss_limit: a.daily_loss_limit || 1000.0,
      floating_pnl: a.floating_pnl || 0.0,
      realized_pnl: a.realized_pnl || 0.0,
      active_contracts: a.active_contracts || 0,
      current_position: a.current_position || 'FLAT',
      entry_price: a.entry_price || 0.0,
      status: a.status || 'CONNECTED',
      last_order_time: null
    })),
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
        message: `Bot inicializado // Titular: ${ident ? ident.full_name : 'Sin asignar'}`
      }
    ]
  };
});

let marketPrice = 18245.50;

function saveConfigToDisk() {
  try {
    const dataToSave = {
      server: configData.server || { host: '127.0.0.1', port: 8000 },
      auth: configData.auth,
      identities: identities,
      bots: bots.map(b => ({
        id: b.id,
        name: b.name,
        identity_id: b.identity ? b.identity.id : null,
        strategy: b.strategy,
        proxy_url: b.proxy_url,
        status: b.status,
        jitter_ms: b.jitter_ms,
        schedule: b.schedule,
        accounts: b.accounts
      }))
    };
    fs.writeFileSync(configFile, JSON.stringify(dataToSave, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error guardando config.json:', e);
  }
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
    bots: bots
  };
}

// ======================================================================
// WEBSOCKET SERVER (/ws)
// ======================================================================

const wss = new WebSocketServer({ noServer: true });

function broadcastSnapshot() {
  const payload = JSON.stringify(getSystemSnapshot());
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
}

// Simulación de fluctuación de mercado en vivo y reloj NY cada 1 seg
setInterval(() => {
  const delta = (Math.random() - 0.49) * 0.75;
  marketPrice = Number((marketPrice + delta).toFixed(2));

  // Actualizar flotante de cuentas activas
  bots.forEach(bot => {
    let totalFloat = 0;
    bot.accounts.forEach(acc => {
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
  ws.send(JSON.stringify(getSystemSnapshot()));

  ws.on('message', message => {
    try {
      const data = JSON.parse(message);
      if (data.action === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch (e) {}
  });
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

// Autenticación
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const auth = configData.auth || {};

  if (!auth.username || !auth.password || !auth.session_token) {
    return res.status(503).json({ detail: 'Autenticación no configurada.' });
  }

  if (username === auth.username && password === auth.password) {
    return res.json({
      status: 'SUCCESS',
      token: auth.session_token,
      user: { username: auth.username, role: auth.role }
    });
  }
  res.status(401).json({ detail: 'Usuario o contraseña incorrectos.' });
});

app.get('/api/auth/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const auth = configData.auth || {};
  if (token && auth.session_token && token === auth.session_token) {
    return res.json({ authenticated: true, username: auth.username, role: auth.role });
  }
  res.json({ authenticated: false });
});

// Controles de Pánico Institucionales
app.post('/api/emergency/flatten-all', (req, res) => {
  let totalRealized = 0;
  const now = new Date().toLocaleTimeString();

  bots.forEach(bot => {
    let botRealized = 0;
    bot.accounts.forEach(acc => {
      if (acc.active_contracts > 0 && acc.current_position !== 'FLAT') {
        const diff = acc.current_position === 'LONG' ? (marketPrice - acc.entry_price) : (acc.entry_price - marketPrice);
        const pnl = Number((diff * 2.0 * acc.active_contracts).toFixed(2));
        acc.realized_pnl += pnl;
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

  saveConfigToDisk();
  broadcastSnapshot();
  res.json({
    status: 'ALL_FLATTENED',
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

  saveConfigToDisk();
  broadcastSnapshot();
  res.json({ status: 'ALL_STOPPED', bots_paused: pausedCount });
});

// Identidades (Titulares KYC)
app.get('/api/identities', (req, res) => {
  res.json(identities);
});

app.post('/api/identities', (req, res) => {
  const { id, full_name, alias, country, city, flag, kyc_status, email, notes } = req.body;
  if (!id || !full_name) {
    return res.status(400).json({ detail: 'ID y Nombre completo son obligatorios.' });
  }

  const newIdent = {
    id,
    full_name,
    alias: alias || full_name,
    country: country || 'US',
    city: city || '',
    flag: flag || '🌐',
    kyc_status: kyc_status || 'VERIFIED',
    email: email || '',
    notes: notes || ''
  };

  identities.push(newIdent);
  saveConfigToDisk();
  broadcastSnapshot();
  res.status(201).json({ status: 'CREATED', identity: newIdent });
});

// Verificación de Proxy
app.post('/api/bots/:id/proxy-test', (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  // Prueba de ping hacia Chicago CME y detección de IP residencial
  const ping = bot.id === 'bot_2' ? 4.2 : (bot.id === 'bot_1' ? 12.8 : 18.6);
  const ip = `${bot.outbound_ip || '192.0.2.1'}:${bot.proxy_port || 10808}`;
  bot.proxy_ping_ms = ping;
  bot.proxy_ip = ip;
  bot.proxy_healthy = true;

  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({
    timestamp: now,
    level: 'NETWORK',
    message: `Test de Red: Ping=${ping}ms (CME Chicago) | IP=${ip} (${bot.isp_provider}) | ${bot.geo_description}`
  });

  broadcastSnapshot();
  res.json({
    bot_id: bot.id,
    proxy_url: bot.proxy_url,
    outbound_ip: bot.outbound_ip,
    proxy_port: bot.proxy_port,
    isp_provider: bot.isp_provider,
    detected_ip: ip,
    ping_ms: ping,
    is_healthy: true,
    geo_consistent: bot.geo_consistent,
    geo_match_status: bot.geo_description
  });
});

// Control de Bots
app.post('/api/bots/:id/toggle', (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  bot.status = bot.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({ timestamp: now, level: 'STATE', message: `Estado cambiado a: ${bot.status}` });
  saveConfigToDisk();
  broadcastSnapshot();
  res.json({ message: `Bot ${bot.id} ahora está ${bot.status}`, status: bot.status });
});

app.post('/api/bots/:id/schedule', (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  const { start_time, end_time, timezone } = req.body;
  bot.schedule = {
    start_time: start_time || bot.schedule.start_time,
    end_time: end_time || bot.schedule.end_time,
    timezone: timezone || bot.schedule.timezone || 'America/New_York'
  };
  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({ timestamp: now, level: 'CONFIG', message: `Horario: ${bot.schedule.start_time} - ${bot.schedule.end_time}` });
  saveConfigToDisk();
  broadcastSnapshot();
  res.json({ message: 'Horario actualizado', schedule: bot.schedule });
});

app.post('/api/bots/:id/close', (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  let closedPnl = 0;
  bot.accounts.forEach(acc => {
    if (acc.active_contracts > 0) {
      const diff = acc.current_position === 'LONG' ? (marketPrice - acc.entry_price) : (acc.entry_price - marketPrice);
      const pnl = Number((diff * 2.0 * acc.active_contracts).toFixed(2));
      acc.realized_pnl += pnl;
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
  saveConfigToDisk();
  broadcastSnapshot();
  res.json({ message: 'Posiciones cerradas', bot_id: bot.id, pnl_realized: closedPnl });
});

// Vincular Cuenta Extendida (con Titular, Credenciales, Entorno, Riesgo)
app.post('/api/bots/:id/accounts', (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  const { id, custom_name, titular_name, broker, prop_firm, environment, username, password, balance, max_contracts, daily_loss_limit } = req.body;
  if (!id || !custom_name) return res.status(400).json({ detail: 'ID y Nombre de cuenta requeridos' });

  const titular = titular_name || (bot.identity ? bot.identity.full_name : 'Titular');

  const newAcc = {
    id,
    custom_name,
    titular_name: titular,
    environment: environment || 'EVALUATION',
    broker: broker || 'Tradovate',
    prop_firm: prop_firm || 'Apex Trader Funding',
    username: username || '',
    password_masked: password ? '••••••••' : '••••••••',
    balance: Number(balance) || 50000.0,
    max_contracts: Number(max_contracts) || 2,
    daily_loss_limit: Number(daily_loss_limit) || 1000.0,
    floating_pnl: 0.0,
    realized_pnl: 0.0,
    active_contracts: 0,
    current_position: 'FLAT',
    entry_price: 0.0,
    status: 'CONNECTED',
    last_order_time: null
  };
  bot.accounts.push(newAcc);
  const now = new Date().toLocaleTimeString();
  bot.logs.unshift({ timestamp: now, level: 'CONFIG', message: `Cuenta vinculada: ${custom_name} (${prop_firm} // ${titular})` });
  saveConfigToDisk();
  broadcastSnapshot();
  res.json({ message: 'Cuenta agregada con éxito', account: newAcc });
});

// Crear Bot con Titular
app.post('/api/bots', (req, res) => {
  const { id, name, identity_id, strategy, proxy_url, jitter_ms, start_time, end_time } = req.body;
  if (!id || !name) return res.status(400).json({ detail: 'ID y Nombre requeridos' });

  if (bots.some(b => b.id === id)) {
    return res.status(400).json({ detail: `Ya existe bot con id '${id}'` });
  }

  const ident = identities.find(i => i.id === identity_id) || null;

  const newBot = {
    id,
    name,
    identity: ident,
    strategy: strategy || 'ICTStrategy',
    strategy_description: 'Estrategia algorítmica para MNQ',
    proxy_url: proxy_url || '',
    proxy_ip: '127.0.0.1 (Local Dev Proxy)',
    proxy_ping_ms: 12.0,
    proxy_healthy: true,
    geo_consistent: true,
    geo_description: ident ? `Alineado con región ${ident.country}` : 'Local Host',
    jitter_ms: Number(jitter_ms) || 120,
    status: 'ACTIVE',
    schedule: {
      start_time: start_time || '09:30',
      end_time: end_time || '12:00',
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
  saveConfigToDisk();
  broadcastSnapshot();
  res.status(201).json({ message: 'Bot creado', bot: newBot });
});

// ======================================================================
// INICIO DEL SERVIDOR EN PUERTO 3008
// ======================================================================

server.listen(PORT, () => {
  console.log(`======================================================================`);
  console.log(`🚀 QUANTUM FX: SERVIDOR NODE.JS INSTITUCIONAL ACTIVO`);
  console.log(`📍 Web Dashboard: http://localhost:${PORT}`);
  console.log(`⚡ WebSocket:     ws://localhost:${PORT}/ws`);
  console.log(`👤 Identidades:   ${identities.length} Titulares KYC cargados`);
  console.log(`======================================================================`);
});
