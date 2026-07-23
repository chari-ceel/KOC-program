import type { AgentChatAction, AgentFlowSummary, AgentLocalConversation, AgentMessage, AgentQuestionBlock } from '@/lib/agent-chat-contract';

export const AGENT_CHAT_CONVERSATIONS_STORAGE_KEY = 'koc-agent-local-conversations';
export const AGENT_CHAT_ACTIVE_CONVERSATION_STORAGE_KEY = 'koc-agent-active-conversation-id';
const AGENT_CHAT_ACCOUNT_SCOPE_STORAGE_KEY = 'koc-agent-account-scope';
const DEFAULT_ACCOUNT_SCOPE = 'anonymous';
export const AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT = 'koc-agent-conversations-updated';
export const AGENT_CHAT_CREATE_CONVERSATION_EVENT = 'koc-agent-create-conversation';
export const AGENT_CHAT_SELECT_CONVERSATION_EVENT = 'koc-agent-select-conversation';
export const SIDEBAR_COLLAPSE_EVENT = 'koc-sidebar-collapse-request';
const WELCOME_MESSAGE_CONTENT =
  'Hi，我是你的顶流小猪梨呀~ 我们先把你这个账号的人设聊清楚，再去做热门追踪，最后写成小红书图文笔记。\n\n先不用想得很专业，从下面 3 个问题里挑一个回答就行。';

const INITIAL_PERSONA_QUESTIONS: AgentQuestionBlock[] = [];

const INITIAL_PERSONA_ACTIONS: AgentChatAction[] = [];

export const defaultAgentSummary: AgentFlowSummary = {
  persona: {
    done: false,
    title: '人设打造',
    text: '',
    message_id: null,
    memory_id: null,
  },
  trending: {
    done: false,
    title: '热门追踪',
    text: '',
    message_id: null,
    memory_id: null,
  },
  content: {
    done: false,
    title: '内容撰写',
    text: '',
    message_id: null,
    memory_id: null,
  },
};

export function createWelcomeMessage(): AgentMessage {
  return {
    id: 'assistant_welcome',
    role: 'assistant',
    content: WELCOME_MESSAGE_CONTENT,
    question_blocks: INITIAL_PERSONA_QUESTIONS,
    created_at: new Date().toISOString(),
  };
}

function normalizeWelcomeMessages(messages: AgentMessage[]) {
  return messages.map((message) =>
    message.id === 'assistant_welcome'
      ? {
          ...message,
          content: WELCOME_MESSAGE_CONTENT,
          question_blocks: Array.isArray(message.question_blocks) && message.question_blocks.length ? message.question_blocks : INITIAL_PERSONA_QUESTIONS,
        }
      : message,
  );
}

function createLocalId() {
  return `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emitConversationsUpdated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT));
}

function normalizeScope(value?: string | null) {
  const normalized = (value || '').trim();
  return normalized || DEFAULT_ACCOUNT_SCOPE;
}

function scopedStorageKey(baseKey: string, scope = readAgentChatAccountScope()) {
  return `${baseKey}:${scope}`;
}

export function readAgentChatAccountScope() {
  if (typeof window === 'undefined') return DEFAULT_ACCOUNT_SCOPE;
  return normalizeScope(window.localStorage.getItem(AGENT_CHAT_ACCOUNT_SCOPE_STORAGE_KEY));
}

export function setAgentChatAccountScope(accountId?: string | null) {
  if (typeof window === 'undefined') return;
  const nextScope = normalizeScope(accountId);
  const previousScope = readAgentChatAccountScope();
  window.localStorage.setItem(AGENT_CHAT_ACCOUNT_SCOPE_STORAGE_KEY, nextScope);
  if (previousScope !== nextScope) {
    emitConversationsUpdated();
  }
}

export function clearAgentChatScopeData(accountId?: string | null) {
  if (typeof window === 'undefined') return;
  const scope = normalizeScope(accountId);
  window.localStorage.removeItem(scopedStorageKey(AGENT_CHAT_CONVERSATIONS_STORAGE_KEY, scope));
  window.localStorage.removeItem(scopedStorageKey(AGENT_CHAT_ACTIVE_CONVERSATION_STORAGE_KEY, scope));
  if (scope === DEFAULT_ACCOUNT_SCOPE) {
    window.localStorage.removeItem(AGENT_CHAT_CONVERSATIONS_STORAGE_KEY);
    window.localStorage.removeItem(AGENT_CHAT_ACTIVE_CONVERSATION_STORAGE_KEY);
  }
  emitConversationsUpdated();
}

export function createEmptyConversation(index = 1): AgentLocalConversation {
  return {
    local_id: createLocalId(),
    title: `临时对话 ${index}`,
    messages: [createWelcomeMessage()],
    summary: defaultAgentSummary,
    current_step: 'persona',
    conversation_kind: 'draft',
    create_status: 'ready',
    source_persona_record_id: null,
    parent_conversation_id: null,
    selected_persona_id: null,
    selected_topic_id: null,
    phase_approval: {
      persona: false,
      trending: false,
      content: false,
    },
    content_points: [],
    actions: INITIAL_PERSONA_ACTIONS,
    question_blocks: INITIAL_PERSONA_QUESTIONS,
    readiness: {},
    copy_payload: {},
    updated_at: new Date().toISOString(),
  };
}

export function readLocalConversations(): AgentLocalConversation[] {
  if (typeof window === 'undefined') return [];
  try {
    const scopedKey = scopedStorageKey(AGENT_CHAT_CONVERSATIONS_STORAGE_KEY);
    const legacyRaw =
      readAgentChatAccountScope() === DEFAULT_ACCOUNT_SCOPE
        ? window.localStorage.getItem(AGENT_CHAT_CONVERSATIONS_STORAGE_KEY)
        : null;
    const raw = window.localStorage.getItem(scopedKey) || legacyRaw;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentLocalConversation[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((conversation) => conversation?.local_id && Array.isArray(conversation.messages))
      .map((conversation, index) => ({
        ...createEmptyConversation(index + 1),
        ...conversation,
        title: conversation.title || `临时对话 ${index + 1}`,
        messages: conversation.messages.length ? normalizeWelcomeMessages(conversation.messages) : [createWelcomeMessage()],
        summary: {
          ...defaultAgentSummary,
          ...(conversation.summary || {}),
        },
        conversation_kind: conversation.conversation_kind || 'draft',
        create_status: conversation.create_status || 'ready',
        source_persona_record_id: conversation.source_persona_record_id || null,
        parent_conversation_id: conversation.parent_conversation_id || null,
        phase_approval: {
          persona: Boolean(conversation.phase_approval?.persona),
          trending: Boolean(conversation.phase_approval?.trending),
          content: Boolean(conversation.phase_approval?.content),
        },
        content_points: Array.isArray(conversation.content_points) ? conversation.content_points : [],
        actions: Array.isArray(conversation.actions) && conversation.actions.length ? conversation.actions : INITIAL_PERSONA_ACTIONS,
        question_blocks: Array.isArray(conversation.question_blocks) ? conversation.question_blocks : [],
        readiness: conversation.readiness || {},
        copy_payload: conversation.copy_payload || {},
      }));
  } catch {
    return [];
  }
}

export function writeLocalConversations(conversations: AgentLocalConversation[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(scopedStorageKey(AGENT_CHAT_CONVERSATIONS_STORAGE_KEY), JSON.stringify(conversations));
  emitConversationsUpdated();
}

export function readActiveConversationId() {
  if (typeof window === 'undefined') return '';
  const scopedValue = window.localStorage.getItem(scopedStorageKey(AGENT_CHAT_ACTIVE_CONVERSATION_STORAGE_KEY));
  if (scopedValue) return scopedValue;
  return readAgentChatAccountScope() === DEFAULT_ACCOUNT_SCOPE
    ? window.localStorage.getItem(AGENT_CHAT_ACTIVE_CONVERSATION_STORAGE_KEY) || ''
    : '';
}

export function writeActiveConversationId(localId: string) {
  if (typeof window === 'undefined') return;
  const key = scopedStorageKey(AGENT_CHAT_ACTIVE_CONVERSATION_STORAGE_KEY);
  if (localId) {
    window.localStorage.setItem(key, localId);
  } else {
    window.localStorage.removeItem(key);
  }
  emitConversationsUpdated();
}

export function upsertLocalConversation(conversation: AgentLocalConversation) {
  const conversations = readLocalConversations();
  const index = conversations.findIndex((item) => item.local_id === conversation.local_id);
  const nextConversation = { ...conversation, updated_at: new Date().toISOString() };
  if (index >= 0) {
    conversations[index] = nextConversation;
  } else {
    conversations.unshift(nextConversation);
  }
  writeLocalConversations(conversations);
  writeActiveConversationId(nextConversation.local_id);
  return nextConversation;
}

export function hasCompletedPersona(conversation: AgentLocalConversation | null | undefined) {
  return Boolean(conversation?.summary?.persona?.done && conversation.summary.persona.text.trim());
}

export function canCreateNextConversation(conversations: AgentLocalConversation[], activeLocalId = '') {
  if (conversations.length === 0) return true;
  const activeConversation = conversations.find((conversation) => conversation.local_id === activeLocalId) || conversations[0];
  return hasCompletedPersona(activeConversation);
}

export function createAndStoreConversation() {
  const conversations = readLocalConversations();
  const conversation = createEmptyConversation(conversations.length + 1);
  writeLocalConversations([conversation, ...conversations]);
  writeActiveConversationId(conversation.local_id);
  return conversation;
}

export function deleteLocalConversation(localId: string) {
  const conversations = readLocalConversations();
  const nextConversations = conversations.filter((conversation) => conversation.local_id !== localId);
  const activeId = readActiveConversationId();
  writeLocalConversations(nextConversations);
  if (activeId === localId) {
    writeActiveConversationId(nextConversations[0]?.local_id || '');
  }
  return nextConversations;
}
