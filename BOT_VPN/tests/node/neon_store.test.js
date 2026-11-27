const assert = require('node:assert/strict');
const { test } = require('node:test');
const { withTransientRetry } = require('../../src/server/neon-store');

test('retries transient Neon fetch failures and returns the successful query result', async () => {
  let attempts = 0;
  const waits = [];
  const result = await withTransientRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error('Error connecting to database: TypeError: fetch failed');
    return [{ healthy: 1 }];
  }, async ms => waits.push(ms));

  assert.deepEqual(result, [{ healthy: 1 }]);
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [200, 400]);
});

test('does not retry non-network database errors', async () => {
  let attempts = 0;
  await assert.rejects(() => withTransientRetry(async () => {
    attempts += 1;
    throw new Error('permission denied');
  }, async () => {}), /permission denied/);
  assert.equal(attempts, 1);
});
