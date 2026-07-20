'use client';

import { Suspense, useCallback, useMemo, useState, useRef, useEffect, type FormEvent } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { API_BASE, extractTextFromResponse } from '@/lib/api';
import LoginButton from '@/components/LoginButton';
import MarkdownText from '@/components/MarkdownText';
import ScenarioHeader from '@/components/ScenarioHeader';
import AgentStatusMessage from '@/components/AgentStatusMessage';
import ScrollToBottomButton from '@/components/ScrollToBottomButton';
import ChatInputShell from '@/components/ChatInputShell';
import ChatMessageBubble from '@/components/ChatMessageBubble';
import StopGenerationIcon from '@/components/StopGenerationIcon';
import MessageActions from '@/components/MessageActions';
import { useAuth, type AuthUser } from '@/context/AuthContext';
import { readStoredAgentStatus, type AgentStatusState } from '@/lib/agent-status';
import {
  clearConversationId,
  createClientEventId,
  getOrCreateConversationId,
  trackAnalyticsEvent,
  type AgentOutputCopyEvent,
} from '@/lib/analytics';
import {
  CONVERSATION_LIMIT_NOTICE,
  hasReachedConversationHardStop,
} from '@/lib/conversation-memory';

type ChatRole = 'user' | 'assistant';
type HomeAuthStatus = 'loading' | 'authenticated' | 'anonymous';
const LEGACY_HOME_CHAT_STATE_STORAGE_KEY = 'koc-agent-home-chat-state';
const LEGACY_HOME_CHAT_SCROLL_TOP_STORAGE_KEY = 'koc-agent-home-chat-scroll-top';
const HOME_CHAT_STATE_STORAGE_KEY_PREFIX = 'koc-agent-home-chat-state';
const HOME_CHAT_SCROLL_TOP_STORAGE_KEY_PREFIX = 'koc-agent-home-chat-scroll-top';
const HOME_CHAT_GUEST_STORAGE_OWNER = 'guest';
const HOME_CHAT_STATE_UPDATED_EVENT = 'koc-home-chat-state-updated';

interface ChatMessage {
  id: number;
  role: ChatRole;
  content: string;
}

interface StoredHomeChatState {
  chatHistory: ChatMessage[];
  loading: boolean;
  agentStatus?: AgentStatusState | null;
  activeRequestId?: string;
}

interface HomeChatStorageKeys {
  state: string;
  scrollTop: string;
}

const DIALOG_CONVERSATION_ID_STORAGE_KEY = 'koc-analytics-dialog-conversation-id';
let homeChatRuntime: { requestId: string; controller: AbortController } | null = null;
const cancelledHomeChatRequestIds = new Set<string>();

function buildDialogCopyEvent(message: ChatMessage, index: number): AgentOutputCopyEvent {
  return {
    eventName: 'agent_output_copy',
    module: 'dialog',
    conversationId: getOrCreateConversationId(DIALOG_CONVERSATION_ID_STORAGE_KEY),
    messageId: `dialog-message-${message.id}`,
    messageIndex: index,
    messageRole: 'assistant',
    contentLength: message.content.length,
    copySource: 'message_action_button',
  };
}

function getHomeChatStorageOwner(status: HomeAuthStatus, user: AuthUser | null) {
  if (status === 'loading') return null;
  if (status !== 'authenticated') return HOME_CHAT_GUEST_STORAGE_OWNER;

  const userIdentifier = user?.id || user?.email || user?.name;
  return userIdentifier ? `user:${userIdentifier}` : HOME_CHAT_GUEST_STORAGE_OWNER;
}

function buildHomeChatStorageKeys(owner: string): HomeChatStorageKeys {
  const encodedOwner = encodeURIComponent(owner);
  return {
    state: `${HOME_CHAT_STATE_STORAGE_KEY_PREFIX}:${encodedOwner}`,
    scrollTop: `${HOME_CHAT_SCROLL_TOP_STORAGE_KEY_PREFIX}:${encodedOwner}`,
  };
}

function clearLegacyHomeChatStorageKeys() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(LEGACY_HOME_CHAT_STATE_STORAGE_KEY);
  window.localStorage.removeItem(LEGACY_HOME_CHAT_SCROLL_TOP_STORAGE_KEY);
}

function readStoredHomeChatState(storageKeys: HomeChatStorageKeys): StoredHomeChatState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKeys.state);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredHomeChatState>;
    if (!Array.isArray(parsed.chatHistory)) return null;

    const chatHistory = parsed.chatHistory.filter(
      (message): message is ChatMessage =>
        typeof message?.id === 'number' &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string',
    );
    if (chatHistory.length === 0) return null;
    const activeRequestId = typeof parsed.activeRequestId === 'string' ? parsed.activeRequestId : '';
    const isActiveRuntime = Boolean(
      parsed.loading &&
        activeRequestId &&
        homeChatRuntime &&
        homeChatRuntime.requestId === activeRequestId,
    );

    return {
      chatHistory,
      loading: isActiveRuntime,
      agentStatus: parsed.loading && !isActiveRuntime
        ? { kind: 'stopped', message: '上次输出已中断。' }
        : readStoredAgentStatus(parsed.agentStatus),
      activeRequestId: isActiveRuntime ? activeRequestId : '',
    };
  } catch {
    return null;
  }
}

function writeStoredHomeChatState(storageKeys: HomeChatStorageKeys, state: StoredHomeChatState, notify = false) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKeys.state, JSON.stringify(state));
  if (notify) {
    window.dispatchEvent(new Event(HOME_CHAT_STATE_UPDATED_EVENT));
  }
}

function clearStoredHomeChatState(storageKeys: HomeChatStorageKeys, notify = false) {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKeys.state);
  window.localStorage.removeItem(storageKeys.scrollTop);
  if (notify) {
    window.dispatchEvent(new Event(HOME_CHAT_STATE_UPDATED_EVENT));
  }
}

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [input, setInput] = useState('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatusState | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [loadedHomeChatStorageOwner, setLoadedHomeChatStorageOwner] = useState<string | null>(null);
  const conversationLimitToastShownRef = useRef(false);
  const { status, user, isAuthenticated } = useAuth();
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pendingRestoreScrollRef = useRef(false);
  const pendingAutoScrollRef = useRef(false);
  const suppressNextAbortStatusRef = useRef(false);
  const hasReachedConversationLimit = hasReachedConversationHardStop(chatHistory);

  const isDialogPage = searchParams.get('view') === 'dialog';
  const homeChatStorageOwner = useMemo(() => getHomeChatStorageOwner(status, user), [status, user]);
  const homeChatStorageKeys = useMemo(
    () => (homeChatStorageOwner ? buildHomeChatStorageKeys(homeChatStorageOwner) : null),
    [homeChatStorageOwner],
  );

  const introCopy = useMemo(() => {
    if (!isDialogPage) {
      return {
        title: '欢迎来到顶流养成计划～',
        lines: ['点击左边栏开启互联网之旅', '未使用过本猪梨的小宝请先点击人设打造'],
      };
    }
    return {
      title: '欢迎来到顶流养成计划～\n我是你的小猪梨',
      lines: ['这里是临时对话框', '可用于临时资料查询，仅保留最近一次对话历史～'],
    };
  }, [isDialogPage]);

  const showCenteredHomeLayout = !isDialogPage && chatHistory.length === 0;
  const showDialogLandingLayout = isDialogPage && chatHistory.length === 0;

  useEffect(() => {
    if (isDialogPage) {
      router.replace('/manual');
    }
  }, [isDialogPage, router]);

  const applyStoredChatState = useCallback((restoreScroll = false) => {
    if (!homeChatStorageKeys) return;
    const storedChatState = readStoredHomeChatState(homeChatStorageKeys);
    if (!storedChatState) return;
    pendingRestoreScrollRef.current = restoreScroll;
    setChatHistory(storedChatState.chatHistory);
    setLoading(storedChatState.loading);
    setAgentStatus(storedChatState.agentStatus ?? null);
  }, [homeChatStorageKeys]);

  useEffect(() => {
    if (!isDialogPage || !homeChatStorageKeys || !homeChatStorageOwner) return;
    if (homeChatRuntime?.requestId) {
      cancelledHomeChatRequestIds.add(homeChatRuntime.requestId);
    }
    (homeChatRuntime?.controller || abortControllerRef.current)?.abort();
    homeChatRuntime = null;
    abortControllerRef.current = null;
    pendingAutoScrollRef.current = false;
    pendingRestoreScrollRef.current = false;
    clearLegacyHomeChatStorageKeys();
    const timer = window.setTimeout(() => {
      setLoadedHomeChatStorageOwner(null);
      setInput('');
      setChatHistory([]);
      setLoading(false);
      setAgentStatus(null);
      setShowScrollDown(false);
      applyStoredChatState(true);
      setLoadedHomeChatStorageOwner(homeChatStorageOwner);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [applyStoredChatState, homeChatStorageKeys, homeChatStorageOwner, isDialogPage]);

  useEffect(() => {
    if (!isDialogPage) return;
    const handleUpdate = () => applyStoredChatState(false);
    window.addEventListener(HOME_CHAT_STATE_UPDATED_EVENT, handleUpdate);
    return () => window.removeEventListener(HOME_CHAT_STATE_UPDATED_EVENT, handleUpdate);
  }, [applyStoredChatState, isDialogPage]);

  useEffect(() => {
    if (!isDialogPage || !homeChatStorageKeys || loadedHomeChatStorageOwner !== homeChatStorageOwner) return;
    if (chatHistory.length === 0 && !loading && !agentStatus) return;
    writeStoredHomeChatState(homeChatStorageKeys, {
      chatHistory,
      loading,
      agentStatus,
      activeRequestId: loading ? homeChatRuntime?.requestId || '' : '',
    });
  }, [agentStatus, chatHistory, homeChatStorageKeys, homeChatStorageOwner, isDialogPage, loadedHomeChatStorageOwner, loading]);

  useEffect(() => {
    if (!isDialogPage) return;
    if (!hasReachedConversationLimit) {
      conversationLimitToastShownRef.current = false;
      return;
    }
    if (conversationLimitToastShownRef.current) return;
    conversationLimitToastShownRef.current = true;
    setAgentStatus({ kind: 'error', message: CONVERSATION_LIMIT_NOTICE });
  }, [hasReachedConversationLimit, isDialogPage]);

  const handleSend = async () => {
    const question = input.trim();
    const storageKeys = homeChatStorageKeys;
    if (!question || loading || !storageKeys || loadedHomeChatStorageOwner !== homeChatStorageOwner) return;
    if (hasReachedConversationHardStop(chatHistory)) {
      setAgentStatus({ kind: 'error', message: CONVERSATION_LIMIT_NOTICE });
      return;
    }
    suppressNextAbortStatusRef.current = false;

    const conversationId = getOrCreateConversationId(DIALOG_CONVERSATION_ID_STORAGE_KEY);
    const requestId = createClientEventId('dialog-turn');
    const startedAt = Date.now();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    homeChatRuntime = { requestId, controller };
    const userMessage: ChatMessage = {
      id: Date.now(),
      role: 'user',
      content: question,
    };
    const nextHistory = [...chatHistory, userMessage];
    pendingAutoScrollRef.current = true;
    setChatHistory(nextHistory);
    setInput('');
    setLoading(true);
    setAgentStatus(null);
    writeStoredHomeChatState(
      storageKeys,
      {
        chatHistory: nextHistory,
        loading: true,
        agentStatus: null,
        activeRequestId: requestId,
      },
      true,
    );
    void trackAnalyticsEvent({
      eventName: 'conversation_turn_started',
      module: 'dialog',
      conversationId,
      requestId,
      taskType: 'general.chat',
      turnIndex: nextHistory.filter((message) => message.role === 'user').length,
      userMessageLength: question.length,
      historyMessageCount: Math.max(nextHistory.length - 1, 0),
      status: 'started',
    });
    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: question,
          conversationHistory: nextHistory.map((chat) => ({
            role: chat.role,
            content: chat.content,
          })),
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) {
        if (cancelledHomeChatRequestIds.has(requestId)) return;
        const errorStatus: AgentStatusState = { kind: 'error', message: data.detail || data.msg || '请求失败' };
        setAgentStatus(errorStatus);
        writeStoredHomeChatState(
          storageKeys,
          {
            chatHistory: nextHistory,
            loading: false,
            agentStatus: errorStatus,
            activeRequestId: '',
          },
          true,
        );
        return;
      }
      const assistantMessage: ChatMessage = {
        id: Date.now() + 1,
        role: 'assistant',
        content: extractTextFromResponse(data.data || data),
      };
      if (cancelledHomeChatRequestIds.has(requestId)) return;
      const finalHistory = [...nextHistory, assistantMessage];
      pendingAutoScrollRef.current = true;
      setChatHistory(finalHistory);
      setAgentStatus(null);
      writeStoredHomeChatState(
        storageKeys,
        {
          chatHistory: finalHistory,
          loading: false,
          agentStatus: null,
          activeRequestId: '',
        },
        true,
      );
      void trackAnalyticsEvent({
        eventName: 'conversation_turn_completed',
        module: 'dialog',
        conversationId,
        requestId,
        taskType: 'general.chat',
        turnIndex: nextHistory.filter((message) => message.role === 'user').length,
        userMessageLength: question.length,
        assistantMessageLength: assistantMessage.content.length,
        historyMessageCount: nextHistory.length,
        status: 'success',
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (suppressNextAbortStatusRef.current || cancelledHomeChatRequestIds.has(requestId)) {
          suppressNextAbortStatusRef.current = false;
          return;
        }
        const stoppedStatus: AgentStatusState = { kind: 'stopped', message: '本次输出已停止。' };
        setAgentStatus(stoppedStatus);
        writeStoredHomeChatState(
          storageKeys,
          {
            chatHistory: nextHistory,
            loading: false,
            agentStatus: stoppedStatus,
            activeRequestId: '',
          },
          true,
        );
        void trackAnalyticsEvent({
          eventName: 'conversation_turn_failed',
          module: 'dialog',
          conversationId,
          requestId,
          taskType: 'general.chat',
          turnIndex: nextHistory.filter((message) => message.role === 'user').length,
          userMessageLength: question.length,
          historyMessageCount: nextHistory.length,
          status: 'stopped',
          latencyMs: Date.now() - startedAt,
          failureReason: 'aborted',
        });
        return;
      }
      const errorStatus: AgentStatusState = { kind: 'error', message: '请求失败，请确认后端服务已启动。' };
      setAgentStatus(errorStatus);
      writeStoredHomeChatState(
        storageKeys,
        {
          chatHistory: nextHistory,
          loading: false,
          agentStatus: errorStatus,
          activeRequestId: '',
        },
        true,
      );
      void trackAnalyticsEvent({
        eventName: 'conversation_turn_failed',
        module: 'dialog',
        conversationId,
        requestId,
        taskType: 'general.chat',
        turnIndex: nextHistory.filter((message) => message.role === 'user').length,
        userMessageLength: question.length,
        historyMessageCount: nextHistory.length,
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        failureReason: error instanceof Error ? error.message : 'request_failed',
      });
    } finally {
      cancelledHomeChatRequestIds.delete(requestId);
      if (homeChatRuntime?.requestId === requestId) {
        homeChatRuntime = null;
      }
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    void handleSend();
  };

  const handleStop = () => {
    (homeChatRuntime?.controller || abortControllerRef.current)?.abort();
  };

  useEffect(() => {
    if (chatHistory.length === 0) {
      clearConversationId(DIALOG_CONVERSATION_ID_STORAGE_KEY);
    }
  }, [chatHistory.length]);

  useEffect(() => {
    if (!isDialogPage || !pendingAutoScrollRef.current) return;
    pendingAutoScrollRef.current = false;
    const container = chatContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    setShowScrollDown(false);
  }, [chatHistory, isDialogPage, loading]);

  useEffect(() => {
    if (!isDialogPage || chatHistory.length === 0 || !pendingRestoreScrollRef.current || pendingAutoScrollRef.current) return;
    pendingRestoreScrollRef.current = false;
    const timer = window.setTimeout(() => {
      const container = chatContainerRef.current;
      if (!container) return;
      if (!homeChatStorageKeys) return;
      const savedTop = Number(window.localStorage.getItem(homeChatStorageKeys.scrollTop) || 0);
      container.scrollTop = Number.isFinite(savedTop) ? savedTop : 0;
      setShowScrollDown(container.scrollHeight - container.scrollTop - container.clientHeight > 160);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [chatHistory, homeChatStorageKeys, isDialogPage, loading]);

  const scrollChatToBottom = () => {
    const container = chatContainerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    setShowScrollDown(false);
  };

  const handleNewChat = () => {
    suppressNextAbortStatusRef.current = true;
    if (homeChatRuntime?.requestId) {
      cancelledHomeChatRequestIds.add(homeChatRuntime.requestId);
    }
    (homeChatRuntime?.controller || abortControllerRef.current)?.abort();
    homeChatRuntime = null;
    abortControllerRef.current = null;
    pendingAutoScrollRef.current = false;
    pendingRestoreScrollRef.current = false;
    setInput('');
    setChatHistory([]);
    setLoading(false);
    setAgentStatus(null);
    setShowScrollDown(false);
    if (homeChatStorageKeys) {
      clearStoredHomeChatState(homeChatStorageKeys, true);
    }
    clearConversationId(DIALOG_CONVERSATION_ID_STORAGE_KEY);
    if (!isDialogPage) {
      router.push('/manual');
    }
  };

  if (isDialogPage) {
    return null;
  }

  const chatHeaderAction = (
    <div className="flex shrink-0 flex-wrap items-center gap-3 self-start sm:self-center sm:justify-end">
      <button
        type="button"
        onClick={handleNewChat}
        className="koc-heading-font koc-primary-back-button shrink-0 rounded-full px-5 py-3 text-[18px] text-[var(--foreground)] transition hover:bg-[rgba(255,255,255,0.42)]"
      >
        新建
      </button>
      {!isAuthenticated && <LoginButton className="inline-flex shrink-0" />}
    </div>
  );

  const showFloatingLoginButton = !isAuthenticated && !(isDialogPage && chatHistory.length > 0);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden px-[5.5vw] pb-7 pt-7">
      {showFloatingLoginButton && (
        <div className="mb-2 flex w-full shrink-0 justify-end">
          <LoginButton />
        </div>
      )}
      <section className={`flex min-h-0 flex-1 flex-col ${chatHistory.length > 0 && isDialogPage ? '' : 'items-center'}`}>
        <div
          className={`w-full ${
            chatHistory.length > 0 && isDialogPage
              ? 'mx-auto flex min-h-0 max-w-[980px] flex-1 flex-col'
              : showDialogLandingLayout
                ? 'mx-auto flex min-h-full max-w-[1320px] flex-1 flex-col'
                : showCenteredHomeLayout
                  ? 'relative flex min-h-full max-w-[1320px] flex-1 flex-col items-center justify-center'
                  : 'flex min-h-full max-w-[1200px] flex-1 flex-col items-center justify-between py-[8vh]'
          }`}
        >
          {chatHistory.length > 0 && isDialogPage ? (
            <section className="relative flex min-h-0 flex-1 flex-col">
              <ScenarioHeader
                title="灵光小猪梨"
                subtitle="支持临时灵感记录、资料追问和多轮上下文延续"
                action={chatHeaderAction}
              />

              <div
                ref={chatContainerRef}
                onScroll={(event) => {
                  const el = event.currentTarget;
                  if (homeChatStorageKeys) {
                    window.localStorage.setItem(homeChatStorageKeys.scrollTop, String(el.scrollTop));
                  }
                  setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
                }}
                className="mx-auto min-h-0 w-full max-w-[980px] flex-1 space-y-4 overflow-y-auto px-5 pb-8 text-[15px] leading-[1.7] text-[var(--foreground)] sm:px-7"
              >
                {chatHistory.map((chat, index) => (
                  <div key={chat.id} className={`flex ${chat.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {chat.role === 'user' ? (
                      <ChatMessageBubble variant="user" inheritTextColor>
                        <MarkdownText content={chat.content} inheritTextColor />
                      </ChatMessageBubble>
                    ) : (
                      <div className="mr-[12%] w-full max-w-[min(74%,720px)] space-y-3">
                        <ChatMessageBubble variant="assistant">
                          <MarkdownText content={chat.content} />
                        </ChatMessageBubble>
                        <MessageActions
                          copyEvent={buildDialogCopyEvent(chat, index)}
                          copyText={chat.content}
                        />
                      </div>
                    )}
                  </div>
                ))}
                {agentStatus && !loading && <AgentStatusMessage status={agentStatus} />}
                {loading && <AgentStatusMessage status={{ kind: 'running', message: '小猪梨灵感加载中...' }} />}
              </div>
              {showScrollDown && (
                <ScrollToBottomButton onClick={scrollChatToBottom} />
              )}

              <ChatInputShell>
                <form
                  onSubmit={handleSubmit}
                  className="koc-chat-input-surface flex h-[72px] items-center rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] px-5 sm:px-7"
                >
                  <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && loading) {
                        event.preventDefault();
                      }
                    }}
                    placeholder={hasReachedConversationLimit ? CONVERSATION_LIMIT_NOTICE : loading ? '等待回复中…' : '可输入你的灵光一闪'}
                    className="koc-song-font koc-chat-placeholder min-w-0 flex-1 bg-transparent text-[16px] text-[var(--foreground)] outline-none sm:text-[17px]"
                    disabled={hasReachedConversationLimit}
                  />
                  <button
                    type="button"
                    onClick={loading ? handleStop : () => void handleSend()}
                    disabled={(!loading && !input.trim()) || hasReachedConversationLimit}
                    className="grid size-11 place-items-center text-[29px] text-[var(--foreground)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45"
                    aria-label={loading ? '停止生成' : '发送'}
                    title={loading ? '停止生成' : '发送'}
                    >
                      {loading ? <StopGenerationIcon /> : <Image src="/koc-assets/icons/图标/发送.svg" alt="" width={24} height={24} className="size-[24px]" />}
                    </button>
                </form>
              </ChatInputShell>
            </section>
          ) : showDialogLandingLayout ? (
            <section className="relative flex min-h-full flex-1 flex-col">
              <div className="absolute left-1/2 top-[44%] w-full max-w-[1100px] -translate-x-1/2 -translate-y-1/2 text-center">
                <h1 className="koc-title-font whitespace-pre-line text-[78px] leading-[0.94] text-[var(--title-blue)]">
                  {introCopy.title}
                </h1>
              </div>

              <div className="absolute bottom-[6vh] left-1/2 w-full max-w-[980px] -translate-x-1/2">
                <div className="koc-song-font mb-7 space-y-3 text-center text-[29px] leading-[1.5] text-[var(--foreground)]">
                  {introCopy.lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>

                <ChatInputShell className="w-full" compact>
                  <form
                    onSubmit={handleSubmit}
                    className="koc-chat-input-surface flex h-[72px] w-full items-center rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] px-7"
                  >
                    <input
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && loading) {
                        event.preventDefault();
                      }
                    }}
                    placeholder={hasReachedConversationLimit ? CONVERSATION_LIMIT_NOTICE : loading ? '等待回复中…' : '可输入你的灵光一闪'}
                    className="koc-song-font koc-chat-placeholder min-w-0 flex-1 bg-transparent text-[16px] text-[var(--foreground)] outline-none sm:text-[17px]"
                    disabled={hasReachedConversationLimit}
                    />
                    <button
                      type="button"
                      onClick={loading ? handleStop : () => void handleSend()}
                      disabled={(!loading && !input.trim()) || hasReachedConversationLimit}
                      className="grid size-11 place-items-center text-[29px] text-[var(--foreground)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45"
                      aria-label={loading ? '停止生成' : '发送'}
                      title={loading ? '停止生成' : '发送'}
                    >
                      {loading ? <StopGenerationIcon /> : <Image src="/koc-assets/icons/图标/发送.svg" alt="" width={24} height={24} className="size-[24px]" />}
                    </button>
                  </form>
                  {agentStatus && !loading && (
                    <div className="mt-4 flex justify-center">
                      <AgentStatusMessage status={agentStatus} />
                    </div>
                  )}
                </ChatInputShell>
              </div>
            </section>
          ) : (
            <>
              <div
                className={`${
                  showCenteredHomeLayout
                      ? 'relative min-h-full w-full flex-1'
                      : ''
                }`}
              >
                <h1
                  className={`koc-title-font ${
                    showCenteredHomeLayout ? 'absolute left-1/2 top-[44%] w-full max-w-[1100px] -translate-x-1/2 -translate-y-1/2 whitespace-pre-line text-[78px] leading-[0.96]' : 'whitespace-pre-line text-[38px]'
                  } text-center text-[var(--title-blue)]`}
                >
                  {`${introCopy.title}\n我是你的小猪梨`}
                </h1>
                <div
                  className={`${
                    showCenteredHomeLayout
                        ? 'koc-song-font absolute bottom-[7vh] left-1/2 w-full max-w-[1100px] -translate-x-1/2 text-center text-[26px] leading-[1.55]'
                        : 'koc-song-font mt-auto text-center text-[28px] leading-[1.55]'
                  } space-y-3 text-[var(--foreground)]`}
                >
                  {introCopy.lines.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
