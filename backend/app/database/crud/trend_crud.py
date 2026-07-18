from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from ...database import trend_db


class TrendCRUD:
    def _fallback_query(self, user_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        track_name = payload.get("trackName")
        track_time = payload.get("trackTime")
        user_prompt = payload.get("userPrompt")
        if not all(isinstance(value, str) and value.strip() for value in [track_name, track_time, user_prompt]):
            return None
        return {
            "user_id": user_id,
            "data.trackName": track_name,
            "data.trackTime": track_time,
            "data.userPrompt": user_prompt,
        }

    def can_identify_record(self, payload: Dict[str, Any]) -> bool:
        return bool(payload.get("id") or self._fallback_query("", payload))

    def save_trend_snapshot(self, user_id: str, payload: Dict[str, Any]) -> None:
        collection = trend_db.trend_snapshots
        doc = {
            "user_id": user_id,
            "data": payload,
            "timestamp": payload.get("timestamp") or datetime.utcnow().isoformat(),
            "created_at": datetime.utcnow(),
        }
        record_id = payload.get("id")
        if record_id:
            query = {"user_id": user_id, "data.id": record_id}
            fallback_query = self._fallback_query(user_id, payload)
            if fallback_query:
                query = {"$or": [query, fallback_query]}
            collection.update_one(query, {"$set": doc}, upsert=True)
            print(f"[TrendCRUD] updated trend snapshot for user_id={user_id}, id={record_id}")
            return

        fallback_query = self._fallback_query(user_id, payload)
        if not fallback_query:
            raise ValueError("Trend record requires id or trackName/trackTime/userPrompt")

        collection.update_one(fallback_query, {"$set": doc}, upsert=True)
        print(f"[TrendCRUD] upserted trend snapshot for user_id={user_id}")

    def get_latest_trend_snapshot(self, user_id: str) -> Optional[Dict[str, Any]]:
        collection = trend_db.trend_snapshots
        doc = collection.find_one({"user_id": user_id}, sort=[("created_at", -1)])
        if doc:
            return doc.get("data")
        return None

    def get_trend_history(self, user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
        collection = trend_db.trend_snapshots
        docs = collection.find({"user_id": user_id}).sort("created_at", -1).limit(limit)
        return [doc.get("data") for doc in docs]

    def delete_trend_snapshot(self, user_id: str, record: Dict[str, Any]) -> Tuple[bool, str]:
        collection = trend_db.trend_snapshots
        record_id = record.get("id")
        if record_id:
            query = {"user_id": user_id, "data.id": record_id}
            fallback_query = self._fallback_query(user_id, record)
            if fallback_query:
                query = {"$or": [query, fallback_query]}
        else:
            query = self._fallback_query(user_id, record)
            if not query:
                return False, "invalid"
        result = collection.delete_one(query)
        print(f"[TrendCRUD] deleted {result.deleted_count} trend snapshot for user_id={user_id}")
        return result.deleted_count > 0, "not_found" if result.deleted_count == 0 else "deleted"
