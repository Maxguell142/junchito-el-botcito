# Raw Source: TradingView Webhook & Alert Payload Specification

**Source Origin**: TradingView Pine Script v5 / v6 Webhook Alert Documentation  
**Status**: Immutable Primary Source  

---

## 1. Configuración de Alerta en TradingView
- **URL del Webhook**: `http://<IP_OR_DOMAIN>:8000/api/webhook`
- **Método HTTP**: `POST`
- **Headers**: `Content-Type: application/json`

## 2. Estructura Estándar del JSON de Alerta

```json
{
  "token": "<CONFIGURE_WEBHOOK_TOKEN>",
  "bot_id": "bot_1",
  "ticker": "MNQ",
  "action": "BUY",
  "price": 18250.25,
  "contracts": 1,
  "sl": 18235.00,
  "tp": 18280.50,
  "strategy": "ICTStrategy",
  "fvg_valid": true,
  "smt_divergence": true,
  "delta": 240,
  "comment": "NY Open MSS + FVG 5m"
}
```

## 3. Ejemplo de Script Pine Script (TradingView)

```pinescript
//@version=5
strategy("Quantum MNQ Webhook Scalper", overlay=true, margin_long=100, margin_short=100)

var string secret_token = input.string("", "Webhook token")
var string bot_target = "bot_1"

// Condiciones lógicas
longCondition = ta.crossover(ta.sma(close, 9), ta.sma(close, 21))
shortCondition = ta.crossunder(ta.sma(close, 9), ta.sma(close, 21))

if (longCondition)
    string payload = '{"token":"' + secret_token + '","bot_id":"' + bot_target + '","ticker":"MNQ","action":"BUY","price":' + str.tostring(close) + ',"sl":' + str.tostring(close - 15) + ',"tp":' + str.tostring(close + 30) + ',"contracts":1,"strategy":"ICTStrategy"}'
    alert(payload, alert.freq_once_per_bar_close)

if (shortCondition)
    string payload = '{"token":"' + secret_token + '","bot_id":"' + bot_target + '","ticker":"MNQ","action":"SELL","price":' + str.tostring(close) + ',"sl":' + str.tostring(close + 15) + ',"tp":' + str.tostring(close - 30) + ',"contracts":1,"strategy":"ICTStrategy"}'
    alert(payload, alert.freq_once_per_bar_close)
```
