# PLAN DE IMPLEMENTACIÓN: SISTEMA MULTI-BOT, PERSISTENCIA Y OPERACIÓN SEGURA

## 1. Objetivo final

Crear un sistema de trading automatizado multi-bot, seguro, aislado y escalable, donde cada bot:

- corra en un contenedor Docker independiente
- use solo rutas de red permitidas por el broker y el operador
- tenga su propia identidad, cuentas y estrategia
- se conecte con APIs reales del broker
- ejecute órdenes reales bajo reglas de riesgo y control
- se comunique con un orchestrator central
- sea monitoreado desde una aplicación de escritorio nativa

El sistema no debe depender de una página web simple ni de estado en memoria. Debe estar diseñado como una plataforma robusta de producción con componentes aislados, permisos estrictos, persistencia, seguridad y monitoring.

> **Estado real:** este documento conserva el objetivo arquitectónico propuesto, no describe funciones ya implementadas. Las afirmaciones históricas sobre ausencia de persistencia o auditoría quedan superadas por la Fase 3 de la sección 14. El producto continúa en desarrollo local: no está conectado a un broker ni autorizado para operar en vivo.

---

## 2. Qué falta para que funcione al 100%

### 2.1 Infraestructura por bot

Actualmente el proyecto tiene un gestor central que simula bots en un único proceso. Eso no es suficiente para un entorno real.

Falta:

- cada bot en un contenedor independiente
- cada bot con su propio entorno de ejecución
- cada bot con configuración aislada en variables de entorno o archivos secretos
- políticas de red aprobadas y documentadas por bot
- cada bot con control separado de logs, health checks y errores

Sin esto, todos los bots comparten la misma base de ejecución y no hay aislamiento real.

### 2.2 Seguridad de red y cumplimiento

Toda conexión debe respetar las condiciones del broker, exchange, jurisdicción y empresa de fondeo. No se crearán túneles, rotación de IP ni perfiles de red para ocultar identidades, evitar detección o eludir restricciones. Una VPN solo se considerará si el proveedor y el operador la autorizan expresamente para seguridad o conectividad.

Falta:

- documentar destinos, puertos y métodos de conexión permitidos por el proveedor
- aplicar mínimo privilegio y limitar la salida de red a esos destinos
- verificar y mostrar el estado real de la conexión, sin inferirlo por una IP o una VPN configurada
- fallar de forma segura ante una desconexión, sin cambiar automáticamente de región o ruta

### 2.3 Ejecución real de órdenes

El proyecto actual simula ejecuciones con sleeps y cambios de estado en memoria.

Falta:

- autenticación real con broker
- conexión con la API real de cada broker
- manejo de sesiones, tokens y refresh tokens
- order placement real
- obtención real de posiciones, balances y notificaciones
- manejo real de slippage, fills, rejections y errores

Esto es esencial: sin integración real con broker, no hay operación real.

### 2.4 Persistencia y trazabilidad

El sistema actual no tiene una base de datos persistente ni auditoría real.

Falta:

- PostgreSQL para datos operativos
- Redis para colas, jobs y eventos en tiempo real
- historial de trades por bot
- registros de señales recibidas
- logs de errores y acciones de cada bot
- snapshots de estado de cada cuenta y bot
- auditoría de cambios de configuración

### 2.5 Seguridad en producción

Esto es no negociable.

Falta:

- secretos en variables de entorno o vault, no en archivos del repositorio
- no hardcodear tokens, usernames, passwords, keys ni credenciales
- TLS para comunicación entre servicios
- autenticación y autorización en la API central
- RBAC por usuario/rol
- rate limiting en endpoints públicos
- validación rigurosa de payloads
- sanitización y auditoría de entrada de datos
- mTLS o token JWT para servicios internos
- registro seguro de eventos y errores
- allowlists de IPs / redes / brokers / conexiones

### 2.6 Aplicación de escritorio, no página web

El sistema debe ser una app de escritorio real, no una web app simple.

Falta:

- app nativa o híbrida de escritorio
- login seguro local del operador
- dashboard de bots, VPN, estado, señales, riesgo global
- panel de control por bot
- eventos en tiempo real
- view global de estado y emergencias

Para esto la mejor opción es una app desktop moderna y ligera, no un navegador.

### 2.7 Orquestación y control global

Falta:

- central orchestrator con API robusta
- gestión de jobs por bot
- cola de señales por bot
- sistema de health checks global
- control de emergencia global
- auto-recovery por bot
- fallback si un bot falla
- sincronización de configuración a través de servicios

### 2.8 Observabilidad

Falta:

- logs centralizados
- métricas por bot y sistema
- alertas por umbral de pérdida y desconexión
- trazabilidad de eventos
- exportación de logs y backup
- health dashboard y alertas de monitoreo

---

## 3. Arquitectura final recomendada

### 3.1 Vista de alto nivel

```text
+-------------------+
| Desktop App       |
| Tauri + React     |
| - Login           |
| - Dashboard       |
| - Control         |
| - Alerts          |
+---------+---------+
          |
          v
+-------------------+
| Gateway API       |
| FastAPI           |
| Auth / RBAC       |
| WebSocket         |
| Signal router     |
| Emergency control  |
+---------+---------+
          |
          v
+-------------------+
| Message Bus       |
| Redis / RabbitMQ  |
| Signal queue      |
| Event streaming   |
+---------+---------+
          |
          v
+-------------------+
| Bot 1 Container   |
| VPN A             |
| Strategy A        |
| Broker adapter    |
| Risk engine       |
+-------------------+

+-------------------+
| Bot 2 Container   |
| VPN B             |
| Strategy B        |
| Broker adapter    |
| Risk engine       |
+-------------------+

+-------------------+
| Bot 3 Container   |
| VPN C             |
| Strategy C        |
| Broker adapter    |
| Risk engine       |
+-------------------+

          |
          v
+-------------------+
| Broker APIs       |
| Tradovate / Rithmic |
| Real market data  |
| Real position data|
+-------------------+
```

### 3.2 Módulos funcionales

#### 3.2.1 Gateway / Orchestrator

Responsable de:

- autenticación y login
- gestión de bots
- envío de señales
- control de sesiones
- health checks
- emergencias globales
- dashboards y snapshots
- API para app y bots

#### 3.2.2 Signal Router

Responsable de:

- distinguir quién debe recibir la señal
- encolar eventos por bot id
- validar permisos y rol del operario
- reintentar envío si falla
- registrar trazabilidad

#### 3.2.3 Bot Runtime

Cada bot tendrá su propio runtime con:

- estrategia específica
- horario operativo
- configuración de riesgo
- broker adapter
- VPN / red específica
- logs y eventos exclusivos

#### 3.2.4 Broker Adapter Layer

Cada broker tendrá un adapter específico:

- TradovateAdapter
- RithmicAdapter
- ExchangeAdapter
- PropFirmAdapter

Cada adapter tendrá:

- login/session
- market data
- order execution
- open positions
- order book / fills
- connect/disconnect health status
- security policies

#### 3.2.5 Risk Engine

Responsable de:

- validar tamaño de posición
- validar stop loss / take profit
- validar exposición total
- bloquear trades fuera de límites
- aplicar guardrails por identity, account, prop firm
- evitar overtrade

#### 3.2.6 VPN / Network Isolation Layer

La capa de red debe cumplir las condiciones documentadas del proveedor y del operador. No se requiere una IP pública distinta por bot. Una VPN solo se usa si está expresamente autorizada:

- control de destinos y puertos permitidos
- monitor de latencia
- estado verificable de la ruta autorizada
- recuperación sin cambiar a rutas o regiones no autorizadas
- aislamiento de red por namespace

#### 3.2.7 App Desktop

La app de escritorio debe ser la capa operativa del operador:

- login seguro
- visualización global
- ver status de cada bot
- ver saldo, PnL, contratos, posiciones
- editar configuración de bots
- activar/desactivar sesiones
- botón de emergency stop
- ver logs y alertas
- ver estado de VPN y conexiones

---

## 4. Stack recomendado

### 4.1 Frontend app desktop

Opción recomendada:

- Tauri 2 + React + TypeScript

Por qué:

- es más ligero que Electron
- mejor rendimiento
- mejor seguridad de capa nativa
- menor consumo de memoria
- packaging más limpio para desktop

Alternativa:

- Flutter + Dart

Si el objetivo es una app visual potente y cross-platform, Flutter es muy sólido. Pero para un sistema industrial con control de backend y servicios, Tauri + React suele ser más directo y ligero.

### 4.2 Backend central

- Python 3.12+
- FastAPI
- Pydantic v2
- SQLAlchemy / async SQLAlchemy
- Uvicorn
- JWT / OAuth2

### 4.3 Servicios auxiliares

- PostgreSQL: persistencia de trades, bots, usuarios, cuentas, logs
- Redis: colas, eventos, state cache, rate limiting
- Docker + Docker Compose: aislamiento de bots
- VPN o túnel seguro solo si el proveedor lo autoriza expresamente
- Prometheus + Grafana o Loki: monitoring y observabilidad

### 4.4 Bot runtime

- Python 3.12+
- FastAPI o ASGI worker interno
- strategy module isolated per bot
- broker adapters
- network manager module
- risk engine module
- event publisher

### 4.5 Seguridad

- Hashing de contraseñas con bcrypt/argon2
- JWT con expiración corta y refresh token
- TLS mTLS entre servicios internos
- secret manager (Docker secrets / Azure Key Vault / AWS Secrets Manager / Doppler / Infisical)
- no archivos de secretos dentro del repo
- RBAC
- network ACLs

---

## 5. Seguridad: reglas no negociables

### 5.1 Secretos

Nunca hacer:

- credenciales hardcodeadas en código
- `config.json` con datos reales en Git
- variables en archivos de entorno del repositorio
- tokens visibles en logs

Sí hacer:

- `.env.example` solo como plantilla sin valores reales
- servicios secretos gestionados por vault
- rotación periódica de tokens
- almacenamiento cifrado de secrets

### 5.2 APIs

- exigir autenticación en todos los endpoints sensibles
- usar JWT con scopes por rol
- limitar permisos por acción
- validar todos los payloads con schemas estrictos
- responder sin revelar detalles internos a clientes no autorizados

### 5.3 Red

- aplicar políticas de salida permitidas y documentadas por el proveedor
- limitar comunicación entre contenedores usando network isolation
- bloquear salida a Internet no autorizada
- usar firewalls y reglas de egress
- evitar acceso directo del host a credenciales del broker

### 5.4 Logging

- no registrar secretos ni passwords en texto plano
- mascarar credenciales y tokens en logs
- mantener auditoría de acciones críticas
- especificar quién ejecutó cada cambio

### 5.5 Error handling

- no exponer stack traces a clientes
- manejar retries con backoff
- circuit breakers para broker / VPN / network
- fallback seguro si falla un bot

---

## 6. Estructura de proyecto recomendada

```text
BOT_VPN/
├── app/                          # App de escritorio (Tauri + React)
│   ├── src/
│   ├── src-tauri/
│   └── package.json
├── gateway/
│   ├── app/
│   ├── api/
│   ├── core/
│   ├── auth/
│   ├── brokers/
│   ├── config/
│   └── requirements.txt
├── bots/
│   ├── bot_1/
│   │   ├── Dockerfile
│   │   ├── config.yaml
│   │   ├── vpn/
│   │   ├── strategy/
│   │   ├── risk/
│   │   └── worker.py
│   ├── bot_2/
│   └── bot_3/
├── common/
│   ├── models/
│   ├── schemas/
│   ├── utils/
│   └── security/
├── infra/
│   ├── docker-compose.yml
│   ├── postgres/
│   ├── redis/
│   ├── wireguard/
│   └── monitoring/
├── db/
│   ├── migrations/
│   └── seeds/
├── docs/
│   ├── architecture.md
│   ├── broker-integration.md
│   ├── security.md
│   └── runbook.md
├── .env.example
├── .gitignore
├── README.md
└── IMPLEMENTATION_PLAN.md
```

---

## 7. Flujo operacional final

### 7.1 Arranque del sistema

1. se levanta PostgreSQL
2. se levanta Redis
3. se levantan los servicios del gateway
4. la app desktop se conecta al gateway
5. cada bot se levanta en su contenedor
6. cada bot aplica la política de red autorizada y documentada
7. cada bot valida conectividad al broker
8. cada bot queda listo para recibir señales

### 7.2 Recepción de señal

1. una señal entra por la app o por webhook externo
2. la API central valida token y permisos
3. el signal router decide a qué bot va
4. se encola el evento en Redis
5. el bot recibe la tarea
6. el bot valida horario, estrategia, riesgo y cuenta
7. el bot ejecuta la orden en broker real
8. el bot devuelve estado al gateway
9. el gateway actualiza base de datos y dashboard

### 7.3 Control de emergencia

- stop all bots
- flatten all positions
- kill switch por identidad o por bot
- cierre forzado de conexiones
- bloqueo de nuevas órdenes
- alertas inmediatas a la app

### 7.4 Recuperación ante fallo

- si falla una VPN autorizada o una ruta de red, se marca como degraded y no se cambia a una ruta no aprobada
- si falla el broker, se reintenta con backoff
- si falla la app, se conserva la sesión y la infraestructura central
- si fallece un bot, el sistema sigue operando con el resto

---

## 8. Fases de implementación

### Fase 1: Base segura y operativa

- definir estructura de repositorio
- crear gateway FastAPI seguro
- crear base de datos PostgreSQL
- definir esquema de usuarios, roles, bots, cuentas, trades
- crear auth JWT y RBAC
- crear logging centralizado
- crear .env y gestión de secrets

### Fase 2: Orquestación y middleware

- Redis y colas de señales
- WebSocket para dashboard
- endpoint de health checks
- bot status manager
- control de emergencia global
- configuración centralizada por bot

### Fase 3: Docker + bot runtime

- crear contenedores por bot
- separar config y variables por bot
- crear worker bloqued de ejecución
- validación de entorno y conectividad a destinos autorizados
- preparar cada bot para estrategia específica

### Fase 4: Seguridad de red y conectividad autorizada

- documentar los destinos y rutas permitidos por cada proveedor
- limitar la salida de red y verificar conectividad real
- usar VPN solo cuando el proveedor y el operador la autoricen
- mostrar desconexiones y recuperar únicamente por rutas autorizadas

### Fase 5: Broker integration

- implementar adapter real por broker
- manejar login, session, positions, fills, balances
- añadir seguridad de acceso, retry y reconexión
- validar en paper trading

### Propuesta histórica: Desktop app

- crear app Tauri desktop
- login seguro
- dashboard con bots y telemetría
- panel de control y salud global
- emergencias y logs

### Propuesta histórica: Hardening final

- pruebas de seguridad
- rate limiting
- validación de payloads
- rotación de tokens
- observability y alerting
- backup y restore
- dry run y paper trading

---

## 9. Criterios de aceptación para “100%”

El sistema solo puede considerarse listo cuando cumpla estas condiciones:

### 9.1 Operación real

- cada bot corre en su propio contenedor
- cada bot solo accede a destinos de red autorizados
- cada bot puede autenticarse con su broker correspondiente
- cada bot puede ejecutar y monitorear órdenes reales
- cada bot tiene historial de trades y posiciones

### 9.2 Seguridad

- no existe secret hardcodeado
- todos los endpoints protegidos
- autenticación fuerte con RBAC
- TLS y/o mTLS entre servicios
- logs sin secretos ni credenciales
- políticas de red y egress definidas

### 9.3 Observabilidad

- dashboard operativo en tiempo real
- logs centralizados
- métricas por bot y globales
- alertas por error y downtime

### 9.4 Control de riesgo

- stop loss / take profit revisados
- límites por contrato, cuentas y prop firms
- riesgo total controlado por bot y global
- kill switch funcional

### 9.5 Robustez

- retry/reconnect
- manejo de fallos apropiado
- contención por bot
- fallback seguro si falla alguna parte del sistema

---

## 10. Recomendación final de stack

Si tu objetivo es construirlo bien, seguro y escalable, te recomiendo esta combinación:

- Desktop app: Tauri + React + TypeScript
- Backend: Python + FastAPI + Pydantic
- Bot workers: Python
- Database: PostgreSQL
- Queues/events: Redis
- Containerization: Docker + Docker Compose
- red de mínimo privilegio; VPN solo si está autorizada
- Monitoring: Grafana + Loki or Prometheus + Grafana
- Secrets: Infisical, Doppler, AWS Secrets Manager o similar

Esto evita usar una página web como frontend y aporta una capa mucho más robusta, profesional y segura.

---

## 11. Resumen ejecutivo

El proyecto actual no está listo para operar al 100% porque le faltan los pilares esenciales:

- aislamiento por bot real
- políticas de red autorizadas y verificables
- ejecución real con broker
- persistencia real
- seguridad industrial
- aplicación desktop
- monitoring y observabilidad

La arquitectura correcta no es “un backend con varios bots simulados”, sino una plataforma operativa con:

- central orchestrator
- bots aislados por contenedor
- red aislada por bot
- broker adapters reales
- risk engine
- persistence and telemetry
- desktop app para operación

Con ese diseño sí se puede construir algo serio, profesional y con seguridad adecuada.

---

## 12. Prompt listo para implementar

```text
Construí una plataforma de trading multi-bot para futures, con arquitectura segura y moderna.

Requisitos:

1. Backend central con FastAPI.
2. App desktop con Tauri + React + TypeScript.
3. PostgreSQL como base de datos principal.
4. Redis para colas de señales y eventos.
5. Cada bot debe correr en un contenedor Docker independiente.
6. Cada bot debe aplicar políticas de red autorizadas y documentadas; no usar túneles para ocultar identidad o eludir restricciones.
7. Cada bot debe tener su identidad, cuentas, estrategia y configuración separadas.
8. Cada bot debe conectarse con la API real del broker correspondiente.
9. Debe existir un orchestrator central que distribuya señales a bots específicos.
10. Debe haber un sistema de riesgo por bot y global.
11. Debe existir un control de emergencia global: stop all, flatten all, kill switch.
12. Debe haber un dashboard de escritorio con login, estado global, estado por bot, balances, PnL, VPN, broker status, alerts y logs.
13. Debe haber health checks por bot y por servicio.
14. Debe haber seguimiento de trades, posiciones, balances y eventos de auditoría.
15. Debe respetar buenas prácticas de seguridad: no secrets en repo, JWT con RBAC, TLS, validación estricta de inputs, logging sin credenciales, rate limiting, mTLS opcional en servicios internos.
16. Debe estar preparado para paper trading y luego live trading.
17. Arquitectura debe estar modular: gateway, signal router, bot runtime, broker adapter, risk engine, desktop app, monitoring.
18. Debe estar documentado en estructura clara y ordenada.

Objetivo final: un sistema profesional, seguro y escalable, no un mock ni un demo.
```

---

## 13. Siguiente paso recomendado

La próxima acción no debe ser seguir con “más simulación”, sino:

1. crear la base de datos y user model
2. crear el gateway FastAPI
3. crear la app desktop Tauri
4. crear la primera versión de Docker Compose
5. integrar un bot con paper trading real
6. luego configurar únicamente la conectividad de red autorizada por el broker
7. luego conectar broker real

Eso es el orden correcto para llegar a un sistema confiable.

## 14. Estado de avance

### 2026-10-25 — Primer endurecimiento de autenticación

- Las rutas REST operativas de Node.js y FastAPI requieren el token de sesión configurado.
- Los WebSockets requieren autenticación antes de enviar snapshots o recibir telemetría.
- El dashboard adjunta el token a sus solicitudes REST y WebSocket y vuelve al login si la sesión es rechazada.
- El servidor Node.js queda limitado a `127.0.0.1`.

Al cierre de este primer cambio, el token y la contraseña aún dependían de configuración local. La Fase 2 registra el cambio a credenciales de entorno y sesiones temporales; siguen pendientes TLS, RBAC y almacenamiento seguro de secretos. La ejecución continúa siendo simulada y no debe usarse para órdenes reales.

### Fase 1 — Auditoría y arranque reproducible

- Confirmados dos servidores independientes: Node.js/Express en 3008 y FastAPI en 8000.
- `npm test` era un marcador que siempre fallaba y no había pruebas automatizadas de arranque/autenticación.
- FastAPI resolvía `config.json` respecto al directorio actual; ahora lo resuelve desde `BOT_VPN`.
- Añadidos comandos diferenciados de inicio, instrucciones de Windows y pruebas aisladas para ambos servidores.
- Estado: validada con `npm test` (pruebas de inicio/autenticación Node y FastAPI). Esta fase no unifica las APIs ni habilita operaciones reales.

### Fase 2 — Endurecimiento de seguridad y configuración

- Sesiones opacas aleatorias con vencimiento de 30 minutos, revocación al cerrar sesión y cierre de WebSockets asociados, tanto en Node como en FastAPI.
- Limitados los intentos fallidos de login; agregados límites de tamaño a JSON y validación estricta de credenciales, horarios, zonas horarias, identificadores y parámetros.
- Se eliminaron los encabezados CORS globales; la interfaz local usa el mismo origen.
- Las credenciales administrativas y el token webhook se leen de variables de entorno. Las rutas de guardado omiten esos valores y eliminan credenciales de broker de altas/respuestas.
- Se rechazó la inclusión de credenciales en URLs de proxy nuevas y se ocultan credenciales de configuraciones heredadas en snapshots y persistencia.
- El proxy ya no cae silenciosamente a TCP directo cuando falla SOCKS5. Los resultados de proxy/geolocalización sin verificación real se muestran como no verificados; Node responde `501` para la prueba de proxy no implementada.
- Estado: validada con `npm test` (1 prueba Node y 6 pruebas FastAPI, incluida autenticación con credenciales Unicode) y `npm audit --omit=dev` (0 vulnerabilidades conocidas).
- Pendiente para seguridad de producción: TLS, RBAC efectivo, hashing/gestión segura de contraseñas, vault de secretos, revisión de CSRF/XSS, limitación distribuida, auditoría y revisión de seguridad independiente. La autenticación sigue siendo de desarrollo local.

### Fase 3 — Persistencia compartida y auditoría básica

- Se eligió SQLite como almacenamiento local compartido por Node y FastAPI, con ruta configurable mediante `BOT_VPN_DB_PATH` y esquema versionado en `migrations/`.
- La importación inicial de `config.json` ocurre una sola vez y filtra credenciales administrativas, de broker y de proxy; el archivo original no se reescribe.
- Las escrituras actualizan snapshots transaccionalmente con revisión optimista. Una escritura obsoleta devuelve conflicto en vez de sobrescribir la versión reciente.
- Los cambios administrativos se registran en `audit_events`; las acciones simuladas se registran en `operations` con `mode` y `status` iguales a `SIMULATED`.
- Se añadió respaldo/restauración a una nueva ruta y validación de integridad/esquema. El destino de restauración existente no se sobrescribe.
- Se verificó interoperabilidad del mismo snapshot SQLite entre Node y Python y se comprobó que los errores no producen un falso éxito.
- Estado: validada con `npm test` en Node 24.19 y Python 3.14.6: 1 prueba Node y 10 pruebas Python aprobadas. La suite incluye autenticación, persistencia, respaldo/restauración e interoperabilidad. No se probó en las versiones mínimas declaradas; FastAPI/Starlette emite un aviso deprecado no bloqueante en el test.
- Límites conocidos: SQLite es para desarrollo local y concurrencia modesta; no hay resolución automática de conflictos, visor/retención de auditoría ni sesiones persistidas. No hay precios, posiciones ni ejecuciones reales y el modo en vivo sigue deshabilitado.

### Fase 4 — Límites de riesgo y separación de modos

- Se implementó la separación local: las señales producen solo resultados `SIMULATED`; `PAPER` devuelve `501` hasta que exista un adaptador de sandbox oficial y no existe un modo `LIVE`.
- Se añadieron topes de demostración configurables por variables de entorno para tamaño por cuenta/global, órdenes diarias, pérdida diaria y exposición nocional. Los límites por cuenta existentes pueden ser más restrictivos, no superan los topes globales activos.
- Las señales fuera de límite y las referencias a bots/estrategias inexistentes se rechazan con motivo; las posiciones existentes no se duplican ni se revierten al sobrescribir estado.
- Se añadieron contadores diarios UTC, cierre local simulado, deduplicación persistida para señales con `signal_id`, kill switch explícitamente simulado y etiqueta de modo en el panel/snapshots.
- El panel muestra los topes efectivos por cuenta junto a los límites configurados; las variables globales deben coincidir en las ventanas de ambos servidores.
- Las órdenes simuladas ya no abren sesiones de red ni llaman al adaptador/proxy; no se envía ninguna orden real.
- Valores de ejemplo para pruebas: 1 contrato por cuenta, 2 globales, 3 órdenes por día, $50 de pérdida diaria por cuenta, $100 globales y $100,000 de exposición nocional. No son recomendaciones financieras.
- Estado: endurecimiento del modo local validado con `npm test` (1 prueba Node y 18 pruebas Python), incluyendo rechazo por riesgo, límites de tamaño/pérdida/exposición/órdenes, duplicados, destino inválido, cierre, kill switch y fallo/recuperación simulados. `npm audit --omit=dev` no reportó vulnerabilidades. La validación del flujo de simulación no equivale a validar un sandbox.
- Pendiente antes de cerrar toda la fase: pruebas de desconexión/recuperación contra un sandbox autorizado una vez implementado el adaptador de Fase 5. El modo paper y el modo en vivo siguen deshabilitados.

### Fase 5 — Evaluación de sandbox Rithmic (sin adaptador)

- La [API Suite oficial](https://www.rithmic.com/products/api-suite) describe `Rithmic Test` para desarrollar y probar aplicaciones sin pasar primero por conformance. Para solicitar los dev kits de R | API+ y R | Protocol API, indica contactar al equipo de Rithmic; para Protocol-only menciona registro y activación por correo.
- La página oficial de [Exchange Simulator](https://www.rithmic.com/products/exchange-simulator) describe paper trading con datos de mercado en vivo y fills simulados, y dice que el sistema se usa para pruebas de conformance de R | API+ y R | Protocol API.
- Las páginas públicas consultadas no proporcionan el dev kit ni la especificación completa, y no confirman el proceso de autorización, credenciales o endpoints de prueba aprobados para este proyecto. Los endpoints de fragmentos de ejemplo no se tratarán como configuración autorizada.
- Estado: sandbox oficial de prueba anunciado, pero el acceso y los detalles técnicos necesarios para implementar el adaptador no están verificados. No se creó un adaptador, no se conectó ningún servicio y no se solicitaron credenciales.
- Siguiente paso bloqueante: obtener de Rithmic el dev kit/documentación oficial y confirmar por escrito el acceso de prueba, permisos, condiciones y procedimiento de alta para este proyecto. No usar cuentas de producción ni copiar endpoints de ejemplos como configuración.
- La Fase 4 permanece parcialmente abierta hasta probar fallos y recuperación contra el sandbox autorizado. `PAPER` seguirá devolviendo `501` y `LIVE` seguirá deshabilitado hasta que el adaptador se implemente y pase sus pruebas.

### Fase 6 — Infraestructura y observabilidad (avance inicial)

- Node y FastAPI exponen `GET /healthz`, que consulta el estado de SQLite y devuelve `503` si la persistencia no está disponible.
- Las respuestas identifican `SIMULATED` y el broker como deshabilitado. Node indica `historical_csv` si tiene CSV importado en memoria; FastAPI reporta datos simulados. Ninguno afirma conectividad externa.
- Se añadieron pruebas para el estado sano y el fallo de persistencia.
- Pendiente: Docker Compose reproducible, health checks de contenedor, logging/monitorización y métricas/alertas. No habilitar exposición fuera de localhost.

### Fase 7 — Interfaz y experiencia de operación

- Avance: el panel Node permite importar CSV OHLCV históricos para NQ y ES, configurar instrumento/estrategia/intervalos por bot y mostrar resultados por intervalo.
- El precio de cabecera continúa marcado como simulado; los análisis CSV son históricos y permanecen en memoria hasta reiniciar Node.
- Pendiente: unificar Node/FastAPI, persistir o volver a importar datos históricos y validar los cálculos/heurísticas con datasets de referencia.
- Mantener visibles los modos `SIMULATED`/`PAPER` y no habilitar operaciones en vivo.

### Fase 8 — Análisis de mercado histórico (avance inicial)

- Implementada importación autenticada de CSV OHLCV para NQ/ES, con validación de zona horaria, calidad OHLCV, tamaño y cantidad de velas.
- Soportados intervalos 1m, 5m, 15m, 30m, 1h, 4h y 1d; se agregan intervalos mayores desde el intervalo de origen, nunca se inventan velas de menor resolución.
- Añadidos indicadores EMA 9/21/50, RSI 14, MACD, ATR 14 y VWAP UTC, además de lecturas técnicas, filtro ICT simplificado y divergencia SMT simplificada.
- La pantalla muestra backtests históricos hipotéticos por estrategia: entrada al abrir la vela siguiente, stop en 1,5 × ATR, take profit en 2R y supuesto conservador stop-primero cuando una vela contiene ambos niveles.
- La configuración por bot guarda instrumento, estrategia e intervalos. Order Flow se marca no disponible con OHLCV porque requiere datos bid/ask.
- La importación no activa ejecución ni órdenes y los datos se borran al reiniciar el proceso Node.
- Pendiente: integrar una fuente autorizada de datos, validar algoritmos y supuestos de entrada/salida frente a referencias independientes, incluir costos de transacción, modelar sesiones CME y decidir persistencia del histórico. No habilitar señales automáticas ni trading en vivo basándose solo en estas heurísticas.
