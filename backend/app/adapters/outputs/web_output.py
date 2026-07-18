from typing import Any, Dict
from .base import OutputChannel


class FrontendChannel(OutputChannel):
    async def send(self, data: Dict[str, Any], user_id: str, **kwargs) -> bool:
        return True
