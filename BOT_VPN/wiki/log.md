# Bitácora Cronológica de la Wiki (log.md)

Registro cronológico append-only de ingestas, compilaciones, consultas y pasadas de auditoría (lint) de la base de conocimiento de QUANTUM FX.

---

## [2026-10-16] init | Inicialización del Esquema y Repositorio LLM Wiki
- Se definió el esquema maestro `AGENTS.md` con las tres capas (Fuentes Raw, Wiki persistente y Esquema) y protocolos de Ingest, Query y Lint.
- Se configuró la estructura de directorios en `raw/` y `wiki/`.

## [2026-10-16] ingest | Especificación de Requerimientos de Infraestructura y Red
- Ingestada la fuente primaria `raw/system-specifications.md` con los requisitos de ejecución en Windows, aislamiento de sockets SOCKS5, 3 bots iniciales y dashboard en Dark Theme (#0D0D0D).
- Compilada la página de síntesis `wiki/system-overview.md`.
- Compilada la página conceptual `wiki/concepts/socket-level-proxy-isolation.md`.

## [2026-10-16] ingest | Especificaciones del Contrato CME Micro E-mini Nasdaq (MNQ)
- Ingestada la fuente `raw/cme-mnq-specifications.md` con multiplicador de $2.00/punto, tick de 0.25 puntos ($0.50) y ventanas RTH.
- Compilada la página `wiki/concepts/multi-account-order-replication.md` documentando las fórmulas de PnL flotante y control de drawdown.
- Compilada la página `wiki/concepts/new-york-killzones-and-time-filters.md`.

## [2026-10-16] ingest | Guía de Alertas Webhook de TradingView y Pine Script
- Ingestada la fuente `raw/tradingview-webhook-guide.md` con el schema JSON de la alerta y script de ejemplo.
- Compilada la página de estrategia `wiki/strategies/ict-strategy.md` (FVG, MSS, Killzones).

## [2026-10-16] build | Creación de Estrategias Desacopladas (SMT y Order Flow)
- Compilada la página de estrategia `wiki/strategies/smt-strategy.md` (divergencias NQ/ES).
- Compilada la página de estrategia `wiki/strategies/order-flow-strategy.md` (Delta, CVD, desbalances).

## [2026-10-16] ingest | Matriz de Reglas de Prop Firms (Apex, Topstep, Leelo, Blue Guardian)
- Ingestada la fuente `raw/prop-firms-comparison.md` analizando los modelos de trailing drawdown y restricciones de IP.
- Compiladas las páginas de conectores `wiki/connectors/tradovate-api.md` y `wiki/connectors/rithmic-rapi.md`.
- Compilada la página de gestión de riesgo `wiki/prop-firms/apex-topstep-leelo-blueguardian.md`.

## [2026-10-16] lint | Verificación de Consistencia e Integridad de la Wiki
- Validada la ausencia de páginas huérfanas: todas las páginas en `wiki/` están catalogadas en `wiki/index.md` y cuentan con referencias cruzadas bidireccionales.
- Verificado el cumplimiento de formato YAML frontmatter en todos los documentos.
- Estado de la base de conocimiento: Saludable y 100% sincronizada con el código fuente del motor de trading.
