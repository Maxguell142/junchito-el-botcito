---
title: "Mapa de carpetas y conexiones de QUANTUM FX"
doc_type: "mapa_de_codigo"
status: "vigente"
summary: "Ubicación de servicios, interfaz, persistencia, pruebas y relaciones."
tags: [quantum-fx, arquitectura, carpetas, rutas, conexiones]
last_updated: "2026-11-13"
---

# Mapa de carpetas y conexiones de QUANTUM FX

La raíz del proyecto es `BOT_VPN/`. También es la bóveda de Obsidian. La aplicación tiene un servidor principal Node, un servicio Python opcional y una interfaz web; ambos servidores usan SQLite, pero mantienen APIs distintas.

## Mapa de la raíz

```text
BOT_VPN/
├── README.md                         # guía principal para instalar y abrir la app
├── AGENTS.md                         # reglas breves para cambios de código
├── package.json / package-lock.json  # comandos y dependencias de Node/Electron
├── public/                           # dashboard web y recursos
├── src/
│   ├── server/                       # servidor Express, SQLite y análisis CSV
│   └── marketData.js                 # velas para gráficos
├── desktop/                          # ventana y arranque de Electron
├── fastapi_service/                  # servicio Python opcional
├── migrations/                       # esquema y cambios de SQLite
├── tests/
│   ├── node/                         # pruebas de Node
│   └── python/                       # pruebas de FastAPI
├── scripts/                          # utilidades de mantenimiento
├── documentacion/                    # guía Obsidian, estado, conceptos y plan
├── raw/                              # fuentes originales de solo lectura
└── .obsidian/                        # ajustes de Obsidian; abre 00_INICIO_OBSIDIAN.md
```

## Cómo se conecta la aplicación

- **Inicio web:** `npm start` → [`src/server/server.js`](../src/server/server.js) → sirve [`public/index.html`](../public/index.html) y su API local en el puerto 3008.
- **Persistencia Node:** `src/server/database.js` → SQLite local y [`migrations/`](../migrations/001_initial.sql).
- **Análisis histórico:** `src/server/market_analysis.js` procesa CSV; no es un feed de mercado en vivo.
- **Gráficos:** `src/marketData.js` consulta proveedores externos o usa velas sintéticas; no alimenta el precio de ejecución simulado.
- **Escritorio:** [`desktop/main.js`](../desktop/main.js) crea la ventana Electron y arranca el servidor Node. Usa cifrado de Windows para los datos personales.
- **Servicio opcional:** `npm run start:fastapi` → [`fastapi_service/main.py`](../fastapi_service/main.py). Sus endpoints no son equivalentes a los de Node.
- **Base compartida:** ambos servicios usan la misma SQLite por defecto o `BOT_VPN_DB_PATH` si se configura igual en los dos.

## Guías relacionadas

- [README principal](../README.md): instalación y uso.
- [[documentacion/02_ESTADO_TECNICO_Y_SALUD]]: hechos comprobados y limitaciones.
- [[documentacion/03_ARQUITECTURA_CONCEPTUAL]]: diseño de referencia.
- [[documentacion/planificacion/TAREAS_PENDIENTES_QUANTUM_FX]]: mejoras pendientes.
- [[documentacion/FUENTES_PRIMARIAS_Y_CATALOGO]]: material original preservado.
- [[documentacion/00_INICIO_OBSIDIAN]]: inicio de Obsidian.
