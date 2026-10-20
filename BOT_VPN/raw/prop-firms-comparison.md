# Raw Source: Prop Firms Execution & Risk Rules Matrix

**Source Origin**: Official Rules: Apex Trader Funding, Topstep, Leelo Trading, Blue Guardian  
**Target Asset**: CME Futures (MNQ / NQ)  
**Status**: Immutable Primary Source  

---

## 1. Tabla Comparativa de Cuentas (Modelo 50k / 100k)

| Prop Firm                   | Plataformas / Conectores | Tipo de Drawdown            | Límite Drawdown (50k) | Límite Contratos MNQ    | Restricciones de IP                                                                                              |
| :-------------------------- | :----------------------- | :-------------------------- | :-------------------- | :---------------------- | :--------------------------------------------------------------------------------------------------------------- |
| **Apex Trader Funding**     | Tradovate, Rithmic       | Trailing Intradía (al tick) | $2,500 USD            | Hasta 100 MNQ (o 10 NQ) | Alerta si múltiples usuarios acceden con la misma IP, o un usuario con IPs geográficamente distantes en minutos. |
| **Topstep**                 | Tradovate, TSTrader      | Fin de Día (EOD)            | $2,000 USD            | Hasta 50 MNQ (o 5 NQ)   | Exige consistencia de red. Bloquea si detecta conexiones cruzadas concurrentes sospechosas.                      |
| **Leelo Trading**           | Rithmic                  | Trailing Peak Balance       | $2,500 USD            | Hasta 80 MNQ (o 8 NQ)   | Monitorea sesiones simultáneas desde múltiples países.                                                           |
| **Blue Guardian (Futures)** | Tradovate, DXTrade       | Estático / Balance Trailing | $2,000 - $4,000 USD   | Variable                | Prohíbe compartir IPs entre traders no autorizados.                                                              |

## 2. Implicaciones Críticas para el Aislamiento de Red
- Muchas prop firms utilizan proveedores de seguridad y compliance (ej. Cloudflare, DataDome) para detectar copy-trading no autorizado o gestión compartida de cuentas.
- Si un trader opera 3 cuentas con diferentes estrategias o dueños desde una única IP residencial a alta velocidad, las firmas pueden activar suspensiones preventivas por coincidencia de huella de red.
- **Solución implementada**: Cada bot asigna su propio Proxy SOCKS5 residencial dedicado a nivel de Socket de Python. Cada bot tiene su propia IP pública individual y constante, eliminando cualquier correlación entre las cuentas gestionadas.
