'use client';

import Image from 'next/image';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatDraftSourceLabel, useAppState, type DraftItem, type DraftSource } from '@/context/AppStateContext';
import { API_BASE, isRecord, readJsonResponse } from '@/lib/api';
import {
  CHAT_INPUT_MAX_CHARS,
  countTextChars,
  CONVERSATION_LIMIT_NOTICE,
  hasReachedConversationHardStop,
  limitTextChars,
  trimVisibleConversation,
} from '@/lib/conversation-memory';
import { buildVisibleInitialContentMessage } from '@/lib/initial-agent-prompts';
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
  readStoredAgentStatus,
  splitTrailingLegacyAgentStatus,
  type AgentStatusState,
} from '@/lib/agent-status';
import { hasUnsavedDraftChanges } from '@/lib/draft-change';
import {
  clearConversationId,
  createClientEventId,
  getOrCreateConversationId,
  trackAnalyticsEvent,
  type AgentOutputCopyEvent,
} from '@/lib/analytics';
import { createConversationScopeId } from '@/lib/conversation-scope';
import { getPersonaDisplayTitle, readSelectedPersona, type SelectedPersona } from '@/lib/persona';

type ViewMode = 'drafts' | 'chat';

const ACTIVE_DRAFT_STORAGE_KEY = 'koc-agent-active-draft-id';
const CONTENT_VIEW_MODE_STORAGE_KEY = 'koc-agent-content-view-mode';
const CONTENT_CHAT_STATE_STORAGE_KEY = 'koc-agent-content-chat-state';
const CONTENT_CHAT_SCROLL_TOP_STORAGE_KEY = 'koc-agent-content-chat-scroll-top';
const CONTENT_CONVERSATION_ID_STORAGE_KEY = 'koc-analytics-content-conversation-id';
const XHS_TITLE_MAX_CHARS = 20;

interface StructuredDraft {
  noteTitle: string;
  titleOptions?: string[];
  hook: string;
  body: string[];
  ending: string;
  tags: string[];
  coverSuggestion?: {
    mainText?: string;
    layout?: string;
    visualStyle?: string;
  };
  imageTextStructure?: string[];
  cardPreview?: {
    keywords: string[];
  };
}

interface RevisionSuggestion {
  label: string;
  instruction: string;
  intent: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  draft?: StructuredDraft;
  suggestions?: RevisionSuggestion[];
  canSave?: boolean;
}

type NoticeTone = 'success' | 'error' | 'info';

type WritingEntrySource = DraftSource;

interface StoredContentChatState {
  activeDraft: DraftItem | null;
  activeTopic: string;
  conversationHistory: ConversationMessage[];
  conversationScopeId: string;
  saveStatus: string;
  isAgentLoading: boolean;
  activeRequestId: string;
  agentStatus?: AgentStatusState | null;
}

function buildTopicEnding(topic: string) {
  const trimmedTopic = topic.trim() || '这个主题';
  return `如果你也在关注${trimmedTopic}，可以先挑一个最容易执行的小动作开始。你遇到的具体情况也可以留言，我会继续按这个方向补充。`;
}

function buildStructuredDraft(topic: string, instruction = ''): StructuredDraft {
  const trimmedTopic = topic.trim() || '大学生考证规划';
  const wantsTitle = instruction.includes('标题') || instruction.includes('吸引');
  const wantsLife = instruction.includes('生活化') || instruction.includes('口语');
  const primaryTitle = limitXhsTitle(wantsTitle ? `别再盲目开始了！${trimmedTopic}先看这一篇` : `${trimmedTopic}：新手也能直接照做的规划`);

  return {
    noteTitle: primaryTitle,
    titleOptions: uniqueShortPhrases([
      primaryTitle,
      `${trimmedTopic}新手先这样做`,
      `我把${trimmedTopic}拆简单了`,
    ]).map(limitXhsTitle),
    hook: wantsLife
      ? `如果你也经常想开始，但一打开资料就不知道从哪下手，这篇就是给你看的。`
      : `很多人不是不努力，而是一开始就把路径想复杂了。先把方向拆清楚，执行会轻松很多。`,
    body: [
      `第一步，先明确你的目标和时间。不要一上来就囤资料，先判断这件事和你的人设定位、当前阶段是否匹配。`,
      `第二步，把任务拆成每周能完成的小动作。比如查资料、列清单、做一次复盘，比空喊自律更容易坚持。`,
      `第三步，保留真实体验和踩坑记录。小红书用户更愿意收藏具体、低成本、能照做的内容。`,
    ],
    ending: buildTopicEnding(trimmedTopic),
    tags: ['小红书运营', '大学生成长', '内容创作', '经验分享', trimmedTopic.replace(/\s/g, '')],
    coverSuggestion: {
      mainText: `${trimmedTopic}先看这篇`,
      layout: '封面放一句最直接的收获，配一张真实场景图，不要堆太多字。',
      visualStyle: '干净、生活化、像随手记录的图文笔记。',
    },
    imageTextStructure: [
      `图1：封面，突出“${trimmedTopic}先看这篇”。`,
      '图2：真实场景或当前状态，让读者知道这不是空泛建议。',
      '图3：把正文里最重要的步骤做成清单图。',
    ],
    cardPreview: {
      keywords: uniqueShortPhrases([trimmedTopic, instruction, '内容创作', '经验分享']),
    },
  };
}

function rewriteEndingIfNeeded(ending: string, topic: string, instruction: string) {
  const isMetaEnding =
    ending.includes('优化标题') ||
    ending.includes('选题、开头') ||
    ending.includes('正文结构') ||
    ending.includes('标题、正文') ||
    ending.includes('正文还是互动结尾') ||
    ending.includes('继续帮你改') ||
    ending.includes('帮你优化') ||
    ending.includes('内容撰写');

  if (!isMetaEnding) return ending;

  return buildTopicEnding(topic || instruction);
}

function normalizeShortPhrase(value: string) {
  const cleaned = value
    .replace(/^[#\s]+/, '')
    .replace(/[。.!?！？].*$/, '')
    .replace(/[：:；;，,].*$/, '')
    .replace(/(大学生|小红书|如何|怎么|教程|方法|真的|第一次|这?几个|这?些|一篇|不要|别再)/g, '')
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

function limitXhsTitle(value: string) {
  return Array.from(cleanMarkdownText(value)).slice(0, XHS_TITLE_MAX_CHARS).join('').trim();
}

function readDraftCardPreviewValue(value: unknown) {
  const preview = isRecord(value) ? value : {};
  const keywords = Array.isArray(preview.keywords)
    ? preview.keywords.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 3)
    : [];
  return keywords.length > 0 ? { keywords } : undefined;
}

function readStringList(value: unknown, limit = 5) {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => cleanMarkdownText(item))
      .filter(Boolean)
      .slice(0, limit);
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
  return mainText || layout || visualStyle
    ? {
        ...(mainText ? { mainText } : {}),
        ...(layout ? { layout } : {}),
        ...(visualStyle ? { visualStyle } : {}),
      }
    : undefined;
}

function stringifyDraft(draft: StructuredDraft) {
  const coverLines = draft.coverSuggestion
    ? [
        draft.coverSuggestion.mainText ? `封面文字：${draft.coverSuggestion.mainText}` : '',
        draft.coverSuggestion.layout ? `封面排版：${draft.coverSuggestion.layout}` : '',
        draft.coverSuggestion.visualStyle ? `封面风格：${draft.coverSuggestion.visualStyle}` : '',
      ]
    : [];
  return [
    draft.noteTitle,
    ...(draft.titleOptions?.length ? [`标题备选：${draft.titleOptions.join(' / ')}`] : []),
    ...coverLines,
    draft.hook,
    ...draft.body,
    ...(draft.imageTextStructure?.length ? ['图片顺序：', ...draft.imageTextStructure] : []),
    draft.ending,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n');
}

function normalizeBoldSpacing(value: string) {
  return value.replace(/\*\*\s*([^*\n]+?)\s*\*\*/g, (_match, inner: string) => `**${inner.trim()}**`);
}

function cleanMarkdownText(value: string) {
  return normalizeBoldSpacing(value)
    .replace(/^\s*[-+•]\s*$/gm, '')
    .replace(/^(\s*[-+])(?![-+\s])(?=\S)/gm, '$1 ')
    .replace(/^(\s*\d{1,2}[.)])(?!\s)(?=\S)/gm, '$1 ')
    .trim();
}

function cleanPublishText(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/```+/g, '')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
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
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function normalizePublishTag(value: string) {
  const tag = cleanPublishText(value)
    .replace(/^#/, '')
    .replace(/[：:；;，,。.!?！？\s#]+/g, '')
    .trim();
  return tag ? `#${tag}` : '';
}

function buildXhsPublishCopyText(draft: StructuredDraft) {
  const tagsText = Array.from(new Set(draft.tags.map(normalizePublishTag).filter(Boolean))).join(' ');
  const sections = [
    limitXhsTitle(draft.noteTitle),
    cleanPublishText(draft.hook),
    ...draft.body.map(cleanPublishText),
    cleanPublishText(draft.ending),
    tagsText,
  ];

  return sections.filter(Boolean).join('\n\n');
}

function normalizeTagToken(value: string) {
  return value.replace(/^#/, '').replace(/[：:；;，,。.!?！？\s]+/g, '').trim().toLowerCase();
}

function readInlineBodyTags(line: string) {
  const normalized = line.trim();
  if (!normalized) return [];

  const bodyOnly = normalized
    .replace(/^\s*(?:标签建议|推荐标签|标签|hashtags?)\s*[：:]\s*/i, '')
    .trim();
  if (!bodyOnly.includes('#')) return [];

  const matches = bodyOnly.match(/#[^\s#，,、;；]+/g);
  return matches ? matches.map((item) => item.replace(/^#/, '').trim()).filter(Boolean) : [];
}

function isInlineTagLine(line: string, tags: string[]) {
  const normalized = line.trim();
  if (!normalized) return false;

  const explicitTagHeading = /^(标签建议|推荐标签|标签|hashtags?)\s*[：:]/i.test(normalized);
  const inlineTags = readInlineBodyTags(normalized);
  if (!inlineTags.length) return false;

  const normalizedTags = tags.map(normalizeTagToken).filter(Boolean);
  const normalizedInlineTags = inlineTags.map(normalizeTagToken).filter(Boolean);
  const allTagsMatch = normalizedInlineTags.every((tag) => normalizedTags.includes(tag));
  return explicitTagHeading || allTagsMatch;
}

function stripInlineTagsFromBody(body: string[], tags: string[]) {
  return body.filter((line) => !isInlineTagLine(line, tags));
}

function normalizeAgentDraft(payload: unknown, fallbackTopic: string, fallbackInstruction: string, baseDraft?: StructuredDraft): StructuredDraft {
  const fallback = baseDraft ?? buildStructuredDraft(fallbackTopic, fallbackInstruction);
  const draft = isRecord(payload)
    ? (payload.draft || payload.revisedDraft || payload)
    : payload;
  if (!isRecord(draft)) return fallback;

  const noteTitle = limitXhsTitle(
    (typeof draft.title === 'string' && draft.title.trim()) ||
    (typeof draft.selectedTitle === 'string' && draft.selectedTitle.trim()) ||
    (Array.isArray(draft.titleOptions) && typeof draft.titleOptions[0] === 'string' && draft.titleOptions[0]) ||
    fallback.noteTitle,
  );

  const hook = cleanMarkdownText(
    (typeof draft.intro === 'string' && draft.intro.trim()) ||
    (typeof draft.hook === 'string' && draft.hook.trim()) ||
    fallback.hook,
  );

  let body: string[] = fallback.body;
  if (Array.isArray(draft.body)) {
    const arr = draft.body
      .filter((p: unknown): p is string => typeof p === 'string' && p.trim().length > 0)
      .map(cleanMarkdownText);
    if (arr.length) body = arr;
  } else if (typeof draft.body === 'string' && draft.body.trim()) {
    body = draft.body.split(/\n+/).map(cleanMarkdownText).filter(Boolean);
  }

  const ending = rewriteEndingIfNeeded(
    cleanMarkdownText((typeof draft.ending === 'string' && draft.ending.trim()) || fallback.ending),
    fallbackTopic,
    fallbackInstruction,
  );

  let tags: string[] = fallback.tags;
  if (Array.isArray(draft.tags)) {
    const arr = draft.tags
      .filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
      .map((t: string) => t.replace(/^#/, ''));
    if (arr.length) tags = arr;
  } else if (typeof draft.tags === 'string' && draft.tags.trim()) {
    tags = draft.tags.split(/[\s,，、#]+/).map((t: string) => t.trim()).filter(Boolean);
  }

  body = stripInlineTagsFromBody(body, tags);

  const titleOptions = readStringList(draft.titleOptions, 5).map(limitXhsTitle).filter(Boolean);
  const normalizedTitleOptions = titleOptions.length
    ? Array.from(new Set([noteTitle, ...titleOptions])).slice(0, 5)
    : fallback.titleOptions;
  const coverSuggestion = readCoverSuggestion(draft.coverSuggestion) || fallback.coverSuggestion;
  const imageTextStructure = readStringList(draft.imageTextStructure, 8);
  const cardPreview = readDraftCardPreviewValue(draft.cardPreview) || fallback.cardPreview || { keywords: uniqueShortPhrases([noteTitle, ...tags, ...body]) };

  return {
    noteTitle,
    titleOptions: normalizedTitleOptions,
    hook,
    body,
    ending,
    tags,
    coverSuggestion,
    imageTextStructure: imageTextStructure.length ? imageTextStructure : fallback.imageTextStructure,
    cardPreview,
  };
}

function readAgentReply(payload: unknown) {
  const data = isRecord(payload) ? payload : {};
  return typeof data.text === 'string' && data.text.trim() ? data.text.trim() : '';
}

function isDiscussionOnlyContentPayload(payload: unknown) {
  const data = isRecord(payload) ? payload : {};
  const raw = isRecord(data.raw) ? data.raw : {};
  const draft = isRecord(data.draft) ? data.draft : null;
  const rawDraft = isRecord(raw.draft) ? raw.draft : null;
  return raw.isReadyToSave === false && (!draft || Object.keys(draft).length === 0) && (!rawDraft || Object.keys(rawDraft).length === 0) && Boolean(readAgentReply(data));
}

function readCompleteDraftPayload(payload: unknown) {
  const data = isRecord(payload) ? payload : {};
  const raw = isRecord(data.raw) ? data.raw : {};
  const completeDraft = isRecord(data.completeDraft) ? data.completeDraft : null;
  const draft = isRecord(data.draft) ? data.draft : null;
  const revisedDraft = isRecord(data.revisedDraft) ? data.revisedDraft : null;
  const rawDraft = isRecord(raw.draft) ? raw.draft : null;
  const rawRevisedDraft = isRecord(raw.revisedDraft) ? raw.revisedDraft : null;
  const candidate = completeDraft || revisedDraft || draft || rawRevisedDraft || rawDraft;
  if (!candidate) return null;

  const hasTitle =
    (typeof candidate.title === 'string' && candidate.title.trim().length > 0) ||
    (typeof candidate.selectedTitle === 'string' && candidate.selectedTitle.trim().length > 0) ||
    (Array.isArray(candidate.titleOptions) && candidate.titleOptions.some((title) => typeof title === 'string' && title.trim().length > 0));
  const hasIntro =
    (typeof candidate.intro === 'string' && candidate.intro.trim().length > 0) ||
    (typeof candidate.hook === 'string' && candidate.hook.trim().length > 0);
  const hasBody =
    (Array.isArray(candidate.body) && candidate.body.some((item) => typeof item === 'string' && item.trim().length > 0)) ||
    (typeof candidate.body === 'string' && candidate.body.trim().length > 0);
  const hasEnding = typeof candidate.ending === 'string' && candidate.ending.trim().length > 0;
  const hasTags =
    (Array.isArray(candidate.tags) && candidate.tags.some((tag) => typeof tag === 'string' && tag.trim().length > 0)) ||
    (typeof candidate.tags === 'string' && candidate.tags.trim().length > 0);

  return hasTitle && hasIntro && hasBody && hasEnding && hasTags ? candidate : null;
}

function readOptionalParam(value: string | null) {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function buildContentCopyEvent(
  message: ConversationMessage,
  index: number,
  copySource = 'message_action_button',
  contentLength = message.content.length,
): AgentOutputCopyEvent {
  return {
    eventName: 'agent_output_copy',
    module: 'content',
    conversationId: getOrCreateConversationId(CONTENT_CONVERSATION_ID_STORAGE_KEY),
    messageId: `${index}-${message.role}-${message.content.slice(0, 20)}`,
    messageIndex: index,
    messageRole: message.role,
    contentLength,
    copySource,
  };
}

function getContentCopyText(message: ConversationMessage) {
  return message.draft ? buildXhsPublishCopyText(message.draft) : message.content;
}

function readWritingEntrySource(searchParams: ReturnType<typeof useSearchParams>): WritingEntrySource | undefined {
  const sourceType = readOptionalParam(searchParams.get('sourceType'));
  if (sourceType !== 'hot_tracking' && sourceType !== 'track' && sourceType !== 'manual_input') {
    return undefined;
  }
  return {
    sourceType,
    trackId: readOptionalParam(searchParams.get('trackId')),
    trackName: readOptionalParam(searchParams.get('trackName')),
    topicId: readOptionalParam(searchParams.get('topicId')),
    topicTitle: readOptionalParam(searchParams.get('topicTitle')),
    inputText: readOptionalParam(searchParams.get('inputText')),
  };
}

function readStoredContentChatState(): StoredContentChatState | null {
  const raw = window.sessionStorage.getItem(CONTENT_CHAT_STATE_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredContentChatState>;
    if (!Array.isArray(parsed.conversationHistory)) return null;
    const historyWithStatusSplit = splitTrailingLegacyAgentStatus(
      trimVisibleConversation(
        parsed.conversationHistory.filter(
          (message): message is ConversationMessage =>
            (message?.role === 'user' || message?.role === 'assistant') && typeof message.content === 'string',
        ).map((message) => ({ ...message, canSave: false })),
      ),
    );
    return {
      activeDraft: parsed.activeDraft ?? null,
      activeTopic: typeof parsed.activeTopic === 'string' ? parsed.activeTopic : '',
      conversationHistory: historyWithStatusSplit.messages,
      conversationScopeId:
        typeof parsed.conversationScopeId === 'string' && parsed.conversationScopeId
          ? parsed.conversationScopeId
          : createConversationScopeId('content'),
      saveStatus: typeof parsed.saveStatus === 'string' ? parsed.saveStatus : '',
      isAgentLoading: Boolean(parsed.isAgentLoading),
      activeRequestId: typeof parsed.activeRequestId === 'string' ? parsed.activeRequestId : '',
      agentStatus: readStoredAgentStatus(parsed.agentStatus) || historyWithStatusSplit.agentStatus,
    };
  } catch {
    return null;
  }
}

function writeStoredContentChatState(state: StoredContentChatState, notify = false) {
  window.sessionStorage.setItem(
    CONTENT_CHAT_STATE_STORAGE_KEY,
    JSON.stringify({ ...state, conversationHistory: trimVisibleConversation(state.conversationHistory) }),
  );
  if (notify) {
    window.dispatchEvent(new Event('koc-content-chat-state-updated'));
  }
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

function ContentPageLoadingFallback() {
  return (
    <AuthStateFallback
      title="正在加载内容撰写页"
      description="正在恢复页面状态和请求参数，稍后会继续进入内容撰写。"
    />
  );
}

function readSuggestions(payload: unknown) {
  const data = isRecord(payload) ? payload : {};
  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
  return suggestions
    .filter((item): item is RevisionSuggestion => {
      return isRecord(item) && typeof item.label === 'string' && typeof item.instruction === 'string' && typeof item.intent === 'string';
    })
    .map((item) => ({
      label: item.label.trim(),
      instruction: item.instruction.trim(),
      intent: item.intent.trim(),
    }))
    .filter((item) => item.label.length > 0 && item.instruction.length > 0)
    .slice(0, 5);
}

function formatToday() {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function createContentDraftId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `content-${crypto.randomUUID()}`;
  }
  return `content-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function replaceContentUrlWithoutAuto(topic: string) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  params.delete('auto');
  params.delete('autoRequestId');
  params.set('topic', topic);
  const nextQuery = params.toString();
  const nextUrl = nextQuery ? `/content?${nextQuery}` : '/content';
  window.history.replaceState(window.history.state, '', nextUrl);
}

function resolveDraftConversationTopic(draft?: DraftItem | null) {
  if (!draft) return '';

  const draftSource = draft.draftSource;
  if (draftSource?.topicTitle && draftSource.topicTitle.trim()) return draftSource.topicTitle.trim();
  if (draftSource?.inputText && draftSource.inputText.trim()) return draftSource.inputText.trim();
  return draft.title.trim();
}

function buildDraftSource(topic: string, entrySource?: WritingEntrySource): DraftSource {
  if (entrySource?.sourceType === 'hot_tracking') {
    return {
      sourceType: 'hot_tracking',
      trackId: entrySource.trackId,
      trackName: entrySource.trackName,
      topicId: entrySource.topicId,
      topicTitle: entrySource.topicTitle || topic,
    };
  }
  if (entrySource?.sourceType === 'track') {
    return {
      sourceType: 'track',
      trackId: entrySource.trackId,
      trackName: entrySource.trackName,
      topicId: entrySource.topicId,
      topicTitle: entrySource.topicTitle || topic,
    };
  }
  return {
    sourceType: 'manual_input',
    inputText: entrySource?.inputText || topic,
    topicTitle: entrySource?.topicTitle || topic,
  };
}

function formatDraftCardSource(draft: DraftItem) {
  const hasStructuredSource = Boolean(draft.draftSource && draft.draftSource.sourceType !== 'unknown');
  return formatDraftSourceLabel(draft.draftSource, hasStructuredSource ? undefined : draft.source, draft.title);
}

function getDraftCardTitle(draft: DraftItem) {
  return draft.structured?.noteTitle?.trim() || draft.title.trim();
}

function DraftRenderer({ draft }: { draft: StructuredDraft }) {
  const bodyParagraphs = draft.body.map(cleanMarkdownText).filter(Boolean);
  const titleOptions = draft.titleOptions?.filter((title) => title && title !== draft.noteTitle).slice(0, 4) || [];
  const coverLines = draft.coverSuggestion
    ? [
        draft.coverSuggestion.mainText ? `封面文字：${draft.coverSuggestion.mainText}` : '',
        draft.coverSuggestion.layout ? `排版：${draft.coverSuggestion.layout}` : '',
        draft.coverSuggestion.visualStyle ? `风格：${draft.coverSuggestion.visualStyle}` : '',
      ].filter(Boolean)
    : [];
  const imageTextStructure = draft.imageTextStructure?.map(cleanMarkdownText).filter(Boolean) || [];

  return (
    <article className="space-y-5 text-[var(--foreground)]">
      <section>
        <p className="koc-heading-font text-[15px] text-[var(--foreground)]">笔记标题</p>
        <h1 className="koc-title-font mt-1 text-[28px] leading-tight text-[var(--foreground)]">{draft.noteTitle}</h1>
        {titleOptions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {titleOptions.map((title) => (
              <span key={title} className="rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.72)] px-3 py-1 text-[13px] leading-5 text-[var(--foreground)]">
                {title}
              </span>
            ))}
          </div>
        )}
      </section>

      {coverLines.length > 0 && (
        <section>
          <h2 className="koc-heading-font text-[22px] leading-tight">封面建议</h2>
          <div className="koc-song-font mt-2 space-y-1 text-[16px] font-medium leading-[1.75]">
            {coverLines.map((line) => (
              <MarkdownText key={line} content={line} />
            ))}
          </div>
        </section>
      )}

      {imageTextStructure.length > 0 && (
        <section>
          <h2 className="koc-heading-font text-[22px] leading-tight">图片顺序</h2>
          <div className="koc-song-font mt-2 space-y-1 text-[16px] font-medium leading-[1.75]">
            {imageTextStructure.map((line) => (
              <MarkdownText key={line} content={line} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="koc-heading-font text-[22px] leading-tight">引入</h2>
        <MarkdownText content={draft.hook} className="koc-song-font mt-2 text-[16px] font-medium leading-[1.75]" />
      </section>

      <section>
        <h2 className="koc-heading-font text-[22px] leading-tight">正文内容</h2>
        <div className="koc-song-font mt-2 space-y-2 text-[16px] font-medium leading-[1.75]">
          {bodyParagraphs.map((paragraph, index) => (
            <MarkdownText key={`${index}-${paragraph}`} content={paragraph} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="koc-heading-font text-[22px] leading-tight">结尾互动</h2>
        <MarkdownText content={draft.ending} className="koc-song-font mt-2 text-[16px] font-medium leading-[1.75]" />
      </section>

      <section>
        <h2 className="koc-heading-font text-[22px] leading-tight">标签建议</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {draft.tags.map((tag) => (
            <span key={tag} className="koc-song-font rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.94)] px-3 py-1 text-[15px] text-[var(--foreground)] shadow-[var(--box-shadow)]">
              #{tag}
            </span>
          ))}
        </div>
      </section>
    </article>
  );
}

function ContentPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, dispatch } = useAppState();
  const { isAuthenticated, status, openUnlockDialog } = useAuth();
  const [selectedPersona] = useState<SelectedPersona | null>(() => readSelectedPersona());
  const personaJson = selectedPersona?.persona || state.persona?.json;
  const activePersonaTitle = selectedPersona ? getPersonaDisplayTitle(selectedPersona.persona) : state.persona?.title;
  const activePersonaUsage: Pick<DraftItem, 'personaRecordId' | 'personaTitle' | 'personaSource'> = useMemo(
    () =>
      activePersonaTitle
        ? {
            personaRecordId: selectedPersona?.recordId,
            personaTitle: activePersonaTitle,
            personaSource: selectedPersona?.source || 'latest',
          }
        : {},
    [activePersonaTitle, selectedPersona],
  );
  const [viewMode, setViewMode] = useState<ViewMode>('drafts');
  const [input, setInput] = useState('');
  const [activeDraft, setActiveDraft] = useState<DraftItem | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [noticeTone, setNoticeTone] = useState<NoticeTone>('info');
  const [isSaving, setIsSaving] = useState(false);
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [conversationScopeId, setConversationScopeId] = useState(() => createConversationScopeId('content'));
  const [agentStatus, setAgentStatus] = useState<AgentStatusState | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const submittedTopicRef = useRef('');
  const activeTopicRef = useRef('');
  const activeRequestRef = useRef('');
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopTriggeredAtRef = useRef(0);
  const requestCounterRef = useRef(0);
  const saveNoticeTimerRef = useRef<number | null>(null);
  const pendingAutoScrollRef = useRef(false);
  const pendingRestoreScrollRef = useRef(false);
  const autoDraftPendingRef = useRef(false);
  const writingEntrySourceRef = useRef<WritingEntrySource | undefined>(undefined);
  const anonymousRedirectTriggeredRef = useRef(false);
  const conversationLimitToastShownRef = useRef(false);
  const hasReachedConversationLimit = hasReachedConversationHardStop(conversationHistory);

  const requestStop = useCallback(() => {
    stopTriggeredAtRef.current = Date.now();
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

  const drafts = state.drafts;

  const switchViewMode = useCallback((nextViewMode: ViewMode) => {
    setViewMode(nextViewMode);
    window.sessionStorage.setItem(CONTENT_VIEW_MODE_STORAGE_KEY, nextViewMode);
  }, []);

  const showSaveStatus = useCallback((message: string, tone: NoticeTone = 'info', autoHide = false) => {
    if (saveNoticeTimerRef.current) {
      window.clearTimeout(saveNoticeTimerRef.current);
      saveNoticeTimerRef.current = null;
    }
    setSaveStatus(message);
    setNoticeTone(tone);
    if (autoHide) {
      saveNoticeTimerRef.current = window.setTimeout(() => {
        setSaveStatus('');
        setNoticeTone('info');
        saveNoticeTimerRef.current = null;
      }, 2000);
    }
  }, []);

  useEffect(() => {
    if (!hasReachedConversationLimit) {
      conversationLimitToastShownRef.current = false;
      return;
    }
    if (conversationLimitToastShownRef.current) return;
    conversationLimitToastShownRef.current = true;
    showSaveStatus(CONVERSATION_LIMIT_NOTICE, 'error');
  }, [hasReachedConversationLimit, showSaveStatus]);

  useEffect(() => {
    return () => {
      if (saveNoticeTimerRef.current) {
        window.clearTimeout(saveNoticeTimerRef.current);
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
      redirectTo: '/content',
      closeRedirectTo: '/',
    });
    router.replace('/');
  }, [openUnlockDialog, router, status]);

  const returnToDrafts = useCallback(() => {
    if (isAgentLoading) {
      window.alert('请先等待当前生成完成，或先停止生成再返回草稿箱。');
      return;
    }
    const hasUnsavedActiveDraft = hasUnsavedDraftChanges(activeDraft, drafts);
    if (hasUnsavedActiveDraft) {
      window.alert('请先保存当前笔记内容，保存后再返回草稿箱。');
      return;
    }
    setConversationScopeId(createConversationScopeId('content'));
    switchViewMode('drafts');
  }, [activeDraft, drafts, isAgentLoading, switchViewMode]);

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
  }, [conversationHistory, isAgentLoading, scrollChatToBottom, viewMode]);

  useEffect(() => {
    if (viewMode !== 'chat' || !pendingRestoreScrollRef.current || pendingAutoScrollRef.current) return;
    pendingRestoreScrollRef.current = false;
    const timer = window.setTimeout(() => {
      const container = chatScrollRef.current;
      if (!container) return;
      const savedTop = Number(window.sessionStorage.getItem(CONTENT_CHAT_SCROLL_TOP_STORAGE_KEY) || 0);
      container.scrollTop = Number.isFinite(savedTop) ? savedTop : 0;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [conversationHistory, isAgentLoading, viewMode]);

  useEffect(() => {
    const incomingTopic = searchParams.get('topic')?.trim();
    const shouldAutoSubmit = searchParams.get('auto') === '1';
    if (shouldAutoSubmit && incomingTopic) {
      window.sessionStorage.setItem(CONTENT_VIEW_MODE_STORAGE_KEY, 'chat');
      const timer = window.setTimeout(() => setViewMode('chat'), 0);
      return () => window.clearTimeout(timer);
    }

    const savedViewMode = window.sessionStorage.getItem(CONTENT_VIEW_MODE_STORAGE_KEY);
    if (savedViewMode !== 'drafts' && savedViewMode !== 'chat') return;
    const timer = window.setTimeout(() => setViewMode(savedViewMode), 0);
    return () => window.clearTimeout(timer);
  }, [searchParams, switchViewMode]);

  const applyStoredChatState = useCallback((restoreScroll = false) => {
    if (autoDraftPendingRef.current) return;
    const storedChatState = readStoredContentChatState();
    if (!storedChatState) return;
    const incomingTopic = searchParams.get('topic')?.trim();
    if (incomingTopic && storedChatState.activeTopic.trim() && storedChatState.activeTopic.trim() !== incomingTopic) {
      return;
    }

    activeTopicRef.current = storedChatState.activeTopic;
    activeRequestRef.current = storedChatState.activeRequestId;
    pendingRestoreScrollRef.current = restoreScroll;
    setActiveDraft(storedChatState.activeDraft);
    setConversationHistory(storedChatState.conversationHistory);
    setConversationScopeId(storedChatState.conversationScopeId);
    setAgentStatus(storedChatState.agentStatus ?? null);
    setSaveStatus(storedChatState.saveStatus);
    setIsAgentLoading(storedChatState.isAgentLoading);
  }, [searchParams]);

  useEffect(() => {
    const incomingTopic = searchParams.get('topic')?.trim();
    const shouldAutoSubmit = searchParams.get('auto') === '1';
    if (shouldAutoSubmit && incomingTopic) return;

    const timer = window.setTimeout(() => applyStoredChatState(true), 0);

    return () => window.clearTimeout(timer);
  }, [applyStoredChatState, searchParams]);

  useEffect(() => {
    const handleUpdate = () => applyStoredChatState(false);
    window.addEventListener('koc-content-chat-state-updated', handleUpdate);
    return () => window.removeEventListener('koc-content-chat-state-updated', handleUpdate);
  }, [applyStoredChatState]);

  useEffect(() => {
    if (viewMode !== 'chat') return;
    writeStoredContentChatState({
      activeDraft,
      activeTopic: activeTopicRef.current,
      conversationHistory,
      conversationScopeId,
      saveStatus,
      isAgentLoading,
      activeRequestId: activeRequestRef.current,
      agentStatus,
    });
  }, [activeDraft, agentStatus, conversationHistory, conversationScopeId, isAgentLoading, saveStatus, viewMode]);

  useEffect(() => {
    if (viewMode !== 'chat' || isAgentLoading || autoDraftPendingRef.current) return;
    const incomingTopic = searchParams.get('topic')?.trim();
    const shouldAutoSubmit = searchParams.get('auto') === '1';
    if (shouldAutoSubmit && incomingTopic) return;

    const hasConversation = conversationHistory.length > 0;
    const hasActiveDraft = Boolean(activeDraft);
    const hasAgentStatus = Boolean(agentStatus);
    if (hasConversation || hasActiveDraft || hasAgentStatus) return;

    activeRequestRef.current = '';
    activeTopicRef.current = '';
    pendingRestoreScrollRef.current = false;
    window.sessionStorage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
    window.sessionStorage.removeItem(CONTENT_CHAT_STATE_STORAGE_KEY);
    window.sessionStorage.removeItem(CONTENT_CHAT_SCROLL_TOP_STORAGE_KEY);
    window.sessionStorage.removeItem(CONTENT_VIEW_MODE_STORAGE_KEY);
    const timer = window.setTimeout(() => {
      setConversationScopeId(createConversationScopeId('content'));
      setViewMode('drafts');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeDraft, agentStatus, conversationHistory, isAgentLoading, searchParams, viewMode]);

  const callContentAgent = useCallback(
    async (
      topic: string,
      instruction: string,
      history: ConversationMessage[],
      currentDraft?: StructuredDraft,
      signal?: AbortSignal,
    ): Promise<{ structured: StructuredDraft | null; assistantText: string; discussionOnly: boolean; suggestions: RevisionSuggestion[] } | null> => {
      const response = await fetch(`${API_BASE}/api/content/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          topic,
          instruction,
          currentDraft,
          revisionInstruction: currentDraft ? instruction : undefined,
          conversationScopeId,
          conversationHistory: trimVisibleConversation(history),
          writingEntrySource: currentDraft ? activeDraft?.draftSource || writingEntrySourceRef.current : writingEntrySourceRef.current,
          persona: personaJson,
        }),
        signal,
      });

      const json = await readJsonResponse(response);
      const payloadRecord = isRecord(json) ? json : {};
      if (!response.ok || payloadRecord.code !== 200) {
        const message =
          (typeof payloadRecord.message === 'string' && payloadRecord.message) ||
          (typeof payloadRecord.msg === 'string' && payloadRecord.msg) ||
          'Agent 调用失败';
        throw new Error(message);
      }

      const payload = isRecord(payloadRecord.data) ? payloadRecord.data : {};
      if (isDiscussionOnlyContentPayload(payload)) {
        return {
          structured: null,
          assistantText: readAgentReply(payload),
          discussionOnly: true,
          suggestions: [],
        };
      }

      const completeDraft = readCompleteDraftPayload(payload);
      if (!completeDraft) {
        return {
          structured: null,
          assistantText: readAgentReply(payload) || '我先按讨论继续帮你梳理，等内容方向确认后再输出完整笔记。',
          discussionOnly: true,
          suggestions: [],
        };
      }

      const structured = normalizeAgentDraft(completeDraft, topic, instruction, currentDraft);
      const assistantText: string =
        (typeof payload.text === 'string' && payload.text) ||
        stringifyDraft(structured);
      return { structured, assistantText, discussionOnly: false, suggestions: readSuggestions(payload) };
    },
    [activeDraft?.draftSource, conversationScopeId, personaJson],
  );

  useEffect(() => {
    if (viewMode === 'drafts' && conversationHistory.length === 0) {
      clearConversationId(CONTENT_CONVERSATION_ID_STORAGE_KEY);
    }
  }, [conversationHistory.length, viewMode]);

  const createDraft = useCallback(
    async (topic: string, instruction = '', initialUserContent?: string) => {
      const trimmedTopic = topic.trim();
      const conversationId = getOrCreateConversationId(CONTENT_CONVERSATION_ID_STORAGE_KEY);
      const analyticsRequestId = createClientEventId('content-create');
      const startedAt = Date.now();
      const draftSource = buildDraftSource(trimmedTopic, writingEntrySourceRef.current);
      const sourceLabel = formatDraftSourceLabel(draftSource, undefined, trimmedTopic);
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const controller = new AbortController();
      const trimmedInstruction = instruction.trim();
      const userTurn = (initialUserContent || trimmedTopic).trim();
      const agentInstruction = userTurn || trimmedInstruction || trimmedTopic;
      const displayedUserTurn = buildVisibleInitialContentMessage(trimmedTopic);
      const nextHistory: ConversationMessage[] = [{ role: 'user', content: displayedUserTurn }];

      window.sessionStorage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
      window.sessionStorage.removeItem(CONTENT_CHAT_SCROLL_TOP_STORAGE_KEY);
      activeTopicRef.current = trimmedTopic;
      activeRequestRef.current = requestId;
      abortControllerRef.current = controller;
      switchViewMode('chat');
      setActiveDraft(null);
      setInput('');
      showSaveStatus('', 'info');
      setAgentStatus(null);
      setIsAgentLoading(true);
      pendingAutoScrollRef.current = true;
      setConversationHistory(nextHistory);
      writeStoredContentChatState(
        {
          activeDraft: null,
          activeTopic: trimmedTopic,
          conversationHistory: nextHistory,
          conversationScopeId,
          saveStatus: '',
          isAgentLoading: true,
          activeRequestId: requestId,
          agentStatus: null,
        },
        true,
      );
      void trackAnalyticsEvent({
        eventName: 'conversation_turn_started',
        module: 'content',
        conversationId,
        requestId: analyticsRequestId,
        taskType: 'content.draft',
        turnIndex: 1,
        userMessageLength: userTurn.length,
        historyMessageCount: 0,
        status: 'started',
      });

      try {
        const result = await callContentAgent(trimmedTopic, agentInstruction, nextHistory, undefined, controller.signal);
        if (activeRequestRef.current !== requestId) return;

        const structured = result?.structured ?? null;
        const assistantText = result?.assistantText ?? (structured ? stringifyDraft(structured) : '我先按讨论继续帮你梳理，等内容方向确认后再输出完整笔记。');
        const suggestions = result?.suggestions ?? [];
        const assistantMessage: ConversationMessage = result?.discussionOnly || !structured
          ? { role: 'assistant', content: assistantText }
          : { role: 'assistant', content: assistantText, draft: structured, suggestions, canSave: true };
        const finalHistory = trimVisibleConversation([...nextHistory, assistantMessage]);
        if (result?.discussionOnly || !structured) {
          activeRequestRef.current = '';
          abortControllerRef.current = null;
          pendingAutoScrollRef.current = true;
          setActiveDraft(null);
          setConversationHistory(finalHistory);
          setAgentStatus(null);
          setIsAgentLoading(false);
          switchViewMode('chat');
          writeStoredContentChatState(
            {
              activeDraft: null,
              activeTopic: trimmedTopic,
              conversationHistory: finalHistory,
              conversationScopeId,
              saveStatus: '',
              isAgentLoading: false,
              activeRequestId: '',
              agentStatus: null,
            },
            true,
          );
          void trackAnalyticsEvent({
            eventName: 'conversation_turn_completed',
            module: 'content',
            conversationId,
            requestId: analyticsRequestId,
            taskType: 'content.draft',
            turnIndex: 1,
            userMessageLength: userTurn.length,
            assistantMessageLength: assistantText.length,
            historyMessageCount: 1,
            status: 'success',
            latencyMs: Date.now() - startedAt,
          });
          return;
        }

        const nextDraft: DraftItem = {
          id: createContentDraftId(),
          title: structured.noteTitle || trimmedTopic,
          status: '待优化',
          source: sourceLabel,
          draftSource,
          tags: structured.tags.slice(0, 4),
          updatedAt: formatToday(),
          createdAt: new Date().toISOString(),
          body: stringifyDraft(structured),
          structured,
          cardPreview: structured.cardPreview,
        };

        window.sessionStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, nextDraft.id);
        activeRequestRef.current = '';
        abortControllerRef.current = null;
        pendingAutoScrollRef.current = true;
        setActiveDraft(nextDraft);
        setConversationHistory(finalHistory);
        setAgentStatus(null);
        setIsAgentLoading(false);
        switchViewMode('chat');
        writeStoredContentChatState(
          {
            activeDraft: nextDraft,
            activeTopic: trimmedTopic,
            conversationHistory: finalHistory,
            conversationScopeId,
            saveStatus: '',
            isAgentLoading: false,
            activeRequestId: '',
            agentStatus: null,
          },
          true,
        );
        void trackAnalyticsEvent({
          eventName: 'conversation_turn_completed',
          module: 'content',
          conversationId,
          requestId: analyticsRequestId,
          taskType: 'content.draft',
          turnIndex: 1,
          userMessageLength: userTurn.length,
          assistantMessageLength: stringifyDraft(structured).length,
          historyMessageCount: 1,
          status: 'success',
          latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        if (activeRequestRef.current !== requestId) return;

        if (error instanceof DOMException && error.name === 'AbortError') {
          const stoppedStatus: AgentStatusState = { kind: 'stopped', message: '本次输出已停止。' };
          activeRequestRef.current = '';
          abortControllerRef.current = null;
          pendingAutoScrollRef.current = true;
          setActiveDraft(null);
          setConversationHistory(nextHistory);
          setAgentStatus(stoppedStatus);
          setIsAgentLoading(false);
          writeStoredContentChatState(
            {
              activeDraft: null,
              activeTopic: trimmedTopic,
              conversationHistory: nextHistory,
              conversationScopeId,
              saveStatus: '',
              isAgentLoading: false,
              activeRequestId: '',
              agentStatus: stoppedStatus,
            },
            true,
          );
          showSaveStatus('本次输出已停止。', 'info');
          void trackAnalyticsEvent({
            eventName: 'conversation_turn_failed',
            module: 'content',
            conversationId,
            requestId: analyticsRequestId,
            taskType: 'content.draft',
            turnIndex: 1,
            userMessageLength: userTurn.length,
            historyMessageCount: 1,
            status: 'stopped',
            latencyMs: Date.now() - startedAt,
            failureReason: 'aborted',
          });
          return;
        }

        const message = error instanceof Error ? error.message : '生成失败';
        activeRequestRef.current = '';
        abortControllerRef.current = null;
        setIsAgentLoading(false);
        setConversationHistory(nextHistory);
        setAgentStatus({ kind: 'error', message: `出错了：${message}` });
        writeStoredContentChatState(
          {
            activeDraft: null,
            activeTopic: trimmedTopic,
            conversationHistory: nextHistory,
            conversationScopeId,
            saveStatus: '',
            isAgentLoading: false,
            activeRequestId: '',
            agentStatus: { kind: 'error', message: `出错了：${message}` },
          },
          true,
        );
        showSaveStatus(`错误：${message}`, 'error');
        void trackAnalyticsEvent({
          eventName: 'conversation_turn_failed',
          module: 'content',
          conversationId,
          requestId: analyticsRequestId,
          taskType: 'content.draft',
          turnIndex: 1,
          userMessageLength: userTurn.length,
          historyMessageCount: 1,
          status: 'failed',
          latencyMs: Date.now() - startedAt,
          failureReason: message,
        });
      }
    },
    [callContentAgent, conversationScopeId, showSaveStatus, switchViewMode],
  );

  const reviseDraft = useCallback(
    async (instruction: string) => {
      const trimmedInstruction = instruction.trim();
      if (!trimmedInstruction) return;
      if (hasReachedConversationHardStop(conversationHistory)) {
        showSaveStatus(CONVERSATION_LIMIT_NOTICE, 'error');
        return;
      }

      const baseTopic = resolveDraftConversationTopic(activeDraft) || activeTopicRef.current || '当前草稿';
      const conversationId = getOrCreateConversationId(CONTENT_CONVERSATION_ID_STORAGE_KEY);
      const analyticsRequestId = createClientEventId('content-revise');
      const startedAt = Date.now();
      const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const controller = new AbortController();
      const userTurn = trimmedInstruction;
      const nextUserContent = conversationHistory.length === 0
        ? buildVisibleInitialContentMessage(baseTopic)
        : userTurn;
      const nextHistory: ConversationMessage[] = trimVisibleConversation([...conversationHistory, { role: 'user', content: nextUserContent }]);

      activeTopicRef.current = baseTopic;
      activeRequestRef.current = requestId;
      abortControllerRef.current = controller;
      pendingAutoScrollRef.current = true;
      setConversationHistory(nextHistory);
      setInput('');
      showSaveStatus('', 'info');
      setAgentStatus(null);
      setIsAgentLoading(true);
      writeStoredContentChatState({
        activeDraft,
        activeTopic: baseTopic,
        conversationHistory: nextHistory,
        conversationScopeId,
        saveStatus: '',
        isAgentLoading: true,
        activeRequestId: requestId,
        agentStatus: null,
      });
      void trackAnalyticsEvent({
        eventName: 'conversation_turn_started',
        module: 'content',
        conversationId,
        requestId: analyticsRequestId,
        taskType: 'content.draft',
        turnIndex: nextHistory.filter((message) => message.role === 'user').length,
        userMessageLength: userTurn.length,
        historyMessageCount: conversationHistory.length,
        status: 'started',
      });

      try {
      const result = await callContentAgent(baseTopic, trimmedInstruction, nextHistory, activeDraft?.structured, controller.signal);
        if (activeRequestRef.current !== requestId) return;

        const structured = result?.structured ?? null;
        const assistantText = result?.assistantText ?? (structured ? stringifyDraft(structured) : '我先按讨论继续帮你梳理，等内容方向确认后再输出完整笔记。');
        const suggestions = result?.suggestions ?? [];
        const assistantMessage: ConversationMessage = result?.discussionOnly || !structured
          ? { role: 'assistant', content: assistantText }
          : { role: 'assistant', content: assistantText, draft: structured, suggestions, canSave: true };
        const finalHistory = trimVisibleConversation([...nextHistory, assistantMessage]);
        if (result?.discussionOnly || !structured) {
          activeRequestRef.current = '';
          abortControllerRef.current = null;
          pendingAutoScrollRef.current = true;
          setConversationHistory(finalHistory);
          setAgentStatus(null);
          setIsAgentLoading(false);
          writeStoredContentChatState(
            {
              activeDraft,
              activeTopic: baseTopic,
              conversationHistory: finalHistory,
              conversationScopeId,
              saveStatus: '',
              isAgentLoading: false,
              activeRequestId: '',
              agentStatus: null,
            },
            true,
          );
          void trackAnalyticsEvent({
            eventName: 'conversation_turn_completed',
            module: 'content',
            conversationId,
            requestId: analyticsRequestId,
            taskType: 'content.draft',
            turnIndex: nextHistory.filter((message) => message.role === 'user').length,
            userMessageLength: userTurn.length,
            assistantMessageLength: assistantText.length,
            historyMessageCount: nextHistory.length,
            status: 'success',
            latencyMs: Date.now() - startedAt,
          });
          return;
        }

        const nextDraftSource = activeDraft?.draftSource || buildDraftSource(baseTopic, writingEntrySourceRef.current);
        const nextDraft: DraftItem = {
          id: activeDraft?.id || createContentDraftId(),
          title: structured.noteTitle,
          status: activeDraft?.status || '待优化',
          source: formatDraftSourceLabel(nextDraftSource, activeDraft?.draftSource ? undefined : activeDraft?.source, structured.noteTitle),
          draftSource: nextDraftSource,
          createdAt: activeDraft?.createdAt || new Date().toISOString(),
          body: stringifyDraft(structured),
          structured,
          cardPreview: structured.cardPreview,
          tags: structured.tags.slice(0, 4),
          updatedAt: formatToday(),
        };

        window.sessionStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, nextDraft.id);
        activeRequestRef.current = '';
        abortControllerRef.current = null;
        pendingAutoScrollRef.current = true;
        setActiveDraft(nextDraft);
        setConversationHistory(finalHistory);
        setAgentStatus(null);
        setIsAgentLoading(false);
        writeStoredContentChatState(
          {
            activeDraft: nextDraft,
            activeTopic: baseTopic,
            conversationHistory: finalHistory,
            conversationScopeId,
            saveStatus: '',
            isAgentLoading: false,
            activeRequestId: '',
            agentStatus: null,
          },
          true,
        );
        void trackAnalyticsEvent({
          eventName: 'conversation_turn_completed',
          module: 'content',
          conversationId,
          requestId: analyticsRequestId,
          taskType: 'content.draft',
          turnIndex: nextHistory.filter((message) => message.role === 'user').length,
          userMessageLength: userTurn.length,
          assistantMessageLength: stringifyDraft(structured).length,
          historyMessageCount: nextHistory.length,
          status: 'success',
          latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        if (activeRequestRef.current !== requestId) return;

        if (error instanceof DOMException && error.name === 'AbortError') {
          const stoppedStatus: AgentStatusState = { kind: 'stopped', message: '本次输出已停止。' };
          activeRequestRef.current = '';
          abortControllerRef.current = null;
          pendingAutoScrollRef.current = true;
          setConversationHistory(nextHistory);
          setAgentStatus(stoppedStatus);
          setIsAgentLoading(false);
          writeStoredContentChatState({
            activeDraft,
            activeTopic: baseTopic,
            conversationHistory: nextHistory,
            conversationScopeId,
            saveStatus: '',
            isAgentLoading: false,
            activeRequestId: '',
            agentStatus: stoppedStatus,
          });
          showSaveStatus('本次输出已停止。', 'info');
          void trackAnalyticsEvent({
            eventName: 'conversation_turn_failed',
            module: 'content',
            conversationId,
            requestId: analyticsRequestId,
            taskType: 'content.draft',
            turnIndex: nextHistory.filter((message) => message.role === 'user').length,
            userMessageLength: userTurn.length,
            historyMessageCount: nextHistory.length,
            status: 'stopped',
            latencyMs: Date.now() - startedAt,
            failureReason: 'aborted',
          });
          return;
        }

        const message = error instanceof Error ? error.message : '生成失败';
        activeRequestRef.current = '';
        abortControllerRef.current = null;
        pendingAutoScrollRef.current = true;
        setConversationHistory(nextHistory);
        setAgentStatus({ kind: 'error', message: `出错了：${message}` });
        setIsAgentLoading(false);
        writeStoredContentChatState(
          {
            activeDraft,
            activeTopic: baseTopic,
            conversationHistory: nextHistory,
            conversationScopeId,
            saveStatus: '',
            isAgentLoading: false,
            activeRequestId: '',
            agentStatus: { kind: 'error', message: `出错了：${message}` },
          },
          true,
        );
        showSaveStatus(`错误：${message}`, 'error');
        void trackAnalyticsEvent({
          eventName: 'conversation_turn_failed',
          module: 'content',
          conversationId,
          requestId: analyticsRequestId,
          taskType: 'content.draft',
          turnIndex: nextHistory.filter((message) => message.role === 'user').length,
          userMessageLength: userTurn.length,
          historyMessageCount: nextHistory.length,
          status: 'failed',
          latencyMs: Date.now() - startedAt,
          failureReason: message,
        });
      }
    },
    [activeDraft, callContentAgent, conversationHistory, conversationScopeId, showSaveStatus],
  );

  useEffect(() => {
    const shouldAutoSubmit = searchParams.get('auto') === '1';
    if (shouldAutoSubmit) return;

    submittedTopicRef.current = '';
    autoDraftPendingRef.current = false;
    writingEntrySourceRef.current = undefined;
  }, [searchParams]);

  useEffect(() => {
    const incomingTopic = searchParams.get('topic')?.trim();
    const shouldAutoSubmit = searchParams.get('auto') === '1';
    const autoRequestId = searchParams.get('autoRequestId')?.trim();
    const autoRequestKey = incomingTopic ? (autoRequestId ? `${incomingTopic}::${autoRequestId}` : incomingTopic) : '';
    if (!state.persona || !incomingTopic || !shouldAutoSubmit || submittedTopicRef.current === autoRequestKey) return;

    writingEntrySourceRef.current = readWritingEntrySource(searchParams) || {
      sourceType: 'hot_tracking',
      topicTitle: incomingTopic,
    };
    submittedTopicRef.current = autoRequestKey;
    autoDraftPendingRef.current = true;
    window.sessionStorage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
    window.sessionStorage.removeItem(CONTENT_CHAT_STATE_STORAGE_KEY);
    window.sessionStorage.removeItem(CONTENT_CHAT_SCROLL_TOP_STORAGE_KEY);
    setActiveDraft(null);
    setConversationHistory([]);
    setConversationScopeId(createConversationScopeId('content'));
    setSaveStatus('');
    setNoticeTone('info');
    void createDraft(incomingTopic, '', incomingTopic).finally(() => {
      autoDraftPendingRef.current = false;
      replaceContentUrlWithoutAuto(incomingTopic);
    });
  }, [createDraft, searchParams, state.persona]);


  const openDraft = useCallback((draft: DraftItem) => {
    const structuredDraft = draft.structured
      ? {
          ...draft.structured,
          body: stripInlineTagsFromBody(draft.structured.body, draft.structured.tags),
          cardPreview: draft.structured.cardPreview || draft.cardPreview,
        }
      : undefined;
    window.sessionStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, draft.id);
    activeTopicRef.current = resolveDraftConversationTopic(draft);
    activeRequestRef.current = '';
    setConversationScopeId(createConversationScopeId('content'));
    setActiveDraft(draft);
    switchViewMode('chat');
    setInput('');
    setSaveStatus('');
    setIsAgentLoading(false);
    setConversationHistory([
      {
        role: 'assistant',
        content: draft.body || (structuredDraft ? stringifyDraft(structuredDraft) : ''),
        draft: structuredDraft,
      },
    ]);
    setAgentStatus(null);
  }, [switchViewMode]);

  useEffect(() => {
    const incomingTopic = searchParams.get('topic')?.trim();
    const shouldAutoSubmit = searchParams.get('auto') === '1';
    if (autoDraftPendingRef.current || (shouldAutoSubmit && incomingTopic)) return;
    if (state.draftsHydrating || activeDraft || viewMode !== 'chat' || drafts.length === 0) return;
    const activeDraftId = window.sessionStorage.getItem(ACTIVE_DRAFT_STORAGE_KEY);
    if (!activeDraftId) return;
    const restoredDraft = drafts.find((draft) => draft.id === activeDraftId);
    if (!restoredDraft) return;
    if (incomingTopic && resolveDraftConversationTopic(restoredDraft) !== incomingTopic) return;
    const timer = window.setTimeout(() => openDraft(restoredDraft), 0);
    return () => window.clearTimeout(timer);
  }, [activeDraft, drafts, openDraft, searchParams, state.draftsHydrating, viewMode]);

  const deleteDraft = async (draft: DraftItem) => {
    if (!window.confirm('确定要删除这份草稿吗？')) return;

    try {
      const response = await fetch(`${API_BASE}/api/content/record`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(draft),
      });

      if (!response.ok) {
        throw new Error('删除失败');
      }
      const json = await readJsonResponse(response);
      if (!isRecord(json) || json.code !== 200) {
        throw new Error('删除失败');
      }

      dispatch({ type: 'DELETE_DRAFT', payload: draft.id });
      if (activeDraft?.id === draft.id) {
        window.sessionStorage.removeItem(ACTIVE_DRAFT_STORAGE_KEY);
        window.sessionStorage.removeItem(CONTENT_CHAT_STATE_STORAGE_KEY);
        setActiveDraft(null);
        setConversationHistory([]);
        setSaveStatus('');
        setNoticeTone('info');
        returnToDrafts();
      }
      showSaveStatus('删除成功', 'success', true);
    } catch (error) {
      console.error('删除内容草稿失败', error);
      showSaveStatus('错误：删除失败，请重试', 'error');
    }
  };

  const saveContentMessage = async (message: ConversationMessage) => {
    if (isSaving || !message.draft) return;
    const baseTopic = resolveDraftConversationTopic(activeDraft) || activeTopicRef.current || message.draft.noteTitle;
    const nextDraftSource = activeDraft?.draftSource || buildDraftSource(baseTopic, writingEntrySourceRef.current);
    const draftRecord: DraftItem = {
      id: activeDraft?.id || createContentDraftId(),
      title: message.draft.noteTitle,
      source: formatDraftSourceLabel(nextDraftSource, activeDraft?.draftSource ? undefined : activeDraft?.source, message.draft.noteTitle),
      draftSource: nextDraftSource,
      status: activeDraft?.status || '待优化',
      tags: message.draft.tags.slice(0, 4),
      updatedAt: formatToday(),
      createdAt: activeDraft?.createdAt || new Date().toISOString(),
      body: stringifyDraft(message.draft),
      structured: message.draft,
      cardPreview: message.draft.cardPreview,
      personaRecordId: activeDraft?.personaRecordId || activePersonaUsage.personaRecordId,
      personaTitle: activeDraft?.personaTitle || activePersonaUsage.personaTitle,
      personaSource: activeDraft?.personaSource || activePersonaUsage.personaSource,
    };
    setIsSaving(true);
    try {
      const response = await fetch(`${API_BASE}/api/content/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ draft: draftRecord }),
      });
      if (!response.ok) throw new Error('保存失败');
      const json = await readJsonResponse(response);
      if (!isRecord(json) || json.code !== 200) {
        throw new Error('保存失败');
      }
      dispatch({ type: 'SET_DRAFT', payload: draftRecord });
      setActiveDraft(draftRecord);
      showSaveStatus('保存成功', 'success', true);
    } catch (error) {
      console.error('保存内容消息失败', error);
      showSaveStatus('错误：保存失败，请重试', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const refreshContentMessage = async (assistantIndex: number) => {
    if (isAgentLoading) return;
    const userIndex = conversationHistory
      .slice(0, assistantIndex)
      .map((message) => message.role)
      .lastIndexOf('user');
    if (userIndex < 0) return;

    const previousUser = conversationHistory[userIndex];
    const baseTopic = resolveDraftConversationTopic(activeDraft) || activeTopicRef.current || previousUser.content;
    const historyBeforeAssistant = conversationHistory.slice(0, assistantIndex);
    requestCounterRef.current += 1;
    const requestId = `content-refresh-${requestCounterRef.current}`;
    const controller = new AbortController();
    activeRequestRef.current = requestId;
    abortControllerRef.current = controller;
    pendingAutoScrollRef.current = true;
    const visibleHistoryBeforeAssistant = trimVisibleConversation(historyBeforeAssistant);
    setConversationHistory(visibleHistoryBeforeAssistant);
    setAgentStatus(null);
    setIsAgentLoading(true);
    showSaveStatus('', 'info');
    writeStoredContentChatState({
      activeDraft,
      activeTopic: baseTopic,
      conversationHistory: visibleHistoryBeforeAssistant,
      conversationScopeId,
      saveStatus: '',
      isAgentLoading: true,
      activeRequestId: requestId,
      agentStatus: null,
    });

    try {
      const result = await callContentAgent(baseTopic, previousUser.content, visibleHistoryBeforeAssistant, activeDraft?.structured, controller.signal);
      if (activeRequestRef.current !== requestId) return;
      const structured = result?.structured ?? activeDraft?.structured ?? null;
      const suggestions = result?.suggestions ?? [];
      const assistantMessage: ConversationMessage =
        result?.discussionOnly || !structured
          ? { role: 'assistant', content: result?.assistantText || '' }
          : {
              role: 'assistant',
              content: result?.assistantText || stringifyDraft(structured),
              draft: structured,
              suggestions,
              canSave: true,
            };
      const refreshedHistory = trimVisibleConversation([...visibleHistoryBeforeAssistant, assistantMessage]);
      setConversationHistory(refreshedHistory);
      setAgentStatus(null);
      activeRequestRef.current = '';
      abortControllerRef.current = null;
      setIsAgentLoading(false);
      writeStoredContentChatState({
        activeDraft,
        activeTopic: baseTopic,
        conversationHistory: refreshedHistory,
        conversationScopeId,
        saveStatus: '',
        isAgentLoading: false,
        activeRequestId: '',
        agentStatus: null,
      });
    } catch (error) {
      if (activeRequestRef.current !== requestId) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        const stoppedStatus: AgentStatusState = { kind: 'stopped', message: '本次输出已停止。' };
        setConversationHistory(visibleHistoryBeforeAssistant);
        setAgentStatus(stoppedStatus);
        activeRequestRef.current = '';
        abortControllerRef.current = null;
        setIsAgentLoading(false);
        writeStoredContentChatState({
          activeDraft,
          activeTopic: baseTopic,
          conversationHistory: visibleHistoryBeforeAssistant,
          conversationScopeId,
          saveStatus: '',
          isAgentLoading: false,
          activeRequestId: '',
          agentStatus: stoppedStatus,
        });
        showSaveStatus('本次输出已停止。', 'info');
        return;
      }
      const message = error instanceof Error ? error.message : '生成失败';
      const errorStatus: AgentStatusState = { kind: 'error', message: `出错了：${message}` };
      setConversationHistory(visibleHistoryBeforeAssistant);
      setAgentStatus(errorStatus);
      activeRequestRef.current = '';
      abortControllerRef.current = null;
      setIsAgentLoading(false);
      writeStoredContentChatState({
        activeDraft,
        activeTopic: baseTopic,
        conversationHistory: visibleHistoryBeforeAssistant,
        conversationScopeId,
        saveStatus: '',
        isAgentLoading: false,
        activeRequestId: '',
        agentStatus: errorStatus,
      });
      showSaveStatus(`错误：${message}`, 'error');
    } finally {
      if (activeRequestRef.current === requestId) setIsAgentLoading(false);
    }
  };

  const retryLastContentRequest = useCallback(async () => {
    if (isAgentLoading || agentStatus?.kind !== 'error') return;

    const latestUserIndex = conversationHistory
      .map((message) => message.role)
      .lastIndexOf('user');
    if (latestUserIndex < 0) return;

    const latestUserMessage = conversationHistory[latestUserIndex];
    const retryHistory = trimVisibleConversation(conversationHistory);
    const baseTopic = resolveDraftConversationTopic(activeDraft) || activeTopicRef.current || latestUserMessage.content;
    const requestId = createClientEventId('content-retry');
    const controller = new AbortController();

    activeTopicRef.current = baseTopic;
    activeRequestRef.current = requestId;
    abortControllerRef.current = controller;
    pendingAutoScrollRef.current = true;
    setAgentStatus(null);
    setIsAgentLoading(true);
    showSaveStatus('', 'info');
    writeStoredContentChatState({
      activeDraft,
      activeTopic: baseTopic,
      conversationHistory: retryHistory,
      conversationScopeId,
      saveStatus: '',
      isAgentLoading: true,
      activeRequestId: requestId,
      agentStatus: null,
    });

    try {
      const result = await callContentAgent(baseTopic, latestUserMessage.content, retryHistory, activeDraft?.structured, controller.signal);
      if (activeRequestRef.current !== requestId) return;

      const structured = result?.structured ?? null;
      const assistantText = result?.assistantText ?? (structured ? stringifyDraft(structured) : '我先按讨论继续帮你梳理，等内容方向确认后再输出完整笔记。');
      const suggestions = result?.suggestions ?? [];
      const assistantMessage: ConversationMessage = result?.discussionOnly || !structured
        ? { role: 'assistant', content: assistantText }
        : { role: 'assistant', content: assistantText, draft: structured, suggestions, canSave: true };
      const finalHistory = trimVisibleConversation([...retryHistory, assistantMessage]);

      if (result?.discussionOnly || !structured) {
        activeRequestRef.current = '';
        abortControllerRef.current = null;
        pendingAutoScrollRef.current = true;
        setConversationHistory(finalHistory);
        setAgentStatus(null);
        setIsAgentLoading(false);
        writeStoredContentChatState(
          {
            activeDraft,
            activeTopic: baseTopic,
            conversationHistory: finalHistory,
            conversationScopeId,
            saveStatus: '',
            isAgentLoading: false,
            activeRequestId: '',
            agentStatus: null,
          },
          true,
        );
        return;
      }

      const nextDraftSource = activeDraft?.draftSource || buildDraftSource(baseTopic, writingEntrySourceRef.current);
      const nextDraft: DraftItem = activeDraft
        ? {
            id: activeDraft.id,
            title: structured.noteTitle,
            status: activeDraft.status || '待优化',
            source: formatDraftSourceLabel(nextDraftSource, activeDraft.draftSource ? undefined : activeDraft.source, structured.noteTitle),
            draftSource: nextDraftSource,
            createdAt: activeDraft.createdAt || new Date().toISOString(),
            body: stringifyDraft(structured),
            structured,
            cardPreview: structured.cardPreview,
            tags: structured.tags.slice(0, 4),
            updatedAt: formatToday(),
            personaRecordId: activeDraft.personaRecordId || activePersonaUsage.personaRecordId,
            personaTitle: activeDraft.personaTitle || activePersonaUsage.personaTitle,
            personaSource: activeDraft.personaSource || activePersonaUsage.personaSource,
          }
        : {
            id: createContentDraftId(),
            title: structured.noteTitle || baseTopic,
            status: '待优化',
            source: formatDraftSourceLabel(nextDraftSource, undefined, baseTopic),
            draftSource: nextDraftSource,
            tags: structured.tags.slice(0, 4),
            updatedAt: formatToday(),
            createdAt: new Date().toISOString(),
            body: stringifyDraft(structured),
            structured,
            cardPreview: structured.cardPreview,
            ...activePersonaUsage,
          };

      window.sessionStorage.setItem(ACTIVE_DRAFT_STORAGE_KEY, nextDraft.id);
      activeRequestRef.current = '';
      abortControllerRef.current = null;
      pendingAutoScrollRef.current = true;
      setActiveDraft(nextDraft);
      setConversationHistory(finalHistory);
      setAgentStatus(null);
      setIsAgentLoading(false);
      writeStoredContentChatState(
        {
          activeDraft: nextDraft,
          activeTopic: baseTopic,
          conversationHistory: finalHistory,
          conversationScopeId,
          saveStatus: '',
          isAgentLoading: false,
          activeRequestId: '',
          agentStatus: null,
        },
        true,
      );
    } catch (error) {
      if (activeRequestRef.current !== requestId) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        const stoppedStatus: AgentStatusState = { kind: 'stopped', message: '本次输出已停止。' };
        setConversationHistory(retryHistory);
        setAgentStatus(stoppedStatus);
        activeRequestRef.current = '';
        abortControllerRef.current = null;
        setIsAgentLoading(false);
        writeStoredContentChatState({
          activeDraft,
          activeTopic: baseTopic,
          conversationHistory: retryHistory,
          conversationScopeId,
          saveStatus: '',
          isAgentLoading: false,
          activeRequestId: '',
          agentStatus: stoppedStatus,
        });
        showSaveStatus('本次输出已停止。', 'info');
        return;
      }

      const message = error instanceof Error ? error.message : '生成失败';
      const errorStatus: AgentStatusState = { kind: 'error', message: `出错了：${message}` };
      setConversationHistory(retryHistory);
      setAgentStatus(errorStatus);
      activeRequestRef.current = '';
      abortControllerRef.current = null;
      setIsAgentLoading(false);
      writeStoredContentChatState({
        activeDraft,
        activeTopic: baseTopic,
        conversationHistory: retryHistory,
        conversationScopeId,
        saveStatus: '',
        isAgentLoading: false,
        activeRequestId: '',
        agentStatus: errorStatus,
      });
      showSaveStatus(`错误：${message}`, 'error');
    }
  }, [activeDraft, activePersonaUsage, agentStatus, callContentAgent, conversationHistory, conversationScopeId, isAgentLoading, showSaveStatus]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isAgentLoading) {
      return;
    }
    if (Date.now() - stopTriggeredAtRef.current < 500) {
      return;
    }
    const content = input.trim();
    if (!content) return;
    if (!validateInputLength(content)) return;
    if (!isAuthenticated) {
      openUnlockDialog({
        title: '登录后解锁完整功能',
        descriptionLines: ['热门追踪和内容撰写需要基于', '你的人设信息、历史记录和草稿内容生成'],
        redirectTo: '/content',
      });
      return;
    }

    if (viewMode === 'drafts') {
      writingEntrySourceRef.current = {
        sourceType: 'manual_input',
        inputText: content,
        topicTitle: content,
      };
      void createDraft(content);
      return;
    }

    if (hasReachedConversationHardStop(conversationHistory)) {
      showSaveStatus(CONVERSATION_LIMIT_NOTICE, 'error');
      return;
    }
    void reviseDraft(content);
  };

  if (status === 'loading') {
    return (
      <AuthStateFallback
        title="正在确认登录状态"
        description="正在读取你的账号信息，确认后会继续加载内容撰写页。"
      />
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthStateFallback
        title="正在跳转登录入口"
        description="内容撰写需要登录后使用，正在为你打开登录弹窗并返回首页。"
      />
    );
  }

  return (
      <RequirePersona
        emptyTitle="内容撰写需要先有人设"
        emptyDescription="先完成人设打造并保存，这样内容撰写才能结合你的人设定位、内容风格和热门上下文生成更贴合的草稿。"
      >
      <TopToast
        message={saveStatus}
        tone={noticeTone}
      />
      <div className="flex h-full w-full flex-col overflow-hidden px-[5.5vw] pb-6 pt-7">
        {viewMode === 'drafts' ? (
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mx-auto mt-8 w-full max-w-[980px] shrink-0 text-center">
              <h1 className="koc-title-font koc-gradient-title text-[30px] leading-tight">Hi，我是你的写作小猪梨</h1>
            <p className="koc-song-font mt-2 text-[22px] leading-tight text-[var(--foreground)]">我会结合你的人设与热门选题，帮你生成更有账号风格的小红书笔记</p>
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
                if (event.key === 'Enter' && isAgentLoading) {
                  event.preventDefault();
                }
              }}
              placeholder={isAgentLoading ? '等待回复中…' : '输入你想写的主题，开始创作你的笔记'}
              className="koc-song-font koc-chat-placeholder min-w-0 flex-1 bg-transparent text-[17px] text-[var(--foreground)] outline-none"
            />
            <button
              type={isAgentLoading ? 'button' : 'submit'}
              onClick={isAgentLoading ? requestStop : undefined}
              className="grid size-11 place-items-center text-[29px] text-[var(--foreground)] transition hover:scale-105 disabled:opacity-45"
              aria-label={isAgentLoading ? '停止生成' : '发送'}
              title={isAgentLoading ? '停止生成' : '发送'}
              disabled={!isAgentLoading && !input.trim()}
            >
              {isAgentLoading ? <StopGenerationIcon /> : <Image src="/koc-assets/icons/图标/发送.svg" alt="" width={24} height={24} className="size-[24px]" />}
            </button>
          </form>
          {agentStatus && !isAgentLoading && (
            <div className="mx-auto mt-4 w-full max-w-[860px] shrink-0">
              <AgentStatusMessage
                status={agentStatus}
                onRefresh={agentStatus.kind === 'error' ? () => void retryLastContentRequest() : undefined}
                refreshDisabled={isAgentLoading}
              />
            </div>
          )}
          {isAgentLoading && (
            <div className="mx-auto mt-4 w-full max-w-[860px] shrink-0">
                      <AgentStatusMessage status={{ kind: 'running', message: '小猪梨灵感加载中...' }} />
            </div>
          )}

          <div className="mx-auto mt-6 flex min-h-0 w-full max-w-[980px] flex-1 flex-col">
            <div className="mb-4">
              <h2 className="koc-heading-font text-[24px] leading-tight text-[var(--foreground)]">我的创作草稿箱</h2>
              <p className="mt-2 text-[13px] font-semibold leading-5 text-[var(--foreground)]">保存你生成和优化过的小红书笔记，方便继续修改、复盘选题和延续账号风格</p>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-8 pr-3">
            <div className="grid gap-7 md:grid-cols-2">
              {drafts.map((draft) => {
                return (
                  <div
                    key={draft.id}
                    className="group relative min-h-[210px] rounded-[22px] border border-[var(--box-border)] bg-[rgba(245,245,245,0.8)] p-5 shadow-[var(--box-shadow)]"
                  >
                    <button
                      type="button"
                      onClick={() => openDraft(draft)}
                      className="block h-full w-full text-left"
                    >
                      <div className="flex items-start">
                        <h3 className="koc-heading-font text-[18px] leading-tight text-[var(--foreground)]">{getDraftCardTitle(draft)}</h3>
                      </div>

                      <div className="mt-5 space-y-3 text-[16px] leading-7 text-[var(--foreground)]">
                        <p className="koc-heading-font">来源</p>
                        <p className="break-words">{formatDraftCardSource(draft)}</p>
                        <p className="koc-heading-font">使用人设</p>
                        <p className="line-clamp-1">{draft.personaTitle || '未记录人设'}</p>
                        <p className="koc-heading-font">标签</p>
                        <p className="line-clamp-1">{(draft.tags || []).slice(0, 3).map((tag) => `#${tag}`).join(' ') || '#内容创作 #经验分享'}</p>
                      </div>
                      <p className="koc-heading-font mt-3 text-right text-[18px] text-[var(--foreground)]">{draft.updatedAt || draft.createdAt.slice(0, 10).replaceAll('-', '/')}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteDraft(draft)}
                      className="absolute right-3 top-3 rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.94)] px-2.5 py-1 text-[12px] text-[var(--foreground)] opacity-0 shadow-[var(--box-shadow)] transition hover:bg-[rgba(255,255,255,0.82)] group-hover:opacity-100"
                      title="删除草稿"
                    >
                      删除
                    </button>
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
            subtitle="你的内容撰写小助手~"
            action={
              <button
                type="button"
                onClick={returnToDrafts}
                className="koc-heading-font koc-primary-back-button shrink-0 rounded-full px-5 py-3 text-[18px] text-[var(--foreground)] transition hover:bg-[rgba(255,255,255,0.42)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[rgba(255,255,255,0.3)]"
                disabled={isAgentLoading}
              >
                返回
              </button>
            }
          />

          <div
            ref={chatScrollRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              window.sessionStorage.setItem(CONTENT_CHAT_SCROLL_TOP_STORAGE_KEY, String(el.scrollTop));
              setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
            }}
            className="mx-auto min-h-0 w-full max-w-[980px] flex-1 space-y-4 overflow-y-auto px-5 pb-8 text-[15px] leading-[1.7] text-[var(--foreground)] sm:px-7"
          >
            {conversationHistory.filter((message) => !isLegacyAgentStatusContent(message.content)).map((message, index) => (
              <div key={`${index}-${message.role}-${message.content.slice(0, 20)}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {message.role === 'user' ? (
                  <ChatMessageBubble variant="user" inheritTextColor>
                    <MarkdownText content={message.content} inheritTextColor />
                  </ChatMessageBubble>
                ) : (
                  <div className="mr-[12%] w-full max-w-[min(74%,720px)] space-y-3">
                    <ChatMessageBubble variant="assistant" innerClassName={message.draft ? 'space-y-5' : ''}>
                      {message.draft ? <DraftRenderer draft={message.draft} /> : <MarkdownText content={message.content} />}
                    </ChatMessageBubble>
                    {message.draft && message.suggestions && message.suggestions.length > 0 && !isAgentLoading && index === conversationHistory.length - 1 && (
                      <div className="flex flex-wrap gap-3">
                        {message.suggestions.map((suggestion) => (
                          <button
                            key={`${suggestion.intent}-${suggestion.label}`}
                            type="button"
                            onClick={() => void reviseDraft(suggestion.instruction)}
                            className="koc-input-font rounded-[10px] border border-[var(--box-border)] bg-[rgba(245,245,245,0.45)] px-5 py-2.5 text-[14px] text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-[rgba(245,245,245,0.6)]"
                          >
                            {suggestion.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <MessageActions
                        copyEvent={buildContentCopyEvent(
                          message,
                          index,
                          message.draft ? 'message_action_button_xhs_publish' : 'message_action_button',
                          getContentCopyText(message).length,
                        )}
                        copyText={getContentCopyText(message)}
                        onRefresh={() => void refreshContentMessage(index)}
                        onSave={message.draft && index === conversationHistory.length - 1 ? () => void saveContentMessage(message) : undefined}
                        refreshDisabled={isAgentLoading}
                        saving={isSaving}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
            {agentStatus && !isAgentLoading && (
              <AgentStatusMessage
                status={agentStatus}
                onRefresh={agentStatus.kind === 'error' ? () => void retryLastContentRequest() : undefined}
                refreshDisabled={isAgentLoading}
              />
            )}
                {isAgentLoading && <AgentStatusMessage status={{ kind: 'running', message: '小猪梨灵感加载中...' }} />}
          </div>
          {showScrollDown && (
            <ScrollToBottomButton onClick={scrollChatToBottom} />
          )}

          <ChatInputShell>
            <form
              onSubmit={handleSubmit}
              className="koc-chat-input-surface flex h-[72px] w-full items-center rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] px-5 sm:px-7"
            >
              <input
                value={input}
                onChange={(event) => updateInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (isAgentLoading || hasReachedConversationLimit)) {
                  event.preventDefault();
                }
              }}
              placeholder={hasReachedConversationLimit ? CONVERSATION_LIMIT_NOTICE : isAgentLoading ? '等待回复中…' : '输入修改意见，我会继续优化这篇笔记'}
              className="koc-song-font koc-chat-placeholder min-w-0 flex-1 bg-transparent text-[16px] text-[var(--foreground)] outline-none sm:text-[17px]"
              disabled={hasReachedConversationLimit}
            />
              <button
                type={isAgentLoading ? 'button' : 'submit'}
                onClick={isAgentLoading ? requestStop : undefined}
                className="grid size-11 place-items-center text-[29px] text-[var(--foreground)] transition hover:scale-105 disabled:opacity-45"
                aria-label={isAgentLoading ? '停止生成' : '发送'}
                title={isAgentLoading ? '停止生成' : '发送'}
                disabled={(!isAgentLoading && !input.trim()) || hasReachedConversationLimit}
              >
                {isAgentLoading ? <StopGenerationIcon /> : <Image src="/koc-assets/icons/图标/发送.svg" alt="" width={24} height={24} className="size-[24px]" />}
              </button>
            </form>
          </ChatInputShell>
        </section>
        )}
      </div>
      </RequirePersona>
  );
}

export default function ContentPage() {
  return (
    <Suspense fallback={<ContentPageLoadingFallback />}>
      <ContentPageInner />
    </Suspense>
  );
}
