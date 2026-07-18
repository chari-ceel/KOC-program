from __future__ import annotations

from datetime import datetime
from enum import StrEnum


class AgentStatus(StrEnum):
    SUCCESS = "success"
    PARTIAL_SUCCESS = "partial_success"
    FAILED = "failed"


class Platform(StrEnum):
    XIAOHONGSHU = "xiaohongshu"
    DOUYIN = "douyin"
    BILIBILI = "bilibili"


class ContentType(StrEnum):
    IMAGE_TEXT_NOTE = "image_text_note"
    SHORT_VIDEO_SCRIPT = "short_video_script"
    LONG_VIDEO_OUTLINE = "long_video_outline"


class SupportedTaskType(StrEnum):
    PERSONA_ANALYZE = "persona.analyze"
    PERSONA_FOLLOW_UP = "persona.follow_up"
    TREND_TRACK = "trend.track"
    TOPIC_RECOMMEND = "topic.recommend"
    CONTENT_DRAFT = "content.draft"
    CONTENT_REVISE = "content.revise"


class ReservedTaskType(StrEnum):
    CONTEXT_PLAN = "context.plan"
    ANALYTICS_INSIGHT = "analytics.insight"
    OPERATION_PLAN = "operation.plan"
    DOUYIN_CONTENT_DRAFT = "douyin.content_draft"
    BILIBILI_CONTENT_DRAFT = "bilibili.content_draft"


def utc_now() -> datetime:
    return datetime.utcnow()
