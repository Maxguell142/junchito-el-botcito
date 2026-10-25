"""SQLite persistence shared by the FastAPI gateway and the Node dashboard."""

from __future__ import annotations

import json
import math
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit, urlunsplit


class PersistenceConflict(RuntimeError):
    """Raised when another server saved a newer application snapshot."""


class SQLiteStore:
    def __init__(self, database_path: Optional[str] = None):
        default_path = Path(__file__).resolve().parent / "bot_vpn.sqlite3"
        self.database_path = database_path or os.environ.get("BOT_VPN_DB_PATH", str(default_path))
        if self.database_path != ":memory:":
            Path(self.database_path).resolve().parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.database_path, timeout=5, isolation_level=None)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.execute("PRAGMA busy_timeout = 5000")
        self.connection.execute("PRAGMA journal_mode = WAL")
        self._apply_migrations()

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _json(value: Any) -> str:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)

    @staticmethod
    def sanitize_legacy_snapshot(
        snapshot: dict[str, Any],
        include_daily_metrics: bool = False,
    ) -> dict[str, Any]:
        identities = []
        for identity in snapshot.get("identities", []):
            if not isinstance(identity, dict) or not isinstance(identity.get("id"), str):
                continue
            identities.append({
                key: identity[key]
                for key in ("id", "full_name", "alias", "country", "city", "flag", "kyc_status", "email", "notes")
                if key in identity
            })

        bots = []
        for bot in snapshot.get("bots", []):
            if not isinstance(bot, dict) or not isinstance(bot.get("id"), str):
                continue
            safe_bot = {
                key: bot[key]
                for key in (
                    "id", "name", "identity_id", "strategy", "outbound_ip", "proxy_port",
                    "isp_provider", "node_location", "geo_match_status", "status",
                    "jitter_min_ms", "jitter_max_ms", "jitter_ms", "schedule",
                    "net_pnl", "today_pnl", "total_trades", "winning_trades",
                    "losing_trades", "max_drawdown", "logs"
                )
                if key in bot
            }
            safe_bot["proxy_url"] = SQLiteStore._sanitize_proxy_url(bot.get("proxy_url"))
            accounts = []
            for account in bot.get("accounts", []):
                if not isinstance(account, dict) or not isinstance(account.get("id"), str):
                    continue
                safe_account = {
                    key: account[key]
                    for key in (
                        "id", "custom_name", "broker", "prop_firm", "balance",
                        "floating_pnl", "realized_pnl", "active_contracts",
                        "current_position", "entry_price", "last_order_time",
                        "titular_name", "environment", "max_contracts",
                        "daily_loss_limit"
                    )
                    if key in account
                }
                max_contracts = account.get("max_contracts", 2)
                daily_loss_limit = account.get("daily_loss_limit", 1000.0)
                if isinstance(max_contracts, bool) or not isinstance(max_contracts, int) or not 1 <= max_contracts <= 100:
                    raise ValueError(f"Límite max_contracts inválido para la cuenta {account['id']}.")
                if (
                    isinstance(daily_loss_limit, bool)
                    or not isinstance(daily_loss_limit, (int, float))
                    or not math.isfinite(daily_loss_limit)
                    or daily_loss_limit < 0
                ):
                    raise ValueError(f"Límite daily_loss_limit inválido para la cuenta {account['id']}.")
                safe_account["max_contracts"] = max_contracts
                safe_account["daily_loss_limit"] = float(daily_loss_limit)
                if include_daily_metrics:
                    daily_pnl = account.get("daily_pnl", 0.0)
                    orders_today = account.get("orders_today", 0)
                    metrics_date = account.get(
                        "daily_metrics_date",
                        datetime.now(timezone.utc).date().isoformat(),
                    )
                    if (
                        isinstance(daily_pnl, bool)
                        or not isinstance(daily_pnl, (int, float))
                        or not math.isfinite(daily_pnl)
                    ):
                        raise ValueError(f"daily_pnl inválido para la cuenta {account['id']}.")
                    if isinstance(orders_today, bool) or not isinstance(orders_today, int) or orders_today < 0:
                        raise ValueError(f"orders_today inválido para la cuenta {account['id']}.")
                    try:
                        datetime.strptime(metrics_date, "%Y-%m-%d")
                    except (TypeError, ValueError) as exc:
                        raise ValueError(f"daily_metrics_date inválido para la cuenta {account['id']}.") from exc
                    safe_account.update({
                        "daily_pnl": float(daily_pnl),
                        "orders_today": orders_today,
                        "daily_metrics_date": metrics_date,
                    })
                safe_account["username"] = "••••" if account.get("username") else ""
                safe_account["password_masked"] = "••••••••"
                safe_account["status"] = "NOT_CONFIGURED"
                accounts.append(safe_account)
            safe_bot["accounts"] = accounts
            bots.append(safe_bot)

        server_data = snapshot.get("server") if isinstance(snapshot.get("server"), dict) else {}
        auth_data = snapshot.get("auth") if isinstance(snapshot.get("auth"), dict) else {}
        return {
            "server": {
                "host": "127.0.0.1",
                "port": server_data.get("port", 8000),
            },
            "auth": {"role": auth_data.get("role", "ADMIN_TRADER")},
            "identities": identities,
            "bots": bots,
        }

    @staticmethod
    def _sanitize_proxy_url(value: Any) -> str:
        if not isinstance(value, str) or not value:
            return ""
        try:
            parsed = urlsplit(value)
            if not parsed.scheme or not parsed.hostname:
                return ""
            host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
            port = f":{parsed.port}" if parsed.port else ""
            return urlunsplit((parsed.scheme, f"{host}{port}", parsed.path, "", ""))
        except ValueError:
            return ""

    def _apply_migrations(self) -> None:
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
        )
        migration_dir = Path(__file__).resolve().parent / "migrations"
        for migration_path in sorted(migration_dir.glob("[0-9][0-9][0-9]_*.sql")):
            version = int(migration_path.name.split("_", 1)[0])
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                exists = self.connection.execute(
                    "SELECT 1 FROM schema_migrations WHERE version = ?", (version,)
                ).fetchone()
                if exists:
                    self.connection.commit()
                    continue
                statement = ""
                for line in migration_path.read_text(encoding="utf-8").splitlines():
                    statement += line + "\n"
                    if sqlite3.complete_statement(statement):
                        self.connection.execute(statement)
                        statement = ""
                if statement.strip():
                    raise RuntimeError(f"Sentencia SQL incompleta en {migration_path.name}.")
                self.connection.execute(
                    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
                    (version, migration_path.name, self._now()),
                )
                self.connection.commit()
            except Exception:
                self.connection.rollback()
                raise

    @property
    def revision(self) -> int:
        row = self.connection.execute("SELECT revision FROM app_state WHERE id = 1").fetchone()
        return int(row["revision"])

    def health_check(self) -> None:
        state = self.connection.execute(
            "SELECT revision FROM app_state WHERE id = 1"
        ).fetchone()
        if state is None or isinstance(state["revision"], bool) or not isinstance(state["revision"], int):
            raise sqlite3.DatabaseError("El estado de persistencia no está disponible.")

    def load_or_import(self, legacy_snapshot: dict[str, Any]) -> tuple[dict[str, Any], int]:
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            revision = self.revision
            if revision == 0:
                safe_snapshot = self.sanitize_legacy_snapshot(legacy_snapshot)
                self._replace_snapshot(safe_snapshot)
                self._insert_audit_event({
                    "action": "legacy_config_imported",
                    "entity_type": "application",
                    "status": "SUCCEEDED",
                    "actor": "system",
                    "details": {"source": "config.json"},
                })
                revision = 1
                self.connection.execute("UPDATE app_state SET revision = ? WHERE id = 1", (revision,))
            snapshot = self._read_snapshot()
            self.connection.commit()
            return snapshot, revision
        except Exception:
            self.connection.rollback()
            raise

    def load_snapshot(self) -> tuple[dict[str, Any], int]:
        snapshot = self._read_snapshot()
        return snapshot, self.revision

    def save_snapshot(
        self,
        snapshot: dict[str, Any],
        expected_revision: int,
        event: Optional[dict[str, Any]] = None,
        operations: Optional[list[dict[str, Any]]] = None,
    ) -> int:
        safe_snapshot = self.sanitize_legacy_snapshot(snapshot, include_daily_metrics=True)
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            current_revision = self.revision
            if current_revision != expected_revision:
                raise PersistenceConflict("La base de datos cambió desde la última lectura.")
            self._replace_snapshot(safe_snapshot)
            if event:
                self._insert_audit_event(event)
            for operation in operations or []:
                self._insert_operation(operation)
            new_revision = current_revision + 1
            self.connection.execute("UPDATE app_state SET revision = ? WHERE id = 1", (new_revision,))
            self.connection.commit()
            return new_revision
        except Exception:
            self.connection.rollback()
            raise

    def _replace_snapshot(self, snapshot: dict[str, Any]) -> None:
        now = self._now()
        self.connection.execute("DELETE FROM accounts")
        self.connection.execute("DELETE FROM bots")
        self.connection.execute("DELETE FROM identities")
        self.connection.execute("DELETE FROM app_settings")
        self.connection.executemany(
            "INSERT INTO identities (id, data_json, updated_at) VALUES (?, ?, ?)",
            [(identity["id"], self._json(identity), now) for identity in snapshot["identities"]],
        )
        identity_ids = {identity["id"] for identity in snapshot["identities"]}
        for bot in snapshot["bots"]:
            bot_data = dict(bot)
            accounts = bot_data.pop("accounts", [])
            identity_id = bot_data.get("identity_id")
            if identity_id not in identity_ids:
                bot_data["identity_id"] = None
                identity_id = None
            self.connection.execute(
                "INSERT INTO bots (id, identity_id, data_json, updated_at) VALUES (?, ?, ?, ?)",
                (bot_data["id"], identity_id, self._json(bot_data), now),
            )
            for account in accounts:
                self.connection.execute(
                    "INSERT INTO accounts (bot_id, account_id, data_json, updated_at) VALUES (?, ?, ?, ?)",
                    (bot_data["id"], account["id"], self._json(account), now),
                )
        for key in ("server", "auth"):
            self.connection.execute(
                "INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)",
                (key, self._json(snapshot.get(key, {})), now),
            )

    def _read_snapshot(self) -> dict[str, Any]:
        settings = {
            row["key"]: json.loads(row["value_json"])
            for row in self.connection.execute("SELECT key, value_json FROM app_settings")
        }
        identities = [
            json.loads(row["data_json"])
            for row in self.connection.execute("SELECT data_json FROM identities ORDER BY rowid")
        ]
        bots = []
        for row in self.connection.execute(
            "SELECT id, identity_id, data_json FROM bots ORDER BY rowid"
        ):
            bot = json.loads(row["data_json"])
            bot["identity_id"] = row["identity_id"]
            bot["accounts"] = [
                json.loads(account["data_json"])
                for account in self.connection.execute(
                    "SELECT data_json FROM accounts WHERE bot_id = ? ORDER BY rowid", (row["id"],)
                )
            ]
            bots.append(bot)
        return {
            "server": settings.get("server", {"host": "127.0.0.1", "port": 8000}),
            "auth": settings.get("auth", {"role": "ADMIN_TRADER"}),
            "identities": identities,
            "bots": bots,
        }

    def _insert_audit_event(self, event: dict[str, Any]) -> None:
        details = event.get("details", {})
        self.connection.execute(
            "INSERT INTO audit_events "
            "(occurred_at, actor, action, entity_type, entity_id, status, details_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                event.get("occurred_at", self._now()),
                event.get("actor", "local"),
                event["action"],
                event.get("entity_type", "application"),
                event.get("entity_id"),
                event.get("status", "SUCCEEDED"),
                self._json(details),
            ),
        )

    def _insert_operation(self, operation: dict[str, Any]) -> None:
        self.connection.execute(
            "INSERT INTO operations "
            "(id, bot_id, account_id, operation_type, mode, status, occurred_at, details_json, idempotency_key) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                operation.get("id", str(uuid.uuid4())),
                operation.get("bot_id"),
                operation.get("account_id"),
                operation["operation_type"],
                operation.get("mode", "SIMULATED"),
                operation.get("status", "SIMULATED"),
                operation.get("occurred_at", self._now()),
                self._json(operation.get("details", {})),
                operation.get("idempotency_key"),
            ),
        )

    def has_processed_signal(self, signal_id: str) -> bool:
        prefix = f"{signal_id}:"
        return self.connection.execute(
            "SELECT 1 FROM operations "
            "WHERE idempotency_key IS NOT NULL AND substr(idempotency_key, 1, ?) = ? LIMIT 1",
            (len(prefix), prefix),
        ).fetchone() is not None

    def close(self) -> None:
        self.connection.close()
