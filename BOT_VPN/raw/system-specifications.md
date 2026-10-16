# Raw Source: System Specifications & Architecture Requirements

**Source Origin**: User Requirement Prompt  
**Date Added**: 2026-10-16  
**Status**: Immutable Primary Source  

---

## 1. Infraestructura y Red
- **Entorno de Ejecución**: Windows (Python 3.11+ asíncrono).
- **Aislamiento de Red por Bot**:
  - Cada bot debe encaminar sus conexiones HTTP/WebSocket a través de su propio Proxy SOCKS5 / VPN dedicado.
  - El enrutamiento de red debe realizarse exclusivamente a nivel de Socket/Cliente en el código de Python (ej. mediante `aiohttp-socks` o `httpx`), garantizando que la IP global de Windows no cambie y las peticiones salgan por diferentes IPs públicas simultáneamente.
- **Prop Firms Objetivo**: Apex Trader Funding, Leelo Trading, Topstep, Blue Guardian.
- **Conectores de Ejecución**: API de Tradovate (REST/WebSockets) y Rithmic (R|API+).
- **Recepción de Señales**: Servidor Webhook HTTP POST en formato JSON enviado por alertas automatizadas de TradingView.

## 2. Lógica de Negocio y Orquestación Multi-Bot
- **Capacidad Inicial**: 3 Bots funcionando en paralelo, diseñados sobre una arquitectura modular escalable para agregar N bots de forma dinámica.
- **Desacoplamiento de Estrategias**: La clase `TradingBot` debe recibir la estrategia como un parámetro inyectado. Múltiples bots pueden ejecutar la misma estrategia o estrategias distintas (ej. ICT, SMT, Order Flow) de forma independiente.
- **Gestión Multi-Cuenta**: Cada bot administra una lista de cuentas asociadas. Al recibir una señal válida desde TradingView, el bot debe replicar la orden de MNQ en todas las cuentas asignadas a dicho bot a través de su proxy específico.
- **Delimitación de Horarios**: El usuario puede configurar ventanas de tiempo operativas por bot (ej. 09:30 a 12:00 EST). Fuera de este rango, el bot ignora las señales entrantes.

## 3. Interfaz Gráfica y Dashboard de Control
- **Estética y Tema**: "Dark Theme" elegante e intuitivo, con paleta de colores basada estrictamente en tonos negros (#0D0D0D, #121212) y grises (#1E1E1E, #2A2A2A, #808080).
- **Vista General (Grid de Tarjetas)**:
  - Muestra una tarjeta visual por cada bot.
  - Datos por tarjeta: Estado (🟢 Activo / 🔴 Pausado / 🟡 Error), IP/Proxy asignado, PnL Total acumulado de la sesión, horario operativo y número de cuentas vinculadas.
  - Botón superior `[ + Agregar Bot ]`.
- **Vista Detallada (Modal o Panel Extensible por Bot)**:
  - Control de Horario: Selectores para horario de inicio y fin de operación.
  - Estadísticas en Tiempo Real: PnL Neto, Total de Trades ejecutados, Win-Rate (Ganados/Perdidos), Drawdown Máximo y Ping del Proxy.
  - Consola de Logs: Terminal de eventos con scroll automático mostrando actividad en segundo a segundo.
  - Tabla de Cuentas Gestionadas: Permite al usuario asignar un nombre personalizado a cada cuenta (ej: "Cuenta 2 de Asia", "Apex 50k #1"), mostrando Broker/Conector, Balance, PnL Flotante, Contratos Activos y Estado de Conexión.
