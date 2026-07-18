import { API_BASE } from '@/lib/api';

export type AnalyticsModule = 'dialog' | 'profile' | 'trending' | 'content';
export type ConversationTaskType =
  | 'general.chat'
  | 'persona.analyze'
  | 'persona.follow_up'
  | 'trend.track'
  | 'content.draft';

export interface AgentOutputCopyEvent {
  eventName: 'agent_output_copy';
  module: AnalyticsModule;
  conversationId?: string;
  messageId?: string;
  messageIndex?: number;
  messageRole?: 'assistant' | 'user';
  contentLength?: number;
  contentHash?: string;
  copySource?: string;
}

export interface ConversationTurnEvent {
  eventName: 'conversation_turn_started' | 'conversation_turn_completed' | 'conversation_turn_failed';
  module: AnalyticsModule;
  conversationId: string;
  requestId: string;
  taskType: ConversationTaskType;
  turnIndex: number;
  userMessageLength?: number;
  assistantMessageLength?: number;
  historyMessageCount?: number;
  status?: string;
  latencyMs?: number;
  failureReason?: string;
}

export type AnalyticsEvent = AgentOutputCopyEvent | ConversationTurnEvent;

export function createClientEventId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getOrCreateConversationId(storageKey: string) {
  if (typeof window === 'undefined') return createClientEventId('conversation');
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const next = createClientEventId('conversation');
  window.sessionStorage.setItem(storageKey, next);
  return next;
}

export function clearConversationId(storageKey: string) {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(storageKey);
}

export async function trackAnalyticsEvent(event: AnalyticsEvent) {
  try {
    await fetch(`${API_BASE}/api/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(event),
    });
  } catch (error) {
    console.warn('analytics event failed', event.eventName, error);
  }
}
