from __future__ import annotations

import hashlib
import os
from datetime import datetime
from typing import Any, Optional

from fastapi import Request
from pymongo.errors import PyMongoError

from ..database.database import client
from ..services.auth import AuthenticatedUser


ANALYTICS_DB_NAME = os.getenv("ANALYTICS_DB_NAME", "koc_agent_analytics")


class AnalyticsService:
    def __init__(self) -> None:
        self.db = client[ANALYTICS_DB_NAME]
        self.collection = self.db.analytics_events
        self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        try:
            self.collection.create_index("created_at")
            self.collection.create_index([("user_id", 1), ("event_name", 1), ("created_at", -1)])
            self.collection.create_index([("module", 1), ("event_name", 1), ("created_at", -1)])
            self.collection.create_index([("conversation_id", 1), ("created_at", -1)])
            self.collection.create_index("request_id")
        except PyMongoError:
            pass

    def record_event(
        self,
        *,
        event_name: str,
        module: str,
        payload: dict[str, Any],
        request: Request,
        user: Optional[AuthenticatedUser] = None,
    ) -> None:
        now = datetime.utcnow()
        document = {
            "event_name": event_name,
            "module": module,
            "conversation_id": payload.get("conversation_id"),
            "message_id": payload.get("message_id"),
            "request_id": payload.get("request_id"),
            "task_type": payload.get("task_type"),
            "user_id": user.user_id if user else None,
            "is_authenticated": bool(user),
            "request_ip_hash": self._hash_ip(request.client.host if request.client else None),
            "user_agent": request.headers.get("user-agent"),
            "payload": payload,
            "created_at": now,
        }
        self.collection.insert_one(document)

    @staticmethod
    def _hash_ip(ip: str | None) -> str | None:
        if not ip:
            return None
        return hashlib.sha256(ip.encode("utf-8")).hexdigest()


analytics_service = AnalyticsService()
