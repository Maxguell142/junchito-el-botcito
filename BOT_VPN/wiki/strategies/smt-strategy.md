---
title: Estrategia SMT (Smart Money Tool / Divergence) para MNQ
category: strategies
tags: [smt, divergence, correlated-assets, es, nq, ym, reversal]
last_updated: 2026-10-16
sources: [raw/system-specifications.md]
---

# Estrategia SMT (Smart Money Tool / Divergence) para MNQ

## Principio de Divergencia Intermercado
Los índices bursátiles de EE.UU. (Nasdaq-100 / NQ, S&P 500 / ES, Dow Jones / YM) están altamente correlacionados. En condiciones de mercado simétricas, ambos índices deberían registrar máximos más altos o mínimos más bajos simultáneamente.

Una **Divergencia SMT** ocurre cuando uno de los activos forma un nuevo extremo relativo mientras el activo correlacionado no logra confirmarlo:
- **SMT Bajista**: NQ marca un nuevo máximo superior (Higher High), pero ES marca un máximo inferior (Lower High). Esto revela debilidad oculta y acumulación de órdenes de venta institucionales en NQ.
- **SMT Alcista**: NQ marca un nuevo mínimo inferior (Lower Low), pero ES marca un mínimo superior (Higher Low). Indica absorción de ventas y reversión alcista inminente.

## Lógica de Validación en `SMTStrategy`
1. Recepción del indicador booleano `smt_divergence: true` en el payload JSON de TradingView.
2. Identificación del índice correlacionado (`correlated_index: "ES"` por defecto).
3. Verificación de R:R mínimo de $1:1.8$.
4. Dimensionamiento de riesgo calibrado para 1 a 3 contratos MNQ.

## Parámetros en `strategies.py`
- `min_rr_ratio`: 1.8
- `max_stop_loss_points`: 20.0
- `default_contracts`: 1
- `max_contracts`: 3
- `correlated_index`: "ES"

## Enlaces Relacionados
- [[system-overview]]
- [[ict-strategy]]
- [[order-flow-strategy]]
