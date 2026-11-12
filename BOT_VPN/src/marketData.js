/**
 * src/marketData.js - Proveedor Multi-Fuente de Datos de Mercado en Tiempo Real
 * Soporta: Yahoo Finance, Finnhub, Alpha Vantage y Generación Sintética de Respaldo
 */

const fs = require('fs');
const path = require('path');
const PROVIDER_TIMEOUT_MS = 8000;

function fetchWithTimeout(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
  });
}

// Cargar variables de entorno si existe .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(envPath);
    } else {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const idx = trimmed.indexOf('=');
          const k = trimmed.slice(0, idx).trim();
          const v = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
          if (!process.env[k]) process.env[k] = v;
        }
      }
    }
  } catch (e) {
    // Silencioso en carga de entorno
  }
}

function intervalToSeconds(interval) {
  const str = String(interval || '1m').toLowerCase();
  const num = parseInt(str, 10) || 1;
  if (str.endsWith('m')) return num * 60;
  if (str.endsWith('h')) return num * 3600;
  if (str.endsWith('d')) return num * 86400;
  return num * 60;
}

/**
 * Normaliza y mapea símbolos para proveedores que no admiten contratos de futuros directos
 */
function mapSymbolForProvider(symbol, provider) {
  const clean = String(symbol || 'MNQ').toUpperCase().trim();
  if (provider === 'yahoo') {
    if (clean === 'MNQ' || clean === 'MNQ=F') return 'MNQ=F';
    if (clean === 'NQ' || clean === 'NQ=F') return 'NQ=F';
    if (clean === 'ES' || clean === 'ES=F') return 'ES=F';
    return clean;
  }
  if (provider === 'finnhub' || provider === 'alphavantage') {
    // Finnhub / AlphaVantage free tier se basan en ETFs/Acciones US líquidas
    if (clean === 'MNQ' || clean === 'NQ' || clean === 'MNQ=F' || clean === 'NQ=F') return 'QQQ';
    if (clean === 'ES' || clean === 'ES=F') return 'SPY';
    return clean;
  }
  return clean;
}

/**
 * 1. Yahoo Finance (Sin API Key requerida)
 */
async function fetchYahoo(symbol, interval = '1m', limit = 100) {
  const cleanSymbol = mapSymbolForProvider(symbol, 'yahoo');
  const validIntervals = ['1m', '2m', '5m', '15m', '30m', '60m', '1h', '1d'];
  const safeInterval = validIntervals.includes(interval) ? interval : '1m';

  // Seleccionar rango adecuado para el interval pedido
  let range = '2d';
  if (safeInterval === '1d') range = '1y';
  else if (safeInterval === '1h' || safeInterval === '60m') range = '1mo';
  else if (safeInterval === '15m' || safeInterval === '30m' || safeInterval === '5m') range = '5d';
  else if (limit > 150) range = '5d';

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(cleanSymbol)}?interval=${safeInterval}&range=${range}`;

  const res = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance respondió HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
    throw new Error('Yahoo Finance no retornó datos de velas válidos');
  }

  const timestamps = result.timestamp;
  const quote = result.indicators.quote[0];
  const candles = [];

  for (let i = 0; i < timestamps.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    const v = quote.volume?.[i];

    if (o !== null && h !== null && l !== null && c !== null && !isNaN(o)) {
      candles.push({
        time: Math.floor(timestamps[i]),
        open: Number(Number(o).toFixed(2)),
        high: Number(Number(h).toFixed(2)),
        low: Number(Number(l).toFixed(2)),
        close: Number(Number(c).toFixed(2)),
        volume: Math.round(v || 0)
      });
    }
  }

  return candles.slice(-limit);
}

/**
 * 2. Finnhub (60 req/min, free tier)
 */
async function fetchFinnhub(symbol, interval = '1m', limit = 100) {
  const apiKey = process.env.FINNHUB_API_KEY || '';
  if (!apiKey) {
    throw new Error('FINNHUB_API_KEY no configurada');
  }

  const cleanSymbol = mapSymbolForProvider(symbol, 'finnhub');
  const resolutionMap = {
    '1m': '1',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '60m': '60',
    '1h': '60',
    '1d': 'D'
  };
  const resolution = resolutionMap[interval] || '1';
  const now = Math.floor(Date.now() / 1000);
  const seconds = intervalToSeconds(interval);
  const from = now - (Math.max(limit, 50) * seconds);

  const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(cleanSymbol)}&resolution=${resolution}&from=${from}&to=${now}&token=${apiKey}`;

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`Finnhub respondió HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  if (json.s !== 'ok' || !Array.isArray(json.t)) {
    throw new Error(`Finnhub status: ${json.s || 'no_data'}`);
  }

  const candles = [];
  for (let i = 0; i < json.t.length; i++) {
    candles.push({
      time: Math.floor(json.t[i]),
      open: Number(Number(json.o[i]).toFixed(2)),
      high: Number(Number(json.h[i]).toFixed(2)),
      low: Number(Number(json.l[i]).toFixed(2)),
      close: Number(Number(json.c[i]).toFixed(2)),
      volume: Math.round(json.v[i] || 0)
    });
  }

  return candles.slice(-limit);
}

/**
 * 3. Alpha Vantage (5 req/min, free tier)
 */
async function fetchAlphaVantage(symbol, interval = '1m', limit = 100) {
  const apiKey = process.env.ALPHAVANTAGE_API_KEY || '';
  if (!apiKey) {
    throw new Error('ALPHAVANTAGE_API_KEY no configurada');
  }

  const cleanSymbol = mapSymbolForProvider(symbol, 'alphavantage');
  const validIntervals = ['1min', '5min', '15min', '30min', '60min'];
  const avInterval = interval.includes('min') ? interval : interval.replace('m', 'min');
  const safeInterval = validIntervals.includes(avInterval) ? avInterval : '1min';

  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_INTRADAY&symbol=${encodeURIComponent(cleanSymbol)}&interval=${safeInterval}&outputsize=compact&apikey=${apiKey}`;

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`Alpha Vantage respondió HTTP ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  const seriesKey = `Time Series (${safeInterval})`;
  const series = json[seriesKey];

  if (!series || typeof series !== 'object') {
    const errorMsg = json['Note'] || json['Error Message'] || json['Information'] || 'Formato Alpha Vantage inesperado';
    throw new Error(errorMsg);
  }

  const candles = Object.entries(series)
    .map(([timeStr, data]) => {
      const parsedTime = Math.floor(new Date(timeStr).getTime() / 1000);
      return {
        time: isNaN(parsedTime) ? Math.floor(Date.now() / 1000) : parsedTime,
        open: parseFloat(data['1. open']),
        high: parseFloat(data['2. high']),
        low: parseFloat(data['3. low']),
        close: parseFloat(data['4. close']),
        volume: Math.round(parseFloat(data['5. volume'] || 0))
      };
    })
    .filter(c => !isNaN(c.time) && !isNaN(c.close))
    .reverse(); // Ordenar del más antiguo al más reciente

  return candles.slice(-limit);
}

/**
 * 4. Generador de Respaldo Sintético (Garantiza 100% disponibilidad en caso de límite de tasa)
 */
function generateSyntheticCandles(symbol, interval = '1m', limit = 100) {
  const clean = String(symbol || 'MNQ').toUpperCase();
  let basePrice = 28245.50;
  if (clean.includes('ES') || clean === 'SPY') basePrice = 7610.25;
  else if (clean === 'QQQ') basePrice = 585.50;
  else if (clean === 'AAPL') basePrice = 245.00;

  const seconds = intervalToSeconds(interval);
  const now = Math.floor(Date.now() / 1000);
  const candles = [];
  let cur = basePrice;

  for (let i = limit; i >= 0; i--) {
    const t = now - (i * seconds);
    const delta = (Math.sin(i / 5) * 4) + ((Math.random() - 0.49) * 3);
    const open = Number(cur.toFixed(2));
    const close = Number((cur + delta).toFixed(2));
    const high = Number((Math.max(open, close) + Math.random() * 2.5).toFixed(2));
    const low = Number((Math.min(open, close) - Math.random() * 2.5).toFixed(2));
    const volume = Math.floor(80 + Math.random() * 350);

    candles.push({ time: t, open, high, low, close, volume });
    cur = close;
  }

  return candles;
}

/**
 * Función Principal Unificada
 */
async function getCandles(symbol = 'MNQ', interval = '1m', limit = 100, customProvider = null) {
  const provider = (customProvider || process.env.MARKET_DATA_PROVIDER || 'finnhub').toLowerCase().trim();
  const maxBars = Math.min(Math.max(Number(limit) || 100, 10), 500);

  let candles = null;
  let activeProvider = provider;
  let providerError = null;

  try {
    if (provider === 'synthetic') {
      candles = generateSyntheticCandles(symbol, interval, maxBars);
      activeProvider = 'synthetic';
    } else if (provider === 'yahoo') {
      candles = await fetchYahoo(symbol, interval, maxBars);
    } else if (provider === 'alphavantage') {
      candles = await fetchAlphaVantage(symbol, interval, maxBars);
    } else if (provider === 'finnhub') {
      candles = await fetchFinnhub(symbol, interval, maxBars);
    } else {
      activeProvider = 'yahoo';
      candles = await fetchYahoo(symbol, interval, maxBars);
    }
  } catch (err) {
    providerError = err.message;
    // Si falla el proveedor seleccionado, intentar con Yahoo como primer fallback
    if (provider !== 'yahoo') {
      try {
        candles = await fetchYahoo(symbol, interval, maxBars);
        activeProvider = 'yahoo (fallback)';
      } catch (e2) {
        // Fallback a sintético para mantener el dashboard 100% operativo
        candles = generateSyntheticCandles(symbol, interval, maxBars);
        activeProvider = 'synthetic (fallback)';
      }
    } else {
      candles = generateSyntheticCandles(symbol, interval, maxBars);
      activeProvider = 'synthetic (fallback)';
    }
  }

  if (!candles || candles.length === 0) {
    candles = generateSyntheticCandles(symbol, interval, maxBars);
    activeProvider = 'synthetic (fallback)';
  }

  return {
    symbol,
    interval,
    provider: activeProvider,
    count: candles.length,
    candles,
    fallback_warning: providerError || null
  };
}

module.exports = {
  getCandles,
  fetchYahoo,
  fetchFinnhub,
  fetchAlphaVantage,
  generateSyntheticCandles,
  intervalToSeconds
};
