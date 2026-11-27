'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { applySampleData } = require('../../src/server/sample-data');

test('sample data is varied, linked by owner, and idempotent', () => {
  const { snapshot, changed } = applySampleData({ identities: [], bots: [], ledger_transactions: [] }, 'V8', '2026-11-27');
  assert.equal(changed, true);
  assert.equal(snapshot.sample_data_version, 2);

  const adminIdentities = snapshot.identities.filter(item => item.owner_username === 'V8');
  const adminBots = snapshot.bots.filter(item => item.owner_username === 'V8');
  const adminAccounts = adminBots.flatMap(bot => bot.accounts || []);
  const adminTransactions = snapshot.ledger_transactions.filter(item => item.owner_username === 'V8');
  assert.ok(adminIdentities.length >= 3);
  assert.ok(adminBots.length >= 4);
  assert.ok(adminAccounts.length >= 5);
  assert.ok(adminTransactions.length >= 8);
  assert.ok(adminBots.every(bot => adminIdentities.some(identity => identity.id === bot.identity_id)));
  assert.ok(adminAccounts.every(account => account.mode === 'SIMULATED'));
  assert.ok(snapshot.identities.every(identity => identity.email.endsWith('@example.com')));
  assert.ok(snapshot.identities.every(identity => !Object.hasOwn(identity, 'card_cvv')));

  const lucasBots = snapshot.bots.filter(bot => bot.owner_username === 'lucas.romero');
  const camilaBots = snapshot.bots.filter(bot => bot.owner_username === 'camila.torres');
  assert.equal(lucasBots.length, 3);
  assert.equal(camilaBots.length, 1);
  assert.equal(snapshot.ledger_transactions.filter(item => item.owner_username === 'lucas.romero').length, 3);
  assert.equal(snapshot.ledger_transactions.filter(item => item.owner_username === 'camila.torres').length, 2);

  const repeated = applySampleData(snapshot, 'V8', '2026-11-28');
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.snapshot, snapshot);
});

test('legacy sample labels are replaced without changing linked IDs', () => {
  const legacy = {
    identities: [{ id: 'demo_ana', full_name: 'Ana Demo', alias: 'ana_demo', email: 'ana.demo@example.com' }],
    bots: [{
      id: 'bot_demo_ict', name: 'MNQ Scalper · DEMO', identity_id: 'demo_ana',
      accounts: [{ id: 'demo_acc_ict', custom_name: 'Cuenta Demo A', titular_name: 'Ana Demo', prop_firm: 'Firma Demo' }]
    }],
    ledger_transactions: [{ id: 'demo_tx_01', identity_id: 'demo_ana', identity_name: 'Ana Demo', account_name: 'Cuenta Demo A' }]
  };
  const { snapshot } = applySampleData(legacy, 'V8', '2026-11-27');
  assert.equal(snapshot.identities[0].id, 'demo_ana');
  assert.equal(snapshot.bots[0].id, 'bot_demo_ict');
  assert.equal(snapshot.bots[0].identity_id, 'demo_ana');
  assert.equal(snapshot.bots[0].name.includes('DEMO'), false);
  assert.equal(snapshot.bots[0].accounts[0].custom_name.includes('Demo'), false);
  assert.equal(snapshot.bots[0].accounts[0].titular_name.includes('Demo'), false);
  assert.equal(snapshot.ledger_transactions[0].identity_name, 'Ana Beltrán');
});
