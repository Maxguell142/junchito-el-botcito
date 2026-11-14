---
title: "Contexto del proyecto y ahorro de tokens"
category: conceptos
tags: [codex, mcp, tokens, efficiency, architecture, fastapi, cursorrules, interfaces, quantum-fx, agentes, contexto]
last_updated: "2026-11-13"
sources: [raw/system-specifications.md]
doc_type: "guia_de_contexto"
status: "referencia"
summary: "Resume herramientas y convenciones de asistencia; no define contratos de ejecución."
---

# Contexto del proyecto y ahorro de tokens

> **Estado: guía de desarrollo.** Las recomendaciones no son dependencias ni componentes ejecutados por la aplicación.


Este documento compila el análisis técnico de las recomendaciones de modularidad, reducción drástica de consumo de contexto y herramientas MCP para el desarrollo acelerado de **INVICTUS TRADING OS / QUANTUM FX** mediante agentes de Inteligencia Artificial (OpenAI Codex, Antigravity y Cursor).

---

## 1. Estado real de las propuestas

Al trabajar con modelos avanzados de código (Codex, GPT-4o, Claude 3.5 Sonnet):
- La cifra de ahorro de tokens de 15.000–40.000 por prompt y la reducción del 40–50% no están medidas en este repositorio; no deben presentarse como resultados comprobados.
- `BOT_VPN/.cursorrules` fija límites útiles para Cursor, pero Codex toma las instrucciones persistentes desde `AGENTS.md` y skills. La guía de Codex está en `AGENTS.md` y `.agents/skills/token-saver/SKILL.md` en la raíz del workspace.
- Se retiró `types/financial_types.ts` al reorganizar el proyecto: no tenía importaciones, compilador TypeScript ni uso en el paquete de escritorio. Los contratos reales siguen en las rutas y el esquema SQLite; no tomar interfaces inventadas como fuente de verdad.
- El ahorro inmediato y verificable viene de instrucciones cortas, `rg`, lectura selectiva y consultar `documentacion/02_ESTADO_TECNICO_Y_SALUD.md` antes de explorar código. Los contratos solo reducen retrabajo cuando se generan o verifican contra los modelos reales.

---

## 2. Análisis de Frameworks Propuestos

| Framework Propuesto | Estado en el Proyecto | Dictamen y Recomendación |
| :--- | :--- | :--- |
| **FastAPI + Asyncio (Python)** | Servicio opcional existente en el puerto 8000; independiente del dashboard Node | Mantenerlo para las funciones que ya atiende. El código actual no justifica declararlo motor definitivo de órdenes: no hay ejecución real con broker. |
| **Next.js / Tailwind / Shadcn UI** | No instalado; UI actual en HTML/CSS/JS | No migrar por anticipado. Revisar solo si una necesidad concreta supera el costo de reemplazar la UI existente. |
| **Python subprocess + OpenVPN/WireGuard** | No demostrado como orquestación operativa en el código | No instalar ni ejecutar túneles ahora. Diseñar esa integración cuando exista requerimiento operativo y se definan límites de seguridad y aislamiento en Windows. |
| **Tipos TypeScript** | Se retiró un borrador huérfano sin compilador ni integración | No se usa como contrato. Si se necesitan tipos más adelante, generarlos o validarlos contra API/SQLite. No instalar TypeScript sin una necesidad concreta. |

---

## 3. Servidores MCP (Model Context Protocol) Recomendados

Para dotar a Codex y Antigravity de máxima velocidad sin inflar la ventana de contexto:

1. **Búsqueda de código**: Codex ya puede usar `rg` y leer archivos locales de forma selectiva; no se necesita instalar otro MCP para esta capacidad.
2. **Terminal local**: La ejecución de comandos está disponible en el entorno. Un MCP de escritorio solo tendría sentido si faltara una operación concreta de Windows que no se pueda realizar con las herramientas actuales.
3. **Secretos / Vault**: No conectar un MCP que exponga credenciales del broker al contexto del modelo. Mantener secretos en un gestor local separado y usar valores simulados en desarrollo; no guardar claves en `.env` si el asistente puede leer ese archivo.
4. **Documentación externa**: No hay Context7/Valyu disponible en las herramientas actuales. Para tareas que necesiten versiones o APIs vigentes, buscar documentación oficial en la web; no instalar una integración permanente hasta que el uso repetido lo justifique.
5. **GitHub**: Añadir integración solo si el proyecto tiene un remoto/flujo de Issues o PRs que Codex deba gestionar; no es requisito para ahorrar contexto en el checkout local.

### Decisión de instalación

No se agregaron dependencias de runtime ni servidores MCP: las capacidades necesarias para buscar y editar el repositorio ya están disponibles, y los demás elementos son condicionales o implican acceso sensible. La guía compacta de Codex está en `.agents/skills/token-saver/SKILL.md` en la raíz del workspace; la de Cursor sigue en `BOT_VPN/.cursorrules`.

---

## 4. Referencias Cruzadas y Enlaces Relacionados
- [[documentacion/00_INICIO_OBSIDIAN|Índice Maestro de la Wiki]]
- [[documentacion/02_ESTADO_TECNICO_Y_SALUD|Mapa del Sistema, Stack y Salud]]
- [[documentacion/conceptos/alcance-bots-y-calendario-economico|Motor de Bots y Feed ForexFactory]]
- [[documentacion/conceptos/diseno-aislamiento-proxy-socks5|Aislamiento de Sockets y Red Residencial]]
- [[documentacion/90_HISTORIAL_DE_CAMBIOS|Bitácora Cronológica de Cambios]]
