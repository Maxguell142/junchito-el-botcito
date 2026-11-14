---
title: "Alcance propuesto para bots y calendario económico"
category: conceptos
tags: [trading, mnq, futures, bots, python, pine-script, forex-factory, macro, verification, quantum-fx, conceptos, calendario]
last_updated: "2026-11-13"
sources: [raw/system-specifications.md, raw/tradingview-webhook-guide.md]
doc_type: "concepto"
status: "conceptual"
summary: "Requisitos e ideas de origen; contrastar cada función con el estado técnico actual."
---

# Alcance propuesto para bots y calendario económico

> **Estado: requisitos y diseño de referencia.** Las funciones descritas aquí no se consideran implementadas sin evidencia en el código y el estado técnico.


Este módulo proporciona flexibilidad absoluta al operador institucional para crear bots sin depender de plantillas cerradas, incorporando un motor de verificación de código en múltiples lenguajes de programación, asignación desatendida de red residencial US y un feed enriquecido con los eventos macroeconómicos de ForexFactory filtrables por divisa (USD, JPY, EUR, GBP) e impacto.

---

## 1. Creación Libre de Bots y Estrategias

A diferencia de las arquitecturas rígidas con selecciones fijas, el creador de bots implementa:
1. **Nombre Libre de Bot**: El operador nombra sus unidades de ejecución conforme a su propio sistema de trabajo (ej. *MNQ New York Breaker*, *Scalper Liquidez Oro*, *FVG Midnight Alpha*).
2. **ID Seguro Autogenerado**: Si el usuario omite el identificador técnico, el sistema calcula un slug alfanumérico seguro (`bot_<nombre>_<timestamp>`), eliminando bloqueos de formulario.
3. **Estrategia Desacoplada**: El campo de estrategia admite entradas libres con soporte de autocompletado inteligente (`datalist`) para sugerencias estándar (ICT, TA, SMT, Order Flow) o cualquier nombre de algoritmo propietario.
4. **Persistencia Dinámica en Memoria y SQLite**: La API REST registra dinámicamente las nuevas estrategias en el diccionario maestro sin invalidar las reglas de análisis histórico ni requerir reinicio del servidor.

---

## 2. Aislamiento Residencial SOCKS5 Desatendido (Sin Fricción)

Para salvaguardar la experiencia en modo demo sin forzar al usuario a introducir IPs, puertos ni credenciales de red manualmente:
- **Asignación Automática**: El formulario desactiva la obligación de configurar proxies. Si el campo se deja vacío, el sistema asigna de forma desatendida un nodo residencial ISP simulado de alta fidelidad (Comcast, AT&T o Spectrum en Chicago/NY).
- **Protección de Red Preservada**: El motor socket mantiene el aislamiento por subproceso a nivel de arquitectura, asegurando que los simuladores de latencia y comprobaciones de geolocalización sigan funcionando al 100%.

---

## 3. Motor de Ingesta y Verificación Multilenguaje de Archivos de Bot

El sistema integra un área de carga arrastrable (*Drag & Drop Dropzone*) capaz de inspeccionar, verificar y validar sintácticamente scripts en diferentes lenguajes antes de permitir su despliegue:

| Lenguaje / Entorno | Extensiones Soportadas | Patrones y Directivas Detectadas |
| :--- | :--- | :--- |
| **TradingView Pine Script** | `.pine`, `.txt` | `//@version=5/4`, `strategy()`, `ta.ema()`, `fvg`, `strategy.entry()`, `strategy.exit()` |
| **Python Algotrading** | `.py` | `def`, `class`, `import pandas`, `ccxt`, `backtrader`, `order.buy()`, `order.sell()` |
| **JavaScript / TypeScript** | `.js`, `.ts` | `const`, `async/await`, `executeOrder()`, WebSockets de broker |
| **NinjaScript (C#)** | `.cs` | `using NinjaTrader`, `OnBarUpdate()`, `EnterLong()`, `EnterShort()`, `SetStopLoss()` |
| **MetaTrader MQL** | `.mq4`, `.mq5` | `OnTick()`, `OrderSend()`, `PositionOpen()`, `CTrade` |
| **Reglas Algorítmicas JSON** | `.json` | Esquemas declarativos de gatillos, ticks de SL y ticks de TP |

### Capacidades del Verificador Automático:
- **Detección de Señales**: Identifica compras (`BUY`, `LONG`, `EnterLong`) y ventas (`SELL`, `SHORT`, `EnterShort`).
- **Validación de Gestión de Riesgo**: Escanea la existencia de directivas de Stop Loss y Take Profit para evitar algoritmos desprotegidos.
- **Detección de Sesión y Filtros**: Reconoce Killzones de New York (`09:30 - 11:30 EST`), Fair Value Gaps (FVG) y cruces de medias móviles.
- **Auto-Configuración Asistida**: Al cargar el archivo, el sistema extrae el título del script y pre-rellena automáticamente el nombre del bot y de la estrategia si se encontraban vacíos.

---

## 4. Calendario Macroeconómico Oficial ForexFactory

La vista institucional de noticias macro (`#view-noticias`) replica fielmente el calendario de alta liquidez de [ForexFactory](https://www.forexfactory.com/):

```
+-----------------------------------------------------------------------------------------+
| [🌐 Todas] [🇺🇸 Solo USD] [🇯🇵 Solo JPY] [🇪🇺 EUR] [🇬🇧 GBP]  |  [Todos] [🔴 Rojas] [🟠 Medio] |
+-----------------------------------------------------------------------------------------+
| HORA (EST) | DIVISA | IMPACTO  | EVENTO MACRO              | REAL   | PREVISIÓN | PREVIO |
| 08:30 EST  | USD    | 🔴 ALTO  | CPI m/m                   | 0.3%   | 0.2%      | 0.2%   |
| 14:00 EST  | USD    | 🔴 ALTO  | FOMC Rate Decision        | -      | 4.75%     | 5.00%  |
| 00:00 EST  | JPY    | 🔴 ALTO  | BOJ Policy Rate Decision  | 0.25%  | 0.25%     | 0.25%  |
| 19:30 EST  | JPY    | 🔴 ALTO  | Tokyo Core CPI y/y        | -      | 1.8%      | 2.0%   |
+-----------------------------------------------------------------------------------------+
```

### Filtros Interactivos en Vivo:
- **Filtro de Divisas**: Permite conmutar con un solo clic entre ver todas las divisas, **solo USD** (clave para CME MNQ), **solo JPY** (noticias críticas del Banco de Japón y Tokio), **EUR** o **GBP**.
- **Filtro de Impacto por Carpetas**: Selección entre todos los eventos, exclusivamente **Noticias Rojas de Alto Impacto** (alta volatilidad institucional) o eventos de medio y alto impacto combinados.
- **Buscador Dinámico por Texto**: Filtrado en tiempo real sin recargar página mediante coincidencias de texto sobre el nombre del evento o la divisa.
- **Codificación Cromática ForexFactory**: Los datos reales reportados se colorean en verde neón cuando superan la expectativa de mercado o en rojo cuando decepcionan las proyecciones.

---

## 5. Referencias Cruzadas y Enlaces Relacionados
- [[documentacion/00_INICIO_OBSIDIAN|Índice Maestro de la Wiki]]
- [[documentacion/03_ARQUITECTURA_CONCEPTUAL|Arquitectura Global del Sistema]]
- [[documentacion/conceptos/simulacion-y-limites-del-proyecto|Gemelo Digital y Simulación Demo]]
- [[documentacion/conceptos/horarios-de-mercado-nueva-york|Filtros de Horario y Killzones NY]]
- [[documentacion/estrategias/referencia-estrategia-ict|Estrategia Cuantitativa ICT]]
- [[documentacion/conceptos/diseno-aislamiento-proxy-socks5|Aislamiento de Sockets y Red Residencial]]
