export function createConversationScopeId(prefix: string) {
  const normalizedPrefix = prefix.trim() || 'conversation';
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${normalizedPrefix}-${timestamp}-${randomPart}`;
}
