import { isRecord } from '@/lib/api';
import { formatDelimitedList, parseDelimitedList } from '@/lib/list-input';

export type ChatRole = 'user' | 'assistant';
export type RunStatus = 'idle' | 'loading' | 'done' | 'error';

export interface DebugMessage {
  id: string;
  role: ChatRole;
  content: string;
}

export interface PersonaContext {
  gender: string;
  age: string;
  occupation: string;
  interests: string;
  skills: string;
}

export interface TavilyDebugAuth {
  webSearchApiKey: string;
  webSearchProvider: string;
}

export interface AgentDebugSettings {
  enableTools: boolean;
  requireRealWebResearch: boolean;
  exposeAgentDetails: boolean;
  maxToolCalls: string;
  contentType: string;
  language: string;
  debugAuth: TavilyDebugAuth;
}

export const defaultPersonaContext: PersonaContext = {
  gender: '女',
  age: '20',
  occupation: '在校大学生',
  interests: '生活成长、探店、拍照、自我提升',
  skills: '剪视频、写文案、做攻略',
};

export const defaultAgentDebugSettings: AgentDebugSettings = {
  enableTools: false,
  requireRealWebResearch: false,
  exposeAgentDetails: false,
  maxToolCalls: '3',
  contentType: 'image_text_note',
  language: 'zh-CN',
  debugAuth: {
    webSearchApiKey: '',
    webSearchProvider: 'tavily',
  },
};

export function buildPersonaContext(persona: PersonaContext) {
  const basicInfo = {
    gender: persona.gender,
    age: persona.age,
    occupation: persona.occupation,
    interests: parseDelimitedList(persona.interests),
    skills: parseDelimitedList(persona.skills),
  };

  return {
    title: 'Prompt 调试账号',
    basicInfo,
    keywords: [...basicInfo.interests, ...basicInfo.skills].slice(0, 12),
    personaPosition: `${basicInfo.occupation} / ${formatDelimitedList(basicInfo.interests.slice(0, 3)) || '兴趣探索'} / ${formatDelimitedList(basicInfo.skills.slice(0, 3)) || '技能成长'}`,
    contentTone: '真实、松弛、有陪伴感',
  };
}

export function buildPersonaAugmentedUserPrompt(userInput: string, persona: PersonaContext) {
  return [
    '请同时参考以下账号人设上下文：',
    '```json',
    JSON.stringify(buildPersonaContext(persona), null, 2),
    '```',
    '',
    '用户测试输入：',
    userInput,
  ].join('\n');
}

export function buildAgentDebugPayload(settings: AgentDebugSettings) {
  const payload: Record<string, unknown> = {
    enableTools: settings.enableTools,
    requireRealWebResearch: settings.requireRealWebResearch,
    exposeAgentDetails: settings.exposeAgentDetails,
    contentType: settings.contentType,
    language: settings.language,
  };

  const parsedMaxToolCalls = Number.parseInt(settings.maxToolCalls, 10);
  if (Number.isFinite(parsedMaxToolCalls) && parsedMaxToolCalls > 0) {
    payload.maxToolCalls = parsedMaxToolCalls;
  }

  const debugAuth: Record<string, unknown> = {};
  const webSearchApiKey = settings.debugAuth.webSearchApiKey.trim();
  const webSearchProvider = settings.debugAuth.webSearchProvider.trim();
  if (webSearchApiKey) {
    debugAuth.webSearchApiKey = webSearchApiKey;
  }
  if (webSearchProvider) {
    debugAuth.webSearchProvider = webSearchProvider;
  }
  if (Object.keys(debugAuth).length > 0) {
    payload.debugAuth = debugAuth;
  }

  return payload;
}

export function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function readStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  const text = readString(value);
  return text ? [text] : [];
}

export function stringifyUnknown(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function getErrorMessage(payload: unknown) {
  const record = isRecord(payload) ? payload : {};
  return (
    readString(record.message) ||
    readString(record.msg) ||
    (isRecord(record.error) ? readString(record.error.message) : '') ||
    'Agent 调用失败'
  );
}

export function formatDebugSection(value: unknown) {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
