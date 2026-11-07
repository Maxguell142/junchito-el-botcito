# AGENTS.md — Schema y Guía Operativa del LLM Wiki

Este documento define la arquitectura, convenciones y protocolos operativos para cualquier Agente LLM que interactúe, mantenga o consulte la base de conocimiento persistente de este repositorio (**QUANTUM FX: Multi-Bot Trading System para Futuros MNQ**).

---

## 1. Filosofía Central: El Patrón LLM Wiki

A diferencia de los sistemas RAG tradicionales (donde el modelo redescubre conocimiento desde cero en cada consulta sin acumular aprendizaje), este proyecto mantiene una **Wiki Persistente y Compuesta**. 
- **Obsidian es el IDE** para el usuario.
- **El Agente LLM es el programador/mantenedor** de la documentación.
- **La Wiki es la base de código de conocimiento**.
- El usuario aporta fuentes primarias (`raw/`), formula preguntas complejas y dirige la investigación. El Agente realiza todo el trabajo mecánico: síntesis, referencias cruzadas, resolución de inconsistencias, indexación y bitácora cronológica.

> 🧭 **Navegación en Obsidian:** [[wiki/stack-and-health|Stack y salud del sistema]] · [[wiki/index|Índice Maestro de la Wiki]] · [[wiki/system-overview|Arquitectura General]] · [[wiki/log|Bitácora Cronológica]] · [[README|Guía de Ejecución Local]]

---

## 2. Arquitectura de Tres Capas

```
BOT_VPN/
│
├── AGENTS.md                 # [CAPA 3: EL ESQUEMA] Reglas y directivas para el Agente LLM
│
├── raw/                      # [CAPA 1: FUENTES PRIMARIAS INMUTABLES]
│   ├── system-specifications.md
│   ├── cme-mnq-specifications.md
│   ├── tradingview-webhook-guide.md
│   └── prop-firms-comparison.md
│
└── wiki/                     # [CAPA 2: LA WIKI PERSISTENTE COMPUESTA]
    ├── index.md              # Catálogo maestro de páginas por categoría
    ├── stack-and-health.md   # Inventario verificado, límites y comprobaciones
    ├── log.md                # Bitácora cronológica append-only
    ├── system-overview.md    # Síntesis ejecutiva y arquitectura global
    │
    ├── concepts/             # Principios de ingeniería y trading
    │   ├── socket-level-proxy-isolation.md
    │   ├── multi-account-order-replication.md
    │   └── new-york-killzones-and-time-filters.md
    │
    ├── strategies/           # Lógica matemática y algorítmica
    │   ├── ict-strategy.md
    │   ├── smt-strategy.md
    │   └── order-flow-strategy.md
    │
    ├── connectors/           # Protocolos de red y APIs financieras
    │   ├── tradovate-api.md
    │   └── rithmic-rapi.md
    │
    └── prop-firms/           # Reglas de fondeo, drawdowns y riesgos
        └── apex-topstep-leelo-blueguardian.md
```

### Capa 1: Fuentes Primarias (`raw/`)
- **Inmutables**: El LLM lee estas fuentes pero **nunca las modifica**.
- Representan especificaciones de brokers, contratos oficiales de CME, documentos de prop firms y requerimientos del usuario.

### Capa 2: La Wiki (`wiki/`)
- **Propiedad del LLM**: El LLM crea, edita, refactoriza y enlaza todos los documentos de este directorio.
- Todo concepto o entidad relevante tiene su propia página.
- Enlaces bidireccionales estilo Markdown/Obsidian (`[Título](ruta.md)` o `[[Título]]`).
- Cada página cuenta con Frontmatter YAML estandarizado (tags, fecha, categoría, fuentes).

### Capa 3: El Esquema (`AGENTS.md`)
- Este archivo. Dicta cómo debe comportarse el Agente ante cualquier solicitud de documentación.

---

## 3. Protocolos Operativos para el Agente LLM

### Protocolo A: Ingesta (`Ingest`)
Cuando el usuario introduzca un nuevo documento en `raw/` o solicite documentar un nuevo componente:
1. **Lectura y Extracción**: Leer el archivo de `raw/` e identificar entidades, parámetros clave, reglas y posibles contradicciones con documentos previos.
2. **Creación o Actualización de Páginas en `wiki/`**:
   - Crear una nueva página en el subdirectorio correspondiente si es una nueva entidad o concepto.
   - Si complementa o contradice información existente, **actualizar las páginas relevantes** agregando notas comparativas explícitas.
3. **Actualización de `wiki/index.md`**: Registrar la página en la tabla de contenidos con su categoría y resumen de una línea.
4. **Registro en `wiki/log.md`**: Añadir una entrada cronológica al final con el formato:
   `## [YYYY-MM-DD] ingest | Título de la fuente o cambio`

### Protocolo B: Consulta y Compilación (`Query`)
Cuando el usuario haga preguntas sobre el sistema o el mercado:
1. Consultar `wiki/stack-and-health.md` para verificar el stack y diferenciar lo implementado de lo planificado; luego usar `wiki/index.md` para navegar.
2. Confirmar las versiones y capacidades en manifiestos, código y pruebas antes de describirlas como activas.
3. Leer los archivos enlazados y sintetizar la respuesta con citas a los archivos de la wiki.
4. **Retroalimentación**: Si la respuesta descubre una relación no documentada, una comparación valiosa o una solución arquitectónica novedosa, **redactarla como una nueva página en `wiki/` o integrarla a una existente**. Las buenas respuestas nunca deben perderse en el historial del chat.
5. Registrar la consulta en `wiki/log.md`:
   `## [YYYY-MM-DD] query | Pregunta o análisis realizado`

### Protocolo C: Auditoría y Salud (`Lint`)
Cuando se solicite una revisión del estado de la base de conocimiento:
1. **Detección de Huérfanos**: Identificar páginas en `wiki/` que no tengan enlaces entrantes ni figuren en `wiki/index.md`.
2. **Detección de Contradicciones**: Contrastar reglas (ej. límites de drawdown de prop firms vs configuraciones de bots).
3. **Validación de Enlaces**: Asegurar que todos los enlaces relativos apunten a archivos existentes.
4. **Detección de Vacíos**: Proponer al usuario nuevas fuentes necesarias o conceptos que merecen su propia página.
5. Registrar la pasada en `wiki/log.md`:
   `## [YYYY-MM-DD] lint | Informe de salud de la wiki`

---

## 4. Convención de Formato de Páginas Wiki

Toda página dentro de `wiki/` debe seguir esta estructura:

```markdown
---
title: Nombre del Concepto o Entidad
category: concepts | strategies | connectors | prop-firms | architecture
tags: [trading, mnq, futures, ...]
last_updated: YYYY-MM-DD
sources: [raw/source1.md, ...]
---

# Nombre del Concepto o Entidad

Breve resumen ejecutivo de 1 o 2 párrafos.

## Detalles Técnicos y Reglas
...

## Referencias Cruzadas y Enlaces Relacionados
- [[system-overview]]
- [[otra-pagina-relevante]]
```
