---
title: Ventanas Operativas y Killzones de New York (EST)
category: concepts
tags: [killzones, ict, ny-session, est, timing, filters]
last_updated: 2026-10-16
sources: [raw/system-specifications.md, raw/cme-mnq-specifications.md]
---

# Ventanas Operativas y Killzones de New York (EST)

## La Importancia de la Delimitación Horaria en Futuros
En los futuros del Nasdaq (NQ / MNQ), la mayor parte del volumen institucional, la expansión de rango y el desplazamiento limpio ocurren durante las ventanas horarias de la sesión de Nueva York (Regular Trading Hours - RTH). Operar fuera de estos horarios suele implicar spreads más amplios, baja liquidez y alta probabilidad de consolidación errática (whipsaws).

## Implementación Técnica del Filtro Temporal
Cada instancia de `TradingBot` tiene un esquema de tiempo asignado:

```json
"schedule": {
  "start_time": "09:30",
  "end_time": "11:30",
  "timezone": "America/New_York"
}
```

En el método `is_within_schedule()`:
1. Se obtiene la hora actual localizada de forma precisa en el huso de Nueva York (`America/New_York`) usando `zoneinfo`.
2. Si la alerta de TradingView llega antes de `start_time` (ej. 09:15 EST) o después de `end_time` (ej. 11:45 EST), la señal se registra como `[FILTER]` y se descarta automáticamente, sin arriesgar capital.

## Killzones Institucionales Estandarizadas

| Sesión | Intervalo EST | Características de Mercado |
| :--- | :--- | :--- |
| **NY AM Killzone (Apertura)** | 09:30 - 11:30 | Mayor volumen diario. Sweeps de liquidez de Londres/Asia, formación del máximo o mínimo del día (High/Low of the Day). |
| **NY Lunch (Almuerzo)** | 11:30 - 13:30 | Caída de volumen, falsas rupturas. Los bots suelen configurarse en pausa o fin de sesión aquí. |
| **NY PM Killzone (Tarde)** | 13:30 - 16:00 | Continuación de tendencia o reversión previa al cierre de la sesión bursátil de Wall Street. |

## Enlaces Relacionados
- [[system-overview]]
- [[ict-strategy]]
- [[smt-strategy]]
