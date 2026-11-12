const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  getCandles,
  generateSyntheticCandles,
  intervalToSeconds
} = require('../src/marketData');

test('intervalToSeconds correctly converts timeframes', () => {
  assert.equal(intervalToSeconds('1m'), 60);
  assert.equal(intervalToSeconds('5m'), 300);
  assert.equal(intervalToSeconds('15m'), 900);
  assert.equal(intervalToSeconds('1h'), 3600);
  assert.equal(intervalToSeconds('1d'), 86400);
  assert.equal(intervalToSeconds('unknown'), 60);
});

test('generateSyntheticCandles produces ascending valid OHLCV candles', () => {
  const candles = generateSyntheticCandles('MNQ', '1m', 30);
  assert.ok(Array.isArray(candles));
  assert.ok(candles.length >= 30);

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    assert.equal(typeof c.time, 'number', 'time must be number');
    assert.equal(typeof c.open, 'number', 'open must be number');
    assert.equal(typeof c.high, 'number', 'high must be number');
    assert.equal(typeof c.low, 'number', 'low must be number');
    assert.equal(typeof c.close, 'number', 'close must be number');
    assert.equal(typeof c.volume, 'number', 'volume must be number');

    assert.ok(c.high >= c.low, 'high must be >= low');
    assert.ok(c.high >= Math.min(c.open, c.close), 'high must be >= min(open, close)');
    assert.ok(c.low <= Math.max(c.open, c.close), 'low must be <= max(open, close)');

    if (i > 0) {
      assert.ok(c.time > candles[i - 1].time, 'time must be strictly ascending');
    }
  }
});

test('getCandles returns consistent candle payload with synthetic fallback', async () => {
  // Test with forced synthetic/fallback provider
  const result = await getCandles('MNQ', '1m', 20, 'synthetic');

  assert.equal(result.symbol, 'MNQ');
  assert.equal(result.interval, '1m');
  assert.ok(result.candles.length >= 20);
  assert.ok(result.provider);

  const first = result.candles[0];
  assert.ok(typeof first.time === 'number');
  assert.ok(typeof first.close === 'number');
});
