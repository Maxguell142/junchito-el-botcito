# BOT_VPN — ejecución local

La lista priorizada de trabajo pendiente está en [Pendientes y mejoras](./PENDIENTES_Y_MEJORAS.md); el plan ampliado está en [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md).

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

## Salud de los servicios

Node y FastAPI exponen `GET /healthz`, una comprobación local que verifica el estado SQLite compartido por cada proceso. Responde `200` solo si la persistencia está accesible y el esquema de estado está presente; si SQLite falla, responde `503`. La respuesta indica explícitamente `SIMULATED`, broker `disabled` y datos de mercado `simulated`; no verifica ni afirma conectividad con el broker o con mercados reales. Estos endpoints son para diagnóstico local y no sustituyen monitoreo, métricas ni alertas de producción.

Para instalar y arrancar FastAPI:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
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
