---
title: "Guía principal del proyecto QUANTUM FX"
doc_type: "readme_principal"
status: "vigente"
summary: "Instalación, ejecución, privacidad y estructura de la aplicación para Windows."
tags: [quantum-fx, readme, instalacion, windows, inicio]
last_updated: "2026-11-13"
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

La aplicación guarda datos en SQLite, un archivo de base de datos local. La aplicación de escritorio guarda su base de datos y la clave de cifrado en el perfil del usuario de Windows. Los perfiles con datos personales se cifran; para registrarlos o editarlos, usa la aplicación de escritorio (`npm run start:desktop`), que habilita el cifrado del sistema. El servidor abierto con `npm start` no habilita esa función por sí solo. No compartas `.env`, `config.json`, bases de datos ni credenciales. Las carpetas `raw/` y `documentacion/` pertenecen a la bóveda Obsidian; `raw/` contiene fuentes de solo lectura.

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

## Publicación

No encontré una dirección pública confirmada para el proyecto. Por ahora, el panel se ejecuta localmente en Windows.
