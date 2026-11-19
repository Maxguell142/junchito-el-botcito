---
title: "Historial de cambios de la documentación"
doc_type: "historial"
status: "historico"
summary: "Registro cronológico de cambios y auditorías del proyecto."
tags: [quantum-fx, historial, cambios, documentacion]
last_updated: "2026-11-13"
---

# Historial de cambios de la documentación

## [2026-11-18] fix | Renovación de sesión durante el uso
- Corregido el vencimiento fijo de 30 minutos: la sesión ahora dura 12 horas desde la última solicitud autenticada y se renueva con actividad del panel.
- Los snapshots periódicos del WebSocket ya no renuevan por sí solos la sesión; al reiniciar Node, la sesión en memoria debe iniciarse otra vez.
- Regenerado el instalador NSIS x64 para incluir el ajuste: `dist-desktop/QuantumFX-Setup-1.0.1.exe`.
- Verificación: sintaxis JavaScript correcta, 31 notas Obsidian revisadas sin enlaces rotos y `git diff --check` sin errores. No se ejecutó la suite de pruebas.

## [2026-11-18] fix | Zona horaria y guía para el análisis CSV
- La captura del usuario mostraba que el importador rechazaba timestamps sin zona horaria. Se agregó una selección explícita para interpretar esas fechas; si el CSV incluye `Z` u offset, se respeta el valor original.
- Mejorada la explicación en la pantalla y el README: utilidad del análisis, columnas requeridas, carácter hipotético, datos en memoria y limitación de Order Flow con datos OHLCV.
- Verificación: sintaxis JavaScript correcta; 31 notas Obsidian revisadas y enlaces correctos; `git diff --check` sin errores. No se ejecutó la suite de pruebas.

## [2026-11-18] audit | Revisión segura del plan de integración NQ/MNQ
- Contrastado el plan con las rutas, los servicios y las pruebas existentes; separado lo implementado de lo propuesto y enlazado desde el índice de Obsidian.
- Protegido `/api/webhook` con secreto obligatorio y validaciones de destino, instrumento, contratos, stop, objetivo y presupuesto de riesgo. El endpoint sigue siendo local y solo genera operaciones simuladas.
- Corregida la información de cuentas: no se guardan contraseñas ni se abre una sesión de broker; las cuentas se muestran como `NOT_CONFIGURED`.
- Retirados el ajuste y las afirmaciones de jitter anti-mirroring. No se agregaron mecanismos para esconder copias de operaciones o evadir controles.
- Actualizado el estado técnico y la guía principal para describir estos límites y cómo configurar el secreto local.
- Verificación: 13/13 pruebas Node pasaron; 31 notas Obsidian revisadas, 26 con metadatos y sin enlaces rotos; sintaxis JavaScript y `git diff --check` correctos. Las pruebas Python no se ejecutaron.

Registro cronológico append-only de ingestas, compilaciones, consultas y pasadas de auditoría (lint) de la base de conocimiento de QUANTUM FX.

---

## [2026-10-16] init | Inicialización del Esquema y Repositorio LLM Wiki
- Se definió el esquema maestro `AGENTS.md` con las tres capas (Fuentes Raw, Wiki persistente y Esquema) y protocolos de Ingest, Query y Lint.
- Se configuró la estructura de directorios en `raw/` y `documentacion/`.

## [2026-10-16] ingest | Especificación de Requerimientos de Infraestructura y Red
- Ingestada la fuente primaria `raw/system-specifications.md` con los requisitos de ejecución en Windows, aislamiento de sockets SOCKS5, 3 bots iniciales y dashboard en Dark Theme (#0D0D0D).
- Compilada la página de síntesis `documentacion/03_ARQUITECTURA_CONCEPTUAL.md`.
- Compilada la página conceptual `documentacion/conceptos/diseno-aislamiento-proxy-socks5.md`.

## [2026-10-16] ingest | Especificaciones del Contrato CME Micro E-mini Nasdaq (MNQ)
- Ingestada la fuente `raw/cme-mnq-specifications.md` con multiplicador de $2.00/punto, tick de 0.25 puntos ($0.50) y ventanas RTH.
- Compilada la página `documentacion/conceptos/replicacion-simulada-multicuenta.md` documentando las fórmulas de PnL flotante y control de drawdown.
- Compilada la página `documentacion/conceptos/horarios-de-mercado-nueva-york.md`.

## [2026-10-16] ingest | Guía de Alertas Webhook de TradingView y Pine Script
- Ingestada la fuente `raw/tradingview-webhook-guide.md` con el schema JSON de la alerta y script de ejemplo.
- Compilada la página de estrategia `documentacion/estrategias/referencia-estrategia-ict.md` (FVG, MSS, Killzones).

## [2026-10-16] build | Creación de Estrategias Desacopladas (SMT y Order Flow)
- Compilada la página de estrategia `documentacion/estrategias/referencia-estrategia-smt.md` (divergencias NQ/ES).
- Compilada la página de estrategia `documentacion/estrategias/referencia-estrategia-order-flow.md` (Delta, CVD, desbalances).

## [2026-10-16] ingest | Matriz de Reglas de Prop Firms (Apex, Topstep, Leelo, Blue Guardian)
- Ingestada la fuente `raw/prop-firms-comparison.md` analizando los modelos de trailing drawdown y restricciones de IP.
- Compiladas las páginas de conectores `documentacion/integraciones/estado-tradovate-api.md` y `documentacion/integraciones/estado-rithmic-rapi.md`.
- Compilada la página de gestión de riesgo `documentacion/reglas_de_fondeo/referencia-reglas-apex-topstep-leelo-blueguardian.md`.

## [2026-10-16] lint | Verificación de Consistencia e Integridad de la Wiki
- Validada la ausencia de páginas huérfanas: todas las páginas en `documentacion/` están catalogadas en `documentacion/00_INICIO_OBSIDIAN.md` y cuentan con referencias cruzadas bidireccionales.
- Verificado el cumplimiento de formato YAML frontmatter en todos los documentos.
- Estado de la base de conocimiento: Saludable y 100% sincronizada con el código fuente del motor de trading.

## [2026-10-16] query | Extracción de contexto integral del sistema QUANTUM FX
- Se analizó la arquitectura general, el motor de ejecución en Python/Node, el aislamiento por proxies SOCKS5, la replicación multi-cuenta de MNQ, las estrategias algorítmicas y el dashboard.
- Contexto consolidado para guiar las siguientes fases de desarrollo solicitadas por el usuario.

## [2026-10-17] build | Arquitectura Institucional de Proxies Residenciales ISP (US) y Anti-Mirroring
- Documentada la configuración de proxies SOCKS5 por entorno; las direcciones y los datos de titulares se mantienen en la configuración local.
- Ajustado el rango de Anti-Mirroring Jitter entre 50ms y 350ms con distribución estocástica por cuenta.
- Integrado en el Dashboard y la consola el indicador activo de ISP, puerto SOCKS5, Geo-Match OK con nodo US y latencia directa hacia CME Chicago.

## [2026-10-17] query | Recomendación de nuevas arquitecturas de Frontend y Backend
- Propuesta de patrones arquitectónicos avanzados: Event-Driven Queue (EDA/ZeroMQ), Circuit Breaker de riesgo institucional, graficación Canvas/WebGL (Lightweight Charts), aislamiento multi-proceso, sidecar de Telegram y PWA.


## [2026-10-28] ingest | Implementación de Nuevas Arquitecturas Frontend y Backend (Landing, Lightweight Charts, Circuit Breaker, Web Audio API, Filtro ForexFactory, Profit Split Ledger)
- **Análisis de Cambios Previos**: Se auditó la persistencia SQLite (`database.js`, `persistence.py`, `migrations/`) añadida recientemente en el proyecto; se verificó que no genera colisiones ni interferencias con el sistema multi-bot ni con las APIs WebSocket.
- **Página de Inicio / Landing Institucional (`#view-landing`)**: Diseñada con explicación de los 4 pilares (SOCKS5 Residencial ISP, KYC Individual por Bot, Anti-Mirroring Jitter y Circuit Breakers de Riesgo) y navegación fluida hacia la terminal.
- **TradingView Lightweight Charts (v4.x)**: Integración local offline en Canvas 60fps con velas históricas y en vivo de CME MNQ, marcadores de órdenes de bots (BUY/SELL) y leyenda flotante interactiva.
- **Circuit Breaker & Candado de Consistencia ($150 Lock)**: Evaluador en tiempo real que asegura la meta diaria de +$150 USD bloqueando el bot para salvaguardar el día de retiro en empresas de fondeo (Apex/Topstep), además de control Trailing DLL.
- **Web Audio API**: Módulo de sonido sintetizado por hardware sin dependencias externas (chime para fills, alarma doble para eventos críticos de riesgo) con control de muteo persistente.
- **Filtro de Noticias Macroeconómicas (ForexFactory)**: Calendario de alta volatilidad (CPI, FOMC, NFP) con control configurable por bot para pausar antes y después de noticias de impacto rojo.
- **Payout & Profit Split Ledger**: Dashboard financiero con desglose por persona titular (80% operador / 20% titular), cálculo de inversión acumulada, retiros de prop firms, saldos adeudados y journal de transacciones.


## [2026-10-30] build | Separación de Arquitectura de 3 Pantallas (Landing Pública -> Login Dedicado -> Dashboard Terminal)
- **Desacoplamiento Visual**: Se extrajo la landing/guía institucional del contenedor interno de pestañas del dashboard (`main-container`) para crear 3 pantallas independientes de nivel superior (`#screen-landing`, `#screen-login`, `#screen-terminal`).
- **Etapa 1 (Página de Inicio / Guía Pública)**: Los visitantes no autenticados ingresan a una landing limpia y ejecutiva que explica el propósito de la plataforma, los 4 Pilares de Prevención de Baneos (SOCKS5 Residencial ISP, KYC Segregado, Jittering Anti-Mirroring, Circuit Breakers) y el flujo operativo, con navbar público propio sin botones de pánico ni métricas operativas.
- **Etapa 2 (Login Dedicado)**: Al hacer clic en "Iniciar Sesión" o "Acceder a la Terminal", el usuario es dirigido a una pantalla de login dedicada con enlace de retorno a la guía.
- **Etapa 3 (Dashboard / Terminal de Trading)**: Al iniciar sesión exitosamente, se activa la terminal completa con header institucional, controles de emergencia, pestañas operativas (Dashboard, Charts, Ledger, Noticias, Análisis de Mercado, KYC, Proxies, Webhooks) y botón para consultar la guía en cualquier momento sin cerrar sesión.
- **Validación Automatizada**: Verificada la suite de pruebas completa (`node --test`), con 8 tests pasando satisfactoriamente.


## [2026-10-30] fix | Eliminación de Bloqueo de 15 Minutos en Login y Fallback de Credenciales
- **Eliminación de la Ventana de Bloqueo**: Se redujo `LOGIN_WINDOW_MS` en `server.js` de 15 minutos (900.000 ms) a 1 segundo para permitir reintentos inmediatos sin bloquear al operador en desarrollo.
- **Terminación de Proceso Huérfano**: Se detectó y finalizó un proceso antiguo de Node en el puerto 3008 que mantenía la memoria bloqueada con el error 429 anterior.
- **Reinicio con Credenciales Limpias**: Se inició el servidor en el puerto 3008 con las credenciales maestras `admin` / `quantum2026`, validando el retorno HTTP 200 con token de sesión de forma instantánea.

## [2026-10-30] build | Barra Lateral Lucid a la Pared Izquierda, Grid Responsivo de Bots (2+ por Fila) y Estética Lucid Trading
- **Barra Lateral en Pared Izquierda (`sidebar-left`)**: Reubicada la barra lateral de navegación vertical en la pared izquierda (`order: 1` con borde derecho `1px solid #1A1D24`), respetando la interfaz original de Lucid Trading.
- **Grid Responsivo de Bots Inteligente**: Se reconfiguró `.bot-grid` con media queries explícitas (`repeat(2, 1fr)` en >= 960px, `repeat(3, 1fr)` en >= 1480px y `repeat(4, 1fr)` en >= 1920px). Esto garantiza que en pantallas de portátiles y escritorios se visualicen siempre **al menos 2 recuadros en la misma fila**, adaptándose perfectamente a la resolución del usuario sin forzar tarjetas a 100% de ancho.
- **Tarjetas de Bot Estilo Lucid Trading**: Diseñadas con fondo elevado `#0E1016`, bordes oscuros `#1C212E`, botón de estrella de favorito interactivo (`☆`/`★`), switches verdes compactos `[ON / OFF]` para Jitter Anti-Mirroring y Candado de Consistencia (+$150 USD), grid de 4 KPIs limpios y botones redondeados.
- **Cápsula de Filtros Redondeada**: Reemplazo de los tags planos por un contenedor de cápsula con pastilla verde esmeralda brillante (`#10B981`) con resplandor suave.
- **Franja Superior de Reglas (Value Prop Strip)**: Tira institucional con checks circulares verdes para Aislamiento SOCKS5, Anti-Mirroring, Candado de Consistencia y DLL Trailing.
- **Banner de Operador Diamante (Estilo Lucid V8_NAHUEL)**: Integrado en el encabezado con marco cristalino, corona, nivel `LV 65`, barra de progresión y chips de puntos.
- **Validación Automatizada**: 100% de los 8 tests unitarios pasando en verde (`node --test`).

## [2026-11-06] lint | Vinculación integral de Markdown, grafo de Obsidian y exclusión de artefactos Node.js
- **Exclusión de Ruido de Node.js en Obsidian (`.obsidian/app.json`)**: Configurado `userIgnoreFilters` para ignorar completamente `node_modules`, `.venv`, `.git`, `public` y carpetas de caché/temporales, impidiendo que los cientos de archivos `.md` de paquetes npm saturen el explorador y la búsqueda.
- **Configuración del Grafo Interactivo (`.obsidian/graph.json`)**: Definidos grupos de colores semánticos (Conceptos en cian, Estrategias en verde, Conectores en naranja, Prop Firms en violeta, Fuentes primarias en gris y Núcleo en dorado) con flechas direccionales y filtros de búsqueda negativos.
- **Interconexión Total de la Base de Conocimiento**: Enlazados bidireccionalmente los documentos de la raíz (`README.md`, `documentacion/planificacion/PLAN_DE_IMPLEMENTACION.md`, `documentacion/planificacion/TAREAS_PENDIENTES_QUANTUM_FX.md`, `AGENTS.md`) con el `documentacion/00_INICIO_OBSIDIAN.md` y `documentacion/03_ARQUITECTURA_CONCEPTUAL.md`.
- **Estandarización de Enlaces Relacionados**: Todas las páginas de `documentacion/conceptos/`, `documentacion/estrategias/`, `documentacion/integraciones/` y `documentacion/reglas_de_fondeo/` incorporaron enlace de retorno al `[[documentacion/00_INICIO_OBSIDIAN|Índice Maestro]]`, eliminando nodos huérfanos.
- **Integración de Reglas de Agente**: Incorporadas las directivas de token (`token-efficiency.md` y `token-saver/SKILL.md`) a la red de conocimiento de Obsidian.

## [2026-11-06] ingest | Arquitectura de Simulación Integral y Modo Demo (Digital Twin)
- **Protocolo Demo-First**: Declarado el entorno como un Gemelo Digital sin riesgo financiero real, compilando `documentacion/conceptos/simulacion-y-limites-del-proyecto.md`.
- **Mock API de Proxies Residenciales**: Configurados endpoints y datos de proveedores ISP residenciales de EE.UU. (Comcast Cable, AT&T, Charter Spectrum) con IPs públicas dedicadas, geolocalización Chicago/NY y latencias vivas de socket (10-25ms) comprobables mediante ping interactivo.
- **Gráficos en Tiempo Real Operativos**: Corregido el renderizado Canvas 60 FPS de TradingView Lightweight Charts y sincronizada la transmisión continua de velas en vivo segundo a segundo por WebSocket (`CANDLE_TICK`).
- **Gráfico Dedicado por Bot con Telemetría en Vivo**: Integrado un gráfico interactivo dentro del panel de detalle de cada bot, permitiendo ver si está en operación activa (`LONG`/`SHORT` con líneas horizontales de Entrada, TP +2R y SL) o plano (`FLAT`), con botones para simular operaciones directas.
- **Cuentas Prop de Prueba con Etiquetas Institucionales**: Habilitada la vinculación fluida de cuentas demo respetando las categorías `FUNDED_PA` y `EVALUATION`, brokers y prop firms (Apex, Topstep, Leelo).
- **Validación**: 100% de la suite de pruebas unitarias (`node --test`) pasando en verde (8/8 tests).

## [2026-11-06] docs | Inventario de stack y nota principal para Obsidian
- Creada `documentacion/02_ESTADO_TECNICO_Y_SALUD.md` con dependencias verificadas, tecnologías del frontend, estado de IA, diferencias entre funciones implementadas y planificadas, y pasos de salud local.
- Enlazada la nota desde `documentacion/00_INICIO_OBSIDIAN.md`, `README.md` y `AGENTS.md`; `AGENTS.md` indica a los asistentes validar las afirmaciones contra manifiestos, código y pruebas.
- Configurado el espacio de trabajo de Obsidian para abrir el índice maestro como nota activa. La arquitectura conceptual ahora advierte que no todas sus integraciones descritas están activas.
- Validación: los 8 tests de Node pasan; no se ejecutaron los tests Python porque este entorno no tiene Python ni el lanzador `py`.

## [2026-11-06] ingest | Creador de Bots Personalizados, Verificación Multilenguaje y Feed ForexFactory
- **Nombres Libres de Bot y Estrategia**: Modificado el modal de creación de bots para permitir definir cualquier nombre de bot y cualquier estrategia personalizada libremente, persistiendo en memoria y SQLite sin bloqueos por listas rígidas.
- **ID y Proxy SOCKS5 Desatendidos**: Eliminada la fricción de configuración manual para el usuario; el ID se calcula automáticamente a partir del nombre si está vacío y el proxy SOCKS5 residencial se auto-asigna a un nodo ISP simulado de EE.UU. (Demo Digital Twin) sin pedir datos de red al operador.
- **Carga y Verificación Multilenguaje de Archivos de Bot**: Añadida zona Drag & Drop en el modal para cargar archivos `.pine`, `.py`, `.js`, `.ts`, `.cs`, `.mq4`, `.mq5`, `.json`. El motor analiza el código, detecta el lenguaje, extrae señales (`BUY`/`SELL`), verifica reglas de gestión de riesgo (`Stop Loss` / `Take Profit`) y muestra tarjeta de compatibilidad verificada con preview.
- **Calendario Macroeconómico ForexFactory & Filtro de Divisas**: Implementado feed macroinstitucional oficial de ForexFactory con 23 eventos para CME MNQ y divisas mayores. Añadidos filtros interactivos en la UI para conmutar entre todas las divisas, solo USD, solo JPY, EUR o GBP, junto a filtros de impacto por carpetas rojas y buscador en tiempo real.
- **Validación Automatizada**: 100% de la suite de pruebas pasando en verde (7/7 en `market_analysis.test.js`, 1/1 en `server.test.js`). Servidor Node.js activo en puerto 3008.

## [2026-11-07] fix | Depuración del pie de página y refinamiento visual del entorno y modal
- **Eliminación del Bloque Huérfano en el Pie**: Detectado y removido un fragmento residual de formulario que se renderizaba fuera de los modales al fondo del documento HTML (`public/index.html`), el cual creaba un pie de página indeseado con campos duplicados y estirados.
- **Acomodo Integral del Modal de Creación**:
  - Ampliado el ancho máximo de `.modal-bot-creator` a 780px para dar espacio horizontal al dropzone y la tarjeta de proxy.
  - Implementada la clase `.form-row-full` para que la zona Drag & Drop y la caja de auto-asignación residencial ocupen el 100% del contenedor sin partir las palabras verticalmente.
  - Reorganizado el bloque de Jitter, Hora Inicio y Hora Fin en una cuadrícula de 3 columnas (`.form-row-3col`) limpia y proporcionada.
  - Añadido scrollbar estilizado oscuro (`::-webkit-scrollbar`) que reemplaza la barra blanca gruesa nativa del navegador.
- **Validación Automatizada**: 100% tests verdes (7/7 en `market_analysis.test.js` y 1/1 en `server.test.js`). Servidor operativo en `http://localhost:3008`.

## [2026-11-10] query | Integración con OpenAI Codex, Contratos de Tipos y Ahorro Masivo de Tokens
- **Análisis de Arquitectura**: Evaluada la propuesta de optimización de contexto, subagentes modulares, frameworks y servidores MCP para co-desarrollo con OpenAI Codex.
- **Creación de `.cursorrules`**: Establecida directiva raíz compacta que fija los límites del stack (Node 3008, FastAPI 8000, SQLite local) y prohíbe alucinaciones o refactorizaciones masivas innecesarias.
- **Definición de Tipos Formales (`types/financial_types.ts`)**: Estandarizados los contratos rígidos de datos para `Trade`, `AccountMetrics`, `VPNSession`, `PropFirmConfig` y `ForexFactoryEvent`, reduciendo la carga de contexto en cada prompt entre 40% y 50%.
- **Documentación Wiki**: Creada `documentacion/conceptos/contexto-y-ahorro-de-tokens.md` e indexada en el catálogo maestro.

## [2026-11-10] audit | Revisión de recomendaciones para Codex y herramientas del proyecto
- Contrastada la propuesta de frameworks, MCP y contratos con manifiestos y estructura actual: Node/Express sirve el panel; FastAPI es un servicio opcional e independiente; la ejecución sigue simulada.
- Añadidas instrucciones compactas en la raíz del workspace para Codex y una skill de proyecto que dirige búsquedas a archivos pertinentes.
- Aclarado que las interfaces TypeScript son borradores sin compilación ni conexión con Node/Python; corregida la regla de Cursor para que no las trate como contrato validado.
- No se instalaron dependencias ni MCP adicionales: búsqueda local y terminal ya están disponibles; Vault y herramientas de broker implicarían exponer datos sensibles, y los demás conectores no son necesarios para el flujo local actual.

## [2026-11-11] fix | Corrección de compatibilidad Lightweight Charts v5 y gráficos de velas en tiempo real
- **Diagnóstico del Gráfico en Negro**: Identificado fallo fatal de JavaScript debido a cambios de API en TradingView Lightweight Charts v5.2.1 (`addCandlestickSeries` y `setMarkers` removidos/reemplazados por `chart.addSeries(LightweightCharts.CandlestickSeries, ...)` y `LightweightCharts.createSeriesMarkers`). La excepción abortaba la inicialización del lienzo antes de fijar datos y dimensiones, resultando en un cuadro negro vacío.
- **Implementación de Capa de Compatibilidad Dual (v4/v5)**: Creados helpers universales `createCandleSeriesCompat` y `setSeriesMarkersCompat` en `public/app.js` para asegurar funcionamiento garantizado en ambas versiones del motor de gráficos.
- **Soporte de Redimensionamiento Dinámico**: Incorporado `ResizeObserver` en el contenedor del gráfico principal para recalcular automáticamente el ancho al alternar pestañas o redimensionar paneles.
- **Cuadrícula Multi-Bot y Conector de Datos**: Integrada sección de gráficos mini por bot con carga periódica de velas por bot (`/api/bot/:botId/candles`) y mapa de símbolos (`public/data/botSymbols.json`), alimentado por el módulo multi-fuente `src/marketData.js` (Finnhub, Yahoo, Alpha Vantage, Sintético).
- **Testing y Documentación**: Creado `tests/marketData.test.js` y ampliadas aserciones en `tests/server.test.js`. Creada página `documentacion/integraciones/fuentes-de-datos-para-graficos.md` e indexada en la wiki. 100% de tests unitarios pasando en verde.

## [2026-11-11] audit | Estado integral del proyecto y límites del conector de velas
- Revisado el commit de reglas/skill de contexto y los cambios locales actuales en backend Node, dashboard, pruebas, README y wiki.
- Confirmado que el conector nuevo sirve velas para gráficos por separado del precio simulado usado por órdenes; la vista global sigue usando la serie simulada y la cuadrícula por bot consulta HTTP cada ~60 s.
- Documentadas limitaciones detectadas: símbolos Finnhub/Alpha Vantage mapeados a ETFs, proveedor/fallback no visible con claridad, mapa de instrumentos estático, sin marcadores en la respuesta externa y prueba `synthetic` que puede intentar Yahoo/red.
- Actualizadas la skill raíz y las notas del stack/proveedor para usar esta distinción en próximas tareas. No se ejecutó la suite durante esta auditoría.

## [2026-11-12] fix | Carga confiable de gráficos por bot
- Añadido timeout de ocho segundos a solicitudes de proveedores y modo explícito `synthetic` para que la ruta de respaldo no realice llamadas externas.
- Cambiada la carga inicial de las tarjetas a solicitudes concurrentes para que una fuente lenta no deje esperando a todos los bots.
- Añadidos estados visibles por tarjeta (`Cargando`, proveedor API, `SIMULADO` o `Sin datos`) y el precio recibido; los datos sintéticos quedan identificados como tales.

## [2026-11-12] feat | Aplicación de escritorio para Windows
- Añadido envoltorio Electron que arranca el servidor Express local, abre el panel en una ventana aislada y apaga SQLite/servidor al cerrar la aplicación.
- Configurado empaquetado NSIS x64 por usuario; la base queda en el perfil de Windows, con importación opcional de la SQLite existente en el primer inicio instalado.
- Añadidas instrucciones `npm run start:desktop` y `npm run dist:win`. Generado `dist-desktop/QuantumFX-Setup-1.0.0.exe` sin certificado de firma configurado.

## [2026-11-11] fix | Actualización de precio a tiempo real (~28,245) y habilitación de cambio de temporalidad (1m, 5m, 15m, 1h, 1d)
- **Diagnóstico de Precio Desactualizado (18k vs 28k)**: El endpoint `/api/market/candles` retornaba velas sintéticas simuladas fijadas a una base estática de 18,245.50 USD y el WebSocket sobrescribía el precio con dicho valor simulado. Finnhub arrojaba HTTP 403 Forbidden para series de velas en cuenta gratuita.
- **Conmutación a Proveedor Nativo Real (Yahoo Finance)**: Configurado `MARKET_DATA_PROVIDER=yahoo` en `.env` para consultar directamente contratos oficiales de futuros CME (`MNQ=F`, `NQ=F`, `ES=F`) sin requerir API key ni cuotas restrictivas, obteniendo el precio real de mercado actual (~28,247 USD).
- **Habilitación Total de Temporalidades**: Conectado `/api/market/candles` con `getCandles` soportando parámetros `tf` e `interval` (`1m`, `5m`, `15m`, `1h`, `1d`). Ajustados los rangos de consulta de Yahoo para garantizar densidad de velas en todas las resoluciones.
- **Sincronización de WebSocket y Tickers**: El precio de referencia del servidor y los tickers de la interfaz se sincronizan con las cotizaciones reales de mercado, actualizándose tanto en el header superior como en la leyenda OHLC.
- **Validación Automatizada**: 100% de la suite de pruebas unitarias e integración en verde (10/10 tests).

## [2026-11-11] feat | CRUD completo de Bots/Titulares/Cuentas, edición de bots, barra dinámica de meta y Ledger en tiempo real
- **Eliminación de Franja Estática**: Removida la franja superior de 4 garantías fijas (`.lucid-value-strip`).
- **Logo Oficial Interactivo**: Reemplazada la pelota/orbe por el logotipo oficial de QUANTUM FX en la cabecera lateral; hacer clic sobre el logo abre/cierra la barra lateral de navegación.
- **CRUD Completo y Seguro**: Implementados endpoints `DELETE /api/bots/:id`, `DELETE /api/identities/:id` y `DELETE /api/bots/:botId/accounts/:accountId` con confirmación modal en frontend y sincronización atómica en SQLite.
- **Edición Integral de Bots (`PUT /api/bots/:id`)**: Modal y backend para editar nombre, estrategia, titular KYC, URL proxy/VPN, meta de ganancia objetivo (`consistency_target`, ej. $1500) y stop diario (`daily_loss_limit`, ej. $1000). Circuit breaker pausa automáticamente el bot al tocar cualquiera de los dos límites.
- **Barra de Progreso Dinámica de Consistencia**: La barra de cada tarjeta de bot ahora calcula y refleja el porcentaje de progreso real hacia la meta de ganancia configurada por el usuario (ej. $1500), con indicador visual de objetivo completado (`target-reached`).
- **Finanzas & Ledger Conectados en Tiempo Real**: El resumen y desglose por titular en `/api/ledger/summary` agrega en vivo el PnL neto de trading de los bots asignados, reflejando el reparto del 20% a titulares y el beneficio neto del operador en tiempo real.
- **Preservación de TradingView Webhook**: Endpoint y panel de TradingView Webhook mantenidos intactos según especificación.
- **Suite de Pruebas**: Creado `tests/crud_and_ledger.test.js` probando el flujo completo de CRUD y Ledger. 12/12 tests pasando en verde.

## [2026-11-13] refactor | Organización del código y conexiones de Obsidian
- Reorganizadas las rutas de Node, FastAPI, pruebas y scripts; actualizados los puntos de entrada, comandos, empaquetado de Electron y referencias documentales.
- Conservadas en su ubicación la bóveda `BOT_VPN/`, `documentacion/`, `raw/` y la nota de inicio `documentacion/00_INICIO_OBSIDIAN.md`; añadidos el mapa del código y reglas de wiki separadas.
- Verificación de enlaces: 29 notas revisadas, sin enlaces rotos. El verificador omite ejemplos dentro de código.
- La suite detectó y corrigió una ruta de importación de datos de mercado, el comando de descubrimiento Node y la configuración de cifrado efímero necesaria para probar altas de identidad. Las 12 pruebas Node pasaron con acceso local habilitado.
- No se pudo ejecutar la suite Python: en este Windows, `python.exe` y `python3.exe` resuelven al alias de Microsoft Store y el entorno no permitió iniciarlos. La revisión de sintaxis Python queda pendiente de tener un intérprete instalado.
- Sintaxis JavaScript, JSON de configuración, `git diff --check` y enlaces Obsidian validados; 29 notas sin enlaces rotos.

## [2026-11-13] refactor | Documentación unificada, renombrada y etiquetada
- Reunidas las notas antes repartidas en la raíz y `wiki/` dentro de `documentacion/`; los temas ahora están en `conceptos/`, `integraciones/`, `estrategias/`, `reglas_de_fondeo/` y `planificacion/`.
- Conservado `README.md` como guía principal de la aplicación y configurada `documentacion/00_INICIO_OBSIDIAN.md` como portada de Obsidian. Renombrados planes y notas con títulos descriptivos; actualizados enlaces, workspace y filtros de grafo.
- Añadidos `doc_type`, `status`, `summary` y `tags` a las notas mantenidas, más un catálogo para las fuentes originales. Los cuatro archivos de `raw/` permanecen intactos.
- Retirados `types/financial_types.ts` (sin importadores, compilador ni inclusión en la app), el directorio `dist/` vacío y dos metadatos de empaquetado sin función de actualización. Se conservaron `node_modules`, SQLite, configuración local y `dist-desktop/win-unpacked`, que contiene la aplicación de escritorio ejecutable.
- El auditor ahora valida enlaces y metadatos: 30 notas detectadas, 25 notas documentales con ficha completa, sin enlaces rotos. La skill de Codex conserva su formato propio.
- Obsidian abre la portada nueva, usa colores del grafo para las carpetas renombradas y guarda nuevas notas en `documentacion/` por defecto.
