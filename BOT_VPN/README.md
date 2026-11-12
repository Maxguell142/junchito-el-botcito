# BOT_VPN — ejecución local

> 📚 **Base de Conocimiento y Wiki (Obsidian):** Empieza por el [[wiki/stack-and-health|Mapa del sistema, stack y salud]], sigue con el [[wiki/index|Índice Maestro de la Wiki]] y la [[wiki/system-overview|Arquitectura General del Sistema]]. El marco operativo del agente está en [[AGENTS]].
> 📋 **Roadmap y Backlog:** Lista priorizada de trabajo en [[PENDIENTES_Y_MEJORAS|Pendientes y Mejoras]]; plan ampliado en [[IMPLEMENTATION_PLAN|Plan de Implementación]].

El proyecto contiene dos servidores independientes. Comparten persistencia SQLite, pero mantienen APIs y estado de ejecución propios; no ofrecen exactamente las mismas rutas:

| Servidor | Inicio | Dirección local | Uso actual |
| --- | --- | --- | --- |
| Node.js / Express | `npm start` o `.\run_server.ps1` | http://127.0.0.1:3008 | Panel web y API Node |
| FastAPI | `npm run start:fastapi` | http://127.0.0.1:8000 | Gateway Python; documentación en `/docs` |

Ambos comparten `BOT_VPN/bot_vpn.sqlite3` como fuente persistente. Se puede cambiar la ruta con `BOT_VPN_DB_PATH`, pero hay que definir el mismo valor en las ventanas de ambos servidores. La primera ejecución importa `config.json` una sola vez; el importador excluye credenciales administrativas, de broker y de proxy. El archivo heredado se conserva sin cambios y está excluido de Git. Para una instalación nueva, `config.json` es opcional; se usa únicamente para importar configuración heredada.

## Diferencias conocidas entre servidores

- Node ofrece `GET /api/system/snapshot`; FastAPI publica el snapshot inicial y la telemetría por `/ws`.
- FastAPI ofrece `POST /api/webhook` y `GET /api/strategies`; Node todavía no implementa esas rutas.
- Node actualiza horarios con `POST /api/bots/:id/schedule`; FastAPI usa `PUT /api/bots/{bot_id}/schedule`.
- Node no implementa webhook ni estrategias; el test de proxy en Node responde `501` porque no puede verificar una conexión real.
- Ambos implementan controles de emergencia, identidades y gestión de bots, pero sus modelos y respuestas no son contratos intercambiables.
- Los cambios persistidos se guardan en transacciones SQLite con control de revisión. Si dos solicitudes compiten con un snapshot desactualizado, la segunda recibe `409` y debe reintentarse; no sobrescribe silenciosamente el cambio anterior.
- Los cambios administrativos se registran en `audit_events`; las acciones de cierre/flatten y las señales recibidas se guardan en `operations` marcadas como `SIMULATED`.

La interfaz web se sirve desde Node. Iniciar FastAPI no inicia Node ni mueve el panel al puerto 8000.

La lista **Titulares & KYC** no se precarga con personas ficticias. Registra manualmente titulares desde esa pestaña; el estado inicial queda `PENDING` y este registro local no verifica identidad. Para una prueba del análisis de mercado, puedes crear bots sin asignar un titular. No guardes documentos, fecha de nacimiento ni otros datos sensibles en las notas.

## Requisitos

- Node.js 22.13 o posterior y npm (`node:sqlite` es el controlador local)
- Python 3.10 o posterior

## Preparación local en Windows

Abre PowerShell y ejecuta:

```powershell
cd "C:\ruta\al\repositorio\BOT_VPN"
npm ci
```

No guardes credenciales en `config.json`. En cada ventana de PowerShell desde la que vayas a iniciar un servidor, configura credenciales de desarrollo en variables de entorno:

```powershell
$env:BOT_VPN_AUTH_USERNAME = Read-Host "Usuario local"
$securePassword = Read-Host "Contraseña local" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
  $env:BOT_VPN_AUTH_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}
```

Si `config.json` ya contiene `auth.username`, `auth.password` u otros secretos heredados, elimínalos manualmente después de verificar la importación. Los servidores ya no leen ni reescriben ese archivo después de la importación inicial. El servidor emite tokens aleatorios de sesión con vencimiento a los 30 minutos y permite revocarlos al cerrar sesión. Para habilitar el webhook, define `BOT_VPN_WEBHOOK_TOKEN` en el entorno, con un valor aleatorio largo. No uses credenciales de broker ni publiques esos valores. Las variables de entorno son solo una medida práctica para desarrollo local, no un gestor de secretos de producción.

SQLite se inicializa automáticamente con las migraciones de `migrations\`. La base de datos conserva identidades, bots, cuentas, configuración, eventos de auditoría y operaciones etiquetadas como simuladas. Los usuarios y contraseñas de broker no se guardan. El archivo y sus diarios SQLite están excluidos de Git.

Node y FastAPI aplican el mismo esquema y control de revisión optimista. Si una escritura detecta que el otro proceso guardó una versión más reciente, responde `409` y no pisa el estado nuevo; los errores de SQLite se informan como fallos, no como guardados exitosos. En `audit_events` quedan los cambios administrativos y en `operations` se registran las acciones simuladas. No existe todavía una interfaz de consulta/retención de auditoría ni un mecanismo de sincronización automática que resuelva conflictos: el cliente debe volver a cargar el estado antes de reintentar.

## Riesgo y modo de ejecución local

El modo de ejecución está fijado a `SIMULATED`: las señales solo actualizan posiciones ficticias, no se conectan al broker ni usan el proxy para ejecutar órdenes. Las respuestas y snapshots identifican ese modo. `execution_mode: "PAPER"` devuelve `501` porque todavía no existe un adaptador oficial de sandbox; `LIVE` no es un modo admitido.

El modo de demostración bloquea por defecto señales con más de 1 contrato por cuenta, más de 2 contratos globales activos, más de 3 órdenes al día, exposición nocional superior a $100,000, pérdida diaria superior a $50 por cuenta o $100 global. Son valores de ejemplo para probar los controles, no recomendaciones financieras. Los límites por cuenta (`max_contracts` y `daily_loss_limit`) pueden reducirlos; nunca elevan los topes globales. Los topes globales se pueden ajustar con estas variables no secretas antes de iniciar los dos servidores; define los mismos valores en ambas ventanas de PowerShell:

```powershell
$env:BOT_VPN_SIM_MAX_CONTRACTS_PER_ACCOUNT = "1"
$env:BOT_VPN_SIM_MAX_TOTAL_CONTRACTS = "2"
$env:BOT_VPN_SIM_MAX_ORDERS_PER_DAY = "3"
$env:BOT_VPN_SIM_DAILY_LOSS_PER_ACCOUNT = "50"
$env:BOT_VPN_SIM_DAILY_LOSS_GLOBAL = "100"
$env:BOT_VPN_SIM_MAX_EXPOSURE = "100000"
```

Los contadores de día usan UTC. Las señales con un `signal_id` estable se deduplican en el proceso local y se conserva su clave en `operations`; las señales sin identificador no tienen garantía de idempotencia. Los rechazos por riesgo incluyen su motivo y se auditan. Un bot pausado por el kill switch ignora señales; las respuestas de cierre de posiciones siguen etiquetadas como simuladas, no como confirmaciones de broker.

Las sesiones viven en memoria y se revocan al cerrar sesión, vencer o reiniciar el servidor. El login limita los intentos fallidos por IP. CORS está desactivado: la interfaz servida por Node llama a su API del mismo origen. El formulario de alta de cuentas guarda solo metadatos de prueba; las API rechazan contraseñas y claves de broker hasta que exista almacenamiento seguro e integración real.

## Estado de la evaluación de Rithmic

La documentación pública oficial anuncia `Rithmic Test` para desarrollar antes de conformance y un Exchange Simulator para paper trading con fills simulados. La API Suite indica que los dev kits de R | API+ y R | Protocol API se solicitan a Rithmic; el acceso, los permisos y los detalles técnicos necesarios para este proyecto todavía no están confirmados. Por eso no hay adaptador ni conexión activa: `PAPER` sigue deshabilitado con `501` y `LIVE` no está implementado. No introduzcas credenciales ni endpoints de producción en el repositorio. Fuentes: [API Suite de Rithmic](https://www.rithmic.com/products/api-suite) y [Exchange Simulator de Rithmic](https://www.rithmic.com/products/exchange-simulator).

## Análisis histórico NQ y ES

El panel incluye una vista **Análisis de Mercado** que importa un CSV por instrumento y calcula lecturas históricas para cada bot configurado. No conecta a un feed ni a un broker y no genera órdenes. Los datos se mantienen en memoria y hay que importarlos de nuevo después de reiniciar Node.

El CSV requiere las columnas `timestamp,open,high,low,close,volume`. Las fechas deben llevar zona horaria explícita (por ejemplo `2026-10-28T13:30:00Z`); el límite es 5 MB y 50.000 velas. Se admite seleccionar el intervalo de origen entre 1m, 5m, 15m, 30m, 1h, 4h y 1d. Se pueden agregar velas a intervalos mayores, pero no crear intervalos menores que el origen; 1m es el formato recomendado para generar todos los intervalos. Los agregados y el VWAP diario usan límites de día UTC, no la sesión de negociación CME.

Cada bot guarda su instrumento (`NQ` o `ES`), estrategia y uno o más intervalos. El análisis técnico calcula EMA 9/21/50, RSI 14, MACD, ATR 14 y VWAP UTC. La detección ICT es una heurística inicial de FVG, ruptura de estructura de las 10 velas previas y killzone NY 09:30–11:30; no equivale a una implementación completa o validada de ICT. SMT compara extremos recientes y requiere que ambos instrumentos tengan velas sincronizadas. Order Flow queda como no disponible hasta contar con datos de transacciones y bid/ask; OHLCV no permite deducirlo.

La pantalla también presenta un backtest histórico: cuando una estrategia encuentra señal, la entrada hipotética se ubica en la apertura de la vela siguiente; el stop se calcula como 1,5 × ATR (mínimo 0,25 puntos) y el TP como 2R. Recorre las velas posteriores hasta tocar uno de los niveles; si una sola vela contiene stop y TP, cuenta primero el stop como criterio conservador. Muestra un gráfico de velas con EMA 9/21/50, VWAP UTC y las zonas de riesgo/beneficio del trade hipotético más reciente; el gráfico usa como máximo 120 velas y se centra en el trade cuando existe. También muestra como máximo las 25 operaciones más recientes por bot e intervalo y prueba señales dentro de las 500 velas más recientes (con hasta 250 velas previas de calentamiento de indicadores); los resultados se recalculan a partir del histórico en memoria. Una operación sin salida al final del archivo queda marcada `NO_EXIT_IN_HISTORY` y su PnL es una valoración no realizada. No se incluyen comisiones, spread ni slippage. Estos supuestos son configuraciones iniciales de demostración, no parámetros validados.

Usa solo CSV de una fuente cuyo uso tengas autorizado. Antes de usar cualquier resultado fuera de pruebas, revisa la calidad y zona horaria del archivo; las señales son informativas, no recomendaciones financieras.

## Velas externas para los gráficos (.env)

El servidor Node puede consultar proveedores externos para dibujar velas en gráficos. Este conector no alimenta el motor de ejecución ni garantiza datos CME en tiempo real. La cuadrícula por bot consulta velas por HTTP aproximadamente cada 60 segundos; el gráfico global mantiene la serie simulada de `/api/market/candles`.

1. **Finnhub**: requiere clave; `MNQ`/`NQ` se mapean a `QQQ`, `ES` a `SPY` (ETFs, no contratos de futuros).
2. **Yahoo Finance**: consulta sin clave mediante símbolos de futuros como `MNQ=F`, `NQ=F`, `ES=F`; disponibilidad y condiciones de uso dependen del proveedor.
3. **Alpha Vantage**: Datos intradía de series temporales.
4. **Sintético (Fallback)**: genera velas ficticias si fallan las fuentes externas. El dashboard no identifica con suficiente claridad este estado; no interpretes sus precios como cotizaciones.

### Configuración en `.env`

Crea un `.env` local en la raíz de `BOT_VPN` (está excluido de Git) si necesitas claves:

```env
MARKET_DATA_PROVIDER=finnhub
FINNHUB_API_KEY=tu_clave_finnhub
ALPHAVANTAGE_API_KEY=tu_clave_alphavantage
CANDLE_INTERVAL=1m
```

Para cambiar de proveedor basta con ajustar `MARKET_DATA_PROVIDER` a `yahoo`, `finnhub` o `alphavantage` y reiniciar el servidor Node (`npm start`).

## Salud de los servicios

Node y FastAPI exponen `GET /healthz`, una comprobación local que verifica el estado SQLite compartido por cada proceso. Responde `200` solo si la persistencia está accesible y el esquema de estado está presente; si SQLite falla, responde `503`. El endpoint Node indica `historical_csv` mientras haya datos CSV cargados en memoria, o `simulated` si no los hay; FastAPI reporta `simulated`. Ningún endpoint verifica conexión a broker, feed en vivo ni precios de mercado en tiempo real. Estos endpoints son para diagnóstico local y no sustituyen monitoreo, métricas ni alertas de producción.

Para arrancar FastAPI en Windows sin activar manualmente el entorno Python, abre otra ventana de PowerShell en `BOT_VPN` y ejecuta:

```powershell
.\run_fastapi.ps1
```

El script crea `.venv` e instala `requirements.txt` si faltan el entorno o las dependencias. También puedes iniciar el gateway haciendo doble clic en `run_fastapi.bat`. No ejecutes `python main.py` directamente con el Python global: ese intérprete puede no tener FastAPI instalado. El servidor escucha en http://127.0.0.1:8000.

Si prefieres usar npm, activa primero el entorno y luego ejecuta:

```powershell
.\.venv\Scripts\Activate.ps1
npm run start:fastapi
```

Para usar la interfaz Node, abre otra ventana de PowerShell en `BOT_VPN` y ejecuta:

```powershell
npm start
```

El script `.\run_server.ps1` también instala las dependencias Node con `npm ci` cuando faltan y arranca ese servidor. Para apagar cualquier servidor, presiona `Ctrl+C` en su terminal.

## Copias de seguridad y restauración

Con la base ya creada, desde `BOT_VPN`:

```powershell
python .\backup_db.py backup .\backups\bot_vpn-backup.sqlite3
python .\backup_db.py verify .\backups\bot_vpn-backup.sqlite3
python .\backup_db.py restore .\backups\bot_vpn-backup.sqlite3 .\bot_vpn-restored.sqlite3
```

La copia usa la API de respaldo de SQLite y comprueba `integrity_check` y el esquema requerido. `restore` nunca sobrescribe un destino existente: crea una base nueva. Para recuperarla, detén ambos servidores, conserva la base actual y arranca los procesos con `$env:BOT_VPN_DB_PATH = (Resolve-Path .\bot_vpn-restored.sqlite3).Path`. Prueba también el procedimiento con datos de prueba antes de depender de él para recuperación.

## Pruebas

Instala las dependencias Python de desarrollo además de las de ejecución:

```powershell
python -m pip install -r requirements-dev.txt
npm test
```

`npm test` ejecuta pruebas automatizadas de inicio, autenticación, migración, persistencia compartida entre Node y Python, conflictos de escritura, exclusión de secretos y respaldo/restauración. Las pruebas usan bases y configuraciones ficticias temporales; no modifican `config.json`.

## Limitaciones actuales

Los precios, posiciones y ejecuciones siguen siendo simulados. La verificación de proxy, cuando se configura, es una comprobación de conectividad independiente y no significa que exista conexión a un broker. No hay integración de broker ni trading en vivo. El panel y el gateway son servidores distintos; levantar uno no levanta el otro. No expongas estos servidores a Internet ni los uses para operar con dinero real.

Aunque ya existe persistencia SQLite local y auditoría básica, todavía faltan límites de riesgo, modo paper conectado a sandbox, TLS, RBAC efectivo, hash de contraseñas, gestor de secretos para producción, sesiones persistidas, visor/retención de auditoría y pruebas de seguridad independientes. Node 22.13 es la versión mínima declarada por el proyecto; la suite de esta fase se ejecutó en Node 24.19 y Python 3.14.6, no en esas versiones mínimas. No consideres esta versión lista para producción ni para operar en vivo.
