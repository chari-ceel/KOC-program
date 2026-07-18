from pydantic import BaseModel, Field


class TavilyDebugRequest(BaseModel):
    api_key: str = Field(alias="apiKey")
    query: str = "小红书 大学生成长 热门选题"

    model_config = {"populate_by_name": True}


class TavilySearchRequest(BaseModel):
    api_key: str = Field(alias="apiKey")
    query: str
    max_results: int = Field(default=5, alias="maxResults")
    include_answer: bool = Field(default=True, alias="includeAnswer")

    model_config = {"populate_by_name": True}


class GeminiPromptLabRequest(BaseModel):
    api_key: str = Field(alias="apiKey")
    base_url: str = Field(default="https://generativelanguage.googleapis.com/v1beta", alias="baseUrl")
    model: str = "gemini-2.5-flash"
    system_prompt: str = Field(alias="systemPrompt")
    user_prompt: str = Field(alias="userPrompt")
    temperature: float = 0.4
    response_format: str = Field(default="text", alias="responseFormat")
    enable_google_search: bool = Field(default=False, alias="enableGoogleSearch")
    require_google_search: bool = Field(default=False, alias="requireGoogleSearch")

    model_config = {"populate_by_name": True}


class ModelPromptLabRequest(BaseModel):
    provider: str
    api_key: str = Field(alias="apiKey")
    base_url: str = Field(alias="baseUrl")
    model: str
    system_prompt: str = Field(alias="systemPrompt")
    user_prompt: str = Field(alias="userPrompt")
    temperature: float = 0.4
    response_format: str = Field(default="text", alias="responseFormat")
    enable_google_search: bool = Field(default=False, alias="enableGoogleSearch")
    require_google_search: bool = Field(default=False, alias="requireGoogleSearch")

    model_config = {"populate_by_name": True}
