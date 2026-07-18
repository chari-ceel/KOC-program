from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.adapters.agent.builder import ContextBuilder
from backend.app.schemas.agent.protocol import AgentRunResponse
from backend.app.services.content.service import ContentService
from backend.app.services.persona.service import PersonaService
from backend.app.services.trend.service import TrendService


USER_ID = "benchmark-user"


class InMemoryCursor:
    def __init__(self, docs: List[Dict[str, Any]]) -> None:
        self.docs = docs

    def sort(self, key: str, direction: int) -> "InMemoryCursor":
        reverse = direction < 0
        parts = key.split(".")

        def read_value(doc: Dict[str, Any]) -> Any:
            current: Any = doc
            for part in parts:
                if not isinstance(current, dict):
                    return None
                current = current.get(part)
            return current

        self.docs = sorted(self.docs, key=read_value, reverse=reverse)
        return self

    def limit(self, value: int) -> "InMemoryCursor":
        self.docs = self.docs[:value]
        return self

    def __iter__(self):
        return iter(self.docs)


class InMemoryDeleteResult:
    def __init__(self, deleted_count: int) -> None:
        self.deleted_count = deleted_count


class InMemoryCollection:
    def __init__(self) -> None:
        self.docs: list[dict[str, Any]] = []

    def _read_path(self, doc: Dict[str, Any], key: str) -> Any:
        current: Any = doc
        for part in key.split("."):
            if not isinstance(current, dict):
                return None
            current = current.get(part)
        return current

    def _matches(self, doc: Dict[str, Any], query: Dict[str, Any]) -> bool:
        if "$or" in query:
            return any(self._matches(doc, item) for item in query["$or"])
        return all(self._read_path(doc, key) == value for key, value in query.items())

    def find_one(self, query: Dict[str, Any], sort: Optional[List[tuple[str, int]]] = None) -> Optional[Dict[str, Any]]:
        docs = [dict(doc) for doc in self.docs if self._matches(doc, query)]
        if sort:
            cursor = InMemoryCursor(docs)
            for key, direction in sort:
                cursor.sort(key, direction)
            docs = list(cursor)
        for doc in reversed(docs) if not sort else docs:
            return dict(doc)
        return None

    def update_one(self, query: Dict[str, Any], update: Dict[str, Any], upsert: bool = False) -> None:
        new_values = dict(update.get("$set") or {})
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                merged = dict(doc)
                merged.update(new_values)
                self.docs[index] = merged
                return
        if upsert:
            self.docs.append({**query, **new_values})

    def replace_one(self, query: Dict[str, Any], payload: Dict[str, Any], upsert: bool = False) -> None:
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                self.docs[index] = dict(payload)
                return
        if upsert:
            self.docs.append(dict(payload))

    def insert_one(self, payload: Dict[str, Any]) -> None:
        self.docs.append(dict(payload))

    def find(self, query: Dict[str, Any]) -> InMemoryCursor:
        return InMemoryCursor([dict(doc) for doc in self.docs if self._matches(doc, query)])

    def delete_one(self, query: Dict[str, Any]) -> InMemoryDeleteResult:
        for index, doc in enumerate(self.docs):
            if self._matches(doc, query):
                del self.docs[index]
                return InMemoryDeleteResult(1)
        return InMemoryDeleteResult(0)


class InMemoryDatabaseNamespace:
    def __init__(self) -> None:
        self._collections: dict[str, InMemoryCollection] = {}

    def __getitem__(self, name: str) -> InMemoryCollection:
        if name not in self._collections:
            self._collections[name] = InMemoryCollection()
        return self._collections[name]

    def __getattr__(self, name: str) -> InMemoryCollection:
        return self.__getitem__(name)


class InMemoryDB:
    def __init__(self) -> None:
        self.persona_db = InMemoryDatabaseNamespace()
        self.trend_db = InMemoryDatabaseNamespace()
        self.content_db = InMemoryDatabaseNamespace()
        self.memory_db = InMemoryDatabaseNamespace()


@dataclass
class TurnMetric:
    turn_index: int
    user_message: str
    context_build_ms: float
    agent_call_ms: float
    memory_refresh_ms: float
    total_ms: float
    recent_message_count: int
    summary_covered_count: int
    summary_status: str
    agent_input_message_count: int
    agent_input_estimated_tokens: int


def estimate_tokens(payload: Any) -> int:
    text = json.dumps(payload, ensure_ascii=False)
    return max(1, len(text) // 4)


def summarize_metrics(metrics: List[TurnMetric]) -> Dict[str, Any]:
    total_values = [item.total_ms for item in metrics]
    context_values = [item.context_build_ms for item in metrics]
    agent_values = [item.agent_call_ms for item in metrics]
    memory_values = [item.memory_refresh_ms for item in metrics]

    def percentile(values: List[float], q: float) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        index = round((len(ordered) - 1) * q)
        return ordered[index]

    return {
        "turns": len(metrics),
        "total_ms_avg": round(statistics.mean(total_values), 2),
        "total_ms_p50": round(statistics.median(total_values), 2),
        "total_ms_p95": round(percentile(total_values, 0.95), 2),
        "context_build_ms_avg": round(statistics.mean(context_values), 2),
        "agent_call_ms_avg": round(statistics.mean(agent_values), 2),
        "memory_refresh_ms_avg": round(statistics.mean(memory_values), 2),
        "final_summary_covered_count": metrics[-1].summary_covered_count if metrics else 0,
        "final_summary_status": metrics[-1].summary_status if metrics else "unknown",
        "final_agent_input_message_count": metrics[-1].agent_input_message_count if metrics else 0,
        "final_agent_input_estimated_tokens": metrics[-1].agent_input_estimated_tokens if metrics else 0,
    }


TREND_SCRIPT_13 = [
    "我想做一个面向大学新生的成长类账号，先帮我判断热门追踪方向。",
    "先记住，我不做考研，也不做职场，只做大一到大二的校园成长。",
    "我更想从低成本自律、宿舍关系、社团选择这几个方向找机会。",
    "你先别给我泛泛建议，我更关心哪些方向最近更容易出爆点。",
    "还有一个前提，我希望内容偏女生视角，但不要走情绪宣泄路线。",
    "如果必须取舍，优先保留低成本自律，先放掉宿舍关系。",
    "社团选择这个点我有点犹豫，你先不要把它当主方向。",
    "你可以先告诉我，低成本自律里更适合追哪些子话题。",
    "我希望选题更像能涨粉的搜索词，不要太鸡汤。",
    "如果你觉得有必要，可以顺便比较一下早八、自习室、时间管理这几个点。",
    "但请记住，我现在的核心还是大一女生、低成本自律、搜索感强。",
    "先不要展开社团话题。",
    "现在基于我们前面的限制，直接给我一个你认为最值得追的热门方向，并解释为什么。",
]

TREND_SCRIPT_24 = TREND_SCRIPT_13 + [
    "这个方向可以，但不要做那种纯打卡模板，我怕内容太同质化。",
    "你换个角度，想想哪些话题更像“新生刚开学就会搜”的问题。",
    "我接受“早八起床困难”这个切口，但不要把它写成鸡血型励志。",
    "先排除“逆袭”“蜕变”这种大词，我要更具体的痛点表达。",
    "还有，我不想过多讲学习方法论，更想讲生活场景里的执行难点。",
    "比如起床、洗衣、排队、自习室占座、晚上拖延这种。",
    "你先比较一下“起床困难”和“晚上拖延”，哪个更值得追。",
    "如果只能选一个，我更偏向晚上拖延，因为更容易写具体场景。",
    "但你要警惕别把内容写成情感安慰，我还是要搜索感和方法感。",
    "现在你忘掉那些被我否掉的方向，再重新收束一次。",
    "请直接总结：当前最优热门方向、目标人群、表达边界、不要碰的方向。",
]

CONTENT_SCRIPT = [
    "帮我写一篇面向大学新生的低成本自律笔记，偏小红书搜索感。",
    "标题不要鸡汤，要像用户会主动搜索的问题。",
    "先给我完整初稿。",
    "这版里“逆袭”这个词去掉，我不想要这种太大的表达。",
    "开头也不要说教，换成更生活化的场景。",
    "再改一次，重点保留“晚上拖延”这个切口。",
    "现在基于你最新那版 draft，把标题改得更像搜索词，再给我一个更短的开头。",
]


class BenchmarkHarness:
    def __init__(self) -> None:
        self.db = InMemoryDB()
        self._seed_persona()

    def _seed_persona(self) -> None:
        self.db.persona_db["personas"].replace_one(
            {"user_id": USER_ID},
            {
                "user_id": USER_ID,
                "data": {
                    "persona": {"name": "大学生成长型学习博主"},
                    "niche": {"primary": "大学生成长", "secondary": ["低成本自律", "校园生活"]},
                    "audience": ["大学新生女生"],
                    "contentStyle": ["搜索感强", "生活化", "不鸡汤"],
                },
            },
            upsert=True,
        )

    def _patch_db(self):
        return patch.multiple(
            "backend.app.database.database",
            persona_db=self.db.persona_db,
            trend_db=self.db.trend_db,
            content_db=self.db.content_db,
            memory_db=self.db.memory_db,
        )

    def _patch_crud_modules(self):
        return patch.multiple(
            "backend.app.database",
            persona_db=self.db.persona_db,
            trend_db=self.db.trend_db,
            content_db=self.db.content_db,
            memory_db=self.db.memory_db,
        )

    def _patch_crud_globals(self):
        patchers = [
            patch("backend.app.database.crud.persona_crud.persona_db", self.db.persona_db),
            patch("backend.app.database.crud.trend_crud.trend_db", self.db.trend_db),
            patch("backend.app.database.crud.content_crud.content_db", self.db.content_db),
            patch("backend.app.database.crud.memory_crud.memory_db", self.db.memory_db),
        ]

        class _PatchGroup:
            def __enter__(self_nonlocal):
                for item in patchers:
                    item.start()
                return self_nonlocal

            def __exit__(self_nonlocal, exc_type, exc, tb):
                for item in reversed(patchers):
                    item.stop()
                return False

        return _PatchGroup()

    def _patch_agent(self):
        async def fake_run(_client_self, request):
            start = time.perf_counter()
            await asyncio.sleep(0)
            task_type = request.taskType
            if task_type == "trend.track":
                topic_count = max(1, len(request.context.get("recentMessages") or []))
                data = {
                    "reply": f"基于当前上下文给出第 {topic_count} 轮趋势收束。",
                    "trendSummary": {
                        "summary": "大学新生低成本自律与晚上拖延相关话题更有搜索感。",
                        "niche": "大学生成长",
                        "platform": "小红书",
                        "period": "最近 7 天",
                    },
                    "hotTrends": [
                        {"name": "晚上拖延", "reason": "更容易写出生活场景，搜索词更具体。"},
                        {"name": "早八起床困难", "reason": "高频但容易同质化。"},
                    ],
                    "audienceNeeds": [
                        {"need": "低成本自律", "evidence": "新生更关心可立即执行的生活管理。"},
                        {"need": "搜索感表达", "evidence": "问题式标题更像主动搜索词。"},
                    ],
                    "topicOpportunities": [
                        {"title": "晚上拖延怎么补救", "angle": "宿舍场景、执行门槛低"},
                        {"title": "新生早八起不来怎么办", "angle": "具体作息场景"},
                        {"title": "自习室占座焦虑", "angle": "生活执行难点"},
                    ],
                    "validationKeywords": ["晚上拖延", "低成本自律", "大学新生"],
                    "cardPreview": {
                        "discoveryKeywords": ["晚上拖延", "低成本自律", "大学新生"],
                        "shortTopics": ["拖延补救", "新生自律", "早八起床"],
                    },
                }
            elif task_type in {"content.draft", "content.revise"}:
                instruction = request.input.get("revisionInstruction") or request.input.get("userInstruction") or ""
                data = {
                    "reply": "已经按当前 draft 和要求调整。",
                    "draft": {
                        "selectedTitle": "大学新生晚上拖延怎么补救",
                        "hook": "如果你总在晚上想努力却又拖到睡前，这版更贴近真实宿舍生活。",
                        "body": [
                            "先别追求满分计划，先把晚上最容易卡住的一个动作拆出来。",
                            "把洗漱、收纳、第二天准备前置，降低拖延启动门槛。",
                        ],
                        "ending": f"这版已结合最新要求：{instruction[:24]}",
                        "tags": ["大学新生", "晚上拖延", "低成本自律"],
                        "cardPreview": {"keywords": ["晚上拖延", "大学新生", "低成本自律"]},
                    },
                    "suggestions": [
                        {
                            "label": "标题更像搜索词",
                            "instruction": "把标题再改得更像用户会主动搜索的问题。",
                            "intent": "title_optimize",
                        }
                    ],
                }
            elif task_type == "memory.summarize_conversation":
                previous_summary = request.input.get("previousSummary") or {}
                messages = request.input.get("messagesToSummarize") or []
                user_messages = [
                    item.get("content", "").strip()
                    for item in messages
                    if isinstance(item, dict) and item.get("role") == "user"
                ]
                assistant_messages = [
                    item.get("content", "").strip()
                    for item in messages
                    if isinstance(item, dict) and item.get("role") == "assistant"
                ]
                data = {
                    "conversationSummary": {
                        "version": "v1",
                        "scene": request.input.get("scene") or "unknown",
                        "coveredMessageCount": request.input.get("targetCoveredMessageCount") or len(messages),
                        "userGoal": user_messages[0] if user_messages else previous_summary.get("userGoal", ""),
                        "confirmedFacts": (previous_summary.get("confirmedFacts") or []) + user_messages[:2],
                        "assistantFindings": assistant_messages[-2:],
                        "userFeedback": user_messages[-3:],
                        "decisions": previous_summary.get("decisions") or [],
                        "openQuestions": previous_summary.get("openQuestions") or [],
                        "latestFocus": user_messages[-1] if user_messages else previous_summary.get("latestFocus", ""),
                        "artifactNotes": previous_summary.get("artifactNotes") or [],
                    }
                }
            else:
                data = {"reply": "unsupported task"}

            elapsed_ms = int((time.perf_counter() - start) * 1000)
            return AgentRunResponse(
                requestId=request.requestId,
                taskType=request.taskType,
                platform=request.platform,
                status="success",
                data=data,
                savePayload={},
                warnings=[],
                metadata={"runtimeMode": "benchmark", "durationMs": elapsed_ms},
            )

        return patch("backend.app.adapters.agent.client.AgentClient.run", new=fake_run)

    @contextlib.contextmanager
    def _instrument_service(self, service: Any, builder_method_name: str):
        timings: Dict[str, float] = {
            "context_build_ms": 0.0,
            "agent_call_ms": 0.0,
            "memory_refresh_ms": 0.0,
        }
        captured: Dict[str, Any] = {"context": None}

        builder = getattr(service.builder, builder_method_name)
        client_run = service.client.run
        refresh_state = service.memory_service.refresh_state

        async def wrapped_builder(*args, **kwargs):
            start = time.perf_counter()
            result = await builder(*args, **kwargs)
            timings["context_build_ms"] += (time.perf_counter() - start) * 1000
            captured["context"] = result
            return result

        async def wrapped_client_run(*args, **kwargs):
            start = time.perf_counter()
            result = await client_run(*args, **kwargs)
            timings["agent_call_ms"] += (time.perf_counter() - start) * 1000
            return result

        async def wrapped_refresh_state(*args, **kwargs):
            start = time.perf_counter()
            result = await refresh_state(*args, **kwargs)
            timings["memory_refresh_ms"] += (time.perf_counter() - start) * 1000
            return result

        setattr(service.builder, builder_method_name, wrapped_builder)
        service.client.run = wrapped_client_run
        service.memory_service.refresh_state = wrapped_refresh_state
        try:
            yield timings, captured
        finally:
            setattr(service.builder, builder_method_name, builder)
            service.client.run = client_run
            service.memory_service.refresh_state = refresh_state

    async def run_trend(self, name: str, messages: List[str]) -> Dict[str, Any]:
        with self._patch_db(), self._patch_crud_modules(), self._patch_crud_globals(), self._patch_agent():
            service = TrendService()
            scope_id = f"scope-{name}"
            history: list[dict[str, Any]] = []
            metrics: list[TurnMetric] = []

            for index, user_message in enumerate(messages, start=1):
                history.append({"role": "user", "content": user_message})
                total_start = time.perf_counter()
                with self._instrument_service(service, "build_trend_track_context") as (timings, captured):
                    result = await service.track(
                        USER_ID,
                        user_message,
                        conversation_history=history,
                        conversation_scope_id=scope_id,
                    )
                total_ms = (time.perf_counter() - total_start) * 1000

                response_data = result["data"]
                assistant_text = response_data.get("text") or ""
                analysis = response_data.get("completeAnalysis")
                history.append(
                    {
                        "role": "assistant",
                        "content": assistant_text,
                        "analysis": analysis,
                    }
                )
                context = captured["context"] or {}
                agent_call_ms = timings["agent_call_ms"]
                memory_refresh_ms = timings["memory_refresh_ms"]
                memory_meta = response_data.get("memoryMeta") or {}
                context_payload = {
                    "conversationSummary": context.get("conversationSummary"),
                    "recentMessages": context.get("recentMessages"),
                    "savedPersona": context.get("savedPersona"),
                    "currentArtifact": context.get("currentArtifact"),
                }
                metrics.append(
                    TurnMetric(
                        turn_index=index,
                        user_message=user_message,
                        context_build_ms=round(timings["context_build_ms"], 2),
                        agent_call_ms=round(agent_call_ms, 2),
                        memory_refresh_ms=round(memory_refresh_ms, 2),
                        total_ms=round(total_ms, 2),
                        recent_message_count=len(context.get("recentMessages") or []),
                        summary_covered_count=int(memory_meta.get("coveredMessageCount") or 0),
                        summary_status=str(memory_meta.get("summaryStatus") or ""),
                        agent_input_message_count=len(context.get("recentMessages") or []),
                        agent_input_estimated_tokens=estimate_tokens(context_payload),
                    )
                )

            return {
                "scenario": name,
                "scene": "trend",
                "metrics": [item.__dict__ for item in metrics],
                "summary": summarize_metrics(metrics),
            }

    async def run_content(self) -> Dict[str, Any]:
        with self._patch_db(), self._patch_crud_modules(), self._patch_crud_globals(), self._patch_agent():
            service = ContentService()
            scope_id = "scope-content"
            history: list[dict[str, Any]] = []
            current_draft: dict[str, Any] | None = None
            metrics: list[TurnMetric] = []

            for index, user_message in enumerate(CONTENT_SCRIPT, start=1):
                history.append({"role": "user", "content": user_message})
                total_start = time.perf_counter()
                with self._instrument_service(service, "build_content_draft_context") as (timings, captured):
                    result = await service.draft(
                        USER_ID,
                        topic="大学新生低成本自律",
                        instruction=user_message,
                        conversation_history=history,
                        current_draft=current_draft,
                        revision_instruction=user_message if current_draft else None,
                        conversation_scope_id=scope_id,
                    )
                total_ms = (time.perf_counter() - total_start) * 1000

                response_data = result["data"]
                assistant_text = response_data.get("text") or ""
                current_draft = response_data.get("completeDraft") or current_draft
                history.append(
                    {
                        "role": "assistant",
                        "content": assistant_text,
                        "draft": current_draft,
                    }
                )
                context = captured["context"] or {}
                agent_call_ms = timings["agent_call_ms"]
                memory_refresh_ms = timings["memory_refresh_ms"]
                memory_meta = response_data.get("memoryMeta") or {}
                context_payload = {
                    "conversationSummary": context.get("conversationSummary"),
                    "recentMessages": context.get("recentMessages"),
                    "savedPersona": context.get("savedPersona"),
                    "currentArtifact": context.get("currentArtifact"),
                }
                metrics.append(
                    TurnMetric(
                        turn_index=index,
                        user_message=user_message,
                        context_build_ms=round(timings["context_build_ms"], 2),
                        agent_call_ms=round(agent_call_ms, 2),
                        memory_refresh_ms=round(memory_refresh_ms, 2),
                        total_ms=round(total_ms, 2),
                        recent_message_count=len(context.get("recentMessages") or []),
                        summary_covered_count=int(memory_meta.get("coveredMessageCount") or 0),
                        summary_status=str(memory_meta.get("summaryStatus") or ""),
                        agent_input_message_count=len(context.get("recentMessages") or []),
                        agent_input_estimated_tokens=estimate_tokens(context_payload),
                    )
                )

            return {
                "scenario": "content-revise",
                "scene": "content",
                "metrics": [item.__dict__ for item in metrics],
                "summary": summarize_metrics(metrics),
            }

    async def run_all(self) -> Dict[str, Any]:
        trend13 = await self.run_trend("trend-13", TREND_SCRIPT_13)
        trend24 = await self.run_trend("trend-24", TREND_SCRIPT_24)
        content = await self.run_content()
        return {
            "generatedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "notes": [
                "这是服务层 benchmark，剥离了 Docker、HTTP 网络抖动、真实模型和真实 Mongo 延迟。",
                "适合对比 rolling memory 自身的阶段成本，以及后续 RAG 的 context build / retrieval / rerank / synthesis 成本。",
                "当前未覆盖保存后重开、summary failure 注入、80 条上限阻断，这些更适合单独做行为验证。",
            ],
            "results": [trend13, trend24, content],
        }


async def main(output_path: Optional[str]) -> int:
    harness = BenchmarkHarness()
    result = await harness.run_all()
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if output_path:
        Path(output_path).write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rolling Memory benchmark for staged cost measurement.")
    parser.add_argument("--output", help="Optional output file path.")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(main(args.output)))
