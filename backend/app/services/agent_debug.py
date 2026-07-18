from __future__ import annotations

from typing import Any

from ..schemas.agent.protocol import AgentRunResponse


def build_agent_option_overrides(agent_debug: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(agent_debug, dict):
        return {}

    overrides: dict[str, Any] = {}
    for key in (
        "enableTools",
        "requireRealWebResearch",
        "maxToolCalls",
        "contentType",
        "language",
    ):
        if key in agent_debug:
            overrides[key] = agent_debug.get(key)

    debug_auth = agent_debug.get("debugAuth")
    if isinstance(debug_auth, dict) and debug_auth:
        overrides["debugAuth"] = debug_auth

    return overrides


def build_agent_debug_payload(
    response: AgentRunResponse,
    agent_debug: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not isinstance(agent_debug, dict) or not agent_debug.get("exposeAgentDetails"):
        return None

    requested_options = build_agent_option_overrides(agent_debug)
    debug_auth = requested_options.pop("debugAuth", None)
    if isinstance(debug_auth, dict):
        provider = str(debug_auth.get("webSearchProvider") or "").strip()
        if provider:
            requested_options["webSearchProvider"] = provider

    return {
        "agentStatus": response.status,
        "requestedOptions": requested_options,
        "sources": response.sources or [],
        "toolCalls": response.toolCalls or [],
        "metadata": response.metadata or {},
        "error": response.error or {},
    }
