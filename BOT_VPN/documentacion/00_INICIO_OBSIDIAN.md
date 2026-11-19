---
title: "Inicio de la documentación de QUANTUM FX"
doc_type: "indice_principal"
status: "vigente"
summary: "Portada de Obsidian y navegación a guías, estado, mapa y referencias."
tags: [quantum-fx, inicio, indice, obsidian]
last_updated: "2026-11-13"
---

# Inicio de la documentación de QUANTUM FX

Esta es la **página principal de la bóveda**. En Obsidian, empieza aquí. Para instalar o abrir la aplicación, usa el [README principal](../README.md). La guía de estado y el mapa del código separan lo que existe de las ideas de diseño.

## Por dónde empezar

1. [README principal](../README.md): instalación, ejecución, escritorio y privacidad.
2. [[documentacion/02_ESTADO_TECNICO_Y_SALUD|Estado técnico verificado]]: servicios, funciones comprobadas y límites actuales.
3. [[documentacion/01_MAPA_DEL_PROYECTO|Mapa de carpetas y conexiones]]: dónde está cada parte y cómo se relaciona.
4. [[documentacion/03_ARQUITECTURA_CONCEPTUAL|Arquitectura de referencia]]: contexto de diseño; no representa todo lo implementado.
5. [[documentacion/planificacion/TAREAS_PENDIENTES_QUANTUM_FX|Tareas pendientes]], [[documentacion/planificacion/PLAN_DE_IMPLEMENTACION|plan de implementación]] y [[documentacion/planificacion/PLAN_INTEGRACION_ECOSISTEMA_FUTUROS|plan de ecosistema futuros NQ/MNQ]]: trabajo futuro.

## Estructura para orientarse

| Carpeta | Qué contiene |
| --- | --- |
| `src/server/` | Servidor principal Node, base SQLite y análisis CSV. |
| `public/` | Interfaz web y recursos. |
| `desktop/` | Aplicación de escritorio Electron para Windows. |
| `fastapi_service/` | Servicio Python opcional, separado del servidor Node. |
| `tests/node/`, `tests/python/` | Pruebas organizadas por servicio. |
| `scripts/` | Validación de enlaces y mantenimiento de la base. |
| `documentacion/` | Guías, estado verificado, referencias y planificación. |
| `raw/` | Fuentes originales de solo lectura; no editarlas. |
| `.obsidian/` | Configuración de la bóveda y esta página de inicio. |

## Documentos de referencia

| Documento | Tipo y estado |
| --- | --- |
| [[documentacion/02_ESTADO_TECNICO_Y_SALUD]] | Estado comprobado del proyecto. |
| [[documentacion/01_MAPA_DEL_PROYECTO]] | Estructura y rutas vigentes. |
| [[documentacion/03_ARQUITECTURA_CONCEPTUAL]] | Diseño conceptual, no prueba de integraciones activas. |
| [[documentacion/FUENTES_PRIMARIAS_Y_CATALOGO]] | Catálogo descriptivo de archivos originales en `raw/`. |
| [[documentacion/90_HISTORIAL_DE_CAMBIOS]] | Historial cronológico de documentación y estructura. |
| [[documentacion/AGENTS]] | Reglas para mantener las notas y enlaces. |

## Temas

- **Conceptos y límites:** [[documentacion/conceptos/simulacion-y-limites-del-proyecto]], [[documentacion/conceptos/alcance-bots-y-calendario-economico]], [[documentacion/conceptos/replicacion-simulada-multicuenta]], [[documentacion/conceptos/horarios-de-mercado-nueva-york]], [[documentacion/conceptos/diseno-aislamiento-proxy-socks5]], [[documentacion/conceptos/contexto-y-ahorro-de-tokens]].
- **Datos e integraciones:** [[documentacion/integraciones/fuentes-de-datos-para-graficos]], [[documentacion/integraciones/estado-tradovate-api]], [[documentacion/integraciones/estado-rithmic-rapi]].
- **Estrategias de referencia:** [[documentacion/estrategias/referencia-estrategia-ict]], [[documentacion/estrategias/referencia-estrategia-smt]], [[documentacion/estrategias/referencia-estrategia-order-flow]].
- **Reglas de fondeo:** [[documentacion/reglas_de_fondeo/referencia-reglas-apex-topstep-leelo-blueguardian]].

## Mantenimiento y verificación

- Las notas de diseño se identifican con `status: conceptual` o `status: referencia`; no las tomes como funciones implementadas.
- Para validar enlaces Obsidian, ejecuta `npm.cmd run check:docs` desde `BOT_VPN/`.
- [[documentacion/90_HISTORIAL_DE_CAMBIOS|Abrir historial]].
