from __future__ import annotations

import json
from pathlib import Path

from app.schemas.tools import RetrievalItem, RetrievalToolRequest, RetrievalToolResult
from app.tools.retrieval import unavailable_result


class MockRetrievalTool:
    name = "mock_retrieval"

    def __init__(self, project_root: Path | None = None) -> None:
        self.project_root = project_root or Path(__file__).resolve().parents[2]

    def search(self, request: RetrievalToolRequest) -> RetrievalToolResult:
        path = self._resolve_mock_result_path()
        if not path.exists():
            return unavailable_result(
                request,
                message="Mock retrieval result file is missing.",
            )

        payload = json.loads(path.read_text(encoding="utf-8"))
        raw_items = payload.get("items", [])
        items = [
            RetrievalItem(
                title=item.get("title") or "Untitled",
                url=item.get("url"),
                summary=item.get("summary") or "",
                platform=item.get("platform") or request.platform,
                contentType=item.get("contentType") or request.filters.get("contentType"),
                publishedAt=item.get("publishedAt"),
                metrics=item.get("metrics") or {},
                metadata=item.get("metadata") or {"mock": True},
            )
            for item in raw_items[: request.limit]
        ]
        return RetrievalToolResult(
            source="mock_retrieval",
            status="success" if items else "empty",
            items=items,
        )

    def _resolve_mock_result_path(self) -> Path:
        relative = Path("examples") / "tool-results" / "retrieval.xhs_trends.success.json"
        candidates = [
            self.project_root / relative,
            self.project_root.parent / relative,
        ]
        for path in candidates:
            if path.exists():
                return path
        return candidates[0]
