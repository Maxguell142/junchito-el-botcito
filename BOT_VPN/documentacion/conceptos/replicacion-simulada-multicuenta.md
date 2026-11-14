---
title: "Diseño de replicación simulada multicuenta"
category: conceptos
tags: [replication, accounts, pnl, mnq, futures, latency, quantum-fx, cuentas, simulacion, conceptual]
last_updated: "2026-11-13"
sources: [raw/system-specifications.md, raw/cme-mnq-specifications.md]
doc_type: "concepto_de_trading"
status: "conceptual"
summary: "Diseño de referencia sobre cuentas y PnL; no implica réplica de órdenes reales."
---

# Diseño de replicación simulada multicuenta

> **Estado: concepto de simulación.** No implica réplica de órdenes hacia brokers o cuentas externas.


## Mecánica de Replicación Paralela
Cuando un `TradingBot` recibe una señal aprobada por su estrategia (ej. `BUY 1 MNQ @ 18,250.00`), no ejecuta las cuentas en serie (lo que introduciría slippage o deslizamiento acumulativo en la segunda o tercera cuenta).

En su lugar, despacha la orden de forma concurrente utilizando `asyncio.gather`:

```python
tasks = [
    BrokerAdapter.execute_order(account, decision, self.proxy_connector)
    for account in self.accounts
]
results = await asyncio.gather(*tasks, return_exceptions=True)
```

Cada tarea utiliza el `ProxyConnector` individual del bot, asegurando que todas las cuentas asociadas a ese bot salgan por la misma IP dedicada a baja latencia (~15ms hacia los servidores de Chicago / CME).

## Nombres Personalizados por Cuenta
Para facilitar la supervisión humana en el Dashboard web, cada cuenta cuenta con el campo `custom_name`, permitiendo identificar claramente la procedencia o el titular de la cuenta:
- `"Apex 50k #1"`
- `"Cuenta 2 de Asia"`
- `"Topstep Express 50k"`
- `"Blue Guardian Principal"`

## Matemáticas del Contrato Micro E-mini Nasdaq-100 (MNQ)

El cálculo financiero se ejecuta en tiempo real según las especificaciones de CME Globex:
- **Puntos por Tick**: $0.25$ puntos.
- **Valor por Tick**: $\$0.50$ USD por contrato.
- **Valor por Punto**: $\$2.00$ USD por contrato ($4 \times \$0.50$).

### Cálculo de PnL Flotante (Unrealized PnL):
$$\text{PnL Flotante} = (\text{Precio Actual} - \text{Precio Entrada}) \times \$2.00 \times \text{Contratos} \quad (\text{para LONG})$$
$$\text{PnL Flotante} = (\text{Precio Entrada} - \text{Precio Actual}) \times \$2.00 \times \text{Contratos} \quad (\text{para SHORT})$$

### Control de Drawdown Máximo (Peak-to-Valley):
$$\text{Drawdown} = \text{Peak Net PnL} - \text{Current Net PnL}$$
Si el Drawdown acumulado se acerca al umbral crítico configurado en la cuenta (ej. $\$2,000$ o $\$2,500$ USD), el sistema registra alertas y habilita el botón de pánico `Cerrar Posiciones`.

## Enlaces Relacionados
- [[documentacion/00_INICIO_OBSIDIAN|Índice Maestro de la Wiki]]
- [[documentacion/03_ARQUITECTURA_CONCEPTUAL]]
- [[documentacion/reglas_de_fondeo/referencia-reglas-apex-topstep-leelo-blueguardian]]
- [[documentacion/conceptos/diseno-aislamiento-proxy-socks5]]
