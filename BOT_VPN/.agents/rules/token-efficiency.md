---
title: "Directiva de contexto y ahorro de tokens"
doc_type: "regla_para_agentes"
status: "vigente"
summary: "Instrucciones breves para reducir contexto y enlazar a la skill del proyecto."
tags: [quantum-fx, agentes, tokens, reglas]
last_updated: "2026-11-13"
---

# Directiva de contexto y ahorro de tokens

Esta regla asegura que el asistente opere con el mínimo consumo de tokens posible en cada interacción:

1. **Respuestas Concisas y Directas:** No incluir introducciones vacías, frases de cortesía reiterativas ni resúmenes innecesarios.
2. **Edición Mínima:** Al mostrar código en el chat, entregar únicamente el bloque o función editada (nunca reimprimir archivos enteros que consuman contexto innecesario).
3. **Lectura Selectiva:** Al usar `read_file`, especificar siempre rangos acotados (`StartLine` y `EndLine`) para no cargar archivos gigantescos al contexto.
4. **Contexto Limpio:** Cuando la conversación sea larga, sugerir el comando `/compact` para comprimir el historial acumulado.

---
- Relacionado: [[.agents/skills/token-saver/SKILL|Skill Token Saver]] · [[documentacion/AGENTS|Esquema del Agente]] · [[documentacion/00_INICIO_OBSIDIAN|Índice Maestro de la Wiki]]
