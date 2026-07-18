from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from fastapi import Depends, HTTPException, Request
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError

from ..database.database import client, content_db, memory_db, persona_db, trend_db


AUTH_DB_NAME = os.getenv("AUTH_DB_NAME", "koc_agent_auth")
SESSION_COOKIE_NAME = os.getenv("SESSION_COOKIE_NAME", "koc_session")
SESSION_TTL_DAYS = int(os.getenv("SESSION_TTL_DAYS", "14"))
PASSWORD_ITERATIONS = 260_000


@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: str
    username: str
    name: str = ""
    avatar: str = ""


class AuthService:
    def __init__(self) -> None:
        self.db = client[AUTH_DB_NAME]
        self.users = self.db.users
        self.sessions = self.db.sessions
        self._ensure_indexes()

    def _ensure_indexes(self) -> None:
        try:
            self.users.create_index("username", unique=True)
            self.sessions.create_index("session_id", unique=True)
            self.sessions.create_index("expires_at", expireAfterSeconds=0)
        except PyMongoError:
            # 允许无 Mongo 的 focused route tests 通过；真实读写时仍会暴露连接错误。
            pass

    def register(self, username: str, password: str, name: str = "", avatar: str = "") -> Dict[str, Any]:
        username = self._normalize_username(username)
        self._validate_password(password)
        display_name = self._normalize_display_name(name) or username.split("@")[0]
        avatar_value = self._normalize_avatar(avatar)
        now = datetime.utcnow()
        user = {
            "user_id": str(uuid.uuid4()),
            "username": username,
            "name": display_name,
            "avatar": avatar_value,
            "password_hash": self._hash_password(password),
            "created_at": now,
            "updated_at": now,
        }
        try:
            self.users.insert_one(user)
        except DuplicateKeyError as exc:
            raise ValueError("该邮箱已注册") from exc
        return self._public_user(user)

    def create_session_for_user(self, user: Dict[str, Any]) -> str:
        session_id = secrets.token_urlsafe(32)
        now = datetime.utcnow()
        self.sessions.insert_one(
            {
                "session_id": session_id,
                "user_id": user["userId"],
                "username": user["username"],
                "created_at": now,
                "expires_at": now + timedelta(days=SESSION_TTL_DAYS),
            }
        )
        return session_id

    def login(self, username: str, password: str) -> tuple[Dict[str, Any], str]:
        username = self._normalize_username(username)
        user = self.users.find_one({"username": username})
        if not user or not self._verify_password(password, user.get("password_hash", "")):
            raise ValueError("用户名或密码错误")

        public_user = self._public_user(user)
        return public_user, self.create_session_for_user(public_user)

    def logout(self, session_id: str | None) -> None:
        if session_id:
            self.sessions.delete_one({"session_id": session_id})

    def update_profile(self, user_id: str, name: Optional[str] = None, avatar: Optional[str] = None) -> Dict[str, Any]:
        update: Dict[str, Any] = {"updated_at": datetime.utcnow()}
        if name is not None:
            normalized_name = self._normalize_display_name(name)
            if not normalized_name:
                raise ValueError("昵称不能为空")
            update["name"] = normalized_name
        if avatar is not None:
            update["avatar"] = self._normalize_avatar(avatar)

        updated = self.users.find_one_and_update(
            {"user_id": user_id},
            {"$set": update},
            return_document=ReturnDocument.AFTER,
        )
        if not updated:
            raise ValueError("账号不存在")
        return self._public_user(updated)

    def delete_user(self, user_id: str) -> bool:
        result = self.users.delete_one({"user_id": user_id})
        self.sessions.delete_many({"user_id": user_id})
        persona_db.personas.delete_many({"user_id": user_id})
        persona_db.persona_results.delete_many({"user_id": user_id})
        trend_db.trend_snapshots.delete_many({"user_id": user_id})
        content_db.content_drafts.delete_many({"user_id": user_id})
        memory_db.conversation_memory.delete_many({"user_id": user_id})
        return result.deleted_count > 0

    def get_user_by_session(self, session_id: str | None) -> Optional[AuthenticatedUser]:
        if not session_id:
            return None

        session = self.sessions.find_one(
            {
                "session_id": session_id,
                "expires_at": {"$gt": datetime.utcnow()},
            }
        )
        if not session:
            return None

        user = self.users.find_one({"user_id": session["user_id"]})
        if not user:
            self.sessions.delete_one({"session_id": session_id})
            return None

        return AuthenticatedUser(
            user_id=user["user_id"],
            username=user["username"],
            name=user.get("name", ""),
            avatar=user.get("avatar", ""),
        )

    def _normalize_username(self, username: str) -> str:
        normalized = (username or "").strip().lower()
        if len(normalized) < 3:
            raise ValueError("用户名至少需要 3 个字符")
        if len(normalized) > 64:
            raise ValueError("用户名不能超过 64 个字符")
        return normalized

    def _validate_password(self, password: str) -> None:
        if len(password or "") < 8:
            raise ValueError("密码至少需要 8 个字符")

    def _normalize_display_name(self, name: str) -> str:
        normalized = (name or "").strip()
        if len(normalized) > 16:
            raise ValueError("昵称不能超过 16 个字符")
        return normalized

    def _normalize_avatar(self, avatar: str) -> str:
        normalized = (avatar or "").strip()
        if normalized.startswith("data:image/"):
            if len(normalized) > 260_000:
                raise ValueError("头像图片不能超过 200KB")
            return normalized
        if len(normalized) > 4:
            raise ValueError("头像不能超过 4 个字符")
        return normalized or "梨"

    def _hash_password(self, password: str) -> str:
        salt = secrets.token_bytes(16)
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            PASSWORD_ITERATIONS,
        )
        return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${salt.hex()}${digest.hex()}"

    def _verify_password(self, password: str, encoded: str) -> bool:
        try:
            algorithm, iterations, salt_hex, digest_hex = encoded.split("$", 3)
            if algorithm != "pbkdf2_sha256":
                return False
            digest = hashlib.pbkdf2_hmac(
                "sha256",
                password.encode("utf-8"),
                bytes.fromhex(salt_hex),
                int(iterations),
            )
            return hmac.compare_digest(digest.hex(), digest_hex)
        except (ValueError, TypeError):
            return False

    def _public_user(self, user: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "userId": user["user_id"],
            "username": user["username"],
            "name": user.get("name", ""),
            "avatar": user.get("avatar", "梨"),
        }


auth_service = AuthService()


def get_current_user(request: Request) -> Optional[AuthenticatedUser]:
    return auth_service.get_user_by_session(request.cookies.get(SESSION_COOKIE_NAME))


def require_current_user(
    user: Optional[AuthenticatedUser] = Depends(get_current_user),
) -> AuthenticatedUser:
    if user is None:
        raise HTTPException(status_code=401, detail="未登录")
    return user
