---
title: "Referencia sobre la API Tradovate"
category: integraciones
tags: [tradovate, api, rest, websockets, prop-firms, apex, topstep, quantum-fx, integracion, referencia]
last_updated: "2026-11-13"
sources: [raw/system-specifications.md, raw/prop-firms-comparison.md]
doc_type: "integracion_no_confirmada"
status: "referencia"
summary: "Información técnica de Tradovate; el proyecto no confirma una conexión activa."
---

# Referencia sobre la API Tradovate

> **Estado: integración no confirmada.** Este documento es referencia técnica; no acredita conexión con Tradovate.


## Descripción General
**Tradovate** es la plataforma de broker líder para futuros en prop firms (utilizada por Apex Trader Funding, Topstep y Blue Guardian). Ofrece un entorno nativo en la nube accesible a través de una API REST moderna para órdenes y WebSockets para datos de mercado y actualizaciones de posición.

## Flujo de Autenticación y Endpoints

### 1. Autenticación (`/auth/accessTokenRequest`)
- **Método**: `POST`
- **Payload**:
  ```json
  {
    "name": "TU_USUARIO_TRADOVATE",
    "password": "TU_PASSWORD",
    "appId": "QUANTUM_BOT",
    "appVersion": "1.0",
    "cid": 123,
    "sec": "API_SECRET"
  }
  ```
- Retorna un token JWT de acceso (`accessToken`) con expiración típicamente de 24 horas y `mdAccessToken` para el feed de mercado.

### 2. Envío de Órdenes (`/order/placeOrder`)
- **Método**: `POST`
- **Headers**: `Authorization: Bearer <accessToken>`
- **Payload**:
  ```json
  {
    "accountSpec": "DEMO123456",
    "accountId": 12345,
    "action": "Buy",
    "symbol": "MNQU6",
    "orderStrategyTypeId": 1,
    "orderType": "Market",
    "isAutomated": true
  }
  ```

## Implementación Asíncrona con Proxy SOCKS5
El diseño descrito para `fastapi_service/bot_engine.py` propone un `BrokerAdapter` y `ProxyConnector`; la presencia de estas clases no prueba que la conexión con Tradovate esté activa.

## Enlaces Relacionados
- [[documentacion/00_INICIO_OBSIDIAN|Índice Maestro de la Wiki]]
- [[documentacion/03_ARQUITECTURA_CONCEPTUAL]]
- [[documentacion/conceptos/diseno-aislamiento-proxy-socks5]]
- [[documentacion/integraciones/estado-rithmic-rapi]]
- [[documentacion/reglas_de_fondeo/referencia-reglas-apex-topstep-leelo-blueguardian]]
