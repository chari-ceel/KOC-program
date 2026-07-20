from functools import lru_cache
from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    service_name: str = "koc-agent"
    version: str = "0.1.0"
    agent_port: int = Field(default=8010, alias="AGENT_PORT")
    enable_web_search: bool = Field(default=True, alias="ENABLE_WEB_SEARCH")
    web_search_provider: str = Field(default="", alias="WEB_SEARCH_PROVIDER")
    web_search_api_key: str = Field(default="", alias="WEB_SEARCH_API_KEY")
    web_search_timeout_ms: int = Field(default=8000, alias="WEB_SEARCH_TIMEOUT_MS")
    model_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("MODEL_API_KEY", "GOOGLE_API_KEY"),
    )
    model_base_url: str = Field(
        default="https://api.openai-proxy.org/google/v1beta",
        validation_alias=AliasChoices("MODEL_BASE_URL", "GOOGLE_BASE_URL"),
    )
    model_name: str = Field(
        default="gemini-2.5-flash",
        validation_alias=AliasChoices("MODEL_NAME", "GOOGLE_MODEL"),
    )
    model_request_timeout_seconds: int = Field(default=90, alias="MODEL_REQUEST_TIMEOUT_SECONDS")
    model_request_max_attempts: int = Field(default=2, alias="MODEL_REQUEST_MAX_ATTEMPTS")
    model_role_main: str = Field(default="", alias="MODEL_ROLE_MAIN")
    model_role_search: str = Field(default="", alias="MODEL_ROLE_SEARCH")
    model_role_trend: str = Field(default="", alias="MODEL_ROLE_TREND")
    model_role_content: str = Field(default="", alias="MODEL_ROLE_CONTENT")
    model_role_persona: str = Field(default="", alias="MODEL_ROLE_PERSONA")
    model_role_lightweight: str = Field(default="", alias="MODEL_ROLE_LIGHTWEIGHT")
    agent_runtime_mode: str = Field(default="model", alias="AGENT_RUNTIME_MODE")
    enable_debug_auth: bool = Field(default=True, alias="ENABLE_DEBUG_AUTH")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
        protected_namespaces=("settings_",),
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
