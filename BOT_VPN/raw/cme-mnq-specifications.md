# Raw Source: CME Micro E-mini Nasdaq-100 (MNQ) Contract Specs

**Source Origin**: Chicago Mercantile Exchange (CME Group) Product Guide  
**Ticker**: MNQ (Globex)  
**Status**: Immutable Primary Source  

---

## 1. Especificaciones de Contrato
- **Activo Subyacente**: Índice Nasdaq-100.
- **Multiplicador de Contrato**: $2.00 USD por cada punto índice.
- **Tamaño Mínimo de Fluctuación (Tick)**: 0.25 puntos índice.
- **Valor Monetario de un Tick**: $0.50 USD por contrato ($2.00 x 0.25).
- **Relación con E-mini Nasdaq (NQ)**: 1 contrato NQ = 10 contratos MNQ (permite un dimensionamiento de riesgo 10 veces más granular para cuentas de evaluación de prop firms).

## 2. Horarios de Negociación (CME Globex)
- **Apertura de la Semana**: Domingo 18:00 EST.
- **Cierre Diario de Mantenimiento**: Lunes a Jueves 17:00 a 18:00 EST.
- **Horario RTH (Regular Trading Hours)**: 09:30 a 16:15 EST.
- **Killzone Principal NY AM**: 09:30 a 11:30 EST (máxima liquidez institucional y volumen de subasta).
- **Killzone Secundaria NY PM**: 13:30 a 16:00 EST.

## 3. Parámetros de Riesgo y Margen
- **Margen Intradía Típico (Tradovate/Apex/Topstep)**: ~$50 - $100 USD por contrato MNQ.
- **Margen Nocturno / Mantenimiento CME**: ~$1,800 - $2,200 USD por contrato MNQ (las prop firms habitualmente prohíben mantener posiciones abiertas tras las 16:59 EST).
