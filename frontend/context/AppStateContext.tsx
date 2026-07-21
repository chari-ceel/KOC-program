'use client';

import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import { API_BASE } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { normalizePersonaJson, personaToProfile, PERSONA_STORAGE_KEY, type PersonaJson } from '@/lib/persona';

export interface PersonaProfile {
  title: string;
  summary: string;
  sections: string[];
  json?: Record<string, unknown>;
}

export interface DraftSource {
  sourceType: 'hot_tracking' | 'track' | 'manual_input' | 'unknown';
  trackId?: string;
  trackName?: string;
  topicId?: string;
  topicTitle?: string;
  inputText?: string;
}

export interface DraftItem {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  status?: '待优化' | '已完成';
  source?: string;
  draftSource?: DraftSource;
  tags?: string[];
  updatedAt?: string;
  personaRecordId?: string;
  personaTitle?: string;
  personaSource?: 'history' | 'favorite' | 'latest';
  cardPreview?: {
    keywords: string[];
  };
  structured?: {
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
  };
}

export interface TrendRecord {
  id?: string;
  trackName: string;
  trackTime: string;
  userPrompt: string;
  trends: string;
  audience: string;
  topics: string[];
  status?: '待追踪' | '追踪中' | '已完成';
  source?: string;
  tags?: string[];
  cardPreview?: {
    discoveryKeywords: string[];
    shortTopics: string[];
  };
  conversationHistory?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  updatedAt?: string;
  createdAt?: string;
  personaRecordId?: string;
  personaTitle?: string;
  personaSource?: 'history' | 'favorite' | 'latest';
}

interface AppState {
  persona: PersonaProfile | null;
  personaHydrating: boolean;
  draftsHydrating: boolean;
  drafts: DraftItem[];
  trendsHydrating: boolean;
  trendRecords: TrendRecord[];
}

type AppAction =
  | { type: 'SET_PERSONA'; payload: PersonaProfile }
  | { type: 'SET_DRAFTS'; payload: DraftItem[] }
  | { type: 'ADD_DRAFT'; payload: DraftItem }
  | { type: 'SET_DRAFT'; payload: DraftItem }
  | { type: 'DELETE_DRAFT'; payload: string }
  | { type: 'DRAFTS_HYDRATED' }
  | { type: 'SET_TREND_RECORDS'; payload: TrendRecord[] }
  | { type: 'ADD_TREND_RECORD'; payload: TrendRecord }
  | { type: 'DELETE_TREND_RECORD'; payload: TrendRecord }
  | { type: 'TRENDS_HYDRATED' }
  | { type: 'CLEAR_PERSONA' }
  | { type: 'CLEAR_USER_DATA' }
  | { type: 'PERSONA_HYDRATED' };

const initialState: AppState = {
  persona: null,
  personaHydrating: true,
  draftsHydrating: true,
  drafts: [],
  trendsHydrating: true,
  trendRecords: [],
};

function upsertDraft(drafts: DraftItem[], draft: DraftItem) {
  return [draft, ...drafts.filter((item) => item.id !== draft.id)].slice(0, 20);
}

function sameTrendRecord(left: TrendRecord, right: TrendRecord) {
  const sameBusinessKey =
    left.trackName === right.trackName && left.trackTime === right.trackTime && left.userPrompt === right.userPrompt;
  return sameBusinessKey || Boolean(left.id && right.id && left.id === right.id);
}

function uniqueTrendRecords(records: TrendRecord[]) {
  return records.reduce<TrendRecord[]>((acc, record) => {
    if (!acc.some((item) => sameTrendRecord(item, record))) {
      acc.push(record);
    }
    return acc;
  }, []);
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_PERSONA':
      return { ...state, persona: action.payload, personaHydrating: false };
    case 'SET_DRAFTS':
      return { ...state, drafts: action.payload.slice(0, 20), draftsHydrating: false };
    case 'ADD_DRAFT':
      return { ...state, drafts: upsertDraft(state.drafts, action.payload) };
    case 'SET_DRAFT':
      return { ...state, drafts: upsertDraft(state.drafts, action.payload) };
    case 'DELETE_DRAFT':
      return { ...state, drafts: state.drafts.filter((draft) => draft.id !== action.payload) };
    case 'DRAFTS_HYDRATED':
      return { ...state, draftsHydrating: false };
    case 'SET_TREND_RECORDS':
      return { ...state, trendRecords: uniqueTrendRecords(action.payload).slice(0, 20), trendsHydrating: false };
    case 'ADD_TREND_RECORD':
      return {
        ...state,
        trendRecords: [
          action.payload,
          ...state.trendRecords.filter((record) => !sameTrendRecord(record, action.payload)),
        ].slice(0, 20),
      };
    case 'DELETE_TREND_RECORD':
      return {
        ...state,
        trendRecords: state.trendRecords.filter((record) => !sameTrendRecord(record, action.payload)),
      };
    case 'TRENDS_HYDRATED':
      return { ...state, trendsHydrating: false };
    case 'CLEAR_PERSONA':
      return { ...state, persona: null };
    case 'CLEAR_USER_DATA':
      return {
        ...state,
        persona: null,
        personaHydrating: false,
        draftsHydrating: false,
        drafts: [],
        trendsHydrating: false,
        trendRecords: [],
      };
    case 'PERSONA_HYDRATED':
      return { ...state, personaHydrating: false };
    default:
      return state;
  }
}

const AppStateContext = createContext<
  | {
      state: AppState;
      dispatch: React.Dispatch<AppAction>;
    }
  | undefined
>(undefined);

const APP_STATE_FETCH_TIMEOUT_MS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : [];
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

function normalizeDraftSource(value: unknown): DraftSource | undefined {
  if (!isRecord(value)) return undefined;
  const sourceType = readOptionalString(value.sourceType);
  return {
    sourceType:
      sourceType === 'hot_tracking' || sourceType === 'track' || sourceType === 'manual_input'
        ? sourceType
        : 'unknown',
    trackId: readOptionalString(value.trackId),
    trackName: readOptionalString(value.trackName),
    topicId: readOptionalString(value.topicId),
    topicTitle: readOptionalString(value.topicTitle),
    inputText: readOptionalString(value.inputText),
  };
}

export function formatDraftSourceLabel(draftSource?: DraftSource, fallbackSource?: string, fallbackTitle?: string) {
  if (draftSource?.sourceType === 'hot_tracking') {
    return `热门追踪 | ${draftSource.trackName || '未命名赛道'}`;
  }
  if (draftSource?.sourceType === 'track') {
    return `赛道生成 | ${draftSource.trackName || '未命名赛道'}`;
  }
  if (draftSource?.sourceType === 'manual_input') {
    return `主动输入 | ${draftSource.inputText || draftSource.topicTitle || fallbackTitle || '未命名主题'}`;
  }
  if (fallbackSource && fallbackSource.trim().length > 0) {
    const source = fallbackSource.trim();
    if (
      source.startsWith('热门追踪 |') ||
      source.startsWith('赛道生成 |') ||
      source.startsWith('主动输入 |') ||
      source.startsWith('来源未知 |')
    ) {
      return source;
    }
    if (source === '热门追踪') return `热门追踪 | ${fallbackTitle || '未命名赛道'}`;
    if (source === '赛道生成' || source === '赛道') return `赛道生成 | ${fallbackTitle || '未命名赛道'}`;
    if (source === '直接输入' || source === '接口测试') return `主动输入 | ${fallbackTitle || '未命名主题'}`;
    if (source.startsWith('基于「')) return `来源未知 | ${source}`;
    return `来源未知 | ${source}`;
  }
  return '来源未知';
}

function normalizeDraftCardPreview(value: unknown) {
  const preview = isRecord(value) ? value : {};
  const keywords = readStringArray(preview.keywords).slice(0, 3);
  return keywords.length > 0 ? { keywords } : undefined;
}

function normalizeCoverSuggestion(value: unknown) {
  const cover = isRecord(value) ? value : {};
  const mainText = readOptionalString(cover.mainText);
  const layout = readOptionalString(cover.layout);
  const visualStyle = readOptionalString(cover.visualStyle);
  return mainText || layout || visualStyle
    ? {
        ...(mainText ? { mainText } : {}),
        ...(layout ? { layout } : {}),
        ...(visualStyle ? { visualStyle } : {}),
      }
    : undefined;
}

function normalizeTrendCardPreview(value: unknown) {
  const preview = isRecord(value) ? value : {};
  const discoveryKeywords = uniqueShortPhrases(readStringArray(preview.discoveryKeywords));
  const shortTopics = uniqueShortPhrases(readStringArray(preview.shortTopics));
  return discoveryKeywords.length > 0 || shortTopics.length > 0
    ? {
        discoveryKeywords,
        shortTopics,
      }
    : undefined;
}

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), APP_STATE_FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function fetchSavedPersona(): Promise<PersonaJson | null> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/persona/me`, { credentials: 'include' });
    if (!response.ok) return null;
    const result = await response.json();
    const raw = result?.data?.persona;
    return normalizePersonaJson(raw);
  } catch (error) {
    console.error('Failed to load saved persona', error);
    return null;
  }
}

function normalizeDraft(value: unknown): DraftItem | null {
  if (!isRecord(value)) return null;

  const id = typeof value.id === 'string' && value.id.trim() ? value.id : null;
  const rawTitle = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : null;
  const createdAt =
    typeof value.createdAt === 'string' && value.createdAt.trim()
      ? value.createdAt
      : typeof value.timestamp === 'string' && value.timestamp.trim()
        ? value.timestamp
        : new Date().toISOString();

  if (!id || !rawTitle) return null;

  const structured = isRecord(value.structured)
    ? {
        noteTitle: typeof value.structured.noteTitle === 'string' && value.structured.noteTitle.trim()
          ? value.structured.noteTitle.trim()
          : rawTitle,
        titleOptions: readStringArray(value.structured.titleOptions).slice(0, 5),
        hook: typeof value.structured.hook === 'string' ? value.structured.hook : '',
        body: Array.isArray(value.structured.body)
          ? value.structured.body.filter((item): item is string => typeof item === 'string')
          : [],
        ending: typeof value.structured.ending === 'string' ? value.structured.ending : '',
        tags: Array.isArray(value.structured.tags)
          ? value.structured.tags.filter((tag): tag is string => typeof tag === 'string')
          : [],
        coverSuggestion: normalizeCoverSuggestion(value.structured.coverSuggestion),
        imageTextStructure: readStringArray(value.structured.imageTextStructure).slice(0, 8),
        cardPreview: normalizeDraftCardPreview(value.structured.cardPreview),
      }
    : undefined;
  const title = structured?.noteTitle || rawTitle;

  return {
    id,
    title,
    body: typeof value.body === 'string' ? value.body : '',
    createdAt,
    status: value.status === '待优化' || value.status === '已完成' ? value.status : undefined,
    source: formatDraftSourceLabel(
      normalizeDraftSource(value.draftSource),
      typeof value.source === 'string' ? value.source : undefined,
      title,
    ),
    draftSource: normalizeDraftSource(value.draftSource),
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
    personaRecordId: readOptionalString(value.personaRecordId),
    personaTitle: readOptionalString(value.personaTitle),
    personaSource: value.personaSource === 'history' || value.personaSource === 'favorite' || value.personaSource === 'latest'
      ? value.personaSource
      : undefined,
    cardPreview: normalizeDraftCardPreview(value.cardPreview),
    structured,
  };
}

function normalizeTrendRecord(value: unknown): TrendRecord | null {
  if (!isRecord(value)) return null;
  const trackName = typeof value.trackName === 'string' && value.trackName.trim() ? value.trackName : null;
  const trackTime = typeof value.trackTime === 'string' && value.trackTime.trim() ? value.trackTime : null;
  if (!trackName || !trackTime) return null;

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id : undefined,
    trackName,
    trackTime,
    userPrompt: typeof value.userPrompt === 'string' ? value.userPrompt : '',
    trends: typeof value.trends === 'string' ? value.trends : '',
    audience: typeof value.audience === 'string' ? value.audience : '',
    topics: Array.isArray(value.topics) ? value.topics.filter((topic): topic is string => typeof topic === 'string') : [],
    status: value.status === '待追踪' || value.status === '追踪中' || value.status === '已完成' ? value.status : undefined,
    source: typeof value.source === 'string' ? value.source : undefined,
    tags: Array.isArray(value.tags) ? value.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
    cardPreview: normalizeTrendCardPreview(value.cardPreview),
    conversationHistory: Array.isArray(value.conversationHistory)
      ? value.conversationHistory.filter(
          (message): message is { role: 'user' | 'assistant'; content: string } =>
            isRecord(message) &&
            (message.role === 'user' || message.role === 'assistant') &&
            typeof message.content === 'string',
        )
      : undefined,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    personaRecordId: readOptionalString(value.personaRecordId),
    personaTitle: readOptionalString(value.personaTitle),
    personaSource: value.personaSource === 'history' || value.personaSource === 'favorite' || value.personaSource === 'latest'
      ? value.personaSource
      : undefined,
  };
}

async function fetchSavedDrafts(): Promise<DraftItem[]> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/content/history`, { credentials: 'include' });
    if (!response.ok) return [];
    const result = await response.json();
    if (!isRecord(result) || result.code !== 200) return [];
    const data = isRecord(result.data) ? result.data : {};
    const rawHistory = data.contentHistory;
    return Array.isArray(rawHistory) ? rawHistory.map(normalizeDraft).filter((draft): draft is DraftItem => Boolean(draft)) : [];
  } catch (error) {
    console.error('Failed to load saved drafts', error);
    return [];
  }
}

async function fetchSavedTrendRecords(): Promise<TrendRecord[]> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/trends/history`, { credentials: 'include' });
    if (!response.ok) return [];
    const result = await response.json();
    if (!isRecord(result) || result.code !== 200) return [];
    const data = isRecord(result.data) ? result.data : {};
    const rawHistory = data.trendHistory;
    return Array.isArray(rawHistory)
      ? rawHistory.map(normalizeTrendRecord).filter((record): record is TrendRecord => Boolean(record))
      : [];
  } catch (error) {
    console.error('Failed to load saved trend records', error);
    return [];
  }
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { status, user } = useAuth();
  const [state, dispatch] = useReducer(appReducer, initialState);
  const value = useMemo(() => ({ state, dispatch }), [state]);

  useEffect(() => {
    if (status === 'loading') return;
    if (status !== 'authenticated') {
      dispatch({ type: 'CLEAR_USER_DATA' });
      window.localStorage.removeItem(PERSONA_STORAGE_KEY);
      return;
    }

    dispatch({ type: 'CLEAR_USER_DATA' });
    let cancelled = false;
    (async () => {
      const [remote, drafts, trendRecords] = await Promise.all([
        fetchSavedPersona(),
        fetchSavedDrafts(),
        fetchSavedTrendRecords(),
      ]);
      const personaJson = remote;
      if (cancelled) return;

      dispatch({ type: 'SET_DRAFTS', payload: drafts });
      dispatch({ type: 'SET_TREND_RECORDS', payload: trendRecords });

      if (personaJson) {
        window.localStorage.setItem(PERSONA_STORAGE_KEY, JSON.stringify(personaJson));
        dispatch({ type: 'SET_PERSONA', payload: personaToProfile(personaJson) });
      } else {
        dispatch({ type: 'PERSONA_HYDRATED' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, user?.id]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within AppStateProvider');
  }
  return context;
}
