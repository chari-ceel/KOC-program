'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useAppState } from '@/context/AppStateContext';
import { useAuth } from '@/context/AuthContext';
import { API_BASE, isRecord, readJsonResponse } from '@/lib/api';
import {
  CHAT_INPUT_MAX_CHARS,
  countTextChars,
  CONVERSATION_LIMIT_NOTICE,
  hasReachedConversationHardStop,
  limitTextChars,
  trimVisibleConversation,
} from '@/lib/conversation-memory';
import { parseDelimitedList, useDelimitedListInput } from '@/lib/list-input';
import MarkdownText from '@/components/MarkdownText';
import LoginButton from '@/components/LoginButton';
import MessageActions from '@/components/MessageActions';
import ScenarioHeader from '@/components/ScenarioHeader';
import TopToast from '@/components/TopToast';
import AgentStatusMessage from '@/components/AgentStatusMessage';
import ScrollToBottomButton from '@/components/ScrollToBottomButton';
import ChatInputShell from '@/components/ChatInputShell';
import ChatMessageBubble from '@/components/ChatMessageBubble';
import StopGenerationIcon from '@/components/StopGenerationIcon';
import {
  ANONYMOUS_PERSONA_GENERATED_STORAGE_KEY,
  PERSONA_STORAGE_KEY,
  SELECTED_PERSONA_STORAGE_KEY,
  formatPersonaList,
  getPersonaCardViewModel,
  isPersonaJson,
  normalizePersonaRecord,
  normalizePersonaJson,
  personaToProfile,
  readSelectedPersona,
  writeSelectedPersona,
  type PersonaBasicInfo,
  type PersonaJson,
  type PersonaRecord,
} from '@/lib/persona';
import {
  isLegacyAgentStatusContent,
  readStoredAgentStatus,
  splitTrailingLegacyAgentStatus,
  type AgentStatusState,
} from '@/lib/agent-status';
import { normalizeAiMarkdown } from '@/lib/markdown-normalize';
import {
  clearConversationId,
  createClientEventId,
  getOrCreateConversationId,
  trackAnalyticsEvent,
  type AgentOutputCopyEvent,
} from '@/lib/analytics';
import { createConversationScopeId } from '@/lib/conversation-scope';

type ViewMode = 'form' | 'chat';
type ChatRole = 'assistant' | 'user';

type BasicInfo = PersonaBasicInfo;

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  personaPayload?: Record<string, unknown>;
  followUpQuestions?: string[];
}

const defaultInfo: BasicInfo = {
  gender: '女',
  age: '',
  occupation: '',
  interests: [],
  skills: [],
};

const CREATOR_PROFILE_QUESTIONS = [
  '你平时最常看哪几类小红书内容？',
  '你最容易点赞或收藏哪类笔记？',
  '你喜欢哪类博主或账号，为什么喜欢？',
  '你最不喜欢哪种内容风格或表达？',
  '你更像哪种表达方式：搞笑、温柔、犀利、真实记录、知识分享还是治愈陪伴？',
  '朋友通常会怎么形容你？',
  '你手上常有哪类图片素材？',
  '你愿不愿意露脸，能接受到什么程度？',
  '你最常出现的生活场景有哪些？',
  '你喜欢什么封面风格？',
  '你喜欢什么标题和正文风格？',
  '你希望账号吸引什么样的人，不想被贴什么标签？',
];

const LEGACY_PERSONA_SAVE_STATUS_KEY = 'koc-agent-persona-save-status';
const PROFILE_VIEW_MODE_STORAGE_KEY = 'koc-agent-profile-view-mode';
const PROFILE_CHAT_STATE_STORAGE_KEY = 'koc-agent-profile-chat-state';
const PROFILE_FORM_DRAFT_STORAGE_KEY = 'koc-agent-profile-form-draft';
  const PROFILE_CHAT_SCROLL_TOP_STORAGE_KEY = 'koc-agent-profile-chat-scroll-top';
  const PROFILE_CONVERSATION_ID_STORAGE_KEY = 'koc-analytics-profile-conversation-id';
interface StoredProfileChatState {
  info: BasicInfo;
  messages: ChatMessage[];
  conversationScopeId: string;
  draftMessage: string;
  isLoading: boolean;
  agentStatus?: AgentStatusState | null;
}

interface StoredProfileFormDraftState {
  info: BasicInfo;
  interestsInputValue: string;
  skillsInputValue: string;
}

type NoticeTone = 'success' | 'error' | 'info';

function extractPersonaPayload(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readPersonaSummaryFromPayload(payload: Record<string, unknown> | null) {
  if (!payload) return null;
  const draft = isRecord(payload.personaDraft) ? payload.personaDraft : payload;
  const persona = isRecord(draft.persona) ? draft.persona : {};
  const niche = isRecord(draft.niche) ? draft.niche : {};

  return {
    title: readString(persona.name) || readString(persona.title),
    description:
      readString(persona.description) || readString(persona.positioning) || readString(persona.personaPosition),
    primaryNiche: readString(niche.primary) || readString(niche.direction),
    secondaryNiche: readStringList(niche.secondary),
    audience: readStringList(draft.audience),
    contentStyle: readStringList(draft.contentStyle),
    referenceCreatorDirections: readStringList(draft.referenceCreatorDirections ?? payload.referenceCreatorDirections),
    followUpQuestions: readStringList(payload.followUpQuestions ?? payload.nextQuestions),
  };
}

function readPersonaCardPreviewFromPayload(payload: Record<string, unknown> | null) {
  if (!payload) return undefined;
  const draft = isRecord(payload.personaDraft) ? payload.personaDraft : payload;
  const cardPreview = isRecord(draft.cardPreview) ? draft.cardPreview : {};
  const normalized = {
    personaLabel: readString(cardPreview.personaLabel),
    baseProfile: readString(cardPreview.baseProfile),
    keywordsLabel: readString(cardPreview.keywordsLabel),
    audienceLabel: readString(cardPreview.audienceLabel) || readString(cardPreview.interestLabel),
    toneLabel: readString(cardPreview.toneLabel),
  };

  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function buildPersonaJson(info: BasicInfo, messages: ChatMessage[], personaPayload?: Record<string, unknown> | null): PersonaJson {
  const summary = readPersonaSummaryFromPayload(personaPayload ?? null);
  const cardPreview = readPersonaCardPreviewFromPayload(personaPayload ?? null);
  const keywords = [...info.interests, ...info.skills];
  const personaTitle = summary?.title || `${info.occupation || '创作者'}内容定位`;
  const personaPosition =
    [personaTitle, summary?.primaryNiche, ...(summary?.secondaryNiche || [])].filter(Boolean).join(' / ') ||
    `${info.occupation || '内容创作者'} / ${formatPersonaList(info.interests.slice(0, 3)) || '兴趣探索'} / ${formatPersonaList(info.skills.slice(0, 3)) || '技能成长'}`;
  const contentTone = summary?.contentStyle?.length ? formatPersonaList(summary.contentStyle) : '专业、耐心、细致、通俗易懂';
  const payloadAudience = summary?.audience || [];
  const payloadKeywords = [summary?.primaryNiche || '', ...(summary?.secondaryNiche || []), ...payloadAudience].filter(Boolean);

  return {
    title: personaTitle,
    basicInfo: info,
    keywords: Array.from(new Set([...payloadKeywords, ...keywords])).slice(0, 12),
    personaPosition,
    contentTone,
    conversation: messages.map(({ role, content }) => ({ role, content: normalizeAiMarkdown(content).trim() })),
    savedAt: new Date().toISOString(),
    persona:
      summary?.title || summary?.description
        ? {
            name: summary?.title,
            description: summary?.description,
          }
        : undefined,
    niche:
      summary?.primaryNiche || summary?.secondaryNiche?.length
        ? {
            primary: summary?.primaryNiche,
            secondary: summary?.secondaryNiche,
          }
        : undefined,
    audience: payloadAudience.length > 0 ? payloadAudience : undefined,
    contentStyle: summary?.contentStyle?.length ? summary.contentStyle : undefined,
    cardPreview,
    referenceCreatorDirections:
      summary?.referenceCreatorDirections?.length ? summary.referenceCreatorDirections : undefined,
    followUpQuestions: summary?.followUpQuestions?.length ? summary.followUpQuestions : undefined,
  };
}

function buildSavedPersonaDraftPayload(persona: PersonaJson): Record<string, unknown> {
  return {
    structuredResult: {
      personaDraft: {
        persona: persona.persona,
        niche: persona.niche,
        audience: persona.audience,
        contentStyle: persona.contentStyle,
        referenceCreatorDirections: persona.referenceCreatorDirections,
        cardPreview: persona.cardPreview,
      },
      discussionOnly: false,
    },
    discussionOnly: false,
  };
}

function formatSavedPersonaDraftReply(persona: PersonaJson) {
  const payload = buildSavedPersonaDraftPayload(persona);
  const formattedDraft = formatPersonaDraft(payload);
  if (formattedDraft) {
    return formattedDraft;
  }

  const fallbackLines = ['## 当前人设草稿', ''];
  if (persona.personaPosition) {
    fallbackLines.push(`- **人设定位：** ${persona.personaPosition}`);
  }
  if (persona.keywords.length) {
    fallbackLines.push(`- **关键词：** ${formatPersonaList(persona.keywords)}`);
  }
  if (persona.contentTone) {
    fallbackLines.push(`- **内容风格：** ${persona.contentTone}`);
  }
  return fallbackLines.filter(Boolean).join('\n');
}

function readSavedPersona(): PersonaJson | null {
  if (typeof window === 'undefined') return null;

  const raw = window.localStorage.getItem(PERSONA_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return isPersonaJson(parsed) ? parsed : normalizePersonaJson(parsed);
  } catch {
    return null;
  }
}

function readStoredProfileChatState(): StoredProfileChatState | null {
  const raw = window.sessionStorage.getItem(PROFILE_CHAT_STATE_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredProfileChatState>;
    if (!parsed.info || !Array.isArray(parsed.messages)) return null;
    const info = parsed.info;
    if (
      typeof info.gender !== 'string' ||
      typeof info.age !== 'string' ||
      typeof info.occupation !== 'string' ||
      !Array.isArray(info.interests) ||
      !Array.isArray(info.skills)
    ) {
      return null;
    }

    return {
      ...(() => {
        const messagesWithStatusSplit = splitTrailingLegacyAgentStatus(
          trimVisibleConversation(parsed.messages.filter(
            (message): message is ChatMessage =>
              typeof message?.id === 'string' &&
              (message.role === 'user' || message.role === 'assistant') &&
              typeof message.content === 'string' &&
              (!('personaPayload' in message) || typeof message.personaPayload === 'object' || message.personaPayload == null) &&
              (!('followUpQuestions' in message) ||
                (Array.isArray(message.followUpQuestions) && message.followUpQuestions.every((item) => typeof item === 'string'))),
          )),
        );
        return {
          messages: messagesWithStatusSplit.messages,
          agentStatus: readStoredAgentStatus(parsed.agentStatus) || messagesWithStatusSplit.agentStatus,
        };
      })(),
      info: {
        gender: info.gender,
        age: info.age,
        occupation: info.occupation,
        interests: info.interests.filter((item): item is string => typeof item === 'string'),
        skills: info.skills.filter((item): item is string => typeof item === 'string'),
      },
      conversationScopeId:
        typeof parsed.conversationScopeId === 'string' && parsed.conversationScopeId
          ? parsed.conversationScopeId
          : createConversationScopeId('persona'),
      draftMessage: typeof parsed.draftMessage === 'string' ? parsed.draftMessage : '',
      isLoading: Boolean(parsed.isLoading),
    };
  } catch {
    return null;
  }
}

function writeStoredProfileChatState(state: StoredProfileChatState) {
  window.sessionStorage.setItem(
    PROFILE_CHAT_STATE_STORAGE_KEY,
    JSON.stringify({ ...state, messages: trimVisibleConversation(state.messages) }),
  );
}

function readStoredProfileFormDraftState(): StoredProfileFormDraftState | null {
  const raw = window.sessionStorage.getItem(PROFILE_FORM_DRAFT_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<StoredProfileFormDraftState>;
    if (!parsed.info) return null;
    const info = parsed.info;
    if (
      typeof info.gender !== 'string' ||
      typeof info.age !== 'string' ||
      typeof info.occupation !== 'string' ||
      !Array.isArray(info.interests) ||
      !Array.isArray(info.skills)
    ) {
      return null;
    }

    return {
      info: {
        gender: info.gender,
        age: info.age,
        occupation: info.occupation,
        interests: info.interests.filter((item): item is string => typeof item === 'string'),
        skills: info.skills.filter((item): item is string => typeof item === 'string'),
      },
      interestsInputValue: typeof parsed.interestsInputValue === 'string' ? parsed.interestsInputValue : '',
      skillsInputValue: typeof parsed.skillsInputValue === 'string' ? parsed.skillsInputValue : '',
    };
  } catch {
    return null;
  }
}

function writeStoredProfileFormDraftState(state: StoredProfileFormDraftState) {
  window.sessionStorage.setItem(PROFILE_FORM_DRAFT_STORAGE_KEY, JSON.stringify(state));
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function readStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim());
  }
  const text = readString(value);
  return text ? [text] : [];
}

function uniqueQuestionList(values: string[], limit = 12) {
  const result: string[] = [];
  for (const value of values) {
    const question = value.trim();
    if (!question || result.includes(question)) continue;
    result.push(question);
    if (result.length >= limit) break;
  }
  return result;
}

function readPersonaFollowUpQuestions(payload: unknown, includeDefaultQuestions = false) {
  const data = isRecord(payload) ? payload : {};
  const modelQuestions = readStringList(data.nextQuestions ?? data.followUpQuestions);
  const baseQuestions = includeDefaultQuestions ? CREATOR_PROFILE_QUESTIONS : [];
  return uniqueQuestionList([...baseQuestions, ...modelQuestions], 3);
}

function getVisibleFollowUpQuestions(messages: ChatMessage[], index: number) {
  const message = messages[index];
  if (!message?.followUpQuestions?.length) return [];
  const previousQuestions = new Set(
    messages
      .slice(0, index)
      .flatMap((item) => item.followUpQuestions || [])
      .map((item) => item.trim())
      .filter(Boolean),
  );
  return message.followUpQuestions.filter((question) => !previousQuestions.has(question.trim())).slice(0, 3);
}

function resolveStructuredPersonaSource(payload: Record<string, unknown> | null) {
  if (!payload) return null;
  if (isRecord(payload.structuredResult)) return payload.structuredResult;
  return payload;
}

function resolvePersonaDraftSource(payload: Record<string, unknown> | null) {
  const source = resolveStructuredPersonaSource(payload);
  if (!source) return null;
  if (isRecord(source.personaDraft)) return source.personaDraft;
  return source;
}

function hasCompletePersonaDraft(payload: Record<string, unknown> | null) {
  const draft = resolvePersonaDraftSource(payload);
  if (!draft) return false;

  const persona = isRecord(draft.persona) ? draft.persona : {};
  const niche = isRecord(draft.niche) ? draft.niche : {};
  const personaName = readString(persona.name) || readString(persona.title);
  const personaDescription =
    readString(persona.description) || readString(persona.positioning) || readString(persona.personaPosition);
  const primaryNiche = readString(niche.primary) || readString(niche.direction);
  const secondaryNiche = readStringList(niche.secondary);
  const audience = readStringList(draft.audience);
  const contentStyle = readStringList(draft.contentStyle);

  return Boolean(
    (personaName || personaDescription) &&
      (primaryNiche || secondaryNiche.length) &&
      audience.length &&
      contentStyle.length,
  );
}

function formatPersonaDraft(data: Record<string, unknown>) {
  const draft = resolvePersonaDraftSource(data);
  if (!draft) return '';

  const persona = isRecord(draft.persona) ? draft.persona : {};
  const niche = isRecord(draft.niche) ? draft.niche : {};
  const personaName = readString(persona.name) || readString(persona.title);
  const personaDescription =
    readString(persona.description) || readString(persona.positioning) || readString(persona.personaPosition);
  const primaryNiche = readString(niche.primary) || readString(niche.direction);
  const secondaryNiche = readStringList(niche.secondary);
  const audience = readStringList(draft.audience);
  const contentStyle = readStringList(draft.contentStyle);

  const lines = [];
  if (personaName || personaDescription) {
    lines.push(`- **人设定位：** ${[personaName, personaDescription].filter(Boolean).join('，')}`);
  }
  if (primaryNiche || secondaryNiche.length) {
    lines.push(`- **内容方向：** ${formatPersonaList([primaryNiche, ...secondaryNiche].filter(Boolean))}`);
  }
  if (audience.length) {
    lines.push(`- **目标受众：** ${formatPersonaList(audience)}`);
  }
  if (contentStyle.length) {
    lines.push(`- **内容风格：** ${formatPersonaList(contentStyle)}`);
  }

  return lines.length ? ['## 当前人设草稿', '', ...lines].join('\n') : '';
}

function isStructuredPersonaPayload(payload: unknown) {
  const data = isRecord(payload) ? payload : {};
  if (isRecord(data.structuredResult)) {
    return true;
  }
  if (typeof data.discussionOnly === 'boolean') {
    return data.discussionOnly === false;
  }
  return hasCompletePersonaDraft(data);
}

function formatPersonaFollowUpReply(payload: unknown) {
  const data = isRecord(payload) ? payload : {};
  const reply = readString(data.reply) || '收到。还可以继续补充更多信息以完善人设。';
  const personaDraft = isStructuredPersonaPayload(data) && !replyContainsPersonaDraftSection(reply) ? formatPersonaDraft(data) : '';

  return [reply, personaDraft].filter(Boolean).join('\n\n');
}

function replyContainsPersonaDraftSection(reply: string) {
  if (!reply) return false;
  return /(?:^|\n)\s*#{1,6}\s*(当前人设草稿|初版人设|人设草稿)\s*(?:\n|$)/i.test(reply);
}

function formatPersonaAnalyzeReply(payload: unknown) {
  const data = isRecord(payload) ? payload : {};
  const persona = isRecord(data.persona) ? data.persona : {};
  const niche = isRecord(data.niche) ? data.niche : {};
  const personaName = readString(persona.name) || readString(persona.title);
  const personaDescription =
    readString(persona.description) || readString(persona.positioning) || readString(persona.personaPosition);
  const primaryNiche = readString(niche.primary) || readString(niche.direction);
  const secondaryNiche = readStringList(niche.secondary);
  const audience = readStringList(data.audience);
  const contentStyle = readStringList(data.contentStyle);

  const lines = ['## 初版人设', ''];
  if (personaName || personaDescription) {
    lines.push(`- **人设定位：** ${[personaName, personaDescription].filter(Boolean).join('，')}`);
  }
  if (primaryNiche || secondaryNiche.length) {
    lines.push(`- **内容方向：** ${formatPersonaList([primaryNiche, ...secondaryNiche].filter(Boolean))}`);
  }
  if (audience.length) {
    lines.push(`- **目标受众：** ${formatPersonaList(audience)}`);
  }
  if (contentStyle.length) {
    lines.push(`- **内容风格：** ${formatPersonaList(contentStyle)}`);
  }

  return lines.filter(Boolean).join('\n');
}

function buildProfileCopyEvent(message: ChatMessage, index: number): AgentOutputCopyEvent {
  return {
    eventName: 'agent_output_copy',
    module: 'profile',
    conversationId: getOrCreateConversationId(PROFILE_CONVERSATION_ID_STORAGE_KEY),
    messageId: message.id,
    messageIndex: index,
    messageRole: message.role,
    contentLength: message.content.length,
    copySource: 'message_action_button',
  };
}

export default function ProfilePage() {
  const router = useRouter();
  const { dispatch } = useAppState();
  const { isAuthenticated } = useAuth();
  const [viewMode, setViewMode] = useState<ViewMode>('form');
  const [info, setInfo] = useState<BasicInfo>(defaultInfo);
  const {
    inputValue: interestsInputValue,
    setInputValue: setInterestsInputValue,
    syncFromItems: syncInterestsFromItems,
    normalizeInput: normalizeInterestsInput,
  } = useDelimitedListInput(defaultInfo.interests);
  const {
    inputValue: skillsInputValue,
    setInputValue: setSkillsInputValue,
    syncFromItems: syncSkillsFromItems,
    normalizeInput: normalizeSkillsInput,
  } = useDelimitedListInput(defaultInfo.skills);
  const [personaRecords, setPersonaRecords] = useState<PersonaRecord[]>([]);
  const [isPersonaHistoryLoading, setIsPersonaHistoryLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState<NoticeTone>('info');
  const [noticeKey, setNoticeKey] = useState(0);
  const [draftMessage, setDraftMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationScopeId, setConversationScopeId] = useState(() => createConversationScopeId('persona'));
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatusState | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const conversationLimitToastShownRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const pendingAutoScrollRef = useRef(false);
  const pendingRestoreScrollRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stopTriggeredAtRef = useRef(0);
  const draftMessageRef = useRef('');
  const formDraftHydratedRef = useRef(false);
  const ageInputRef = useRef<HTMLInputElement>(null);
  const occupationInputRef = useRef<HTMLInputElement>(null);
  const interestsInputRef = useRef<HTMLInputElement>(null);
  const skillsInputRef = useRef<HTMLInputElement>(null);

  const requestStop = useCallback(() => {
    stopTriggeredAtRef.current = Date.now();
    abortControllerRef.current?.abort();
  }, []);

  const updateDraftMessage = useCallback((value: string) => {
    if (countTextChars(value) > CHAT_INPUT_MAX_CHARS) {
      window.alert(`已超过 ${CHAT_INPUT_MAX_CHARS} 字限制`);
      setDraftMessage(limitTextChars(value, CHAT_INPUT_MAX_CHARS));
      return;
    }
    setDraftMessage(value);
  }, []);

  const answerFollowUpQuestion = useCallback((question: string) => {
    if (isAgentLoading || hasReachedConversationHardStop(messages)) return;
    const normalizedQuestion = question.replace(/[？?]\s*$/, '');
    const nextValue = `${normalizedQuestion}：`;
    updateDraftMessage(nextValue);
    window.setTimeout(() => chatInputRef.current?.focus(), 0);
  }, [isAgentLoading, messages, updateDraftMessage]);

  const validateDraftMessageLength = useCallback((value: string) => {
    if (countTextChars(value) <= CHAT_INPUT_MAX_CHARS) return true;
    window.alert(`已超过 ${CHAT_INPUT_MAX_CHARS} 字限制`);
    return false;
  }, []);

  const normalizedInterests = useMemo(() => parseDelimitedList(interestsInputValue), [interestsInputValue]);
  const normalizedSkills = useMemo(() => parseDelimitedList(skillsInputValue), [skillsInputValue]);
  const canStart = useMemo(
    () =>
      Boolean(
        info.age.trim() &&
        info.occupation.trim() &&
        interestsInputValue.trim() &&
        skillsInputValue.trim(),
      ),
    [info.age, info.occupation, interestsInputValue, skillsInputValue],
  );
  const applyInfo = useCallback((nextInfo: BasicInfo, rawInputs?: { interestsInputValue?: string; skillsInputValue?: string }) => {
    setInfo(nextInfo);
    if (typeof rawInputs?.interestsInputValue === 'string') {
      setInterestsInputValue(rawInputs.interestsInputValue);
    } else {
      syncInterestsFromItems(nextInfo.interests);
    }
    if (typeof rawInputs?.skillsInputValue === 'string') {
      setSkillsInputValue(rawInputs.skillsInputValue);
    } else {
      syncSkillsFromItems(nextInfo.skills);
    }
  }, [setInterestsInputValue, setSkillsInputValue, syncInterestsFromItems, syncSkillsFromItems]);

  const showNotice = useCallback((message: string, tone: NoticeTone = 'info', autoHide = false) => {
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setNotice(message);
    setNoticeTone(tone);
    if (message) {
      setNoticeKey((current) => current + 1);
    }
    if (autoHide) {
      noticeTimerRef.current = window.setTimeout(() => {
        setNotice('');
        setNoticeTone('info');
        noticeTimerRef.current = null;
      }, 2000);
    }
  }, []);

  useEffect(() => {
    const resetToForm = () => {
      applyInfo(defaultInfo);
      setViewMode('form');
      window.localStorage.setItem(PROFILE_VIEW_MODE_STORAGE_KEY, 'form');
      window.sessionStorage.removeItem(PROFILE_CHAT_STATE_STORAGE_KEY);
      window.sessionStorage.removeItem(PROFILE_FORM_DRAFT_STORAGE_KEY);
      window.localStorage.removeItem(PROFILE_CHAT_SCROLL_TOP_STORAGE_KEY);
      setNotice('');
      setNoticeTone('info');
      setPersonaRecords([]);
      setDraftMessage('');
      setMessages([]);
      setAgentStatus(null);
      setIsAgentLoading(false);
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
        noticeTimerRef.current = null;
      }
    };

    window.addEventListener('koc-profile-open-form', resetToForm);
    return () => window.removeEventListener('koc-profile-open-form', resetToForm);
  }, [applyInfo]);

  useEffect(() => {
    const storedFormDraftState = readStoredProfileFormDraftState();
    const storedChatState = readStoredProfileChatState();
    const savedViewMode = window.localStorage.getItem(PROFILE_VIEW_MODE_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_PERSONA_SAVE_STATUS_KEY);

    const timer = window.setTimeout(() => {
      if (savedViewMode === 'chat' && storedChatState) {
        applyInfo(storedChatState.info);
        setMessages(storedChatState.messages);
        setConversationScopeId(storedChatState.conversationScopeId);
        setDraftMessage(storedChatState.draftMessage);
        setIsAgentLoading(storedChatState.isLoading);
        setAgentStatus(storedChatState.agentStatus ?? null);
        pendingRestoreScrollRef.current = true;
        setViewMode('chat');
        formDraftHydratedRef.current = true;
        return;
      }

      if (storedFormDraftState) {
        applyInfo(storedFormDraftState.info, {
          interestsInputValue: storedFormDraftState.interestsInputValue,
          skillsInputValue: storedFormDraftState.skillsInputValue,
        });
        formDraftHydratedRef.current = true;
        return;
      }

      if (storedChatState) {
        applyInfo(storedChatState.info);
      }

      formDraftHydratedRef.current = true;
    }, 0);

    return () => {
      window.clearTimeout(timer);
      formDraftHydratedRef.current = true;
    };
  }, [applyInfo]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    draftMessageRef.current = draftMessage;
  }, [draftMessage]);

  useEffect(() => {
    if (viewMode !== 'form') return;
    if (!formDraftHydratedRef.current) return;
    writeStoredProfileFormDraftState({
      info,
      interestsInputValue,
      skillsInputValue,
    });
  }, [info, interestsInputValue, skillsInputValue, viewMode]);

  useEffect(() => {
    if (viewMode !== 'chat') return;
    writeStoredProfileChatState({
      info,
      messages,
      conversationScopeId,
      draftMessage,
      isLoading: isAgentLoading,
      agentStatus,
    });
  }, [agentStatus, conversationScopeId, draftMessage, info, isAgentLoading, messages, viewMode]);

  useEffect(() => {
    if (viewMode !== 'chat') return;
    if (pendingAutoScrollRef.current) {
      pendingAutoScrollRef.current = false;
      const timer = window.setTimeout(() => {
        const container = chatScrollRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (pendingRestoreScrollRef.current) {
      pendingRestoreScrollRef.current = false;
      const timer = window.setTimeout(() => {
        const container = chatScrollRef.current;
        if (!container) return;
        const savedTop = Number(window.localStorage.getItem(PROFILE_CHAT_SCROLL_TOP_STORAGE_KEY) || 0);
        container.scrollTop = Number.isFinite(savedTop) ? savedTop : 0;
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [isAgentLoading, messages, viewMode]);

  const scrollChatToBottom = useCallback(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    setShowScrollDown(false);
  }, []);

  const switchViewMode = (nextViewMode: ViewMode) => {
    setViewMode(nextViewMode);
    window.localStorage.setItem(PROFILE_VIEW_MODE_STORAGE_KEY, nextViewMode);
  };

  const updateInfo = <Key extends keyof BasicInfo>(key: Key, value: BasicInfo[Key]) => {
    setInfo((current) => ({ ...current, [key]: value }));
  };

  const syncListField = useCallback((key: 'interests' | 'skills', value: string) => {
    const parsed = key === 'interests' ? normalizeInterestsInput(value) : normalizeSkillsInput(value);
    setInfo((current) => ({ ...current, [key]: parsed }));
  }, [normalizeInterestsInput, normalizeSkillsInput]);

  const focusNextProfileField = useCallback((currentField: 'age' | 'occupation' | 'interests' | 'skills') => {
    const fieldRefs = {
      age: ageInputRef,
      occupation: occupationInputRef,
      interests: interestsInputRef,
      skills: skillsInputRef,
    } as const;
    const fieldOrder: Array<keyof typeof fieldRefs> = ['age', 'occupation', 'interests', 'skills'];
    const currentIndex = fieldOrder.indexOf(currentField);
    const nextField = fieldOrder[(currentIndex + 1) % fieldOrder.length];
    fieldRefs[nextField].current?.focus();
  }, []);

  const handleProfileFieldEnter = useCallback((
    event: KeyboardEvent<HTMLInputElement>,
    currentField: 'age' | 'occupation' | 'interests' | 'skills',
  ) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    if (canStart) {
      const form = event.currentTarget.form;
      form?.requestSubmit();
      return;
    }

    if (currentField === 'interests') {
      syncListField('interests', event.currentTarget.value);
    }
    if (currentField === 'skills') {
      syncListField('skills', event.currentTarget.value);
    }
    focusNextProfileField(currentField);
  }, [canStart, focusNextProfileField, syncListField]);

  const loadPersonaHistory = useCallback(async () => {
    const response = await fetch(`${API_BASE}/api/persona/history`, { credentials: 'include' });
    const result = await readJsonResponse(response);
    const records = isRecord(result) && isRecord(result.data) && Array.isArray(result.data.personaHistory)
      ? result.data.personaHistory.map(normalizePersonaRecord).filter((record): record is PersonaRecord => Boolean(record))
      : [];
    setPersonaRecords(records);
    return records;
  }, []);

  const showSavedInfo = useCallback(async () => {
    if (!isAuthenticated) {
      setPersonaRecords([]);
      showNotice('登录后可以查看长期保存的人设项目。', 'error');
      return;
    }

    setIsPersonaHistoryLoading(true);
    try {
      const records = await loadPersonaHistory();
      showNotice(records.length ? '已读取已保存的人设项目。' : '还没有保存过人设。', 'info');
    } catch (error) {
      console.error('Failed to load persona history', error);
      setPersonaRecords([]);
      showNotice('读取已保存人设失败，请稍后重试。', 'error');
    } finally {
      setIsPersonaHistoryLoading(false);
    }
  }, [isAuthenticated, loadPersonaHistory, showNotice]);

  const openSavedPersonaDraft = useCallback((record?: PersonaRecord) => {
    const saved = record?.persona || readSavedPersona();
    if (!saved) {
      setPersonaRecords([]);
      showNotice('本地还没有保存过人设。', 'info');
      return;
    }

    const savedPersonaPayload = buildSavedPersonaDraftPayload(saved);
    const savedPersonaMessage: ChatMessage = {
      id: `saved-persona-${saved.savedAt || Date.now().toString()}`,
      role: 'assistant',
      content: formatSavedPersonaDraftReply(saved),
      personaPayload: savedPersonaPayload,
    };

    applyInfo(saved.basicInfo);
    setMessages([savedPersonaMessage]);
    setDraftMessage('');
    setAgentStatus(null);
    setIsAgentLoading(false);
    pendingAutoScrollRef.current = true;
    switchViewMode('chat');
    writeStoredProfileChatState({
      info: saved.basicInfo,
      messages: [savedPersonaMessage],
      conversationScopeId,
      draftMessage: '',
      isLoading: false,
      agentStatus: null,
    });
    showNotice('', 'info');
  }, [applyInfo, conversationScopeId, showNotice]);

  const deletePersonaRecord = useCallback(async (record: PersonaRecord) => {
    if (!window.confirm('确定要删除这条人设记录吗？删除后已保存人设中不会再显示。')) return;
    try {
      const response = await fetch(`${API_BASE}/api/persona/record/${encodeURIComponent(record.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !isRecord(result) || result.code !== 200) {
        throw new Error('删除人设记录失败');
      }
      setPersonaRecords((records) => records.filter((item) => item.id !== record.id));
      showNotice('已删除这条人设记录。', 'success', true);
    } catch (error) {
      console.error('Failed to delete persona record', error);
      showNotice('删除人设记录失败，请稍后重试。', 'error');
    }
  }, [showNotice]);

  const openPersonaInModule = useCallback((record: PersonaRecord, target: 'trending' | 'content') => {
    writeSelectedPersona(record, 'history');
    router.push(target === 'trending' ? '/trending' : '/content');
  }, [router]);

  useEffect(() => {
    const selected = readSelectedPersona();
    if (!selected) return;
    window.sessionStorage.removeItem(SELECTED_PERSONA_STORAGE_KEY);
    const timer = window.setTimeout(() => {
      openSavedPersonaDraft({
        id: selected.recordId,
        persona: selected.persona,
        isFavorited: selected.source === 'favorite',
        savedAt: selected.selectedAt,
        expiresAt: null,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openSavedPersonaDraft]);

  const runAnalyzeRequest = useCallback(async (nextInfo: BasicInfo) => {
    const conversationId = getOrCreateConversationId(PROFILE_CONVERSATION_ID_STORAGE_KEY);
    const requestId = createClientEventId('persona-analyze');
    const startedAt = Date.now();
    setPersonaRecords([]);
    showNotice('', 'info');
    setAgentStatus(null);
    setIsAgentLoading(true);
    void trackAnalyticsEvent({
      eventName: 'conversation_turn_started',
      module: 'profile',
      conversationId,
      requestId,
      taskType: 'persona.analyze',
      turnIndex: 1,
      userMessageLength: JSON.stringify(nextInfo).length,
      historyMessageCount: 0,
      status: 'started',
    });

    try {
      const response = await fetch(`${API_BASE}/api/persona/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          basicInfo: nextInfo,
        }),
      });

      const result = await readJsonResponse(response);
      const resultRecord = isRecord(result) ? result : {};

      if (!response.ok || resultRecord.code !== 200) {
        const errorMessage =
          readString(resultRecord.message) || readString(resultRecord.msg) || 'Agent 调用失败';
        setAgentStatus({ kind: 'error', message: `出错了：${errorMessage}` });
        setMessages([]);
        setIsAgentLoading(false);
        writeStoredProfileChatState({
          info: nextInfo,
          messages: [],
          conversationScopeId,
          draftMessage: '',
          isLoading: false,
          agentStatus: { kind: 'error', message: `出错了：${errorMessage}` },
        });
        showNotice(`错误：${errorMessage}`, 'error');
        void trackAnalyticsEvent({
          eventName: 'conversation_turn_failed',
          module: 'profile',
          conversationId,
          requestId,
          taskType: 'persona.analyze',
          turnIndex: 1,
          userMessageLength: JSON.stringify(nextInfo).length,
          historyMessageCount: 0,
          status: 'failed',
          latencyMs: Date.now() - startedAt,
          failureReason: errorMessage,
        });
        return;
      }

      const assistantReply = formatPersonaAnalyzeReply(resultRecord.data);
      const nextMessages: ChatMessage[] = [{
        id: Date.now().toString(),
        role: 'assistant',
        content: assistantReply,
        personaPayload: extractPersonaPayload(resultRecord.data) || undefined,
        followUpQuestions: readPersonaFollowUpQuestions(resultRecord.data, true),
      }];
      if (!isAuthenticated) {
        window.localStorage.setItem(ANONYMOUS_PERSONA_GENERATED_STORAGE_KEY, '1');
      }
      pendingAutoScrollRef.current = true;
      setMessages(nextMessages);
      setIsAgentLoading(false);
      setAgentStatus(null);
      writeStoredProfileChatState({
        info: nextInfo,
        messages: nextMessages,
        conversationScopeId,
        draftMessage: '',
        isLoading: false,
        agentStatus: null,
      });
      switchViewMode('chat');
      void trackAnalyticsEvent({
        eventName: 'conversation_turn_completed',
        module: 'profile',
        conversationId,
        requestId,
        taskType: 'persona.analyze',
        turnIndex: 1,
        userMessageLength: JSON.stringify(nextInfo).length,
        assistantMessageLength: assistantReply.length,
        historyMessageCount: 1,
        status: 'success',
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '网络错误';
      setIsAgentLoading(false);
      setMessages([]);
      setAgentStatus({ kind: 'error', message: `网络出错：${errorMsg}` });
      window.sessionStorage.removeItem(PROFILE_CHAT_STATE_STORAGE_KEY);
      showNotice(`网络出错：${errorMsg}`, 'error');
      void trackAnalyticsEvent({
        eventName: 'conversation_turn_failed',
        module: 'profile',
        conversationId,
        requestId,
        taskType: 'persona.analyze',
        turnIndex: 1,
        userMessageLength: JSON.stringify(nextInfo).length,
        historyMessageCount: 0,
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        failureReason: errorMsg,
      });
    }
  }, [conversationScopeId, isAuthenticated, showNotice]);

  const blockAnonymousPersonaGenerationIfNeeded = useCallback(() => {
    if (isAuthenticated || window.localStorage.getItem(ANONYMOUS_PERSONA_GENERATED_STORAGE_KEY) !== '1') {
      return false;
    }

    showNotice('未登录状态只支持 1 次人设生成。登录后可以继续完善并保存人设。', 'error', true);
    return true;
  }, [isAuthenticated, showNotice]);

  const startChat = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canStart) {
      showNotice('请先填写年龄、职业、兴趣爱好和技能特长，再开始人设打造。', 'error');
      return;
    }
    if (blockAnonymousPersonaGenerationIfNeeded()) {
      return;
    }

    const nextInfo: BasicInfo = {
      ...info,
      interests: normalizedInterests,
      skills: normalizedSkills,
    };

    setInfo(nextInfo);
    syncInterestsFromItems(normalizedInterests);
    syncSkillsFromItems(normalizedSkills);
    await runAnalyzeRequest(nextInfo);
  };

  const runFollowUpRequest = useCallback(async ({
    content,
    nextMessages,
    historyBeforeUser,
    controller,
    draftMessageSnapshot,
  }: {
    content: string;
    nextMessages: ChatMessage[];
    historyBeforeUser: ChatMessage[];
    controller: AbortController;
    draftMessageSnapshot: string;
  }) => {
    const conversationId = getOrCreateConversationId(PROFILE_CONVERSATION_ID_STORAGE_KEY);
    const requestId = createClientEventId('persona-follow-up');
    const startedAt = Date.now();
    const turnIndex = nextMessages.filter((message) => message.role === 'user').length;
    void trackAnalyticsEvent({
      eventName: 'conversation_turn_started',
      module: 'profile',
      conversationId,
      requestId,
      taskType: 'persona.follow_up',
      turnIndex,
      userMessageLength: content.length,
      historyMessageCount: historyBeforeUser.length,
      status: 'started',
    });
    try {
      const response = await fetch(`${API_BASE}/api/persona/follow_up`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          basicInfo: info,
          userMessage: content,
          conversationScopeId,
          conversationHistory: trimVisibleConversation(historyBeforeUser).map(msg => ({
            role: msg.role,
            content: msg.content
          }))
        }),
        signal: controller.signal,
      });

      const result = await readJsonResponse(response);
      const resultRecord = isRecord(result) ? result : {};

      if (!response.ok || resultRecord.code !== 200) {
        const errorMessage =
          readString(resultRecord.message) || readString(resultRecord.msg) || 'Agent 调用失败';
        pendingAutoScrollRef.current = true;
        setMessages(nextMessages);
        setAgentStatus({ kind: 'error', message: `出错了：${errorMessage}` });
        setIsAgentLoading(false);
        writeStoredProfileChatState({
          info,
          messages: nextMessages,
          conversationScopeId,
          draftMessage: '',
          isLoading: false,
          agentStatus: { kind: 'error', message: `出错了：${errorMessage}` },
        });
        showNotice(`错误：${errorMessage}`, 'error');
        void trackAnalyticsEvent({
          eventName: 'conversation_turn_failed',
          module: 'profile',
          conversationId,
          requestId,
          taskType: 'persona.follow_up',
          turnIndex,
          userMessageLength: content.length,
          historyMessageCount: historyBeforeUser.length,
          status: 'failed',
          latencyMs: Date.now() - startedAt,
          failureReason: errorMessage,
        });
        return;
      }

      const assistantReply = formatPersonaFollowUpReply(resultRecord.data);
      const finalMessages: ChatMessage[] = trimVisibleConversation([
        ...nextMessages,
        {
          id: `${Date.now()}-assistant`,
          role: 'assistant',
          content: assistantReply,
          personaPayload: extractPersonaPayload(resultRecord.data) || undefined,
          followUpQuestions: readPersonaFollowUpQuestions(resultRecord.data),
        },
      ]);
      pendingAutoScrollRef.current = true;
      setMessages(finalMessages);
      setIsAgentLoading(false);
      setAgentStatus(null);
      abortControllerRef.current = null;
      writeStoredProfileChatState({
        info,
        messages: finalMessages,
        conversationScopeId,
        draftMessage: '',
        isLoading: false,
        agentStatus: null,
      });
      void trackAnalyticsEvent({
        eventName: 'conversation_turn_completed',
        module: 'profile',
        conversationId,
        requestId,
        taskType: 'persona.follow_up',
        turnIndex,
        userMessageLength: content.length,
        assistantMessageLength: assistantReply.length,
        historyMessageCount: historyBeforeUser.length,
        status: 'success',
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        pendingAutoScrollRef.current = true;
        setMessages(nextMessages);
        setAgentStatus({ kind: 'stopped', message: '本次输出已停止。' });
        setIsAgentLoading(false);
        abortControllerRef.current = null;
        writeStoredProfileChatState({
          info,
          messages: nextMessages,
          conversationScopeId,
          draftMessage: draftMessageSnapshot,
          isLoading: false,
          agentStatus: { kind: 'stopped', message: '本次输出已停止。' },
        });
        showNotice('本次输出已停止。', 'info');
        void trackAnalyticsEvent({
          eventName: 'conversation_turn_failed',
          module: 'profile',
          conversationId,
          requestId,
          taskType: 'persona.follow_up',
          turnIndex,
          userMessageLength: content.length,
          historyMessageCount: historyBeforeUser.length,
          status: 'stopped',
          latencyMs: Date.now() - startedAt,
          failureReason: 'aborted',
        });
        return;
      }
      const errorMsg = error instanceof Error ? error.message : '网络错误';
      pendingAutoScrollRef.current = true;
      setMessages(nextMessages);
      setAgentStatus({ kind: 'error', message: `网络出错：${errorMsg}` });
      setIsAgentLoading(false);
      abortControllerRef.current = null;
      writeStoredProfileChatState({
          info,
          messages: nextMessages,
          conversationScopeId,
          draftMessage: draftMessageSnapshot,
          isLoading: false,
        agentStatus: { kind: 'error', message: `网络出错：${errorMsg}` },
      });
      showNotice(`网络出错：${errorMsg}`, 'error');
      void trackAnalyticsEvent({
        eventName: 'conversation_turn_failed',
        module: 'profile',
        conversationId,
        requestId,
        taskType: 'persona.follow_up',
        turnIndex,
        userMessageLength: content.length,
        historyMessageCount: historyBeforeUser.length,
        status: 'failed',
        latencyMs: Date.now() - startedAt,
        failureReason: errorMsg,
      });
      console.error('Follow-up failed:', error);
    }
  }, [conversationScopeId, info, showNotice]);

  const sendMessage = async () => {
    if (isAgentLoading) return;
    if (Date.now() - stopTriggeredAtRef.current < 500) return;
    const content = draftMessage.trim();
    if (!content) return;
    if (!validateDraftMessageLength(content)) return;
    if (hasReachedConversationHardStop(messages)) {
      showNotice(CONVERSATION_LIMIT_NOTICE, 'error');
      return;
    }

    const userMessage = { id: `${Date.now()}-user`, role: 'user' as ChatRole, content };
    const nextMessages = trimVisibleConversation([...messages, userMessage]);
    const controller = new AbortController();
    pendingAutoScrollRef.current = true;
    setMessages(nextMessages);
    setDraftMessage('');
    showNotice('', 'info');
    setAgentStatus(null);
    setIsAgentLoading(true);
    abortControllerRef.current = controller;
    writeStoredProfileChatState({
      info,
      messages: nextMessages,
      conversationScopeId,
      draftMessage: '',
      isLoading: true,
      agentStatus: null,
    });
    await runFollowUpRequest({
      content,
      nextMessages,
      historyBeforeUser: messages,
      controller,
      draftMessageSnapshot: draftMessageRef.current,
    });
  };

  const savePersona = useCallback(async (messagesToSave = messages) => {
    if (isSaving) return;
    if (!isAuthenticated) {
      showNotice('未登录状态不支持保存人设。请先登录后再保存。', 'error');
      return;
    }

    setIsSaving(true);
    const latestPersonaPayload =
      [...messagesToSave].reverse().find((message) => message.role === 'assistant' && message.personaPayload)?.personaPayload || null;
    const personaJson = buildPersonaJson(info, messagesToSave, latestPersonaPayload);
    window.localStorage.setItem(PERSONA_STORAGE_KEY, JSON.stringify(personaJson));
    window.localStorage.removeItem(LEGACY_PERSONA_SAVE_STATUS_KEY);
    window.localStorage.setItem(PROFILE_VIEW_MODE_STORAGE_KEY, 'chat');
    writeStoredProfileChatState({
      info,
      messages: messagesToSave,
      conversationScopeId,
      draftMessage,
      isLoading: isAgentLoading,
      agentStatus,
    });
    dispatch({ type: 'SET_PERSONA', payload: personaToProfile(personaJson) });
    showNotice('保存成功', 'success', true);

    try {
      const response = await fetch(`${API_BASE}/api/persona/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          persona: personaJson,
        }),
      });
      const result = await readJsonResponse(response);
      const resultRecord = isRecord(result) ? result : {};

      if (!response.ok || resultRecord.code !== 200) {
        console.warn('Persona remote save did not confirm success:', result);
      } else {
        const savedRecord = isRecord(resultRecord.data) ? normalizePersonaRecord(resultRecord.data.record) : null;
        if (savedRecord) {
          try {
            await loadPersonaHistory();
          } catch {
            setPersonaRecords((records) => [savedRecord, ...records.filter((record) => record.id !== savedRecord.id)]);
          }
        }
      }
    } catch (error) {
      console.error('Persona save failed:', error);
    } finally {
      setIsSaving(false);
    }
  }, [agentStatus, conversationScopeId, dispatch, draftMessage, info, isAgentLoading, isAuthenticated, isSaving, loadPersonaHistory, messages, showNotice]);

  const refreshAssistantMessage = async (assistantIndex: number) => {
    if (isAgentLoading) return;
    if (assistantIndex === 0) {
      if (blockAnonymousPersonaGenerationIfNeeded()) return;
      setMessages([]);
      setAgentStatus(null);
      await runAnalyzeRequest(info);
      return;
    }
    const userIndex = [...messages.slice(0, assistantIndex)].map((message) => message.role).lastIndexOf('user');
    if (userIndex < 0) return;

    const actualUserIndex = userIndex;
    const userMessage = messages[actualUserIndex];
    const historyBeforeUser = messages.slice(0, actualUserIndex);
    const nextMessages = messages.slice(0, assistantIndex);
    pendingAutoScrollRef.current = true;
    setMessages(nextMessages);
    setAgentStatus(null);
    setIsAgentLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/persona/follow_up`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          basicInfo: info,
          userMessage: userMessage.content,
          conversationScopeId,
          conversationHistory: trimVisibleConversation(historyBeforeUser).map((msg) => ({ role: msg.role, content: msg.content })),
        }),
      });
      const result = await readJsonResponse(response);
      const resultRecord = isRecord(result) ? result : {};
      if (!response.ok || resultRecord.code !== 200) {
        const errorMessage = readString(resultRecord.message) || readString(resultRecord.msg) || 'Agent 调用失败';
        throw new Error(errorMessage);
      }
      const refreshedMessages: ChatMessage[] = trimVisibleConversation([
        ...nextMessages,
        {
          id: `${userMessage.id}-refresh-assistant`,
          role: 'assistant',
          content: formatPersonaFollowUpReply(resultRecord.data),
          personaPayload: extractPersonaPayload(resultRecord.data) || undefined,
          followUpQuestions: readPersonaFollowUpQuestions(resultRecord.data),
        },
      ]);
      setMessages(refreshedMessages);
      setAgentStatus(null);
      writeStoredProfileChatState({ info, messages: refreshedMessages, conversationScopeId, draftMessage: '', isLoading: false, agentStatus: null });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '网络错误';
      setMessages(nextMessages);
      setAgentStatus({ kind: 'error', message: `出错了：${errorMsg}` });
      writeStoredProfileChatState({
        info,
        messages: nextMessages,
        conversationScopeId,
        draftMessage: '',
        isLoading: false,
        agentStatus: { kind: 'error', message: `出错了：${errorMsg}` },
      });
      showNotice(`错误：${errorMsg}`, 'error');
    } finally {
      setIsAgentLoading(false);
    }
  };

  const retryLastProfileRequest = useCallback(() => {
    if (isAgentLoading || agentStatus?.kind !== 'error') return;

    if (viewMode === 'form') {
      if (!canStart) return;
      if (blockAnonymousPersonaGenerationIfNeeded()) return;
      void runAnalyzeRequest(info);
      return;
    }

    const userIndex = [...messages].map((message) => message.role).lastIndexOf('user');
    if (userIndex < 0) return;

    const userMessage = messages[userIndex];
    const historyBeforeUser = messages.slice(0, userIndex);
    const nextMessages = trimVisibleConversation(messages);
    const controller = new AbortController();

    pendingAutoScrollRef.current = true;
    setMessages(nextMessages);
    showNotice('', 'info');
    setAgentStatus(null);
    setIsAgentLoading(true);
    abortControllerRef.current = controller;
    writeStoredProfileChatState({
      info,
      messages: nextMessages,
      conversationScopeId,
      draftMessage: draftMessageRef.current,
      isLoading: true,
      agentStatus: null,
    });

    void runFollowUpRequest({
      content: userMessage.content,
      nextMessages,
      historyBeforeUser,
      controller,
      draftMessageSnapshot: draftMessageRef.current,
    });
  }, [agentStatus, blockAnonymousPersonaGenerationIfNeeded, canStart, conversationScopeId, info, isAgentLoading, messages, runAnalyzeRequest, runFollowUpRequest, showNotice, viewMode]);

  const hasReachedConversationLimit = hasReachedConversationHardStop(messages);

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
    if (viewMode === 'form' && messages.length === 0) {
      clearConversationId(PROFILE_CONVERSATION_ID_STORAGE_KEY);
    }
  }, [messages.length, viewMode]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden px-[5.5vw] pb-7 pt-7">
      <TopToast
        key={noticeKey}
        message={notice}
        tone={noticeTone}
      />
      {viewMode === 'form' ? (
        <section className="mx-auto min-h-0 flex-1 w-full max-w-[920px] overflow-y-auto pr-1 sm:pr-2">
          <div className="flex min-h-full w-full flex-col items-center justify-center py-2">
            <div className="mb-6 text-center">
              <h1 className="koc-title-font koc-gradient-title text-[36px] leading-tight">Hi，我是你的人设小猪梨</h1>
              <p className="koc-heading-font mt-2 text-[26px] leading-tight text-[var(--foreground)]">现在请填写以下内容以完成人设分析：</p>
            </div>

            {!isAuthenticated && (
              <div className="mb-5 flex w-full flex-col gap-4 rounded-[18px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] px-5 py-5 text-[var(--foreground)] shadow-[var(--box-shadow)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <p className="koc-heading-font text-[18px] leading-tight text-[var(--foreground)]">当前是游客体验模式</p>
                  <p className="mt-2 text-[14px] leading-6 text-[var(--foreground)]">
                    你可以免费生成 1 次初版人设；继续追问、保存人设、热门追踪和内容撰写需要登录。
                  </p>
                </div>
                <LoginButton className="inline-flex shrink-0 self-start sm:self-center" />
              </div>
            )}

            <form
              onSubmit={startChat}
              className="koc-safe-shadow-area w-full rounded-[34px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.3)] px-5 py-6 shadow-[var(--box-shadow)] sm:px-8 md:px-10 lg:px-14"
            >
              <div className="mx-auto w-full max-w-[688px]">
              <div className="koc-song-font space-y-5 text-[19px] text-[var(--foreground)]">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-x-6">
                  <span className="relative -top-[4px] shrink-0 whitespace-nowrap text-right text-[21px] leading-[56px] md:w-[136px]">性别：</span>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-3">
                    {(['女', '男'] as const).map((gender) => (
                      <label key={gender} className="inline-flex items-center gap-2 text-[19px]">
                        <input
                          type="radio"
                          name="gender"
                          checked={info.gender === gender}
                          onChange={() => updateInfo('gender', gender)}
                          className="size-[14px] border border-[var(--primary)]"
                        />
                        <span>{gender}</span>
                      </label>
                    ))}
                </div>
                </div>

                <label htmlFor="profile-age" className="flex flex-col gap-3 md:flex-row md:items-center md:gap-x-6">
                  <span className="relative -top-[4px] shrink-0 whitespace-nowrap text-right text-[21px] leading-[56px] md:w-[136px]">年龄：</span>
                  <input
                    id="profile-age"
                    ref={ageInputRef}
                    value={info.age}
                    onChange={(event) => updateInfo('age', event.target.value)}
                    onKeyDown={(event) => handleProfileFieldEnter(event, 'age')}
                    className="koc-input-font koc-profile-input koc-profile-placeholder h-[56px] min-w-0 w-full md:flex-1 md:max-w-[500px] rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.95)] px-7 text-[17px] leading-[56px] text-[var(--foreground)] outline-none"
                    placeholder="20"
                  />
                </label>

                <label htmlFor="profile-occupation" className="flex flex-col gap-3 md:flex-row md:items-center md:gap-x-6">
                  <span className="relative -top-[4px] shrink-0 whitespace-nowrap text-right text-[21px] leading-[56px] md:w-[136px]">职业：</span>
                  <input
                    id="profile-occupation"
                    ref={occupationInputRef}
                    value={info.occupation}
                    onChange={(event) => updateInfo('occupation', event.target.value)}
                    onKeyDown={(event) => handleProfileFieldEnter(event, 'occupation')}
                    className="koc-input-font koc-profile-input koc-profile-placeholder h-[56px] min-w-0 w-full md:flex-1 md:max-w-[500px] rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.95)] px-7 text-[17px] leading-[56px] text-[var(--foreground)] outline-none"
                    placeholder="在校大学生"
                  />
                </label>

                <label htmlFor="profile-interests" className="flex flex-col gap-3 md:flex-row md:items-center md:gap-x-6">
                  <span className="relative -top-[4px] shrink-0 whitespace-nowrap text-right text-[21px] leading-[56px] md:w-[136px]">兴趣爱好：</span>
                  <input
                    id="profile-interests"
                    ref={interestsInputRef}
                    value={interestsInputValue}
                    onChange={(event) => setInterestsInputValue(event.target.value)}
                    onBlur={(event) => syncListField('interests', event.target.value)}
                    onKeyDown={(event) => handleProfileFieldEnter(event, 'interests')}
                    className="koc-input-font koc-profile-input koc-profile-placeholder h-[56px] min-w-0 w-full md:flex-1 md:max-w-[500px] rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.95)] px-7 text-[17px] leading-[56px] text-[var(--foreground)] outline-none"
                    placeholder="绘画、玩游戏、嗑 CP"
                  />
                </label>

                <label htmlFor="profile-skills" className="flex flex-col gap-3 md:flex-row md:items-center md:gap-x-6">
                  <span className="relative -top-[4px] shrink-0 whitespace-nowrap text-right text-[21px] leading-[56px] md:w-[136px]">技能特长：</span>
                  <input
                    id="profile-skills"
                    ref={skillsInputRef}
                    value={skillsInputValue}
                    onChange={(event) => setSkillsInputValue(event.target.value)}
                    onBlur={(event) => syncListField('skills', event.target.value)}
                    onKeyDown={(event) => handleProfileFieldEnter(event, 'skills')}
                    className="koc-input-font koc-profile-input koc-profile-placeholder h-[56px] min-w-0 w-full md:flex-1 md:max-w-[500px] rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.95)] px-7 text-[17px] leading-[56px] text-[var(--foreground)] outline-none"
                    placeholder="弹吉他、剪视频、拍照"
                  />
                </label>
              </div>

              <div className="koc-safe-shadow-area mt-4 flex w-full flex-col gap-3 pb-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
                <button
                  type="button"
                  onClick={showSavedInfo}
                  disabled={isAgentLoading}
                  className="koc-heading-font w-full rounded-full border border-[#888888] bg-[#DE868F] px-7 py-3 text-center text-[15px] text-white shadow-[var(--cta-shadow)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:whitespace-nowrap"
                >
                  查看已保存人设信息
                </button>
                <button
                  type="submit"
                  disabled={!canStart || isAgentLoading}
                  className="koc-heading-font w-full rounded-full border border-[#888888] bg-[#DE868F] px-7 py-3 text-center text-[15px] text-white shadow-[var(--cta-shadow)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:whitespace-nowrap"
                >
                  {isAgentLoading ? '正在生成人设中...' : '确认信息，开始人设打造'}
                </button>
              </div>
              <p className="mt-2 text-center text-[13px] leading-5 text-[var(--foreground)]/75">
                保存后的人设会长期保留，可作为人设项目继续开启新的内容对话。
              </p>
              </div>
            </form>
            {agentStatus && !isAgentLoading && (
              <div className="mt-5 w-full">
                <AgentStatusMessage
                  status={agentStatus}
                  onRefresh={agentStatus.kind === 'error' ? retryLastProfileRequest : undefined}
                  refreshDisabled={isAgentLoading}
                />
              </div>
            )}
            {isAgentLoading && (
              <div className="mt-5 w-full">
                <AgentStatusMessage status={{ kind: 'running', message: '正在生成人设中，请稍等...' }} />
              </div>
            )}

            {(notice || isPersonaHistoryLoading || personaRecords.length > 0) && (
              <div className="mt-5 w-full rounded-[18px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] p-5 text-sm text-[var(--foreground)] shadow-[var(--box-shadow)]">
                {notice && <p className="font-medium text-[var(--foreground)]">{notice}</p>}
                {(isPersonaHistoryLoading || personaRecords.length > 0) && (
                  <div className="mt-4 space-y-4">
                    <div className="rounded-[12px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.72)] px-4 py-3 text-[14px] leading-6">
                      保存后的人设会长期保留，也可以作为人设项目继续开启热门追踪。
                    </div>
                    {isPersonaHistoryLoading ? (
                      <p className="koc-song-font text-[15px]">正在读取已保存人设...</p>
                    ) : (
                      <div className="grid gap-3 md:grid-cols-2">
                        {personaRecords.map((record) => {
                          const card = getPersonaCardViewModel(record.persona, {
                            savedAt: record.savedAt,
                          });
                          return (
                            <article
                              key={record.id}
                              className="relative rounded-[14px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.74)] p-4 text-left shadow-[var(--box-shadow)]"
                            >
                              <button
                                type="button"
                                onClick={() => void deletePersonaRecord(record)}
                                className="absolute right-3 top-3 flex size-[32px] items-center justify-center rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.94)] text-[15px] text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-[rgba(255,255,255,0.82)]"
                                title="删除人设"
                                aria-label="删除人设"
                              >
                                🗑
                              </button>
                              <p className="koc-heading-font line-clamp-1 pr-12 text-[18px] leading-tight">{card.title}</p>
                              <div className="mt-2 space-y-1 text-[13px] leading-5 text-[var(--foreground)]">
                                <p className="line-clamp-1">{card.fitLine}</p>
                                <p className="line-clamp-1">{card.hookLine}</p>
                                <p className="line-clamp-1">{card.toneLine}</p>
                              </div>
                              <p className="mt-2 text-[12px] text-[var(--foreground)]/70">{card.metaText}</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => openPersonaInModule(record, 'trending')}
                                  className="koc-heading-font rounded-full border border-[#888888] bg-[#DE868F] px-3 py-1.5 text-[12px] text-white shadow-[var(--cta-shadow)] transition hover:opacity-90"
                                >
                                  热门追踪
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openPersonaInModule(record, 'content')}
                                  className="koc-heading-font rounded-full border border-[#888888] bg-[#DE868F] px-3 py-1.5 text-[12px] text-white shadow-[var(--cta-shadow)] transition hover:opacity-90"
                                >
                                  写内容
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openSavedPersonaDraft(record)}
                                  className="koc-heading-font rounded-full border border-[#888888] bg-[rgba(255,255,255,0.94)] px-3 py-1.5 text-[12px] text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-[rgba(255,255,255,0.82)]"
                                >
                                  继续完善
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      ) : (
        <section className="relative flex min-h-0 flex-1 flex-col">
          <div className="mx-auto w-full max-w-[980px] shrink-0">
            <ScenarioHeader
              subtitle="正在根据你的基础信息继续追问人设细节"
              action={
                <button
                  type="button"
                  onClick={() => {
                    switchViewMode('form');
                    setNotice('');
                    setAgentStatus(null);
                  }}
                  className="koc-heading-font koc-primary-back-button shrink-0 rounded-full px-5 py-3 text-[18px] text-[var(--foreground)] transition hover:bg-[rgba(255,255,255,0.42)]"
                  aria-label="返回"
                  title="返回"
                >
                  返回
                </button>
              }
            />
            {!isAuthenticated && (
              <div className="mb-5 flex flex-col gap-4 rounded-[18px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] px-5 py-5 text-[var(--foreground)] shadow-[var(--box-shadow)] sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <div>
                  <p className="koc-heading-font text-[18px] leading-tight text-[var(--foreground)]">登录后继续完善并保存人设</p>
                  <p className="mt-2 text-[14px] leading-6 text-[var(--foreground)]">
                    当前是游客体验模式。你可以免费生成 1 次初版人设；继续追问、保存人设、热门追踪和内容撰写需要登录。
                  </p>
                </div>
                <LoginButton className="inline-flex shrink-0 self-start sm:self-center" />
              </div>
            )}
          </div>

          <div
            ref={chatScrollRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              window.localStorage.setItem(PROFILE_CHAT_SCROLL_TOP_STORAGE_KEY, String(el.scrollTop));
              setShowScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 160);
            }}
            className="mx-auto min-h-0 w-full max-w-[980px] flex-1 space-y-4 overflow-y-auto px-5 pb-8 text-[15px] leading-[1.7] text-[var(--foreground)] sm:px-7"
          >
              {messages.filter((message) => !isLegacyAgentStatusContent(message.content)).map((message, index) => (
                <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {message.role === 'user' ? (
                    <ChatMessageBubble variant="user" inheritTextColor>
                      <MarkdownText content={message.content} inheritTextColor />
                    </ChatMessageBubble>
                  ) : (
                    <div className="mr-[12%] w-full max-w-[min(74%,720px)] space-y-3">
                      <ChatMessageBubble variant="assistant">
                        <MarkdownText content={message.content} />
                      </ChatMessageBubble>
                      {getVisibleFollowUpQuestions(messages, index).length > 0 && (
                        <div className="rounded-[14px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.78)] p-3 shadow-[var(--box-shadow)]">
                          <p className="koc-heading-font text-[13px] leading-5 text-[var(--foreground)]">可选补充画像</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {getVisibleFollowUpQuestions(messages, index).map((question) => (
                              <button
                                key={question}
                                type="button"
                                onClick={() => answerFollowUpQuestion(question)}
                                disabled={isAgentLoading || hasReachedConversationLimit}
                                className="rounded-full border border-[#DE868F]/45 bg-white px-3 py-1.5 text-left text-[12px] leading-5 text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-[#fff3f5] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {question}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <MessageActions
                        copyEvent={buildProfileCopyEvent(message, index)}
                        copyText={message.content}
                        onRefresh={() => void refreshAssistantMessage(index)}
                        onSave={isAuthenticated ? () => void savePersona(messages.slice(0, index + 1)) : undefined}
                        refreshDisabled={isAgentLoading}
                        saving={isSaving}
                      />
                    </div>
                  )}
                </div>
              ))}
              {agentStatus && !isAgentLoading && (
                <AgentStatusMessage
                  status={agentStatus}
                  onRefresh={agentStatus.kind === 'error' ? retryLastProfileRequest : undefined}
                  refreshDisabled={isAgentLoading}
                />
              )}
              {isAgentLoading && <AgentStatusMessage status={{ kind: 'running', message: '正在完善人设中，请稍等...' }} />}
          </div>
          {showScrollDown && (
            <ScrollToBottomButton onClick={scrollChatToBottom} />
          )}
          <ChatInputShell>
            <div className="koc-chat-input-surface flex h-[72px] items-center rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] px-5 sm:px-7">
              <input
                ref={chatInputRef}
                value={draftMessage}
                onChange={(event) => updateDraftMessage(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  if (!isAgentLoading && !hasReachedConversationLimit) {
                    void sendMessage();
                  }
                }}
                placeholder={hasReachedConversationLimit ? CONVERSATION_LIMIT_NOTICE : isAgentLoading ? '等待回复中…' : '请输入对当前人设的意见'}
                className="koc-song-font koc-chat-placeholder min-w-0 flex-1 bg-transparent text-[16px] text-[var(--foreground)] outline-none sm:text-[17px]"
                disabled={hasReachedConversationLimit}
              />
              <button
                type="button"
                onClick={() => {
                  if (isAgentLoading) {
                    requestStop();
                    return;
                  }
                  void sendMessage();
                }}
                className="koc-icon-center size-11 text-[29px] text-[var(--foreground)] transition hover:scale-105 disabled:opacity-45"
                aria-label={isAgentLoading ? '停止生成' : '发送'}
                title={isAgentLoading ? '停止生成' : '发送'}
                disabled={(!isAgentLoading && !draftMessage.trim()) || hasReachedConversationLimit}
              >
                {isAgentLoading ? <StopGenerationIcon /> : <Image src="/koc-assets/icons/图标/发送.svg" alt="" width={24} height={24} className="size-[24px]" />}
              </button>
            </div>
          </ChatInputShell>
        </section>
      )}
    </div>
  );
}
