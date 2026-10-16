---
title: Estrategia ICT (Inner Circle Trader) para MNQ
category: strategies
tags: [ict, fvg, mss, killzones, scalping, mnq]
last_updated: 2026-10-16
sources: [raw/system-specifications.md, raw/tradingview-webhook-guide.md]
---

# Estrategia ICT (Inner Circle Trader) para MNQ

## Fundamento Conceptual
La estrategia **ICT** se basa en la identificación de la huella algorítmica institucional (IPDA - Interbank Price Delivery Algorithm). Busca momentos donde el precio barre liquidez previa (Buy-side o Sell-side Liquidity) y genera un desplazamiento violento con desbalance de órdenes.

## Componentes Técnicos de Validación

1. **Liquidity Sweep (Toma de Liquidez)**: El precio penetra un máximo o mínimo clave (ej. Asian Session High/Low, Previous Day High/Low).
2. **Market Structure Shift (MSS)**: Ruptura estructural con desplazamiento y cierre de vela con cuerpo (desplazamiento con intención).
3. **Fair Value Gap (FVG)**: Formación de un desbalance de tres velas donde la mecha de la vela 1 y la vela 3 no se solapan. La entrada se busca en el retest del FVG (Consequent Encroachment / 50%).
4. **Filtro de Ratio Riesgo / Beneficio**: Exige un mínimo de $1:2.0$ de R:R.
5. **Máximo Stop Loss Permitido**: 25 puntos de MNQ ($50 USD por contrato) para proteger el trailing drawdown de cuentas de evaluación de prop firms.

```mermaid
sequenceDiagram
    participant M as Mercado (MNQ)
    participant TV as Indicador TradingView
    participant B as Bot (ICTStrategy)
    participant A as Cuentas Tradovate/Rithmic

    M->>TV: Liquidity Sweep + MSS + FVG en Killzone NY AM
    TV->>B: Webhook POST {"action":"BUY","price":18250,"sl":18235,"tp":18280}
    B->>B: Valida R:R (1:2.0) y Horario (09:30-11:30 EST)
    B->>A: Replicación simultánea vía SOCKS5 Proxy
    A-->>B: Órdenes llenadas a 15ms de latencia
```

## Parámetros Configurables en `strategies.py`
- `min_rr_ratio`: 2.0 (por defecto)
- `max_stop_loss_points`: 25.0
- `min_stop_loss_points`: 6.0
- `default_contracts`: 1
- `max_contracts`: 4

## Enlaces Relacionados
- [[system-overview]]
- [[new-york-killzones-and-time-filters]]
- [[smt-strategy]]
- [[apex-topstep-leelo-blueguardian]]
