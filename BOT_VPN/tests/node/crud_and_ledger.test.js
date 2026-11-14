const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { test } = require('node:test');

const projectRoot = path.resolve(__dirname, '..', '..');

async function reservePort() {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(child, baseUrl) {
  const deadline = Date.now() + 10000;
  let lastError;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Node server exited early (${child.exitCode}): ${child.output}`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  throw new Error(`Node server did not start: ${lastError}\nServer output:\n${child.output}`);
}

test('Bot & Identity CRUD and Ledger dynamic integration', { timeout: 25000 }, async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-vpn-crud-test-'));
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const username = 'test-admin';
  const password = 'test-password-sec-123';

  const tempServerDir = path.join(tempRoot, 'src', 'server');
  fs.mkdirSync(tempServerDir, { recursive: true });
  fs.copyFileSync(path.join(projectRoot, 'src', 'server', 'server.js'), path.join(tempServerDir, 'server.js'));
  fs.copyFileSync(path.join(projectRoot, 'src', 'server', 'database.js'), path.join(tempServerDir, 'database.js'));
  fs.copyFileSync(path.join(projectRoot, 'src', 'server', 'market_analysis.js'), path.join(tempServerDir, 'market_analysis.js'));
  fs.cpSync(path.join(projectRoot, 'migrations'), path.join(tempRoot, 'migrations'), { recursive: true });
  fs.cpSync(path.join(projectRoot, 'public'), path.join(tempRoot, 'public'), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, 'src', 'marketData.js'), path.join(tempRoot, 'src', 'marketData.js'));

  const child = spawn(process.execPath, [path.join(tempServerDir, 'server.js')], {
    cwd: tempRoot,
    env: {
      ...process.env,
      NODE_PATH: path.join(projectRoot, 'node_modules'),
      PORT: String(port),
      BOT_VPN_DB_PATH: path.join(tempRoot, 'bot_vpn.sqlite3'),
      BOT_VPN_AUTH_USERNAME: username,
      BOT_VPN_AUTH_PASSWORD: password,
      BOT_VPN_PII_ENCRYPTION_KEY: 'a'.repeat(64),
      QUANTUM_WEBHOOK_SECRET: 'test-secret',
      NODE_ENV: 'test',
      MARKET_DATA_PROVIDER: 'synthetic'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.output = '';
  child.stdout.on('data', chunk => { child.output += chunk.toString(); });
  child.stderr.on('data', chunk => { child.output += chunk.toString(); });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([
        once(child, 'exit'),
        new Promise(resolve => setTimeout(resolve, 3000))
      ]);
    }
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  });

  await waitForServer(child, baseUrl);

  // 1. Iniciar sesión
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(loginRes.status, 200);
  const { token } = await loginRes.json();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 2. Crear nueva identidad KYC
  const identRes = await fetch(`${baseUrl}/api/identities`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: 'id_carlos_test',
      full_name: 'Carlos Test Mendoza',
      country: 'US',
      city: 'Miami, FL',
      flag: '🇺🇸',
      kyc_status: 'VERIFIED'
    })
  });
  assert.equal(identRes.status, 201);

  // 3. Crear nuevo bot con consistency_target y daily_loss_limit
  const botRes = await fetch(`${baseUrl}/api/bots`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: 'bot_test_1',
      name: 'Bot Test Unitario',
      identity_id: 'id_carlos_test',
      strategy: 'ICTStrategy',
      consistency_target: 1500,
      daily_loss_limit: 1000,
      jitter_ms: 150
    })
  });
  assert.equal(botRes.status, 201);
  const botData = await botRes.json();
  assert.equal(botData.bot.circuit_breaker.consistency_target, 1500);
  assert.equal(botData.bot.circuit_breaker.daily_loss_limit, 1000);

  // 4. Vincular cuenta al bot
  const accRes = await fetch(`${baseUrl}/api/bots/bot_test_1/accounts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: 'acc_test_101',
      custom_name: 'Apex 50k Test',
      titular_name: 'Carlos Test Mendoza',
      broker: 'Tradovate',
      prop_firm: 'Apex Trader Funding',
      balance: 50000,
      max_contracts: 2,
      daily_loss_limit: 1000
    })
  });
  assert.equal(accRes.status, 200);

  // 5. Editar bot (PUT /api/bots/:id)
  const editRes = await fetch(`${baseUrl}/api/bots/bot_test_1`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      name: 'Bot Test Editado',
      strategy: 'SMTStrategy',
      consistency_target: 2000,
      daily_loss_limit: 1200
    })
  });
  assert.equal(editRes.status, 200);
  const editJson = await editRes.json();
  assert.equal(editJson.bot.name, 'Bot Test Editado');
  assert.equal(editJson.bot.strategy, 'SMTStrategy');
  assert.equal(editJson.bot.circuit_breaker.consistency_target, 2000);
  assert.equal(editJson.bot.circuit_breaker.daily_loss_limit, 1200);

  // 6. Verificar Ledger summary
  const ledgerRes = await fetch(`${baseUrl}/api/ledger/summary`, { headers });
  assert.equal(ledgerRes.status, 200);
  const ledgerJson = await ledgerRes.json();
  assert.ok(ledgerJson.summary);
  assert.ok(Array.isArray(ledgerJson.identity_breakdown));
  const testIdentBreakdown = ledgerJson.identity_breakdown.find(i => i.identity_id === 'id_carlos_test');
  assert.ok(testIdentBreakdown);

  // 7. Desvincular / Eliminar Cuenta (DELETE /api/bots/:botId/accounts/:accountId)
  const delAccRes = await fetch(`${baseUrl}/api/bots/bot_test_1/accounts/acc_test_101`, {
    method: 'DELETE',
    headers
  });
  assert.equal(delAccRes.status, 200);

  // 8. Eliminar Bot (DELETE /api/bots/:id)
  const delBotRes = await fetch(`${baseUrl}/api/bots/bot_test_1`, {
    method: 'DELETE',
    headers
  });
  assert.equal(delBotRes.status, 200);

  // 9. Eliminar Identidad (DELETE /api/identities/:id)
  const delIdentRes = await fetch(`${baseUrl}/api/identities/id_carlos_test`, {
    method: 'DELETE',
    headers
  });
  assert.equal(delIdentRes.status, 200);
});
