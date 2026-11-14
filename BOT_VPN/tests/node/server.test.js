const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');
const WebSocket = require('ws');

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

function receiveWebSocketMessage(port, token) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error('Timed out waiting for WebSocket authentication response.'));
    }, 3000);

    socket.once('open', () => {
      socket.send(JSON.stringify(token
        ? { action: 'AUTH', token }
        : { action: 'PING' }));
    });
    socket.once('message', message => {
      clearTimeout(timeout);
      const payload = JSON.parse(message.toString());
      socket.close();
      resolve(payload);
    });
    socket.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

test('Node server starts and protects REST and WebSocket endpoints', { timeout: 20000 }, async t => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-vpn-node-test-'));
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const username = 'operador-á';
  const password = 'contraseña-ñ-not-for-production';

  const tempServerDir = path.join(tempRoot, 'src', 'server');
  fs.mkdirSync(tempServerDir, { recursive: true });
  fs.copyFileSync(path.join(projectRoot, 'src', 'server', 'server.js'), path.join(tempServerDir, 'server.js'));
  fs.copyFileSync(path.join(projectRoot, 'src', 'server', 'database.js'), path.join(tempServerDir, 'database.js'));
  fs.copyFileSync(path.join(projectRoot, 'src', 'server', 'market_analysis.js'), path.join(tempServerDir, 'market_analysis.js'));
  fs.cpSync(path.join(projectRoot, 'migrations'), path.join(tempRoot, 'migrations'), { recursive: true });
  fs.cpSync(path.join(projectRoot, 'public'), path.join(tempRoot, 'public'), { recursive: true });
  fs.copyFileSync(path.join(projectRoot, 'src', 'marketData.js'), path.join(tempRoot, 'src', 'marketData.js'));
  fs.writeFileSync(path.join(tempRoot, 'config.json'), JSON.stringify({
    auth: { username: 'ignored-config-user', password: 'ignored-config-password', role: 'ADMIN_TRADER' },
    server: { webhook_token: 'ignored-config-webhook-secret' },
    identities: [],
    bots: [{
      id: 'legacy-secret-bot',
      name: 'Legacy secret bot',
      strategy: 'ICTStrategy',
      proxy_url: 'socks5://proxy-user:proxy-password@proxy.example:1080',
      accounts: [{
        id: 'legacy-secret-account',
        custom_name: 'Legacy account',
        username: 'legacy-broker-login',
        password: 'legacy-broker-password',
        balance: 10000,
        current_position: 'LONG',
        active_contracts: 1,
        entry_price: 18200,
        daily_pnl: 1000000,
        orders_today: -1,
        daily_metrics_date: 'invalid-date'
      }]
    }]
  }));

  const child = spawn(process.execPath, [path.join(tempServerDir, 'server.js')], {
    cwd: tempRoot,
    env: {
      ...process.env,
      NODE_PATH: path.join(projectRoot, 'node_modules'),
      BOT_VPN_DB_PATH: path.join(tempRoot, 'bot_vpn.sqlite3'),
      BOT_VPN_AUTH_USERNAME: username,
      BOT_VPN_AUTH_PASSWORD: password,
      BOT_VPN_PII_ENCRYPTION_KEY: 'a'.repeat(64),
      BOT_VPN_SIM_MAX_CONTRACTS_PER_ACCOUNT: '1',
      BOT_VPN_SIM_MAX_TOTAL_CONTRACTS: '2',
      BOT_VPN_SIM_MAX_ORDERS_PER_DAY: '3',
      BOT_VPN_SIM_DAILY_LOSS_PER_ACCOUNT: '50',
      BOT_VPN_SIM_DAILY_LOSS_GLOBAL: '100',
      BOT_VPN_SIM_MAX_EXPOSURE: '100000',
      PORT: String(port)
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
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  await waitForServer(child, baseUrl);
  assert.equal((await fetch(baseUrl)).status, 200, 'dashboard should be served');
  const healthResponse = await fetch(`${baseUrl}/healthz`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.status, 'healthy');
  assert.equal(health.mode, 'SIMULATED');
  assert.equal(health.components.persistence, 'healthy');
  assert.equal(health.components.broker, 'disabled');
  assert.equal(health.components.market_data, 'simulated');
  assert.equal((await fetch(baseUrl)).headers.get('access-control-allow-origin'), null, 'CORS should not be wildcard-enabled');
  assert.equal((await fetch(`${baseUrl}/api/system/snapshot`)).status, 401, 'anonymous REST should be rejected');
  assert.equal((await fetch(`${baseUrl}/api/system/snapshot`, {
    headers: { Authorization: 'Bearer invalid-token' }
  })).status, 401, 'invalid REST token should be rejected');

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(loginResponse.status, 200, 'configured credentials should log in');
  const login = await loginResponse.json();
  assert.equal(typeof login.token, 'string');
  assert.ok(login.token.length >= 40);
  assert.equal(login.expires_in, 1800);
  const token = login.token;
  assert.equal((await fetch(`${baseUrl}/api/system/snapshot`, {
    headers: { Authorization: `Bearer ${token}` }
  })).status, 200, 'valid REST token should be accepted');
  const snapshot = await fetch(`${baseUrl}/api/system/snapshot`, {
    headers: { Authorization: `Bearer ${token}` }
  }).then(response => response.json());
  assert.equal(snapshot.execution_mode, 'SIMULATED');
  assert.equal(snapshot.paper_trading_available, false);
  assert.equal(snapshot.risk_policy.type, 'DEMO_ONLY');
  assert.equal(snapshot.risk_policy.limits.max_contracts_per_account, 1);
  assert.equal(snapshot.bots[0].accounts[0].daily_pnl, 0);
  assert.equal(snapshot.bots[0].accounts[0].orders_today, 0);
  assert.equal(snapshot.bots[0].proxy_url, 'socks5://proxy.example:1080');
  assert.equal(JSON.stringify(snapshot).includes('proxy-password'), false);
  assert.equal(JSON.stringify(snapshot).includes('legacy-broker-login'), false);
  assert.equal((await fetch(`${baseUrl}/api/analysis/status`)).status, 401, 'analysis routes should require a session');
  const identityResponse = await fetch(`${baseUrl}/api/identities`, {
    method: 'POST',
    headers: { Authorization: ['Bearer', token].join(' '), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'demo-pending-identity',
      full_name: 'Demo identity',
      country: 'US'
    })
  });
  assert.equal(identityResponse.status, 201);
  assert.equal((await identityResponse.json()).identity.kyc_status, 'PENDING');
  const proxyTest = await fetch(`${baseUrl}/api/bots/legacy-secret-bot/proxy-test`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(proxyTest.status, 501);
  assert.equal((await proxyTest.json()).is_healthy, false);
  const simulatedLegacyClose = await fetch(`${baseUrl}/api/bots/legacy-secret-bot/close`, {
    method: 'POST',
    headers: { Authorization: ['Bearer', token].join(' ') }
  });
  assert.equal(simulatedLegacyClose.status, 200);
  assert.equal((await simulatedLegacyClose.json()).mode, 'SIMULATED');

  assert.equal((await receiveWebSocketMessage(port, token)).type, 'SNAPSHOT');
  assert.equal((await receiveWebSocketMessage(port, '')).type, 'AUTH_ERROR');

  const botResponse = await fetch(`${baseUrl}/api/bots`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'security-test-bot',
      name: 'Security test bot',
      proxy_url: 'socks5://proxy-user:proxy-password@proxy.example:1080'
    })
  });
  assert.equal(botResponse.status, 400, 'proxy credentials must be rejected');

  const embeddedAccountsResponse = await fetch(`${baseUrl}/api/bots`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'embedded-account-bot',
      name: 'Embedded account bot',
      accounts: [{ id: 'account', password: 'must-not-be-accepted' }]
    })
  });
  assert.equal(embeddedAccountsResponse.status, 400);

  const createBotResponse = await fetch(`${baseUrl}/api/bots`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'security-test-bot',
      name: 'Security test bot',
      strategy: 'TechnicalAnalysisStrategy',
      analysis_symbol: 'ES',
      analysis_timeframes: ['5m', '1h']
    })
  });
  assert.equal(createBotResponse.status, 201);
  const createdBot = await createBotResponse.json();
  assert.equal(createdBot.bot.analysis_symbol, 'ES');
  assert.deepEqual(createdBot.bot.analysis_timeframes, ['5m', '1h']);

  const historicalBars = Array.from({ length: 60 }, (_, index) => {
    const close = 20000 + index * 0.25;
    return [
      new Date(Date.parse('2025-01-02T14:01:00Z') + index * 60_000).toISOString(),
      close - 0.1,
      close + 0.1,
      close - 0.2,
      close,
      100 + index
    ].join(',');
  });
  const csv = ['timestamp,open,high,low,close,volume', ...historicalBars].join('\n');
  const csvResponse = await fetch(`${baseUrl}/api/analysis/csv?symbol=NQ&timeframe=1m`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/csv' },
    body: csv
  });
  assert.equal(csvResponse.status, 200);
  const csvResult = await csvResponse.json();
  assert.equal(csvResult.data_type, 'HISTORICAL');
  assert.equal(csvResult.candles, 60);
  assert.equal(csvResult.results.some(result => result.bot_id === 'legacy-secret-bot'), true);
  assert.ok(Array.isArray(csvResult.results.find(
    result => result.bot_id === 'legacy-secret-bot'
  ).historical_simulated_trades));
  const chartResult = csvResult.results.find(result => result.bot_id === 'legacy-secret-bot');
  assert.ok(chartResult.chart.bars.length > 0);
  assert.ok(chartResult.chart.bars.length <= 120);
  assert.ok(Object.hasOwn(chartResult.chart.bars[0], 'ema9'));

  const esCsv = [
    'timestamp,open,high,low,close,volume',
    ...historicalBars.map((_, index) => {
      const close = 5000 + index * 0.25;
      return [
        new Date(Date.parse('2025-01-02T14:01:00Z') + index * 60_000).toISOString(),
        close - 0.1,
        close + 0.1,
        close - 0.2,
        close,
        100 + index
      ].join(',');
    })
  ].join('\n');
  const esCsvResponse = await fetch(`${baseUrl}/api/analysis/csv?symbol=ES&timeframe=1m`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/csv' },
    body: esCsv
  });
  assert.equal(esCsvResponse.status, 200);
  const esCsvResult = await esCsvResponse.json();
  assert.equal(esCsvResult.results.filter(result => result.bot_id === 'security-test-bot').length, 2);

  const statusResponse = await fetch(`${baseUrl}/api/analysis/status`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(statusResponse.status, 200);
  const analysisStatus = await statusResponse.json();
  assert.equal(analysisStatus.datasets.NQ.candles, 60);
  assert.equal(analysisStatus.datasets.ES.candles, 60);
  assert.equal(analysisStatus.data_type, 'HISTORICAL');
  const analysisHealth = await fetch(`${baseUrl}/healthz`).then(response => response.json());
  assert.equal(analysisHealth.components.market_data, 'historical_csv');

  const candlesResponse = await fetch(`${baseUrl}/api/candles?symbol=MNQ&limit=10`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(candlesResponse.status, 200);
  const candlesPayload = await candlesResponse.json();
  assert.equal(candlesPayload.symbol, 'MNQ');
  assert.ok(Array.isArray(candlesPayload.candles));
  assert.ok(candlesPayload.candles.length > 0);

  const botCandlesResponse = await fetch(`${baseUrl}/api/bot/bot_1/candles?limit=10`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(botCandlesResponse.status, 200);
  const botCandlesPayload = await botCandlesResponse.json();
  assert.equal(botCandlesPayload.botId, 'bot_1');
  assert.ok(Array.isArray(botCandlesPayload.candles));
  assert.ok(botCandlesPayload.candles.length > 0);

  const invalidCsvResponse = await fetch(`${baseUrl}/api/analysis/csv?symbol=NQ&timeframe=1m`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/csv' },
    body: 'timestamp,open,high,low,close,volume\n2025-01-02 14:00:00,1,2,0.5,1.5,10'
  });
  assert.equal(invalidCsvResponse.status, 400);
  const invalidSchedule = await fetch(`${baseUrl}/api/bots/security-test-bot/schedule`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_time: '99:99', end_time: '11:30', timezone: 'Not/AZone' })
  });
  assert.equal(invalidSchedule.status, 400);

  const accountResponse = await fetch(`${baseUrl}/api/bots/security-test-bot/accounts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'security-test-account',
      custom_name: 'Security account',
      username: 'broker-login',
      password: 'broker-password-not-to-persist'
    })
  });
  assert.equal(accountResponse.status, 400, 'broker credentials must not be accepted');

  const metadataResponse = await fetch(`${baseUrl}/api/bots/security-test-bot/accounts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'security-test-account',
      custom_name: 'Security account'
    })
  });
  assert.equal(metadataResponse.status, 200);
  const accountResult = await metadataResponse.json();
  assert.equal(accountResult.account.username, '');
  assert.equal(accountResult.account.status, 'NOT_CONFIGURED');
  const simulatedClose = await fetch(`${baseUrl}/api/bots/security-test-bot/close`, {
    method: 'POST',
    headers: { Authorization: ['Bearer', token].join(' ') }
  });
  assert.equal(simulatedClose.status, 200);
  assert.equal((await simulatedClose.json()).mode, 'SIMULATED');
  const stopAll = await fetch(`${baseUrl}/api/emergency/stop-all`, {
    method: 'POST',
    headers: { Authorization: ['Bearer', token].join(' ') }
  });
  assert.equal(stopAll.status, 200);
  assert.equal((await stopAll.json()).mode, 'SIMULATED');
  const database = new DatabaseSync(path.join(tempRoot, 'bot_vpn.sqlite3'));
  database.exec(`
    CREATE TRIGGER reject_audit_writes
    BEFORE INSERT ON audit_events
    BEGIN
      SELECT RAISE(ABORT, 'simulated persistence failure');
    END;
  `);
  const failedSave = await fetch(`${baseUrl}/api/bots/security-test-bot/schedule`, {
    method: 'POST',
    headers: { Authorization: ['Bearer', token].join(' '), 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_time: '10:00' })
  });
  assert.equal(failedSave.status, 503, 'SQLite failures must not be reported as successful updates');
  const persistedBot = JSON.parse(database.prepare(
    "SELECT data_json FROM bots WHERE id = 'security-test-bot'"
  ).get().data_json);
  assert.equal(persistedBot.schedule.start_time, '09:30', 'failed transaction must roll back the snapshot');
  database.exec('DROP TRIGGER reject_audit_writes');
  const storedRows = [
    ...database.prepare('SELECT value_json FROM app_settings').all(),
    ...database.prepare('SELECT data_json FROM identities').all(),
    ...database.prepare('SELECT data_json FROM bots').all(),
    ...database.prepare('SELECT data_json FROM accounts').all(),
    ...database.prepare('SELECT details_json FROM audit_events').all(),
    ...database.prepare('SELECT details_json FROM operations').all()
  ];
  const storedJson = JSON.stringify(storedRows);
  assert.equal(storedJson.includes('broker-password-not-to-persist'), false);
  assert.equal(storedJson.includes('broker-login'), false);
  assert.equal(storedJson.includes('ignored-config-webhook-secret'), false);
  assert.equal(storedJson.includes('proxy-password'), false);
  assert.equal(storedJson.includes('legacy-broker-password'), false);
  assert.equal(database.prepare('SELECT count(*) AS count FROM schema_migrations').get().count, 1);
  assert.equal(database.prepare('SELECT count(*) AS count FROM audit_events').get().count >= 4, true);
  assert.equal(database.prepare("SELECT count(*) AS count FROM accounts WHERE account_id = 'security-test-account'").get().count, 1);
  const operation = database.prepare('SELECT mode, status FROM operations').get();
  assert.equal(operation.mode, 'SIMULATED');
  assert.equal(operation.status, 'SIMULATED');
  const closedAccount = JSON.parse(database.prepare(
    "SELECT data_json FROM accounts WHERE account_id = 'legacy-secret-account'"
  ).get().data_json);
  assert.equal(closedAccount.current_position, 'FLAT');
  assert.equal(closedAccount.daily_pnl, closedAccount.realized_pnl);
  database.close();

  assert.equal((await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  })).status, 204, 'logout should revoke the session');
  assert.equal((await fetch(`${baseUrl}/api/system/snapshot`, {
    headers: { Authorization: `Bearer ${token}` }
  })).status, 401, 'revoked session must no longer access REST');
  const oversizedBody = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: 'x'.repeat(33 * 1024) })
  });
  assert.equal(oversizedBody.status, 413, 'oversized JSON should be rejected');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const failedLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'incorrect-password' })
    });
    assert.equal(failedLogin.status, 401);
  }
  const limitedLogin = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  assert.equal(limitedLogin.status, 429, 'login attempts should be rate-limited');
});
