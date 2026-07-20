'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useAppState } from '@/context/AppStateContext';
import { API_BASE, isRecord, readJsonResponse } from '@/lib/api';
import {
  CHAT_INPUT_MAX_CHARS,
  countTextChars,
  CONVERSATION_LIMIT_NOTICE,
  hasReachedConversationHardStop,
  limitTextChars,
  trimVisibleConversation,
} from '@/lib/conversation-memory';
import { buildVisibleInitialTrendMessage } from '@/lib/initial-agent-prompts';
import MarkdownText from '@/components/MarkdownText';
import MessageActions from '@/components/MessageActions';
import RequirePersona from '@/components/RequirePersona';
import ScenarioHeader from '@/components/ScenarioHeader';
import TopToast from '@/components/TopToast';
import AgentStatusMessage from '@/components/AgentStatusMessage';
import ScrollToBottomButton from '@/components/ScrollToBottomButton';
import ChatInputShell from '@/components/ChatInputShell';
import ChatMessageBubble from '@/components/ChatMessageBubble';
import StopGenerationIcon from '@/components/StopGenerationIcon';
import { SKIP_UNLOCK_ONCE_STORAGE_KEY, useAuth } from '@/context/AuthContext';
import {
  isLegacyAgentStatusContent,
  readLegacyAgentStatus,
  readStoredAgentStatus,
  splitTrailingLegacyAgentStatus,
  splitTrailingLegacyAgentStatusText,
  type AgentStatusState,
} from '@/lib/agent-status';
import {
  clearConversationId,
  getOrCreateConversationId,
  type AgentOutputCopyEvent,
  trackAnalyticsEvent,
} from '@/lib/analytics';
import { createConversationScopeId } from '@/lib/conversation-scope';
import { getPersonaDisplayTitle, readSelectedPersona, type SelectedPersona } from '@/lib/persona';

type ViewMode = 'history' | 'chat';
type TrendSummaryMode = 'realtime_progress';
const TRENDING_VIEW_MODE_STORAGE_KEY = 'koc-agent-trending-view-mode';
const TRENDING_CHAT_STATE_STORAGE_KEY = 'koc-agent-trending-chat-state';
const TRENDING_CHAT_SCROLL_TOP_STORAGE_KEY = 'koc-agent-trending-chat-scroll-top';
const TREND_REALTIME_SUMMARY_MODE: TrendSummaryMode = 'realtime_progress';
const TREND_REALTIME_SUMMARY_PROMPT = '请总结当前热门追踪会话的实时进度，并输出可用于更新概要图的完整热门追踪结果。';
const TRENDING_CONVERSATION_ID_STORAGE_KEY = 'koc-analytics-trending-conversation-id';

interface TrendAnalysis {
  id?: string;
  conversationScopeId?: string;
  conversationSummary?: Record<string, unknown>;
  memoryMeta?: Record<string, unknown>;
  trackName: string;
  trackTime: string;
  userPrompt: string;
  trends: string;
  audience: string;
  topics: string[];
  cardPreview?: {
    discoveryKeywords: string[];
    shortTopics: string[];
  };
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  status?: '待追踪' | '追踪中' | '已完成';
  source?: string;
  tags?: string[];
  updatedAt?: string;
  createdAt?: string;
  personaRecordId?: string;
  personaTitle?: string;
  personaSource?: 'history' | 'favorite' | 'latest';
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  analysis?: TrendAnalysis;
  canSave?: boolean;
  isRealtimeSummary?: boolean;
}

type NoticeTone = 'success' | 'error' | 'info';

type TrendRecord = TrendAnalysis;

interface CompleteTrendAnalysisPayload {
  trackName: string;
  trends: string;
  audience: string;
  topics: string[];
  cardPreview?: {
    discoveryKeywords: string[];
    shortTopics: string[];
  };
}

function sameTrendRecord(left: TrendAnalysis, right: TrendAnalysis) {
  const sameBusinessKey =
    left.trackName === right.trackName && left.trackTime === right.trackTime && left.userPrompt === right.userPrompt;
  return sameBusinessKey || Boolean(left.id && right.id && left.id === right.id);
}

interface StoredTrendingChatState {
  analysis: TrendAnalysis | null;
  messages: string[];
  conversationHistory: ConversationMessage[];
  conversationScopeId: string;
  isLoading: boolean;
  activeRequestId: string;
  agentStatus?: AgentStatusState | null;
}

function serializeConversationHistory(messages: ConversationMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function isFailedTrendMessage(content: string) {
  return Boolean(readLegacyAgentStatus(content)?.kind === 'error');
}

function shouldDiscardStoredTrendingChatState(state: StoredTrendingChatState) {
  if (state.isLoading) return false;
  if (state.agentStatus?.kind === 'error') return true;
  const lastMessage = state.conversationHistory[state.conversationHistory.length - 1];
  if (!lastMessage || lastMessage.role !== 'assistant') return false;
  return isFailedTrendMessage(lastMessage.content);
}

function formatToday() {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatRecordDate(value?: string) {
  if (!value) return '暂无';
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(value)) return value;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10).replaceAll('-', '/');
  return value;
}

function buildRecordTags(record: TrendAnalysis) {
  const base = record.tags && record.tags.length > 0 ? record.tags : [];
  if (base.length > 0) return base;
  const fallback = [record.trackName, ...record.topics.slice(0, 2)]
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/[｜|].*$/, '').trim())
    .filter(Boolean);
  return Array.from(new Set(fallback)).slice(0, 3);
}

function normalizeShortPhrase(value: string) {
  const cleaned = value
    .replace(/^[#\s]+/, '')
    .replace(/[。.!?！？].*$/, '')
    .replace(/[：:；;，,].*$/, '')
    .replace(/(大学生|小红书|如何|怎么|教程|方法|真的|第一次|最容易|这?几个|这?些)/g, '')
    .replace(/\s+/g, '')
    .trim();
  return (cleaned || value.replace(/\s+/g, '')).slice(0, 14);
}

function uniqueShortPhrases(values: string[]) {
  const result: string[] = [];
  for (const value of values) {
    const phrase = normalizeShortPhrase(value);
    if (phrase && !result.includes(phrase)) {
      result.push(phrase);
    }
    if (result.length >= 3) break;
  }
  return result;
}

function fallbackDiscoveryKeywords(record: TrendAnalysis) {
  return uniqueShortPhrases([
    ...(record.tags || []),
    ...record.trends.split(/[、,，；;\n]+/),
    record.trackName,
  ]);
}

function fallbackShortTopics(record: TrendAnalysis) {
  return uniqueShortPhrases(record.topics);
}

function readTrendCardPreview(record: TrendAnalysis) {
  const discoveryKeywords = uniqueShortPhrases(record.cardPreview?.discoveryKeywords?.filter(Boolean) || []);
  const shortTopics = uniqueShortPhrases(record.cardPreview?.shortTopics?.filter(Boolean) || []);
  return {
    discoveryKeywords: discoveryKeywords.length > 0 ? discoveryKeywords : fallbackDiscoveryKeywords(record),
    shortTopics: shortTopics.length > 0 ? shortTopics : fallbackShortTopics(record),
  };
}

function normalizeTrendRecord(record: TrendAnalysis): TrendRecord {
  const createdAt = record.createdAt || record.updatedAt || record.trackTime || new Date().toISOString();
  const updatedAt = record.updatedAt || record.trackTime || createdAt;
  return {
    ...record,
    id: record.id,
    status: record.status || '待追踪',
    source: record.source || '热门追踪｜默认来源',
    tags: buildRecordTags(record),
    conversationHistory: Array.isArray(record.conversationHistory)
      ? record.conversationHistory.filter(
          (message): message is { role: 'user' | 'assistant'; content: string } =>
            (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string',
        )
      : undefined,
    createdAt,
    updatedAt,
  };
}

function splitAnalysisText(value: string) {
  return value
    .split(/[；;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function stringifyTrendAnalysis(record: TrendAnalysis) {
  const lines = [
    `追踪标题：${record.trackName}`,
    `热点趋势：${record.trends}`,
    `受众需求：${record.audience}`,
  ];
  if (record.topics.length > 0) {
    lines.push(`可执行选题：${record.topics.map((topic, index) => `${index + 1}. ${topic}`).join('；')}`);
  }
  return lines.join('\n');
}

function buildTrendAnalysisRecord(
  completeAnalysis: CompleteTrendAnalysisPayload,
  currentAnalysis: TrendAnalysis | null,
  userPrompt: string,
): TrendAnalysis {
  const shouldReuseCurrentRecord = Boolean(currentAnalysis?.id || currentAnalysis);
  return {
    id: shouldReuseCurrentRecord ? currentAnalysis?.id : createTrendRecordId(),
    trackName: completeAnalysis.trackName,
    trackTime: formatToday(),
    userPrompt,
    trends: completeAnalysis.trends,
    audience: completeAnalysis.audience,
    topics: completeAnalysis.topics,
    cardPreview: completeAnalysis.cardPreview,
    status: shouldReuseCurrentRecord ? currentAnalysis?.status || '追踪中' : '追踪中',
    source: shouldReuseCurrentRecord ? currentAnalysis?.source || '实时追踪｜当前对话' : '实时追踪｜当前对话',
    tags:
      shouldReuseCurrentRecord && currentAnalysis?.tags && currentAnalysis.tags.length > 0
        ? currentAnalysis.tags
        : ['实时追踪', '热点洞察', '受众需求'],
    updatedAt: formatToday(),
    createdAt: shouldReuseCurrentRecord ? currentAnalysis?.createdAt : new Date().toISOString(),
  };
}

function buildAnalysisConversationMessage(analysis: TrendAnalysis, isRealtimeSummary = false): ConversationMessage {
  return {
    role: 'assistant',
    content: stringifyTrendAnalysis(analysis),
    analysis,
    canSave: true,
    isRealtimeSummary,
  };
}

function readCompleteAnalysisPayload(payload: Record<string, unknown>): CompleteTrendAnalysisPayload | null {
  const completeAnalysis = isRecord(payload.completeAnalysis) ? payload.completeAnalysis : null;
  if (!completeAnalysis) return null;

  const trackName = typeof completeAnalysis.trackName === 'string' ? completeAnalysis.trackName.trim() : '';
  const trends = typeof completeAnalysis.trends === 'string' ? completeAnalysis.trends.trim() : '';
  const audience = typeof completeAnalysis.audience === 'string' ? completeAnalysis.audience.trim() : '';
  const topics = Array.isArray(completeAnalysis.topics)
    ? completeAnalysis.topics.filter((topic): topic is string => typeof topic === 'string' && topic.trim().length > 0)
    : [];
  const rawPreview = isRecord(completeAnalysis.cardPreview) ? completeAnalysis.cardPreview : {};
  const discoveryKeywords = Array.isArray(rawPreview.discoveryKeywords)
    ? uniqueShortPhrases(
        rawPreview.discoveryKeywords.filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
      )
    : [];
  const shortTopics = Array.isArray(rawPreview.shortTopics)
    ? uniqueShortPhrases(
        rawPreview.shortTopics.filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
      )
    : [];
  const cardPreview =
    discoveryKeywords.length > 0 || shortTopics.length > 0
      ? { discoveryKeywords, shortTopics }
      : undefined;

  return trackName && trends && audience && topics.length > 0
    ? { trackName, trends, audience, topics, cardPreview }
    : null;
}

function isTrendAnalysis(value: unknown): value is TrendAnalysis {
  return Boolean(
    isRecord(value) &&
      typeof value.trackName === 'string' &&
      typeof value.trackTime === 'string' &&
      typeof value.userPrompt === 'string' &&
      typeof value.trends === 'string' &&
      typeof value.audience === 'string' &&
      Array.isArray(value.topics),
  );
}

function readStoredTrendingChatState(): StoredTrendingChatState | null {
  const raw = window.sessionStorage.getItem(TRENDING_CHAT_STATE_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredTrendingChatState>;
    const baseConversationHistory = Array.isArray(parsed.conversationHistory)
      ? trimVisibleConversation(parsed.conversationHistory.filter(
          (message): message is ConversationMessage =>
            (message?.role === 'user' || message?.role === 'assistant') && typeof message.content === 'string',
        ).map((message) => ({
          ...message,
          canSave: false,
          isRealtimeSummary: Boolean(message.isRealtimeSummary),
        })))
      : [];
    const historyWithStatusSplit = splitTrailingLegacyAgentStatus(baseConversationHistory);
    const baseMessages = Array.isArray(parsed.messages) ? parsed.messages.filter((message): message is string => typeof message === 'string') : [];
    const messagesWithStatusSplit = splitTrailingLegacyAgentStatusText(baseMessages);
    const agentStatus =
      readStoredAgentStatus(parsed.agentStatus) ||
      historyWithStatusSplit.agentStatus ||
      messagesWithStatusSplit.agentStatus;

    const nextState: StoredTrendingChatState = {
      analysis: isTrendAnalysis(parsed.analysis) ? parsed.analysis : null,
      messages: messagesWithStatusSplit.messages,
      conversationHistory: historyWithStatusSplit.messages,
      conversationScopeId:
        typeof parsed.conversationScopeId === 'string' && parsed.conversationScopeId
          ? parsed.conversationScopeId
          : createConversationScopeId('trend'),
      isLoading: Boolean(parsed.isLoading),
      activeRequestId: typeof parsed.activeRequestId === 'string' ? parsed.activeRequestId : '',
      agentStatus,
    };
    if (shouldDiscardStoredTrendingChatState(nextState)) {
      window.sessionStorage.removeItem(TRENDING_CHAT_STATE_STORAGE_KEY);
      return null;
    }
    return nextState;
  } catch {
    return null;
  }
}

function writeStoredTrendingChatState(state: StoredTrendingChatState, notify = false) {
  window.sessionStorage.setItem(
    TRENDING_CHAT_STATE_STORAGE_KEY,
    JSON.stringify({ ...state, conversationHistory: trimVisibleConversation(state.conversationHistory) }),
  );
  if (notify) {
    window.dispatchEvent(new Event('koc-trending-chat-state-updated'));
  }
}

function createAutoRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createTrendRecordId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `trend-${crypto.randomUUID()}`;
  }
  return `trend-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createTrendRequestId(prefix: string, counter: number) {
  return `${prefix}-${Date.now()}-${counter}`;
}

function readClientTimestampMs() {
  return Date.now();
}

function buildTrendingCopyEvent(message: ConversationMessage, index: number): AgentOutputCopyEvent {
  return {
    eventName: 'agent_output_copy',
    module: 'trending',
    conversationId: getOrCreateConversationId(TRENDING_CONVERSATION_ID_STORAGE_KEY),
    messageId: `${index}-${message.role}-${message.content.slice(0, 24)}`,
    messageIndex: index,
    messageRole: message.role,
    contentLength: message.content.length,
    copySource: 'message_action_button',
  };
}

function AuthStateFallback({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[920px] items-center justify-center px-6 py-12">
      <div className="w-full rounded-[24px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.92)] px-8 py-10 text-center shadow-[var(--box-shadow)]">
        <h1 className="koc-title-font text-[28px] leading-tight text-[var(--foreground)]">{title}</h1>
        <p className="mx-auto mt-4 max-w-[540px] text-[16px] leading-7 text-[var(--foreground)]">{description}</p>
      </div>
    </div>
  );
}

export default function TrendingPage() {
  const router = useRouter();
  const { state, dispatch } = useAppState();
  const { isAuthenticated, status, openUnlockDialog } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>('history');
  const [input, setInput] = useState('');
  const [analysis, setAnalysis] = useState<TrendAnalysis | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSummarizingProgress, setIsSummarizingProgress] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState<NoticeTone>('info');
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [conversationScopeId, setConversationScopeId] = useState(() => createConversationScopeId('trend'));
  const [agentStatus, setAgentStatus] = useState<AgentStatusState | null>(null);
  const [selectedPersona] = useState<SelectedPersona | null>(() => readSelectedPersona());
  const [showScrollDown, setShowScrollDown] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const activeRequestRef = useRef('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopTriggeredAtRef = useRef(0);
  const stopCooldownTimerRef = useRef<number | null>(null);
  const requestCounterRef = useRef(0);
  const noticeTimerRef = useRef<number | null>(null);
  const pendingAutoScrollRef = useRef(false);
  const pendingRestoreScrollRef = useRef(false);
  const anonymousRedirectTriggeredRef = useRef(false);
  const retryLastTrendRequestRef = useRef<(() => void) | null>(null);
  const conversationLimitToastShownRef = useRef(false);
  const hasReachedConversationLimit = hasReachedConversationHardStop(conversationHistory);
  const activePersonaJson = selectedPersona?.persona || state.persona?.json;
  const activePersonaTitle = selectedPersona ? getPersonaDisplayTitle(selectedPersona.persona) : state.persona?.title;
  const activePersonaUsage: Pick<TrendAnalysis, 'personaRecordId' | 'personaTitle' | 'personaSource'> = activePersonaTitle
    ? {
        personaRecordId: selectedPersona?.recordId,
        personaTitle: activePersonaTitle,
        personaSource: selectedPersona?.source || 'latest',
      }
    : {};

  const requestStop = useCallback(() => {
    stopTriggeredAtRef.current = 1;
    if (stopCooldownTimerRef.current) {
      window.clearTimeout(stopCooldownTimerRef.current);
    }
    stopCooldownTimerRef.current = window.setTimeout(() => {
      stopTriggeredAtRef.current = 0;
      stopCooldownTimerRef.current = null;
    }, 500);
    abortControllerRef.current?.abort();
  }, []);

  const updateInput = useCallback((value: string) => {
    if (countTextChars(value) > CHAT_INPUT_MAX_CHARS) {
      window.alert(`已超过 ${CHAT_INPUT_MAX_CHARS} 字限制`);
      setInput(limitTextChars(value, CHAT_INPUT_MAX_CHARS));
      return;
    }
    setInput(value);
  }, []);

  const validateInputLength = useCallback((value: string) => {
    if (countTextChars(value) <= CHAT_INPUT_MAX_CHARS) return true;
    window.alert(`已超过 ${CHAT_INPUT_MAX_CHARS} 字限制`);
    return false;
  }, []);

  const switchViewMode = useCallback((nextViewMode: ViewMode) => {
    setViewMode(nextViewMode);
    window.sessionStorage.setItem(TRENDING_VIEW_MODE_STORAGE_KEY, nextViewMode);
  }, []);

  const showNotice = useCallback((message: string, tone: NoticeTone = 'info', autoHide = false) => {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setNotice(message);
    setNoticeTone(tone);
    if (autoHide) {
      noticeTimerRef.current = window.setTimeout(() => {
        setNotice('');
        setNoticeTone('info');
        noticeTimerRef.current = null;
      }, 2000);
    }
  }, []);

  const blockWhenConversationLimitReached = useCallback(() => {
    showNotice(CONVERSATION_LIMIT_NOTICE, 'error');
  }, [showNotice]);

  useEffect(() => {
    if (!hasReachedConversationLimit) {
      conversationLimitToastShownRef.current = false;
      return;
    }
    if (conversationLimitToastShownRef.current) return;
    conversationLimitToastShownRef.current = true;
    showNotice(CONVERSATION_LIMIT_NOTICE, 'error');
  }, [hasReachedConversationLimit, showNotice]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
      if (stopCooldownTimerRef.current) {
        window.clearTimeout(stopCooldownTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (status !== 'anonymous' || anonymousRedirectTriggeredRef.current) return;
    anonymousRedirectTriggeredRef.current = true;
    if (window.sessionStorage.getItem(SKIP_UNLOCK_ONCE_STORAGE_KEY) === '1') {
      window.sessionStorage.removeItem(SKIP_UNLOCK_ONCE_STORAGE_KEY);
      router.replace('/');
      return;
    }
    openUnlockDialog({
      title: '登录后解锁完整功能',
      descriptionLines: ['热门追踪和内容撰写需要基于', '你的人设信息、历史记录和草稿内容生成'],
      redirectTo: '/trending',
      closeRedirectTo: '/',
    });
    router.replace('/');
  }, [openUnlockDialog, router, status]);

  const scrollChatToBottom = useCallback(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    setShowScrollDown(false);
  }, []);

  useEffect(() => {
    if (viewMode !== 'chat' || !pendingAutoScrollRef.current) return;
    pendingAutoScrollRef.current = false;
    const timer = window.setTimeout(scrollChatToBottom, 0);
    return () => window.clearTimeout(timer);
  }, [analysis, messages, isLoading, scrollChatToBottom, viewMode]);

  useEffect(() => {
    if (viewMode !== 'chat' || !pendingRestoreScrollRef.current || pendingAutoScrollRef.current) return;
    pendingRestoreScrollRef.current = false;
    const timer = window.setTimeout(() => {
      const container = chatScrollRef.current;
      if (!container) return;
      const savedTop = Number(window.sessionStorage.getItem(TRENDING_CHAT_SCROLL_TOP_STORAGE_KEY) || 0);
      container.scrollTop = Number.isFinite(savedTop) ? savedTop : 0;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [analysis, messages, isLoading, viewMode]);

  useEffect(() => {
    const savedViewMode = window.sessionStorage.getItem(TRENDING_VIEW_MODE_STORAGE_KEY);
    if (savedViewMode !== 'history' && savedViewMode !== 'chat') return;
    const timer = window.setTimeout(() => setViewMode(savedViewMode), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const applyStoredChatState = useCallback((restoreScroll = false) => {
    const storedChatState = readStoredTrendingChatState();
    if (!storedChatState) return;
    if (shouldDiscardStoredTrendingChatState(storedChatState)) {
      activeRequestRef.current = '';
      pendingRestoreScrollRef.current = false;
      setAnalysis(null);
      setMessages([]);
      setConversationHistory([]);
      setAgentStatus(null);
      setIsLoading(false);
      setViewMode('history');
      window.sessionStorage.removeItem(TRENDING_CHAT_STATE_STORAGE_KEY);
      window.sessionStorage.removeItem(TRENDING_CHAT_SCROLL_TOP_STORAGE_KEY);
      window.sessionStorage.removeItem(TRENDING_VIEW_MODE_STORAGE_KEY);
      return;
    }

    activeRequestRef.current = storedChatState.activeRequestId;
    pendingRestoreScrollRef.current = restoreScroll;
    setAnalysis(storedChatState.analysis);
    setMessages(storedChatState.messages);
    setConversationHistory(storedChatState.conversationHistory);
    setConversationScopeId(storedChatState.conversationScopeId);
    setAgentStatus(storedChatState.agentStatus ?? null);
    setIsLoading(storedChatState.isLoading);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => applyStoredChatState(true), 0);

    return () => window.clearTimeout(timer);
  }, [applyStoredChatState]);

  useEffect(() => {
    const handleUpdate = () => applyStoredChatState(false);
    window.addEventListener('koc-trending-chat-state-updated', handleUpdate);
    return () => window.removeEventListener('koc-trending-chat-state-updated', handleUpdate);
  }, [applyStoredChatState]);

  useEffect(() => {
    if (viewMode !== 'chat') return;
    writeStoredTrendingChatState({
      analysis,
      messages,
      conversationHistory,
      conversationScopeId,
      isLoading,
      activeRequestId: activeRequestRef.current,
      agentStatus,
    });
  }, [agentStatus, analysis, conversationHistory, conversationScopeId, isLoading, messages, viewMode]);

  useEffect(() => {
    if (viewMode !== 'chat' || isLoading) return;
    const hasConversation = conversationHistory.length > 0;
    const hasAnalysis = Boolean(analysis);
    const hasAgentStatus = Boolean(agentStatus);
    if (hasConversation || hasAnalysis || hasAgentStatus) return;

    activeRequestRef.current = '';
    pendingRestoreScrollRef.current = false;
    window.sessionStorage.removeItem(TRENDING_CHAT_STATE_STORAGE_KEY);
    window.sessionStorage.removeItem(TRENDING_CHAT_SCROLL_TOP_STORAGE_KEY);
    window.sessionStorage.removeItem(TRENDING_VIEW_MODE_STORAGE_KEY);
    const timer = window.setTimeout(() => setViewMode('history'), 0);
    return () => window.clearTimeout(timer);
  }, [agentStatus, analysis, conversationHistory, isLoading, viewMode]);

  const loadHistory = useCallback(async () => {
    try {
      if (!isAuthenticated) return;
      const response = await fetch(`${API_BASE}/api/trends/history`, { credentials: 'include' });
      if (!response.ok) {
        return;
      }
      const json = await readJsonResponse(response);
      if (!isRecord(json) || json.code !== 200) {
        return;
      }
      const data = isRecord(json) && isRecord(json.data) ? json.data : {};
      const rawHistory = Array.isArray(data.trendHistory) ? data.trendHistory : [];
      const nextRecords = rawHistory.filter((r) => r && r.trackName && r.trackTime);
      dispatch({ type: 'SET_TREND_RECORDS', payload: nextRecords });
    } catch (error) {
      console.error('Trend history fetch error', error);
    }
  }, [dispatch, isAuthenticated]);

  useEffect(() => {
    void Promise.resolve().then(loadHistory);
  }, [loadHistory]);

  const openAnalysis = (nextAnalysis: TrendAnalysis, userText?: string) => {
    const storedConversationHistory = Array.isArray(nextAnalysis.conversationHistory)
      ? trimVisibleConversation(
          nextAnalysis.conversationHistory.map((message) =>
            message.role === 'assistant' && message.content === stringifyTrendAnalysis(nextAnalysis)
              ? buildAnalysisConversationMessage(nextAnalysis)
              : { role: message.role, content: message.content },
          ),
        )
      : null;
    const userMessage = userText || nextAnalysis.userPrompt || `继续追踪「${nextAnalysis.trackName}」`;
    const nextHistory: ConversationMessage[] =
      storedConversationHistory && storedConversationHistory.length > 0
        ? storedConversationHistory
        : [{ role: 'user', content: userMessage }, buildAnalysisConversationMessage(nextAnalysis)];
    const visibleUserMessages = nextHistory.filter((message) => message.role === 'user').map((message) => message.content);
    setAnalysis(nextAnalysis);
    setMessages(visibleUserMessages);
    setConversationHistory(nextHistory);
    setConversationScopeId(nextAnalysis.conversationScopeId || createConversationScopeId('trend'));
    setAgentStatus(null);
    setIsLoading(false);
    activeRequestRef.current = '';
    switchViewMode('chat');
    setInput('');
    writeStoredTrendingChatState({
      analysis: nextAnalysis,
      messages: visibleUserMessages,
      conversationHistory: nextHistory,
      conversationScopeId: nextAnalysis.conversationScopeId || createConversationScopeId('trend'),
      isLoading: false,
      activeRequestId: '',
      agentStatus: null,
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isLoading || isSummarizingProgress) {
      return;
    }
    if (stopTriggeredAtRef.current) {
      return;
    }
    const content = input.trim();
    if (!content) return;
    if (!validateInputLength(content)) return;
    if (!isAuthenticated) {
      openUnlockDialog({
        title: '登录后解锁完整功能',
        descriptionLines: ['热门追踪和内容撰写需要基于', '你的人设信息、历史记录和草稿内容生成'],
        redirectTo: '/trending',
      });
      return;
    }

    const isFromHistory = viewMode === 'history';
    const baseHistory = isFromHistory ? [] : conversationHistory;
    if (hasReachedConversationHardStop(baseHistory)) {
      blockWhenConversationLimitReached();
      return;
    }
    const displayedUserContent = isFromHistory ? buildVisibleInitialTrendMessage(content) : content;
    const newUserMessage = { role: 'user' as const, content: displayedUserContent };
    const updatedHistory = trimVisibleConversation([...baseHistory, newUserMessage]);
    const updatedMessages = isFromHistory ? [displayedUserContent] : [...messages, content];

    if (isFromHistory) {
      switchViewMode('chat');
    }
    setAnalysis(isFromHistory ? null : analysis);
    setMessages(updatedMessages);
    pendingAutoScrollRef.current = true;
    setConversationHistory(updatedHistory);
    setAgentStatus(null);
    setInput('');

    void callTrendAgent(content, updatedHistory, updatedMessages, isFromHistory ? null : analysis);
  };

  const callTrendAgent = async (
    userPreference: string,
    historyToSend: ConversationMessage[],
    visibleMessages: string[],
    currentAnalysis: TrendAnalysis | null,
  ) => {
    const conversationId = getOrCreateConversationId(TRENDING_CONVERSATION_ID_STORAGE_KEY);
    retryLastTrendRequestRef.current = () => {
      void callTrendAgent(userPreference, historyToSend, visibleMessages, currentAnalysis);
    };
    requestCounterRef.current += 1;
    const requestId = createTrendRequestId('trend', requestCounterRef.current);
    const startedAt = readClientTimestampMs();
    const turnIndex = historyToSend.filter((message) => message.role === 'user').length;
    const controller = new AbortController();
    activeRequestRef.current = requestId;
    abortControllerRef.current = controller;
    pendingAutoScrollRef.current = true;
    setIsLoading(true);
    showNotice('', 'info');
    writeStoredTrendingChatState({
      analysis: currentAnalysis,
      messages: visibleMessages,
      conversationHistory: historyToSend,
      conversationScopeId,
      isLoading: true,
      activeRequestId: requestId,
      agentStatus: null,
    });
    void trackAnalyticsEvent({
      eventName: 'conversation_turn_started',
      module: 'trending',
      conversationId,
      requestId,
      taskType: 'trend.track',
      turnIndex,
      userMessageLength: userPreference.length,
      historyMessageCount: Math.max(historyToSend.length - 1, 0),
      status: 'started',
    });

    try {
      const response = await fetch(`${API_BASE}/api/trends/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          preference: userPreference,
          persona: activePersonaJson,
          conversationScopeId,
          conversationHistory: trimVisibleConversation(historyToSend),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await readJsonResponse(response).catch(() => null);
        const message = isRecord(errorData) && typeof errorData.message === 'string' ? errorData.message : '调用失败';
        throw new Error(message);
      }

      const result = await readJsonResponse(response);
      const payload = isRecord(result) && isRecord(result.data) ? result.data : {};
      const completeAnalysis = readCompleteAnalysisPayload(payload);
      const assistantText: string =
        (typeof payload.text === 'string' && payload.text) ||
        (completeAnalysis ? `${completeAnalysis.trends}\n${completeAnalysis.audience}` : '暂无结果');

      if (activeRequestRef.current !== requestId) return;

      const finalConversationHistory = trimVisibleConversation([...historyToSend, { role: 'assistant' as const, content: assistantText }]);
      if (!completeAnalysis) {
        activeRequestRef.current = '';
        abortControllerRef.current = null;
        pendingAutoScrollRef.current = true;
        setMessages(visibleMessages);
        setConversationHistory(finalConversationHistory);
        setAgentStatus(null);
        setAnalysis(currentAnalysis);
        setIsLoading(false);
        if (currentAnalysis === null) {
          switchViewMode('chat');
        }
        writeStoredTrendingChatState(
          {
            analysis: currentAnalysis,
            messages: visibleMessages,
            conversationHistory: finalConversationHistory,
            conversationScopeId,
            isLoading: false,
            activeRequestId: '',
            agentStatus: null,
    },
          true,
        );
        void trackAnalyticsEvent({
          eventName: 'conversation_turn_completed',
          module: 'trending',
          conversationId,
          requestId,
          taskType: 'trend.track',
          turnIndex,
          userMessageLength: userPreference.length,
          assistantMessageLength: assistantText.length,
          historyMessageCount: historyToSend.length,
          status: 'success',
          latencyMs: readClientTimestampMs() - startedAt,
        });
        return;
      }

      const nextAnalysis = buildTrendAnalysisRecord(completeAnalysis, currentAnalysis, userPreference);
      nextAnalysis.conversationScopeId = conversationScopeId;
      if (isRecord(payload.conversationSummary)) nextAnalysis.conversationSummary = payload.conversationSummary;
      if (isRecord(payload.memoryMeta)) nextAnalysis.memoryMeta = payload.memoryMeta;
      finalConversationHistory[finalConversationHistory.length - 1] = buildAnalysisConversationMessage(nextAnalysis);
      activeRequestRef.current = '';
      abortControllerRef.current = null;
      pendingAutoScrollRef.current = true;
      setMessages(visibleMessages);
      setConversationHistory(finalConversationHistory);
      setAgentStatus(null);
      setAnalysis(nextAnalysis);
      setIsLoading(false);
      if (currentAnalysis === null) {
        switchViewMode('chat');
      }
      writeStoredTrendingChatState(
        {
          analysis: nextAnalysis,
          messages: visibleMessages,
          conversationHistory: finalConversationHistory,
          conversationScopeId,
          isLoading: false,
          activeRequestId: '',
          agentStatus: null,
        },
        true,
      );
      void trackAnalyticsEvent({
        eventName: 'conversation_turn_completed',
        module: 'trending',
        conversationId,
        requestId,
        taskType: 'trend.track',
        turnIndex,
        userMessageLength: userPreference.length,
        assistantMessageLength: stringifyTrendAnalysis(nextAnalysis).length,
        historyMessageCount: historyToSend.length,
        status: 'success',
        latencyMs: readClientTimestampMs() - startedAt,
      });
    } catch (error) {
      if (activeRequestRef.current !== requestId) return;

      if (error instanceof DOMException && error.name === 'AbortError') {
        activeRequestRef.current = '';
        abortControllerRef.current = null;
        setIsLoading(false);
        const stoppedStatus: AgentStatusState = { kind: 'stopped', message: '本次输出已停止。' };

        if (currentAnalysis === null) {
          setAnalysis(null);
          pendingAutoScrollRef.current = true;
          setMessages(visibleMessages);
          setConversationHistory(historyToSend);
          setAgentStatus(stoppedStatus);
          writeStoredTrendingChatState(
            {
              analysis: null,
              messages: visibleMessages,
              conversationHistory: historyToSend,
              conversationScopeId,
              isLoading: false,
              activeRequestId: '',
              agentStatus: stoppedStatus,
            },
            true,
          );
        } else {
          pendingAutoScrollRef.current = true;
          setMessages(visibleMessages);
          setConversationHistory(historyToSend);
          setAgentStatus(stoppedStatus);
          writeStoredTrendingChatState(
            {
              analysis: currentAnalysis,
              messages: visibleMessages,
              conversationHistory: historyToSend,
              conversationScopeId,
              isLoading: false,
              activeRequestId: '',
              agentStatus: stoppedStatus,
            },
            true,
          );
        }

        showNotice('本次输出已停止。', 'info');
        void trackAnalyticsEvent({
          eventName: 'conversation_turn_failed',
          module: 'trending',
          conversationId,
          requestId,
          taskType: 'trend.track',
          turnIndex,
          userMessageLength: userPreference.length,
          historyMessageCount: historyToSend.length,
          status: 'stopped',
          latencyMs: readClientTimestampMs() - startedAt,
          failureReason: 'aborted',
        });
        return;
      }

      console.error('Agent API error:', error);
      const errorMessage = error instanceof Error ? error.message : '获取趋势失败，请重试';
      activeRequestRef.current = '';
      abortControllerRef.current = null;
      setIsLoading(false);
      showNotice(`错误：${errorMessage}`, 'error');

      const errorStatus: AgentStatusState = { kind: 'error', message: `出错了：${errorMessage}` };
      pendingAutoScrollRef.current = true;
      setMessages(visibleMessages);
      setConversationHistory(historyToSend);
      setAgentStatus(errorStatus);
      writeStoredTrendingChatState(
        {
          analysis: currentAnalysis,
          messages: visibleMessages,
          conversationHistory: historyToSend,
          conversationScopeId,
          isLoading: false,
          activeRequestId: '',
          agentStatus: errorStatus,
        },
        true,
      );
      void trackAnalyticsEvent({
        eventName: 'conversation_turn_failed',
        module: 'trending',
        conversationId,
        requestId,
        taskType: 'trend.track',
        turnIndex,
        userMessageLength: userPreference.length,
        historyMessageCount: historyToSend.length,
        status: 'failed',
        latencyMs: readClientTimestampMs() - startedAt,
        failureReason: errorMessage,
      });
    }
  };

  const retryLastTrendRequest = useCallback(() => {
    if (isLoading || agentStatus?.kind !== 'error') return;
    retryLastTrendRequestRef.current?.();
  }, [agentStatus, isLoading]);

  const handleTopicClick = (topic: string) => {
    const params = new URLSearchParams({
      topic,
      auto: '1',
      autoRequestId: createAutoRequestId(),
      sourceType: 'hot_tracking',
    });
    if (analysis?.id) params.set('trackId', analysis.id);
    if (analysis?.trackName) params.set('trackName', analysis.trackName);
    params.set('topicTitle', topic);
    router.push(`/content?${params.toString()}`);
  };

  const savedRecords = useMemo(
    () => state.trendRecords.map((record) => normalizeTrendRecord(record)),
    [state.trendRecords],
  );

  const displayRecords = savedRecords;

  const saveAnalysisToHistory = async (analysisData: TrendAnalysis, historyOverride?: ConversationMessage[]) => {
    if (isSaving) return;

    setIsSaving(true);
    try {
      const conversationHistoryToSave = trimVisibleConversation(historyOverride || conversationHistory).map((message) => ({
        role: message.role,
        content: message.content,
      }));
      const recordToSave: TrendAnalysis = {
        ...analysisData,
        ...activePersonaUsage,
        conversationScopeId,
        conversationHistory: conversationHistoryToSave,
      };
      const response = await fetch(`${API_BASE}/api/trends/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          record: recordToSave,
        }),
      });

      if (!response.ok) {
        throw new Error('保存失败');
      }
      const json = await readJsonResponse(response);
      if (!isRecord(json) || json.code !== 200) {
        throw new Error('保存失败');
      }

      dispatch({ type: 'ADD_TREND_RECORD', payload: recordToSave });
      setAnalysis(recordToSave);
      setInput('');
      showNotice('保存成功', 'success', true);
      void loadHistory();
    } catch (error) {
      console.error('Failed to save analysis', error);
      showNotice('错误：保存失败，请重试', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const saveTrendMessage = async (message: ConversationMessage) => {
    if (message.analysis) {
      await saveAnalysisToHistory(message.analysis, conversationHistory);
      return;
    }
    await runRealtimeProgressSummary({ saveAfterSummary: true });
  };

  const runRealtimeProgressSummary = async (options?: { saveAfterSummary?: boolean }) => {
    if (isLoading || isSaving || isSummarizingProgress) return;
    if (conversationHistory.length === 0) return;
    if (!isAuthenticated) {
      openUnlockDialog({
        title: '登录后解锁完整功能',
        descriptionLines: ['热门追踪和内容撰写需要基于', '你的人设信息、历史记录和草稿内容生成'],
        redirectTo: '/trending',
      });
      return;
    }

    requestCounterRef.current += 1;
    const requestId = createTrendRequestId('trend-summary', requestCounterRef.current);
    const controller = new AbortController();
    activeRequestRef.current = requestId;
    abortControllerRef.current = controller;
    setIsSummarizingProgress(true);
    setAgentStatus(null);
    showNotice('', 'info');

    const historyToSend = trimVisibleConversation(conversationHistory);
    const visibleMessages = [...messages];

    try {
      const response = await fetch(`${API_BASE}/api/trends/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          preference: `${TREND_REALTIME_SUMMARY_PROMPT}\n如果当前会话后半段已经明显切换到新的热点或新话题，请以最新明确的话题为主，不要重复更早一轮已经完整说过的热点列表。`,
          persona: activePersonaJson,
          conversationScopeId,
          conversationHistory: trimVisibleConversation(historyToSend),
          summarySourceConversation: serializeConversationHistory(historyToSend),
          summaryMode: TREND_REALTIME_SUMMARY_MODE,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await readJsonResponse(response).catch(() => null);
        const message = isRecord(errorData) && typeof errorData.message === 'string' ? errorData.message : '总结失败';
        throw new Error(message);
      }

      const result = await readJsonResponse(response);
      const payload = isRecord(result) && isRecord(result.data) ? result.data : {};
      const completeAnalysis = readCompleteAnalysisPayload(payload);
      if (activeRequestRef.current !== requestId) return;
      if (!completeAnalysis) {
        throw new Error('实时总结未返回完整热门追踪结果');
      }

      const nextAnalysis = buildTrendAnalysisRecord(
        completeAnalysis,
        analysis,
        TREND_REALTIME_SUMMARY_PROMPT,
      );
      nextAnalysis.conversationScopeId = conversationScopeId;
      if (isRecord(payload.conversationSummary)) nextAnalysis.conversationSummary = payload.conversationSummary;
      if (isRecord(payload.memoryMeta)) nextAnalysis.memoryMeta = payload.memoryMeta;
      const nextConversationHistory = historyToSend;

      pendingAutoScrollRef.current = true;
      activeRequestRef.current = '';
      abortControllerRef.current = null;
      setAnalysis(nextAnalysis);
      setMessages(visibleMessages);
      setConversationHistory(nextConversationHistory);
      setAgentStatus(null);
      writeStoredTrendingChatState(
        {
          analysis: nextAnalysis,
          messages: visibleMessages,
          conversationHistory: nextConversationHistory,
          conversationScopeId,
          isLoading: false,
          activeRequestId: '',
          agentStatus: null,
        },
        true,
      );

      if (options?.saveAfterSummary) {
        await saveAnalysisToHistory(nextAnalysis, nextConversationHistory);
      } else {
        showNotice('已更新实时进度总结', 'success', true);
      }
    } catch (error) {
      if (activeRequestRef.current !== requestId) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        activeRequestRef.current = '';
        abortControllerRef.current = null;
        setAgentStatus({ kind: 'stopped', message: 'Agent 总结中断。' });
        writeStoredTrendingChatState(
          {
            analysis,
            messages,
            conversationHistory,
            conversationScopeId,
            isLoading: false,
            activeRequestId: '',
            agentStatus: { kind: 'stopped', message: 'Agent 总结中断。' },
          },
          true,
        );
        showNotice('Agent 总结中断。', 'info');
        return;
      }
      console.error('Realtime progress summary error:', error);
      activeRequestRef.current = '';
      abortControllerRef.current = null;
      setAgentStatus({ kind: 'error', message: `总结失败：${error instanceof Error ? error.message : '实时总结失败，请重试'}` });
      const errorMessage = error instanceof Error ? error.message : '实时总结失败，请重试';
      showNotice(`错误：${errorMessage}`, 'error');
    } finally {
      setIsSummarizingProgress(false);
    }
  };

  const refreshTrendMessage = async (assistantIndex: number) => {
    if (isLoading) return;
    const userIndex = conversationHistory
      .slice(0, assistantIndex)
      .map((message) => message.role)
      .lastIndexOf('user');
    if (userIndex < 0) return;

    const previousUser = conversationHistory[userIndex];
    const historyBeforeAssistant = conversationHistory.slice(0, assistantIndex);
    const visibleBeforeAssistant = historyBeforeAssistant.filter((message) => message.role === 'user').map((message) => message.content);
    const visibleHistoryBeforeAssistant = trimVisibleConversation(historyBeforeAssistant);
    setConversationHistory(visibleHistoryBeforeAssistant);
    setMessages(visibleBeforeAssistant);
    setAgentStatus(null);
    await callTrendAgent(previousUser.content, visibleHistoryBeforeAssistant, visibleBeforeAssistant, analysis);
  };

  useEffect(() => {
    if (viewMode === 'history' && conversationHistory.length === 0) {
      clearConversationId(TRENDING_CONVERSATION_ID_STORAGE_KEY);
    }
  }, [conversationHistory.length, viewMode]);

  const deleteRecord = async (record: TrendAnalysis) => {
    if (!window.confirm('确定要删除这条记录吗？')) return;


    try {
      const response = await fetch(`${API_BASE}/api/trends/record`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(record),
      });

      if (!response.ok) {
        throw new Error('删除失败');
      }
      const json = await readJsonResponse(response);
      if (!isRecord(json) || json.code !== 200) {
        throw new Error('删除失败');
      }

      dispatch({ type: 'DELETE_TREND_RECORD', payload: record });
      // 重新加载历史记录
      await loadHistory();
      showNotice('删除成功', 'success', true);
    } catch (error) {
      console.error('Failed to delete record', error);
      showNotice('错误：删除失败，请重试', 'error');
    }
  };

  if (status === 'loading') {
    return (
      <AuthStateFallback
        title="正在确认登录状态"
        description="正在读取你的账号信息，确认后会继续加载热门追踪页。"
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthStateFallback
        title="正在跳转登录入口"
        description="热门追踪需要登录后使用，正在为你打开登录弹窗并返回首页。"
      />
    );
  }

  return (
      <RequirePersona
        emptyTitle="热门追踪需要先有人设"
        emptyDescription="先完成人设打造并保存，这样热门追踪才能结合你的账号方向、受众和内容风格给出更贴合的结果。"
      >
      <TopToast
        message={notice}
        tone={noticeTone}
      />
      <div className="flex h-full w-full flex-col overflow-hidden px-[4vw] pb-6 pt-7 sm:px-[5.5vw]">
        {viewMode === 'history' ? (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mx-auto mt-8 w-full max-w-[980px] shrink-0 text-center">
            <h1 className="koc-title-font koc-gradient-title text-[30px] leading-tight">Hi，我是你的热点小猪梨</h1>
            <p className="koc-song-font mt-2 text-[22px] leading-tight text-[var(--foreground)]">
              我会结合你的内容方向，追踪近一周热点趋势和受众需求
            </p>
            {activePersonaTitle && (
              <p className="mx-auto mt-3 inline-flex rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.72)] px-4 py-2 text-[14px] text-[var(--foreground)] shadow-[var(--box-shadow)]">
                当前使用人设：{activePersonaTitle}{selectedPersona ? '（手动选择）' : '（默认最新）'}
              </p>
            )}
          </div>

          <form
            onSubmit={handleSubmit}
            className="mx-auto mt-5 flex h-[68px] w-full max-w-[860px] shrink-0 items-center rounded-full border border-[var(--box-border)] bg-[#FFFFFF] px-7 shadow-[var(--box-shadow)]"
          >
            <input
              value={input}
              onChange={(event) => updateInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (isLoading || hasReachedConversationLimit)) {
                  event.preventDefault();
                }
              }}
              placeholder={
                hasReachedConversationLimit
                  ? CONVERSATION_LIMIT_NOTICE
                  : isLoading
                    ? '等待回复中…'
                    : '告诉我你更想关注的内容方向，如：涨粉选题、种草内容、经验分享'
              }
              className="koc-song-font koc-chat-placeholder min-w-0 flex-1 bg-transparent text-[17px] text-[var(--foreground)] outline-none"
              disabled={hasReachedConversationLimit}
            />
            <button
              type={isLoading ? 'button' : 'submit'}
              onClick={isLoading ? requestStop : undefined}
              className="koc-icon-center size-11 text-[29px] text-[var(--foreground)] transition hover:scale-105 disabled:opacity-45"
              aria-label={isLoading ? '停止生成' : '发送'}
              title={isLoading ? '停止生成' : '发送'}
              disabled={(!isLoading && !input.trim()) || hasReachedConversationLimit}
            >
              {isLoading ? <StopGenerationIcon /> : <Image src="/koc-assets/icons/图标/发送.svg" alt="" width={24} height={24} className="size-[24px]" />}
            </button>
          </form>
          {agentStatus && !isLoading && (
            <div className="mx-auto mt-4 w-full max-w-[860px] shrink-0">
              <AgentStatusMessage
                status={agentStatus}
                onRefresh={agentStatus.kind === 'error' ? retryLastTrendRequest : undefined}
                refreshDisabled={isLoading}
              />
            </div>
          )}
          {isLoading && (
            <div className="mx-auto mt-4 w-full max-w-[860px] shrink-0">
              <AgentStatusMessage status={{ kind: 'running', message: '小猪梨灵感加载中...' }} />
            </div>
          )}

          <div className="mx-auto mt-6 flex min-h-0 w-full max-w-[980px] flex-1 flex-col">
            <div className="mb-4">
              <h2 className="koc-heading-font text-[24px] leading-tight text-[var(--foreground)]">热门追踪记录</h2>
              <p className="mt-2 text-[13px] font-semibold leading-5 text-[var(--foreground)]">保存你过往分析过的赛道热点，方便复盘趋势、延续选题</p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-8 pr-3">
              <div className="grid gap-7 md:grid-cols-2">
              {displayRecords.map((record) => {
                const preview = readTrendCardPreview(record);
                return (
                  <div
                    key={record.id || `${record.trackName}-${record.trackTime}-${record.userPrompt}`}
                    className="group relative min-h-[210px] rounded-[22px] border border-[var(--box-border)] bg-[rgba(245,245,245,0.8)] p-5 shadow-[var(--box-shadow)]"
                  >
                    <button
                      type="button"
                      onClick={() => openAnalysis(record, `请继续分析「${record.trackName}」的热点变化、受众需求和下一步选题。`)}
                      className="block h-full w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <h3 className="koc-heading-font text-[18px] leading-tight text-[var(--foreground)]">{record.trackName}</h3>
                      </div>

                      <div className="mt-5 space-y-4 text-[16px] leading-7 text-[var(--foreground)]">
                        <div>
                          <p className="koc-heading-font">本次发现</p>
                          <p className="mt-1 break-words">{preview.discoveryKeywords.join('、') || '暂无关键词'}</p>
                        </div>
                        <div>
                          <p className="koc-heading-font">适合选题</p>
                          <p className="mt-1 break-words">{preview.shortTopics.join('、') || '暂无短选题'}</p>
                        </div>
                        <div>
                          <p className="koc-heading-font">使用人设</p>
                          <p className="mt-1 break-words">{record.personaTitle || '未记录人设'}</p>
                        </div>
                      </div>
                      <p className="koc-heading-font mt-3 text-right text-[18px] text-[var(--foreground)]">{formatRecordDate(record.updatedAt || record.trackTime)}</p>
                    </button>
                    {savedRecords.some((item) => sameTrendRecord(item, record)) && (
                      <button
                        type="button"
                        onClick={() => deleteRecord(record)}
                        className="absolute right-3 top-3 rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.94)] px-2.5 py-1 text-[12px] text-[var(--foreground)] opacity-0 shadow-[var(--box-shadow)] transition hover:bg-[rgba(255,255,255,0.82)] group-hover:opacity-100"
                        title="删除记录"
                      >
                        删除
                      </button>
                    )}
                  </div>
                );
              })}
              </div>
            </div>
          </div>
        </section>
        ) : (
        <section className="relative flex min-h-0 flex-1 flex-col">
          <ScenarioHeader
            subtitle="你的热门追踪小助手~"
            action={
              <button
                type="button"
                onClick={() => {
                  switchViewMode('history');
                  setAnalysis(null);
                  setMessages([]);
                  setConversationHistory([]);
                  setConversationScopeId(createConversationScopeId('trend'));
                  setAgentStatus(null);
                  setIsLoading(false);
                  setNotice('');
                  setNoticeTone('info');
                  activeRequestRef.current = '';
                  abortControllerRef.current?.abort();
                  abortControllerRef.current = null;
                  window.sessionStorage.removeItem(TRENDING_CHAT_STATE_STORAGE_KEY);
                  window.sessionStorage.removeItem(TRENDING_CHAT_SCROLL_TOP_STORAGE_KEY);
                  window.sessionStorage.removeItem(TRENDING_VIEW_MODE_STORAGE_KEY);
                }}
                className="koc-heading-font koc-primary-back-button shrink-0 rounded-full px-5 py-3 text-[18px] text-[var(--foreground)] transition hover:bg-[rgba(255,255,255,0.42)]"
              >
                返回
              </button>
            }
          />

          <div
            ref={chatScrollRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              window.sessionStorage.setItem(TRENDING_CHAT_SCROLL_TOP_STORAGE_KEY, String(el.scrollTop));
              setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
            }}
            className="mx-auto min-h-0 w-full max-w-[980px] flex-1 space-y-4 overflow-y-auto px-5 pb-8 text-[15px] leading-[1.7] text-[var(--foreground)] sm:px-7"
          >
              {conversationHistory.filter((message) => !isLegacyAgentStatusContent(message.content)).map((message, index) => (
                <div key={`${index}-${message.role}-${message.content.slice(0, 24)}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {message.role === 'user' ? (
                    <ChatMessageBubble variant="user" inheritTextColor>
                      <MarkdownText content={message.content} inheritTextColor />
                    </ChatMessageBubble>
                  ) : message.analysis ? (
                    <div className="mr-[12%] w-full max-w-[min(74%,720px)] space-y-3">
                      {(() => {
                        const analysis = message.analysis;
                        return (
                      <ChatMessageBubble variant="assistant" className="space-y-4 p-5 sm:p-6" innerClassName="space-y-4">
                        <section>
                          <h2 className="koc-heading-font text-[22px] leading-tight text-[var(--foreground)]">1.近一周热点趋势</h2>
                          <div className="koc-song-font mt-3 space-y-3">
                            {splitAnalysisText(analysis.trends).map((item, itemIndex) => (
                              <p key={`${analysis.trackName}-trend-${itemIndex}`} className="text-[15px] leading-7 text-[var(--foreground)]">
                                {itemIndex + 1}. {item}
                              </p>
                            ))}
                          </div>
                        </section>

                        <section>
                          <h2 className="koc-heading-font text-[22px] leading-tight text-[var(--foreground)]">2.受众需求洞察</h2>
                          <div className="koc-song-font mt-3 space-y-3">
                            {splitAnalysisText(analysis.audience).map((item, itemIndex) => (
                              <p key={`${analysis.trackName}-audience-${itemIndex}`} className="text-[15px] leading-7 text-[var(--foreground)]">
                                {itemIndex + 1}. {item}
                              </p>
                            ))}
                          </div>
                        </section>

                        <section>
                          <h2 className="koc-heading-font text-[22px] leading-tight text-[var(--foreground)]">3.可执行选题机会</h2>
                          <div className="koc-song-font mt-3 flex flex-col items-start gap-2">
                            {analysis.topics.filter((topic) => topic.length > 0).map((topic) => (
                              <button
                                key={topic}
                                type="button"
                                onClick={() => handleTopicClick(topic)}
                                className="text-left text-[16px] font-medium text-[var(--foreground)] underline underline-offset-4 transition hover:opacity-70"
                              >
                                {topic}
                              </button>
                            ))}
                          </div>
                        </section>
                      </ChatMessageBubble>
                        );
                      })()}
                      {(() => {
                        const analysis = message.analysis;
                        if (!analysis) return null;
                        return (
                          <MessageActions
                            copyEvent={buildTrendingCopyEvent(message, index)}
                            copyText={stringifyTrendAnalysis(analysis)}
                            onRefresh={() => void refreshTrendMessage(index)}
                            onSave={() => void saveTrendMessage(message)}
                            refreshDisabled={isLoading || isSummarizingProgress}
                            saveDisabled={isLoading || isSummarizingProgress}
                            saving={isSaving || isSummarizingProgress}
                          />
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="mr-[12%] w-full max-w-[min(74%,720px)] space-y-3">
                      <ChatMessageBubble variant="assistant">
                        <MarkdownText content={message.content} disableEmphasis plainValidationKeywords />
                      </ChatMessageBubble>
                      <MessageActions
                        copyEvent={buildTrendingCopyEvent(message, index)}
                        copyText={message.content}
                        onRefresh={() => void refreshTrendMessage(index)}
                        onSave={() => void saveTrendMessage(message)}
                        refreshDisabled={isLoading || isSummarizingProgress}
                        saveDisabled={isLoading || isSummarizingProgress}
                        saving={isSaving || isSummarizingProgress}
                      />
                    </div>
                  )}
                </div>
              ))}

              {agentStatus && !isLoading && !isSummarizingProgress && (
                <AgentStatusMessage
                  status={agentStatus}
                  onRefresh={agentStatus.kind === 'error' ? retryLastTrendRequest : undefined}
                  refreshDisabled={isLoading}
                />
              )}
              {isLoading && <AgentStatusMessage status={{ kind: 'running', message: '小猪梨灵感加载中...' }} />}
              {isSummarizingProgress && <AgentStatusMessage status={{ kind: 'running', message: 'Agent 正在总结实时进度...' }} />}
            </div>
          {showScrollDown && (
            <ScrollToBottomButton onClick={scrollChatToBottom} />
          )}

          <ChatInputShell className="relative">
            <div className="pointer-events-none absolute inset-x-0 bottom-full mb-2 flex items-end">
              <button
                type="button"
                onClick={() => void runRealtimeProgressSummary()}
                disabled={isLoading || isSaving || isSummarizingProgress || conversationHistory.length === 0}
                className="pointer-events-auto koc-song-font inline-flex w-fit max-w-full items-center justify-center gap-2 rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.94)] px-4 py-1.5 text-[14px] leading-6 text-[var(--foreground)] shadow-[0_3px_8px_rgba(72,58,50,0.12)] transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isSummarizingProgress ? '总结中…' : '总结实时进度'}
              </button>
            </div>
            <form
              onSubmit={handleSubmit}
              className="koc-chat-input-surface flex h-[72px] w-full items-center rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] px-5 sm:px-7"
            >
              <input
                value={input}
                onChange={(event) => updateInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (isLoading || isSummarizingProgress || hasReachedConversationLimit)) {
                  event.preventDefault();
                }
              }}
              placeholder={
                hasReachedConversationLimit
                  ? CONVERSATION_LIMIT_NOTICE
                  : isSummarizingProgress
                    ? '总结中…'
                    : isLoading
                      ? '等待回复中…'
                      : '输入你的偏好，我会继续帮你筛选选题'
              }
              className="koc-song-font koc-chat-placeholder min-w-0 flex-1 bg-transparent text-[16px] text-[var(--foreground)] outline-none sm:text-[17px]"
              disabled={hasReachedConversationLimit}
            />
            <button
              type={isLoading || isSummarizingProgress ? 'button' : 'submit'}
              onClick={isLoading || isSummarizingProgress ? requestStop : undefined}
              className="koc-icon-center size-11 text-[29px] text-[var(--foreground)] transition hover:scale-105 disabled:opacity-45"
              aria-label={isLoading ? '停止生成' : isSummarizingProgress ? '停止总结' : '发送'}
              title={isLoading ? '停止生成' : isSummarizingProgress ? '停止总结' : '发送'}
              disabled={(!isLoading && !isSummarizingProgress && !input.trim()) || hasReachedConversationLimit}
            >
              {isLoading || isSummarizingProgress ? (
                <StopGenerationIcon />
              ) : (
                <Image src="/koc-assets/icons/图标/发送.svg" alt="" width={24} height={24} className="size-[24px]" />
              )}
            </button>
          </form>
          </ChatInputShell>
        </section>
        )}
      </div>
      </RequirePersona>
  );
}
