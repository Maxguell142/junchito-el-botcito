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
  marketPrice: 18245.50,
  wsConnected: false
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

function toggleLandingView() {
  if (state.activeTab === 'landing') {
    switchTab(state.previousTab || 'dashboard');
  } else {
    state.previousTab = state.activeTab;
    switchTab('landing');
  }
}

function enterTerminalWorkspace() {
  const overlay = document.getElementById('login-overlay');
  if (!state.token) {
    if (overlay) overlay.classList.remove('hidden');
  } else {
    switchTab('dashboard');
  }
}


// ======================================================================
// 1. SISTEMA DE AUTENTICACIÓN Y LOGIN
// ======================================================================

function initAuth() {
  updateAudioButtonUI();
  const overlay = document.getElementById('login-overlay');
  if (state.token) {
    if (overlay) overlay.classList.add('hidden');
    updateHeaderUser();
  } else {
    if (overlay) overlay.classList.remove('hidden');
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
    document.getElementById('login-overlay')?.classList.remove('hidden');
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

    document.getElementById('login-overlay').classList.add('hidden');
    updateHeaderUser();
    initWebSocket();
    showToast(`Bienvenido de nuevo, ${state.currentUser.username}`, 'success');
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
  document.getElementById('login-overlay').classList.remove('hidden');
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
          document.getElementById('login-overlay')?.classList.remove('hidden');
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
        document.getElementById('login-overlay')?.classList.remove('hidden');
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
  document.querySelectorAll('.filter-tag').forEach(tag => {
    tag.classList.toggle('active', tag.getAttribute('onclick')?.includes(`'${filter}'`));
  });
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

    return `
      <div class="bot-card" data-bot-id="${bot.id}">
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
          <span class="bot-status-tag ${statusClass}">${statusLabel}</span>
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

        <!-- Aislamiento de Red Residencial ISP & Anti-Flagging -->
        <div class="bot-net-strip" style="flex-direction: column; align-items: flex-start; gap: 4px; padding: 8px 10px;">
          <div style="display: flex; justify-content: space-between; width: 100%;">
            <div>
              <span class="net-ip-tag font-bold">${escapeHtml(bot.outbound_ip || bot.proxy_ip || 'No verificada')}</span>
              <span style="margin: 0 4px; opacity: 0.4;">|</span>
              <span class="net-ping-tag font-bold">${bot.proxy_healthy ? `⚡ ${bot.proxy_ping_ms} ms` : 'Latencia no verificada'}</span>
            </div>
            <span style="font-size: 0.68rem; color: var(--text-secondary);">${escapeHtml(bot.isp_provider ? bot.isp_provider.split(' ')[0] : 'ISP')}</span>
          </div>
          <div class="geo-match-tag ${bot.geo_consistent ? 'ok' : 'warn'}" style="width: 100%; justify-content: space-between;">
            <span>${escapeHtml(bot.geo_match_status || 'No verificado')}</span>
            <span style="font-size: 0.65rem; opacity: 0.8;">Jitter: ${bot.jitter_min_ms || 50}-${bot.jitter_max_ms || 350}ms</span>
          </div>
        </div>

        <!-- KPIs del Bot -->
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
            <span class="kpi-box-val">${bot.accounts ? bot.accounts.length : 0}</span>
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

        <!-- Acciones de la Tarjeta -->
        <div class="bot-card-actions">
          <div class="btn-group-left">
            <button class="btn btn-secondary btn-xs" onclick="toggleBot('${bot.id}')">
              ${bot.status === 'ACTIVE' ? 'Pausar' : 'Reanudar'}
            </button>
            <button class="btn btn-danger btn-xs" onclick="closeBotPositions('${bot.id}')">
              Cerrar (FLAT)
            </button>
          </div>
          <button class="btn btn-outline btn-xs" onclick="openDetailModal('${bot.id}')">
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
    container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--text-secondary); padding: 32px;">No hay personas titulares registradas aún.</div>`;
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
    showToast(`Ejecutando ping para proxy de ${botId}...`, 'info');
    const resp = await apiFetch(`/api/bots/${botId}/proxy-test`, { method: 'POST' });
    const res = await resp.json();
    if (!resp.ok || !res.is_healthy) {
      throw new Error(res.message || res.detail || 'La conexión real del proxy no está disponible.');
    }
    showToast(`Test exitoso: Ping ${res.ping_ms}ms // IP ${res.detected_ip}`, 'success');
  } catch (err) {
    showToast(`Fallo de conexión al proxy: ${err.message}`, 'error');
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

function openAddBotModal() {
  const identSelect = document.getElementById('new-bot-identity');
  if (identSelect) {
    identSelect.innerHTML = state.identities.map(i => {
      return `<option value="${i.id}">${i.flag} ${escapeHtml(i.full_name)} (${escapeHtml(i.country)})</option>`;
    }).join('');
  }
  document.getElementById('add-bot-modal').classList.add('open');
}

function closeAddBotModal() {
  document.getElementById('add-bot-modal').classList.remove('open');
}

async function submitCreateBot(event) {
  event.preventDefault();
  const botId = document.getElementById('new-bot-id').value.trim();
  const name = document.getElementById('new-bot-name').value.trim();
  const identityId = document.getElementById('new-bot-identity').value;
  const strategy = document.getElementById('new-bot-strategy').value;
  const proxy = document.getElementById('new-bot-proxy').value.trim();
  const jitter = parseInt(document.getElementById('new-bot-jitter').value) || 120;
  const startTime = document.getElementById('new-bot-start').value;
  const endTime = document.getElementById('new-bot-end').value;

  const payload = {
    id: botId,
    name: name,
    identity_id: identityId,
    strategy: strategy,
    proxy_url: proxy,
    jitter_ms: jitter,
    start_time: startTime,
    end_time: endTime
  };

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

    closeAddBotModal();
    showToast(`Bot "${name}" desplegado con éxito.`, 'success');
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
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
    showToast(`Titular "${name}" registrado correctamente.`, 'success');
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
}

function closeDetailModal() {
  state.selectedBotId = null;
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
// ======================================================================

async function initLightweightChart() {
  const container = document.getElementById('tradingview-chart-box');
  if (!container || !window.LightweightCharts) return;

  if (state.chartInstance) {
    state.chartInstance.remove();
    state.chartInstance = null;
    state.candleSeries = null;
  }

  container.innerHTML = '';

  const chart = LightweightCharts.createChart(container, {
    width: container.clientWidth || 900,
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

  const candleSeries = chart.addCandlestickSeries({
    upColor: '#00E676',
    downColor: '#FF5252',
    borderUpColor: '#00E676',
    borderDownColor: '#FF5252',
    wickUpColor: '#00E676',
    wickDownColor: '#FF5252'
  });

  state.chartInstance = chart;
  state.candleSeries = candleSeries;

  // Actualizar selector de bots en gráficos
  const chartBotSel = document.getElementById('chart-bot-selector');
  if (chartBotSel && state.bots.length) {
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

  window.addEventListener('resize', () => {
    if (state.chartInstance && container) {
      state.chartInstance.applyOptions({ width: container.clientWidth });
    }
  });

  await loadChartCandleData();
}

async function loadChartCandleData() {
  try {
    const resp = await apiFetch(`/api/market/candles?tf=${state.chartTimeframe}`);
    if (!resp.ok) return;
    const data = await resp.json();

    if (state.candleSeries && data.candles && data.candles.length) {
      state.candleSeries.setData(data.candles);
      state.chartMarkers = data.markers || [];
      updateChartMarkers();
      state.chartInstance?.timeScale().fitContent();

      const last = data.candles[data.candles.length - 1];
      const curPriceEl = document.getElementById('chart-current-price');
      if (curPriceEl && last) curPriceEl.textContent = `${last.close.toFixed(2)}`;
    }
  } catch (err) {
    console.warn('Error cargando velas:', err);
  }
}

function updateChartMarkers() {
  if (!state.candleSeries) return;
  let markers = state.chartMarkers || [];
  if (state.chartBotFilter !== 'ALL') {
    markers = markers.filter(m => m.text?.includes(state.chartBotFilter));
  }
  state.candleSeries.setMarkers(markers);
  const countEl = document.getElementById('chart-markers-count');
  if (countEl) countEl.textContent = `${markers.length} Ejecuciones`;
}

function setChartTimeframe(tf) {
  state.chartTimeframe = tf;
  document.querySelectorAll('.timeframe-buttons .btn-tf').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('onclick')?.includes(`'${tf}'`));
  });
  loadChartCandleData();
}

function onChartBotFilterChange() {
  const sel = document.getElementById('chart-bot-selector');
  if (sel) state.chartBotFilter = sel.value;
  updateChartMarkers();
}

function updateChartRealtimeCandle(candle) {
  if (state.candleSeries && candle) {
    state.candleSeries.update(candle);
    const curPriceEl = document.getElementById('chart-current-price');
    if (curPriceEl) curPriceEl.textContent = `${candle.close.toFixed(2)}`;
  }
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

  tbody.innerHTML = (state.economicNews || []).map(ev => {
    const impactClass = ev.impact === 'HIGH' ? 'high' : (ev.impact === 'MEDIUM' ? 'medium' : 'low');
    const impactLabel = ev.impact === 'HIGH' ? '🔴 ALTO' : (ev.impact === 'MEDIUM' ? '🟠 MEDIO' : '⚪ BAJO');

    return `
      <tr>
        <td class="text-mono">${escapeHtml(ev.date)}</td>
        <td class="text-mono font-bold">${escapeHtml(ev.time_est)}</td>
        <td class="text-mono font-bold">${escapeHtml(ev.currency)}</td>
        <td><span class="impact-badge ${impactClass}">${impactLabel}</span></td>
        <td><strong>${escapeHtml(ev.event)}</strong></td>
        <td class="text-mono">${escapeHtml(ev.forecast || '-')}</td>
        <td class="text-mono">${escapeHtml(ev.previous || '-')}</td>
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

document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  if (state.token) initWebSocket();
});
