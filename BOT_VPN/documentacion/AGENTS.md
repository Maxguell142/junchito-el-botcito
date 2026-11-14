---
title: "Reglas de documentación y Obsidian"
doc_type: "instrucciones_de_documentacion"
status: "vigente"
summary: "Convenciones para fuentes, notas, etiquetas, enlaces y verificación."
tags: [quantum-fx, agentes, obsidian, documentacion, reglas]
last_updated: "2026-11-13"
---

# Reglas de documentación y Obsidian

Esta nota contiene el flujo detallado para mantener `documentacion/`. Las reglas breves para cambios de código están en [AGENTS.md](../AGENTS.md). El README principal es [README.md](../README.md); el inicio de Obsidian es [[documentacion/00_INICIO_OBSIDIAN]].

---

## 1. Jerarquía de carpetas

```
BOT_VPN/
│
├── AGENTS.md                 # [CAPA 3: EL ESQUEMA] Reglas y directivas para el Agente LLM
│
├── raw/                      # Fuentes primarias inmutables
│   ├── system-specifications.md
│   ├── cme-mnq-specifications.md
│   ├── tradingview-webhook-guide.md
│   └── prop-firms-comparison.md
│
└── documentacion/                    # Guías, estado, referencias y planificación
    ├── 00_INICIO_OBSIDIAN.md          # Inicio de la bóveda
    ├── 01_MAPA_DEL_PROYECTO.md        # Rutas y conexiones del código
    ├── 02_ESTADO_TECNICO_Y_SALUD.md   # Estado comprobado y límites
    ├── 03_ARQUITECTURA_CONCEPTUAL.md  # Diseño de referencia
    ├── 90_HISTORIAL_DE_CAMBIOS.md     # Historial documental
    ├── conceptos/                     # Simulación, horarios, red y contexto
    ├── integraciones/                 # Datos de gráficos y conectores no activos
    ├── estrategias/                   # Referencias de estrategias
    ├── reglas_de_fondeo/              # Material de prop firms
    └── planificacion/                 # Plan y tareas pendientes
```

### Fuentes originales (`raw/`)
- **Inmutables**: El LLM lee estas fuentes pero **nunca las modifica**.
- Representan especificaciones de brokers, contratos oficiales de CME, documentos de prop firms y requerimientos del usuario.

### Notas de trabajo (`documentacion/`)
- **Propiedad del LLM**: El LLM crea, edita, refactoriza y enlaza todos los documentos de este directorio.
- Todo concepto o entidad relevante tiene su propia página.
- Enlaces bidireccionales estilo Markdown/Obsidian (`[Título](ruta.md)` o `[[Título]]`).
- Cada página mantenida cuenta con Frontmatter YAML: `title`, `doc_type`, `status`, `summary` y `tags`; puede añadir `sources` y `last_updated`.

### Instrucciones del proyecto
- `../AGENTS.md` resume las reglas generales del código y enlaza esta guía de Obsidian.

---

## 2. Reglas para asistentes y documentación

- `status: verificado` significa que la afirmación se comprobó en el código o con una revisión técnica reciente.
- `status: conceptual` y `status: referencia` identifican material de diseño o estudio; no prueban que una función esté conectada.
- `status: planificado` identifica trabajo futuro; `status: vigente` indica que la guía o regla sigue activa; `status: historico` marca una bitácora.
- No copiar secretos, cuentas, datos personales o credenciales a notas.
- No cambiar los nombres ni el contenido de archivos bajo `raw/` sin autorización específica; enlazarlos desde la documentación.

## 3. Protocolos operativos

### Protocolo A: Ingesta (`Ingest`)
Cuando el usuario introduzca un nuevo documento en `raw/` o solicite documentar un nuevo componente:
1. **Lectura y Extracción**: Leer el archivo de `raw/` e identificar entidades, parámetros clave, reglas y posibles contradicciones con documentos previos.
2. **Creación o Actualización de Páginas en `documentacion/`**:
   - Crear una nueva página en el subdirectorio correspondiente si es una nueva entidad o concepto.
   - Si complementa o contradice información existente, **actualizar las páginas relevantes** agregando notas comparativas explícitas.
3. **Actualización de `documentacion/00_INICIO_OBSIDIAN.md`**: Registrar la página en la tabla de contenidos con su categoría y resumen de una línea.
4. **Registro en `documentacion/90_HISTORIAL_DE_CAMBIOS.md`**: Añadir una entrada cronológica al final con el formato:
   `## [YYYY-MM-DD] ingest | Título de la fuente o cambio`

### Protocolo B: Consulta y Compilación (`Query`)
Cuando el usuario haga preguntas sobre el sistema o el mercado:
1. Consultar `documentacion/02_ESTADO_TECNICO_Y_SALUD.md` para verificar el stack y diferenciar lo implementado de lo planificado; luego usar `documentacion/00_INICIO_OBSIDIAN.md` para navegar.
2. Confirmar las versiones y capacidades en manifiestos, código y pruebas antes de describirlas como activas.
3. Leer los archivos enlazados y sintetizar la respuesta con citas a los archivos de la wiki.
4. **Retroalimentación**: Si la respuesta descubre una relación no documentada, una comparación valiosa o una solución arquitectónica novedosa, **redactarla como una nueva página en `documentacion/` o integrarla a una existente**. Las buenas respuestas nunca deben perderse en el historial del chat.
5. Registrar la consulta en `documentacion/90_HISTORIAL_DE_CAMBIOS.md`:
   `## [YYYY-MM-DD] query | Pregunta o análisis realizado`

### Protocolo C: Auditoría y Salud (`Lint`)
Cuando se solicite una revisión del estado de la base de conocimiento:
1. **Detección de Huérfanos**: Identificar páginas en `documentacion/` que no tengan enlaces entrantes ni figuren en `documentacion/00_INICIO_OBSIDIAN.md`.
2. **Detección de Contradicciones**: Contrastar reglas (ej. límites de drawdown de prop firms vs configuraciones de bots).
3. **Validación de Enlaces**: Asegurar que todos los enlaces relativos apunten a archivos existentes.
4. **Detección de Vacíos**: Proponer al usuario nuevas fuentes necesarias o conceptos que merecen su propia página.
5. Registrar la pasada en `documentacion/90_HISTORIAL_DE_CAMBIOS.md`:
   `## [YYYY-MM-DD] lint | Informe de salud de la wiki`

---

## 4. Convención de formato de notas

Toda página dentro de `documentacion/` debe seguir esta estructura:

```markdown
---
title: Nombre del Concepto o Entidad
doc_type: referencia | guia | arquitectura | estado | planificacion
status: verificado | conceptual | referencia | planificado
summary: Explica en una frase qué contiene esta nota.
tags: [quantum-fx, tema-principal, tema-secundario]
category: conceptos | estrategias | integraciones | reglas_de_fondeo | arquitectura
last_updated: YYYY-MM-DD
sources: [raw/nombre-de-fuente.md]
---

# Nombre del Concepto o Entidad

Breve resumen ejecutivo de 1 o 2 párrafos.

## Detalles Técnicos y Reglas
...

## Referencias Cruzadas y Enlaces Relacionados
- [[documentacion/03_ARQUITECTURA_CONCEPTUAL]]
- [[documentacion/00_INICIO_OBSIDIAN]]
```
