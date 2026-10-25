import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess

import pytest

from backup_db import copy_database, verify_database
from bot_engine import BotManager
from persistence import PersistenceConflict, SQLiteStore


def test_legacy_config_import_is_sanitized_and_survives_restart(tmp_path):
    config_path = tmp_path / "config.json"
    database_path = tmp_path / "bot_vpn.sqlite3"
    config_path.write_text(json.dumps({
        "auth": {
            "username": "legacy-admin",
            "password": "legacy-password",
            "session_token": "legacy-session",
        },
        "server": {"port": 3008, "webhook_token": "legacy-webhook"},
        "identities": [{
            "id": "identity-1",
            "full_name": "Test Operator",
            "country": "US",
        }],
        "bots": [{
            "id": "bot-1",
            "name": "Persisted Bot",
            "identity_id": "identity-1",
            "strategy": "ICTStrategy",
            "proxy_url": "socks5://proxy-user:proxy-password@proxy.example:1080?secret=value",
            "status": "PAUSED",
            "schedule": {"start_time": "09:30", "end_time": "11:30", "timezone": "UTC"},
            "accounts": [{
                "id": "account-1",
                "custom_name": "Paper Test",
                "username": "broker-login",
                "password": "broker-password",
                "balance": 12345.0,
                "current_position": "LONG",
                "active_contracts": 1,
                "entry_price": 100.0,
                "realized_pnl": 25.5,
                "daily_pnl": 1000000.0,
                "orders_today": -1,
                "daily_metrics_date": "invalid-date",
            }],
        }],
    }), encoding="utf-8")

    manager = BotManager(str(config_path), str(database_path))
    manager.load_config()
    assert manager.bots["bot-1"].status == "PAUSED"
    assert manager.bots["bot-1"].accounts[0].current_position == "LONG"
    assert manager.bots["bot-1"].accounts[0].username == "••••"
    manager.save_config(event={
        "action": "test_state_updated",
        "entity_type": "bot",
        "entity_id": "bot-1",
        "details": {"test": True},
    })
    manager.close_storage()

    stored_text = database_path.read_bytes().decode("latin1", errors="ignore")
    for secret in (
        "legacy-admin",
        "legacy-password",
        "legacy-session",
        "legacy-webhook",
        "proxy-user",
        "proxy-password",
        "broker-login",
        "broker-password",
    ):
        assert secret not in stored_text

    restarted = BotManager(str(config_path), str(database_path))
    restarted.load_config()
    assert restarted.bots["bot-1"].status == "PAUSED"
    assert restarted.bots["bot-1"].identity.full_name == "Test Operator"
    account = restarted.bots["bot-1"].accounts[0]
    assert account.balance == 12345.0
    assert account.current_position == "LONG"
    assert account.active_contracts == 1
    assert account.realized_pnl == 25.5
    assert account.status == "NOT_CONFIGURED"
    assert account.daily_pnl == 0.0
    assert account.orders_today == 0
    audit_count = restarted._store.connection.execute(
        "SELECT count(*) FROM audit_events WHERE action = 'test_state_updated'"
    ).fetchone()[0]
    assert audit_count == 1
    restarted.close_storage()


def test_stale_snapshot_and_failed_audit_do_not_overwrite_saved_state(tmp_path):
    database_path = str(tmp_path / "shared.sqlite3")
    first = SQLiteStore(database_path)
    second = SQLiteStore(database_path)
    first_snapshot, first_revision = first.load_or_import({"identities": [], "bots": []})
    second_snapshot, second_revision = second.load_or_import({"identities": [], "bots": []})

    first_snapshot["identities"] = [{
        "id": "persisted",
        "full_name": "Saved Identity",
        "alias": "Saved Identity",
        "country": "US",
        "city": "",
        "flag": "🌐",
        "kyc_status": "PENDING",
        "email": "",
        "notes": "",
    }]
    current_revision = first.save_snapshot(
        first_snapshot,
        first_revision,
        event={"action": "identity_created", "entity_type": "identity", "entity_id": "persisted"},
    )
    assert current_revision == first_revision + 1
    with pytest.raises(PersistenceConflict):
        second.save_snapshot(second_snapshot, second_revision, event={"action": "stale_write"})

    unchanged, revision = first.load_snapshot()
    assert revision == current_revision
    assert unchanged["identities"][0]["id"] == "persisted"
    with pytest.raises(KeyError):
        first.save_snapshot(unchanged, revision, event={"entity_type": "identity"})
    after_failure, after_failure_revision = first.load_snapshot()
    assert after_failure_revision == revision
    assert after_failure["identities"][0]["id"] == "persisted"
    first.close()
    second.close()


def test_sqlite_backup_restore_is_verified_without_overwriting(tmp_path):
    database_path = tmp_path / "source.sqlite3"
    store = SQLiteStore(str(database_path))
    snapshot, revision = store.load_or_import({"identities": [], "bots": []})
    store.save_snapshot(
        snapshot,
        revision,
        event={"action": "backup_test", "entity_type": "application"},
        operations=[{
            "operation_type": "CLOSE_POSITIONS",
            "mode": "SIMULATED",
            "status": "SIMULATED",
            "details": {"market_price": 123.0},
        }],
    )
    store.close()

    backup_path = copy_database(database_path, tmp_path / "backup.sqlite3")
    restored_path = copy_database(backup_path, tmp_path / "restored.sqlite3")
    verify_database(restored_path)
    with sqlite3.connect(restored_path) as connection:
        assert connection.execute(
            "SELECT mode, status FROM operations"
        ).fetchone() == ("SIMULATED", "SIMULATED")
        assert connection.execute(
            "SELECT action FROM audit_events WHERE action = 'backup_test'"
        ).fetchone() == ("backup_test",)

    with pytest.raises(FileExistsError):
        copy_database(backup_path, restored_path)


def test_node_and_python_persistence_share_the_same_sqlite_snapshot(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required for the shared persistence test.")
    project_root = Path(__file__).resolve().parents[1]
    database_path = tmp_path / "shared.sqlite3"
    node_store_script = """
const { SQLiteStore } = require('./database');
const store = new SQLiteStore(process.env.BOT_VPN_DB_PATH);
const initial = store.loadOrImport({
  server: { host: '127.0.0.1', port: 3008 },
  auth: { username: 'discarded', password: 'discarded' },
  identities: [{ id: 'shared-identity', full_name: 'Shared Identity', country: 'US' }],
  bots: [{
    id: 'shared-bot',
    name: 'Shared Bot',
    identity_id: 'shared-identity',
    strategy: 'ICTStrategy',
    status: 'PAUSED',
    schedule: { start_time: '09:30', end_time: '11:30', timezone: 'UTC' },
    accounts: [{ id: 'shared-account', custom_name: 'Paper account', balance: 5000 }]
  }]
});
console.log(JSON.stringify({ revision: initial.revision, bots: initial.snapshot.bots.length }));
store.close();
"""
    environment = {**os.environ, "BOT_VPN_DB_PATH": str(database_path)}
    created = subprocess.run(
        [node, "-e", node_store_script],
        cwd=project_root,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    assert json.loads(created.stdout)["bots"] == 1

    manager = BotManager(str(tmp_path / "missing-config.json"), str(database_path))
    manager.load_config()
    assert manager.bots["shared-bot"].accounts[0].balance == 5000
    manager.bots["shared-bot"].schedule["start_time"] = "10:15"
    manager.save_config(event={
        "action": "python_updated_shared_bot",
        "entity_type": "bot",
        "entity_id": "shared-bot",
    })
    manager.close_storage()

    check_node_script = """
const { SQLiteStore } = require('./database');
const store = new SQLiteStore(process.env.BOT_VPN_DB_PATH);
const loaded = store.loadSnapshot();
console.log(JSON.stringify({
  revision: loaded.revision,
  startTime: loaded.snapshot.bots[0].schedule.start_time,
  username: loaded.snapshot.auth.username
}));
store.close();
"""
    loaded = subprocess.run(
        [node, "-e", check_node_script],
        cwd=project_root,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
    )
    result = json.loads(loaded.stdout)
    assert result["revision"] == 2
    assert result["startTime"] == "10:15"
    assert "username" not in result
