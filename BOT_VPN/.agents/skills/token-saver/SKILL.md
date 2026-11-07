---
name: token-saver
description: >-
  Optimiza y reduce drásticamente el consumo de tokens en conversaciones y operaciones.
  Activar para aplicar respuestas ultra-concisas, lecturas de archivos quirúrgicas,
  ediciones mínimas y gestión eficiente del contexto.
---

# Token Saver: Guía de Eficiencia y Reducción de Tokens

Este protocolo establece directivas estrictas para minimizar el consumo de tokens tanto de entrada (contexto) como de salida (generación).

## 1. Reglas de Salida (Output Tokens)
- **Cero relleno (No Fluff):** Omitir introducciones genéricas, cortesías repetitivas o conclusiones obvias. Ir directo a la solución o código solicitado.
- **Respuestas Quirúrgicas:** Si el usuario pide un cambio de código, mostrar únicamente las líneas modificadas o el bloque relevante, nunca el archivo completo a menos que se pida explícitamente.
- **Explicaciones Concretas:** Explicar decisiones técnicas en viñetas cortas de 1 o 2 líneas.

## 2. Reglas de Entrada e Inspección (Input / Context Tokens)
- **Lectura Selectiva (`read_file`):** Nunca volcar archivos de más de 100 líneas al contexto completo si solo se requiere una sección. Usar siempre `StartLine` y `EndLine`.
- **Búsqueda Enfocada:** Utilizar patrones precisos en comandos de búsqueda para evitar respuestas extensas en el terminal que saturen la ventana de contexto.
- **Gestión de Historial:** Cuando el hilo de conversación acumule múltiples tareas o supere los 15-20 turnos, recomendar al usuario ejecutar `/compact` para resumir la memoria y liberar tokens.

## 3. Estrategias de Desarrollo Económico
- **Modelos Flash vs Pro:** Para tareas de soporte, refactorización puntual o lectura, preferir modelos ligeros (como la familia Flash).
- **Subagentes Ligeros:** Si se delegan tareas secundarias de búsqueda, delegar en subagentes con modelo `flash_lite` o `flash` para aislar el contexto.

---
- Relacionado: [[.agents/rules/token-efficiency|Directiva de Ahorro de Tokens]] · [[AGENTS|Esquema del Agente]] · [[wiki/index|Índice Maestro de la Wiki]]
