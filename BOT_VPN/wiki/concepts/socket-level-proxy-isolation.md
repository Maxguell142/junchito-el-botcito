---
title: Aislamiento de Red por Socket mediante SOCKS5 en Windows
category: concepts
tags: [networking, socks5, aiohttp-socks, windows, proxy, prop-firms]
last_updated: 2026-10-16
sources: [raw/system-specifications.md, raw/prop-firms-comparison.md]
---

# Aislamiento de Red por Socket mediante SOCKS5 en Windows

## El Problema del Enrutamiento Global en Windows
Cuando se opera con múltiples empresas de fondeo (Prop Firms como Apex, Topstep, Leelo) o múltiples cuentas simultáneas, los departamentos de riesgo y compliance supervisan activamente la huella de red (direcciones IP, headers de TLS y conexiones simultáneas). Si un trader conecta una VPN tradicional a nivel de sistema operativo en Windows, **todo el tráfico de la máquina cambia de IP**, lo que hace imposible:
1. Que el Bot 1 salga por la IP A (ej. Chicago, IL).
2. Que el Bot 2 salga por la IP B (ej. New York, NY).
3. Que el Bot 3 salga por la IP C (ej. Miami, FL).
4. Que el sistema mantenga acceso a la red local del usuario sin interrupciones.

## La Solución: Enrutamiento Asíncrono a Nivel de Socket

En **QUANTUM FX**, el enrutamiento de red no altera las tablas de rutas de Windows ni utiliza adaptadores virtuales TAP/TUN. Se realiza **estrictamente a nivel de socket TCP** en el espacio de usuario de Python 3.11+:

```python
from aiohttp_socks import ProxyConnector

# Para cada TradingBot independiente:
connector = ProxyConnector.from_url("socks5://user:pass@proxy-node-1.net:1080")
session = aiohttp.ClientSession(connector=connector)
```

### Flujo de Datos
```
Windows Host (IP Original Intacta)
│
├── TradingBot 1 ──> aiohttp ClientSession A (SOCKS5 Proxy A) ──> Salida IP: 198.51.100.12  ──> Tradovate (Apex)
├── TradingBot 2 ──> aiohttp ClientSession B (SOCKS5 Proxy B) ──> Salida IP: 203.0.113.88   ──> Rithmic (Leelo)
└── TradingBot 3 ──> aiohttp ClientSession C (SOCKS5 Proxy C) ──> Salida IP: 192.0.2.45      ──> Tradovate (Topstep)
```

## Monitor de Salud y Medición de Latencia (Ping)
La clase `ProxyConnector` en `bot_engine.py` ejecuta periódicamente:
1. Petición GET a un endpoint de resolución pública (`https://api.ipify.org?format=json`).
2. Cálculo de latencia de ida y vuelta en milisegundos (`ping_ms = (t_end - t_start) * 1000`).
3. Detección automática de la IP pública con la que el broker recibe las órdenes de ese bot.
4. Fallback automático a conexión directa TCP en entornos de desarrollo local (`127.0.0.1`) sin interrumpir la ejecución.

## Enlaces Relacionados
- [[index|Índice Maestro de la Wiki]]
- [[system-overview]]
- [[tradovate-api]]
- [[rithmic-rapi]]
- [[apex-topstep-leelo-blueguardian]]
