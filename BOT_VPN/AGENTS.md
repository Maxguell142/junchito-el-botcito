---
title: "Reglas de trabajo del proyecto QUANTUM FX"
doc_type: "instrucciones_para_agentes"
status: "vigente"
summary: "Reglas de código, seguridad y mantenimiento de la documentación."
tags: [quantum-fx, agentes, reglas, seguridad]
last_updated: "2026-11-19"
---

# Reglas de trabajo del proyecto QUANTUM FX

## Proyecto y tecnologías

QUANTUM FX organiza bots y cuentas en una aplicación para Windows y una demo pública en Vercel. Node.js/Express sirve la interfaz HTML/CSS/JavaScript; Electron ofrece la ventana de escritorio. En Windows, Node y el servicio FastAPI opcional usan SQLite; el adaptador Vercel de Node usa Neon para estado y sesiones. El trading de la aplicación es simulado; no afirmar que hay broker, precios CME en vivo o túneles VPN operativos sin confirmación del código.

## Carpetas

- `public/`: interfaz y recursos.
- `src/server/`: servidor Express, persistencia y análisis histórico.
- `src/index.js`: entrada del servidor Express para Vercel.
- `api/index.js`, `vercel.json`: rutas serverless para API, salud y modo demo.
- `src/server/neon-store.js`: persistencia cloud de estado y sesiones en Neon mediante el driver serverless.
- `src/marketData.js`: datos externos o sintéticos para gráficos.
- `fastapi_service/`: servicio FastAPI y motor Python opcional.
- `desktop/`: aplicación Electron.
- `migrations/`: cambios de SQLite.
- `tests/node/`, `tests/python/`: pruebas separadas por servicio.
- `scripts/`: mantenimiento y copias de seguridad.
- `documentacion/`: notas ordenadas por índice, mapa, estado, conceptos, integraciones, estrategias y planificación.
- `raw/`: fuentes originales de la bóveda; es de solo lectura.
- `.obsidian/`: ajustes de Obsidian; la página inicial es `documentacion/00_INICIO_OBSIDIAN.md`.
- `README.md`: guía principal de instalación y uso. El plan y las tareas están en `documentacion/planificacion/`.

## Reglas de trabajo

- Mantener el tema oscuro: fondo `#09090B`, superficies `#101013`, bordes `#27272A`, texto claro y acento verde `#34D399`; rojo solo para errores o acciones destructivas.
- Escribir en español claro, breve y natural. No usar emojis decorativos ni afirmaciones promocionales.
- Preferir HTML, CSS y JavaScript nativos y las dependencias ya declaradas en `package.json` o `requirements.txt`. No añadir frameworks, librerías CDN o dependencias sin una necesidad concreta.
- Explicar cada cambio: qué cambió, por qué, archivos afectados y cómo se verificó.
- Mantener `BOT_VPN/` como raíz de la bóveda Obsidian y `documentacion/00_INICIO_OBSIDIAN.md` como entrada. Si se cambia una ruta, actualizar referencias de código, documentos y enlaces Obsidian.
- Toda nota mantenida en `documentacion/` debe incluir etiquetas YAML (`tags`), resumen (`summary`) y estado (`status`). Al crear o renombrar una nota, actualizar el índice y el historial. No modificar fuentes dentro de `raw/`.
- Tras mover o renombrar notas, verificar los enlaces con `npm run check:docs`.
- Nunca guardar ni copiar secretos, contraseñas, tokens o datos personales a documentación, registros o el repositorio.

Para el flujo detallado de mantenimiento de Obsidian, consulta [las reglas de documentación](documentacion/AGENTS.md).
