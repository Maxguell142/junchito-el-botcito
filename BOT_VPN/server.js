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

// Servir la carpeta public sin modificar sus archivos:
// - Directamente en la raíz (ej. /index.html)
// - Y bajo el prefijo /static (requerido por las referencias <link> y <script> en index.html)
app.use('/static', express.static(publicPath));
app.use(express.static(publicPath));

// Ruta principal para servir el archivo index.html de la carpeta public
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// ======================================================================
// ESTADO EN MEMORIA Y TELEMETRÍA (QUANTUM FX)
// ======================================================================

let configData = { server: { port: PORT }, bots: [] };
try {
  const configFile = path.join(__dirname, 'config.json');
  if (fs.existsSync(configFile)) {
    configData = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  }
} catch (err) {
  console.warn('[WARN] No se pudo leer config.json, usando valores por defecto:', err.message);
}

// Inicializar lista reactiva de bots
let bots = (configData.bots || []).map(b => ({
  id: b.id,
  name: b.name,
  strategy: b.strategy,
  proxy_url: b.proxy_url || '',
  status: b.status || 'ACTIVE',
  schedule: b.schedule || { start_time: '09:30', end_time: '12:00', timezone: 'America/New_York' },
  accounts: (b.accounts || []).map(a => ({
    id: a.id,
    custom_name: a.custom_name,
    broker: a.broker || 'Tradovate',
    prop_firm: a.prop_firm || 'Apex Trader Funding',
    balance: a.balance || 50000.0,
    floating_pnl: a.floating_pnl || 0.0,
    realized_pnl: a.realized_pnl || 0.0,
    active_contracts: a.active_contracts || 0,
    current_position: a.current_position || 'FLAT',
    entry_price: a.entry_price || 0.0,
    status: a.status || 'CONNECTED',
    last_order_time: null
  })),
  net_pnl: 0.0,
  total_active_contracts: 0,
  execution_count: 0,
  recent_logs: [
    `[${new Date().toLocaleTimeString()}] Bot inicializado en el orquestador Node.js (Puerto ${PORT}).`
  ]
}));

let marketPrice = 18245.50;

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
      total_active_contracts: totalContracts
    },
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
    if (client.readyState === 1) { // 1 = OPEN
      client.send(payload);
    }
  });
}

// Simulación de fluctuación de mercado en vivo y reloj NY cada 1 seg
setInterval(() => {
  const delta = (Math.random() - 0.49) * 0.75;
  marketPrice = Number((marketPrice + delta).toFixed(2));
  broadcastSnapshot();
}, 1000);

wss.on('connection', ws => {
  console.log('[WebSocket] Cliente conectado al Dashboard.');
  ws.send(JSON.stringify(getSystemSnapshot()));

  ws.on('message', message => {
    try {
      const data = JSON.parse(message);
      if (data.action === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch (e) {
      // Ignorar mensajes malformados
    }
  });
});

// Manejo del upgrade HTTP a WebSocket en la ruta /ws
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

app.post('/api/bots/:id/toggle', (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  bot.status = bot.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
  const now = new Date().toLocaleTimeString();
  bot.recent_logs.unshift(`[${now}] Estado cambiado a: ${bot.status}`);
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
  bot.recent_logs.unshift(`[${now}] Horario actualizado: ${bot.schedule.start_time} - ${bot.schedule.end_time}`);
  broadcastSnapshot();
  res.json({ message: 'Horario actualizado con éxito', schedule: bot.schedule });
});

app.post('/api/bots/:id/close', (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  bot.accounts.forEach(acc => {
    acc.active_contracts = 0;
    acc.current_position = 'FLAT';
    acc.floating_pnl = 0.0;
  });
  bot.total_active_contracts = 0;
  const now = new Date().toLocaleTimeString();
  bot.recent_logs.unshift(`[${now}] Cierre forzado de todas las posiciones (FLAT).`);
  broadcastSnapshot();
  res.json({ message: 'Posiciones cerradas para el bot ' + bot.id });
});

app.post('/api/bots/:id/accounts', (req, res) => {
  const bot = bots.find(b => b.id === req.params.id);
  if (!bot) return res.status(404).json({ detail: 'Bot no encontrado' });

  const { id, custom_name, broker, prop_firm, balance } = req.body;
  if (!id || !custom_name) return res.status(400).json({ detail: 'Faltan campos requeridos' });

  const newAcc = {
    id,
    custom_name,
    broker: broker || 'Tradovate',
    prop_firm: prop_firm || 'Apex Trader Funding',
    balance: Number(balance) || 50000.0,
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
  bot.recent_logs.unshift(`[${now}] Nueva cuenta conectada: ${custom_name} (${prop_firm})`);
  broadcastSnapshot();
  res.json({ message: 'Cuenta agregada con éxito', account: newAcc });
});

app.post('/api/test-signal', (req, res) => {
  const { action, price, contracts } = req.body;
  const signalAction = action || 'BUY';
  const signalPrice = Number(price) || marketPrice;
  const numContracts = Number(contracts) || 1;
  const now = new Date().toLocaleTimeString();

  bots.filter(b => b.status === 'ACTIVE').forEach(bot => {
    bot.execution_count += 1;
    bot.accounts.forEach(acc => {
      acc.current_position = signalAction === 'BUY' ? 'LONG' : 'SHORT';
      acc.active_contracts = numContracts;
      acc.entry_price = signalPrice;
      acc.floating_pnl = Number(((Math.random() * 40 - 10) * numContracts).toFixed(2));
      acc.last_order_time = now;
    });
    bot.total_active_contracts = bot.accounts.reduce((sum, a) => sum + a.active_contracts, 0);
    bot.net_pnl = Number(bot.accounts.reduce((sum, a) => sum + a.floating_pnl, 0).toFixed(2));
    bot.recent_logs.unshift(`[${now}] TEST ${signalAction} ejecutado @ ${signalPrice} (${numContracts} ctos).`);
  });

  broadcastSnapshot();
  res.json({
    status: 'EXECUTED',
    message: `Señal ${signalAction} simulada con éxito en ${signalPrice}`
  });
});

app.post('/api/bots', (req, res) => {
  const { id, name, strategy, proxy_url, start_time, end_time, accounts } = req.body;
  if (!id || !name) return res.status(400).json({ detail: 'ID y Nombre son obligatorios' });

  if (bots.some(b => b.id === id)) {
    return res.status(400).json({ detail: `Ya existe un bot con id '${id}'` });
  }

  const newBot = {
    id,
    name,
    strategy: strategy || 'ICTStrategy',
    proxy_url: proxy_url || '',
    status: 'ACTIVE',
    schedule: {
      start_time: start_time || '09:30',
      end_time: end_time || '12:00',
      timezone: 'America/New_York'
    },
    accounts: (accounts || []).map(a => ({
      id: a.id || `acc_${id}_1`,
      custom_name: a.custom_name || `${name} Primaria`,
      broker: a.broker || 'Tradovate',
      prop_firm: a.prop_firm || 'Apex Trader Funding',
      balance: a.balance || 50000.0,
      floating_pnl: 0.0,
      realized_pnl: 0.0,
      active_contracts: 0,
      current_position: 'FLAT',
      entry_price: 0.0,
      status: 'CONNECTED',
      last_order_time: null
    })),
    net_pnl: 0.0,
    total_active_contracts: 0,
    execution_count: 0,
    recent_logs: [
      `[${new Date().toLocaleTimeString()}] Bot creado e inyectado con éxito.`
    ]
  };

  bots.push(newBot);
  broadcastSnapshot();
  res.status(201).json({ message: 'Bot creado exitosamente', bot: newBot });
});

// ======================================================================
// INICIO DEL SERVIDOR EN PUERTO 3008
// ======================================================================

server.listen(PORT, () => {
  console.log(`======================================================================`);
  console.log(`🚀 QUANTUM FX: SERVIDOR NODE.JS + EXPRESS ACTIVO`);
  console.log(`📍 Web Dashboard: http://localhost:${PORT}`);
  console.log(`⚡ WebSocket:     ws://localhost:${PORT}/ws`);
  console.log(`📁 Carpeta:       public/`);
  console.log(`======================================================================`);
});
