'use strict';

const SAMPLE_DATA_VERSION = 2;

function sampleIdentity(id, owner, fullName, alias, city, province, postalCode) {
  return {
    id,
    owner_username: owner,
    record_source: 'SAMPLE',
    full_name: fullName,
    alias,
    country: 'AR',
    city,
    province,
    postal_code: postalCode,
    address: `Calle de práctica ${id.slice(-2)}`,
    flag: 'AR',
    kyc_status: 'VERIFIED',
    email: `${alias.replace(/[^a-z0-9]+/gi, '.').toLowerCase()}@example.com`,
    phone: '+54 11 0000-0000',
    dni: `MUESTRA-${id.slice(-4).toUpperCase()}`,
    crypto_wallet_name: 'Wallet de práctica',
    crypto_network: 'Testnet',
    crypto_wallet_address: `TESTNET-${id.toUpperCase()}`,
    crypto_transfer_alias: `${alias.replace(/[^a-z0-9]+/gi, '.').toLowerCase()}.test`
  };
}

function sampleAccount(id, name, balance, dailyPnl, realizedPnl, firm = 'Cuenta de práctica') {
  return {
    id,
    custom_name: name,
    titular_name: '',
    environment: 'EVALUATION',
    broker: 'Simulado',
    prop_firm: firm,
    balance,
    max_contracts: 2,
    daily_loss_limit: 400,
    daily_pnl: dailyPnl,
    daily_metrics_date: new Date().toISOString().slice(0, 10),
    orders_today: Math.abs(dailyPnl) > 0 ? 2 : 0,
    floating_pnl: 0,
    realized_pnl: realizedPnl,
    active_contracts: 0,
    current_position: 'FLAT',
    record_source: 'SAMPLE',
    mode: 'SIMULATED'
  };
}

function sampleBot({ id, name, owner, identityId, strategy, status, pnl, trades, accounts = [] }) {
  return {
    id,
    owner_username: owner,
    record_source: 'SAMPLE',
    name,
    identity_id: identityId,
    strategy,
    analysis_symbol: 'NQ',
    analysis_timeframes: ['1m', '5m', '15m'],
    status,
    schedule: { start_time: '09:30', end_time: '12:00', timezone: 'America/New_York' },
    circuit_breaker: {
      daily_loss_limit: 400,
      consistency_target: 150,
      auto_lock_consistency: true,
      pause_on_red_news: true,
      status: status === 'PAUSED' ? 'LOCKED_PROFIT' : 'NORMAL'
    },
    risk_parameters: { min_rr_ratio: 2, auto_position_sizing: true, risk_per_trade_usd: 40, stop_loss_points: 10 },
    net_pnl: pnl,
    today_pnl: Number((pnl / 8).toFixed(2)),
    today_pnl_date: new Date().toISOString().slice(0, 10),
    total_trades: trades,
    winning_trades: Math.round(trades * 0.6),
    losing_trades: Math.floor(trades * 0.4),
    max_drawdown: Math.max(12, Math.round(Math.abs(pnl) * 0.12)),
    logs: [{ timestamp: '10:15', level: 'INFO', message: 'Actividad de práctica; no se enviaron órdenes a un broker.' }],
    accounts
  };
}

function sampleTransaction(id, owner, identityId, identityName, accountName, type, amount, date) {
  return {
    id,
    owner_username: owner,
    record_source: 'SAMPLE',
    mode: 'SIMULATED',
    date,
    identity_id: identityId,
    identity_name: identityName,
    account_name: accountName,
    prop_firm: 'Cuenta de práctica',
    type,
    amount,
    status: 'COMPLETED',
    notes: 'Movimiento de práctica; no representa fondos reales.'
  };
}

function applySampleData(inputSnapshot, adminUsername, date = new Date().toISOString().slice(0, 10)) {
  const snapshot = structuredClone(inputSnapshot || {});
  snapshot.identities = Array.isArray(snapshot.identities) ? snapshot.identities : [];
  snapshot.bots = Array.isArray(snapshot.bots) ? snapshot.bots : [];
  snapshot.ledger_transactions = Array.isArray(snapshot.ledger_transactions) ? snapshot.ledger_transactions : [];
  if (Number(snapshot.sample_data_version) >= SAMPLE_DATA_VERSION) return { snapshot, changed: false };

  for (const identity of snapshot.identities) {
    identity.owner_username ||= adminUsername;
    if (identity.id?.startsWith('demo_')) {
      identity.record_source = 'SAMPLE';
      identity.notes = 'Perfil ficticio de práctica; no corresponde a una persona real.';
      if (identity.id === 'demo_ana') Object.assign(identity, sampleIdentity(identity.id, identity.owner_username, 'Ana Beltrán', 'ana_beltran', 'Córdoba', 'Córdoba', '5000'));
      if (identity.id === 'demo_lucas') Object.assign(identity, sampleIdentity(identity.id, identity.owner_username, 'Lucas Ibarra', 'lucas_ibarra', 'Rosario', 'Santa Fe', '2000'));
    }
  }
  for (const bot of snapshot.bots) {
    bot.owner_username ||= adminUsername;
    if (bot.id?.startsWith('bot_demo_')) {
      bot.record_source = 'SAMPLE';
      bot.name = bot.name.replace(/\s*[·-]?\s*DEMO\b/ig, '').trim();
      for (const account of bot.accounts || []) {
        account.record_source = 'SAMPLE';
        account.mode = 'SIMULATED';
        account.custom_name = account.custom_name.replace(/\bDemo\b/ig, 'Práctica');
        account.titular_name = account.titular_name?.replace(/\bDemo\b/ig, '');
        account.prop_firm = 'Cuenta de práctica';
      }
      for (const log of bot.logs || []) {
        log.message = 'Actividad de práctica; no se enviaron órdenes a un broker.';
      }
    }
  }
  for (const transaction of snapshot.ledger_transactions) {
    transaction.owner_username ||= adminUsername;
    if (transaction.id?.startsWith('demo_tx_')) {
      transaction.record_source = 'SAMPLE';
      transaction.mode = 'SIMULATED';
      transaction.identity_name = transaction.identity_id === 'demo_ana' ? 'Ana Beltrán' : 'Lucas Ibarra';
      transaction.account_name = transaction.account_name.replace(/\bDemo\b/ig, 'Práctica');
      transaction.prop_firm = 'Cuenta de práctica';
      transaction.notes = 'Movimiento de práctica; no representa fondos reales.';
    }
  }

  const addIdentity = identity => {
    if (!snapshot.identities.some(item => item.id === identity.id)) snapshot.identities.push(identity);
  };
  const addBot = bot => {
    if (!snapshot.bots.some(item => item.id === bot.id)) snapshot.bots.push(bot);
  };
  const addTransaction = transaction => {
    if (!snapshot.ledger_transactions.some(item => item.id === transaction.id)) snapshot.ledger_transactions.push(transaction);
  };

  const anaId = snapshot.identities.some(item => item.id === 'demo_ana') ? 'demo_ana' : 'sample_admin_ana';
  const lucasAdminId = snapshot.identities.some(item => item.id === 'demo_lucas') ? 'demo_lucas' : 'sample_admin_lucas';
  const adminIdentityCount = snapshot.identities.filter(item => item.owner_username?.toLowerCase() === adminUsername.toLowerCase()).length;
  if (!adminIdentityCount) {
    addIdentity(sampleIdentity(anaId, adminUsername, 'Ana Beltrán', 'ana_beltran', 'Córdoba', 'Córdoba', '5000'));
    addIdentity(sampleIdentity(lucasAdminId, adminUsername, 'Lucas Ibarra', 'lucas_ibarra', 'Rosario', 'Santa Fe', '2000'));
  }
  addIdentity(sampleIdentity('sample_admin_elena', adminUsername, 'Elena Prado', 'elena_prado', 'Mendoza', 'Mendoza', '5500'));

  const fillAccounts = (botId, entries) => {
    const bot = snapshot.bots.find(item => item.id === botId);
    if (bot) bot.accounts = [...(bot.accounts || []), ...entries.filter(account => !bot.accounts.some(item => item.id === account.id))];
  };
  const adminBots = () => snapshot.bots.filter(bot => bot.owner_username?.toLowerCase() === adminUsername.toLowerCase());
  const adminBotSeeds = [
    ['sample_admin_ict', 'MNQ Apertura NY', anaId, 'ICTStrategy', 284.5, 21],
    ['sample_admin_smt', 'NQ Reversión de sesión', lucasAdminId, 'SMTStrategy', 118.25, 12],
    ['sample_admin_flow', 'MNQ Flujo de órdenes', anaId, 'OrderFlowStrategy', 204, 9],
    ['sample_admin_trend', 'ES Tendencia de sesión', 'sample_admin_elena', 'ICTStrategy', 91.75, 7]
  ];
  for (const [id, name, identityId, strategy, pnl, trades] of adminBotSeeds) {
    if (adminBots().length >= 4) break;
    if (snapshot.bots.some(bot => bot.id === id)) continue;
    addBot(sampleBot({ id, name, owner: adminUsername, identityId, strategy, status: 'ACTIVE', pnl, trades }));
  }
  let adminAccounts = adminBots().reduce((sum, bot) => sum + (bot.accounts || []).length, 0);
  let extraAccountNumber = 4;
  let sampleAdminBots = adminBots().filter(bot => bot.record_source === 'SAMPLE');
  if (adminAccounts < 5 && !sampleAdminBots.length) {
    addBot(sampleBot({
      id: 'sample_admin_ledger', name: 'MNQ Control de riesgo', owner: adminUsername,
      identityId: 'sample_admin_elena', strategy: 'ICTStrategy', status: 'PAUSED', pnl: 54.2, trades: 6
    }));
    sampleAdminBots = adminBots().filter(bot => bot.record_source === 'SAMPLE');
  }
  for (const bot of sampleAdminBots) {
    while (adminAccounts < 5 && (bot.accounts || []).length < 2) {
      const account = sampleAccount(
        `sample_admin_acc_${extraAccountNumber}`,
        `Evaluación ${extraAccountNumber % 2 ? '50K' : '25K'} · ${String.fromCharCode(64 + extraAccountNumber)}`,
        extraAccountNumber % 2 ? 50284.5 : 25204,
        extraAccountNumber % 2 ? 28.25 : -12.75,
        extraAccountNumber % 2 ? 284.5 : 204
      );
      fillAccounts(bot.id, [account]);
      adminAccounts += 1;
      extraAccountNumber += 1;
    }
    if (adminAccounts >= 5) break;
  }

  const activeUserIdentities = [
    sampleIdentity('sample_lucas_main', 'lucas.romero', 'Luciano Romero', 'luciano_romero', 'Salta', 'Salta', '4400'),
    sampleIdentity('sample_lucas_alt', 'lucas.romero', 'Mara Romero', 'mara_romero', 'Salta', 'Salta', '4400'),
    sampleIdentity('sample_camila_main', 'camila.torres', 'Camila Torres', 'camila_torres', 'La Plata', 'Buenos Aires', '1900')
  ];
  activeUserIdentities.forEach(addIdentity);

  if (!snapshot.bots.some(bot => bot.owner_username === 'lucas.romero')) {
    addBot(sampleBot({ id: 'sample_lucas_momentum', name: 'MNQ Momentum', owner: 'lucas.romero', identityId: 'sample_lucas_main', strategy: 'ICTStrategy', status: 'ACTIVE', pnl: 163.25, trades: 14, accounts: [sampleAccount('sample_lucas_acc_1', 'Evaluación 50K · A', 50163.25, 18.5, 163.25)] }));
    addBot(sampleBot({ id: 'sample_lucas_reversal', name: 'NQ Reversión de sesión', owner: 'lucas.romero', identityId: 'sample_lucas_alt', strategy: 'SMTStrategy', status: 'PAUSED', pnl: -42, trades: 9 }));
    addBot(sampleBot({ id: 'sample_lucas_flow', name: 'MNQ Flujo de órdenes', owner: 'lucas.romero', identityId: 'sample_lucas_main', strategy: 'OrderFlowStrategy', status: 'ACTIVE', pnl: 76.8, trades: 11, accounts: [sampleAccount('sample_lucas_acc_2', 'Evaluación 25K · B', 25076.8, 7.25, 76.8)] }));
  }
  if (!snapshot.bots.some(bot => bot.owner_username === 'camila.torres')) {
    addBot(sampleBot({ id: 'sample_camila_swing', name: 'NQ Tendencia de sesión', owner: 'camila.torres', identityId: 'sample_camila_main', strategy: 'ICTStrategy', status: 'PAUSED', pnl: 32.4, trades: 5, accounts: [sampleAccount('sample_camila_acc_1', 'Evaluación 25K · C', 25032.4, -4.5, 32.4)] }));
  }

  const existingTransactions = new Set(snapshot.ledger_transactions.map(item => item.id));
  const addTransactions = (owner, identityId, identityName, prefix, accountName, entries) => entries.forEach(([suffix, type, amount, daysAgo]) => {
    const txDate = new Date(`${date}T12:00:00Z`);
    txDate.setUTCDate(txDate.getUTCDate() - daysAgo);
    const tx = sampleTransaction(`${prefix}_${suffix}`, owner, identityId, identityName, accountName, type, amount, txDate.toISOString().slice(0, 10));
    if (!existingTransactions.has(tx.id)) addTransaction(tx);
  });
  addTransactions(adminUsername, anaId, 'Ana Beltrán', 'sample_admin_tx', 'Evaluación 50K · A', [
    ['01', 'INVESTMENT_EVAL', -75, 30], ['02', 'PROP_FIRM_PAYOUT', 320, 26], ['03', 'PLATFORM_FEE', -49, 21],
    ['04', 'PROP_FIRM_PAYOUT', 185, 18], ['05', 'INVESTMENT_EVAL', -99, 14], ['06', 'PROP_FIRM_PAYOUT', 410, 10],
    ['07', 'PLATFORM_FEE', -29, 6], ['08', 'PROP_FIRM_PAYOUT', 240, 2]
  ]);
  addTransactions('lucas.romero', 'sample_lucas_main', 'Luciano Romero', 'sample_lucas_tx', 'Evaluación 50K · A', [
    ['01', 'INVESTMENT_EVAL', -75, 14], ['02', 'PROP_FIRM_PAYOUT', 180, 8], ['03', 'PLATFORM_FEE', -35, 3]
  ]);
  addTransactions('camila.torres', 'sample_camila_main', 'Camila Torres', 'sample_camila_tx', 'Evaluación 25K · C', [
    ['01', 'INVESTMENT_EVAL', -49, 5], ['02', 'PROP_FIRM_PAYOUT', 65, 1]
  ]);

  snapshot.sample_data_version = SAMPLE_DATA_VERSION;
  return { snapshot, changed: true };
}

module.exports = { SAMPLE_DATA_VERSION, applySampleData };
