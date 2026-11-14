const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  aggregateBars,
  analyzeDataset,
  buildChartData,
  calculateIndicators,
  parseCsv,
  simulateHistoricalTrades
} = require('../../src/server/market_analysis');

function makeBars(count, start = Date.parse('2025-01-02T14:00:00Z')) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.1;
    return {
      timestamp: start + index * 60_000,
      open: close - 0.05,
      high: close + 0.1,
      low: close - 0.1,
      close,
      volume: index + 10
    };
  });
}

function toCsv(bars) {
  return [
    'timestamp,open,high,low,close,volume',
    ...bars.map(bar => [
      new Date(bar.timestamp).toISOString(),
      bar.open,
      bar.high,
      bar.low,
      bar.close,
      bar.volume
    ].join(','))
  ].join('\n');
}

test('CSV import validates OHLCV and aggregates larger intervals', () => {
  const parsed = parseCsv(toCsv(makeBars(60)), 'NQ', '1m');
  assert.equal(parsed.bars.length, 60);
  const fiveMinute = aggregateBars(parsed.bars, '1m', '5m');
  assert.equal(fiveMinute.length, 12);
  assert.equal(fiveMinute[0].open, parsed.bars[0].open);
  assert.equal(fiveMinute[0].close, parsed.bars[4].close);
  assert.equal(fiveMinute[0].volume, 60);
  assert.deepEqual(aggregateBars(parsed.bars, '1m', '1d').length, 1);
  assert.deepEqual(aggregateBars(parsed.bars, '5m', '1m'), []);
});

test('technical indicators return metrics and historical analysis never creates orders', () => {
  const dataset = parseCsv(toCsv(makeBars(60)), 'ES', '1m');
  const indicators = calculateIndicators(dataset.bars);
  assert.equal(typeof indicators.ema9, 'number');
  assert.equal(typeof indicators.rsi14, 'number');
  assert.equal(typeof indicators.atr14, 'number');
  assert.equal(typeof indicators.macd.line, 'number');
  assert.equal(typeof indicators.vwapUtcDay, 'number');

  const result = analyzeDataset(dataset, 'TechnicalAnalysisStrategy', '5m');
  assert.equal(result.symbol, 'ES');
  assert.equal(result.data_type, 'HISTORICAL');
  assert.equal(result.status, 'INSUFFICIENT_DATA');
  assert.equal(Object.hasOwn(result, 'order'), false);

  const chart = buildChartData(dataset, '1m');
  assert.equal(chart.bars.length, 60);
  assert.equal(typeof chart.bars.at(-1).ema9, 'number');
  assert.equal(typeof chart.bars.at(-1).vwap, 'number');
});

test('ICT reports a bullish FVG and structure break during the New York killzone', () => {
  const bars = makeBars(12, Date.parse('2025-01-02T14:49:00Z'));
  bars[9].high = 110;
  bars[11] = {
    timestamp: Date.parse('2025-01-02T15:00:00Z'),
    open: 112.2,
    high: 114,
    low: 112,
    close: 113,
    volume: 100
  };
  const dataset = parseCsv(toCsv(bars), 'NQ', '1m');
  const result = analyzeDataset(dataset, 'ICTStrategy', '1m');
  assert.equal(result.signal, 'BULLISH');
  assert.equal(result.status, 'READY');
});

test('CSV import rejects timezone-less timestamps and inconsistent OHLCV', () => {
  const timezoneLess = [
    'timestamp,open,high,low,close,volume',
    '2025-01-02 14:00:00,100,101,99,100,10'
  ].join('\n');
  assert.throws(() => parseCsv(timezoneLess, 'NQ', '1m'), /debe incluir zona horaria/);

  const inconsistent = [
    'timestamp,open,high,low,close,volume',
    '2025-01-02T14:00:00Z,100,99,98,100,10'
  ].join('\n');
  assert.throws(() => parseCsv(inconsistent, 'NQ', '1m'), /OHLCV inconsistente/);
});

test('Order Flow stays unavailable with OHLCV-only data', () => {
  const dataset = parseCsv(toCsv(makeBars(20)), 'NQ', '1m');
  const result = analyzeDataset(dataset, 'OrderFlowStrategy', '1m');
  assert.equal(result.status, 'UNAVAILABLE');
  assert.match(result.reason, /bid\/ask/);
});

test('historical simulation enters on the next candle and resolves same-candle TP/stop conservatively', () => {
  const bars = Array.from({ length: 17 }, (_, index) => ({
    timestamp: Date.parse('2025-01-02T14:45:00Z') + index * 60_000,
    open: 100,
    high: 100.25,
    low: 99.75,
    close: 100,
    volume: 100
  }));
  bars[14] = {
    ...bars[14],
    open: 102,
    high: 103.2,
    low: 101.5,
    close: 103
  };
  bars[15] = {
    ...bars[15],
    open: 103,
    high: 103.25,
    low: 102.75,
    close: 103
  };
  bars[16] = {
    ...bars[16],
    open: 103,
    high: 106,
    low: 101,
    close: 103
  };

  const dataset = parseCsv(toCsv(bars), 'NQ', '1m');
  const result = simulateHistoricalTrades(dataset, 'ICTStrategy', '1m');
  assert.equal(result.total_signals, 1);
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].side, 'BUY');
  assert.equal(result.trades[0].entry_time, new Date(bars[15].timestamp).toISOString());
  assert.equal(result.trades[0].entry_price, bars[15].open);
  assert.equal(result.trades[0].status, 'STOP_HIT');
  assert.ok(result.trades[0].stop_loss < result.trades[0].entry_price);
  assert.ok(result.trades[0].take_profit > result.trades[0].entry_price);
  assert.equal(result.trades[0].execution_mode, 'HISTORICAL_SIMULATION');
  const chart = buildChartData(dataset, '1m', result.trades[0]);
  assert.equal(chart.trade.id, result.trades[0].id);
  assert.ok(chart.bars.some(bar => bar.timestamp === Date.parse(result.trades[0].entry_time)));
});

test('historical simulation marks a target hit when only TP is touched', () => {
  const bars = Array.from({ length: 17 }, (_, index) => ({
    timestamp: Date.parse('2025-01-02T14:45:00Z') + index * 60_000,
    open: 100,
    high: 100.25,
    low: 99.75,
    close: 100,
    volume: 100
  }));
  bars[14] = { ...bars[14], open: 102, high: 103.2, low: 101.5, close: 103 };
  bars[15] = { ...bars[15], open: 103, high: 103.25, low: 102.75, close: 103 };
  bars[16] = { ...bars[16], open: 103, high: 106, low: 102.75, close: 105 };

  const dataset = parseCsv(toCsv(bars), 'NQ', '1m');
  const result = simulateHistoricalTrades(dataset, 'ICTStrategy', '1m');
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].status, 'TP_HIT');
  assert.equal(result.trades[0].pnl_points, (result.trades[0].entry_price - result.trades[0].stop_loss) * 2);
});
