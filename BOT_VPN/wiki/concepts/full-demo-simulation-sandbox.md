---
title: Arquitectura de Simulación Integral y Modo Demo (Digital Twin)
category: concepts
tags: [demo, simulation, digital-twin, sandbox, mock-api, mnq, prop-firms]
last_updated: 2026-11-06
sources: [raw/system-specifications.md, raw/prop-firms-comparison.md]
---

# Arquitectura de Simulación Integral y Modo Demo (Digital Twin)

Este documento define la arquitectura y el protocolo operativo de **Simulación Integral / Modo Demo** para la plataforma **QUANTUM FX**. Establece que toda la suite de trading (generación de precios de CME MNQ, ejecución de órdenes, replicación multi-cuenta con jitter, monitoreo de proxies SOCKS5 y circuit breakers) opera como un **Gemelo Digital (Digital Twin)** 100% funcional en local antes de requerir credenciales reales o desembolsos financieros.

---

## 1. Principio Fundamental: Seguridad y Validación Sin Riesgo Real

> [!IMPORTANT]
> **PROTOCOLO DE AISLAMIENTO DEMO-FIRST**:
> En esta etapa de desarrollo, **ninguna función solicita credenciales reales de brokers, cuentas de fondeo reales ni llaves de pago**.
> Todas las interfaces y motores de ejecución se comportan de forma idéntica a producción, pero interactúan con servicios simulados de alta fidelidad:
> 1. **Velas de CME MNQ en Tiempo Real**: Agregador de ticks sintéticos de 1 minuto, 5 minutos y 15 minutos en Canvas 60 FPS mediante TradingView Lightweight Charts.
> 2. **Mock APIs de Red SOCKS5 Residencial**: Simulación de nodos de Comcast, AT&T y Spectrum con IPs públicas dedicadas de EE.UU. y latencias dinámicas (10–25 ms).
> 3. **Cuentas Prop de Fondeo Virtuales**: Cuentas con nomenclatura institucional (`FUNDED_PA` y `EVALUATION`) bajo las reglas oficiales de Apex Trader Funding, Topstep y Leelo Trading.

---

## 2. Componentes del Gemelo Digital

### A. Motor de Cotizaciones y Velas Vivas (CME MNQ)
- Un bucle asíncrono en `server.js` emite ticks de precios continuos con fluctuaciones estocásticas basadas en el contrato Micro E-mini Nasdaq-100 (MNQ).
- Los ticks actualizan las velas activas y se transmiten vía WebSocket (`CANDLE_TICK`) a la interfaz para mover los gráficos de forma fluida.

### B. Mock API de Proxies Residenciales (SOCKS5 ISP)
- Cada bot tiene asignada una IP residencial dedicada de Estados Unidos (ej. `198.51.100.22`, `198.51.100.45`).
- El endpoint `GET /api/vpn/proxies` y `POST /api/bots/:id/proxy-test` reporta el estado de salud del socket, proveedor ASN y latencia de ida y vuelta hacia los servidores de CME Chicago.

### C. Telemetría de Operaciones y Gráficos por Bot
- Cada unidad de ejecución cuenta con su propio gráfico interactivo en el modal de inspección (`#modal-bot-chart-box`).
- Si el bot tiene operaciones en curso, proyecta visualmente:
  - **Línea de Entrada (Entry Price)**: Color azul / blanco.
  - **Línea de Take Profit (+2R / Consistency Lock +$150)**: Color verde neón.
  - **Línea de Stop Loss (Daily Loss Limit)**: Color rojo pánico.
  - **Insignia de Estado**: Indicador de posición activa (`🟢 LONG`, `🔴 SHORT` o `⚪ FLAT`).

---

## 3. Referencias Cruzadas y Enlaces Relacionados
- [[system-overview|Arquitectura General de QUANTUM FX]]
- [[socket-level-proxy-isolation|Aislamiento de Sockets SOCKS5 Residenciales]]
- [[multi-account-order-replication|Replicación Multi-Cuenta con Jitter]]
- [[apex-topstep-leelo-blueguardian|Reglas y Drawdowns de Prop Firms]]
