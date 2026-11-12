---
title: Mapa del sistema, stack y salud
category: system
tags: [stack, health, frontend, backend, ai, obsidian]
last_updated: 2026-11-11
---

# Mapa del sistema, stack y salud

> Nota principal de referencia para Obsidian y asistentes de IA. Distingue lo que está instalado y ejecutándose de lo que solo aparece en planes o documentos de diseño. Para navegar el resto de la documentación, vuelve al [[index|Índice Maestro]].

## Resumen verificado

| Área | Tecnología actual | Estado |
| --- | --- | --- |
| Backend web principal | Node.js 22.13+ y Express 5 | Sirve la interfaz y la API en `http://127.0.0.1:3008`. |
| Backend alternativo | Python 3.10+, FastAPI, Pydantic y Uvicorn | Servicio separado y opcional en `http://127.0.0.1:8000`. |
| Frontend | HTML, CSS y JavaScript sin framework | Archivos locales en `public/`; Node sirve el panel principal. |
| Gráficos | TradingView Lightweight Charts 5.2.1 | Archivo local `public/lightweight-charts.standalone.production.js`. |
| Datos para gráficos | `src/marketData.js` (Node) | Consultas HTTP a Yahoo/Finnhub/Alpha Vantage y velas sintéticas de fallback; separado de los precios simulados de ejecución. |
| Tiempo real | WebSocket (`ws` en Node y soporte WebSocket de FastAPI) | Se usa para las funciones de telemetría implementadas por cada servidor. |
| Persistencia | SQLite | Node usa `node:sqlite`; Python usa `sqlite3`. Ambos apuntan a la misma base local. |
| IA de la aplicación | No hay proveedor ni modelo integrado | No se encontraron SDK de OpenAI, Anthropic, Gemini, Ollama u otro LLM en los manifiestos actuales. |
| IA para desarrollo y documentación | `AGENTS.md` y configuraciones en `.agents/` | Instrucciones y habilidades para asistentes; no son un motor de IA ejecutado por el servidor. |
| Wiki personal | Obsidian sobre esta carpeta del proyecto | El índice maestro está en `wiki/index.md`; esta nota es la referencia técnica principal. |

## Inventario por capa

### Backend Node.js

Fuente de dependencias: `package.json`.

| Tecnología o biblioteca | Versión declarada | Uso |
| --- | --- | --- |
| Node.js | `>=22.13` | Runtime requerido; incluye `node:sqlite`. |
| Express | `^5.3.0` | Servidor HTTP, API y archivos estáticos. |
| `ws` | `^8.22.0` | Servidor WebSocket. |
| Módulos nativos de Node | Incluidos con Node.js | HTTP, rutas, archivos, criptografía y SQLite (`node:sqlite`). |

Inicio: `npm start` o `.\run_server.ps1`. El panel principal se publica en el puerto 3008.

### Backend Python

Fuentes de dependencias: `requirements.txt` y `requirements-dev.txt`.

| Tecnología o biblioteca | Versión declarada | Uso |
| --- | --- | --- |
| FastAPI | `>=0.115,<1.0` | API HTTP y servicio separado. |
| Pydantic | `>=2.7,<3.0` | Modelos y validación de datos de la API. |
| Uvicorn | `>=0.30,<1.0` | Servidor ASGI. |
| aiohttp | `>=3.10,<4.0` | Cliente HTTP asíncrono usado por el motor Python. |
| aiohttp-socks | `>=0.9,<1.0` | Conector SOCKS para el motor Python. |
| httpx y pytest | `httpx>=0.27,<1.0`, `pytest>=8.0,<9.0` | Dependencias de desarrollo y pruebas. |
| Módulos estándar de Python | Incluidos con Python | Incluye `sqlite3`, `asyncio`, `logging`, `hmac` y `secrets`. |

Inicio: `npm run start:fastapi` o `.\run_fastapi.ps1`. FastAPI no inicia el panel Node.

### Frontend

- HTML en `public/index.html`, estilos en `public/style.css` y lógica en `public/app.js`.
- No se declara React, Vue, Angular, Svelte, TypeScript, bundler ni gestor de paquetes frontend.
- Lightweight Charts 5.2.1 se sirve desde un archivo local.
- Las fuentes Inter y JetBrains Mono se solicitan a Google Fonts; requieren conexión externa para cargarse.
- El navegador incluye su propio cliente WebSocket; Node usa el paquete `ws`.

### Datos y persistencia

- La base persistente es SQLite: Node accede con el módulo nativo `node:sqlite` y Python con `sqlite3`.
- Las migraciones están en `migrations/`; `BOT_VPN_DB_PATH` permite configurar la ruta compartida.
- Los dos servicios tienen APIs distintas, aunque compartan el archivo de base de datos. Un conflicto de revisión puede responder `409`; vuelve a cargar los datos antes de reintentar.

## IA y Obsidian

En este repositorio, “IA” describe el asistente que ayuda a desarrollar y mantener la wiki, no una función inteligente del producto en ejecución. La evidencia actual es:

- `AGENTS.md`: protocolo general para asistentes y mantenimiento de conocimiento.
- `.agents/rules/`: instrucciones adicionales para el agente.
- `.agents/skills/`: habilidades locales para asistentes compatibles.
- No hay cliente de LLM, clave de proveedor ni modelo configurado por `package.json` o los archivos `requirements*.txt`.

Para que un asistente trabaje con información fiable:

1. Empezar por esta nota y el [[index|índice de la wiki]].
2. Verificar versiones y capacidades en `package.json`, `requirements.txt`, el código y las pruebas antes de describirlas como activas.
3. Marcar cada función como **implementada**, **simulada**, **opcional** o **planificada**. No tratar los documentos de diseño como prueba de que una integración está funcionando.
4. No copiar secretos ni credenciales a la wiki. Las fuentes primarias de `raw/` no se editan.
5. Registrar cambios de conocimiento en [[log|la bitácora]] y actualizar los enlaces del índice cuando se agreguen documentos.

Obsidian usa `BOT_VPN/` como bóveda y su espacio de trabajo queda apuntando a `wiki/index.md`. Desde ese índice se accede a la arquitectura, la operación, el backlog, las estrategias y las fuentes.

## Estado funcional que no hay que confundir

- Node y FastAPI son servicios independientes; la interfaz principal se sirve con Node.
- La cuadrícula por bot consulta `/api/bot/:botId/candles` por HTTP y actualiza aproximadamente cada 60 segundos. El gráfico general usa `/api/market/candles`, que devuelve velas simuladas en memoria. No existe aquí un stream de precios de un broker.
- Finnhub y Alpha Vantage mapean MNQ/NQ a QQQ y ES a SPY: son precios de ETFs, no precios equivalentes de los futuros CME. Si falla una fuente, el conector puede generar velas sintéticas; la UI no hace suficientemente visible el proveedor efectivo. No uses esas series para ejecutar ni evaluar trades reales.
- El mapa `public/data/botSymbols.json` contiene asignaciones estáticas (`bot_1`/`bot_2`/`bot_3`) y usa MNQ como default; no obtiene necesariamente el instrumento configurado en la base para bots personalizados.
- El proveedor `synthetic` genera velas ficticias de forma explícita; los proveedores externos tienen timeout y la cuadrícula muestra el origen/fallback indicado por la API.
- Sus rutas y métodos no son totalmente intercambiables. Consulta [[README|README operativo]] antes de integrar un cliente con ambos.
- El modo de ejecución documentado y declarado por el código es `SIMULATED`. La consulta externa de velas para gráficos no cambia el precio simulado usado por órdenes y no se debe presentar como ejecución real con broker.
- Tradovate, Rithmic, reglas de prop firms y varias estrategias también aparecen en documentos de conocimiento; su documentación por sí sola no acredita una conexión o ejecución real.
- `GET /healthz` en cada servidor sirve como comprobación básica de disponibilidad, no como prueba de que cada función externa esté integrada.

## Comprobación local de salud

Ejecuta los comandos desde `BOT_VPN/` en PowerShell:

1. Comprueba runtimes: `node --version` (Node 22.13 o superior) y `python --version` (Python 3.10 o superior).
2. Instala dependencias si hace falta: `npm ci` y `python -m pip install -r requirements-dev.txt`.
3. Ejecuta las pruebas: `npm.cmd test`. El script corre `node --test` y luego `python -m pytest tests`.
4. Inicia el servidor principal con `npm.cmd start` y verifica `http://127.0.0.1:3008/healthz` y `http://127.0.0.1:3008/`.
5. Solo si necesitas probar el backend Python, inicia en otra terminal `npm.cmd run start:fastapi` y verifica `http://127.0.0.1:8000/healthz` y `/docs`.
6. Revisa los errores que impriman los procesos y el resultado de las pruebas. Un `healthz` exitoso solo confirma que responde el servidor.

Si la ejecución de `npm` en PowerShell está bloqueada por la política de scripts, usa `npm.cmd` como en los ejemplos; no hace falta cambiar esa política.

## Mapa de documentación

| Ubicación | Contenido |
| --- | --- |
| `wiki/` | Índice, arquitectura, bitácora, inventario del stack y documentación por tema. |
| `raw/` | Fuentes primarias; tratarlas como solo lectura. |
| `README.md` | Instalación, operación local y diferencias entre servicios. |
| `PENDIENTES_Y_MEJORAS.md` | Backlog priorizado. |
| `IMPLEMENTATION_PLAN.md` | Plan de trabajo y diseño futuro. |
| `AGENTS.md` y `.agents/` | Instrucciones de mantenimiento para asistentes de IA. |

Enlaces: [[index|Inicio de la wiki]] · [[system-overview|Arquitectura conceptual]] · [[README|Operación local]] · [[AGENTS|Guía para agentes]]
