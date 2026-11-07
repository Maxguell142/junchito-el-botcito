# Índice Maestro de la Wiki (QUANTUM FX)

Catálogo central de conocimientos, arquitectura, conceptos técnicos, estrategias cuantitativas y guías de conectividad del sistema multi-bot de trading de futuros.

---

## ⭐ Nota principal: stack y estado del sistema

Empieza por [[stack-and-health|Mapa del sistema, stack y salud]] para consultar los frameworks, las bibliotecas, las herramientas de IA, las diferencias entre lo implementado y lo planificado, y una lista de comprobación local. Esta es la nota principal de la bóveda Obsidian.

---

## 🧭 Navegación Rápida
- **Centro de Control**: [[stack-and-health|Stack y salud]] · [[system-overview|Arquitectura General]] · [[log|Bitácora Cronológica]]
- **Documentación Operativa**: [[README|Guía de Ejecución]] · [[IMPLEMENTATION_PLAN|Plan de Implementación]] · [[PENDIENTES_Y_MEJORAS|Pendientes y Mejoras]] · [[AGENTS|Esquema del Agente]]
- **Políticas de Eficiencia**: [[.agents/rules/token-efficiency|Directiva Ahorro de Tokens]] · [[.agents/skills/token-saver/SKILL|Skill Token Saver]]

---

## 🏛️ 1. Arquitectura y Documentación del Proyecto
| Documento | Ámbito | Resumen Ejecutivo | Fuentes / Referencias |
| :--- | :--- | :--- | :--- |
| [[system-overview]] | Arquitectura | Diseño global, desacoplamiento de componentes, FastAPI, WebSocket y orquestación multi-bot. | `raw/system-specifications.md` |
| [[README]] | Operativa Local | Arranque de Node.js (3008) y FastAPI (8000), persistencia SQLite, scripts PowerShell y testing. | `README.md` |
| [[IMPLEMENTATION_PLAN]] | Roadmap | Plan integral por fases: contenedorización por bot, adaptador Rithmic y seguridad de red. | `IMPLEMENTATION_PLAN.md` |
| [[PENDIENTES_Y_MEJORAS]] | Estado y Backlog | Lista priorizada de mitigaciones de riesgo, modo SIMULATED y tareas pendientes. | `PENDIENTES_Y_MEJORAS.md` |
| [[AGENTS]] | Esquema Wiki | Patrón LLM Wiki de 3 capas, protocolos de Ingest, Query y Lint para el agente. | `AGENTS.md` |
| [[log]] | Bitácora | Historial cronológico append-only de cambios, ingestas y auditorías del sistema. | `wiki/log.md` |

---

## 💡 2. Conceptos de Ingeniería y Red
| Página | Categoría | Resumen Ejecutivo | Fuentes |
| :--- | :--- | :--- | :--- |
| [[custom-bot-engine-and-forexfactory]] | Bots / Macro | Creador de bots libre, verificación multilenguaje (Pine, Python, JS, C#), auto-proxy y feed ForexFactory con filtros de divisas. | `raw/system-specifications.md` |
| [[full-demo-simulation-sandbox]] | Simulación / Demo | Arquitectura de Gemelo Digital, mock APIs residenciales y validación sin riesgo. | `raw/system-specifications.md` |
| [[socket-level-proxy-isolation]] | Red / Networking | Aislamiento de sockets con proxies SOCKS5 en Windows sin alterar la IP anfitriona. | `raw/system-specifications.md` |
| [[multi-account-order-replication]] | Trading Engine | Replicación paralela de órdenes en cuentas con nombres personalizados y matemáticas de MNQ. | `raw/cme-mnq-specifications.md` |
| [[new-york-killzones-and-time-filters]] | Timing / Mercado | Ventanas de horario en hora EST (New York) y filtrado de señales fuera de sesión líquida. | `raw/system-specifications.md` |

---

## 📈 3. Estrategias Cuantitativas Desacopladas
| Página | Categoría | Resumen Ejecutivo | Fuentes |
| :--- | :--- | :--- | :--- |
| [[ict-strategy]] | Estrategias | Fair Value Gaps (FVG), Market Structure Shift (MSS), Killzones y control de ratio R:R. | `raw/tradingview-webhook-guide.md` |
| [[smt-strategy]] | Estrategias | Divergencias Smart Money Tool entre NQ y ES en niveles de toma de liquidez. | `raw/system-specifications.md` |
| [[order-flow-strategy]] | Estrategias | Análisis de subasta, desbalance de Delta institucional, CVD y absorción pasiva. | `raw/system-specifications.md` |

---

## 🔌 4. Conectores Financieros y Brokerages
| Página | Categoría | Resumen Ejecutivo | Fuentes |
| :--- | :--- | :--- | :--- |
| [[tradovate-api]] | Conectores | Integración REST y WebSocket de Tradovate, ciclo de autenticación y tickets de orden. | `raw/prop-firms-comparison.md` |
| [[rithmic-rapi]] | Conectores | Arquitectura de baja latencia R\|API+ en Chicago, buffers Protobuf y túnel SOCKS5. | `raw/prop-firms-comparison.md` |

---

## 🛡️ 5. Empresas de Fondeo y Compliance
| Página | Categoría | Resumen Ejecutivo | Fuentes |
| :--- | :--- | :--- | :--- |
| [[apex-topstep-leelo-blueguardian]] | Prop Firms | Matriz de reglas, modelos de trailing drawdown y prevención de bloqueos de IP. | `raw/prop-firms-comparison.md` |

---

## 📁 6. Fuentes Primarias (Inmutables)
- `raw/system-specifications.md` — Especificación de requerimientos del sistema.
- `raw/cme-mnq-specifications.md` — Ficha técnica oficial del contrato CME MNQ.
- `raw/tradingview-webhook-guide.md` — Guía de alertas JSON y Pine Script.
- `raw/prop-firms-comparison.md` — Comparativa de reglas, trailing stop y condiciones de prop firms.
