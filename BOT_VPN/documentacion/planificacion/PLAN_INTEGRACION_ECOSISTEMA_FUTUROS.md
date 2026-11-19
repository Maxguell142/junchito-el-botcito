---
title: "Propuesta de integración del ecosistema NQ/MNQ"
doc_type: "propuesta_de_integracion"
status: "planificado"
summary: "Propuesta pendiente de verificación e implementación; separa funciones existentes, brechas de seguridad y componentes no aprobados."
tags: [quantum-fx, futuros, mnq, nq, tradingview, webhooks, gate-engine, anti-hedging, codex, obsidian, prop-firm]
last_updated: "2026-11-18"
---

# Propuesta de integración del ecosistema de futuros NQ/MNQ

> **Estado de auditoría — 18 de noviembre de 2026:** esta nota contiene propuestas del usuario, no un informe de implementación ni una validación de repositorios. El código y las pruebas son la fuente de verdad. El motor Node actual solo simula operaciones y escucha en `127.0.0.1`; no tiene un conector de broker.
>
> **Límites de esta propuesta:** no implementar retardos, proxies, separación de identidades u otras técnicas destinadas a ocultar órdenes copiadas o eludir controles de brokers/firmas. No publicar el servidor local en Internet. Las credenciales de broker no se guardan ni se usan para conectarse; una cuenta registrada debe permanecer `NOT_CONFIGURED`.

### Resultado de contraste con el código actual

| Tema | Estado comprobado |
| --- | --- |
| Webhook Node | Existe en `/api/webhook`; antes de esta auditoría aceptaba solicitudes sin sesión ni validar el token del panel. Se agregó validación de `QUANTUM_WEBHOOK_SECRET` para las pruebas locales. |
| Entrada desde TradingView en la nube | No disponible directamente: Express escucha en loopback `127.0.0.1`. No hay relay público. |
| Operaciones | Se actualizan posiciones simuladas; no se envían órdenes a Tradovate, Rithmic ni NinjaTrader. |
| Gate Engine | El filtro de apertura NY existe. El filtro de noticias depende de `macro_event_active`; no se comprobó un feed que lo alimente. |
| Tamaño MNQ | Había auto-sizing basado en parámetros del bot. Se agregó al webhook validación de SL/TP y R:R, y rechazo si el presupuesto no alcanza un contrato. |
| Credenciales | La contraseña recibida no se persiste ni se usa; el estado ya no se presenta como conectado. No existe sesión de broker activa. |
| Anti-hedging | Hay un bloqueo de posiciones opuestas entre bots con el mismo titular, como regla de riesgo local. No demuestra cumplimiento normativo de ninguna firma. |
| Jitter anti-detección | No era una demora ejecutada: era un ajuste/indicador que afirmaba prevención de detección. Se retiró de la interfaz y no se implementa. |
| Repositorios citados | Son candidatos mencionados en esta propuesta; sus licencias, existencia, estado y código no están verificados aquí ni se incorporaron como dependencias. |

Las respuestas de los endpoints simulados no constituyen evidencia de una ejecución financiera real.

---

## 1. Contexto del Proyecto y Arquitectura General

QUANTUM FX es una aplicación local para organizar bots y cuentas y revisar resultados simulados. Las firmas y brokers mencionados en este documento son contexto de referencia, no integraciones comprobadas.

La propuesta se limita a controles de riesgo transparentes en simulación. La identidad se usa para asociar registros y aplicar controles de exposición dentro de la aplicación; no debe emplearse para ocultar control común ni para afirmar cumplimiento de reglas externas.

```
                    ┌────────────────────────────────────────┐
                    │    TradingView Alerts (Pine Script)    │
                    │   Alerta JSON con Ticker, SL, TP, RR   │
                    └───────────────────┬────────────────────┘
                                        │ (HTTP POST /api/webhook)
                                        ▼
    ┌────────────────────────────────────────────────────────────────────────┐
    │                 QUANTUM FX Core Hub (Node.js :3008)                    │
    ├────────────────────────────────────────────────────────────────────────┤
    │  1. Gate Engine (Decidido por Usuario):                                │
    │     ├── Filtro Apertura Wall Street (09:30 - 09:45 EST)               │
    │     └── Pausa en Noticias Rojas (CPI, FOMC, NFP)                       │
    ├────────────────────────────────────────────────────────────────────────┤
    │  2. Validador Anti-Hedging KYC:                                        │
    │     └── ¿El titular ya posee cuentas en sentido opuesto?               │
    │         ├── SÍ  ──> [HTTP 409 CONFLICT] Bloqueo inmediato & Alerta     │
    │         └── NO  ──> Continúa al motor de riesgo                        │
    ├────────────────────────────────────────────────────────────────────────┤
    │  3. Calculadora de Riesgo & Dimensionamiento Automático MNQ:           │
    │     ├── Sizing = Floor(Riesgo USD / (SL Puntos * $2.00))               │
    │     └── Validación Matemática R:R (>= 1:2 o 1:3)                       │
    └───────────────────────────────────┬────────────────────────────────────┘
                                        │
         ┌──────────────────────────────┴──────────────────────────────┐
         ▼                                                             ▼
┌─────────────────────────────────┐           ┌─────────────────────────────────┐
│ Bot A: titular asignado         │           │ Bot B: titular asignado        │
├─────────────────────────────────┤           ├─────────────────────────────────┤
│ Cuenta 1: Apex 50k PA -> BUY 2c │           │ Cuenta 1: Leelo 50k PA -> SELL  │
│ Cuenta 2: Topstep PA  -> BUY 2c │           │ (PERMITIDO: Distinto Titular)   │
│ Operación solo simulada         │           │ Operación solo simulada        │
└─────────────────────────────────┘           └─────────────────────────────────┘
```

---

## 2. Repositorios candidatos pendientes de revisión

Los nombres que siguen fueron propuestos como referencias. No se verificaron sus repositorios, mantenimiento, licencias, seguridad ni compatibilidad; no se instaló código de ellos. Revisar cada fuente primaria antes de tomar decisiones o incorporarla.

### 2.1. Bots y Sistemas Algorítmicos Específicos para NQ / MNQ
- **`michael-abdo/nq-futures-trading`:**
  - *Qué resuelve:* Sistema algorítmico modular para el Nasdaq-100 con arquitectura de compuertas (**Gate/Flag Engine**).
  - *Qué tomamos para QUANTUM FX:* La lógica de compuertas condicionales para validar horario de sesión (evitar apertura de 09:30 a 09:45 EST), zonas de liquidez y filtros de noticias macroeconómicas antes de habilitar el disparo de órdenes.
- **`stefandevelops/nq-prop-trading`:**
  - *Qué resuelve:* Toolkit diseñado expresamente para superar evaluaciones de firmas de fondeo operando NQ y MNQ mediante flujo de órdenes (*Order Flow*).
  - *Qué tomamos para QUANTUM FX:* El modelado de reglas de consistencia de prop firms (evitar superar el 30% del profit en un solo día, control de Trailing Max Drawdown y límites de pérdida diaria).
- **`nautechsystems/nautilus_trader`:**
  - *Qué resuelve:* Motor open-source institucional de grado producción en Rust y Python con paridad exacta tick-by-tick y manejo nativo de contratos CME (MNQ, NQ, MES, ES).
  - *Qué tomamos para QUANTUM FX:* Estructura de eventos para ejecución asíncrona de baja latencia y normalización de contratos trimestrales (H, M, U, Z).
- **Temas Clave en GitHub:** `github.com/topics/nq`, `github.com/topics/order-flow-trading`, `github.com/topics/prop-firm`.

### 2.2. Conectores y Puentes de Ejecución (TradingView / Python → Broker)
- **`FiredgeIO/FiredgeIO`:**
  - *Qué resuelve:* Servidor receptor de webhooks en Python que escucha alertas JSON (desde TradingView o scripts), envía órdenes a la API REST/WebSocket de Tradovate, calcula Stop Loss automáticamente y notifica a Telegram.
  - *Qué tomamos para QUANTUM FX:* El formato de payload de TradingView y la lógica de autenticación OAuth y renovación de tokens contra el entorno de Tradovate.
- **Wrappers `tradovate-api` (Python y TypeScript):**
  - *Qué resuelve:* Clientes de conexión directa con Tradovate para cotizaciones en tiempo real del MNQ y colocación de órdenes bracket (OCO: Stop Loss + Take Profit vinculados).
- **`roydufek/traderouter`:**
  - *Qué resuelve:* Puente de baja latencia para inyectar webhooks de TradingView en NinjaTrader 8 mediante NinjaScript (C#) con capacidad de copia multi-cuenta (*fan-out trade copying*).
  - *Qué tomamos para QUANTUM FX:* El patrón de distribución *fan-out* con retardo estocástico entre subcuentas.
- **`rithmic-api` / `pyrithmic`:**
  - *Qué resuelve:* Conexión directa mediante Protocol Buffers (WebSockets binarios) a los servidores de Rithmic (R|API+ Chicago: Order Plant y Ticker Plant), lectura de profundidad Level 2 (DOM) sin necesidad de GUI abierta.
- **`atas-indicators` / `ATAS-API`:**
  - *Qué resuelve:* Algoritmos en C# (.NET) para Cumulative Volume Delta (CVD), Big Trades y absorción de liquidez institucional.

### 2.3. Smart Money Concepts (ICT / SMC) y Datos Tick-by-Tick
- **`joshyattridge/smart-money-concepts` (librería `smartmoneyconcepts`):**
  - *Qué resuelve:* Detección algorítmica sobre DataFrames de Fair Value Gaps (FVG), Swing Highs/Lows, Break of Structure (BOS), Change of Character (CHoCH) y Order Blocks (OB).
  - *Qué tomamos para QUANTUM FX:* El motor de análisis técnico institucional en `src/server/market_analysis.js` para detectar desequilibrios en velas de 1m, 5m y 15m durante la Killzone de Nueva York.
- **`william05c/NQ-EQ-indicator`:**
  - *Qué resuelve:* Indicador calibrado con más de una década de datos históricos del Nasdaq para estimar rangos de expansión diaria y niveles de equilibrio (EQ).
- **`databento/databento-python`:**
  - *Qué resuelve:* Streaming y descarga de datos oficiales CME Market by Order (MBO) y Depth MBP-10.
- **`footprint-chart` / `orderbook-imbalance`:**
  - *Qué resuelve:* Agrupación de ticks por nivel de precio para calcular el Delta acumulado e identificar órdenes iceberg institucionales.

### 2.4. Gestión de Riesgo, Copiers y Dashboards
- **`jeremynahim99/prop-firm-position-size-calculator`:**
  - *Qué resuelve:* Calculadora matemática para contratos MNQ (\$2 por punto / \$0.50 por tick) adaptada a reglas de Trailing Drawdown y Daily Loss Limit (DLL).
  - *Qué tomamos para QUANTUM FX:* La fórmula de dimensionamiento automático integrada en el Core de ejecución.
- **`tradingview/lightweight-charts`:**
  - *Qué resuelve:* Motor gráfico ultraligero en Canvas a 60 FPS desarrollado por TradingView.
  - *Qué tomamos para QUANTUM FX:* La visualización interactiva de gráficos CME MNQ en `public/index.html` con marcadores de ejecución en tiempo real.

---

## 3. Justificación Arquitectónica de los Cambios (Para Codex)

Para que cualquier desarrollador o agente comprenda por qué el código fue estructurado de esta manera, se documentan las razones operativas y normativas:

### 3.1. TradingView Webhook como Hub Principal de la Aplicación
- **Motivación:** En lugar de obligar al usuario a programar en el lenguaje específico de cada broker (NinjaScript C#, Tradovate JS SDK o Python), TradingView Pine Script v5 es el estándar universal de análisis técnico y algorítmico.
- **Estado actual:** Node expone un endpoint local de simulación en `/api/webhook`. Requiere `QUANTUM_WEBHOOK_SECRET` y escucha solo en `127.0.0.1`; no recibe directamente alertas alojadas en la nube ni envía órdenes a cuentas externas.

### 3.2. Gate Engine Decidido 100% por el Usuario (No Hardcoded)
- **Motivación:** En una versión preliminar se contemplaba bloquear obligatoriamente la operativa entre 09:30 y 09:45 EST (apertura de Wall Street) y durante noticias macroeconómicas rojas (CPI, FOMC, NFP). Sin embargo, **las reglas varían radicalmente según la empresa y la estrategia**:
  - Firmas como *Leelo Trading* permiten expresamente operar durante eventos macroeconómicos en fase de evaluación.
  - Estrategias de *Open Breakout* o *Silver Bullet 09:30* operan precisamente la volatilidad de la apertura de Nueva York.
- **Estado actual:** El filtro de apertura NY se puede configurar por bot. El de noticias depende de `macro_event_active`; no se verificó un proveedor que alimente esa propiedad. Ambos son controles simulados y deben contrastarse con reglas vigentes de la firma.

### 3.3. Ratio Riesgo:Beneficio (R:R) 1:2 o 1:3 y Dimensionamiento Automático
- **Motivación:** En los futuros del Nasdaq, operar con ratios inferiores a 1:2 condena la cuenta en prop firms debido a las comisiones (\$1.04 por contrato vuelta completa) y el Trailing Drawdown.
- **Parámetros del Microcontrato CME MNQ:**
  $$\text{Valor por punto} = \$2.00 \text{ USD} \qquad | \qquad \text{Valor por tick (0.25 pts)} = \$0.50 \text{ USD}$$
- **Fórmula de Dimensionamiento Automático:**
  $$\text{Contratos} = \left\lfloor \frac{\text{Riesgo Máximo por Trade (USD)}}{\text{Stop Loss en Puntos} \times \$2.00} \right\rfloor$$

  Si el resultado es menor que uno, se rechaza la operación simulada en vez de forzar un contrato por encima del riesgo configurado.
- **Verificación:** Si el usuario configura un ratio de 1:2 con un Stop Loss de 15 puntos (\$30/cto), el Take Profit se fija en al menos 30 puntos (\$60/cto). Si selecciona 1:3, el TP mínimo es de 45 puntos (\$90/cto).

### 3.4. Ingreso Estructurado de Credenciales de Cuentas Prop Firm
- **Estado actual:** Se registra el ID y, opcionalmente, el login enmascarado para identificar la cuenta. No se solicita ni persiste contraseña; la cuenta permanece `NOT_CONFIGURED` porque no hay conector de broker. No añadir campos de contraseña hasta definir un almacén seguro y una integración real.

### 3.5. Control local de exposición por titular
- El servidor simulado bloquea con HTTP `409` una posición opuesta entre bots vinculados al mismo titular.
- Este control solo compara el estado local de la simulación; no consulta brokers, cuentas externas, titularidad legal ni reglas actuales de las firmas.
- No se debe inferir que posiciones opuestas bajo titulares distintos sean legales, aceptables o invisibles a una firma. La aplicación no decide eso.
- No se implementa copia de órdenes a broker ni retardo para modificar señales de detección.

---

## 4. Contratos de Datos y Especificación de Endpoints

### 4.1. Webhook local de simulación (`POST /api/webhook`)
Endpoint Node limitado a loopback. Requiere `QUANTUM_WEBHOOK_SECRET` de 32 caracteres aleatorios como mínimo y el mismo token en el payload. TradingView Cloud no puede llamar a `127.0.0.1`; no se incluye un relay público ni una integración real:

```json
// Request Payload:
{
  "token": "<SECRETO_LOCAL_DE_PRUEBA>",
  "ticker": "MNQ",
  "action": "BUY",
  "contracts": 1,
  "price": 18450.25,
  "stop_loss_points": 15.0,
  "take_profit_points": 30.0,
  "min_rr": 2.0,
  "bot_id": "bot_1"
}

// Success Response (200 OK):
{
  "status": "OK",
  "message": "Alerta procesada con éxito para MNQ ICT Scalper",
  "bot_id": "bot_1",
  "side": "BUY",
  "contracts": 2,
  "price": 18450.25,
  "accounts_executed": 2
}

// Bloqueo local de exposición simulada (409 Conflict):
{
  "status": "BLOCKED",
  "anti_hedging_blocked": true,
  "detail": "Control de exposición: el titular tiene una posición opuesta abierta; la operación simulada fue bloqueada por la regla configurada.",
  "identity": "Carlos Mendoza",
  "opposing_position": "LONG",
  "opposing_account": "Apex 50k PA #1"
}

// Gate Engine Blocked Response (422 Unprocessable Entity):
{
  "status": "BLOCKED",
  "gate_engine_blocked": true,
  "reason": "Apertura volátil de Wall Street (09:30 - 09:45 EST)",
  "code": "GATE_NY_OPEN"
}
```

### 4.2. Registro de metadatos de cuenta (`POST /api/bots/:id/accounts`)

```json
// Request Payload:
{
  "account_id": "LFF025-51C65NOS-PRO001",
  "custom_name": "Leelo 50k PA #1",
  "prop_firm": "Leelo Trading",
  "broker": "Tradovate",
  "environment": "FUNDED_PA",
  "username": "<LOGIN_DE_REFERENCIA>",
  "balance": 50000,
  "max_contracts": 3,
  "daily_loss_limit": 1000
}

// Response (200 OK - cuenta sin conexión):
{
  "message": "Cuenta agregada con éxito",
  "account": {
    "id": "LFF025-51C65NOS-PRO001",
    "custom_name": "Leelo 50k PA #1",
    "prop_firm": "Leelo Trading",
    "broker": "Tradovate",
    "environment": "FUNDED_PA",
    "username": "••••",
    "password_masked": "",
    "password": "",
    "balance": 50000,
    "max_contracts": 3,
    "daily_loss_limit": 1000,
    "status": "NOT_CONFIGURED"
  }
}
```

### 4.3. Configuración y Edición de Bots (`POST /api/bots` y `PUT /api/bots/:id`)

```json
// Request Payload:
{
  "name": "Carlos MNQ Scalper",
  "identity_id": "ident_carlos",
  "strategy": "ICTStrategy",
  "block_ny_open": false,       // Gate Engine: Apertura NY (decidido por usuario)
  "block_red_news": false,      // Gate Engine: Noticias rojas (decidido por usuario)
  "min_rr_ratio": 2.0,          // Ratio R:R (1:2, 1:3, etc.)
  "auto_position_sizing": true, // Sizing dinámico en contratos MNQ
  "risk_per_trade_usd": 150.0,  // Riesgo por operación en USD
  "stop_loss_points": 15.0,     // Puntos de Stop Loss base
  "consistency_target": 1500.0, // Meta de profit para auto-pausa de consistencia
  "daily_loss_limit": 1000.0    // DLL Circuit Breaker
}
```

---

## 5. Reglas para mantener esta propuesta útil

- No copiar fragmentos de código como si fueran el estado vigente. Consulta `src/server/server.js`, las pruebas y [[documentacion/02_ESTADO_TECNICO_Y_SALUD]].
- Mantener la diferencia entre operación simulada, datos externos para gráficos, función opcional y plan futuro.
- No integrar librerías de referencia sin comprobar licencia, mantenimiento, seguridad y necesidad.
- Para una conexión real futura se requeriría diseño, autenticación propia del proveedor, gestión segura de credenciales, confirmaciones de órdenes, límites de exposición, manejo de fallos y revisión legal/contractual antes de activarla.

---

## 6. Guía de verificación

Las pruebas locales cubren flujos simulados. No prueban brokers, precios CME en vivo, políticas de empresas de fondeo ni órdenes reales:

1. **`tests/node/anti_hedging_and_credentials.test.js`:**
   - Comprueba el control simulado de exposición por titular y rechaza webhooks sin token válido.
   - Verifica el bloqueo Anti-Hedging (409 Conflict) cuando un mismo titular intenta abrir posiciones opuestas.
   - Valida el endpoint `/api/webhook` con alertas de cierre simuladas y bloqueo de hedging dentro de la simulación.
2. **`tests/node/server.test.js`:**
   - Valida que las contraseñas de broker se rechacen cuando no hay conector, además de sesiones y sanitización.
   - Comprueba el control de sesiones y tokens.
3. **`tests/node/marketData.test.js` y `market_analysis.test.js`:**
   - Valida la generación y cálculo de velas OHLCV, desequilibrios FVG y Killzones de Nueva York.

### Comandos de Ejecución:
```bash
# Ejecutar todas las pruebas del servidor Node.js
node --test tests/node/*.test.js

# Verificar integridad de enlaces y notas de la bóveda Obsidian
node scripts/check-obsidian-links.js
```

---

## 7. Documentos Relacionados en la Bóveda Obsidian

- [[documentacion/00_INICIO_OBSIDIAN|Inicio de la documentación]]
- [[documentacion/01_MAPA_DEL_PROYECTO|Mapa del proyecto y rutas]]
- [[documentacion/02_ESTADO_TECNICO_Y_SALUD|Estado técnico verificado]]
- [[documentacion/planificacion/PLAN_DE_IMPLEMENTACION|Plan general de implementación]]
- [[documentacion/planificacion/TAREAS_PENDIENTES_QUANTUM_FX|Tareas pendientes del proyecto]]
- [[documentacion/conceptos/replicacion-simulada-multicuenta|Replicación multicuenta y mitigación de mirroring]]
- [[documentacion/conceptos/horarios-de-mercado-nueva-york|Horarios de mercado y sesiones de Nueva York]]
- [[documentacion/integraciones/estado-tradovate-api|Integración técnica de Tradovate API]]
