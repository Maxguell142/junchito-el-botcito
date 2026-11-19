const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

test('Anti-Hedging per identity, Prop Firm Credentials, and Gate Engine', async (t) => {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const tmpDir = path.join(projectRoot, `tmp-test-hedging-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const dbPath = path.join(tmpDir, 'test.sqlite3');
  const port = 3099;

  const env = {
    ...process.env,
    NODE_PATH: path.join(projectRoot, 'node_modules'),
    PORT: String(port),
    BOT_VPN_DB_PATH: dbPath,
    BOT_VPN_AUTH_USERNAME: 'test_admin',
    BOT_VPN_AUTH_PASSWORD: 'test_password_2026',
    BOT_VPN_PII_ENCRYPTION_KEY: 'a'.repeat(64),
    QUANTUM_WEBHOOK_SECRET: 'test-webhook-secret-with-at-least-32-chars',
    DISABLE_MARKET_POLL: 'true'
  };

  const child = spawn(process.execPath, [path.join(projectRoot, 'src', 'server', 'server.js')], {
    cwd: tmpDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let output = '';
  child.stdout.on('data', chunk => { output += chunk.toString(); });
  child.stderr.on('data', chunk => { output += chunk.toString(); });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        once(child, 'exit'),
        new Promise(resolve => setTimeout(resolve, 2000))
      ]);
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${baseUrl}/healthz`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  assert.equal(ready, true, `Server must start on port ${port}. Output: ${output}`);

  // Login
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test_admin', password: 'test_password_2026' })
  });
  assert.equal(loginRes.status, 200);
  const { token } = await loginRes.json();
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1. Crear dos identidades diferentes: Carlos Mendoza y Valeria Ramos
  const ident1Res = await fetch(`${baseUrl}/api/identities`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: 'ident_carlos',
      full_name: 'Carlos Mendoza',
      country: 'US',
      city: 'New York',
      status: 'VERIFIED'
    })
  });
  assert.equal(ident1Res.status, 201);

  const ident2Res = await fetch(`${baseUrl}/api/identities`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: 'ident_valeria',
      full_name: 'Valeria Ramos',
      country: 'US',
      city: 'Chicago',
      status: 'VERIFIED'
    })
  });
  assert.equal(ident2Res.status, 201);

  // 2. Crear dos bots para Carlos (Bot C1 y Bot C2) y un bot para Valeria (Bot V1)
  const botC1Res = await fetch(`${baseUrl}/api/bots`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: 'bot_carlos_1',
      name: 'Carlos MNQ Scalper',
      identity_id: 'ident_carlos',
      strategy: 'ICTStrategy',
      block_ny_open: false,
      block_red_news: false,
      min_rr_ratio: 2.0,
      auto_position_sizing: true,
      risk_per_trade_usd: 150.0,
      stop_loss_points: 15.0
    })
  });
  assert.equal(botC1Res.status, 201);

  const botC2Res = await fetch(`${baseUrl}/api/bots`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: 'bot_carlos_2',
      name: 'Carlos SMT Breaker',
      identity_id: 'ident_carlos',
      strategy: 'SMTStrategy',
      block_ny_open: false,
      block_red_news: false,
      min_rr_ratio: 2.0
    })
  });
  assert.equal(botC2Res.status, 201);

  const botV1Res = await fetch(`${baseUrl}/api/bots`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      id: 'bot_valeria_1',
      name: 'Valeria Order Flow',
      identity_id: 'ident_valeria',
      strategy: 'OrderFlowStrategy',
      block_ny_open: false,
      block_red_news: false,
      min_rr_ratio: 2.0
    })
  });
  assert.equal(botV1Res.status, 201);

  // 3. Vincular cuenta con credenciales prop firm (Account ID, Login, Password) a Bot C1
  const accC1Res = await fetch(`${baseUrl}/api/bots/bot_carlos_1/accounts`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      account_id: 'LFF025-51C65NOS-PRO001',
      custom_name: 'Leelo 50k PA #1',
      prop_firm: 'Leelo Trading',
      broker: 'Tradovate',
      environment: 'FUNDED_PA',
      username: 'LT-ROFC0256',
      balance: 50000,
      max_contracts: 3,
      daily_loss_limit: 1000
    })
  });
  assert.equal(accC1Res.status, 200);
  const accC1Data = await accC1Res.json();
  assert.equal(accC1Data.account.id, 'LFF025-51C65NOS-PRO001');
  assert.equal(accC1Data.account.username, 'LT-ROFC0256');
  assert.equal(accC1Data.account.password_masked, '');
  assert.equal(accC1Data.account.password, ''); // Contraseña cruda nunca retornada
  assert.equal(accC1Data.account.status, 'NOT_CONFIGURED');

  // Vincular cuenta a Bot C2 (mismo titular Carlos)
  const accC2Res = await fetch(`${baseUrl}/api/bots/bot_carlos_2/accounts`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      account_id: 'APEX-88219-PA',
      custom_name: 'Apex 50k PA Carlos',
      prop_firm: 'Apex Trader Funding',
      broker: 'Tradovate',
      username: 'APEX-USER-01',
      balance: 50000
    })
  });
  assert.equal(accC2Res.status, 200);

  // Vincular cuenta a Bot V1 (titular Valeria Ramos)
  const accV1Res = await fetch(`${baseUrl}/api/bots/bot_valeria_1/accounts`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      account_id: 'TOPSTEP-9941-PRO',
      custom_name: 'Topstep 50k Valeria',
      prop_firm: 'Topstep',
      broker: 'ProjectX',
      username: 'TS-VALERIA',
      balance: 50000
    })
  });
  assert.equal(accV1Res.status, 200);

  // 4. Ejecutar operación BUY en Bot C1 (Carlos) -> Abre posición LONG
  const tradeC1 = await fetch(`${baseUrl}/api/bots/bot_carlos_1/simulate-trade`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ side: 'BUY', contracts: 1 })
  });
  assert.equal(tradeC1.status, 200);
  const tradeC1Data = await tradeC1.json();
  assert.equal(tradeC1Data.status, 'OK');

  // 5. Intentar ejecutar SELL en Bot C2 (Carlos) -> DEBE SER BLOQUEADO por Anti-Hedging
  // (Porque Carlos ya tiene cuentas abiertas en LONG en Bot C1)
  const tradeC2 = await fetch(`${baseUrl}/api/bots/bot_carlos_2/simulate-trade`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ side: 'SELL', contracts: 1 })
  });
  assert.equal(tradeC2.status, 409, 'Debe retornar 409 Conflict por regla Anti-Hedging');
  const tradeC2Data = await tradeC2.json();
  assert.equal(tradeC2Data.anti_hedging_blocked, true);
  assert.equal(tradeC2Data.identity, 'Carlos Mendoza');
  assert.equal(tradeC2Data.opposing_position, 'LONG');

  // 6. Verificar independencia de identidades:
  // Bot V1 pertenece a Valeria Ramos (otra identidad).
  // Valeria debe poder ejecutar SELL libremente aunque Carlos esté en BUY!
  const tradeV1 = await fetch(`${baseUrl}/api/bots/bot_valeria_1/simulate-trade`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ side: 'SELL', contracts: 1 })
  });
  assert.equal(tradeV1.status, 200, 'Identidades diferentes pueden operar en sentido opuesto sin bloqueo');
  const tradeV1Data = await tradeV1.json();
  assert.equal(tradeV1Data.status, 'OK');

  // 7. TradingView Webhook Hub:
  const unauthenticatedWebhook = await fetch(`${baseUrl}/api/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'FLAT', bot_id: 'bot_valeria_1' })
  });
  assert.equal(unauthenticatedWebhook.status, 401, 'Webhook sin token no debe modificar posiciones');

  // Al recibir webhook para Valeria en FLAT, cierra posición
  const webhookFlat = await fetch(`${baseUrl}/api/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'test-webhook-secret-with-at-least-32-chars',
      ticker: 'MNQ',
      action: 'FLAT',
      bot_id: 'bot_valeria_1'
    })
  });
  assert.equal(webhookFlat.status, 200);

  // Al recibir webhook SELL para Carlos cuando Carlos sigue en LONG -> Bloqueo Anti-Hedging
  const webhookHedge = await fetch(`${baseUrl}/api/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'test-webhook-secret-with-at-least-32-chars',
      ticker: 'MNQ',
      action: 'SELL',
      sl_points: 15,
      tp_points: 30,
      bot_id: 'bot_carlos_2'
    })
  });
  assert.equal(webhookHedge.status, 409, 'Webhook debe respetar Anti-Hedging por identidad');
});
