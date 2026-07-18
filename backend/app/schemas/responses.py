from pydantic import BaseModel
from typing import Any, List, Optional


class StandardResponse(BaseModel):
    code: int = 200
    data: Optional[Any] = None
    message: Optional[str] = None
    msg: Optional[str] = None
    warnings: Optional[List[Any]] = None
    debug: Optional[Any] = None
