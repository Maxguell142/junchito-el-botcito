/**
 * app.js - Cliente Vanilla JS para el Orquestador Multi-Bot QUANTUM FX
 * 
 * Gestiona:
 * 1. Conexión WebSocket bidireccional y auto-reconexión.
 * 2. Renderizado reactivo en tiempo real del grid de tarjetas de bots.
 * 3. Inspección detallada con KPIs, consola de logs autoscroll y tabla de cuentas.
 * 4. Peticiones REST para control de bots, horarios, cuentas y señales de test.
 */

// Estado de la aplicación
const state = {
  bots: [],
  selectedBotId: null,
  activeFilter: 'ALL',
  marketPrice: 18245.50,
  wsConnected: false
};

let ws = null;
let reconnectTimer = null;

// ======================================================================
// CONEXIÓN WEBSOCKET
// ======================================================================

function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  updateWsStatus('Conectando...', false);

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      state.wsConnected = true;
      updateWsStatus('En Línea', true);
      clearTimeout(reconnectTimer);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'SNAPSHOT') {
          handleStateSnapshot(data);
        }
      } catch (err) {
        console.error('Error parseando mensaje WebSocket:', err);
      }
    };

    ws.onclose = () => {
      state.wsConnected = false;
      updateWsStatus('Reconectando...', false);
      reconnectTimer = setTimeout(initWebSocket, 2000);
    };

    ws.onerror = (err) => {
      state.wsConnected = false;
      updateWsStatus('Error de Red', false);
    };
  } catch (err) {
    updateWsStatus('Desconectado', false);
    reconnectTimer = setTimeout(initWebSocket, 2000);
  }
}

function updateWsStatus(text, connected) {
  const container = document.getElementById('ws-status');
  if (!container) return;
  const label = container.querySelector('.ws-text');
  label.textContent = text;
  if (connected) {
    container.classList.add('ws-connected');
  } else {
    container.classList.remove('ws-connected');
  }
}

// ======================================================================
// GESTIÓN DEL ESTADO Y RENDERIZADO
// ======================================================================

function handleStateSnapshot(snapshot) {
  state.bots = snapshot.bots || [];
  state.marketPrice = snapshot.market_price_mnq || 18245.50;

  // Actualizar Header Global
  const priceElem = document.getElementById('market-price-val');
  if (priceElem) priceElem.textContent = state.marketPrice.toFixed(2);

  const clockElem = document.getElementById('ny-clock');
  if (clockElem && snapshot.ny_time) clockElem.textContent = snapshot.ny_time;

  const globalStats = snapshot.global_stats || {};
  const pnlElem = document.getElementById('global-pnl');
  if (pnlElem) {
    const pnl = globalStats.total_pnl || 0.0;
    pnlElem.textContent = formatCurrency(pnl);
    pnlElem.className = 'm-val ' + (pnl > 0 ? 'text-neon' : (pnl < 0 ? 'text-danger' : ''));
  }

  const activeBotsElem = document.getElementById('global-active-bots');
  if (activeBotsElem) {
    activeBotsElem.textContent = `${globalStats.active_bots || 0} / ${globalStats.total_bots || 0}`;
  }

  const contractsElem = document.getElementById('global-contracts');
  if (contractsElem) {
    contractsElem.textContent = globalStats.total_active_contracts || 0;
  }

  // Renderizar Grid de Bots
  renderBotGrid();

  // Si el modal está abierto, refrescar su contenido en vivo
  if (state.selectedBotId) {
    const selectedBot = state.bots.find(b => b.id === state.selectedBotId);
    if (selectedBot) {
      updateDetailModal(selectedBot);
    }
  }
}

function filterBots(filter) {
  state.activeFilter = filter;
  document.querySelectorAll('.filter-tag').forEach(tag => {
    tag.classList.toggle('active', tag.textContent.trim().toUpperCase() === (filter === 'ALL' ? 'TODOS' : filter));
  });
  renderBotGrid();
}

function renderBotGrid() {
  const grid = document.getElementById('bot-grid');
  if (!grid) return;

  const filteredBots = state.bots.filter(b => {
    if (state.activeFilter === 'ACTIVE') return b.status === 'ACTIVE';
    if (state.activeFilter === 'PAUSED') return b.status === 'PAUSED';
    return true;
  });

  grid.innerHTML = filteredBots.map(bot => {
    const statusClass = bot.status === 'ACTIVE' ? 'status-active' : (bot.status === 'PAUSED' ? 'status-paused' : 'status-error');
    const statusIcon = bot.status === 'ACTIVE' ? '🟢' : (bot.status === 'PAUSED' ? '🔴' : '🟡');
    const pnlClass = bot.net_pnl > 0 ? 'profit' : (bot.net_pnl < 0 ? 'loss' : '');
    const pnlTextClass = bot.net_pnl > 0 ? 'text-neon' : (bot.net_pnl < 0 ? 'text-danger' : '');

    const proxyDisplay = bot.proxy_url ? (bot.proxy_ip || 'SOCKS5 Configurado') : 'Directo (Host)';
    const pingDisplay = bot.proxy_ping_ms > 0 ? `⚡ ${bot.proxy_ping_ms}ms` : 'Local';
    const scheduleDisplay = `${bot.schedule?.start_time || '09:30'} - ${bot.schedule?.end_time || '11:30'} EST`;

    return `
      <div class="bot-card" id="card-${bot.id}">
        <div class="bot-card-header">
          <div class="bot-title-group">
            <div class="bot-title-row">
              <span class="bot-name">${escapeHtml(bot.name)}</span>
              <span class="bot-strat-badge">${bot.strategy}</span>
            </div>
            <span class="bot-status-pill ${statusClass}">${statusIcon} ${bot.status}</span>
          </div>
        </div>

        <div class="bot-info-grid">
          <div class="info-item">
            <span class="info-label">SALIDA / IP PÚBLICA</span>
            <span class="info-value text-mono" title="${bot.proxy_url || ''}">${escapeHtml(proxyDisplay)}</span>
          </div>
          <div class="info-item">
            <span class="info-label">LATENCIA PROXY</span>
            <span class="info-value text-mono text-neon">${pingDisplay}</span>
          </div>
          <div class="info-item">
            <span class="info-label">HORARIO OPERATIVO</span>
            <span class="info-value text-mono">${scheduleDisplay}</span>
          </div>
          <div class="info-item">
            <span class="info-label">CONTRATOS MNQ</span>
            <span class="info-value text-mono">${bot.total_active_contracts || 0} activos</span>
          </div>
        </div>

        <div class="bot-pnl-strip ${pnlClass}">
          <span class="pnl-strip-label">PnL SESIÓN (NETO)</span>
          <span class="pnl-strip-val ${pnlTextClass}">${formatCurrency(bot.net_pnl)}</span>
        </div>

        <div class="bot-card-footer">
          <span class="accounts-count-badge">${bot.accounts_count} cuentas vinculadas</span>
          <div class="card-actions">
            <button class="btn btn-secondary btn-sm" onclick="toggleBot('${bot.id}')">
              ${bot.status === 'ACTIVE' ? 'Pausar' : 'Reanudar'}
            </button>
            <button class="btn btn-primary btn-sm" onclick="openDetailModal('${bot.id}')">
              Inspeccionar
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ======================================================================
// MODAL DETALLADO DE INSPECCIÓN
// ======================================================================

function openDetailModal(botId) {
  state.selectedBotId = botId;
  const bot = state.bots.find(b => b.id === botId);
  if (!bot) return;

  const modal = document.getElementById('bot-detail-modal');
  modal.classList.add('open');

  // Llenar inputs iniciales
  const startTimeInput = document.getElementById('modal-start-time');
  const endTimeInput = document.getElementById('modal-end-time');
  if (startTimeInput) startTimeInput.value = bot.schedule?.start_time || '09:30';
  if (endTimeInput) endTimeInput.value = bot.schedule?.end_time || '11:30';

  updateDetailModal(bot);
}

function closeDetailModal() {
  state.selectedBotId = null;
  const modal = document.getElementById('bot-detail-modal');
  modal.classList.remove('open');
}

function updateDetailModal(bot) {
  // Encabezado
  document.getElementById('modal-bot-name').textContent = bot.name;
  document.getElementById('modal-bot-strategy').textContent = bot.strategy;
  
  const statusBadge = document.getElementById('modal-bot-status-badge');
  statusBadge.textContent = bot.status === 'ACTIVE' ? '🟢 ACTIVO' : (bot.status === 'PAUSED' ? '🔴 PAUSADO' : '🟡 ERROR');
  statusBadge.className = 'bot-status-tag ' + (bot.status === 'ACTIVE' ? 'status-active' : 'status-paused');

  const toggleBtn = document.getElementById('modal-toggle-btn');
  toggleBtn.textContent = bot.status === 'ACTIVE' ? 'Pausar Bot' : 'Reanudar Bot';

  // Config Strip
  document.getElementById('modal-proxy-url').textContent = bot.proxy_url || 'Conexión Directa (Host)';
  document.getElementById('modal-proxy-ip').textContent = bot.proxy_ip || 'No detectada';
  document.getElementById('modal-proxy-ping').textContent = bot.proxy_ping_ms > 0 ? `⚡ ${bot.proxy_ping_ms} ms` : '12.4 ms';

  // KPIs
  const netPnlElem = document.getElementById('modal-net-pnl');
  netPnlElem.textContent = formatCurrency(bot.net_pnl);
  netPnlElem.className = 'kpi-val ' + (bot.net_pnl > 0 ? 'text-neon' : (bot.net_pnl < 0 ? 'text-danger' : ''));

  document.getElementById('modal-pnl-breakdown').textContent = 
    `Realizado: ${formatCurrency(bot.realized_pnl)} | Flotante: ${formatCurrency(bot.floating_pnl)}`;
  
  document.getElementById('modal-win-rate').textContent = `${bot.win_rate}%`;
  document.getElementById('modal-win-loss').textContent = `${bot.winning_trades} Ganados / ${bot.losing_trades} Perdidos`;
  document.getElementById('modal-total-trades').textContent = bot.total_trades;
  document.getElementById('modal-max-dd').textContent = formatCurrency(bot.max_drawdown);

  // Tabla de Cuentas Gestionadas
  const tbody = document.getElementById('modal-accounts-tbody');
  tbody.innerHTML = (bot.accounts || []).map(acc => {
    const posClass = acc.current_position === 'LONG' ? 'pos-long' : (acc.current_position === 'SHORT' ? 'pos-short' : 'pos-flat');
    const floatPnlClass = acc.floating_pnl > 0 ? 'text-neon' : (acc.floating_pnl < 0 ? 'text-danger' : '');

    return `
      <tr>
        <td style="font-weight: 600; color: #FFFFFF;">${escapeHtml(acc.custom_name)}</td>
        <td><span style="color: #808080;">${escapeHtml(acc.prop_firm)}</span> / <b>${escapeHtml(acc.broker)}</b></td>
        <td><span class="status-active" style="padding: 2px 6px; font-size: 0.7rem; border-radius: 3px;">${acc.status}</span></td>
        <td>${formatCurrency(acc.balance)}</td>
        <td class="${floatPnlClass}">${formatCurrency(acc.floating_pnl)}</td>
        <td class="${posClass}">${acc.current_position}</td>
        <td>${acc.active_contracts} ct</td>
        <td style="color: #808080; font-size: 0.72rem;">${acc.last_order_time || 'Sin órdenes recientes'}</td>
      </tr>
    `;
  }).join('');

  // Consola de Logs con auto-scroll
  const consoleElem = document.getElementById('modal-console-logs');
  const wasAtBottom = consoleElem.scrollHeight - consoleElem.clientHeight <= consoleElem.scrollTop + 50;

  consoleElem.innerHTML = (bot.logs || []).map(log => {
    return `
      <div class="log-entry">
        <span class="log-time">[${log.timestamp}]</span>
        <span class="log-lvl lvl-${log.level}">${log.level}</span>
        <span class="log-msg">${escapeHtml(log.message)}</span>
      </div>
    `;
  }).join('');

  if (wasAtBottom || consoleElem.scrollTop === 0) {
    consoleElem.scrollTop = consoleElem.scrollHeight;
  }
}

// ======================================================================
// INTERACCIONES Y COMANDOS REST
// ======================================================================

async function toggleBot(botId) {
  try {
    const resp = await fetch(`/api/bots/${botId}/toggle`, { method: 'POST' });
    if (!resp.ok) throw new Error('Error al alternar estado del bot');
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

function toggleCurrentModalBot() {
  if (state.selectedBotId) toggleBot(state.selectedBotId);
}

async function saveCurrentModalSchedule() {
  if (!state.selectedBotId) return;
  const start = document.getElementById('modal-start-time').value;
  const end = document.getElementById('modal-end-time').value;

  try {
    const resp = await fetch(`/api/bots/${state.selectedBotId}/schedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_time: start, end_time: end, timezone: 'America/New_York' })
    });
    if (!resp.ok) throw new Error('Error guardando horario');
    alert('Horario de trading actualizado con éxito.');
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function closeCurrentModalPositions() {
  if (!state.selectedBotId) return;
  if (!confirm('¿Cerrar inmediatamente todas las posiciones abiertas en las cuentas de este bot?')) return;

  try {
    const resp = await fetch(`/api/bots/${state.selectedBotId}/close`, { method: 'POST' });
    if (!resp.ok) throw new Error('Error cerrando posiciones');
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

async function openAddAccountPrompt() {
  if (!state.selectedBotId) return;
  const customName = prompt('Ingrese el nombre personalizado de la cuenta (ej. "Apex 50k #3"):');
  if (!customName) return;

  const propFirm = prompt('Prop Firm (Apex Trader Funding, Topstep, Leelo Trading, Blue Guardian):', 'Apex Trader Funding');
  const broker = prompt('Conector Broker (Tradovate o Rithmic):', 'Tradovate');
  const balance = parseFloat(prompt('Balance inicial en USD:', '50000')) || 50000;

  const newAcc = {
    id: `acc_${Date.now()}`,
    custom_name: customName,
    broker: broker,
    prop_firm: propFirm,
    balance: balance
  };

  try {
    const resp = await fetch(`/api/bots/${state.selectedBotId}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newAcc)
    });
    if (!resp.ok) throw new Error('Error vinculando cuenta');
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// Disparo de Señal de Prueba (Simula TradingView)
async function triggerTestSignal(action) {
  try {
    const resp = await fetch('/api/test-signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: action })
    });
    const result = await resp.json();
    console.log('Señal de test disparada:', result);
  } catch (err) {
    alert(`Fallo al enviar señal de test: ${err.message}`);
  }
}

// ======================================================================
// MODAL AGREGAR BOT
// ======================================================================

function openAddBotModal() {
  document.getElementById('add-bot-modal').classList.add('open');
}

function closeAddBotModal() {
  document.getElementById('add-bot-modal').classList.remove('open');
}

async function submitCreateBot() {
  const botId = document.getElementById('new-bot-id').value.trim();
  const name = document.getElementById('new-bot-name').value.trim();
  const strategy = document.getElementById('new-bot-strategy').value;
  const proxy = document.getElementById('new-bot-proxy').value.trim();
  const startTime = document.getElementById('new-bot-start').value;
  const endTime = document.getElementById('new-bot-end').value;

  if (!botId || !name) {
    alert('Por favor ingrese el ID y el Nombre del bot.');
    return;
  }

  const payload = {
    id: botId,
    name: name,
    strategy: strategy,
    proxy_url: proxy,
    start_time: startTime,
    end_time: endTime,
    accounts: [
      {
        id: `acc_${botId}_1`,
        custom_name: `${name} Cuenta Primaria`,
        broker: "Tradovate",
        prop_firm: "Apex Trader Funding",
        balance: 50000.0
      }
    ]
  };

  try {
    const resp = await fetch('/api/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) {
      const errData = await resp.json();
      throw new Error(errData.detail || 'Error creando el bot');
    }
    closeAddBotModal();
  } catch (err) {
    alert(`Error: ${err.message}`);
  }
}

// ======================================================================
// UTILIDADES
// ======================================================================

function formatCurrency(val) {
  const num = typeof val === 'number' ? val : 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num).toFixed(2);
  return `${sign}$${Number(abs).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Iniciar aplicación al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
  initWebSocket();
});
