export const AGENT_CHAT_ENDPOINT = '/api/agent/chat';

export type AgentStep = 'persona' | 'trending' | 'content' | 'image_guidance' | 'done';
export type AgentMessageRole = 'user' | 'assistant';
export type AgentChatActionType = 'message' | 'quick_reply' | 'approve_step' | 'choose_topic' | 'revise_content' | 'regenerate' | 'save';
export type AgentConversationCreateStatus = 'questions_pending' | 'questions_failed' | 'creating' | 'ready' | string;

export interface AgentChatAction {
  id: string;
  label: string;
  action_type: AgentChatActionType;
  action_payload?: Record<string, unknown>;
  type?: AgentChatActionType;
  payload?: Record<string, unknown>;
  message?: string;
  disabled?: boolean;
}

export interface AgentQuestionBlock {
  id: string;
  question: string;
  examples: string[];
  action_payload?: Record<string, unknown>;
  action_type?: AgentChatActionType;
  prefill_text?: string;
}

export interface AgentChatRequest {
  conversation_id?: string;
  message: string;
  current_step?: AgentStep;
  selected_persona_id?: string | null;
  selected_topic_id?: string | null;
  action_type?: AgentChatActionType;
  action_payload?: Record<string, unknown>;
}

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  created_at: string;
  step?: AgentStep;
  question_blocks?: AgentQuestionBlock[];
  copy_payload?: {
    copy_text?: string;
    publish_text?: string;
    draft?: Record<string, unknown>;
  };
}

export interface AgentFlowSummaryItem {
  done: boolean;
  title: string;
  text: string;
  message_id: string | null;
  memory_id: string | null;
  items?: AgentContentDraftPoint[];
}

export interface AgentFlowSummary {
  persona: AgentFlowSummaryItem;
  trending: AgentFlowSummaryItem;
  content: AgentFlowSummaryItem;
}

export interface AgentMemoryRefs {
  conversation_memory_id: string;
  persona_memory_id: string | null;
  trending_memory_id: string | null;
  content_memory_id: string | null;
}

export interface AgentChatResponse {
  conversation_id: string;
  conversation_title?: string;
  assistant_message?: AgentMessage | null;
  current_step: AgentStep;
  next_step: AgentStep | null;
  summary: AgentFlowSummary;
  memory_refs: AgentMemoryRefs;
  conversation_kind?: 'draft' | 'task' | string;
  create_status?: AgentConversationCreateStatus;
  source_persona_record_id?: string | null;
  parent_conversation_id?: string | null;
  saved_persona_record_id?: string;
  actions?: AgentChatAction[];
  question_blocks?: AgentQuestionBlock[];
  readiness?: Partial<Record<AgentStep, string>>;
  copy_payload?: {
    copy_text?: string;
    publish_text?: string;
    draft?: Record<string, unknown>;
  };
}

export type AgentPhaseApproval = {
  persona: boolean;
  trending: boolean;
  content: boolean;
};

export interface AgentContentDraftPoint {
  id: string;
  memory_id?: string;
  title: string;
  message_id: string;
  active?: boolean;
  created_at?: string;
}

export interface AgentLocalConversation {
  local_id: string;
  conversation_id?: string;
  title: string;
  messages: AgentMessage[];
  summary: AgentFlowSummary;
  current_step: AgentStep;
  conversation_kind?: 'draft' | 'task' | string;
  create_status?: AgentConversationCreateStatus;
  source_persona_record_id?: string | null;
  parent_conversation_id?: string | null;
  selected_persona_id: string | null;
  selected_topic_id: string | null;
  phase_approval: AgentPhaseApproval;
  content_points: AgentContentDraftPoint[];
  actions: AgentChatAction[];
  question_blocks: AgentQuestionBlock[];
  readiness: Partial<Record<AgentStep, string>>;
  copy_payload: {
    copy_text?: string;
    publish_text?: string;
    draft?: Record<string, unknown>;
  };
  updated_at: string;
}
