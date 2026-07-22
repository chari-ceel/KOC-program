from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
from bson import ObjectId
from ...database import persona_db


class PersonaCRUD:
    def _ensure_indexes(self, collection) -> None:
        collection.create_index("expires_at", expireAfterSeconds=0)
        collection.create_index([("user_id", 1), ("created_at", -1)])

    def _serialize_record(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        data = doc.get("data") or {}
        created_at = doc.get("created_at")
        expires_at = doc.get("expires_at")
        if isinstance(data, dict):
            data = {
                **data,
                "personaRecordId": str(doc.get("_id")),
                "isFavorited": bool(doc.get("is_favorited")),
                "savedAt": created_at.isoformat() if isinstance(created_at, datetime) else data.get("savedAt"),
                "expiresAt": expires_at.isoformat() if isinstance(expires_at, datetime) else None,
            }
        return {
            "id": str(doc.get("_id")),
            "persona": data,
            "isFavorited": bool(doc.get("is_favorited")),
            "savedAt": created_at.isoformat() if isinstance(created_at, datetime) else None,
            "expiresAt": expires_at.isoformat() if isinstance(expires_at, datetime) else None,
        }

    def _record_query(self, user_id: str, record_id: str) -> Dict[str, Any]:
        return {"_id": ObjectId(record_id), "user_id": user_id}

    def save_persona(self, user_id: str, payload: Dict[str, Any], collection_name: str = "persona_results") -> Dict[str, Any]:
        collection = persona_db[collection_name]
        self._ensure_indexes(collection)
        now = datetime.utcnow()
        doc = {
            "user_id": user_id,
            "data": payload,
            "is_favorited": False,
            "created_at": now,
            "updated_at": now,
        }
        if collection_name != "personas":
            doc["expires_at"] = now + timedelta(days=7)
        result = collection.insert_one(doc)
        doc["_id"] = result.inserted_id
        print(f"[PersonaCRUD] saved persona record for user_id={user_id} into {collection_name}")
        return self._serialize_record(doc)

    def get_persona(self, user_id: str) -> Optional[Dict[str, Any]]:
        for collection_name in ["personas", "persona_results"]:
            collection = persona_db[collection_name]
            doc = collection.find_one({"user_id": user_id}, sort=[("created_at", -1)])
            if doc:
                return doc.get("data")
        return None

    def get_persona_history(self, user_id: str, days: int = 7, limit: int = 50) -> List[Dict[str, Any]]:
        collection = persona_db["personas"]
        self._ensure_indexes(collection)
        docs = collection.find({"user_id": user_id}).sort("created_at", -1).limit(limit)
        return [self._serialize_record(doc) for doc in docs]

    def get_favorite_personas(self, user_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        collection = persona_db["personas"]
        self._ensure_indexes(collection)
        docs = collection.find({
            "user_id": user_id,
            "is_favorited": True,
        }).sort("updated_at", -1).limit(limit)
        return [self._serialize_record(doc) for doc in docs]

    def get_persona_record(self, user_id: str, record_id: str) -> Optional[Dict[str, Any]]:
        collection = persona_db["personas"]
        self._ensure_indexes(collection)
        doc = collection.find_one(self._record_query(user_id, record_id))
        return self._serialize_record(doc) if doc else None

    def set_persona_favorite(self, user_id: str, record_id: str, is_favorited: bool) -> Optional[Dict[str, Any]]:
        collection = persona_db["personas"]
        self._ensure_indexes(collection)
        now = datetime.utcnow()
        update: Dict[str, Any]
        if is_favorited:
            update = {"$set": {"is_favorited": True, "updated_at": now}, "$unset": {"expires_at": ""}}
        else:
            doc = collection.find_one(self._record_query(user_id, record_id))
            if not doc:
                return None
            created_at = doc.get("created_at") if isinstance(doc.get("created_at"), datetime) else now
            update = {
                "$set": {
                    "is_favorited": False,
                    "updated_at": now,
                    "expires_at": created_at + timedelta(days=7),
                }
            }
        collection.update_one(self._record_query(user_id, record_id), update)
        return self.get_persona_record(user_id, record_id)

    def delete_persona_record(self, user_id: str, record_id: str) -> bool:
        collection = persona_db["personas"]
        self._ensure_indexes(collection)
        result = collection.delete_one(self._record_query(user_id, record_id))
        return result.deleted_count > 0
