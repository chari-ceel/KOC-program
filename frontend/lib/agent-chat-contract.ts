export const AGENT_CHAT_ENDPOINT = '/api/agent/chat';

export type AgentStep = 'persona' | 'trending' | 'content' | 'image_guidance' | 'done';
export type AgentMessageRole = 'user' | 'assistant';

export interface AgentChatRequest {
  conversation_id?: string;
  message: string;
  current_step?: AgentStep;
  selected_persona_id?: string | null;
  selected_topic_id?: string | null;
}

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  created_at: string;
}

export interface AgentFlowSummaryItem {
  done: boolean;
  title: string;
  text: string;
  message_id: string | null;
  memory_id: string | null;
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
  assistant_message: AgentMessage;
  current_step: AgentStep;
  next_step: AgentStep | null;
  summary: AgentFlowSummary;
  memory_refs: AgentMemoryRefs;
}

export type AgentPhaseApproval = {
  persona: boolean;
  trending: boolean;
  content: boolean;
};

export interface AgentContentDraftPoint {
  id: string;
  title: string;
  message_id: string;
}

export interface AgentLocalConversation {
  local_id: string;
  conversation_id?: string;
  title: string;
  messages: AgentMessage[];
  summary: AgentFlowSummary;
  current_step: AgentStep;
  selected_persona_id: string | null;
  selected_topic_id: string | null;
  phase_approval: AgentPhaseApproval;
  content_points: AgentContentDraftPoint[];
  updated_at: string;
}
