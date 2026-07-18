from datetime import datetime
from typing import Any, Dict, List, Optional
from ...database import content_db


class ContentCRUD:
    def save_draft(self, user_id: str, payload: Dict[str, Any]) -> None:
        collection = content_db.content_drafts
        doc = {
            "user_id": user_id,
            "data": payload,
            "timestamp": payload.get("timestamp") or datetime.utcnow().isoformat(),
            "created_at": datetime.utcnow(),
        }
        draft_id = payload.get("id")
        if draft_id:
            # Update existing draft
            collection.update_one(
                {"user_id": user_id, "data.id": draft_id},
                {"$set": doc},
                upsert=True
            )
            print(f"[ContentCRUD] updated draft for user_id={user_id}, id={draft_id}")
        else:
            # Insert new draft
            collection.insert_one(doc)
            print(f"[ContentCRUD] saved new draft for user_id={user_id}")

    def get_latest_draft(self, user_id: str) -> Optional[Dict[str, Any]]:
        collection = content_db.content_drafts
        doc = collection.find_one({"user_id": user_id}, sort=[("created_at", -1)])
        if doc:
            return doc.get("data")
        return None

    def get_draft_history(self, user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        collection = content_db.content_drafts
        docs = collection.find({"user_id": user_id}).sort("created_at", -1).limit(limit)
        return [doc.get("data") for doc in docs]

    def delete_draft(self, user_id: str, draft_id: str) -> bool:
        collection = content_db.content_drafts
        result = collection.delete_one({"user_id": user_id, "data.id": draft_id})
        if result.deleted_count > 0:
            print(f"[ContentCRUD] deleted draft for user_id={user_id}, id={draft_id}")
            return True
        return False
