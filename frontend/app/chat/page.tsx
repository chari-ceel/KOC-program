'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { API_BASE } from '@/lib/api';
import {
  AGENT_CHAT_ENDPOINT,
  type AgentChatAction,
  type AgentChatActionType,
  type AgentConversationCreateStatus,
  type AgentChatResponse,
  type AgentContentDraftPoint,
  type AgentFlowSummary,
  type AgentFlowSummaryItem,
  type AgentLocalConversation,
  type AgentMessage,
  type AgentQuestionBlock,
  type AgentStep,
} from '@/lib/agent-chat-contract';
import {
  AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT,
  AGENT_CHAT_CREATE_CONVERSATION_EVENT,
  AGENT_CHAT_SELECT_CONVERSATION_EVENT,
  SIDEBAR_COLLAPSE_EVENT,
  createWelcomeMessage,
  defaultAgentSummary,
  readActiveConversationId,
  readLocalConversations,
  upsertLocalConversation,
  writeActiveConversationId,
} from '@/lib/agent-chat-store';
import LoginButton from '@/components/LoginButton';
import AgentStatusMessage from '@/components/AgentStatusMessage';
import ChatInputShell from '@/components/ChatInputShell';
import ChatMessageBubble from '@/components/ChatMessageBubble';
import MarkdownText from '@/components/MarkdownText';
import MessageActions from '@/components/MessageActions';
import ScrollToBottomButton from '@/components/ScrollToBottomButton';
import StopGenerationIcon from '@/components/StopGenerationIcon';
import { useAuth } from '@/context/AuthContext';
import { visibleQuestionBlocks } from '@/lib/agent-question-blocks';
import type { AgentStatusState } from '@/lib/agent-status';
import { ANONYMOUS_PERSONA_GENERATED_STORAGE_KEY } from '@/lib/persona';

type FlowSummaryKey = keyof AgentFlowSummary;

interface AgentConversationRecord {
  conversation_id: string;
  title?: string;
  conversation_title?: string;
  current_step?: AgentStep;
  summary?: AgentFlowSummary;
  memory_refs?: AgentChatResponse['memory_refs'];
  conversation_kind?: string;
  create_status?: AgentConversationCreateStatus;
  source_persona_record_id?: string | null;
  parent_conversation_id?: string | null;
  updated_at?: string;
}

interface AgentConversationDetail extends AgentConversationRecord {
  messages?: AgentMessage[];
  actions?: AgentChatAction[];
  question_blocks?: AgentQuestionBlock[];
  readiness?: Partial<Record<AgentStep, string>>;
  copy_payload?: AgentChatResponse['copy_payload'];
}

const stepOrder: Array<{ key: FlowSummaryKey; step: AgentStep; title: string; hint: string }> = [
  { key: 'persona', step: 'persona', title: '人设打造', hint: '先确定账号定位、目标人群和内容语气。' },
  { key: 'trending', step: 'trending', title: '热门追踪', hint: '记录本轮热门追踪标题。' },
  { key: 'content', step: 'content', title: '内容撰写', hint: '每次新内容会记录一条标题。' },
];
const EMPTY_MESSAGES: AgentMessage[] = [];
const PERSONA_QUESTION_POLL_INTERVAL_MS = 1500;
const PERSONA_QUESTION_POLL_LIMIT = 30;

interface StructuredContentDraft {
  noteTitle: string;
  titleOptions: string[];
  hook: string;
  body: string[];
  ending: string;
  tags: string[];
  coverSuggestion?: {
    mainText?: string;
    layout?: string;
    visualStyle?: string;
  };
  imageTextStructure: string[];
}

function createUserMessage(content: string): AgentMessage {
  return {
    id: `user_${Date.now()}`,
    role: 'user',
    content,
    created_at: new Date().toISOString(),
  };
}

function compactText(text: string, maxLength = 30) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  const firstSentence = normalized.split(/[。；;.!！?？]/)[0] || normalized;
  return firstSentence.length > maxLength ? `${firstSentence.slice(0, maxLength)}...` : firstSentence;
}

function buildConversationTitle(summary: AgentFlowSummary, fallback: string) {
  return compactText(summary.persona.text, 14) || fallback;
}

function hasUsedAnonymousPersonaTrial() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ANONYMOUS_PERSONA_GENERATED_STORAGE_KEY) === '1';
}

function markAnonymousPersonaTrialUsed() {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ANONYMOUS_PERSONA_GENERATED_STORAGE_KEY, '1');
}

function getNextPrompt(step: AgentStep) {
  if (step === 'persona') return '选一个问题补充，或直接说说你自己。';
  if (step === 'trending') return '先告诉我：你想追哪类热点？';
  if (step === 'content') return '先选一个标题，或者说你想改哪里。';
  return '可以继续微调内容。';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cleanMarkdownText(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/```+/g, '')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*#{1,6}\s+/, '')
        .replace(/^\s*>\s?/, '')
        .replace(/^\s*[-+•]\s+/, '')
        .replace(/^\s*\d{1,3}[.)、]\s+/, '')
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
    .trim();
}

function readStringList(value: unknown, limit = 8) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(cleanMarkdownText).filter(Boolean).slice(0, limit);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/\n+/).map(cleanMarkdownText).filter(Boolean).slice(0, limit);
  }
  return [];
}

function readCoverSuggestion(value: unknown) {
  if (!isRecord(value)) return undefined;
  const mainText = typeof value.mainText === 'string' ? cleanMarkdownText(value.mainText) : '';
  const layout = typeof value.layout === 'string' ? cleanMarkdownText(value.layout) : '';
  const visualStyle = typeof value.visualStyle === 'string' ? cleanMarkdownText(value.visualStyle) : '';
  return mainText || layout || visualStyle ? { mainText, layout, visualStyle } : undefined;
}

function normalizeContentDraft(payload?: Record<string, unknown>): StructuredContentDraft | null {
  if (!payload) return null;
  const noteTitle = cleanMarkdownText(
    (typeof payload.title === 'string' && payload.title) ||
    (typeof payload.selectedTitle === 'string' && payload.selectedTitle) ||
    (Array.isArray(payload.titleOptions) && typeof payload.titleOptions[0] === 'string' ? payload.titleOptions[0] : ''),
  );
  const hook = cleanMarkdownText((typeof payload.intro === 'string' && payload.intro) || (typeof payload.hook === 'string' && payload.hook) || '');
  const body = readStringList(payload.body, 20);
  const ending = cleanMarkdownText(typeof payload.ending === 'string' ? payload.ending : '');
  const tags = readStringList(payload.tags, 8).map((tag) => tag.replace(/^#/, '')).filter(Boolean);
  if (!noteTitle || !body.length) return null;
  const titleOptions = readStringList(payload.titleOptions, 5);
  return {
    noteTitle,
    titleOptions: Array.from(new Set([noteTitle, ...titleOptions])).filter(Boolean),
    hook,
    body,
    ending,
    tags,
    coverSuggestion: readCoverSuggestion(payload.coverSuggestion),
    imageTextStructure: readStringList(payload.imageTextStructure, 8),
  };
}

function ContentDraftRenderer({ draft }: { draft: StructuredContentDraft }) {
  const alternateTitles = draft.titleOptions.filter((title) => title && title !== draft.noteTitle).slice(0, 4);
  const coverLines = draft.coverSuggestion
    ? [
        draft.coverSuggestion.mainText ? `封面文字：${draft.coverSuggestion.mainText}` : '',
        draft.coverSuggestion.layout ? `排版：${draft.coverSuggestion.layout}` : '',
        draft.coverSuggestion.visualStyle ? `风格：${draft.coverSuggestion.visualStyle}` : '',
      ].filter(Boolean)
    : [];

  return (
    <article className="space-y-5 text-[var(--foreground)]">
      <section>
        <p className="text-[14px] font-bold leading-6 text-[var(--foreground)]">笔记标题</p>
        <h1 className="mt-1 whitespace-normal break-words text-[24px] font-bold leading-tight text-[var(--foreground)]">{draft.noteTitle}</h1>
        {alternateTitles.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {alternateTitles.map((title) => (
              <span key={title} className="rounded-full border border-[var(--box-border)] bg-white px-3 py-1 text-[13px] leading-5 text-[var(--foreground)]">
                {title}
              </span>
            ))}
          </div>
        )}
      </section>

      {coverLines.length > 0 && (
        <section>
          <h2 className="text-[17px] font-bold leading-tight text-[var(--foreground)]">封面建议</h2>
          <div className="mt-2 space-y-1 text-[15px] leading-7">
            {coverLines.map((line) => <MarkdownText key={line} content={line} />)}
          </div>
        </section>
      )}

      {draft.imageTextStructure.length > 0 && (
        <section>
          <h2 className="text-[17px] font-bold leading-tight text-[var(--foreground)]">图片顺序</h2>
          <div className="mt-2 space-y-1 text-[15px] leading-7">
            {draft.imageTextStructure.map((line) => <MarkdownText key={line} content={line} />)}
          </div>
        </section>
      )}

      {draft.hook && (
        <section>
          <h2 className="text-[17px] font-bold leading-tight text-[var(--foreground)]">正文开头</h2>
          <MarkdownText content={draft.hook} className="mt-2 text-[15px] leading-7" />
        </section>
      )}

      <section>
        <h2 className="text-[17px] font-bold leading-tight text-[var(--foreground)]">正文内容</h2>
        <div className="mt-2 space-y-2 text-[15px] leading-7">
          {draft.body.map((paragraph, index) => <MarkdownText key={`${index}-${paragraph}`} content={paragraph} />)}
        </div>
      </section>

      {draft.ending && (
        <section>
          <h2 className="text-[17px] font-bold leading-tight text-[var(--foreground)]">结尾互动</h2>
          <MarkdownText content={draft.ending} className="mt-2 text-[15px] leading-7" />
        </section>
      )}

      {draft.tags.length > 0 && (
        <section>
          <h2 className="text-[17px] font-bold leading-tight text-[var(--foreground)]">标签建议</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {draft.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-[#eef2ff] px-3 py-1 text-[13px] font-semibold leading-5 text-[#3730a3]">
                #{tag}
              </span>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

function stepToModule(step?: AgentStep): 'profile' | 'trending' | 'content' | 'dialog' {
  if (step === 'persona') return 'profile';
  if (step === 'trending') return 'trending';
  if (step === 'content') return 'content';
  return 'dialog';
}

function contentPointsFromSummary(summary: AgentFlowSummary): AgentContentDraftPoint[] {
  return Array.isArray(summary.content.items) ? summary.content.items : [];
}

function activeStepFromResponse(data: AgentChatResponse): AgentStep {
  return data.next_step || data.current_step || 'persona';
}

function isPersonaQuestionPending(conversation?: AgentLocalConversation | null) {
  return conversation?.create_status === 'questions_pending' && conversation.current_step === 'persona' && !conversation.question_blocks.length;
}

function normalizeBackendConversation(detail: AgentConversationDetail, fallback?: AgentLocalConversation | null): AgentLocalConversation {
  const summary = detail.summary || defaultAgentSummary;
  const questionBlocks = Array.isArray(detail.question_blocks) ? detail.question_blocks : [];
  const backendMessages = Array.isArray(detail.messages) && detail.messages.length ? detail.messages : [createWelcomeMessage()];
  const messages = questionBlocks.length
    ? backendMessages.map((message, index) =>
        message.role === 'assistant' && index === backendMessages.length - 1
          ? { ...message, question_blocks: questionBlocks }
          : message,
      )
    : backendMessages;
  const conversationId = detail.conversation_id || fallback?.conversation_id || '';
  return {
    local_id: conversationId || fallback?.local_id || `local_${Date.now()}`,
    conversation_id: conversationId || undefined,
    title: detail.conversation_title || detail.title || buildConversationTitle(summary, fallback?.title || '新的创作对话'),
    messages,
    summary,
    current_step: detail.current_step || fallback?.current_step || 'persona',
    conversation_kind: detail.conversation_kind || fallback?.conversation_kind || 'draft',
    create_status: detail.create_status || fallback?.create_status || 'ready',
    source_persona_record_id: detail.source_persona_record_id || fallback?.source_persona_record_id || null,
    parent_conversation_id: detail.parent_conversation_id || fallback?.parent_conversation_id || null,
    selected_persona_id: detail.memory_refs?.persona_memory_id || fallback?.selected_persona_id || null,
    selected_topic_id: detail.memory_refs?.trending_memory_id || fallback?.selected_topic_id || null,
    phase_approval: {
      persona: Boolean(summary.persona.done),
      trending: Boolean(summary.trending.done),
      content: Boolean(summary.content.done),
    },
    content_points: contentPointsFromSummary(summary),
    actions: detail.actions || [],
    question_blocks: questionBlocks,
    readiness: detail.readiness || {},
    copy_payload: detail.copy_payload || {},
    updated_at: detail.updated_at || new Date().toISOString(),
  };
}

function applyAgentResponse(
  baseConversation: AgentLocalConversation,
  data: AgentChatResponse,
  messages: AgentMessage[],
): AgentLocalConversation {
  const summary = data.summary || defaultAgentSummary;
  const activeStep = activeStepFromResponse(data);
  return {
    ...baseConversation,
    conversation_id: data.conversation_id,
    local_id: data.conversation_id || baseConversation.local_id,
    title: data.conversation_title || buildConversationTitle(summary, baseConversation.title),
    messages,
    summary,
    current_step: activeStep,
    conversation_kind: data.conversation_kind || baseConversation.conversation_kind || 'task',
    create_status: data.create_status || baseConversation.create_status || 'ready',
    source_persona_record_id: data.source_persona_record_id || baseConversation.source_persona_record_id || null,
    parent_conversation_id: data.parent_conversation_id || baseConversation.parent_conversation_id || null,
    selected_persona_id: data.memory_refs.persona_memory_id,
    selected_topic_id: data.memory_refs.trending_memory_id,
    phase_approval: {
      persona: Boolean(summary.persona.done),
      trending: Boolean(summary.trending.done),
      content: Boolean(summary.content.done),
    },
    content_points: contentPointsFromSummary(summary),
    actions: data.actions || [],
    question_blocks: data.question_blocks || [],
    readiness: data.readiness || {},
    copy_payload: data.copy_payload || {},
    updated_at: new Date().toISOString(),
  };
}

function copyTextForMessage(message: AgentMessage, latestAssistantId?: string, latestCopyPayload?: AgentChatResponse['copy_payload']) {
  const messageCopy = message.copy_payload?.publish_text || message.copy_payload?.copy_text;
  if (message.id === latestAssistantId) {
    return messageCopy || latestCopyPayload?.publish_text || latestCopyPayload?.copy_text || message.content;
  }
  return messageCopy || message.content.replace(/[#*_`>-]/g, '').trim();
}

function draftForMessage(message: AgentMessage, latestAssistantId?: string, latestCopyPayload?: AgentChatResponse['copy_payload']) {
  const payload = message.id === latestAssistantId ? message.copy_payload?.draft || latestCopyPayload?.draft : message.copy_payload?.draft;
  return normalizeContentDraft(payload);
}

function FlowStepIcon({ done }: { done: boolean }) {
  return done ? (
    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-[#22c55e] bg-[#dcfce7] text-[14px] font-bold text-[#16a34a]">
      ✓
    </span>
  ) : (
    <span className="mt-1 size-3 shrink-0 rounded-full border border-[#cbd5e1] bg-white" />
  );
}

function FlowSummaryBlock({
  item,
  contentPoints,
  fallbackTitle,
  fallbackHint,
  active,
  onTrace,
}: {
  item: AgentFlowSummaryItem;
  contentPoints?: AgentContentDraftPoint[];
  fallbackTitle: string;
  fallbackHint: string;
  active: boolean;
  onTrace: (messageId: string | null) => void;
}) {
  const summaryText = compactText(item.text, active && item.title === '人设打造' ? 24 : 72);
  const hasContentPoints = Boolean(contentPoints?.length);
  const canTraceStep = Boolean(item.message_id);
  return (
    <section className={`rounded-[16px] border px-4 py-4 ${active ? 'border-[#bfdbfe] bg-[#eff6ff]' : 'border-[var(--box-border)] bg-white'}`}>
      <div className="flex items-start gap-3">
        <FlowStepIcon done={item.done} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            {canTraceStep ? (
              <button
                type="button"
                onClick={() => onTrace(item.message_id)}
                className="koc-heading-font text-left text-[16px] leading-tight text-[var(--foreground)] transition hover:text-[#2563eb]"
              >
                {item.title || fallbackTitle}
              </button>
            ) : (
              <h3 className="koc-heading-font text-[16px] leading-tight text-[var(--foreground)]">{item.title || fallbackTitle}</h3>
            )}
            {active && <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-[11px] text-[#1d4ed8]">当前</span>}
          </div>
          {hasContentPoints ? (
            <div className="mt-2 space-y-1.5">
              {contentPoints?.map((point, index) => (
                <button
                  key={point.id || point.memory_id || `${point.title}-${index}`}
                  type="button"
                  onClick={() => onTrace(point.message_id)}
                  className={`block w-full whitespace-normal break-words text-left text-[13px] leading-6 transition hover:text-[#2563eb] ${
                    point.active ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--muted-text)]'
                  }`}
                >
                  {index + 1}. {point.title}
                </button>
              ))}
            </div>
          ) : summaryText ? (
            <button type="button" onClick={() => onTrace(item.message_id)} className="mt-2 block w-full truncate text-left text-[13px] leading-6 text-[var(--muted-text)] transition hover:text-[#2563eb]">
              {summaryText}
            </button>
          ) : (
            <p className="mt-2 text-[13px] leading-6 text-[var(--muted-text)]">{fallbackHint}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function AgentQuestionBlocks({
  blocks,
  disabled,
  onSelect,
}: {
  blocks: AgentQuestionBlock[];
  disabled: boolean;
  onSelect: (block: AgentQuestionBlock) => void;
}) {
  if (!blocks.length) return null;
  return (
    <div className="mt-4 space-y-3">
      {blocks.map((block) => (
        <div key={block.id || block.question} className="rounded-[12px] border border-[#dbeafe] bg-[#f8fbff] px-3.5 py-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(block)}
            className="block w-full text-left text-[14px] font-semibold leading-6 text-[#1d4ed8] transition hover:text-[#1e40af] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {block.question}
          </button>
        </div>
      ))}
    </div>
  );
}

function AgentActionButtons({
  actions,
  disabled,
  onAction,
}: {
  actions: AgentChatAction[];
  disabled: boolean;
  onAction: (action: AgentChatAction) => void;
}) {
  if (!actions.length) return null;
  return (
    <div className="flex flex-wrap gap-3 pl-1">
      {actions.map((action) => {
        const actionType = action.action_type || action.type || 'quick_reply';
        const primary = actionType === 'approve_step' || actionType === 'choose_topic';
        return (
          <button
            key={action.id || `${action.action_type}-${action.label}`}
            type="button"
            disabled={disabled || action.disabled}
            onClick={() => onAction(action)}
            className={`rounded-full px-4 py-2 text-[14px] font-semibold shadow-[var(--box-shadow)] transition disabled:cursor-not-allowed disabled:opacity-50 ${
              primary
                ? 'bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)]'
                : 'border border-[var(--box-border)] bg-white text-[var(--foreground)] hover:bg-[var(--nav-hover)]'
            }`}
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}

function ChatPerchedRobot({ loading }: { loading: boolean }) {
  const [pose, setPose] = useState<'idle' | 'sleep' | 'look'>('idle');
  const [isWalking, setIsWalking] = useState(false);
  const hadLoadingRef = useRef(false);
  const lookTimerRef = useRef<number | null>(null);
  const walkTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isWalking) return;
    if (lookTimerRef.current) {
      window.clearTimeout(lookTimerRef.current);
      lookTimerRef.current = null;
    }
    if (loading) {
      hadLoadingRef.current = true;
      setPose('sleep');
      return;
    }
    if (hadLoadingRef.current) {
      setPose('look');
      lookTimerRef.current = window.setTimeout(() => {
        setPose('idle');
        hadLoadingRef.current = false;
        lookTimerRef.current = null;
      }, 5000);
      return;
    }
    setPose('idle');
    return () => {
      if (lookTimerRef.current) {
        window.clearTimeout(lookTimerRef.current);
        lookTimerRef.current = null;
      }
    };
  }, [isWalking, loading]);

  useEffect(() => () => {
    if (lookTimerRef.current) window.clearTimeout(lookTimerRef.current);
    if (walkTimerRef.current) window.clearTimeout(walkTimerRef.current);
  }, []);

  const handleRobotClick = () => {
    if (walkTimerRef.current) window.clearTimeout(walkTimerRef.current);
    if (lookTimerRef.current) {
      window.clearTimeout(lookTimerRef.current);
      lookTimerRef.current = null;
    }
    setPose('idle');
    setIsWalking(true);
    walkTimerRef.current = window.setTimeout(() => {
      setIsWalking(false);
      walkTimerRef.current = null;
      if (loading) setPose('sleep');
      else {
        setPose('idle');
        hadLoadingRef.current = false;
      }
    }, 7600);
  };

  return (
    <button
      type="button"
      aria-label="小猪梨散步"
      title="小猪梨散步"
      onClick={handleRobotClick}
      className={`koc-chat-robot koc-chat-robot--${pose} ${isWalking ? 'koc-chat-robot--walk' : ''}`}
    >
      <span className="koc-chat-robot-grip koc-chat-robot-grip-left" />
      <span className="koc-chat-robot-grip koc-chat-robot-grip-right" />
      <svg
        viewBox="0 0 260 260"
        className="koc-chat-robot-svg koc-robot-mascot koc-robot-action-idle h-full w-full drop-shadow-[0_18px_30px_rgba(37,99,235,0.14)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="chatRobotShell" x1="8%" y1="5%" x2="92%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="52%" stopColor="#fffefe" />
            <stop offset="100%" stopColor="#e8eef9" />
          </linearGradient>
          <linearGradient id="chatRobotBlue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#5dddf5" />
            <stop offset="54%" stopColor="#20a7dc" />
            <stop offset="100%" stopColor="#1679c9" />
          </linearGradient>
          <linearGradient id="chatRobotScreen" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="62%" stopColor="#fffefe" />
            <stop offset="100%" stopColor="#eef5ff" />
          </linearGradient>
          <radialGradient id="chatRobotSoftHighlight" cx="34%" cy="18%" r="74%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="58%" stopColor="#ffffff" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0.1" />
          </radialGradient>
          <filter id="chatRobotSoftShadow" x="-20%" y="-20%" width="140%" height="150%">
            <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#64748b" floodOpacity="0.18" />
          </filter>
        </defs>
        <g className="koc-robot-pose" filter="url(#chatRobotSoftShadow)">
          <ellipse className="koc-robot-shadow" cx="130" cy="238" rx="60" ry="13" fill="rgba(148,163,184,0.18)" />
          <g className="koc-robot-leg koc-robot-left-leg">
            <path d="M91 188C84 199 84 219 91 229C98 237 116 237 122 229C124 213 119 197 109 188Z" fill="url(#chatRobotShell)" stroke="#b9c3d3" strokeWidth="2.2" />
            <ellipse cx="106" cy="229" rx="18" ry="10" fill="#fffefe" stroke="#cdd6e5" strokeWidth="2" />
          </g>
          <g className="koc-robot-leg koc-robot-right-leg">
            <path d="M151 188C141 197 136 213 138 229C144 237 162 237 169 229C176 219 176 199 169 188Z" fill="url(#chatRobotShell)" stroke="#b9c3d3" strokeWidth="2.2" />
            <ellipse cx="154" cy="229" rx="18" ry="10" fill="#fffefe" stroke="#cdd6e5" strokeWidth="2" />
          </g>
          <path className="koc-robot-body" d="M91 153C98 136 112 128 130 128C148 128 162 136 169 153L178 190C182 210 159 222 130 222C101 222 78 210 82 190Z" fill="url(#chatRobotShell)" stroke="#b8c2d1" strokeWidth="2.5" />
          <path className="koc-robot-body-highlight" d="M96 160C110 169 150 169 164 160" fill="none" stroke="rgba(255,255,255,0.86)" strokeWidth="3.5" strokeLinecap="round" />
          <g className="koc-robot-arm koc-robot-left-arm">
            <path d="M91 158C77 164 70 179 72 195C74 210 88 218 98 209C96 192 100 177 109 168Z" fill="url(#chatRobotShell)" stroke="#b9c3d3" strokeWidth="2.3" />
            <path d="M78 197C82 204 89 207 96 205" fill="none" stroke="#c8d1df" strokeWidth="2" strokeLinecap="round" />
          </g>
          <g className="koc-robot-arm koc-robot-right-arm">
            <path d="M169 158C183 164 190 179 188 195C186 210 172 218 162 209C164 192 160 177 151 168Z" fill="url(#chatRobotShell)" stroke="#b9c3d3" strokeWidth="2.3" />
            <path d="M182 197C178 204 171 207 164 205" fill="none" stroke="#c8d1df" strokeWidth="2" strokeLinecap="round" />
          </g>
          <g className="koc-robot-head" transform="translate(10.4 9) scale(0.92)">
            <path d="M52 76C57 48 69 27 86 19C100 28 108 48 114 70Z" fill="url(#chatRobotShell)" stroke="#b7c1d0" strokeWidth="2.6" strokeLinejoin="round" />
            <path d="M208 76C203 48 191 27 174 19C160 28 152 48 146 70Z" fill="url(#chatRobotShell)" stroke="#b7c1d0" strokeWidth="2.6" strokeLinejoin="round" />
            <path d="M72 65C76 49 82 38 90 32C98 42 103 53 106 67Z" fill="#ffd8df" stroke="#efb6c2" strokeWidth="2" strokeLinejoin="round" />
            <path d="M188 65C184 49 178 38 170 32C162 42 157 53 154 67Z" fill="#ffd8df" stroke="#efb6c2" strokeWidth="2" strokeLinejoin="round" />
            <rect x="38" y="60" width="184" height="114" rx="37" fill="url(#chatRobotShell)" stroke="#b4becd" strokeWidth="3" />
            <rect x="45" y="66" width="170" height="104" rx="33" fill="url(#chatRobotSoftHighlight)" opacity="0.8" />
            <path d="M54 94C56 73 76 67 101 67H158C188 67 205 80 208 105" fill="none" stroke="rgba(255,255,255,0.82)" strokeWidth="4" strokeLinecap="round" />
            <path d="M45 107C49 64 82 38 130 38C178 38 211 64 215 107" fill="none" stroke="url(#chatRobotBlue)" strokeWidth="13" strokeLinecap="round" />
            <path d="M50 111C50 128 39 141 25 139C13 137 10 123 13 104C16 85 28 74 41 77C49 79 50 94 50 111Z" fill="#ffffff" stroke="#b8c2d1" strokeWidth="2.4" />
            <path d="M32 83C43 84 49 96 49 111C49 127 42 139 29 140" fill="none" stroke="url(#chatRobotBlue)" strokeWidth="13" strokeLinecap="round" />
            <ellipse cx="29" cy="112" rx="15" ry="28" fill="#f8fbff" stroke="#b8c2d1" strokeWidth="2" opacity="0.9" />
            <path d="M210 111C210 128 221 141 235 139C247 137 250 123 247 104C244 85 232 74 219 77C211 79 210 94 210 111Z" fill="#ffffff" stroke="#b8c2d1" strokeWidth="2.4" />
            <path d="M228 83C217 84 211 96 211 111C211 127 218 139 231 140" fill="none" stroke="url(#chatRobotBlue)" strokeWidth="13" strokeLinecap="round" />
            <ellipse cx="231" cy="112" rx="15" ry="28" fill="#f8fbff" stroke="#b8c2d1" strokeWidth="2" opacity="0.9" />
            <rect x="62" y="86" width="136" height="70" rx="21" fill="url(#chatRobotScreen)" stroke="#aeb9c9" strokeWidth="3" />
            <rect x="69" y="92" width="122" height="58" rx="17" fill="none" stroke="rgba(203,213,225,0.42)" strokeWidth="2" />
            <circle className="koc-robot-screen-dot" cx="184" cy="99" r="4.6" fill="#cbd5e1" />
            <g className="koc-robot-eye koc-robot-eye-left">
              <ellipse cx="102" cy="122" rx="11" ry="17" fill="#111827" />
              <ellipse cx="103" cy="130" rx="10" ry="8" fill="#020617" opacity="0.36" />
              <circle cx="97" cy="112" r="4.8" fill="#ffffff" />
            </g>
            <g className="koc-robot-eye koc-robot-eye-right">
              <ellipse cx="159" cy="122" rx="11" ry="17" fill="#111827" />
              <ellipse cx="160" cy="130" rx="10" ry="8" fill="#020617" opacity="0.36" />
              <circle cx="154" cy="112" r="4.8" fill="#ffffff" />
            </g>
            <path className="koc-chat-robot-sleep-eye koc-chat-robot-sleep-eye-left" d="M88 121C96 127 107 127 115 121" fill="none" stroke="#111827" strokeWidth="5" strokeLinecap="round" />
            <path className="koc-chat-robot-sleep-eye koc-chat-robot-sleep-eye-right" d="M145 121C153 127 164 127 172 121" fill="none" stroke="#111827" strokeWidth="5" strokeLinecap="round" />
            <path className="koc-robot-mouth-default" d="M119 132C119 139 127 139 127 132C127 139 136 139 136 132" fill="none" stroke="#111827" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle className="koc-robot-blush koc-robot-blush-left" cx="80" cy="134" r="7" fill="#f9a8d4" />
            <circle className="koc-robot-blush koc-robot-blush-right" cx="181" cy="134" r="7" fill="#f9a8d4" />
          </g>
        </g>
      </svg>
    </button>
  );
}

export default function Home() {
  const { status, isAuthenticated, openUnlockDialog } = useAuth();
  const [input, setInput] = useState('');
  const [conversation, setConversation] = useState<AgentLocalConversation | null>(null);
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatusState | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const messages = conversation?.messages ?? EMPTY_MESSAGES;
  const summary = conversation?.summary ?? defaultAgentSummary;
  const currentStep = conversation?.current_step ?? 'persona';
  const currentRoleText = summary.persona.done ? compactText(summary.persona.text) : '';
  const shouldShowSummary = Boolean(conversation);
  const latestAssistantId = useMemo(() => [...messages].reverse().find((message) => message.role === 'assistant')?.id, [messages]);
  const pendingPersonaQuestionConversationId = isPersonaQuestionPending(conversation) ? conversation?.conversation_id || '' : '';
  const isAnonymous = status === 'anonymous';
  const isCheckingAuth = status === 'loading';

  const openGuestLimitDialog = useCallback((title = '登录后解锁完整功能') => {
    openUnlockDialog({
      title,
      descriptionLines: [
        '当前是游客模式。',
        '你可以免费生成一次初版人设：继续追问、保存人设、热门追踪和内容撰写需要登录。',
      ],
      redirectTo: '/chat',
      closeRedirectTo: '/chat',
    });
  }, [openUnlockDialog]);

  const persistConversation = useCallback((nextConversation: AgentLocalConversation) => {
    const saved = upsertLocalConversation(nextConversation);
    setConversation(saved);
  }, []);

  const loadBackendConversation = useCallback(async (conversationId: string, fallback?: AgentLocalConversation | null) => {
    const response = await fetch(`${API_BASE}/api/agent/conversations/${conversationId}`, { credentials: 'include' });
    if (!response.ok) throw new Error('load conversation failed');
    const detail = (await response.json()) as AgentConversationDetail;
    const normalized = normalizeBackendConversation(detail, fallback);
    setConversation(normalized);
    return normalized;
  }, []);

  const createBackendConversation = useCallback(async () => {
    const response = await fetch(`${API_BASE}/api/agent/conversations`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) throw new Error('create conversation failed');
    const detail = (await response.json()) as AgentConversationDetail;
    const normalized = normalizeBackendConversation(detail);
    setConversation(normalized);
    upsertLocalConversation(normalized);
    writeActiveConversationId(normalized.local_id);
    window.dispatchEvent(new Event(AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT));
    return normalized;
  }, []);

  const loadConversation = useCallback(async (localId?: string) => {
    if (localId === '') {
      setConversation(null);
      setAgentStatus(null);
      setInput('');
      setLoading(false);
      return;
    }
    if (isCheckingAuth) {
      setConversation(null);
      setAgentStatus(null);
      return;
    }
    if (isAuthenticated) {
      const activeId = localId || readActiveConversationId();
      try {
        if (activeId) {
          await loadBackendConversation(activeId);
          setAgentStatus(null);
          return;
        }
        setConversation(null);
        setAgentStatus(null);
        return;
      } catch {
        writeActiveConversationId('');
        setConversation(null);
        setAgentStatus({ kind: 'error', message: '这个对话暂时没有读到，可以重新开启一个新对话。' });
        return;
      }
    }

    const conversations = readLocalConversations();
    const target = conversations.find((item) => item.local_id === localId) || conversations.find((item) => item.local_id === readActiveConversationId()) || null;
    setConversation(target);
  }, [isAuthenticated, isCheckingAuth, loadBackendConversation]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConversation(), 0);
    const handleCreate = (event: Event) => void loadConversation((event as CustomEvent<{ localId?: string }>).detail?.localId);
    const handleSelect = (event: Event) => void loadConversation((event as CustomEvent<{ localId?: string }>).detail?.localId);
    const handleUpdated = () => void loadConversation();
    window.addEventListener(AGENT_CHAT_CREATE_CONVERSATION_EVENT, handleCreate);
    window.addEventListener(AGENT_CHAT_SELECT_CONVERSATION_EVENT, handleSelect);
    window.addEventListener(AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT, handleUpdated);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(AGENT_CHAT_CREATE_CONVERSATION_EVENT, handleCreate);
      window.removeEventListener(AGENT_CHAT_SELECT_CONVERSATION_EVENT, handleSelect);
      window.removeEventListener(AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT, handleUpdated);
    };
  }, [loadConversation]);

  useEffect(() => {
    if (!pendingPersonaQuestionConversationId) return;
    let isCancelled = false;
    let attempts = 0;
    let timer: number | undefined;
    const statusTimer = window.setTimeout(() => {
      if (!isCancelled) {
        setAgentStatus({ kind: 'running', message: '正在生成 3 个适合你的人设问题...' });
      }
    }, 0);

    const pollConversation = async () => {
      attempts += 1;
      try {
        const refreshed = await loadBackendConversation(pendingPersonaQuestionConversationId);
        if (isCancelled) return;
        upsertLocalConversation(refreshed);
        window.dispatchEvent(new Event(AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT));
        if (refreshed.question_blocks.length >= 3 || refreshed.create_status === 'ready') {
          setAgentStatus(null);
          return;
        }
        if (refreshed.create_status === 'questions_failed') {
          setAgentStatus({ kind: 'error', message: '可以直接输入你的账号信息继续。' });
          return;
        }
      } catch {
        if (attempts >= PERSONA_QUESTION_POLL_LIMIT) {
          setAgentStatus({ kind: 'error', message: '人设问题暂时没有加载出来，可以直接输入你的账号信息继续。' });
          return;
        }
      }
      if (attempts < PERSONA_QUESTION_POLL_LIMIT) {
        timer = window.setTimeout(pollConversation, PERSONA_QUESTION_POLL_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(pollConversation, PERSONA_QUESTION_POLL_INTERVAL_MS);
    return () => {
      isCancelled = true;
      window.clearTimeout(statusTimer);
      if (timer) window.clearTimeout(timer);
    };
  }, [pendingPersonaQuestionConversationId, loadBackendConversation]);

  const scrollChatToBottom = useCallback(() => {
    const container = chatContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    setShowScrollDown(false);
  }, []);

  const scrollToMessage = useCallback((messageId: string | null) => {
    if (!messageId) return;
    document.getElementById(`agent-message-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  useEffect(() => {
    if (!loading) scrollChatToBottom();
  }, [loading, messages.length, scrollChatToBottom]);

  const sendAgentRequest = useCallback(async (
    message: string,
    actionType: AgentChatActionType = 'message',
    actionPayload: Record<string, unknown> = {},
    appendUserMessage = actionType === 'message' || actionType === 'quick_reply' || actionType === 'choose_topic' || actionType === 'revise_content',
  ) => {
    const cleanMessage = message.trim();
    if (!cleanMessage || loading) return;
    if (isCheckingAuth) {
      setAgentStatus({ kind: 'running', message: '正在确认登录状态，请稍等。' });
      return;
    }

    let activeConversation = conversation;
    if (!activeConversation) {
      try {
        activeConversation = await createBackendConversation();
      } catch {
        setConversation(null);
        setAgentStatus({ kind: 'error', message: '新对话暂时没有创建成功，请稍后再试一次。' });
        return;
      }
    }
    if (!isAuthenticated) {
      const allowedPersonaAction = activeConversation.current_step === 'persona' && ['message', 'quick_reply'].includes(actionType);
      if (!allowedPersonaAction || hasUsedAnonymousPersonaTrial()) {
        openGuestLimitDialog(actionType === 'save' ? '登录后保存内容' : '登录后解锁完整流程');
        return;
      }
    }

    window.dispatchEvent(new Event(SIDEBAR_COLLAPSE_EVENT));

    const userMessage = appendUserMessage ? createUserMessage(cleanMessage) : null;
    const nextMessages = userMessage ? [...activeConversation.messages, userMessage] : activeConversation.messages;
    const pendingConversation = { ...activeConversation, messages: nextMessages };
    persistConversation(pendingConversation);
    setInput('');
    setLoading(true);
    setAgentStatus(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const response = await fetch(`${API_BASE}${AGENT_CHAT_ENDPOINT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          conversation_id: activeConversation.conversation_id,
          message: cleanMessage,
          current_step: activeConversation.current_step,
          selected_persona_id: activeConversation.selected_persona_id,
          selected_topic_id: activeConversation.selected_topic_id,
          action_type: actionType,
          action_payload: actionPayload,
        }),
        signal: controller.signal,
      });
      const data = (await response.json()) as AgentChatResponse & { detail?: string; msg?: string };

      if (!response.ok) {
        setAgentStatus({ kind: 'error', message: data.detail || data.msg || '请求失败，请稍后重试。' });
        return;
      }

      if (!isAuthenticated && activeConversation.current_step === 'persona' && ['message', 'quick_reply'].includes(actionType)) {
        markAnonymousPersonaTrialUsed();
      }

      const assistantMessage = data.assistant_message
        ? {
            ...data.assistant_message,
            step: data.current_step,
            question_blocks: data.assistant_message.question_blocks || data.question_blocks || [],
            copy_payload: data.assistant_message.copy_payload || data.copy_payload,
          }
        : null;
      persistConversation(applyAgentResponse(pendingConversation, data, assistantMessage ? [...nextMessages, assistantMessage] : nextMessages));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setAgentStatus({ kind: 'stopped', message: '本次输出已停止。' });
        return;
      }
      setAgentStatus({ kind: 'error', message: '这次没有发出去，请稍后再试一次。' });
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  }, [conversation, createBackendConversation, isAuthenticated, isCheckingAuth, loading, openGuestLimitDialog, persistConversation]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendAgentRequest(input, 'message');
  };

  const prefillInput = (nextInput: string) => {
    setInput(nextInput);
    window.setTimeout(() => {
      const inputEl = inputRef.current;
      if (!inputEl) return;
      inputEl.focus();
      inputEl.setSelectionRange(nextInput.length, nextInput.length);
    }, 0);
  };

  const handleBackendAction = (action: AgentChatAction) => {
    const actionType = action.action_type || action.type || 'quick_reply';
    const actionPayload = action.action_payload || action.payload || {};
    const prefillText = typeof actionPayload.prefill_text === 'string' ? actionPayload.prefill_text : '';
    if (prefillText || action.label.includes('继续完善')) {
      prefillInput(prefillText || '请输入你想继续了解的方向：');
      return;
    }
    void sendAgentRequest(
      action.message || action.label,
      actionType,
      actionPayload,
      actionType === 'quick_reply' || actionType === 'choose_topic' || actionType === 'revise_content',
    );
  };

  const handleQuestionSelect = (block: AgentQuestionBlock) => {
    if (block.action_type === 'choose_topic') {
      void sendAgentRequest(
        block.prefill_text || block.question,
        'choose_topic',
        block.action_payload || { step: 'trending', title: block.question },
        true,
      );
      return;
    }
    const nextInput = block.prefill_text || `${block.question}:`;
    prefillInput(nextInput);
  };

  const handleStop = () => abortControllerRef.current?.abort();

  const handleNewChat = async () => {
    if (isCheckingAuth) {
      setAgentStatus({ kind: 'running', message: '正在确认登录状态，请稍等。' });
      return;
    }
    if (!isAuthenticated && hasUsedAnonymousPersonaTrial()) {
      openGuestLimitDialog('登录后新建更多角色对话');
      return;
    }
    abortControllerRef.current?.abort();
    setInput('');
    setLoading(true);
    setAgentStatus({ kind: 'running', message: '正在开启新对话。' });
    try {
      const nextConversation = await createBackendConversation();
      setAgentStatus(isPersonaQuestionPending(nextConversation) ? { kind: 'running', message: '正在生成 3 个适合你的人设问题...' } : null);
    } catch {
      setConversation(null);
      setAgentStatus({ kind: 'error', message: '新对话暂时没有创建成功，请稍后再试一次。' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col px-[4vw] pb-6 pt-7">
      <header className="mb-5 flex shrink-0 items-center gap-4">
        <div className="min-w-0">
        <h1 className="koc-heading-font truncate text-[26px] leading-tight text-[var(--foreground)]">顶流小猪梨</h1>
          <p className="mt-1 text-[14px] text-[var(--muted-text)]">你的顶流打造小助手~</p>
        </div>
      </header>

      {isAnonymous && (
        <div className="mb-5 flex shrink-0 flex-col gap-3 rounded-[18px] border border-[#bfdbfe] bg-[#eff6ff] px-5 py-4 text-[var(--foreground)] shadow-[var(--box-shadow)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="koc-heading-font text-[16px] leading-tight text-[var(--foreground)]">当前是游客模式</p>
            <p className="mt-1 text-[13px] leading-6 text-[var(--muted-text)]">你可以免费生成一次初版人设：继续追问、保存人设、热门追踪和内容撰写需要登录</p>
          </div>
          <LoginButton className="shrink-0 self-start px-5 py-2 text-[15px] sm:self-center" />
        </div>
      )}

      <div className={`grid min-h-0 flex-1 gap-5 ${shouldShowSummary ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : 'lg:grid-cols-[minmax(0,1fr)]'}`}>
        {!conversation ? (
          <section className="flex min-h-0 flex-col items-center justify-center rounded-[20px] border border-[var(--box-border)] bg-white px-6 py-12 text-center shadow-[var(--box-shadow)]">
            <div className="max-w-[520px]">
              <h2 className="koc-heading-font text-[26px] leading-tight text-[var(--foreground)]">先开启一个新对话</h2>
              <p className="mt-3 text-[15px] leading-7 text-[var(--muted-text)]">
                开始后我会先给你 3 个问题卡，你选一个回答就行，我们一步步把账号人设聊清楚。
              </p>
              <button
                type="button"
                onClick={() => void handleNewChat()}
                disabled={loading || isCheckingAuth}
                className="koc-heading-font mt-7 rounded-full bg-[var(--primary)] px-7 py-3 text-[16px] text-white shadow-[var(--box-shadow)] transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                开启新对话
              </button>
              {agentStatus && !loading && <div className="mt-5"><AgentStatusMessage status={agentStatus} /></div>}
            </div>
          </section>
        ) : (
        <section className="relative flex min-h-0 flex-col rounded-[20px] border border-[var(--box-border)] bg-white shadow-[var(--box-shadow)]">
          <div className="pointer-events-none absolute -top-[74px] right-7 z-20 sm:-top-[112px] sm:right-[clamp(48px,6vw,116px)]">
            <ChatPerchedRobot loading={loading} />
          </div>
          <div
            ref={chatContainerRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
            }}
            className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-6 text-[15px] leading-[1.75] text-[var(--foreground)] sm:px-7"
          >
            {messages.map((message, index) => {
              const draft = message.role === 'assistant' ? draftForMessage(message, latestAssistantId, conversation?.copy_payload) : null;
              return (
                <div id={`agent-message-${message.id}`} key={message.id} className={`flex scroll-mt-6 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {message.role === 'user' ? (
                    <ChatMessageBubble variant="user" inheritTextColor>
                      <MarkdownText content={message.content} inheritTextColor />
                    </ChatMessageBubble>
                  ) : (
                    <div className="mr-[8%] w-full max-w-[min(82%,760px)]">
                      <ChatMessageBubble variant="assistant">
                        {draft ? <ContentDraftRenderer draft={draft} /> : <MarkdownText content={message.content} />}
                        <AgentQuestionBlocks blocks={visibleQuestionBlocks(message.question_blocks || [], messages, index)} disabled={loading} onSelect={handleQuestionSelect} />
                      </ChatMessageBubble>
                      <MessageActions
                        onRefresh={() => void sendAgentRequest('重新生成当前结果', 'regenerate', { instruction: '重新生成当前结果' }, false)}
                        onSave={() => void sendAgentRequest('保存当前结果', 'save', {}, false)}
                        refreshDisabled={loading || !isAuthenticated}
                        saveDisabled={loading || !isAuthenticated}
                        copyText={copyTextForMessage(message, latestAssistantId, conversation?.copy_payload)}
                        copyEvent={{
                          eventName: 'agent_output_copy',
                          module: stepToModule(message.step || currentStep),
                          conversationId: conversation?.conversation_id,
                          messageId: message.id,
                          messageIndex: index,
                          messageRole: 'assistant',
                          contentLength: message.content.length,
                          copySource: 'unified_agent_chat',
                        }}
                      />
                      {message.id === latestAssistantId && (
                        <AgentActionButtons actions={conversation?.actions || []} disabled={loading} onAction={handleBackendAction} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {agentStatus && !loading && <AgentStatusMessage status={agentStatus} />}
        {loading && <AgentStatusMessage status={{ kind: 'running', message: '顶流小猪梨 正在整理下一步...' }} />}
          </div>

          {showScrollDown && <ScrollToBottomButton onClick={scrollChatToBottom} />}

          <ChatInputShell className="relative px-5 sm:px-7">
            <form onSubmit={handleSubmit} className="koc-chat-input-surface flex min-h-[72px] items-center rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.98)] px-5 sm:px-7">
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={loading ? '等待回复中…' : getNextPrompt(currentStep)}
                className="koc-song-font koc-chat-placeholder min-w-0 flex-1 bg-transparent text-[16px] text-[var(--foreground)] outline-none sm:text-[17px]"
                disabled={loading}
              />
              <button
                type="button"
                onClick={loading ? handleStop : () => void sendAgentRequest(input, 'message')}
                disabled={!loading && !input.trim()}
                className="grid size-11 place-items-center text-[29px] text-[var(--foreground)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45"
                aria-label={loading ? '停止生成' : '发送'}
                title={loading ? '停止生成' : '发送'}
              >
                {loading ? <StopGenerationIcon /> : <Image src="/koc-assets/icons/图标/发送.svg" alt="" width={24} height={24} className="size-[24px]" />}
              </button>
            </form>
          </ChatInputShell>
        </section>
        )}

        {shouldShowSummary && (
          <aside className="flex min-h-0 flex-col rounded-[20px] border border-[var(--box-border)] bg-white p-5 shadow-[var(--box-shadow)]">
            <div className="shrink-0">
              <p className="koc-heading-font text-[18px] leading-tight text-[var(--foreground)]">流程摘要</p>
              <p className="mt-2 text-[13px] leading-6 text-[var(--muted-text)]">
                {currentRoleText ? `当前对话：${currentRoleText}` : `当前流程：${summary[currentStep as FlowSummaryKey]?.title || '人设打造'}`}
              </p>
            </div>
            <div className="mt-5 min-h-0 flex-1 space-y-3 overflow-y-auto">
              {stepOrder.map((step) => (
                <FlowSummaryBlock
                  key={step.key}
                  item={summary[step.key]}
                  contentPoints={step.key === 'content' ? conversation?.content_points : undefined}
                  fallbackTitle={step.title}
                  fallbackHint={step.hint}
                  active={currentStep === step.step}
                  onTrace={scrollToMessage}
                />
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
