from app.schemas.tools import RetrievalToolRequest
from app.tools.mock_retrieval import MockRetrievalTool


def test_mock_retrieval_loads_items() -> None:
    tool = MockRetrievalTool()
    result = tool.search(
        RetrievalToolRequest(
            source="mock_retrieval",
            query="小红书 大学生成长 热门选题",
            limit=3,
        )
    )

    assert result.status == "success"
    assert result.source == "mock_retrieval"
    assert len(result.items) > 0
