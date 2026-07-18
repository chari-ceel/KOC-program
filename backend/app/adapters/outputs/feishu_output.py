from typing import Any, Dict
from .base import OutputChannel


class FeishuChannel(OutputChannel):
    def __init__(self, app_id: str = None, app_secret: str = None, webhook_url: str = None):
        self.app_id = app_id
        self.app_secret = app_secret
        self.webhook_url = webhook_url

    async def send(self, data: Dict[str, Any], user_id: str, **kwargs) -> bool:
        # 这是一个占位实现，预留飞书输出通道接口
        print(f"[FeishuChannel] pretend send for user={user_id}, data={data}")
        return True
