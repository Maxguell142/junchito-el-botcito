"""
test_system.py - Verificación Integral del Motor de Trading, Multi-Identidad y Pánico
"""

import asyncio
from fastapi_service.bot_engine import BotManager
from fastapi_service.strategies import ICTStrategy, SMTStrategy, OrderFlowStrategy


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
        "tp": 18255.0,
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
    print("\n>>> 2. Probando Motor de Trading, Multi-Identidad y Emergencia...")
    bm = BotManager("config.json")
    bm.load_config()

    assert len(bm.bots) == 3, f"Se esperaban 3 bots, encontrados {len(bm.bots)}"
    assert len(bm.identities) >= 3, f"Se esperaban al menos 3 identidades, encontradas {len(bm.identities)}"
    print(f"  [OK] Cargados {len(bm.bots)} bots y {len(bm.identities)} titulares KYC.")

    bot1 = bm.bots["bot_1"]
    assert bot1.identity is not None, "Bot 1 debe tener un titular asignado"
    print(f"  [OK] Bot 1 asignado a titular: '{bot1.identity.full_name}' ({bot1.identity.country})")

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

    # 2. Configurar horario abierto para probar ejecución y replicación con jitter
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
    print(f"  [OK] Replicación con Anti-Mirroring Jitter completada en {len(res['replications'])} cuentas.")

    # 3. Simular movimiento de precio
    bot1.simulate_price_movement(18260.0)
    snap = bm.get_system_snapshot()
    bot1_data = next(b for b in snap["bots"] if b["id"] == "bot_1")
    expected_pnl = 10.0 * 2.0 * 2  # 10 pts * $2/pt * 2 contratos = $40.00
    assert bot1_data["floating_pnl"] == expected_pnl, f"Esperado ${expected_pnl}, obtenido ${bot1_data['floating_pnl']}"
    print(f"  [OK] PnL Flotante verificado: ${bot1_data['floating_pnl']:.2f}")

    # 4. Probar Control de Pánico Institucional (Flatten All)
    bm.market_price = 18260.0
    flatten_res = bm.flatten_all_positions()
    assert flatten_res["status"] == "ALL_FLATTENED", "Debe retornar ALL_FLATTENED"
    assert bot1.total_active_contracts == 0, "Todos los contratos deben ser 0 tras Flatten All"
    print(f"  [OK] Control de Pánico (Flatten All) probado: PnL Realizado = ${flatten_res['total_realized_pnl']}")

    # 5. Probar Kill-Switch Global (Stop All)
    bot1.status = "ACTIVE"
    paused_count = bm.stop_all_bots()
    assert bot1.status == "PAUSED", "Bot 1 debe estar PAUSED tras Stop All"
    print(f"  [OK] Kill-Switch Global probado: {paused_count} bots pausados.")

    # 6. Probar Test de Proxy
    proxy_res = await bm.test_proxy("bot_1")
    assert proxy_res["ping_ms"] > 0, "Ping debe ser mayor a 0"
    assert "detected_ip" in proxy_res, "Debe reportar IP detectada"
    print(f"  [OK] Test de Proxy y Geo-Consistency verificado: Ping={proxy_res['ping_ms']}ms | IP={proxy_res['detected_ip']}")

    # Restaurar horario y estado
    bot1.schedule["start_time"] = "09:30"
    bot1.schedule["end_time"] = "11:30"
    bot1.status = "ACTIVE"
    bm.save_config()

    print("\n>>> TODAS LAS PRUEBAS DE ARQUITECTURA PASARON SATISFACTORIAMENTE [OK] <<<")


if __name__ == "__main__":
    test_strategies()
    asyncio.run(test_bot_engine_and_replication())
