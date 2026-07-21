'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Image from 'next/image';
import { API_BASE } from '@/lib/api';
import {
  AGENT_CHAT_ENDPOINT,
  type AgentChatResponse,
  type AgentContentDraftPoint,
  type AgentFlowSummary,
  type AgentFlowSummaryItem,
  type AgentLocalConversation,
  type AgentMessage,
  type AgentStep,
} from '@/lib/agent-chat-contract';
import {
  AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT,
  AGENT_CHAT_CREATE_CONVERSATION_EVENT,
  AGENT_CHAT_SELECT_CONVERSATION_EVENT,
  SIDEBAR_COLLAPSE_EVENT,
  canCreateNextConversation,
  createAndStoreConversation,
  createWelcomeMessage,
  defaultAgentSummary,
  readActiveConversationId,
  readLocalConversations,
  upsertLocalConversation,
} from '@/lib/agent-chat-store';
import LoginButton from '@/components/LoginButton';
import AgentStatusMessage from '@/components/AgentStatusMessage';
import ChatInputShell from '@/components/ChatInputShell';
import ChatMessageBubble from '@/components/ChatMessageBubble';
import MarkdownText from '@/components/MarkdownText';
import ScrollToBottomButton from '@/components/ScrollToBottomButton';
import StopGenerationIcon from '@/components/StopGenerationIcon';
import { useAuth } from '@/context/AuthContext';
import type { AgentStatusState } from '@/lib/agent-status';
import { ANONYMOUS_PERSONA_GENERATED_STORAGE_KEY } from '@/lib/persona';

type FlowSummaryKey = keyof AgentFlowSummary;

const stepOrder: Array<{ key: FlowSummaryKey; step: AgentStep; title: string; hint: string }> = [
  { key: 'persona', step: 'persona', title: '人设打造', hint: '先确定账号定位、目标人群和内容语气。' },
  { key: 'trending', step: 'trending', title: '热门追踪', hint: '围绕当前人设找可追的选题方向。' },
  { key: 'content', step: 'content', title: '内容撰写', hint: '把选题落成标题、正文和发布文案。' },
];

function createUserMessage(content: string): AgentMessage {
  return {
    id: `user_${Date.now()}`,
    role: 'user',
    content,
    created_at: new Date().toISOString(),
  };
}

function createAssistantMessage(content: string): AgentMessage {
  return {
    id: `assistant_${Date.now()}`,
    role: 'assistant',
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

function extractContentTitle(text: string) {
  const normalized = text.trim();
  const explicitTitle = normalized.match(/(?:标题|题目|笔记标题)\s*[:：]\s*([^\n]+)/);
  const markdownTitle = normalized.match(/^#{1,3}\s+(.+)$/m);
  const bracketTitle = normalized.match(/《([^》]+)》/);
  return compactText(explicitTitle?.[1] || markdownTitle?.[1] || bracketTitle?.[1] || normalized, 34);
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
  if (step === 'persona') return '告诉我你想做的账号方向。';
  if (step === 'trending') return '说说你想追的赛道或选题。';
  if (step === 'content') return '发来你想写的主题。';
  return '可以继续微调内容。';
}

function isApprovalText(message: string) {
  return /^(满意|可以|行|好|确认|下一步|继续|进入热门|进入内容|开始写内容|完成)$/i.test(message.trim());
}

function isRefineText(message: string) {
  return /不满意|不行|改一下|再改|继续优化|再完善|不够|换个说法|重新生成/.test(message);
}

function isNewPersonaIntent(message: string) {
  return /新(人设|角色|账号)|重新(做人设|做人设打造|开始)|换(一个)?(人设|角色|账号)|另(一个|外一个)(人设|角色|账号)/.test(message);
}

function detectTopicTag(text: string) {
  if (/美妆|护肤|彩妆|口红|粉底/.test(text)) return 'beauty';
  if (/穿搭|服饰|搭配|衣服|鞋/.test(text)) return 'fashion';
  if (/职场|简历|面试|办公|副业/.test(text)) return 'career';
  if (/学习|考研|英语|考试|备考/.test(text)) return 'study';
  if (/旅行|探店|城市|酒店/.test(text)) return 'travel';
  if (/育儿|亲子|母婴/.test(text)) return 'parenting';
  if (/健身|减脂|运动|瑜伽/.test(text)) return 'fitness';
  return '';
}

function isOffTopicForCurrentPersona(message: string, personaText: string) {
  if (!personaText.trim()) return false;
  if (isNewPersonaIntent(message)) return true;
  if (!/(我想做|想改做|换成|改成|转做|开始做|要做)/.test(message)) return false;
  const personaTag = detectTopicTag(personaText);
  const messageTag = detectTopicTag(message);
  return Boolean(personaTag && messageTag && personaTag !== messageTag);
}

function nextStepAfterApproval(step: AgentStep): AgentStep {
  if (step === 'persona') return 'trending';
  if (step === 'trending') return 'content';
  if (step === 'content') return 'done';
  return step;
}

function approvalMessage(step: AgentStep) {
  if (step === 'persona') return '好，当前人设已确认。接下来我们做热门追踪。';
  if (step === 'trending') return '好，选题方向已确认。接下来进入内容撰写。';
  if (step === 'content') return '好，这版内容已确认。你可以复制文案去发布。';
  return '已确认。';
}

function approvalButtonLabel(step: AgentStep) {
  if (step === 'persona') return '满意，进入热门追踪';
  if (step === 'trending') return '满意，进入内容撰写';
  if (step === 'content') return '满意，完成';
  return '满意';
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
  const summaryText = compactText(item.text, 72);
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
                  key={point.id}
                  type="button"
                  onClick={() => onTrace(point.message_id)}
                  className="block w-full truncate text-left text-[13px] leading-6 text-[var(--muted-text)] transition hover:text-[#2563eb]"
                >
                  {index + 1}. {point.title}
                </button>
              ))}
            </div>
          ) : summaryText ? (
            <button type="button" onClick={() => onTrace(item.message_id)} className="mt-2 block w-full text-left text-[13px] leading-6 text-[var(--muted-text)] transition hover:text-[#2563eb]">
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

  const messages = conversation?.messages ?? [createWelcomeMessage()];
  const summary = conversation?.summary ?? defaultAgentSummary;
  const currentStep = conversation?.current_step ?? 'persona';
  const currentRoleText = compactText(summary.persona.text);
  const shouldShowSummary = messages.length > 1 || summary.persona.done || summary.trending.done || summary.content.done;
  const currentStepKey = currentStep === 'persona' || currentStep === 'trending' || currentStep === 'content' ? currentStep : null;
  const shouldShowApproval =
    Boolean(conversation && currentStepKey && summary[currentStepKey].done && !conversation.phase_approval[currentStepKey] && !loading);
  const isAnonymous = status === 'anonymous';
  const isCheckingAuth = status === 'loading';

  const openGuestLimitDialog = useCallback((title = '登录后解锁完整功能') => {
    openUnlockDialog({
      title,
      descriptionLines: [
        '当前是游客模式。',
        '你可以免费生成一次初版人设：继续追问、保存人设、热门追踪和内容撰写需要登录。',
      ],
      redirectTo: '/',
      closeRedirectTo: '/',
    });
  }, [openUnlockDialog]);

  const persistConversation = useCallback((nextConversation: AgentLocalConversation) => {
    const saved = upsertLocalConversation(nextConversation);
    setConversation(saved);
  }, []);

  const loadConversation = useCallback((localId?: string) => {
    const conversations = readLocalConversations();
    const target = conversations.find((item) => item.local_id === localId) || conversations.find((item) => item.local_id === readActiveConversationId()) || conversations[0];
    if (target) {
      setConversation(target);
      return;
    }
    setConversation(createAndStoreConversation());
  }, []);

  useEffect(() => {
    loadConversation();
    const handleCreate = (event: Event) => loadConversation((event as CustomEvent<{ localId?: string }>).detail?.localId);
    const handleSelect = (event: Event) => loadConversation((event as CustomEvent<{ localId?: string }>).detail?.localId);
    const handleUpdated = () => loadConversation();
    window.addEventListener(AGENT_CHAT_CREATE_CONVERSATION_EVENT, handleCreate);
    window.addEventListener(AGENT_CHAT_SELECT_CONVERSATION_EVENT, handleSelect);
    window.addEventListener(AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT, handleUpdated);
    return () => {
      window.removeEventListener(AGENT_CHAT_CREATE_CONVERSATION_EVENT, handleCreate);
      window.removeEventListener(AGENT_CHAT_SELECT_CONVERSATION_EVENT, handleSelect);
      window.removeEventListener(AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT, handleUpdated);
    };
  }, [loadConversation]);

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

  const approveCurrentStep = () => {
    if (!conversation || !currentStepKey) return;
    if (!isAuthenticated) {
      openGuestLimitDialog('登录后继续下一步');
      return;
    }
    const nextStep = nextStepAfterApproval(currentStep);
    const nextConversation = {
      ...conversation,
      current_step: nextStep,
      phase_approval: {
        ...conversation.phase_approval,
        [currentStepKey]: true,
      },
      messages: [...conversation.messages, createAssistantMessage(approvalMessage(currentStep))],
    };
    persistConversation(nextConversation);
    setAgentStatus(null);
  };

  const continueRefine = () => {
    if (!isAuthenticated && (summary.persona.done || hasUsedAnonymousPersonaTrial())) {
      openGuestLimitDialog('登录后继续追问');
      return;
    }
    setAgentStatus(null);
    setInput('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const sendMessage = async () => {
    const message = input.trim();
    if (!message || loading || !conversation) return;
    if (isCheckingAuth) {
      setAgentStatus({ kind: 'running', message: '正在确认登录状态，请稍等。' });
      return;
    }

    if (isApprovalText(message) && currentStepKey && summary[currentStepKey].done && !isRefineText(message)) {
      setInput('');
      approveCurrentStep();
      return;
    }

    if (!isAuthenticated) {
      if (conversation.current_step !== 'persona' || hasUsedAnonymousPersonaTrial()) {
        openGuestLimitDialog(conversation.current_step === 'persona' ? '登录后继续完善人设' : '登录后解锁完整流程');
        return;
      }
    }

    window.dispatchEvent(new Event(SIDEBAR_COLLAPSE_EVENT));

    const userMessage = createUserMessage(message);
    if (summary.persona.done && isOffTopicForCurrentPersona(message, summary.persona.text)) {
      persistConversation({
        ...conversation,
        messages: [...conversation.messages, userMessage, createAssistantMessage('新角色请新建对话，避免和当前人设混在一起。')],
      });
      setInput('');
      setAgentStatus(null);
      return;
    }

    const nextMessages = [...conversation.messages, userMessage];
    const pendingConversation = {
      ...conversation,
      messages: nextMessages,
    };
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
          conversation_id: conversation.conversation_id,
          message,
          current_step: conversation.current_step,
          selected_persona_id: conversation.selected_persona_id,
          selected_topic_id: conversation.selected_topic_id,
        }),
        signal: controller.signal,
      });
      const data = (await response.json()) as AgentChatResponse & { detail?: string; msg?: string };

      if (!response.ok) {
        setAgentStatus({ kind: 'error', message: data.detail || data.msg || '请求失败，请稍后重试。' });
        return;
      }

      const nextSummary = data.summary;
      const stepKey = conversation.current_step === 'persona' || conversation.current_step === 'trending' || conversation.current_step === 'content'
        ? conversation.current_step
        : null;
      const nextApproval = stepKey
        ? {
            ...conversation.phase_approval,
            [stepKey]: false,
          }
        : conversation.phase_approval;
      const nextContentPoints =
        stepKey === 'content'
          ? [
              ...conversation.content_points,
              {
                id: `content_point_${Date.now()}`,
                title: extractContentTitle(data.assistant_message.content || nextSummary.content.text),
                message_id: data.assistant_message.id,
              },
            ]
          : conversation.content_points;

      if (!isAuthenticated && stepKey === 'persona') {
        markAnonymousPersonaTrialUsed();
      }

      persistConversation({
        ...pendingConversation,
        conversation_id: data.conversation_id,
        title: buildConversationTitle(nextSummary, conversation.title),
        summary: nextSummary,
        selected_persona_id: data.memory_refs.persona_memory_id,
        selected_topic_id: data.memory_refs.trending_memory_id,
        phase_approval: nextApproval,
        content_points: nextContentPoints,
        messages: [...nextMessages, data.assistant_message],
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setAgentStatus({ kind: 'stopped', message: '本次输出已停止。' });
        return;
      }
      setAgentStatus({ kind: 'error', message: '请求失败，请确认服务已启动。' });
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendMessage();
  };

  const handleStop = () => abortControllerRef.current?.abort();

  const handleNewChat = () => {
    if (isCheckingAuth) {
      setAgentStatus({ kind: 'running', message: '正在确认登录状态，请稍等。' });
      return;
    }
    const conversations = readLocalConversations();
    if (!canCreateNextConversation(conversations, conversation?.local_id)) {
      setAgentStatus({ kind: 'error', message: '请先完成当前人设打造，再新建下一个角色对话。' });
      return;
    }
    if (!isAuthenticated && hasUsedAnonymousPersonaTrial()) {
      openGuestLimitDialog('登录后新建更多角色对话');
      return;
    }
    abortControllerRef.current?.abort();
    setInput('');
    setAgentStatus(null);
    setLoading(false);
    setConversation(createAndStoreConversation());
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col px-[4vw] pb-6 pt-7">
      <header className="mb-5 flex shrink-0 items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="koc-heading-font truncate text-[26px] leading-tight text-[var(--foreground)]">顶流小猪梨</h1>
          <p className="mt-1 text-[14px] text-[var(--muted-text)]">你的顶流打造小助手~</p>
        </div>
        <button
          type="button"
          onClick={handleNewChat}
          className="koc-heading-font shrink-0 rounded-full border border-[var(--box-border)] bg-white px-5 py-3 text-[15px] text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-[var(--nav-hover)]"
        >
          新建对话 / 新角色
        </button>
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
        <section className="relative flex min-h-0 flex-col rounded-[20px] border border-[var(--box-border)] bg-white shadow-[var(--box-shadow)]">
          <div
            ref={chatContainerRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
            }}
            className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-6 text-[15px] leading-[1.75] text-[var(--foreground)] sm:px-7"
          >
            {messages.map((message) => (
              <div id={`agent-message-${message.id}`} key={message.id} className={`flex scroll-mt-6 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {message.role === 'user' ? (
                  <ChatMessageBubble variant="user" inheritTextColor>
                    <MarkdownText content={message.content} inheritTextColor />
                  </ChatMessageBubble>
                ) : (
                  <div className="mr-[8%] w-full max-w-[min(82%,760px)]">
                    <ChatMessageBubble variant="assistant">
                      <MarkdownText content={message.content} />
                    </ChatMessageBubble>
                  </div>
                )}
              </div>
            ))}

            {shouldShowApproval && (
              <div className="flex flex-wrap gap-3 pl-1">
                <button
                  type="button"
                  onClick={approveCurrentStep}
                  className="rounded-full bg-[var(--primary)] px-4 py-2 text-[14px] font-semibold text-white shadow-[var(--cta-shadow)] transition hover:bg-[var(--primary-hover)]"
                >
                  {approvalButtonLabel(currentStep)}
                </button>
                <button
                  type="button"
                  onClick={continueRefine}
                  className="rounded-full border border-[var(--box-border)] bg-white px-4 py-2 text-[14px] font-semibold text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-[var(--nav-hover)]"
                >
                  继续完善
                </button>
              </div>
            )}

            {agentStatus && !loading && <AgentStatusMessage status={agentStatus} />}
            {loading && <AgentStatusMessage status={{ kind: 'running', message: 'KOC Agent 正在整理下一步...' }} />}
          </div>

          {showScrollDown && <ScrollToBottomButton onClick={scrollChatToBottom} />}

          <ChatInputShell className="px-5 sm:px-7">
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
                onClick={loading ? handleStop : () => void sendMessage()}
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

        {shouldShowSummary && (
          <aside className="flex min-h-0 flex-col rounded-[20px] border border-[var(--box-border)] bg-white p-5 shadow-[var(--box-shadow)]">
            <div className="shrink-0">
              <p className="koc-heading-font text-[18px] leading-tight text-[var(--foreground)]">流程摘要</p>
              <p className="mt-2 text-[13px] leading-6 text-[var(--muted-text)]">
                {currentRoleText ? `当前对话：${currentRoleText}` : '一个对话只对应一个角色。'}
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
