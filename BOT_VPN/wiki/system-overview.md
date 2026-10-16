---
title: Arquitectura General del Sistema
category: architecture
tags: [system, multi-bot, fastapi, async, windows, futures, mnq]
last_updated: 2026-10-16
sources: [raw/system-specifications.md, raw/cme-mnq-specifications.md]
---

# Arquitectura General del Sistema (QUANTUM FX)

## Resumen Ejecutivo
**QUANTUM FX** es una infraestructura de trading algorítmico distribuido para futuros de CME (**Micro E-mini Nasdaq-100 / MNQ**), concebida para ejecutarse como un servicio nativo de alta disponibilidad en **Windows**.

El sistema desacopla completamente tres dimensiones críticas:
1. **La Estrategia Algorítmica**: Módulos técnicos puros (`ICTStrategy`, `SMTStrategy`, `OrderFlowStrategy`) que reciben señales de TradingView y deciden entrada, stop loss y take profit según las condiciones del mercado.
2. **El Aislamiento de Red**: Cada bot encamina sus sockets HTTP/WebSocket exclusivamente por su propio proxy SOCKS5 dedicado (`aiohttp-socks`), garantizando que la IP de la máquina Windows anfitriona no se vea afectada.
3. **La Replicación de Cuentas**: Cada bot replica simultáneamente las órdenes aprobadas a través de su túnel de red hacia múltiples cuentas de prop firms (Apex, Topstep, Leelo, Blue Guardian) conectadas vía **Tradovate** y **Rithmic**.

```mermaid
graph TD
    TV[TradingView Alerts JSON] -->|HTTP POST| WH["/api/webhook (FastAPI)"]
    WH --> Dispatcher[BotManager Dispatcher]
    
    subgraph MultiBot_Grid [Instancias Concurrentes de TradingBot]
        B1["Bot 1: MNQ ICT Scalper<br/>Proxy A (IP 1)<br/>09:30-11:30 EST"]
        B2["Bot 2: MNQ SMT Reversal<br/>Proxy B (IP 2)<br/>09:30-12:00 EST"]
        B3["Bot 3: MNQ Order Flow<br/>Proxy C (IP 3)<br/>10:00-15:30 EST"]
    end

    Dispatcher --> B1
    Dispatcher --> B2
    Dispatcher --> B3

    subgraph Socket_Proxies [Aislamiento de Red SOCKS5]
        PA["Socket Session A (aiohttp-socks)"]
        PB["Socket Session B (aiohttp-socks)"]
        PC["Socket Session C (aiohttp-socks)"]
    end

    B1 --> PA
    B2 --> PB
    B3 --> PC

    subgraph Broker_Endpoints [Prop Firms & Brokers]
        PA --> TRAD1["Tradovate API (Apex 50k #1 & #2)"]
        PB --> RITH1["Rithmic R|API+ (Topstep & Leelo)"]
        PC --> TRAD2["Tradovate API (Blue Guardian)"]
    end

    subgraph UI_Streaming [Dashboard Dark Theme]
        BM_WS["WebSocket /ws Server"] <==> CLIENT["app.js / index.html Client"]
    end

    Dispatcher -. Telemetría .-> BM_WS
```

---

## Componentes del Código y Responsabilidades

- **`main.py`**:
  - Servidor asíncrono FastAPI y gateway HTTP/WebSocket.
  - Endpoint `/api/webhook` con validación de token secreto para procesar alertas de TradingView.
  - Endpoint `/ws` con canalización bidireccional continua (transmisión de snapshots a 1Hz y notificaciones en tiempo real).
  - API REST de control para pausar/reanudar bots, modificar ventanas de horario y añadir cuentas.
  - Servidor de archivos estáticos para la interfaz web.

- **`bot_engine.py`**:
  - `ProxyConnector`: Enrutador a nivel de socket con soporte SOCKS5 y fallback automático. Mide latencia (ping) e IP pública de salida.
  - `TradingBot`: Instancia operativa que encapsula una estrategia, un proxy y una lista de cuentas. Valida el filtro de horario de Nueva York (`America/New_York`) antes de ejecutar cualquier orden.
  - `BrokerAdapter`: Abstracción de conexión para Tradovate y Rithmic que efectúa la replicación concurrente (`asyncio.gather`) y calcula PnL en base al tick de MNQ ($0.50 USD / tick).
  - `BotManager`: Gestor central, persistencia en `config.json` y bucle de telemetría en segundo plano.

- **`strategies.py`**:
  - Jerarquía orientada a objetos derivada de `BaseStrategy`.
  - Normalización y cálculo de Stop Loss / Take Profit / R:R.

- **`public/` (UI Dashboard)**:
  - Estética **Dark Theme estricto** (#0D0D0D, #121212, #181818, #1E1E1E).
  - Grid reactivo con tarjetas por bot, panel de detalle con consola de eventos en streaming y tabla de cuentas con nombres personalizados.

---

## Enlaces Relacionados
- [[socket-level-proxy-isolation]] — Detalles del enrutamiento de red en Windows.
- [[multi-account-order-replication]] — Mecánica de replicación y cálculo de PnL.
- [[new-york-killzones-and-time-filters]] — Ventanas operativas y filtrado temporal.
- [[ict-strategy]] — Parámetros y lógica de la estrategia ICT.
- [[smt-strategy]] — Parámetros de la estrategia SMT.
- [[order-flow-strategy]] — Parámetros de la estrategia de Order Flow.
- [[tradovate-api]] — Conector Tradovate.
- [[rithmic-rapi]] — Conector Rithmic.
- [[apex-topstep-leelo-blueguardian]] — Matriz de compliance para prop firms.
