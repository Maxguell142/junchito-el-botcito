# Índice Maestro de la Wiki (QUANTUM FX)

Catálogo central de conocimientos, arquitectura, conceptos técnicos, estrategias cuantitativas y guías de conectividad del sistema multi-bot de trading de futuros.

---

## 🏛️ 1. Arquitectura del Sistema
| Página | Categoría | Resumen Ejecutivo | Fuentes |
| :--- | :--- | :--- | :--- |
| [[system-overview]] | Arquitectura | Diseño global, desacoplamiento de componentes, FastAPI, WebSocket y orquestación multi-bot. | `raw/system-specifications.md` |

---

## 💡 2. Conceptos de Ingeniería y Red
| Página | Categoría | Resumen Ejecutivo | Fuentes |
| :--- | :--- | :--- | :--- |
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
| [[rithmic-rapi]] | Conectores | Arquitectura de baja latencia R|API+ en Chicago, buffers Protobuf y túnel SOCKS5. | `raw/prop-firms-comparison.md` |

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
- `raw/prop-firms-comparison.md` — Comparativa de reglas de evaluación y drawdown.
