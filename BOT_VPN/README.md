---
title: "Guía principal del proyecto QUANTUM FX"
doc_type: "readme_principal"
status: "vigente"
summary: "Instalación, ejecución, privacidad y estructura de la aplicación para Windows."
tags: [quantum-fx, readme, instalacion, windows, inicio]
last_updated: "2026-11-19"
---

# Guía principal del proyecto QUANTUM FX

QUANTUM FX es una aplicación local para organizar bots de trading y revisar resultados simulados. Está pensada para una persona que administra sus bots, cuentas y registros desde Windows.

## Qué permite hacer

- Ver bots, horarios, balances y estados en un panel.
- Registrar titulares, cuentas y movimientos financieros.
- Consultar gráficos y un calendario económico.
- Importar archivos CSV de precios históricos para hacer análisis hipotéticos.
- Usar una aplicación de escritorio para Windows o abrir el panel en el navegador.

**Importante:** las órdenes y los resultados del motor principal son simulados. El proyecto no acredita una conexión activa con un broker ni un feed CME en vivo. Los datos externos usados en algunos gráficos pueden ser aproximaciones o datos sintéticos.

### Cómo usar el análisis histórico

En **Análisis**, carga un CSV de velas para comparar las estrategias seleccionadas en tus bots con precios pasados. El archivo necesita columnas `timestamp`, `open`, `high`, `low`, `close` y `volume`; puedes usar datos de 1 minuto y elegir el instrumento y el intervalo de origen. Si las fechas no incluyen `Z` ni un desplazamiento como `-04:00`, selecciona la zona horaria en que el proveedor guardó esas fechas. Los valores con zona incluida se interpretan tal como vienen.

La pantalla muestra indicadores, señales y operaciones hipotéticas con entrada, stop y objetivo. Sirve para explorar y revisar una estrategia; no predice resultados ni envía órdenes. El CSV queda en memoria hasta reiniciar el servidor. Con velas OHLCV no se puede calcular Order Flow real porque faltan transacciones y datos bid/ask.

## Instalar y ejecutar en Windows

1. Instala Node.js 22.13 o posterior.
2. Abre PowerShell en la carpeta `BOT_VPN/`.
3. Instala las dependencias: `npm ci`.
4. Inicia el panel: `npm start`.
5. Abre [http://127.0.0.1:3008](http://127.0.0.1:3008).

Para iniciar la aplicación de escritorio en modo desarrollo, ejecuta `npm run start:desktop`. Para generar el instalador de Windows, ejecuta `npm run dist:win`; el archivo se crea en `dist-desktop/`.

### Servicio Python opcional

El servicio FastAPI es un servidor adicional y separado; el panel Node no lo necesita. Requiere Python 3.10 o posterior. En PowerShell ejecuta `./run_fastapi.ps1`; también puedes abrir `run_fastapi.bat`. Su dirección local es [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Datos y privacidad

La aplicación de escritorio guarda datos en SQLite en el perfil de Windows y cifra los perfiles personales con una clave local. El modo alojado en Vercel usa Neon para conservar el estado, el ledger y las sesiones entre solicitudes; los perfiles personales y los registros financieros solo se pueden guardar si `BOT_VPN_PII_ENCRYPTION_KEY` está configurada como variable sensible en Vercel.

Si Neon no tiene estado previo, la versión alojada crea dos titulares, tres bots y movimientos ficticios para la maqueta; nunca importa el archivo SQLite local ni sus perfiles. Los perfiles y el ledger se cifran con `BOT_VPN_PII_ENCRYPTION_KEY`. La clave debe tener 64 caracteres hexadecimales y conservarse para poder leer los perfiles guardados. No ingreses información real en la maqueta ni pegues credenciales o claves en el código, los documentos o el chat.

Las cuentas del panel se guardan por separado en Neon y sus contraseñas se almacenan con hash scrypt. `BOT_VPN_AUTH_USERNAME` y `BOT_VPN_AUTH_PASSWORD` conservan el acceso anterior: al configurarse el administrador nuevo en `BOT_VPN_ADMIN_USERNAME` (opcional; por defecto `V8`) y `BOT_VPN_ADMIN_PASSWORD` (variable sensible, mínimo 12 caracteres), ese acceso anterior pasa a ser de usuario normal. Sin la variable de contraseña del administrador nuevo, se mantiene como admin para evitar bloquear el acceso. Las altas públicas quedan pendientes hasta que un administrador las apruebe. Congelar una cuenta revoca sus sesiones.

Si olvidaste la contraseña de una cuenta existente, no se puede recuperar desde la base porque solo se guarda su hash. Para restablecer el mismo usuario en SQLite local y Neon, ejecuta `node scripts/reset-user-password.js --username V8 --target both` desde `BOT_VPN/`. El programa pide confirmación y solicita la nueva contraseña sin mostrarla ni guardarla. Debes tener acceso a la URL de conexión de Neon; si no está en las variables de entorno, el programa la pedirá de forma oculta. Cambia `V8` por el usuario que corresponda. Para actualizar solo un entorno, usa `--target local` o `--target vercel`.

No compartas `.env`, `config.json`, bases de datos ni credenciales. Las carpetas `raw/` y `documentacion/` pertenecen a la bóveda Obsidian; `raw/` contiene fuentes de solo lectura.

## Demo pública alojada en Vercel

La demo está disponible en [quantum-fx-pi.vercel.app](https://quantum-fx-pi.vercel.app/). El proyecto `quantum-fx` usa `BOT_VPN/` como carpeta raíz, Node 22 y Neon como persistencia. La API del entorno alojado usa consultas HTTP periódicas; el modo de escritorio conserva su WebSocket local. Para ingresar, usa el usuario y la contraseña compartidos para la maqueta. La base cloud se mantiene separada de los datos locales y contiene solo datos ficticios iniciales.

## Tecnologías

- Node.js y Express: servidor principal y API (los puntos de conexión que usa la interfaz).
- HTML, CSS y JavaScript: panel web, sin React ni otro framework de interfaz.
- Electron: ventana de escritorio para Windows.
- Python, FastAPI y SQLite: servicio alternativo opcional y almacenamiento local.
- Obsidian: bóveda de notas, con inicio en [[documentacion/00_INICIO_OBSIDIAN|el índice de la wiki]].

## Organización del proyecto

- `public/`: páginas, estilos, scripts y recursos de la interfaz.
- `src/server/`: servidor Express, base de datos y análisis histórico.
- `src/marketData.js`: proveedor de datos para gráficos.
- `fastapi_service/`: servidor y lógica del servicio Python.
- `desktop/`: aplicación Electron.
- `migrations/`: cambios del esquema de la base de datos.
- `tests/node/` y `tests/python/`: pruebas organizadas por servicio.
- `scripts/`: herramientas de mantenimiento, como copia de seguridad.
- `documentacion/`: todas las notas de Obsidian, ordenadas por tema. La entrada es [00_INICIO_OBSIDIAN.md](documentacion/00_INICIO_OBSIDIAN.md).
- `raw/`: fuentes originales de referencia, conservadas sin editar.

Para recorrer la arquitectura, abre [[documentacion/01_MAPA_DEL_PROYECTO|el mapa del código]] o [[documentacion/02_ESTADO_TECNICO_Y_SALUD|el estado técnico verificado]]. El [plan](documentacion/planificacion/PLAN_DE_IMPLEMENTACION.md) y las [tareas pendientes](documentacion/planificacion/TAREAS_PENDIENTES_QUANTUM_FX.md) están dentro de `documentacion/planificacion/`.

### Webhook local de prueba

El endpoint `/api/webhook` solo crea operaciones **simuladas** y exige un secreto de al menos 32 caracteres. Node escucha en `127.0.0.1`, por lo que una alerta de TradingView en la nube no puede conectarse directamente; no expongas el puerto a Internet. Para pruebas locales, genera un secreto con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, guárdalo como `QUANTUM_WEBHOOK_SECRET` en tu `.env` local y úsalo en el campo `token` del JSON. La plantilla está en [.env.example](.env.example).

## Publicación

No encontré una dirección pública confirmada para el proyecto. Por ahora, el panel se ejecuta localmente en Windows.
