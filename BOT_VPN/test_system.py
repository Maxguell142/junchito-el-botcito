"""
test_system.py - Verificación Integral del Motor de Trading y Webhooks
"""

import asyncio
from bot_engine import BotManager
from strategies import ICTStrategy, SMTStrategy, OrderFlowStrategy


def test_strategies():
    print(">>> 1. Probando evaluación de Estrategias...")
    ict = ICTStrategy()
    
    # Señal válida ICT
    valid_signal = {
        "action": "BUY",
        "price": 18250.0,
        "sl": 18235.0,
        "tp": 18280.0,
        "contracts": 1,
        "fvg_valid": True
    }
    decision = ict.evaluate_signal(valid_signal)
    assert decision.approved, f"ICT debería aprobar la señal: {decision.reason}"
    assert decision.risk_reward_ratio == 2.0, f"R:R esperado 2.0, obtenido {decision.risk_reward_ratio}"
    print(f"  [OK] ICTStrategy aprobó: {decision.reason}")

    # Señal con R:R insuficiente
    bad_rr_signal = {
        "action": "BUY",
        "price": 18250.0,
        "sl": 18240.0,
        "tp": 18255.0, # Solo 0.5 R:R
        "contracts": 1
    }
    decision_bad = ict.evaluate_signal(bad_rr_signal)
    assert not decision_bad.approved, "ICT debería rechazar R:R < 2.0"
    print(f"  [OK] ICTStrategy rechazó R:R bajo correctamente: {decision_bad.reason}")

    # SMT Strategy
    smt = SMTStrategy()
    smt_signal = {
        "action": "SELL",
        "price": 18260.0,
        "sl": 18270.0,
        "tp": 18240.0,
        "contracts": 2,
        "smt_divergence": True
    }
    dec_smt = smt.evaluate_signal(smt_signal)
    assert dec_smt.approved, "SMT debería aprobar divergencia"
    print(f"  [OK] SMTStrategy aprobó: {dec_smt.reason}")

    # Order Flow Strategy
    of = OrderFlowStrategy()
    of_signal = {
        "action": "BUY",
        "price": 18245.0,
        "sl": 18235.0,
        "tp": 18265.0,
        "delta": 220
    }
    dec_of = of.evaluate_signal(of_signal)
    assert dec_of.approved, "Order Flow debería aprobar con delta 220"
    print(f"  [OK] OrderFlowStrategy aprobó: {dec_of.reason}")


async def test_bot_engine_and_replication():
    print("\n>>> 2. Probando Motor de Trading y Replicación Multi-Cuenta...")
    bm = BotManager("config.json")
    bm.load_config()

    assert len(bm.bots) == 3, f"Se esperaban 3 bots en config.json, encontrados {len(bm.bots)}"
    print(f"  [OK] Cargados {len(bm.bots)} bots correctamente desde config.json.")

    bot1 = bm.bots["bot_1"]
    print(f"  Bot 1: '{bot1.name}', Estrategia: {bot1.strategy.name}, Cuentas: {len(bot1.accounts)}")

    # 1. Probar que fuera de horario rechaza la señal
    bot1.schedule["start_time"] = "01:00"
    bot1.schedule["end_time"] = "02:00"
    out_signal = {
        "bot_id": "bot_1",
        "action": "BUY",
        "price": 18250.0,
        "sl": 18235.0,
        "tp": 18280.0,
        "contracts": 1
    }
    res_out = await bm.dispatch_webhook(out_signal)
    assert res_out[0]["status"] == "IGNORED", "Señal fuera de horario debe ser IGNORED"
    print(f"  [OK] Filtrado de horario funciona: {res_out[0]['reason']}")

    # 2. Configurar horario abierto para probar ejecución y replicación
    bot1.schedule["start_time"] = "00:00"
    bot1.schedule["end_time"] = "23:59"

    signal_payload = {
        "bot_id": "bot_1",
        "action": "BUY",
        "price": 18250.0,
        "sl": 18235.0,
        "tp": 18280.0,
        "contracts": 1,
        "fvg_valid": True
    }
    results = await bm.dispatch_webhook(signal_payload)
    assert len(results) > 0, "Se esperaba resultado del webhook"
    res = results[0]
    assert res["status"] == "EXECUTED", f"Estado esperado EXECUTED, recibido: {res}"
    assert len(res["replications"]) == 2, f"Se esperaba replicar en 2 cuentas, replicado en {len(res['replications'])}"
    print(f"  [OK] Replicación completada en {len(res['replications'])} cuentas simultáneamente.")
    for rep in res["replications"]:
        print(f"       -> Cuenta: '{rep['custom_name']}' ({rep['broker']}) | {rep['action']} {rep['contracts']} MNQ @ {rep['price']} ({rep['latency_ms']}ms)")

    assert bot1.total_active_contracts == 2, f"Total contratos activos esperado 2, obtenido {bot1.total_active_contracts}"

    # 3. Simular movimiento de precio a 18260.0 (+10 puntos = +$20 USD por contrato)
    bot1.simulate_price_movement(18260.0)
    snap = bm.get_system_snapshot()
    bot1_data = next(b for b in snap["bots"] if b["id"] == "bot_1")
    expected_pnl = 10.0 * 2.0 * 2 # 10 pts * $2/pt * 2 contratos = $40.00
    assert bot1_data["floating_pnl"] == expected_pnl, f"Esperado ${expected_pnl}, obtenido ${bot1_data['floating_pnl']}"
    print(f"  [OK] PnL Flotante verificado en tiempo real: ${bot1_data['floating_pnl']:.2f}")

    # 4. Cerrar posiciones y consolidar PnL realizado
    realized = bot1.close_all_positions(18260.0)
    assert realized == expected_pnl, f"PnL realizado esperado ${expected_pnl}, obtenido ${realized}"
    assert bot1.total_active_contracts == 0, "No deberían quedar contratos activos tras cierre"
    print(f"  [OK] Cierre de posiciones verificado: PnL Realizado = ${realized:.2f}, Contratos Activos = {bot1.total_active_contracts}")

    # Restaurar horario
    bot1.schedule["start_time"] = "09:30"
    bot1.schedule["end_time"] = "11:30"

    print("\n>>> TODAS LAS PRUEBAS UNITARIAS PASARON SATISFACTORIAMENTE [OK] <<<")


if __name__ == "__main__":
    test_strategies()
    asyncio.run(test_bot_engine_and_replication())
