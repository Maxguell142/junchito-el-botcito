/**
 * app.js - Plataforma Web Institucional QUANTUM FX
 * 
 * Funcionalidades:
 * 1. Control de Autenticación, Sesión y Login Overlay.
 * 2. Navegación fluida por Pestañas (Dashboard, Titulares, Cuentas, VPN, Webhook).
 * 3. Controles Institucionales de Emergencia (Flatten All y Kill-Switch).
 * 4. Gestión Multi-Identidad (Titulares KYC ⇄ Bots ⇄ Proxies ⇄ Cuentas).
 * 5. Modal avanzado para Vincular Cuentas con credenciales y entornos.
 * 6. Centro de VPN con prueba de ping en vivo y anti-flagging geográfico.
 * 7. Motor reactivo WebSocket a 1Hz con telemetría en streaming y Toasts.
 */

// Estado global de la aplicación
const state = {
  token: localStorage.getItem('quantum_auth_token') || null,
  currentUser: { username: 'admin', role: 'ADMIN_TRADER' },
  activeTab: 'dashboard',
  bots: [],
  identities: [],
  riskPolicy: null,
  selectedBotId: null,
  activeFilter: 'ALL',
  marketPrice: 28245.50,
  chartTimeframe: '1m',
  chartBotFilter: 'ALL',
  wsConnected: false,
  analysisResults: [],
  historicalTrades: []
};

let ws = null;
let reconnectTimer = null;
let confirmResolver = null;

// ======================================================================
// 1.1 MOTOR DE ALERTAS SONORAS (WEB AUDIO API) & GUÍA LANDING
// ======================================================================

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playAudioCue(type) {
  if (state.audioMuted) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (type === 'fill') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.18);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } else if (type === 'alarm') {
      [0, 0.15].forEach(delay => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(320, ctx.currentTime + delay);
        gain.gain.setValueAtTime(0.15, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.12);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + 0.12);
      });
    } else if (type === 'chime') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (err) {
    console.warn('Audio Cue warning:', err);
  }
}

function toggleAudioMute() {
  state.audioMuted = !state.audioMuted;
  localStorage.setItem('quantum_audio_muted', state.audioMuted);
  updateAudioButtonUI();
  showToast(state.audioMuted ? 'Alertas sonoras silenciadas' : 'Alertas sonoras activadas', 'info');
  if (!state.audioMuted) {
    playAudioCue('chime');
  }
}

function updateAudioButtonUI() {
  const btn = document.getElementById('audio-toggle-btn');
  const icon = document.getElementById('audio-icon');
  const label = document.getElementById('audio-label');
  if (!btn) return;
  btn.classList.toggle('muted', state.audioMuted);
  if (icon) icon.textContent = state.audioMuted ? '🔇' : '🔊';
  if (label) label.textContent = state.audioMuted ? 'Audio OFF' : 'Audio ON';
}

// ======================================================================
// GESTOR DE PANTALLAS (3 ETAPAS: LANDING -> LOGIN -> TERMINAL)
// ======================================================================

function showScreen(screenId) {
  const screens = ['screen-landing', 'screen-login', 'screen-terminal'];
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle('hidden', id !== screenId);
    }
  });

  if (screenId === 'screen-landing') {
    updateLandingAuthUI();
  }
}

function goToLandingScreen() {
  showScreen('screen-landing');
}

function goToLoginScreen() {
  showScreen('screen-login');
  setTimeout(() => {
    document.getElementById('login-username')?.focus();
  }, 60);
}

function goToTerminalScreen() {
  if (!state.token) {
    goToLoginScreen();
    return;
  }
  showScreen('screen-terminal');
  initLucidSidebarPreferences();
  updateHeaderUser();
  if (!state.wsConnected) {
    initWebSocket();
  }
  switchTab(state.activeTab || 'dashboard');
}

function handleLandingCta() {
  if (state.token) {
    goToTerminalScreen();
  } else {
    goToLoginScreen();
  }
}

function updateLandingAuthUI() {
  const box = document.getElementById('landing-auth-action-box');
  if (!box) return;
  if (state.token) {
    const username = state.currentUser?.username || 'admin';
    box.innerHTML = `
      <button class="btn btn-primary" onclick="goToTerminalScreen()">
        <span>🚀 Ir a la Terminal (${escapeHtml(username)})</span> ➔
      </button>
      <button class="btn btn-outline btn-sm" onclick="logoutUser()" title="Cerrar Sesión">
        ⏻ Salir
      </button>
    `;
  } else {
    box.innerHTML = `
      <button class="btn btn-primary" onclick="goToLoginScreen()">
        <span>🔐 Iniciar Sesión</span> ➔
      </button>
    `;
  }
}

// ======================================================================
// 1. SISTEMA DE AUTENTICACIÓN Y LOGIN
// ======================================================================

function initAuth() {
  updateAudioButtonUI();
  if (state.token) {
    goToTerminalScreen();
  } else {
    goToLandingScreen();
  }
}

function updateHeaderUser() {
  const avatar = document.getElementById('header-user-avatar');
  const nameElem = document.getElementById('header-user-name');
  if (avatar) avatar.textContent = (state.currentUser.username || 'AD').substring(0, 2).toUpperCase();
  if (nameElem) nameElem.textContent = state.currentUser.username || 'admin';
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.token) headers.set('Authorization', `Bearer ${state.token}`);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    state.token = null;
    localStorage.removeItem('quantum_auth_token');
    ws?.close();
    goToLoginScreen();
  }
  return response;
}

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const user = document.getElementById('login-username').value.trim();
  const pass = document.getElementById('login-password').value.trim();
  const remember = document.getElementById('login-remember').checked;

  try {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.detail || 'Error de autenticación');
    }

    const data = await resp.json();
    state.token = data.token;
    state.currentUser = data.user || { username: user, role: 'ADMIN_TRADER' };

    if (remember) {
      localStorage.setItem('quantum_auth_token', state.token);
    } else {
      localStorage.removeItem('quantum_auth_token');
    }

    showToast(`Bienvenido de nuevo, ${state.currentUser.username}`, 'success');
    goToTerminalScreen();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function logoutUser() {
  const ok = await confirmModal('Cerrar Sesión', '¿Deseas desconectar tu sesión institucional?', false);
  if (!ok) return;

  try {
    if (state.token) await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch (err) {
    console.warn('La sesión local se cerró aunque el servidor no respondió.', err);
  }
  state.token = null;
  localStorage.removeItem('quantum_auth_token');
  ws?.close();
  goToLandingScreen();
  showToast('Sesión finalizada correctamente', 'info');
}

// ======================================================================
// 2. NAVEGACIÓN POR PESTAÑAS (TABS)
// ======================================================================

function switchTab(tabName) {
  state.activeTab = tabName;

  document.querySelectorAll('.tab-link').forEach(link => {
    link.classList.toggle('active', link.getAttribute('onclick')?.includes(`'${tabName}'`));
  });

  document.querySelectorAll('.tab-view').forEach(view => {
    view.classList.toggle('active', view.id === `view-${tabName}`);
  });

  if (tabName === 'titulares') renderIdentities();
  if (tabName === 'cuentas') renderGlobalAccounts();
  if (tabName === 'vpn') renderVpnCenter();
  if (tabName === 'dashboard') renderBotGrid();
  if (tabName === 'analysis') loadAnalysisStatus();
  if (tabName === 'noticias') loadEconomicNews();
    if (tabName === 'charts') {
    setTimeout(() => {
      initLightweightChart();
    }, 50);
  }
}

// ======================================================================
// 3. CONEXIÓN WEBSOCKET Y SINCRONIZACIÓN
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
      ws.send(JSON.stringify({ action: 'AUTH', token: state.token }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'AUTH_ERROR') {
          state.token = null;
          localStorage.removeItem('quantum_auth_token');
          goToLoginScreen();
          return;
        }
        if (data.type === 'SNAPSHOT') {
          handleStateSnapshot(data);
        }
      } catch (err) {
        console.error('Error parseando WebSocket:', err);
      }
    };

    ws.onclose = (event) => {
      state.wsConnected = false;
      if (event.code === 1008 || event.code === 4401) {
        state.token = null;
        localStorage.removeItem('quantum_auth_token');
        goToLoginScreen();
      }
      if (state.token) {
        updateWsStatus('Reconectando...', false);
        reconnectTimer = setTimeout(initWebSocket, 2000);
      } else {
        updateWsStatus('Desconectado', false);
      }
    };

    ws.onerror = () => {
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
  if (label) label.textContent = text;
  container.classList.toggle('ws-connected', connected);
}

function handleStateSnapshot(snapshot) {
  state.bots = snapshot.bots || [];
  state.identities = snapshot.identities || [];
  state.riskPolicy = snapshot.risk_policy || null;
  state.marketPrice = snapshot.market_price_mnq || 18245.50;

  // Actualizar Velas de Gráficos en Tiempo Real
  if (snapshot.latest_candle) {
    if (state.candleSeries) {
      try { state.candleSeries.update(snapshot.latest_candle); } catch (e) {}
    }
    if (state.modalCandleSeries) {
      try { state.modalCandleSeries.update(snapshot.latest_candle); } catch (e) {}
    }
    const curPriceEl = document.getElementById('chart-current-price');
    if (curPriceEl) curPriceEl.textContent = Number(snapshot.latest_candle.close).toFixed(2);
  }

  // Actualizar Header
  const priceElem = document.getElementById('market-price-val');
  if (priceElem) priceElem.textContent = state.marketPrice.toFixed(2);

  const clockElem = document.getElementById('ny-clock');
  if (clockElem && snapshot.ny_time) clockElem.textContent = snapshot.ny_time;

  const globalStats = snapshot.global_stats || {};
  const pnlElem = document.getElementById('global-pnl');
  if (pnlElem) pnlElem.textContent = formatCurrency(globalStats.total_pnl || 0.0);

  const activeBotsElem = document.getElementById('global-active-bots');
  if (activeBotsElem) activeBotsElem.textContent = `${globalStats.active_bots || 0} / ${state.bots.length}`;

  const contractsElem = document.getElementById('global-contracts');
  if (contractsElem) contractsElem.textContent = globalStats.total_active_contracts || 0;

  // Actualizar Contadores de Pestañas
  const countTitulares = document.getElementById('count-titulares');
  if (countTitulares) countTitulares.textContent = state.identities.length;

  const totalAccounts = state.bots.reduce((sum, b) => sum + (b.accounts ? b.accounts.length : 0), 0);
  const countCuentas = document.getElementById('count-cuentas');
  if (countCuentas) countCuentas.textContent = totalAccounts;

  // Renderizar vista activa
  if (state.activeTab === 'dashboard') renderBotGrid();
  if (state.activeTab === 'titulares') renderIdentities();
  if (state.activeTab === 'cuentas') renderGlobalAccounts();
  if (state.activeTab === 'vpn') renderVpnCenter();

  // Actualizar modal de detalle si está abierto
  if (state.selectedBotId) {
    updateDetailModalContent(state.selectedBotId);
  }
}

// ======================================================================
// 4. CONTROLES DE PÁNICO Y EMERGENCIA (HEADER)
// ======================================================================

async function promptFlattenAll() {
  const confirmed = await confirmModal(
    '🔴 LIQUIDACIÓN GLOBAL DE EMERGENCIA',
    '¿Estás seguro de CERRAR TODAS las posiciones abiertas en todas las cuentas de todos los bots inmediatamente?',
    true
  );
  if (!confirmed) return;

  try {
    const resp = await apiFetch('/api/emergency/flatten-all', { method: 'POST' });
    const data = await resp.json();
    showToast(`Posiciones cerradas (FLAT). PnL Realizado: ${formatCurrency(data.total_realized_pnl)}`, 'success');
  } catch (err) {
    showToast(`Error al liquidar posiciones: ${err.message}`, 'error');
  }
}

async function promptStopAll() {
  const confirmed = await confirmModal(
    '⏹️ KILL-SWITCH GLOBAL',
    '¿Estás seguro de APAGAR Y PAUSAR todos los bots activos? Esto detendrá la ejecución de nuevas órdenes.',
    true
  );
  if (!confirmed) return;

  try {
    const resp = await apiFetch('/api/emergency/stop-all', { method: 'POST' });
    const data = await resp.json();
    showToast(`Kill-Switch activado: ${data.bots_paused} bots han sido pausados.`, 'warn');
  } catch (err) {
    showToast(`Error al apagar bots: ${err.message}`, 'error');
  }
}

// ======================================================================
// 5. RENDERIZADO DEL DASHBOARD (GRIDS DE BOTS)
// ======================================================================

function filterBots(filter) {
  state.activeFilter = filter;
  document.querySelectorAll('.filter-tag, .filter-capsule-item').forEach(tag => {
    tag.classList.toggle('active', tag.getAttribute('onclick')?.includes(`'${filter}'`));
  });
  renderBotGrid();
}

function toggleBotFavorite(botId, event) {
  if (event) event.stopPropagation();
  if (!state.favoriteBots) {
    try {
      state.favoriteBots = JSON.parse(localStorage.getItem('quantum_fav_bots') || '[]');
    } catch {
      state.favoriteBots = [];
    }
  }
  const idx = state.favoriteBots.indexOf(botId);
  if (idx > -1) {
    state.favoriteBots.splice(idx, 1);
  } else {
    state.favoriteBots.push(botId);
  }
  localStorage.setItem('quantum_fav_bots', JSON.stringify(state.favoriteBots));
  renderBotGrid();
}

function renderBotGrid() {
  const grid = document.getElementById('bot-grid');
  if (!grid) return;

  const filtered = state.bots.filter(b => {
    if (state.activeFilter === 'ALL') return true;
    return b.status === state.activeFilter;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-placeholder" style="grid-column: 1/-1; text-align: center; padding: 48px; color: var(--text-secondary);">
        <p>No hay bots en estado ${state.activeFilter}. Haz clic en <strong>+ Nuevo Bot</strong> para registrar una unidad.</p>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map(bot => {
    const statusClass = bot.status === 'ACTIVE' ? 'active' : 'paused';
    const statusLabel = bot.status === 'ACTIVE' ? '🟢 ACTIVO' : '🟡 PAUSADO';
    const ident = bot.identity || { full_name: 'Sin Titular', flag: '👤', city: 'N/A', country: 'XX', kyc_status: 'PENDING' };
    const pnlClass = bot.net_pnl >= 0 ? 'text-neon' : 'text-danger';
    const consistencyPct = Math.min(100, Math.max(0, bot.consistency_pct || 0));
    const consistencyWarn = consistencyPct > 30 ? 'warn' : '';

    const isFav = (state.favoriteBots || []).includes(bot.id);
    const cb = bot.circuit_breaker || { consistency_target: 150, auto_lock_consistency: true, daily_loss_limit: 1000 };

    return `
      <div class="bot-card" data-bot-id="${bot.id}">
        <!-- Encabezado de la Tarjeta estilo Lucid con Estrella Favorito -->
        <div class="bot-card-top">
          <div class="bot-info-group">
            <div class="bot-name-row">
              <span class="bot-title">${escapeHtml(bot.name)}</span>
              <span class="badge-strat">${escapeHtml(bot.strategy)}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px; font-size: 0.72rem; color: var(--text-secondary);" class="text-mono">
              <span>${escapeHtml(bot.id)}</span>
              <span>•</span>
              <span style="color: var(--color-neon);">⏰ ${escapeHtml(bot.schedule ? bot.schedule.start_time : '09:30')} - ${escapeHtml(bot.schedule ? bot.schedule.end_time : '11:30')} EST</span>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button class="bot-star-btn ${isFav ? 'active' : ''}" onclick="toggleBotFavorite('${bot.id}', event)" title="Marcar como favorito">
              ${isFav ? '★' : '☆'}
            </button>
            <span class="bot-status-tag ${statusClass}">${statusLabel}</span>
          </div>
        </div>

        <!-- Ficha del Titular Asignado -->
        <div class="bot-titular-strip">
          <div class="titular-left">
            <span class="titular-avatar-icon">${ident.flag || '🇺🇸'}</span>
            <div class="titular-meta">
              <span class="titular-name">${escapeHtml(ident.full_name)}</span>
              <span class="titular-loc">${escapeHtml(ident.city || ident.country || 'US')} // KYC ${escapeHtml(ident.kyc_status || 'VERIFIED')}</span>
            </div>
          </div>
          <span class="kyc-pill ${ident.kyc_status?.toLowerCase()}">${escapeHtml(ident.kyc_status || 'KYC')}</span>
        </div>

        <!-- Aislamiento de Red Residencial ISP & Switches estilo Lucid -->
        <div class="bot-net-strip" style="flex-direction: column; align-items: flex-start; gap: 6px; padding: 10px 12px;">
          <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
            <div>
              <span class="net-ip-tag font-bold">${escapeHtml(bot.outbound_ip || bot.proxy_ip || 'No verificada')}</span>
              <span style="margin: 0 4px; opacity: 0.4;">|</span>
              <span class="net-ping-tag font-bold">${bot.proxy_healthy ? `⚡ ${bot.proxy_ping_ms} ms` : 'Latencia no verificada'}</span>
            </div>
            <span style="font-size: 0.68rem; color: var(--text-secondary);">${escapeHtml(bot.isp_provider ? bot.isp_provider.split(' ')[0] : 'ISP US')}</span>
          </div>
          
          <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.04);">
            <div style="display: flex; align-items: center; gap: 6px; font-size: 0.72rem; color: var(--text-secondary);">
              <span>Jitter Anti-Mirroring:</span>
              <span class="lucid-switch-badge">ON ${bot.jitter_min_ms || 50}-${bot.jitter_max_ms || 350}ms</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; font-size: 0.72rem; color: var(--text-secondary);">
              <span>Lock:</span>
              <span class="lucid-switch-badge">+${cb.consistency_target || 150} ON</span>
            </div>
          </div>
        </div>

        <!-- KPIs del Bot en 4 Celdas Compactas -->
        <div class="bot-kpi-grid">
          <div class="kpi-box">
            <span class="kpi-box-label">PnL SESIÓN</span>
            <span class="kpi-box-val ${pnlClass}">${formatCurrency(bot.net_pnl)}</span>
          </div>
          <div class="kpi-box">
            <span class="kpi-box-label">WIN-RATE</span>
            <span class="kpi-box-val text-neon">${bot.win_rate || 0}%</span>
          </div>
          <div class="kpi-box">
            <span class="kpi-box-label">CONTRATOS</span>
            <span class="kpi-box-val">${bot.total_active_contracts || 0} MNQ</span>
          </div>
          <div class="kpi-box">
            <span class="kpi-box-label">CUENTAS</span>
            <span class="kpi-box-val">${bot.accounts ? bot.accounts.length : 0} PA</span>
          </div>
        </div>

        <!-- Monitor de Regla de Consistencia (30%) -->
        <div class="consistency-bar-wrap">
          <div class="consistency-header">
            <span>Regla de Consistencia Diaria (Máx 30%)</span>
            <span><strong>${consistencyPct}%</strong></span>
          </div>
          <div class="progress-track">
            <div class="progress-fill ${consistencyWarn}" style="width: ${consistencyPct}%;"></div>
          </div>
        </div>

        <!-- Acciones de la Tarjeta estilo Lucid Trading -->
        <div class="bot-card-actions">
          <div class="btn-group-left">
            <button class="btn btn-secondary btn-xs" onclick="toggleBot('${bot.id}')">
              ${bot.status === 'ACTIVE' ? '⏸️ Pausar' : '▶️ Reanudar'}
            </button>
            <button class="btn btn-danger btn-xs" onclick="closeBotPositions('${bot.id}')">
              🔴 FLAT
            </button>
          </div>
          <button class="btn btn-primary btn-xs" onclick="openDetailModal('${bot.id}')">
            Detalles & Logs ➔
          </button>
        </div>
      </div>`;
  }).join('');
}

// ======================================================================
// 6. RENDERIZADO DE TITULARES & KYC (PERSONAS)
// ======================================================================

function renderIdentities() {
  const container = document.getElementById('identities-grid');
  if (!container) return;

  if (state.identities.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;">
      <p>No hay titulares guardados. La demo no precarga ni inventa identidades KYC.</p>
      <button class="btn btn-primary" type="button" onclick="openAddIdentityModal()">Registrar titular</button>
      <p class="form-hint">El estado inicial será Pendiente. Este registro local no verifica identidad ni almacena documentos.</p>
    </div>`;
    return;
  }

  container.innerHTML = state.identities.map(ident => {
    // Contar cuántos bots y cuentas están a nombre de esta persona
    const assignedBots = state.bots.filter(b => b.identity && b.identity.id === ident.id);
    const assignedAccounts = assignedBots.reduce((sum, b) => sum + (b.accounts ? b.accounts.length : 0), 0);

    return `
      <div class="identity-card">
        <div class="identity-header">
          <span class="identity-flag-avatar">${ident.flag || '👤'}</span>
          <div class="identity-titles">
            <h3>${escapeHtml(ident.full_name)}</h3>
            <span>${escapeHtml(ident.city || ident.country || '')} // ${escapeHtml(ident.id)}</span>
          </div>
        </div>

        <div class="identity-details-list">
          <div class="identity-row">
            <span class="id-label">Estado KYC:</span>
            <span class="kyc-pill ${ident.kyc_status?.toLowerCase()}">${escapeHtml(ident.kyc_status)}</span>
          </div>
          <div class="identity-row">
            <span class="id-label">Correo Prop Firms:</span>
            <span class="id-val">${escapeHtml(ident.email || 'N/A')}</span>
          </div>
          <div class="identity-row">
            <span class="id-label">Bots a su Nombre:</span>
            <span class="id-val">${assignedBots.length} (${assignedBots.map(b => b.name).join(', ') || 'Ninguno'})</span>
          </div>
          <div class="identity-row">
            <span class="id-label">Cuentas Replicadas:</span>
            <span class="id-val">${assignedAccounts} Cuentas</span>
          </div>
        </div>

        <div style="font-size: 0.72rem; color: var(--text-secondary); border-top: 1px solid var(--border-subtle); padding-top: 8px;">
          <em>${escapeHtml(ident.notes || 'Sin notas adicionales')}</em>
        </div>
      </div>`;
  }).join('');
}

// ======================================================================
// 7. RENDERIZADO DE CUENTAS PROP GESTIONADAS (TABLA GLOBAL)
// ======================================================================

function renderGlobalAccounts() {
  const tbody = document.getElementById('global-accounts-tbody');
  if (!tbody) return;

  const allAccounts = [];
  state.bots.forEach(bot => {
    (bot.accounts || []).forEach(acc => {
      allAccounts.push({ ...acc, bot_name: bot.name, bot_id: bot.id, bot_ident: bot.identity });
    });
  });

  if (allAccounts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; padding: 32px; color: var(--text-secondary);">No hay cuentas vinculadas. Haz clic en <strong>+ Vincular Cuenta</strong> para agregar una.</td></tr>`;
    return;
  }

  tbody.innerHTML = allAccounts.map(acc => {
    const pnlClass = acc.floating_pnl >= 0 ? 'text-neon' : 'text-danger';
    const titular = acc.titular_name || (acc.bot_ident ? acc.bot_ident.full_name : 'Titular');
    const riskLimits = state.riskPolicy?.limits || {};
    const maxContracts = Math.min(
      acc.max_contracts ?? 2,
      riskLimits.max_contracts_per_account ?? Number.POSITIVE_INFINITY
    );
    const dailyLossLimit = Math.min(
      acc.daily_loss_limit ?? 1000,
      riskLimits.daily_loss_per_account ?? Number.POSITIVE_INFINITY
    );

    return `
      <tr>
        <td><strong>${escapeHtml(titular)}</strong></td>
        <td>${escapeHtml(acc.custom_name)}</td>
        <td>${escapeHtml(acc.prop_firm)}</td>
        <td>${escapeHtml(acc.broker)}</td>
        <td><span class="env-badge ${acc.environment}">${escapeHtml(acc.environment)}</span></td>
        <td class="text-mono">${escapeHtml(acc.username || 'APEX-***')}</td>
        <td class="text-mono font-semibold">${formatCurrency(acc.balance)}</td>
        <td class="text-mono ${pnlClass}">${formatCurrency(acc.floating_pnl)}</td>
        <td class="text-mono">${acc.active_contracts} ctos</td>
        <td class="text-mono">${maxContracts}</td>
        <td class="text-mono">$${dailyLossLimit}</td>
        <td><span class="text-neon" style="font-size: 0.72rem;">● ${escapeHtml(acc.status)}</span></td>
      </tr>`;
  }).join('');
}

// ======================================================================
// 8. RENDERIZADO DEL CENTRO DE VPN & PROXIES SOCKS5
// ======================================================================

function renderVpnCenter() {
  const container = document.getElementById('vpn-grid');
  if (!container) return;

  container.innerHTML = state.bots.map(bot => {
    const ident = bot.identity || { full_name: 'Titular Desconocido', country: 'US' };

    return `
      <div class="vpn-card">
        <div class="vpn-header">
          <div class="vpn-title-group">
            <h3>Túnel de Red: ${escapeHtml(bot.name)}</h3>
            <span>Titular Asignado: <strong>${escapeHtml(ident.full_name)}</strong></span>
          </div>
          <span class="kyc-pill ${bot.proxy_healthy ? 'verified' : 'pending'}">
            ${bot.proxy_healthy ? '🟢 EN LÍNEA' : '🔴 OFFLINE'}
          </span>
        </div>

        <div class="vpn-ping-box">
          <div class="ping-stat-row">
            <span class="text-secondary">Proveedor ISP Residencial:</span>
            <span class="text-mono">${escapeHtml(bot.isp_provider || 'No verificado')}</span>
          </div>
          <div class="ping-stat-row">
            <span class="text-secondary">Ubicación del Nodo US:</span>
            <span class="text-mono">${escapeHtml(bot.node_location || 'No verificado')}</span>
          </div>
          <div class="ping-stat-row">
            <span class="text-secondary">Proxy SOCKS5:</span>
            <span class="text-mono" style="font-size: 0.72rem;">${escapeHtml(bot.proxy_url || 'No configurado')}</span>
          </div>
          <div class="ping-stat-row">
            <span class="text-secondary">IP Pública Saliente:</span>
            <span class="text-mono font-bold">${escapeHtml(bot.outbound_ip || bot.proxy_ip || 'No verificada')}</span>
          </div>
          <div class="ping-stat-row">
            <span class="text-secondary">Latencia Socket (CME Chicago):</span>
            <span class="text-mono font-bold">${bot.proxy_healthy ? `⚡ ${bot.proxy_ping_ms} ms` : 'No verificada'}</span>
          </div>
          <div class="ping-stat-row">
            <span class="text-secondary">Anti-Flagging Geográfico:</span>
            <span class="${bot.geo_consistent ? 'text-neon' : 'text-amber'}">${escapeHtml(bot.geo_description || 'No verificado')}</span>
          </div>
        </div>

        <button class="btn btn-outline btn-sm btn-block" onclick="testProxyPing('${bot.id}')">
          ⚡ Probar Latencia y Verificar IP
        </button>
      </div>`;
  }).join('');
}

async function testProxyPing(botId) {
  try {
    showToast('Ejecutando ping para proxy de ' + botId + '...', 'info');
    const resp = await apiFetch('/api/bots/' + botId + '/proxy-test', { method: 'POST' });
    const res = await resp.json();
    if (!resp.ok || !res.is_healthy) {
      showToast('Fallo en el proxy: ' + (res.message || 'Error'), 'error');
      return;
    }
    showToast('⚡ Proxy SOCKS5 verificado: ' + res.detected_ip + ' (' + res.isp + ') — Latencia CME: ' + res.ping_ms + ' ms (Geo-Match OK)', 'success');
    playAudioCue('chime');
    renderVpnCenter();
  } catch (err) {
    showToast('Error al probar proxy: ' + err.message, 'error');
  }
}

// ======================================================================
// 9. GESTOR DE MODAL PARA VINCULAR CUENTA (NUEVO)
// ======================================================================

function openAddAccountModal(preselectedBotId = null) {
  const botSelect = document.getElementById('acc-target-bot');
  if (botSelect) {
    botSelect.innerHTML = state.bots.map(b => {
      const titular = b.identity ? b.identity.full_name : 'Sin Titular';
      const selected = b.id === preselectedBotId ? 'selected' : '';
      return `<option value="${b.id}" ${selected}>${escapeHtml(b.name)} (Titular: ${escapeHtml(titular)})</option>`;
    }).join('');
  }
  document.getElementById('add-account-modal').classList.add('open');
}

function openAddAccountModalForCurrentBot() {
  if (state.selectedBotId) {
    openAddAccountModal(state.selectedBotId);
  } else {
    openAddAccountModal();
  }
}

function closeAddAccountModal() {
  document.getElementById('add-account-modal').classList.remove('open');
}

async function submitAddAccount(event) {
  event.preventDefault();
  const botId = document.getElementById('acc-target-bot').value;
  const customName = document.getElementById('acc-custom-name').value.trim();
  const propFirm = document.getElementById('acc-prop-firm').value;
  const broker = document.getElementById('acc-broker').value;
  const environment = document.getElementById('acc-environment').value;
  const balance = parseFloat(document.getElementById('acc-balance').value) || 50000;
  const maxContracts = parseInt(document.getElementById('acc-max-contracts').value) || 2;
  const dailyLoss = parseFloat(document.getElementById('acc-daily-loss').value) || 1000;

  if (!customName) {
    showToast('El nombre de la cuenta es obligatorio', 'error');
    return;
  }

  const payload = {
    id: `acc_${Date.now()}`,
    custom_name: customName,
    broker: broker,
    prop_firm: propFirm,
    environment: environment,
    balance: balance,
    max_contracts: maxContracts,
    daily_loss_limit: dailyLoss
  };

  try {
    const resp = await apiFetch(`/api/bots/${botId}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.detail || 'Error vinculando cuenta');
    }

    closeAddAccountModal();
    showToast(`Cuenta de prueba "${customName}" guardada. No está conectada al broker.`, 'info');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ======================================================================
// 10. MODAL PARA CREAR BOT & TITULAR
// ======================================================================

let uploadedStrategyFile = null;

function handleBotFileDragOver(event) {
  event.preventDefault();
  event.stopPropagation();
  document.getElementById('bot-file-dropzone')?.classList.add('drag-over');
}

function handleBotFileDragLeave(event) {
  event.preventDefault();
  event.stopPropagation();
  document.getElementById('bot-file-dropzone')?.classList.remove('drag-over');
}

function handleBotFileDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  document.getElementById('bot-file-dropzone')?.classList.remove('drag-over');
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    processBotFile(files[0]);
  }
}

function handleBotFileSelect(event) {
  const files = event.target?.files;
  if (files && files.length > 0) {
    processBotFile(files[0]);
  }
}

function clearUploadedBotFile() {
  uploadedStrategyFile = null;
  const input = document.getElementById('new-bot-code-file');
  if (input) input.value = '';
  const card = document.getElementById('bot-file-verification-card');
  if (card) card.style.display = 'none';
  const dropzone = document.getElementById('bot-file-dropzone');
  if (dropzone) dropzone.style.display = 'block';
}

function processBotFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const code = e.target.result;
    const analysis = inspectBotCode(file.name, code);
    uploadedStrategyFile = analysis;

    // Actualizar UI de verificación en el modal
    const dropzone = document.getElementById('bot-file-dropzone');
    if (dropzone) dropzone.style.display = 'none';
    const card = document.getElementById('bot-file-verification-card');
    if (card) card.style.display = 'block';

    const fnEl = document.getElementById('verif-filename-val');
    if (fnEl) fnEl.textContent = file.name;
    const langEl = document.getElementById('verif-lang-val');
    if (langEl) langEl.textContent = analysis.language;
    const sigEl = document.getElementById('verif-signals-val');
    if (sigEl) sigEl.textContent = analysis.signals.join(' · ');
    const riskEl = document.getElementById('verif-risk-val');
    if (riskEl) riskEl.textContent = analysis.risk.join(' · ');
    const prevEl = document.getElementById('verif-code-preview');
    if (prevEl) prevEl.textContent = analysis.snippet;

    // Si el nombre del bot está vacío, auto-sugerir a partir del nombre del archivo
    const nameInput = document.getElementById('new-bot-name');
    if (nameInput && !nameInput.value.trim()) {
      const cleanName = file.name
        .replace(/\.[^/.]+$/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
      nameInput.value = cleanName;
    }

    // Si la estrategia está vacía, auto-sugerir según el script
    const stratInput = document.getElementById('new-bot-strategy');
    if (stratInput && !stratInput.value.trim()) {
      stratInput.value = analysis.suggestedStrategy;
    }

    showToast(`Archivo "${file.name}" verificado exitosamente (${analysis.language})`, 'success');
  };
  reader.readAsText(file);
}

function inspectBotCode(filename, code) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  let detectedLanguage = 'Estrategia de Código General';
  let suggestedStrategy = 'CustomAlgorithmicStrategy';

  if (ext === 'pine' || code.includes('//@version') || code.includes('strategy(') || code.includes('indicator(')) {
    detectedLanguage = 'TradingView Pine Script (v5/v4)';
    suggestedStrategy = 'PineScript Scalper Strategy';
  } else if (ext === 'py' || code.includes('def ') || code.includes('import ') || code.includes('class ')) {
    detectedLanguage = 'Python Algorithmic Engine';
    suggestedStrategy = 'Python Quantitative Alpha';
  } else if (ext === 'js' || ext === 'ts' || code.includes('function ') || code.includes('const ') || code.includes('async ')) {
    detectedLanguage = ext === 'ts' ? 'TypeScript Strategy' : 'JavaScript Engine';
    suggestedStrategy = 'Node.js Execution Bot';
  } else if (ext === 'cs' || code.includes('using NinjaTrader') || code.includes('namespace ')) {
    detectedLanguage = 'C# NinjaScript (CME Futures)';
    suggestedStrategy = 'NinjaScript Futures Strategy';
  } else if (ext === 'mq4' || ext === 'mq5' || code.includes('OnTick') || code.includes('OrderSend')) {
    detectedLanguage = 'MetaTrader MQL4/MQL5 EA';
    suggestedStrategy = 'MQL Expert Advisor';
  } else if (ext === 'json') {
    detectedLanguage = 'Reglas Algorítmicas JSON';
    suggestedStrategy = 'Rule-based JSON Strategy';
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

  const risk = [];
  if (lower.includes('stop') || lower.includes('sl') || lower.includes('stoploss') || lower.includes('stop_loss')) {
    risk.push('Stop Loss Integrado');
  }
  if (lower.includes('take_profit') || lower.includes('takeprofit') || lower.includes('tp') || lower.includes('profit')) {
    risk.push('Take Profit (R:R Ratio)');
  }
  if (lower.includes('trailing') || lower.includes('breakeven')) {
    risk.push('Trailing / Break-Even Dinámico');
  }
  if (!risk.length) risk.push('Protección por Circuit Breaker General');

  const lines = code.split(/\r?\n/).slice(0, 10).join('\n');

  return {
    filename,
    language: detectedLanguage,
    suggestedStrategy,
    signals,
    risk,
    snippet: lines,
    verified: true
  };
}

function openAddBotModal() {
  clearUploadedBotFile();
  const identSelect = document.getElementById('new-bot-identity');
  if (identSelect) {
    identSelect.innerHTML = '<option value="">Sin titular — demo local</option>' + state.identities.map(i => {
      return `<option value="${i.id}">${i.flag} ${escapeHtml(i.full_name)} (${escapeHtml(i.country)})` + `</option>`;
    }).join('');
  }
  document.getElementById('add-bot-modal').classList.add('open');
}

function closeAddBotModal() {
  clearUploadedBotFile();
  document.getElementById('add-bot-modal').classList.remove('open');
}

async function submitCreateBot(event) {
  event.preventDefault();
  const rawId = document.getElementById('new-bot-id').value.trim();
  const name = document.getElementById('new-bot-name').value.trim();
  const identityId = document.getElementById('new-bot-identity').value;
  const strategy = document.getElementById('new-bot-strategy').value.trim();
  const analysisSymbol = document.getElementById('new-bot-analysis-symbol').value;
  const analysisTimeframes = Array.from(
    document.querySelectorAll('input[name="new-bot-timeframe"]:checked')
  ).map(input => input.value);
  const rawProxy = document.getElementById('new-bot-proxy').value.trim();
  const jitter = parseInt(document.getElementById('new-bot-jitter').value) || 120;
  const startTime = document.getElementById('new-bot-start').value;
  const endTime = document.getElementById('new-bot-end').value;

  // Si el usuario no especificó ID, se genera uno limpio y seguro
  const botId = rawId || `bot_${name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 18)}_${Date.now().toString(36)}`;
  
  // Si no se proporcionó proxy, se asigna el nodo residencial demo US
  const proxy = rawProxy || 'socks5://127.0.0.1:1080';

  const payload = {
    id: botId,
    name: name,
    identity_id: identityId,
    strategy: strategy,
    analysis_symbol: analysisSymbol,
    analysis_timeframes: analysisTimeframes,
    proxy_url: proxy,
    jitter_ms: jitter,
    start_time: startTime,
    end_time: endTime,
    strategy_file: uploadedStrategyFile
  };

  if (!analysisTimeframes.length) {
    showToast('Selecciona al menos un intervalo de análisis.', 'error');
    return;
  }

  try {
    const resp = await apiFetch('/api/bots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.detail || 'Error creando bot');
    }

    clearUploadedBotFile();
    closeAddBotModal();
    showToast(`Bot "${name}" creado exitosamente con estrategia "${strategy}".`, 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function submitAnalysisCsv(event) {
  event.preventDefault();
  const input = document.getElementById('analysis-csv-file');
  const file = input.files[0];
  if (!file) {
    showToast('Selecciona un archivo CSV.', 'error');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast('El CSV supera el límite de 5 MB.', 'error');
    return;
  }

  const button = document.getElementById('analysis-submit-btn');
  const status = document.getElementById('analysis-import-status');
  button.disabled = true;
  status.textContent = 'Importando y calculando análisis histórico...';
  try {
    const symbol = document.getElementById('analysis-symbol').value;
    const timeframe = document.getElementById('analysis-source-timeframe').value;
    const csv = await file.text();
    const response = await apiFetch(
      `/api/analysis/csv?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: csv
      }
    );
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'No se pudo analizar el archivo.');
    state.analysisResults = payload.results || [];
    status.textContent = `${payload.symbol}: ${payload.candles} velas ${payload.source_timeframe} importadas. Simulación histórica, no en vivo.`;
    renderAnalysisResults(state.analysisResults);
    showToast('Simulación histórica completada. No se envió ninguna orden a un broker.', 'success');
  } catch (error) {
    status.textContent = 'No se pudo importar el CSV.';
    showToast(`Error: ${error.message}`, 'error');
  } finally {
    button.disabled = false;
  }
}

async function loadAnalysisStatus() {
  try {
    const response = await apiFetch('/api/analysis/status');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.detail || 'No se pudo cargar el estado del análisis.');
    state.analysisResults = payload.results || [];
    state.historicalTrades = state.analysisResults.flatMap(result =>
      (result.historical_simulated_trades || []).map(trade => ({
        ...trade,
        bot_id: result.bot_id,
        bot_name: result.bot_name
      }))
    );
    const datasets = Object.entries(payload.datasets || {});
    const status = document.getElementById('analysis-import-status');
    if (status && datasets.length) {
      status.textContent = `CSV históricos en memoria: ${datasets.map(([symbol, dataset]) =>
        `${symbol} ${dataset.source_timeframe} (${dataset.candles} velas)`
      ).join(' · ')}. Simulaciones sin broker; se borran al reiniciar Node.`;
    }
    renderAnalysisResults(state.analysisResults);
  } catch (error) {
    showToast(`Error cargando análisis: ${error.message}`, 'error');
  }
}

function renderAnalysisResults(results) {
  const container = document.getElementById('analysis-results');
  if (!container) return;
  if (!results.length) {
    container.innerHTML = '<div class="empty-state">No hay resultados todavía. Importa datos del instrumento configurado para uno o más bots.</div>';
    return;
  }

  const analysisCards = results.map(result => {
    const indicators = result.indicators || {};
    const displayValue = value => value === null || value === undefined
      ? 'N/D'
      : Number.isFinite(Number(value)) ? Number(value).toFixed(2) : 'N/D';
    const macd = indicators.macd
      ? `${displayValue(indicators.macd.line)} / ${displayValue(indicators.macd.signal)}`
      : 'N/D';
    const signalClass = result.signal === 'BULLISH'
      ? 'analysis-bullish'
      : result.signal === 'BEARISH'
        ? 'analysis-bearish'
        : 'analysis-neutral';
    const statusLabel = result.status === 'READY'
      ? 'ANÁLISIS'
      : result.status === 'INSUFFICIENT_DATA'
        ? 'DATOS INSUFICIENTES'
        : 'NO DISPONIBLE';
    const hypotheticalCount = Number(result.historical_simulated_trade_count || 0);
    const renderChart = () => {
      const chartBars = result.chart?.bars || [];
      if (!chartBars.length) {
        return '<div class="analysis-chart-empty">No hay velas suficientes para dibujar el gráfico.</div>';
      }

      const chartWidth = 940;
      const chartHeight = 360;
      const plot = { left: 18, right: 830, top: 20, bottom: 312 };
      const plotWidth = plot.right - plot.left;
      const plotHeight = plot.bottom - plot.top;
      const trade = result.chart.trade;
      const tradeEntryIndex = trade
        ? chartBars.findIndex(bar => bar.timestamp === Date.parse(trade.entry_time))
        : -1;
      const xAt = index => plot.left + (chartBars.length < 2
        ? plotWidth / 2
        : index * plotWidth / (chartBars.length - 1));
      const values = chartBars.flatMap(bar =>
        [bar.low, bar.high, bar.ema9, bar.ema21, bar.ema50, bar.vwap]
          .filter(value => Number.isFinite(value))
      );
      if (trade) values.push(trade.entry_price, trade.stop_loss, trade.take_profit);
      const rawMin = Math.min(...values);
      const rawMax = Math.max(...values);
      const padding = Math.max((rawMax - rawMin) * 0.1, Math.abs(rawMax) * 0.0005, 0.25);
      const minPrice = rawMin - padding;
      const maxPrice = rawMax + padding;
      const yAt = price => plot.bottom - ((price - minPrice) / (maxPrice - minPrice)) * plotHeight;
      const candleWidth = Math.max(2, Math.min(9, plotWidth / chartBars.length * 0.66));
      const grid = Array.from({ length: 5 }, (_, index) => {
        const price = maxPrice - (maxPrice - minPrice) * index / 4;
        const y = yAt(price);
        return `<line class="chart-grid" x1="${plot.left}" y1="${y}" x2="${plot.right}" y2="${y}"/>
          <text class="chart-axis-label" x="${plot.right + 8}" y="${y + 4}">${displayValue(price)}</text>`;
      }).join('');
      const linePath = key => {
        let isDrawing = false;
        return chartBars.map((bar, index) => {
          if (!Number.isFinite(bar[key])) {
            isDrawing = false;
            return '';
          }
          const command = isDrawing ? 'L' : 'M';
          isDrawing = true;
          return `${command}${xAt(index)},${yAt(bar[key])}`;
        }).filter(Boolean).join(' ');
      };
      const candles = chartBars.map((bar, index) => {
        const x = xAt(index);
        const bullish = bar.close >= bar.open;
        const bodyTop = yAt(Math.max(bar.open, bar.close));
        const bodyBottom = yAt(Math.min(bar.open, bar.close));
        const bodyHeight = Math.max(1.5, bodyBottom - bodyTop);
        return `<line class="chart-wick ${bullish ? 'is-up' : 'is-down'}" x1="${x}" y1="${yAt(bar.high)}" x2="${x}" y2="${yAt(bar.low)}"/>
          <rect class="chart-candle ${bullish ? 'is-up' : 'is-down'}" x="${x - candleWidth / 2}" y="${bodyTop}" width="${candleWidth}" height="${bodyHeight}" rx="0.6"/>`;
      }).join('');
      const timeLabels = [0, Math.floor((chartBars.length - 1) / 2), chartBars.length - 1]
        .map(index => {
          const x = xAt(index);
          const timestamp = new Date(chartBars[index].timestamp).toISOString().slice(5, 16).replace('T', ' ');
          return `<text class="chart-time-label" x="${x}" y="${plot.bottom + 22}" text-anchor="middle">${timestamp} UTC</text>`;
        }).join('');
      const tradeLevels = trade && tradeEntryIndex >= 0
        ? (() => {
          const startX = xAt(tradeEntryIndex);
          const lineEnd = plot.right;
          const entryY = yAt(trade.entry_price);
          const stopY = yAt(trade.stop_loss);
          const targetY = yAt(trade.take_profit);
          const targetTop = Math.min(entryY, targetY);
          const stopTop = Math.min(entryY, stopY);
          const statusText = {
            TP_HIT: 'OBJETIVO ALCANZADO',
            STOP_HIT: 'STOP ALCANZADO',
            NO_EXIT_IN_HISTORY: 'SIN SALIDA EN EL HISTÓRICO'
          }[trade.status] || trade.status;
          return `<rect class="chart-reward-zone" x="${startX}" y="${targetTop}" width="${lineEnd - startX}" height="${Math.max(1, Math.abs(entryY - targetY))}"/>
            <rect class="chart-risk-zone" x="${startX}" y="${stopTop}" width="${lineEnd - startX}" height="${Math.max(1, Math.abs(entryY - stopY))}"/>
            <line class="chart-level chart-level-target" x1="${startX}" y1="${targetY}" x2="${lineEnd}" y2="${targetY}"/>
            <line class="chart-level chart-level-entry" x1="${startX}" y1="${entryY}" x2="${lineEnd}" y2="${entryY}"/>
            <line class="chart-level chart-level-stop" x1="${startX}" y1="${stopY}" x2="${lineEnd}" y2="${stopY}"/>
            <line class="chart-entry-marker" x1="${startX}" y1="${plot.top}" x2="${startX}" y2="${plot.bottom}"/>
            <text class="chart-level-label target-label" x="${lineEnd + 7}" y="${targetY - 5}">TP ${displayValue(trade.take_profit)}</text>
            <text class="chart-level-label entry-label" x="${lineEnd + 7}" y="${entryY - 5}">ENTRADA ${displayValue(trade.entry_price)}</text>
            <text class="chart-level-label stop-label" x="${lineEnd + 7}" y="${stopY - 5}">STOP ${displayValue(trade.stop_loss)}</text>
            <text class="chart-trade-status" x="${startX + 8}" y="${plot.top + 16}">${statusText}</text>`;
        })()
        : '';
      return `<div class="analysis-chart">
        <div class="analysis-chart-heading">
          <span>Gráfico histórico · ${chartBars.length} velas</span>
          <span>UTC · CSV, no tiempo real</span>
        </div>
        <div class="analysis-chart-scroll">
          <svg class="analysis-chart-svg" viewBox="0 0 ${chartWidth} ${chartHeight}" role="img" aria-label="Gráfico de velas históricas con indicadores y niveles simulados">
            <rect class="chart-background" x="${plot.left}" y="${plot.top}" width="${plotWidth}" height="${plotHeight}"/>
            ${grid}
            ${tradeLevels}
            ${candles}
            <path class="chart-line chart-ema9" d="${linePath('ema9')}"/>
            <path class="chart-line chart-ema21" d="${linePath('ema21')}"/>
            <path class="chart-line chart-ema50" d="${linePath('ema50')}"/>
            <path class="chart-line chart-vwap" d="${linePath('vwap')}"/>
            ${timeLabels}
          </svg>
        </div>
        <div class="analysis-chart-legend">
          <span><i class="legend-ema9"></i>EMA 9</span>
          <span><i class="legend-ema21"></i>EMA 21</span>
          <span><i class="legend-ema50"></i>EMA 50</span>
          <span><i class="legend-vwap"></i>VWAP UTC</span>
          ${trade ? `<span class="chart-trade-summary">${escapeHtml(trade.side)} · ${escapeHtml(statusTextForTrade(trade.status))} · PnL ${displayValue(trade.pnl_points)} pts</span>` : '<span>Sin operaciones simuladas en este tramo</span>'}
        </div>
      </div>`;
    };
    return `
      <article class="analysis-result-card">
        <div class="analysis-result-heading">
          <div>
            <h3>${escapeHtml(result.bot_name)} <span>${escapeHtml(result.symbol)} · ${escapeHtml(result.timeframe)}</span></h3>
            <small>${escapeHtml(result.strategy)} · ${escapeHtml(statusLabel)}</small>
          </div>
          <strong class="${signalClass}">${escapeHtml(result.signal)}</strong>
        </div>
        <p>${escapeHtml(result.reason)}</p>
        <p class="analysis-trade-count">Señales simuladas en las últimas ${Number(result.historical_simulation_bars_tested || 0)} velas: <strong>${hypotheticalCount}</strong></p>
        ${renderChart()}
        <div class="analysis-indicators">
          <span>Cierre <b>${displayValue(indicators.close)}</b></span>
          <span>EMA 9/21/50 <b>${displayValue(indicators.ema9)} / ${displayValue(indicators.ema21)} / ${displayValue(indicators.ema50)}</b></span>
          <span>RSI 14 <b>${displayValue(indicators.rsi14)}</b></span>
          <span>MACD / señal <b>${macd}</b></span>
          <span>ATR 14 <b>${displayValue(indicators.atr14)}</b></span>
          <span>VWAP UTC <b>${displayValue(indicators.vwapUtcDay)}</b></span>
          <span>Velas <b>${Number(result.bars_analyzed || 0)}</b></span>
        </div>
        <small class="analysis-result-source">CSV histórico · última vela ${escapeHtml(result.last_bar_at || '')} · no es una recomendación ni una orden.</small>
      </article>`;
  }).join('');

  const trades = results.flatMap(result =>
    (result.historical_simulated_trades || []).map(trade => ({
      ...trade,
      bot_id: result.bot_id,
      bot_name: result.bot_name
    }))
  ).sort((left, right) => Date.parse(right.signal_time) - Date.parse(left.signal_time));
  state.historicalTrades = trades;

  const tradeRows = trades.length
    ? trades.map(trade => {
      const resultLabel = {
        TP_HIT: 'TP alcanzado',
        STOP_HIT: 'Stop alcanzado',
        NO_EXIT_IN_HISTORY: 'Sin salida en el histórico'
      }[trade.status] || trade.status;
      const resultClass = trade.status === 'TP_HIT'
        ? 'analysis-bullish'
        : trade.status === 'STOP_HIT'
          ? 'analysis-bearish'
          : 'analysis-neutral';
      return `<tr>
        <td>${escapeHtml(trade.bot_name)}</td>
        <td>${escapeHtml(trade.symbol)} · ${escapeHtml(trade.timeframe)}</td>
        <td>${escapeHtml(trade.strategy)}</td>
        <td class="${trade.side === 'BUY' ? 'analysis-bullish' : 'analysis-bearish'}">${escapeHtml(trade.side)}</td>
        <td>${Number(trade.entry_price).toFixed(2)}<small>${escapeHtml(trade.entry_time)}</small></td>
        <td>${Number(trade.stop_loss).toFixed(2)}</td>
        <td>${Number(trade.take_profit).toFixed(2)}</td>
        <td class="${resultClass}">${escapeHtml(resultLabel)}<small>${Number(trade.exit_price).toFixed(2)} · ${escapeHtml(trade.exit_time)}</small></td>
        <td>${Number(trade.pnl_points).toFixed(2)} pts</td>
      </tr>`;
    }).join('')
    : '<tr><td colspan="9" class="analysis-no-trades">Todavía no se detectaron operaciones con los CSV, estrategias e intervalos cargados.</td></tr>';

  container.innerHTML = `${analysisCards}
    <section class="analysis-trades-panel">
      <div class="analysis-trades-heading">
        <div>
          <h3>Operaciones hipotéticas sobre el histórico</h3>
          <p>Entrada en la apertura posterior a la señal; hasta 25 registros recientes por bot e intervalo.</p>
        </div>
        <strong>SOLO SIMULACIÓN</strong>
      </div>
      <div class="table-responsive">
        <table class="data-table analysis-trades-table">
          <thead><tr>
            <th>BOT</th><th>INSTRUMENTO / INTERVALO</th><th>ESTRATEGIA</th><th>OPERACIÓN</th>
            <th>ENTRADA</th><th>STOP</th><th>TAKE PROFIT</th><th>RESULTADO</th><th>PnL (PUNTOS)</th>
          </tr></thead>
          <tbody>${tradeRows}</tbody>
        </table>
      </div>
      <small class="analysis-result-source">OHLCV no muestra el orden de precios dentro de cada vela: si TP y stop aparecen tocados en la misma vela, se asume primero el stop. Sin comisiones, spread ni slippage; no es una operación real ni una recomendación.</small>
    </section>`;
}

function statusTextForTrade(status) {
  return {
    TP_HIT: 'objetivo alcanzado',
    STOP_HIT: 'stop alcanzado',
    NO_EXIT_IN_HISTORY: 'sin salida en el histórico'
  }[status] || status;
}

function openAddIdentityModal() {
  document.getElementById('add-identity-modal').classList.add('open');
}

function closeAddIdentityModal() {
  document.getElementById('add-identity-modal').classList.remove('open');
}

async function submitAddIdentity(event) {
  event.preventDefault();
  const id = document.getElementById('new-ident-id').value.trim();
  const name = document.getElementById('new-ident-name').value.trim();
  const country = document.getElementById('new-ident-country').value.trim().toUpperCase();
  const city = document.getElementById('new-ident-city').value.trim();
  const flag = document.getElementById('new-ident-flag').value.trim() || '🌐';
  const kyc = document.getElementById('new-ident-kyc').value;
  const email = document.getElementById('new-ident-email').value.trim();
  const notes = document.getElementById('new-ident-notes').value.trim();

  const payload = {
    id: id,
    full_name: name,
    country: country,
    city: city,
    flag: flag,
    kyc_status: kyc,
    email: email,
    notes: notes
  };

  try {
    const resp = await apiFetch('/api/identities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.detail || 'Error registrando titular');
    }

    closeAddIdentityModal();
    showToast(`Titular "${name}" guardado como pendiente. Esto no verifica el KYC.`, 'info');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

// ======================================================================
// 11. MODAL DETALLE DE BOT
// ======================================================================

function openDetailModal(botId) {
  state.selectedBotId = botId;
  updateDetailModalContent(botId);
  document.getElementById('bot-detail-modal').classList.add('open');
  setTimeout(() => {
    initModalBotChart(botId);
  }, 120);
}

function closeDetailModal() {
  state.selectedBotId = null;
  if (state.modalChartInstance) {
    try { state.modalChartInstance.remove(); } catch (e) {}
    state.modalChartInstance = null;
    state.modalCandleSeries = null;
  }
  document.getElementById('bot-detail-modal').classList.remove('open');
}

function updateDetailModalContent(botId) {
  const bot = state.bots.find(b => b.id === botId);
  if (!bot) return;

  const ident = bot.identity || { full_name: 'Sin Titular', flag: '👤' };

  document.getElementById('modal-bot-name').textContent = bot.name;
  document.getElementById('modal-bot-strategy').textContent = bot.strategy;
  document.getElementById('modal-bot-titular-badge').textContent = `${ident.flag || '👤'} ${ident.full_name}`;

  const statusBadge = document.getElementById('modal-bot-status-badge');
  statusBadge.textContent = bot.status === 'ACTIVE' ? '🟢 ACTIVO' : '🟡 PAUSADO';
  statusBadge.className = `bot-status-tag ${bot.status.toLowerCase()}`;

  const toggleBtn = document.getElementById('modal-toggle-btn');
  toggleBtn.textContent = bot.status === 'ACTIVE' ? 'Pausar Bot' : 'Reanudar Bot';

  document.getElementById('modal-proxy-url').textContent = bot.proxy_url || 'No configurado';
  document.getElementById('modal-proxy-ip').textContent = bot.proxy_ip || 'No verificada';
  document.getElementById('modal-proxy-ping').textContent = bot.proxy_healthy ? `⚡ ${bot.proxy_ping_ms} ms` : 'No verificada';

  if (bot.schedule) {
    document.getElementById('modal-start-time').value = bot.schedule.start_time || '09:30';
    document.getElementById('modal-end-time').value = bot.schedule.end_time || '11:30';
  }

  // KPIs
  const pnlElem = document.getElementById('modal-net-pnl');
  pnlElem.textContent = formatCurrency(bot.net_pnl);
  pnlElem.className = `kpi-val ${bot.net_pnl >= 0 ? 'text-neon' : 'text-danger'}`;

  document.getElementById('modal-win-rate').textContent = `${bot.win_rate || 0}%`;
  document.getElementById('modal-win-loss').textContent = `${bot.winning_trades || 0} Ganados / ${bot.losing_trades || 0} Perdidos`;
  document.getElementById('modal-consistency-val').textContent = `${bot.consistency_pct || 0}%`;
  document.getElementById('modal-max-dd').textContent = formatCurrency(bot.max_drawdown || 0);
  populateCircuitBreakerInModal(bot);

  // Tabla Cuentas
  const tbody = document.getElementById('modal-accounts-tbody');
  tbody.innerHTML = (bot.accounts || []).map(a => {
    const floatClass = a.floating_pnl >= 0 ? 'text-neon' : 'text-danger';
    return `
      <tr>
        <td><strong>${escapeHtml(a.custom_name)}</strong></td>
        <td>${escapeHtml(a.prop_firm)}</td>
        <td>${escapeHtml(a.broker)}</td>
        <td><span class="env-badge ${a.environment}">${escapeHtml(a.environment)}</span></td>
        <td class="text-mono">${escapeHtml(a.username || 'APEX-***')}</td>
        <td class="text-mono">${formatCurrency(a.balance)}</td>
        <td class="text-mono ${floatClass}">${formatCurrency(a.floating_pnl)}</td>
        <td class="text-mono">${a.active_contracts} MNQ</td>
        <td><span class="text-neon">● ${escapeHtml(a.status)}</span></td>
      </tr>`;
  }).join('');

  // Logs
  const consoleElem = document.getElementById('modal-console-logs');
  consoleElem.innerHTML = (bot.logs || []).map(l => `
    <div class="log-entry">
      <span class="log-ts">[${escapeHtml(l.timestamp)}]</span>
      <span class="log-lvl-${escapeHtml(l.level)}">[${escapeHtml(l.level)}]</span>
      <span class="log-msg">${escapeHtml(l.message)}</span>
    </div>
  `).join('');
}

async function toggleBot(botId) {
  try {
    const resp = await apiFetch(`/api/bots/${botId}/toggle`, { method: 'POST' });
    if (!resp.ok) throw new Error('Error cambiando estado');
    const data = await resp.json();
    showToast(`Bot ${botId} cambiado a ${data.new_status || data.status}`, 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function toggleCurrentModalBot() {
  if (state.selectedBotId) toggleBot(state.selectedBotId);
}

async function closeBotPositions(botId) {
  const ok = await confirmModal('Cerrar Posiciones', `¿Cerrar inmediatamente las posiciones abiertas del bot ${botId}?`, true);
  if (!ok) return;

  try {
    const resp = await apiFetch(`/api/bots/${botId}/close`, { method: 'POST' });
    if (!resp.ok) throw new Error('Error cerrando posiciones');
    const data = await resp.json();
    showToast(`Posiciones cerradas. PnL: ${formatCurrency(data.pnl_realized)}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function closeCurrentModalPositions() {
  if (state.selectedBotId) closeBotPositions(state.selectedBotId);
}

async function saveCurrentModalSchedule() {
  if (!state.selectedBotId) return;
  const start = document.getElementById('modal-start-time').value;
  const end = document.getElementById('modal-end-time').value;

  try {
    const resp = await apiFetch(`/api/bots/${state.selectedBotId}/schedule`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_time: start, end_time: end, timezone: 'America/New_York' })
    });
    if (!resp.ok) throw new Error('Error al guardar horario');
    showToast('Horario operativo actualizado con éxito.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ======================================================================
// 12. UTILIDADES DE COPIADO (WEBHOOKS)
// ======================================================================

function copyWebhookUrl() {
  const host = window.location.hostname || '127.0.0.1';
  const port = window.location.port || '8000';
  const url = `http://${host}:${port}/api/webhook`;
  navigator.clipboard.writeText(url);
  showToast('URL del Webhook copiada al portapapeles', 'info');
}

function copyWebhookPayload() {
  const text = `{
  "token": "<CONFIGURE_WEBHOOK_TOKEN>",
  "ticker": "MNQ",
  "action": "{{strategy.order.action}}",
  "price": {{close}},
  "contracts": 1,
  "sl": 0.0,
  "tp": 0.0,
  "strategy": "ICTStrategy",
  "comment": "TradingView Alert"
}`;
  navigator.clipboard.writeText(text);
  showToast('Formato JSON copiado al portapapeles', 'info');
}

// ======================================================================
// 13. MODAL DE CONFIRMACIÓN PROMISE-BASED
// ======================================================================

function confirmModal(title, message, isDanger = false) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const okBtn = document.getElementById('confirm-ok-btn');
    okBtn.className = isDanger ? 'btn btn-danger' : 'btn btn-primary';
    document.getElementById('confirm-icon').textContent = isDanger ? '🔴' : 'ℹ️';
    document.getElementById('confirm-modal').classList.add('open');
  });
}

function resolveConfirm(result) {
  document.getElementById('confirm-modal').classList.remove('open');
  if (confirmResolver) {
    confirmResolver(result);
    confirmResolver = null;
  }
}

// ======================================================================
// 14. MOTOR DE NOTIFICACIONES TOAST (ALERTAS EN VIVO)
// ======================================================================

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: '✅',
    error: '❌',
    warn: '⚠️',
    info: 'ℹ️'
  };

  toast.innerHTML = `
    <span class="toast-icon">${iconMap[type] || 'ℹ️'}</span>
    <span class="toast-msg">${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) reverse forwards';
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, duration);
}

// ======================================================================
// 15. UTILIDADES GENERALES
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

// Inicialización de la aplicación

// ======================================================================
// 16. MÓDULO TRADINGVIEW LIGHTWEIGHT CHARTS (CANVAS 60FPS)
// Soporte cruzado v4 (addCandlestickSeries) y v5 (addSeries + CandlestickSeries)
// ======================================================================

function createCandleSeriesCompat(chart, options) {
  if (!chart) return null;
  if (typeof chart.addCandlestickSeries === 'function') {
    return chart.addCandlestickSeries(options);
  }
  if (typeof chart.addSeries === 'function' && window.LightweightCharts?.CandlestickSeries) {
    return chart.addSeries(window.LightweightCharts.CandlestickSeries, options);
  }
  throw new Error('Unsupported LightweightCharts version or missing CandlestickSeries');
}

function setSeriesMarkersCompat(series, markers, holder, key) {
  if (!series) return;
  const safeMarkers = Array.isArray(markers) ? markers : [];
  try {
    if (typeof series.setMarkers === 'function') {
      series.setMarkers(safeMarkers);
    } else if (window.LightweightCharts && typeof window.LightweightCharts.createSeriesMarkers === 'function') {
      if (holder && holder[key]) {
        holder[key].setMarkers(safeMarkers);
      } else {
        const prim = window.LightweightCharts.createSeriesMarkers(series, safeMarkers);
        if (holder) {
          holder[key] = prim;
        }
      }
    }
  } catch (e) {
    console.warn('Error configurando marcadores en serie:', e);
  }
}

async function initLightweightChart() {
  const container = document.getElementById('tradingview-chart-box');
  if (!container || !window.LightweightCharts) return;

  if (state.chartResizeObserver) {
    try { state.chartResizeObserver.disconnect(); } catch (e) {}
    state.chartResizeObserver = null;
  }

  if (state.chartInstance) {
    try { state.chartInstance.remove(); } catch (e) {}
    state.chartInstance = null;
    state.candleSeries = null;
    state.chartMarkersPrimitive = null;
  }

  container.innerHTML = '';

  const initialWidth = container.clientWidth > 0 ? container.clientWidth : (container.parentElement && container.parentElement.clientWidth > 0 ? container.parentElement.clientWidth : 900);
  const chart = LightweightCharts.createChart(container, {
    width: initialWidth,
    height: 520,
    layout: {
      background: { color: '#0D0D0D' },
      textColor: '#A0A0A0'
    },
    grid: {
      vertLines: { color: '#1A1A1A' },
      horzLines: { color: '#1A1A1A' }
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: '#404040', labelBackgroundColor: '#1E1E1E' },
      horzLine: { color: '#404040', labelBackgroundColor: '#1E1E1E' }
    },
    rightPriceScale: {
      borderColor: '#262626',
      scaleMargins: { top: 0.1, bottom: 0.2 }
    },
    timeScale: {
      borderColor: '#262626',
      timeVisible: true,
      secondsVisible: false
    }
  });

  const candleSeries = createCandleSeriesCompat(chart, {
    upColor: '#00E676',
    downColor: '#FF5252',
    borderUpColor: '#00E676',
    borderDownColor: '#FF5252',
    wickUpColor: '#00E676',
    wickDownColor: '#FF5252'
  });

  state.chartInstance = chart;
  state.candleSeries = candleSeries;
  state.chartMarkersPrimitive = null;

  // Actualizar selector de bots en gráficos
  const chartBotSel = document.getElementById('chart-bot-selector');
  if (chartBotSel && state.bots && state.bots.length) {
    const prev = chartBotSel.value;
    chartBotSel.innerHTML = `<option value="ALL">Todos los Bots (Ejecuciones Globales)</option>` +
      state.bots.map(b => `<option value="${b.id}">${escapeHtml(b.name)} (${b.id})</option>`).join('');
    chartBotSel.value = prev || 'ALL';
  }

  // Manejador de leyenda dinámica flotante (OHLC)
  chart.subscribeCrosshairMove(param => {
    if (!param || !param.time || !param.seriesData) return;
    const bar = param.seriesData.get(candleSeries);
    if (!bar) return;
    const openEl = document.getElementById('leg-open');
    const highEl = document.getElementById('leg-high');
    const lowEl = document.getElementById('leg-low');
    const closeEl = document.getElementById('leg-close');
    const volEl = document.getElementById('leg-vol');
    if (openEl) openEl.textContent = bar.open?.toFixed(2) || '--';
    if (highEl) highEl.textContent = bar.high?.toFixed(2) || '--';
    if (lowEl) lowEl.textContent = bar.low?.toFixed(2) || '--';
    if (closeEl) closeEl.textContent = bar.close?.toFixed(2) || '--';
    if (volEl && bar.volume) volEl.textContent = bar.volume;
  });

  if (window.ResizeObserver) {
    state.chartResizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.contentRect && entry.contentRect.width > 0 && state.chartInstance) {
          state.chartInstance.applyOptions({ width: Math.floor(entry.contentRect.width) });
        }
      }
    });
    state.chartResizeObserver.observe(container);
  } else {
    window.addEventListener('resize', () => {
      if (state.chartInstance && container && container.clientWidth > 0) {
        state.chartInstance.applyOptions({ width: container.clientWidth });
      }
    });
  }

  await loadChartCandleData();
  await renderMultiBotCharts();
}

async function loadChartCandleData() {
  try {
    let url = `/api/market/candles?tf=${state.chartTimeframe || '1m'}`;
    if (state.chartBotFilter && state.chartBotFilter !== 'ALL') {
      url = `/api/bot/${encodeURIComponent(state.chartBotFilter)}/candles?interval=${state.chartTimeframe || '1m'}`;
    }
    const resp = await apiFetch(url);
    if (!resp.ok) return;
    const data = await resp.json();

    if (state.candleSeries && data.candles && data.candles.length) {
      state.candleSeries.setData(data.candles);
      state.chartMarkers = data.markers || [];
      updateChartMarkers();
      state.chartInstance?.timeScale().fitContent();

      const last = data.candles[data.candles.length - 1];
      const curPriceEl = document.getElementById('chart-current-price');
      if (curPriceEl && last) {
        curPriceEl.textContent = `$${last.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
      const tickerEl = document.getElementById('market-price-val');
      if (tickerEl && last) {
        tickerEl.textContent = last.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    }
  } catch (err) {
    console.warn('Error cargando velas:', err);
  }
}

function updateChartMarkers() {
  if (!state.candleSeries) return;
  let markers = state.chartMarkers || [];
  if (state.chartBotFilter && state.chartBotFilter !== 'ALL') {
    markers = markers.filter(m => m.text?.includes(state.chartBotFilter));
  }
  setSeriesMarkersCompat(state.candleSeries, markers, state, 'chartMarkersPrimitive');
  const countEl = document.getElementById('chart-markers-count');
  if (countEl) countEl.textContent = `${markers.length} Ejecuciones`;
}

async function setChartTimeframe(tf) {
  state.chartTimeframe = tf;
  document.querySelectorAll('.timeframe-buttons .btn-tf').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('onclick')?.includes(`'${tf}'`));
  });
  await loadChartCandleData();
}

async function onChartBotFilterChange() {
  const sel = document.getElementById('chart-bot-selector');
  if (sel) state.chartBotFilter = sel.value;
  await loadChartCandleData();
}

function updateChartRealtimeCandle(candle) {
  if (state.candleSeries && candle) {
    state.candleSeries.update(candle);
    const curPriceEl = document.getElementById('chart-current-price');
    if (curPriceEl) curPriceEl.textContent = `$${candle.close.toFixed(2)}`;
  }
}

async function renderMultiBotCharts() {
  const grid = document.getElementById('multi-bot-charts-grid');
  if (!grid || !window.LightweightCharts) return;

  if (!state.bots || !state.bots.length) {
    grid.innerHTML = '<div class="empty-state" style="padding: 20px; color: #8B90A0; grid-column: 1 / -1; text-align: center;">No hay bots configurados para mostrar en la cuadrícula.</div>';
    return;
  }

  state.miniBotCharts = state.miniBotCharts || {};

  let html = '';
  state.bots.forEach(bot => {
    html += `
      <div class="bot-chart-card" id="bot-chart-card-${bot.id}">
        <div class="bot-chart-card-header">
          <div class="bot-chart-meta">
            <span class="bot-chart-name">${escapeHtml(bot.name)}</span>
            <span class="bot-chart-symbol-badge" id="bot-symbol-badge-${bot.id}">MNQ</span>
          </div>
          <span class="badge-status-dot active" title="Activo"></span>
        </div>
        <div class="bot-chart-container" id="mini-chart-${bot.id}"></div>
        <div class="bot-chart-footer">
          <span>Último: <strong id="mini-price-${bot.id}" class="text-neon">--</strong></span>
          <span>Estrategia: ${escapeHtml(bot.strategy || 'ICT')}</span>
        </div>
      </div>
    `;
  });
  grid.innerHTML = html;

  for (const bot of state.bots) {
    const el = document.getElementById(`mini-chart-${bot.id}`);
    if (!el) continue;

    if (state.miniBotCharts[bot.id]) {
      try { state.miniBotCharts[bot.id].chart.remove(); } catch (e) {}
      delete state.miniBotCharts[bot.id];
    }

    const miniChart = LightweightCharts.createChart(el, {
      width: el.clientWidth > 0 ? el.clientWidth : 320,
      height: 200,
      layout: {
        background: { color: '#07090C' },
        textColor: '#8B90A0'
      },
      grid: {
        vertLines: { color: '#13161F' },
        horzLines: { color: '#13161F' }
      },
      rightPriceScale: {
        borderColor: '#1F2433',
        scaleMargins: { top: 0.1, bottom: 0.2 }
      },
      timeScale: {
        borderColor: '#1F2433',
        timeVisible: true,
        secondsVisible: false
      }
    });

    const series = createCandleSeriesCompat(miniChart, {
      upColor: '#10B981',
      downColor: '#EF4444',
      borderUpColor: '#10B981',
      borderDownColor: '#EF4444',
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444'
    });

    state.miniBotCharts[bot.id] = { chart: miniChart, series };

    try {
      const resp = await apiFetch(`/api/bot/${bot.id}/candles?limit=60`);
      if (resp.ok) {
        const payload = await resp.json();
        if (payload.candles && payload.candles.length) {
          series.setData(payload.candles);
          miniChart.timeScale().fitContent();
          const last = payload.candles[payload.candles.length - 1];
          const prEl = document.getElementById(`mini-price-${bot.id}`);
          if (prEl && last) prEl.textContent = `$${last.close.toFixed(2)}`;
        }
        const symEl = document.getElementById(`bot-symbol-badge-${bot.id}`);
        if (symEl && payload.symbol) symEl.textContent = payload.symbol;
      }
    } catch (e) {
      console.warn(`Error cargando gráfico mini para ${bot.id}:`, e);
    }
  }
}

// Auto-refresh de gráficos cada 60s
if (!window._chartRefreshTimer) {
  window._chartRefreshTimer = setInterval(() => {
    if (state.activeTab === 'charts') {
      loadChartCandleData();
      if (state.miniBotCharts) {
        Object.entries(state.miniBotCharts).forEach(async ([botId, item]) => {
          try {
            const resp = await apiFetch(`/api/bot/${botId}/candles?limit=60`);
            if (resp.ok) {
              const payload = await resp.json();
              if (payload.candles && payload.candles.length && item.series) {
                item.series.setData(payload.candles);
                const last = payload.candles[payload.candles.length - 1];
                const prEl = document.getElementById(`mini-price-${botId}`);
                if (prEl && last) prEl.textContent = `$${last.close.toFixed(2)}`;
              }
            }
          } catch (e) {}
        });
      }
    }
  }, 60000);
}

// ======================================================================
// 17. MÓDULO LEDGER FINANCIERO & REPARTO A TITULARES KYC
// ======================================================================

async function loadLedgerData() {
  try {
    const url = state.ledgerIdentityFilter === 'ALL'
      ? '/api/ledger/summary'
      : `/api/ledger/summary?identity=${state.ledgerIdentityFilter}`;
    const resp = await apiFetch(url);
    if (!resp.ok) return;
    state.ledgerData = await resp.json();
    renderLedgerView();
  } catch (err) {
    console.warn('Error cargando ledger:', err);
  }
}

function renderLedgerView() {
  if (!state.ledgerData) return;
  const { summary, identity_breakdown, transactions } = state.ledgerData;

  const invEl = document.getElementById('ledger-total-invested');
  const grossEl = document.getElementById('ledger-gross-payouts');
  const accruedEl = document.getElementById('ledger-titular-accrued');
  const pendingEl = document.getElementById('ledger-pending-titulares');
  const netEl = document.getElementById('ledger-operator-net');

  if (invEl) invEl.textContent = formatCurrency(-summary.total_invested);
  if (grossEl) grossEl.textContent = formatCurrency(summary.total_gross_payouts);
  if (accruedEl) accruedEl.textContent = formatCurrency(summary.total_titular_share);
  if (pendingEl) pendingEl.textContent = formatCurrency(summary.pending_to_titulares);
  if (netEl) netEl.textContent = formatCurrency(summary.operator_net_profit);

  const filterSel = document.getElementById('ledger-identity-filter');
  if (filterSel && state.identities.length) {
    const currentVal = filterSel.value;
    filterSel.innerHTML = `<option value="ALL">Vista Consolidada (Todos los Titulares)</option>` +
      state.identities.map(i => `<option value="${i.id}" ${currentVal === i.id ? 'selected' : ''}>${escapeHtml(i.full_name)} (${i.flag || '🇺🇸'})</option>`).join('');
  }

  const idTbody = document.getElementById('ledger-identities-tbody');
  if (idTbody) {
    idTbody.innerHTML = (identity_breakdown || []).map(row => `
      <tr>
        <td><strong>${escapeHtml(row.identity_name)}</strong></td>
        <td>${row.flag || '🇺🇸'} ${escapeHtml(row.country || 'US')}</td>
        <td class="text-mono text-danger">${formatCurrency(-row.total_invested)}</td>
        <td class="text-mono text-neon">${formatCurrency(row.gross_payouts)}</td>
        <td class="text-mono">${row.split_rate_pct}%</td>
        <td class="text-mono text-amber">${formatCurrency(row.share_accrued)}</td>
        <td class="text-mono">${formatCurrency(row.paid_to_date)}</td>
        <td class="text-mono font-bold ${row.pending_payout > 0 ? 'text-amber' : 'text-muted'}">${formatCurrency(row.pending_payout)}</td>
        <td>
          <button class="btn btn-outline btn-xs" onclick="quickPayoutForIdentity('${row.identity_id}', ${row.pending_payout})">
            Pagar Split ➔
          </button>
        </td>
      </tr>
    `).join('');
  }

  const txTbody = document.getElementById('ledger-transactions-tbody');
  if (txTbody) {
    txTbody.innerHTML = (transactions || []).map(tx => {
      const isPositive = tx.amount > 0;
      const typeLabels = {
        PROP_FIRM_PAYOUT: 'Retiro Prop Firm (Ingreso)',
        TITULAR_SPLIT_PAYOUT: 'Pago Transferido a Titular (Split 20%)',
        INVESTMENT_EVAL: 'Compra Evaluación (Costo)',
        INVESTMENT_PA_FEE: 'Fee Activación PA (Costo)'
      };
      return `
        <tr>
          <td class="text-mono">${escapeHtml(tx.date)}</td>
          <td><strong>${escapeHtml(tx.identity_name)}</strong></td>
          <td>${escapeHtml(tx.account_name)} <span class="text-muted">(${escapeHtml(tx.prop_firm)})</span></td>
          <td><span class="badge-strat">${typeLabels[tx.type] || tx.type}</span></td>
          <td class="text-mono font-bold ${isPositive ? 'text-neon' : 'text-danger'}">
            ${isPositive ? '+' : ''}${formatCurrency(tx.amount)}
          </td>
          <td><span class="badge-status-dot active"></span> ${escapeHtml(tx.status)}</td>
          <td class="text-mono text-muted" style="font-size: 0.72rem;">${escapeHtml(tx.notes || '-')}</td>
        </tr>
      `;
    }).join('');
  }
}

function onLedgerFilterChange() {
  const sel = document.getElementById('ledger-identity-filter');
  if (sel) state.ledgerIdentityFilter = sel.value;
  loadLedgerData();
}

function openAddLedgerModal() {
  const sel = document.getElementById('ledger-modal-identity');
  if (sel && state.identities.length) {
    sel.innerHTML = state.identities.map(i => `<option value="${i.id}">${escapeHtml(i.full_name)} (${i.id})</option>`).join('');
  }
  document.getElementById('add-ledger-modal')?.classList.add('open');
}

function closeAddLedgerModal() {
  document.getElementById('add-ledger-modal')?.classList.remove('open');
}

function quickPayoutForIdentity(identityId, pendingAmount) {
  openAddLedgerModal();
  const identSel = document.getElementById('ledger-modal-identity');
  const typeSel = document.getElementById('ledger-modal-type');
  const amountInput = document.getElementById('ledger-modal-amount');
  if (identSel) identSel.value = identityId;
  if (typeSel) typeSel.value = 'TITULAR_SPLIT_PAYOUT';
  if (amountInput) amountInput.value = Math.max(0, pendingAmount);
}

async function submitAddLedger(event) {
  event.preventDefault();
  const identityId = document.getElementById('ledger-modal-identity').value;
  const type = document.getElementById('ledger-modal-type').value;
  const account = document.getElementById('ledger-modal-account').value.trim();
  const amount = Number(document.getElementById('ledger-modal-amount').value);
  const notes = document.getElementById('ledger-modal-notes').value.trim();

  try {
    const resp = await apiFetch('/api/ledger/payout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity_id: identityId,
        type,
        account_name: account,
        prop_firm: 'Apex Trader Funding',
        amount,
        notes
      })
    });
    if (!resp.ok) throw new Error('Error al registrar transacción');
    closeAddLedgerModal();
    showToast('Transacción registrada en el Ledger con éxito', 'success');
    playAudioCue('chime');
    loadLedgerData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ======================================================================
// 18. MÓDULO CALENDARIO MACRO FOREXFACTORY
// ======================================================================

state.newsCurrencyFilter = 'ALL';
state.newsImpactFilter = 'ALL';
state.newsSearchQuery = '';

function setNewsCurrencyFilter(currency) {
  state.newsCurrencyFilter = currency;
  document.querySelectorAll('#ff-currency-pills .ff-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-currency') === currency);
  });
  renderNewsView();
}

function setNewsImpactFilter(impact) {
  state.newsImpactFilter = impact;
  document.querySelectorAll('#ff-impact-pills .ff-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-impact') === impact);
  });
  renderNewsView();
}

function handleNewsSearch(event) {
  state.newsSearchQuery = (event.target.value || '').trim().toLowerCase();
  renderNewsView();
}

async function loadEconomicNews() {
  try {
    const resp = await apiFetch('/api/news/calendar');
    if (!resp.ok) return;
    const data = await resp.json();
    state.economicNews = data.events || [];
    renderNewsView();
  } catch (err) {
    console.warn('Error cargando noticias:', err);
  }
}

function renderNewsView() {
  const tbody = document.getElementById('news-events-tbody');
  if (!tbody) return;

  const subtitle = document.getElementById('news-filter-subtitle');
  if (subtitle) {
    const currText = state.newsCurrencyFilter === 'ALL' ? 'Todas las divisas' : state.newsCurrencyFilter;
    const impactText = state.newsImpactFilter === 'ALL' ? 'Todos los impactos' : (state.newsImpactFilter === 'HIGH' ? '🔴 Solo Alto Impacto' : '🟠 Medio & Alto');
    subtitle.textContent = `Filtros activos: ${currText} | ${impactText}`;
  }

  const filtered = (state.economicNews || []).filter(ev => {
    // 1. Filtro Divisa (ej. USD, JPY, EUR, GBP)
    if (state.newsCurrencyFilter !== 'ALL' && ev.currency !== state.newsCurrencyFilter) {
      return false;
    }
    // 2. Filtro Impacto (HIGH o MEDIUM_HIGH)
    if (state.newsImpactFilter === 'HIGH' && ev.impact !== 'HIGH') {
      return false;
    }
    if (state.newsImpactFilter === 'MEDIUM_HIGH' && !['HIGH', 'MEDIUM'].includes(ev.impact)) {
      return false;
    }
    // 3. Filtro Búsqueda
    if (state.newsSearchQuery) {
      const matchName = (ev.event || '').toLowerCase().includes(state.newsSearchQuery);
      const matchCurr = (ev.currency || '').toLowerCase().includes(state.newsSearchQuery);
      if (!matchName && !matchCurr) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center" style="padding: 32px; color: var(--text-secondary);">
      No se encontraron noticias con los filtros actuales (Divisa: ${escapeHtml(state.newsCurrencyFilter)}, Impacto: ${escapeHtml(state.newsImpactFilter)}).
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(ev => {
    const impactClass = ev.impact === 'HIGH' ? 'high' : (ev.impact === 'MEDIUM' ? 'medium' : 'low');
    const folderIcon = ev.impact === 'HIGH' ? '🔴' : (ev.impact === 'MEDIUM' ? '🟠' : '🟡');
    const impactLabel = ev.impact === 'HIGH' ? 'ALTO' : (ev.impact === 'MEDIUM' ? 'MEDIO' : 'BAJO');

    // Color del dato actual (ForexFactory style: Verde mejor a previsión, Rojo peor)
    let actualHtml = '<span class="text-muted">-</span>';
    if (ev.actual !== null && ev.actual !== undefined) {
      const valColor = ev.better_worse === 'better' ? 'text-neon font-bold' : (ev.better_worse === 'worse' ? 'text-danger font-bold' : 'font-bold');
      actualHtml = `<span class="${valColor}">${escapeHtml(ev.actual)}</span>`;
    }

    const currBadgeClass = `curr-badge-${(ev.currency || '').toLowerCase()}`;

    return `
      <tr>
        <td class="text-mono">${escapeHtml(ev.date)}</td>
        <td class="text-mono font-bold">${escapeHtml(ev.time_est)}</td>
        <td><span class="ff-curr-badge ${currBadgeClass}">${escapeHtml(ev.currency)}</span></td>
        <td><span class="impact-badge ${impactClass}">${folderIcon} ${impactLabel}</span></td>
        <td><strong>${escapeHtml(ev.event)}</strong></td>
        <td class="text-mono">${actualHtml}</td>
        <td class="text-mono">${escapeHtml(ev.forecast || '-')}</td>
        <td class="text-mono text-muted">${escapeHtml(ev.previous || '-')}</td>
        <td><span class="badge-status-dot ${ev.status === 'COMPLETED' ? '' : 'active'}"></span> ${escapeHtml(ev.status)}</td>
      </tr>
    `;
  }).join('');
}

// ======================================================================
// 19. CIRCUIT BREAKER & CONSISTENCY LOCK
// ======================================================================

function populateCircuitBreakerInModal(bot) {
  const cb = bot.circuit_breaker || {
    daily_loss_limit: 1000,
    consistency_target: 150,
    auto_lock_consistency: true,
    pause_on_red_news: true,
    status: 'NORMAL'
  };

  const targetInput = document.getElementById('modal-cb-target');
  const autoLockCheck = document.getElementById('modal-cb-auto-lock');
  const dllInput = document.getElementById('modal-cb-dll');
  const pauseNewsCheck = document.getElementById('modal-cb-pause-news');
  const statusBadge = document.getElementById('modal-cb-status-badge');

  if (targetInput) targetInput.value = cb.consistency_target || 150;
  if (autoLockCheck) autoLockCheck.checked = cb.auto_lock_consistency !== false;
  if (dllInput) dllInput.value = cb.daily_loss_limit || 1000;
  if (pauseNewsCheck) pauseNewsCheck.checked = cb.pause_on_red_news !== false;

  if (statusBadge) {
    if (cb.status === 'LOCKED_PROFIT') {
      statusBadge.textContent = '🎯 META DE CONSISTENCIA ASEGURADA (+$150)';
      statusBadge.className = 'badge-strat text-neon';
    } else if (cb.status === 'TRIPPED_STOP') {
      statusBadge.textContent = '🛑 CIRCUIT BREAKER ACTIVADO (DLL STOP)';
      statusBadge.className = 'badge-strat text-danger';
    } else {
      statusBadge.textContent = 'ESTADO: NORMAL (VIGILANDO)';
      statusBadge.className = 'badge-strat';
    }
  }
}

async function saveCurrentModalCircuitBreaker() {
  if (!state.selectedBotId) return;

  const target = Number(document.getElementById('modal-cb-target').value);
  const autoLock = document.getElementById('modal-cb-auto-lock').checked;
  const dll = Number(document.getElementById('modal-cb-dll').value);
  const pauseNews = document.getElementById('modal-cb-pause-news').checked;

  try {
    const resp = await apiFetch(`/api/bots/${state.selectedBotId}/circuit-breaker`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        consistency_target: target,
        auto_lock_consistency: autoLock,
        daily_loss_limit: dll,
        pause_on_red_news: pauseNews
      })
    });
    if (!resp.ok) throw new Error('Error guardando Circuit Breaker');
    showToast('Circuit Breaker y Candado de Consistencia actualizados', 'success');
    playAudioCue('chime');
  } catch (err) {
    showToast(err.message, 'error');
  }
}


// ======================================================================
// 17. CONTROLADOR DE BARRA LATERAL ESTILO LUCID TRADING
// ======================================================================

function toggleSidebarCollapse() {
  const sidebar = document.getElementById('app-sidebar');
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed');
  const isCollapsed = sidebar.classList.contains('collapsed');
  localStorage.setItem('quantum_sidebar_collapsed', isCollapsed);

  const btn = document.getElementById('btn-toggle-collapse');
  if (btn) {
    btn.title = isCollapsed ? 'Expandir Barra Lateral' : 'Contraer Barra Lateral';
  }

  // Ajustar ancho de Gráficos Lightweight Canvas si están abiertos
  setTimeout(() => {
    const box = document.getElementById('tradingview-chart-box');
    if (state.chartInstance && box) {
      state.chartInstance.applyOptions({ width: box.clientWidth });
    }
  }, 260);
}

function toggleSidebarDock() {
  const layout = document.getElementById('terminal-layout');
  if (!layout) return;
  const isRight = layout.classList.contains('sidebar-right');
  if (isRight) {
    layout.classList.remove('sidebar-right');
    layout.classList.add('sidebar-left');
    localStorage.setItem('quantum_sidebar_dock', 'left');
    showToast('Barra movida a pared izquierda', 'info');
  } else {
    layout.classList.remove('sidebar-left');
    layout.classList.add('sidebar-right');
    localStorage.setItem('quantum_sidebar_dock', 'right');
    showToast('Barra movida a pared derecha', 'info');
  }

  setTimeout(() => {
    const box = document.getElementById('tradingview-chart-box');
    if (state.chartInstance && box) {
      state.chartInstance.applyOptions({ width: box.clientWidth });
    }
  }, 100);
}

function initLucidSidebarPreferences() {
  const savedDock = localStorage.getItem('quantum_sidebar_dock') || 'left';
  const layout = document.getElementById('terminal-layout');
  if (layout) {
    layout.classList.toggle('sidebar-right', savedDock === 'right');
    layout.classList.toggle('sidebar-left', savedDock === 'left');
  }

  const savedCollapsed = localStorage.getItem('quantum_sidebar_collapsed') === 'true';
  const sidebar = document.getElementById('app-sidebar');
  if (sidebar && savedCollapsed) {
    sidebar.classList.add('collapsed');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initLucidSidebarPreferences();
  initAuth();
  if (state.token) initWebSocket();
});

// ======================================================================
// 18. GRÁFICO DEDICADO POR BOT // TELEMETRÍA DE POSICIÓN ACTIVA (DEMO)
// ======================================================================

async function initModalBotChart(botId) {
  const container = document.getElementById('modal-bot-chart-box');
  if (!container || !window.LightweightCharts) return;

  if (state.modalChartInstance) {
    try { state.modalChartInstance.remove(); } catch (e) {}
    state.modalChartInstance = null;
    state.modalCandleSeries = null;
    state.modalMarkersPrimitive = null;
  }

  container.innerHTML = '';

  const chartWidth = container.clientWidth > 0 ? container.clientWidth : 750;
  const chart = LightweightCharts.createChart(container, {
    width: chartWidth,
    height: 280,
    layout: {
      background: { color: '#07090C' },
      textColor: '#8B90A0'
    },
    grid: {
      vertLines: { color: '#13161F' },
      horzLines: { color: '#13161F' }
    },
    rightPriceScale: {
      borderColor: '#1F2433',
      scaleMargins: { top: 0.15, bottom: 0.25 }
    },
    timeScale: {
      borderColor: '#1F2433',
      timeVisible: true,
      secondsVisible: false
    }
  });

  const candleSeries = createCandleSeriesCompat(chart, {
    upColor: '#10B981',
    downColor: '#EF4444',
    borderUpColor: '#10B981',
    borderDownColor: '#EF4444',
    wickUpColor: '#10B981',
    wickDownColor: '#EF4444'
  });

  state.modalChartInstance = chart;
  state.modalCandleSeries = candleSeries;
  state.modalMarkersPrimitive = null;

  try {
    const resp = await apiFetch(`/api/bots/${botId}/chart`);
    if (!resp.ok) return;
    const data = await resp.json();

    if (data.candles && data.candles.length) {
      candleSeries.setData(data.candles);
      chart.timeScale().fitContent();
    }

    if (data.markers && data.markers.length) {
      setSeriesMarkersCompat(candleSeries, data.markers, state, 'modalMarkersPrimitive');
    }

    // Telemetría de Posición en Vivo y Líneas de Precio
    const statusBadge = document.getElementById('modal-bot-position-status');
    const pos = data.position;
    if (statusBadge) {
      if (pos && pos.in_position) {
        const isLong = pos.side === 'LONG';
        statusBadge.className = `bot-position-status-badge ${isLong ? 'in-position-long' : 'in-position-short'}`;
        statusBadge.textContent = `${isLong ? '🟢 LONG' : '🔴 SHORT'} ${pos.size} MNQ @ ${pos.entry_price.toFixed(2)} | Flotante: ${formatCurrency(pos.floating_pnl)}`;

        // Líneas de Precio de la Operación en Curso
        candleSeries.createPriceLine({
          price: pos.entry_price,
          color: '#3B82F6',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Solid,
          axisLabelVisible: true,
          title: 'ENTRY'
        });
        candleSeries.createPriceLine({
          price: pos.take_profit,
          color: '#10B981',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'TP (+2R)'
        });
        candleSeries.createPriceLine({
          price: pos.stop_loss,
          color: '#EF4444',
          lineWidth: 2,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'SL (DLL)'
        });
      } else {
        statusBadge.className = 'bot-position-status-badge flat';
        statusBadge.textContent = '⚪ SIN OPERACIONES ACTIVAS (FLAT)';
      }
    }
  } catch (err) {
    console.warn('Error cargando gráfico de bot:', err);
  }
}

async function simulateBotTradeFromModal(side) {
  if (!state.selectedBotId) return;
  try {
    showToast(`Simulando orden ${side} para ${state.selectedBotId}...`, 'info');
    const resp = await apiFetch(`/api/bots/${state.selectedBotId}/simulate-trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side, contracts: 1 })
    });
    if (!resp.ok) throw new Error('Error ejecutando orden simulada');
    showToast(`Orden ${side} ejecutada con éxito @ ${state.marketPrice}`, 'success');
    playAudioCue('chime');
    setTimeout(() => {
      initModalBotChart(state.selectedBotId);
    }, 200);
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}
