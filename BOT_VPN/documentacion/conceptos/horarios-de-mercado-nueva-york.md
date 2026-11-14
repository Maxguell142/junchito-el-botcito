---
title: "Referencia de horarios de mercado de Nueva York"
category: conceptos
tags: [killzones, ict, ny-session, est, timing, filters, quantum-fx, horarios, mercado, referencia]
last_updated: "2026-11-13"
sources: [raw/system-specifications.md, raw/cme-mnq-specifications.md]
doc_type: "referencia_de_mercado"
status: "referencia"
summary: "Conceptos de sesiones y filtros horarios; verificar las reglas con la implementación."
---

# Referencia de horarios de mercado de Nueva York

> **Estado: referencia de mercado.** La documentación de horarios no confirma que todos estos filtros estén conectados al motor.


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
- [[documentacion/00_INICIO_OBSIDIAN|Índice Maestro de la Wiki]]
- [[documentacion/03_ARQUITECTURA_CONCEPTUAL]]
- [[documentacion/estrategias/referencia-estrategia-ict]]
- [[documentacion/estrategias/referencia-estrategia-smt]]
