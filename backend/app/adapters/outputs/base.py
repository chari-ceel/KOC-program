from abc import ABC, abstractmethod
from typing import Any, Dict, List


class OutputChannel(ABC):
    @abstractmethod
    async def send(self, data: Dict[str, Any], user_id: str, **kwargs) -> bool:
        pass


class OutputChannelManager:
    def __init__(self):
        self.channels: Dict[str, OutputChannel] = {}

    def register_channel(self, name: str, channel: OutputChannel):
        self.channels[name] = channel

    async def send_to_channels(self, channels: List[str], data: Dict[str, Any], user_id: str, **kwargs) -> Dict[str, bool]:
        results: Dict[str, bool] = {}
        for channel_name in channels:
            channel = self.channels.get(channel_name)
            if channel:
                results[channel_name] = await channel.send(data, user_id, **kwargs)
            else:
                results[channel_name] = False
        return results
