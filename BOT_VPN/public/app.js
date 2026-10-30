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
  wsConnected: false,
  analysisResults: [],
  historicalTrades: []
};

let ws = null;
let reconnectTimer = null;
let confirmResolver = null;

// ======================================================================
// 1. SISTEMA DE AUTENTICACIÓN Y LOGIN
// ======================================================================

function initAuth() {
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
  if (tabName === 'analysis') loadAnalysisStatus();
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
    identSelect.innerHTML = '<option value="">Sin titular — demo local</option>' + state.identities.map(i => {
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
  const analysisSymbol = document.getElementById('new-bot-analysis-symbol').value;
  const analysisTimeframes = Array.from(
    document.querySelectorAll('input[name="new-bot-timeframe"]:checked')
  ).map(input => input.value);
  const proxy = document.getElementById('new-bot-proxy').value.trim();
  const jitter = parseInt(document.getElementById('new-bot-jitter').value) || 120;
  const startTime = document.getElementById('new-bot-start').value;
  const endTime = document.getElementById('new-bot-end').value;

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
    end_time: endTime
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

    closeAddBotModal();
    showToast(`Bot "${name}" creado para análisis y simulación local.`, 'success');
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
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  if (state.token) initWebSocket();
});
