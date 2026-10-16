---
title: Conector Rithmic (R|API+ y Protocolo Protocol Buffers)
category: connectors
tags: [rithmic, rapi, protobuf, futures, leelo, apex]
last_updated: 2026-10-16
sources: [raw/system-specifications.md, raw/prop-firms-comparison.md]
---

# Conector Rithmic (R|API+ y Protocolo Protocol Buffers)

## Descripción General
**Rithmic** es el estándar de baja latencia institucional para trading de futuros de CME (utilizado extensamente por Leelo Trading y Apex Trader Funding). Se comunica mediante conexiones socket TCP binarias directas utilizando **Google Protocol Buffers** (Protobuf) o WebSockets seguros (R|WebAPI).

## Arquitectura de Conexión
1. **Infraestructura de Gateways (Chicago / Aurora Data Centers)**:
   - Servidor Paper / Test: `wss://rituz0100.010.rithmic.com:443`
   - Servidor Live: Gateways dedicados con conexión a CME Globex.
2. **Plantilla de Mensajes Protobuf**:
   - `RequestLogin`: Credenciales de cuenta de prop firm, sistema (ej. `Apex` o `Leelo`), y rol (`ADMIN` o `TRADER`).
   - `RequestOrderPlacement`: Ticker `MNQ`, tipo de orden, tamaño de lote, duración (DAY / GTC).
   - `AccountPnLPositionUpdate`: Transmisión en milisegundos de balance, PnL y estado de llenado de órdenes.

## Aislamiento de Red mediante SOCKS5
Dado que Rithmic establece conexiones socket persistentes de baja latencia, el `ProxyConnector` de `bot_engine.py` establece el handshake SOCKS5 hacia el proxy del bot antes de iniciar el túnel TLS/Protobuf. Esto asegura que la sesión de Rithmic provenga siempre de la IP geolocalizada asignada a ese bot.

## Enlaces Relacionados
- [[socket-level-proxy-isolation]]
- [[tradovate-api]]
- [[apex-topstep-leelo-blueguardian]]
