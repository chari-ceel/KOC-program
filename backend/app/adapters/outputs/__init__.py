from .base import OutputChannelManager
from .web_output import FrontendChannel
from .feishu_output import FeishuChannel

output_manager = OutputChannelManager()
output_manager.register_channel("frontend", FrontendChannel())

__all__ = ["output_manager", "FrontendChannel", "FeishuChannel"]
