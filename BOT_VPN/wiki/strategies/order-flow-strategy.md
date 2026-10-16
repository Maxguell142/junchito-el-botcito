---
title: Estrategia de Order Flow y Delta Institucional para MNQ
category: strategies
tags: [order-flow, delta, cvd, footprint, absorption, imbalances]
last_updated: 2026-10-16
sources: [raw/system-specifications.md]
---

# Estrategia de Order Flow y Delta Institucional para MNQ

## Microestructura del Libro de Órdenes y Teoría de Subasta
El precio en los futuros de CME se desplaza únicamente cuando las órdenes agresivas a mercado consumen la liquidez disponible de las órdenes pasivas limitadas (Bid/Ask).

La estrategia **Order Flow** analiza:
1. **Delta de Volumen**: Diferencia neta entre el volumen comprado al Ask y el volumen vendido al Bid dentro de una vela o nivel de precio.
2. **CVD (Cumulative Volume Delta)**: Tendencia acumulativa de las compras/ventas agresivas.
3. **Absorción Institucional**: Grandes bloques de órdenes pasivas limitadas absorbiendo las órdenes agresivas del público minorista en zonas de soporte o resistencia.

## Lógica de Validación en `OrderFlowStrategy`
- Se evalúa el campo `delta` recibido desde las alertas de TradingView o plataformas como Bookmap/Sierra Chart.
- Se requiere un desbalance neto mínimo de al menos **150 contratos** (`min_delta_imbalance`) para validar agresión genuina de fondos cuantitativos.
- R:R mínimo de $1:1.5$.
- Permite escalado de posición de hasta 5 contratos MNQ si la absorción es confirmada.

## Parámetros en `strategies.py`
- `min_delta_imbalance`: 150
- `min_rr_ratio`: 1.5
- `default_contracts`: 1
- `max_contracts`: 5

## Enlaces Relacionados
- [[system-overview]]
- [[ict-strategy]]
- [[smt-strategy]]
