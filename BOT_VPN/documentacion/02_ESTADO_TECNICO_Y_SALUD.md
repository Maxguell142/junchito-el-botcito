---
title: "Estado técnico verificado y salud"
category: sistema
tags: [stack, health, frontend, backend, ai, obsidian, quantum-fx, estado, verificacion, salud]
last_updated: "2026-11-19"
doc_type: "estado_tecnico"
status: "verificado"
summary: "Inventario de tecnologías y capacidades comprobadas, con límites conocidos."
---

# Estado técnico verificado y salud

> Nota principal de referencia para Obsidian y asistentes de IA. Distingue lo que está instalado y ejecutándose de lo que solo aparece en planes o documentos de diseño. Para navegar el resto de la documentación, vuelve al [[documentacion/00_INICIO_OBSIDIAN|Índice Maestro]].

## Resumen verificado

| Área | Tecnología actual | Estado |
| --- | --- | --- |
| Backend web principal | Node.js 22.13+ y Express 5 | `src/server/server.js` sirve la interfaz y la API en `http://127.0.0.1:3008`. |
| App de escritorio | Electron 45 y NSIS x64 | Inicia el servidor Node en una ventana de escritorio; la app instalada incluye runtime y guarda SQLite en el perfil de Windows. |
| Backend alternativo | Python 3.10+, FastAPI, Pydantic y Uvicorn | Código en `fastapi_service/`; servicio separado y opcional en `http://127.0.0.1:8000`. |
| Frontend | HTML, CSS y JavaScript sin framework | Archivos locales en `public/`; Node sirve el panel principal. |
| Gráficos | TradingView Lightweight Charts 5.2.1 | Archivo local `public/lightweight-charts.standalone.production.js`. |
| Análisis histórico | `src/server/market_analysis.js` | Análisis de archivos CSV; no es un feed en vivo. |
| Datos para gráficos | `src/marketData.js` (Node) | Consultas HTTP a Yahoo/Finnhub/Alpha Vantage y velas sintéticas de fallback; separado de los precios simulados de ejecución. |
| Tiempo real | WebSocket (`ws` en Node y soporte WebSocket de FastAPI) | Se usa para las funciones de telemetría implementadas por cada servidor. |
| Persistencia | SQLite local y Neon alojado | Node usa `node:sqlite` para Windows; `src/server/neon-store.js` usa el driver HTTP de `@neondatabase/serverless` con la URL directa de Neon en Vercel. El servicio Python continúa separado y usa SQLite. |
| IA de la aplicación | No hay proveedor ni modelo integrado | No se encontraron SDK de OpenAI, Anthropic, Gemini, Ollama u otro LLM en los manifiestos actuales. |
| IA para desarrollo y documentación | `AGENTS.md` y configuraciones en `.agents/` | Instrucciones y habilidades para asistentes; no son un motor de IA ejecutado por el servidor. |
| Wiki personal | Obsidian sobre esta carpeta del proyecto | El índice maestro está en `documentacion/00_INICIO_OBSIDIAN.md`; esta nota es la referencia técnica principal. |

### Webhook y cuentas

- `/api/webhook` solo acepta operaciones simuladas y exige `QUANTUM_WEBHOOK_SECRET` de al menos 32 caracteres; el token puede enviarse en el cuerpo o en `x-quantum-webhook-token`.
- Express escucha en `127.0.0.1:3008`. Por eso TradingView Cloud no puede invocar el endpoint directamente y no hay relay público configurado.
- El webhook valida instrumento, dirección, bot objetivo, contratos, stop, objetivo y riesgo antes de simular una orden.
- El análisis histórico importa velas OHLCV en CSV y simula señales según estrategia e intervalo configurados en cada bot. Para timestamps sin zona, el formulario solicita zona horaria; timestamps con `Z` u offset conservan esa zona. Los datos importados viven en memoria y se borran al reiniciar Node.
- La simulación histórica no envía órdenes y no representa resultados futuros; Order Flow requiere datos de operaciones y bid/ask que un CSV OHLCV no contiene.
- No hay conector de broker activo. La API rechaza contraseñas de broker y las cuentas registradas quedan como `NOT_CONFIGURED`.
- La sesión del panel vence tras 12 horas sin solicitudes autenticadas; cada solicitud válida renueva ese plazo. En Windows, Node mantiene sesiones en memoria; en Vercel se guardan en Neon.
- En Vercel, estado de bots, sesiones y ledger se cargan desde Neon; las solicitudes de API se serializan por instancia y las escrituras usan revisión para detectar conflictos entre instancias. Perfiles y ledger se cifran con `BOT_VPN_PII_ENCRYPTION_KEY`. La interfaz alojada consulta el snapshot por HTTP; el escritorio sigue usando WebSocket.
- El proyecto Vercel `quantum-fx` está publicado como demo pública en `https://quantum-fx-pi.vercel.app/`, con raíz `BOT_VPN/` y las rutas serverless definidas en `api/index.js` y `vercel.json`. El acceso a la aplicación requiere el login compartido del demo. Si Neon no tiene un snapshot, el servidor siembra titulares, bots y movimientos ficticios. No se migró SQLite local a Neon.
- La interfaz de jitter anti-mirroring se retiró; el sistema no incorpora demoras, rotación de IP ni identidades para ocultar replicación.
- El [[documentacion/planificacion/PLAN_INTEGRACION_ECOSISTEMA_FUTUROS|plan de ecosistema NQ/MNQ]] es una propuesta; sus repositorios candidatos no implican integración verificada.

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

- La base persistente es SQLite: Node accede con el módulo nativo `node:sqlite` en `src/server/database.js` y Python con `sqlite3` en `fastapi_service/persistence.py`.
- Las migraciones compartidas están en `migrations/`; `BOT_VPN_DB_PATH` permite configurar la ruta de la base común.
- Los dos servicios tienen APIs distintas, aunque compartan el archivo de base de datos. Un conflicto de revisión puede responder `409`; vuelve a cargar los datos antes de reintentar.

## IA y Obsidian

En este repositorio, “IA” describe el asistente que ayuda a desarrollar y mantener la wiki, no una función inteligente del producto en ejecución. La evidencia actual es:

- `AGENTS.md`: protocolo general para asistentes y mantenimiento de conocimiento.
- `.agents/rules/`: instrucciones adicionales para el agente.
- `.agents/skills/`: habilidades locales para asistentes compatibles.
- No hay cliente de LLM, clave de proveedor ni modelo configurado por `package.json` o los archivos `requirements*.txt`.

Para que un asistente trabaje con información fiable:

1. Empezar por esta nota, el [[documentacion/01_MAPA_DEL_PROYECTO|mapa del código]] y el [[documentacion/00_INICIO_OBSIDIAN|índice de la wiki]].
2. Verificar versiones y capacidades en `package.json`, `requirements.txt`, el código y las pruebas antes de describirlas como activas.
3. Marcar cada función como **implementada**, **simulada**, **opcional** o **planificada**. No tratar los documentos de diseño como prueba de que una integración está funcionando.
4. No copiar secretos ni credenciales a la wiki. Las fuentes primarias de `raw/` no se editan.
5. Registrar cambios de conocimiento en [[documentacion/90_HISTORIAL_DE_CAMBIOS|la bitácora]] y actualizar los enlaces del índice cuando se agreguen documentos.

Obsidian usa `BOT_VPN/` como bóveda y su espacio de trabajo queda apuntando a `documentacion/00_INICIO_OBSIDIAN.md`. Desde ese índice se accede a la arquitectura, la operación, el backlog, las estrategias y las fuentes.

## Estado funcional que no hay que confundir

- Node y FastAPI son servicios independientes; la interfaz principal se sirve con Node.
- El envoltorio Electron inicia solo el servidor Node del panel. FastAPI sigue opcional y no es requisito de la aplicación de escritorio.
- El instalador NSIS es x64 y por usuario. La base se guarda en el directorio de datos de Electron en Windows; durante el primer inicio instalado se ofrece importar un `bot_vpn.sqlite3` existente.
- La cuadrícula por bot consulta `/api/bot/:botId/candles` por HTTP y actualiza aproximadamente cada 60 segundos. El gráfico general usa `/api/market/candles`, que devuelve velas simuladas en memoria. No existe aquí un stream de precios de un broker.
- Finnhub y Alpha Vantage mapean MNQ/NQ a QQQ y ES a SPY: son precios de ETFs, no precios equivalentes de los futuros CME. Si falla una fuente, el conector puede generar velas sintéticas; las tarjetas muestran el origen o fallback informado por la API. No uses esas series para ejecutar ni evaluar trades reales.
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
3. Ejecuta las pruebas: `npm.cmd test`. El script corre `node --test tests/node/*.test.js` y luego `python -m pytest tests/python`.
4. Comprueba los enlaces de la bóveda: `npm.cmd run check:docs`.
5. Inicia el servidor principal con `npm.cmd start` y verifica `http://127.0.0.1:3008/healthz` y `http://127.0.0.1:3008/`.
6. Solo si necesitas probar el backend Python, inicia en otra terminal `npm.cmd run start:fastapi` y verifica `http://127.0.0.1:8000/healthz` y `/docs`.
7. Revisa los errores que impriman los procesos y el resultado de las pruebas. Un `healthz` exitoso solo confirma que responde el servidor.

Si la ejecución de `npm` en PowerShell está bloqueada por la política de scripts, usa `npm.cmd` como en los ejemplos; no hace falta cambiar esa política.

## Mapa de documentación

| Ubicación | Contenido |
| --- | --- |
| `documentacion/` | Índice, estado, mapa, conceptos, integraciones, estrategias, reglas y planificación. |
| `raw/` | Fuentes primarias; tratarlas como solo lectura. |
| `README.md` | Instalación, operación local y diferencias entre servicios. |
| `documentacion/01_MAPA_DEL_PROYECTO.md` | Mapa de servicios, rutas y conexiones de Obsidian. |
| `documentacion/planificacion/TAREAS_PENDIENTES_QUANTUM_FX.md` | Backlog priorizado. |
| `documentacion/planificacion/PLAN_DE_IMPLEMENTACION.md` | Plan de trabajo y diseño futuro. |
| `AGENTS.md` y `.agents/` | Instrucciones de mantenimiento para asistentes de IA. |

Enlaces: [[documentacion/00_INICIO_OBSIDIAN|Inicio de la wiki]] · [[documentacion/01_MAPA_DEL_PROYECTO|Mapa del código]] · [[documentacion/03_ARQUITECTURA_CONCEPTUAL|Arquitectura conceptual]] · [[README|Operación local]] · [[../AGENTS|Reglas del proyecto]] · [[documentacion/AGENTS|Reglas de la wiki]]
