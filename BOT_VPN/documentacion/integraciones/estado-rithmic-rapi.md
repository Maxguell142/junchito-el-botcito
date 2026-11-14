---
title: "Referencia sobre Rithmic RAPI"
category: integraciones
tags: [rithmic, rapi, protobuf, futures, leelo, apex, quantum-fx, integracion, referencia]
last_updated: "2026-11-13"
sources: [raw/system-specifications.md, raw/prop-firms-comparison.md]
doc_type: "integracion_no_confirmada"
status: "referencia"
summary: "Información técnica de Rithmic; el proyecto no confirma una conexión activa."
---

# Referencia sobre Rithmic RAPI

> **Estado: integración no confirmada.** Este documento es referencia técnica; no acredita conexión con Rithmic.


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
El diseño descrito para `fastapi_service/bot_engine.py` contempla iniciar un túnel SOCKS5 antes de una sesión Rithmic. Esta nota es conceptual y no demuestra que exista una conexión activa ni un proxy operativo.

## Enlaces Relacionados
- [[documentacion/00_INICIO_OBSIDIAN|Índice Maestro de la Wiki]]
- [[documentacion/03_ARQUITECTURA_CONCEPTUAL]]
- [[documentacion/conceptos/diseno-aislamiento-proxy-socks5]]
- [[documentacion/integraciones/estado-tradovate-api]]
- [[documentacion/reglas_de_fondeo/referencia-reglas-apex-topstep-leelo-blueguardian]]
