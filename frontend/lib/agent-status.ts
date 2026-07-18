export type AgentStatusKind = 'running' | 'stopped' | 'error';

export interface AgentStatusState {
  kind: AgentStatusKind;
  message: string;
}

export function isAgentStatusState(value: unknown): value is AgentStatusState {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'kind' in value &&
      'message' in value &&
      (value as { kind?: unknown }).kind &&
      ((value as { kind?: unknown }).kind === 'running' ||
        (value as { kind?: unknown }).kind === 'stopped' ||
        (value as { kind?: unknown }).kind === 'error') &&
      typeof (value as { message?: unknown }).message === 'string',
  );
}

export function readStoredAgentStatus(value: unknown): AgentStatusState | null {
  return isAgentStatusState(value) ? value : null;
}

export function readLegacyAgentStatus(content: string | null | undefined): AgentStatusState | null {
  const normalized = content?.trim();
  if (!normalized) return null;
  if (normalized === '本次输出已停止。') {
    return { kind: 'stopped', message: normalized };
  }
  if (
    normalized.startsWith('出错了：') ||
    normalized.startsWith('网络出错：') ||
    normalized.startsWith('Failed to fetch')
  ) {
    return { kind: 'error', message: normalized };
  }
  return null;
}

export function isLegacyAgentStatusContent(content: string | null | undefined) {
  return Boolean(readLegacyAgentStatus(content));
}

export function splitTrailingLegacyAgentStatus<T extends { role: 'user' | 'assistant'; content: string }>(messages: T[]) {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'assistant') {
    return { messages, agentStatus: null as AgentStatusState | null };
  }
  const agentStatus = readLegacyAgentStatus(lastMessage.content);
  if (!agentStatus) {
    return { messages, agentStatus: null as AgentStatusState | null };
  }
  return {
    messages: messages.slice(0, -1),
    agentStatus,
  };
}

export function splitTrailingLegacyAgentStatusText(messages: string[]) {
  const lastMessage = messages[messages.length - 1];
  const agentStatus = readLegacyAgentStatus(lastMessage);
  if (!agentStatus) {
    return { messages, agentStatus: null as AgentStatusState | null };
  }
  return {
    messages: messages.slice(0, -1),
    agentStatus,
  };
}
