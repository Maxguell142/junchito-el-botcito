---
title: "Referencia de estrategia Order Flow"
category: estrategias
tags: [order-flow, delta, cvd, footprint, absorption, imbalances, quantum-fx, estrategia, referencia]
last_updated: "2026-11-13"
sources: [raw/system-specifications.md]
doc_type: "estrategia_de_referencia"
status: "referencia"
summary: "Material de Order Flow y delta; consultar el código para conocer el soporte real."
---

# Referencia de estrategia Order Flow

> **Estado: referencia estratégica.** El análisis OHLCV no equivale a un feed de Order Flow o de profundidad de mercado.


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

## Parámetros en `fastapi_service/strategies.py`
- `min_delta_imbalance`: 150
- `min_rr_ratio`: 1.5
- `default_contracts`: 1
- `max_contracts`: 5

## Enlaces Relacionados
- [[documentacion/00_INICIO_OBSIDIAN|Índice Maestro de la Wiki]]
- [[documentacion/03_ARQUITECTURA_CONCEPTUAL]]
- [[documentacion/estrategias/referencia-estrategia-ict]]
- [[documentacion/estrategias/referencia-estrategia-smt]]
