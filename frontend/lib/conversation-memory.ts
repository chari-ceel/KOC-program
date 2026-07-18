export const CHAT_INPUT_MAX_CHARS = 500;
export const CONVERSATION_VISIBLE_MESSAGE_LIMIT = 80;
export const CONVERSATION_HARD_STOP_THRESHOLD = 79;
export const CONVERSATION_CONTEXT_MESSAGE_LIMIT = 12;
export const CONVERSATION_LIMIT_NOTICE =
  '当前对话已达到 80 条消息上限，请先保存或开启新对话后继续。';

export interface ConversationMemoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompressedConversationMemory {
  summary: string;
  sourceMessageCount: number;
}

export function countTextChars(value: string) {
  return Array.from(value).length;
}

export function limitTextChars(value: string, maxChars: number) {
  return Array.from(value).slice(0, maxChars).join('');
}

export function trimVisibleConversation<T extends ConversationMemoryMessage>(messages: T[]) {
  return messages.slice(-CONVERSATION_VISIBLE_MESSAGE_LIMIT);
}

export function hasReachedConversationHardStop<T extends ConversationMemoryMessage>(messages: T[]) {
  return messages.length >= CONVERSATION_HARD_STOP_THRESHOLD;
}

export function selectRecentConversationContext<T extends ConversationMemoryMessage>(messages: T[]) {
  return messages.slice(-CONVERSATION_CONTEXT_MESSAGE_LIMIT);
}

export function compressConversationMemory<T extends ConversationMemoryMessage>(
  messages: T[],
): CompressedConversationMemory | null {
  const olderMessages = messages.slice(0, -CONVERSATION_CONTEXT_MESSAGE_LIMIT);
  if (olderMessages.length === 0) return null;

  return {
    summary: '',
    sourceMessageCount: olderMessages.length,
  };
}

export function buildConversationPayload<T extends ConversationMemoryMessage>(messages: T[]) {
  return {
    recentMessages: selectRecentConversationContext(messages),
    compressedMemory: compressConversationMemory(messages),
  };
}
