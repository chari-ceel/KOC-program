from datetime import datetime
from typing import Any, Dict, Optional

from ...database import memory_db


class MemoryCRUD:
    def get_memory_state(self, user_id: str, scope_id: str) -> Optional[Dict[str, Any]]:
        collection = memory_db.conversation_memory
        doc = collection.find_one({"user_id": user_id, "scope_id": scope_id})
        return doc.get("data") if doc else None

    def save_memory_state(self, user_id: str, scope_id: str, payload: Dict[str, Any]) -> None:
        collection = memory_db.conversation_memory
        collection.update_one(
            {"user_id": user_id, "scope_id": scope_id},
            {
                "$set": {
                    "user_id": user_id,
                    "scope_id": scope_id,
                    "data": payload,
                    "updated_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )
