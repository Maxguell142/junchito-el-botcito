---
title: Velas Externas para Gráficos y Fallback Sintético
category: connectors
tags: [market-data, external-data, synthetic-fallback, lightweight-charts, candles, finnhub, yahoo, alphavantage]
last_updated: 2026-11-11
sources: [src/marketData.js, server.js, public/app.js, tests/marketData.test.js]
---

# Velas Externas para Gráficos y Fallback Sintético

Node incorpora un conector multi-fuente (`src/marketData.js`) que obtiene velas para la cuadrícula de gráficos por bot. Es independiente del motor de trading simulado y del endpoint global `/api/market/candles`; no acredita un feed CME ni una conexión de broker.

## Proveedores Soportados y Conmutación

1. **Finnhub**: requiere `FINNHUB_API_KEY`; el código mapea MNQ/NQ a QQQ y ES a SPY. Esos símbolos son ETFs, no los futuros CME correspondientes.
2. **Yahoo Finance**: usa símbolos mapeados como `MNQ=F`, `NQ=F` y `ES=F`; la disponibilidad, frescura y licencia no se verifican desde el código.
3. **Alpha Vantage**: usa series intradía y mapea MNQ/NQ a QQQ y ES a SPY; requiere clave.
4. **Sintético**: genera datos ficticios cuando la ruta de proveedor falla, o si se selecciona explícitamente `synthetic`. Las tarjetas muestran ahora si recibieron velas sintéticas o de una API.

La interfaz vuelve a consultar los gráficos por bot aproximadamente cada 60 segundos. Es polling HTTP, no WebSocket de mercado. Las consultas externas tienen un timeout de ocho segundos y las tarjetas cargan en paralelo. El endpoint global todavía consume velas simuladas en memoria; la fuente externa se usa en las tarjetas por bot y en `GET /api/candles`.

## Configuración en Entorno (.env)

El archivo `.env` en la raíz de `BOT_VPN` controla el proveedor y los intervalos:

```env
MARKET_DATA_PROVIDER=finnhub
FINNHUB_API_KEY=tu_clave_finnhub
ALPHAVANTAGE_API_KEY=tu_clave_alphavantage
CANDLE_INTERVAL=1m
```

Para conmutar de proveedor se actualiza `MARKET_DATA_PROVIDER` (`finnhub`, `yahoo` o `alphavantage`) y se reinicia Node. El archivo `.env.example` no está presente actualmente; `.env` está ignorado por Git.

## Endpoints REST del Servidor

- `GET /api/candles`: Velas del mercado global con parámetros `symbol`, `interval`, `limit` y selector opcional `provider`.
- `GET /api/bot/:botId/candles`: Velas vinculadas al instrumento del bot según el mapa de `public/data/botSymbols.json`.

## Límites y puntos a corregir

- `public/data/botSymbols.json` es una asignación estática con IDs de ejemplo y default MNQ; no lee el instrumento del bot en SQLite.
- La gráfica general del panel usa `/api/market/candles`, que sigue siendo simulada. La selección de un bot cambia a la ruta de velas externa, y esa respuesta no incluye los marcadores de ejecución del endpoint global.
- Un nombre de proveedor desconocido intenta Yahoo; usa `synthetic` para solicitar velas ficticias de forma determinista.
- No usar las cotizaciones de ETF ni el fallback sintético como precios de MNQ/NQ/ES para riesgo, backtesting o envío de órdenes.

## Compatibilidad TradingView Lightweight Charts v5

La interfaz web utiliza TradingView Lightweight Charts v5.2.1. Las series de velas se instancian mediante `chart.addSeries(LightweightCharts.CandlestickSeries, options)` y los marcadores de trades se gestionan mediante el plugin primitivo `LightweightCharts.createSeriesMarkers(series, markers)`, evitando incompatibilidades con las APIs deprecadas de versiones anteriores.

## Referencias Cruzadas y Enlaces Relacionados
- [[system-overview]]
- [[stack-and-health]]
- [[index]]
- [[log]]
