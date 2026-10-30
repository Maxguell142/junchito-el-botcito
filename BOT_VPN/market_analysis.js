const TIMEFRAMES = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000
};

const STRATEGIES = {
  ICTStrategy: 'ICT',
  TechnicalAnalysisStrategy: 'Técnica',
  SMTStrategy: 'SMT',
  OrderFlowStrategy: 'Order Flow'
};
const NEW_YORK_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function parseCsvRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(field.trim());
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field.trim());
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('El CSV contiene una comilla sin cerrar.');
  row.push(field.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

function parseNumber(value, column) {
  const normalized = value.replace(/[$,\s]/g, '');
  const number = Number(normalized);
  if (!Number.isFinite(number)) throw new Error(`Valor inválido en la columna ${column}.`);
  return number;
}

function parseCsv(text, symbol, sourceTimeframe) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('El archivo CSV está vacío.');
  if (text.length > 5 * 1024 * 1024) throw new Error('El CSV supera el límite de 5 MB.');
  if (!['NQ', 'ES'].includes(symbol)) throw new Error('El instrumento debe ser NQ o ES.');
  if (!Object.hasOwn(TIMEFRAMES, sourceTimeframe)) throw new Error('El intervalo de origen no es válido.');

  const normalizedText = text.replace(/^\uFEFF/, '');
  const firstLine = normalizedText.split(/\r?\n/, 1)[0] || '';
  const delimiters = [',', ';', '\t'];
  const delimiter = delimiters.sort(
    (left, right) => firstLine.split(right).length - firstLine.split(left).length
  )[0];
  const rows = parseCsvRows(normalizedText, delimiter);
  if (rows.length < 2) throw new Error('El CSV debe incluir encabezados y al menos una vela.');
  if (rows.length - 1 > 50_000) throw new Error('El CSV supera el límite de 50.000 velas.');

  const headers = rows[0].map(value => value.toLowerCase().replace(/[\s_-]/g, ''));
  const findColumn = names => headers.findIndex(header => names.includes(header));
  const indexes = {
    timestamp: findColumn(['timestamp', 'datetime', 'date', 'time']),
    open: findColumn(['open', 'o']),
    high: findColumn(['high', 'h']),
    low: findColumn(['low', 'l']),
    close: findColumn(['close', 'c']),
    volume: findColumn(['volume', 'vol', 'v'])
  };
  if (Object.values(indexes).some(index => index < 0)) {
    throw new Error('Se requieren columnas timestamp, open, high, low, close y volume.');
  }

  const bars = rows.slice(1).map((row, rowIndex) => {
    if (row.length !== headers.length) throw new Error(`La fila ${rowIndex + 2} tiene columnas incompletas.`);
    const timestampText = row[indexes.timestamp];
    if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(timestampText)) {
      throw new Error(`La fecha de la fila ${rowIndex + 2} debe incluir zona horaria, por ejemplo Z o -04:00.`);
    }
    const timestamp = Date.parse(timestampText);
    if (!Number.isFinite(timestamp)) throw new Error(`Fecha inválida en la fila ${rowIndex + 2}.`);
    const bar = {
      timestamp,
      open: parseNumber(row[indexes.open], 'open'),
      high: parseNumber(row[indexes.high], 'high'),
      low: parseNumber(row[indexes.low], 'low'),
      close: parseNumber(row[indexes.close], 'close'),
      volume: parseNumber(row[indexes.volume], 'volume')
    };
    if (bar.low <= 0 || bar.open <= 0 || bar.high <= 0 || bar.close <= 0 || bar.volume < 0
      || bar.high < Math.max(bar.open, bar.close, bar.low)
      || bar.low > Math.min(bar.open, bar.close)) {
      throw new Error(`OHLCV inconsistente en la fila ${rowIndex + 2}.`);
    }
    return bar;
  }).sort((left, right) => left.timestamp - right.timestamp);

  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index - 1].timestamp === bars[index].timestamp) {
      throw new Error('El CSV contiene velas con la misma fecha y hora.');
    }
  }
  return { symbol, sourceTimeframe, bars };
}

function aggregateBars(bars, sourceTimeframe, targetTimeframe) {
  const sourceDuration = TIMEFRAMES[sourceTimeframe];
  const targetDuration = TIMEFRAMES[targetTimeframe];
  if (!sourceDuration || !targetDuration || targetDuration < sourceDuration) return [];
  if (sourceTimeframe === targetTimeframe) return bars;

  const aggregated = [];
  let current = null;
  for (const bar of bars) {
    const bucket = Math.floor(bar.timestamp / targetDuration) * targetDuration;
    if (!current || current.timestamp !== bucket) {
      current = {
        timestamp: bucket,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      };
      aggregated.push(current);
    } else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
    }
  }
  return aggregated;
}

function ema(values, period) {
  if (values.length < period) return null;
  return emaSeries(values, period).at(-1);
}

function emaSeries(values, period) {
  if (values.length < period) return [];
  const multiplier = 2 / (period + 1);
  const result = Array(period - 1).fill(null);
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result.push(current);
  for (let index = period; index < values.length; index += 1) {
    current = (values[index] - current) * multiplier + current;
    result.push(current);
  }
  return result;
}

function buildChartData(dataset, timeframe, trade = null, maxBars = 120) {
  const bars = aggregateBars(dataset.bars, dataset.sourceTimeframe, timeframe);
  if (!bars.length) return { bars: [], trade: null };

  const entryIndex = trade
    ? bars.findIndex(bar => new Date(bar.timestamp).toISOString() === trade.entry_time)
    : -1;
  const startIndex = entryIndex < 0
    ? Math.max(0, bars.length - maxBars)
    : Math.max(0, Math.min(entryIndex - 70, bars.length - maxBars));
  const chartBars = bars.slice(startIndex, Math.min(bars.length, startIndex + maxBars));
  const closes = bars.map(bar => bar.close);
  const ema9 = emaSeries(closes, 9);
  const ema21 = emaSeries(closes, 21);
  const ema50 = emaSeries(closes, 50);
  let currentDay = '';
  let cumulativeVolume = 0;
  let cumulativePriceVolume = 0;
  const vwap = bars.map(bar => {
    const day = new Date(bar.timestamp).toISOString().slice(0, 10);
    if (day !== currentDay) {
      currentDay = day;
      cumulativeVolume = 0;
      cumulativePriceVolume = 0;
    }
    cumulativeVolume += bar.volume;
    cumulativePriceVolume += ((bar.high + bar.low + bar.close) / 3) * bar.volume;
    return cumulativeVolume > 0 ? cumulativePriceVolume / cumulativeVolume : null;
  });

  return {
    bars: chartBars.map((bar, index) => {
      const sourceIndex = startIndex + index;
      return {
        ...bar,
        ema9: ema9[sourceIndex],
        ema21: ema21[sourceIndex],
        ema50: ema50[sourceIndex],
        vwap: vwap[sourceIndex]
      };
    }),
    trade: entryIndex >= startIndex && entryIndex < startIndex + chartBars.length ? trade : null
  };
}

function calculateIndicators(bars) {
  const closes = bars.map(bar => bar.close);
  const latest = bars[bars.length - 1];
  const result = {
    close: latest.close,
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    ema50: ema(closes, 50),
    rsi14: null,
    atr14: null,
    macd: null,
    vwapUtcDay: null
  };

  if (bars.length >= 15) {
    const changes = closes.slice(-15).slice(1).map((close, index) => close - closes.slice(-15)[index]);
    const gains = changes.reduce((sum, value) => sum + Math.max(value, 0), 0) / 14;
    const losses = changes.reduce((sum, value) => sum + Math.max(-value, 0), 0) / 14;
    result.rsi14 = losses === 0
      ? (gains === 0 ? 50 : 100)
      : 100 - (100 / (1 + gains / losses));

    const ranges = bars.slice(-14).map((bar, index) => {
      const previousClose = index === 0 ? bars[bars.length - 15].close : bars[bars.length - 14 + index - 1].close;
      return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
    });
    result.atr14 = ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
  }

  if (bars.length >= 35) {
    const fast = emaSeries(closes, 12);
    const slow = emaSeries(closes, 26);
    const line = closes.map((_, index) => index < 25 ? null : fast[index] - slow[index]).filter(value => value !== null);
    const signal = ema(line, 9);
    result.macd = signal === null ? null : { line: line[line.length - 1], signal };
  }

  const utcDay = new Date(latest.timestamp).toISOString().slice(0, 10);
  const dayBars = bars.filter(bar => new Date(bar.timestamp).toISOString().slice(0, 10) === utcDay);
  const totalVolume = dayBars.reduce((sum, bar) => sum + bar.volume, 0);
  if (totalVolume > 0) {
    result.vwapUtcDay = dayBars.reduce(
      (sum, bar) => sum + ((bar.high + bar.low + bar.close) / 3) * bar.volume,
      0
    ) / totalVolume;
  }
  return result;
}

function getNewYorkMinutes(timestamp) {
  const parts = NEW_YORK_CLOCK.formatToParts(new Date(timestamp));
  const hour = Number(parts.find(part => part.type === 'hour').value);
  const minute = Number(parts.find(part => part.type === 'minute').value);
  return hour * 60 + minute;
}

function analyzeStrategy(strategy, bars, indicators, symbol, pairedBars = null) {
  const latest = bars[bars.length - 1];
  if (strategy === 'TechnicalAnalysisStrategy') {
    if (indicators.ema50 === null || indicators.rsi14 === null) {
      return { status: 'INSUFFICIENT_DATA', signal: 'NEUTRAL', reason: 'Se requieren al menos 50 velas para el análisis técnico.' };
    }
    if (indicators.ema9 > indicators.ema21 && indicators.ema21 > indicators.ema50
      && indicators.rsi14 >= 50 && indicators.rsi14 < 70) {
      return { status: 'READY', signal: 'BULLISH', reason: 'EMA 9/21/50 alineadas al alza y RSI en zona de impulso.' };
    }
    if (indicators.ema9 < indicators.ema21 && indicators.ema21 < indicators.ema50
      && indicators.rsi14 <= 50 && indicators.rsi14 > 30) {
      return { status: 'READY', signal: 'BEARISH', reason: 'EMA 9/21/50 alineadas a la baja y RSI en zona de impulso.' };
    }
    return { status: 'READY', signal: 'NEUTRAL', reason: 'Las condiciones de tendencia y momentum no están alineadas.' };
  }

  if (strategy === 'ICTStrategy') {
    if (bars.length < 12) {
      return { status: 'INSUFFICIENT_DATA', signal: 'NEUTRAL', reason: 'Se requieren al menos 12 velas para buscar FVG y estructura.' };
    }
    const bullishFvg = latest.low > bars[bars.length - 3].high;
    const bearishFvg = latest.high < bars[bars.length - 3].low;
    const priorBars = bars.slice(-11, -1);
    const bullishMss = latest.close > Math.max(...priorBars.map(bar => bar.high));
    const bearishMss = latest.close < Math.min(...priorBars.map(bar => bar.low));
    const inNyKillzone = getNewYorkMinutes(latest.timestamp) >= 570
      && getNewYorkMinutes(latest.timestamp) < 690;
    if (!inNyKillzone) {
      return { status: 'READY', signal: 'NEUTRAL', reason: 'Fuera de la killzone NY configurada (09:30–11:30).', filters: { inNyKillzone } };
    }
    if (bullishFvg && bullishMss) {
      return { status: 'READY', signal: 'BULLISH', reason: 'FVG alcista y ruptura de estructura detectados en killzone NY.', filters: { inNyKillzone } };
    }
    if (bearishFvg && bearishMss) {
      return { status: 'READY', signal: 'BEARISH', reason: 'FVG bajista y ruptura de estructura detectados en killzone NY.', filters: { inNyKillzone } };
    }
    return { status: 'READY', signal: 'NEUTRAL', reason: 'No coinciden FVG, ruptura de estructura y killzone NY.', filters: { inNyKillzone, bullishFvg, bearishFvg, bullishMss, bearishMss } };
  }

  if (strategy === 'SMTStrategy') {
    if (!pairedBars || pairedBars.length < 10 || bars.length < 10) {
      return { status: 'UNAVAILABLE', signal: 'NEUTRAL', reason: 'SMT necesita velas sincronizadas de NQ y ES.' };
    }
    const pairedByTimestamp = new Map(pairedBars.map(bar => [bar.timestamp, bar]));
    const alignedBars = bars
      .filter(bar => pairedByTimestamp.has(bar.timestamp))
      .slice(-10);
    if (alignedBars.length < 10 || alignedBars[alignedBars.length - 1].timestamp !== latest.timestamp) {
      return { status: 'UNAVAILABLE', signal: 'NEUTRAL', reason: 'Las últimas velas de NQ y ES no tienen la misma hora.' };
    }
    const ownWindow = alignedBars;
    const pairedWindow = alignedBars.map(bar => pairedByTimestamp.get(bar.timestamp));
    const ownHighNow = Math.max(...ownWindow.slice(-5).map(bar => bar.high));
    const ownHighBefore = Math.max(...ownWindow.slice(0, 5).map(bar => bar.high));
    const pairedHighNow = Math.max(...pairedWindow.slice(-5).map(bar => bar.high));
    const pairedHighBefore = Math.max(...pairedWindow.slice(0, 5).map(bar => bar.high));
    const ownLowNow = Math.min(...ownWindow.slice(-5).map(bar => bar.low));
    const ownLowBefore = Math.min(...ownWindow.slice(0, 5).map(bar => bar.low));
    const pairedLowNow = Math.min(...pairedWindow.slice(-5).map(bar => bar.low));
    const pairedLowBefore = Math.min(...pairedWindow.slice(0, 5).map(bar => bar.low));
    if ((ownHighNow > ownHighBefore && pairedHighNow <= pairedHighBefore)
      || (pairedHighNow > pairedHighBefore && ownHighNow <= ownHighBefore)) {
      return { status: 'READY', signal: 'BEARISH', reason: `Divergencia SMT bajista detectada entre ${symbol} y su índice correlacionado.` };
    }
    if ((ownLowNow < ownLowBefore && pairedLowNow >= pairedLowBefore)
      || (pairedLowNow < pairedLowBefore && ownLowNow >= ownLowBefore)) {
      return { status: 'READY', signal: 'BULLISH', reason: `Divergencia SMT alcista detectada entre ${symbol} y su índice correlacionado.` };
    }
    return { status: 'READY', signal: 'NEUTRAL', reason: 'No se detectó divergencia de máximos o mínimos en las últimas 10 velas.' };
  }

  return {
    status: 'UNAVAILABLE',
    signal: 'NEUTRAL',
    reason: strategy === 'OrderFlowStrategy'
      ? 'Order Flow requiere datos de operaciones y bid/ask; OHLCV no es suficiente.'
      : 'Estrategia no reconocida para análisis de velas.'
  };
}

function analyzeDataset(dataset, strategy, timeframe, pairedDataset = null) {
  if (!Object.hasOwn(TIMEFRAMES, timeframe)) throw new Error('Intervalo de análisis no válido.');
  const bars = aggregateBars(dataset.bars, dataset.sourceTimeframe, timeframe);
  if (!bars.length) {
    return { status: 'UNAVAILABLE', signal: 'NEUTRAL', reason: `El origen ${dataset.sourceTimeframe} no permite generar velas ${timeframe}.` };
  }
  const indicators = calculateIndicators(bars);
  const pairedBars = pairedDataset
    ? aggregateBars(pairedDataset.bars, pairedDataset.sourceTimeframe, timeframe)
    : null;
  const decision = analyzeStrategy(strategy, bars, indicators, dataset.symbol, pairedBars);
  return {
    ...decision,
    symbol: dataset.symbol,
    strategy,
    timeframe,
    source: 'CSV histórico importado',
    data_type: 'HISTORICAL',
    bars_analyzed: bars.length,
    last_bar_at: new Date(bars[bars.length - 1].timestamp).toISOString(),
    indicators: Object.fromEntries(
      Object.entries(indicators).map(([key, value]) => [key, typeof value === 'number' ? Number(value.toFixed(4)) : value])
    )
  };
}

function roundToTick(value, tickSize) {
  return Number((Math.round(value / tickSize) * tickSize).toFixed(8));
}

function simulateHistoricalTrades(dataset, strategy, timeframe, pairedDataset = null) {
  const bars = aggregateBars(dataset.bars, dataset.sourceTimeframe, timeframe);
  if (!bars.length) return { trades: [], total_signals: 0 };
  if (strategy === 'OrderFlowStrategy') return { trades: [], total_signals: 0 };

  const pairedBars = pairedDataset
    ? aggregateBars(pairedDataset.bars, pairedDataset.sourceTimeframe, timeframe)
    : [];
  const pairedByTimestamp = new Map(pairedBars.map(bar => [bar.timestamp, bar]));
  const minBars = strategy === 'TechnicalAnalysisStrategy' ? 50 : strategy === 'SMTStrategy' ? 10 : 12;
  const startIndex = Math.max(minBars - 1, bars.length - 500);
  const warmupBars = 250;
  const trades = [];
  let totalSignals = 0;
  let signalIndex = startIndex;

  while (signalIndex < bars.length - 1) {
    const history = bars.slice(Math.max(0, signalIndex - warmupBars), signalIndex + 1);
    const indicators = calculateIndicators(history);
    const pairedHistory = strategy === 'SMTStrategy'
      ? history
        .filter(bar => pairedByTimestamp.has(bar.timestamp))
        .map(bar => pairedByTimestamp.get(bar.timestamp))
      : null;
    const decision = analyzeStrategy(strategy, history, indicators, dataset.symbol, pairedHistory);
    if (!['BULLISH', 'BEARISH'].includes(decision.signal) || indicators.atr14 === null) {
      signalIndex += 1;
      continue;
    }

    const entryIndex = signalIndex + 1;
    const entryBar = bars[entryIndex];
    const side = decision.signal === 'BULLISH' ? 'BUY' : 'SELL';
    const riskPoints = Math.max(0.25, roundToTick(indicators.atr14 * 1.5, 0.25));
    const entryPrice = entryBar.open;
    const stopLoss = roundToTick(entryPrice + (side === 'BUY' ? -riskPoints : riskPoints), 0.25);
    const takeProfit = roundToTick(entryPrice + (side === 'BUY' ? riskPoints * 2 : -riskPoints * 2), 0.25);
    if (stopLoss <= 0 || takeProfit <= 0) {
      signalIndex += 1;
      continue;
    }
    totalSignals += 1;
    let exit = null;

    for (let exitIndex = entryIndex; exitIndex < bars.length; exitIndex += 1) {
      const bar = bars[exitIndex];
      const stopTouched = side === 'BUY' ? bar.low <= stopLoss : bar.high >= stopLoss;
      const targetTouched = side === 'BUY' ? bar.high >= takeProfit : bar.low <= takeProfit;
      if (stopTouched || targetTouched) {
        const stopped = stopTouched;
        exit = {
          status: stopped ? 'STOP_HIT' : 'TP_HIT',
          exit_price: stopped ? stopLoss : takeProfit,
          exit_time: new Date(bar.timestamp).toISOString(),
          bars_held: exitIndex - entryIndex + 1,
          pnl_points: stopped ? -riskPoints : riskPoints * 2
        };
        break;
      }
    }

    if (!exit) {
      const lastBar = bars[bars.length - 1];
      const pnlPoints = side === 'BUY' ? lastBar.close - entryPrice : entryPrice - lastBar.close;
      exit = {
        status: 'NO_EXIT_IN_HISTORY',
        exit_price: lastBar.close,
        exit_time: new Date(lastBar.timestamp).toISOString(),
        bars_held: bars.length - entryIndex,
        pnl_points: Number(pnlPoints.toFixed(4))
      };
    }

    trades.push({
      id: `${dataset.symbol}-${strategy}-${timeframe}-${bars[signalIndex].timestamp}`,
      symbol: dataset.symbol,
      strategy,
      timeframe,
      side,
      signal_time: new Date(bars[signalIndex].timestamp).toISOString(),
      entry_time: new Date(entryBar.timestamp).toISOString(),
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      status: exit.status,
      exit_price: exit.exit_price,
      exit_time: exit.exit_time,
      bars_held: exit.bars_held,
      pnl_points: exit.pnl_points,
      assumed_risk_reward: '1:2',
      reason: decision.reason,
      execution_mode: 'HISTORICAL_SIMULATION'
    });

    signalIndex = signalIndex + exit.bars_held;
  }

  return {
    total_signals: totalSignals,
    bars_tested: bars.length - startIndex,
    trades: trades.slice(-25).reverse()
  };
}

module.exports = {
  TIMEFRAMES,
  STRATEGIES,
  parseCsv,
  aggregateBars,
  buildChartData,
  calculateIndicators,
  analyzeDataset,
  simulateHistoricalTrades
};
