---
title: Guía de Cumplimiento y Gestión de Riesgo para Prop Firms
category: prop-firms
tags: [prop-firms, apex, topstep, leelo, blue-guardian, risk-management, drawdown]
last_updated: 2026-10-16
sources: [raw/prop-firms-comparison.md, raw/system-specifications.md]
---

# Guía de Cumplimiento y Gestión de Riesgo para Prop Firms

## Panorama de Firmas Soportadas

Esta plataforma ha sido diseñada para operar simultáneamente sobre cuatro de las empresas de fondeo más exigentes de la industria de futuros:

### 1. Apex Trader Funding
- **Broker / Conector**: Tradovate y Rithmic.
- **Riesgo Crítico**: Trailing Drawdown calculado **al tick intradía** (Live Trailing). Si una posición en MNQ sube \$800 y luego retrocede a \$200, el drawdown se ajusta al pico más alto alcanzado en la vela.
- **Estrategia Recomendada**: Scalping rápido con take profit fijo en $1:2.0$ (ICTStrategy) para evitar retrocesos que eleven artificialmente el trailing stop.

### 2. Topstep
- **Broker / Conector**: Tradovate.
- **Riesgo Crítico**: Drawdown calculado al **Fin del Día (End of Day - EOD)**. Permite aguantar retrocesos durante la sesión sin que el umbral se mueva hasta el cierre diario a las 17:00 EST.
- **Estrategia Recomendada**: SMTStrategy o Swing Intradía dentro de Killzones.

### 3. Leelo Trading
- **Broker / Conector**: Rithmic.
- **Riesgo Crítico**: Trailing basado en balance cerrado / balance pico según el programa (Express vs Performance).

### 4. Blue Guardian (Futures)
- **Broker / Conector**: Tradovate.
- **Riesgo Crítico**: Límite de pérdida diaria estricto y regla de consistencia.

## Matriz de Parámetros de Riesgo por Bot en QUANTUM FX

Para evitar violar el drawdown de las firmas:
1. **Dimensionamiento en Micro Futuros**: Se opera exclusivamente **MNQ** ($2.00 por punto), permitiendo arriesgar entre \$20 y \$50 USD por trade, en contraste con el contrato grande NQ ($20.00 por punto) que arriesgaría \$200 a \$500 por trade con el mismo stop.
2. **Cierre Automático de Emergencia**: El botón `Cerrar Posiciones` en el Dashboard permite aplanar todas las cuentas de un bot en menos de 30 milisegundos si las condiciones macroeconómicas (ej. datos de CPI o FOMC) provocan volatilidad desmedida.
3. **Consistencia de IP**: Cada bot mantiene su sesión fija mediante SOCKS5, evitando que las firmas invaliden la cuenta por detección de accesos no autorizados concurrentes.

## Enlaces Relacionados
- [[system-overview]]
- [[socket-level-proxy-isolation]]
- [[multi-account-order-replication]]
- [[ict-strategy]]
