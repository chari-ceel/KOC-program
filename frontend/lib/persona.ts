import type { PersonaProfile } from '@/context/AppStateContext';
import { formatDelimitedList } from '@/lib/list-input';

export type Gender = '女' | '男';

export interface PersonaBasicInfo {
  gender: Gender;
  age: string;
  occupation: string;
  interests: string[];
  skills: string[];
}

export interface PersonaJson {
  title: string;
  basicInfo: PersonaBasicInfo;
  keywords: string[];
  personaPosition: string;
  contentTone: string;
  conversation: { role: 'assistant' | 'user'; content: string }[];
  savedAt: string;
  persona?: Record<string, unknown>;
  niche?: Record<string, unknown>;
  audience?: string[];
  contentStyle?: string[];
  cardPreview?: Record<string, unknown>;
  referenceCreatorDirections?: string[];
  followUpQuestions?: string[];
}

export const PERSONA_STORAGE_KEY = 'koc-agent-persona-json';
export const ANONYMOUS_PERSONA_GENERATED_STORAGE_KEY = 'koc-agent-anonymous-persona-generated';
export const SELECTED_PERSONA_STORAGE_KEY = 'koc-agent-selected-persona';

export interface PersonaRecord {
  id: string;
  persona: PersonaJson;
  isFavorited: boolean;
  savedAt?: string;
  expiresAt?: string | null;
}

export interface SelectedPersona {
  recordId: string;
  source: 'history' | 'favorite';
  persona: PersonaJson;
  selectedAt: string;
}

export interface PersonaCardViewModel {
  title: string;
  fitLine: string;
  hookLine: string;
  toneLine: string;
  keywords: string[];
  metaText: string;
}

export function formatPersonaList(items: string[]) {
  return formatDelimitedList(items);
}

export function personaToProfile(personaJson: PersonaJson): PersonaProfile {
  const basicInfo = personaJson.basicInfo;
  const persona = isRecord(personaJson.persona) ? personaJson.persona : {};
  const niche = isRecord(personaJson.niche) ? personaJson.niche : {};
  const audience = Array.isArray(personaJson.audience) ? personaJson.audience : [];
  const contentStyle = Array.isArray(personaJson.contentStyle) ? personaJson.contentStyle : [];
  const followUpQuestions = Array.isArray(personaJson.followUpQuestions) ? personaJson.followUpQuestions : [];
  const title = readString(persona.name) || personaJson.title;
  const description = readString(persona.description);
  const primaryNiche = readString(niche.primary);
  const secondaryNiche = readStringList(niche.secondary);

  return {
    title,
    summary: personaJson.personaPosition,
    sections: [
      description ? `零、账号概括：${description}` : '',
      `一、基础画像：${basicInfo.gender}，${basicInfo.age || '年龄未填写'}，${basicInfo.occupation || '职业未填写'}。`,
      `二、兴趣方向：${formatPersonaList(basicInfo.interests) || '暂未填写'}。`,
      `三、技能资产：${formatPersonaList(basicInfo.skills) || '暂未填写'}。`,
      primaryNiche || secondaryNiche.length ? `四、内容方向：${formatPersonaList([primaryNiche, ...secondaryNiche].filter(Boolean))}。` : '',
      audience.length ? `五、目标受众：${formatPersonaList(audience)}。` : '',
      contentStyle.length ? `六、内容风格：${formatPersonaList(contentStyle)}。` : `六、内容语气：${personaJson.contentTone}`,
      `七、关键词：${formatPersonaList(personaJson.keywords) || '真实表达'}。`,
      followUpQuestions.length ? `八、后续可继续补充：${formatPersonaList(followUpQuestions)}。` : '',
    ].filter(Boolean),
    json: personaJson as unknown as Record<string, unknown>,
  };
}

export function normalizePersonaRecord(value: unknown): PersonaRecord | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const persona = normalizePersonaJson(value.persona);
  if (!id || !persona) return null;
  return {
    id,
    persona,
    isFavorited: value.isFavorited === true,
    savedAt: readString(value.savedAt) || persona.savedAt,
    expiresAt: readString(value.expiresAt) || null,
  };
}

export function getPersonaDisplayTitle(personaJson: PersonaJson) {
  const persona = isRecord(personaJson.persona) ? personaJson.persona : {};
  return readString(persona.name) || personaJson.title || '未命名人设';
}

export function getPersonaDisplaySummary(personaJson: PersonaJson) {
  const persona = isRecord(personaJson.persona) ? personaJson.persona : {};
  return readString(persona.description) || personaJson.personaPosition || personaJson.contentTone || '暂无人设摘要';
}

export function getPersonaCardViewModel(
  personaJson: PersonaJson,
  recordMeta?: { savedAt?: string | null; expiresAt?: string | null; isFavorite?: boolean },
): PersonaCardViewModel {
  const title = getPersonaDisplayTitle(personaJson);
  const keywords = buildPersonaCardKeywords(personaJson);
  return {
    title,
    fitLine: buildPersonaCardFitLine(personaJson, keywords),
    hookLine: buildPersonaCardHookLine(personaJson),
    toneLine: buildPersonaCardToneLine(personaJson),
    keywords,
    metaText: buildPersonaCardMeta(personaJson, recordMeta),
  };
}

export function writeSelectedPersona(record: PersonaRecord, source: SelectedPersona['source']) {
  if (typeof window === 'undefined') return;
  const selected: SelectedPersona = {
    recordId: record.id,
    source,
    persona: record.persona,
    selectedAt: new Date().toISOString(),
  };
  window.sessionStorage.setItem(SELECTED_PERSONA_STORAGE_KEY, JSON.stringify(selected));
}

export function readSelectedPersona(): SelectedPersona | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(SELECTED_PERSONA_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const persona = normalizePersonaJson(parsed.persona);
    const recordId = readString(parsed.recordId);
    const source = parsed.source === 'favorite' ? 'favorite' : 'history';
    if (!persona || !recordId) return null;
    return {
      recordId,
      source,
      persona,
      selectedAt: readString(parsed.selectedAt) || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function isPersonaJson(value: unknown): value is PersonaJson {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PersonaJson>;
  return (
    typeof candidate.title === 'string' &&
    typeof candidate.basicInfo === 'object' &&
    candidate.basicInfo !== null &&
    Array.isArray(candidate.keywords)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

function formatPersonaCardDate(value?: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const hour = String(parsed.getHours()).padStart(2, '0');
    const minute = String(parsed.getMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hour}:${minute}`;
  }
  return value;
}

function cleanPersonaCardText(value: string) {
  return value
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s*\d+[.)]\s+/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitPersonaCardTerms(value: string) {
  return cleanPersonaCardText(value)
    .split(/[、，,·/|｜\s]+/)
    .map((item) =>
      item
        .trim()
        .replace(/^(适合写|适合做|关键词|内容方向|人设定位|目标受众)[:：]?/, '')
        .replace(/[“”"'。.!?！？；;：:（）()]/g, ''),
    )
    .filter(Boolean);
}

function uniquePersonaCardTerms(items: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  items.forEach((item) => {
    const cleaned = item.trim();
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    result.push(cleaned);
  });
  return result;
}

function shortenPersonaCardTerm(value: string, maxChars = 10) {
  const cleaned = cleanPersonaCardText(value)
    .replace(/^(适合写|适合做|方向|个人抓手|内容气质|内容风格|基础画像|关键词)[:：]?/, '')
    .replace(/[“”"'。.!?！？；;：:（）()]/g, '')
    .trim();
  const chars = Array.from(cleaned);
  return chars.length > maxChars ? chars.slice(0, maxChars).join('') : cleaned;
}

function readPersonaCardPreview(personaJson: PersonaJson) {
  return isRecord(personaJson.cardPreview) ? personaJson.cardPreview : {};
}

function readPersonaNiche(personaJson: PersonaJson) {
  return isRecord(personaJson.niche) ? personaJson.niche : {};
}

function joinPersonaCardTerms(items: string[], maxItems = 3, maxCharsPerTerm = 10) {
  return uniquePersonaCardTerms(items.map((item) => shortenPersonaCardTerm(item, maxCharsPerTerm)).filter(Boolean))
    .slice(0, maxItems)
    .join(' / ');
}

function buildPersonaCardKeywords(personaJson: PersonaJson) {
  const niche = readPersonaNiche(personaJson);
  const cardPreview = readPersonaCardPreview(personaJson);
  const rawKeywords = readString(cardPreview.keywordsLabel);
  const keywords = uniquePersonaCardTerms([
    ...splitPersonaCardTerms(rawKeywords),
    ...personaJson.keywords,
    readString(niche.primary),
    ...readStringList(niche.secondary),
    ...readStringList(personaJson.audience),
  ]);

  return keywords.slice(0, 3);
}

function buildPersonaCardFitLine(personaJson: PersonaJson, keywords: string[]) {
  const cardPreview = readPersonaCardPreview(personaJson);
  const niche = readPersonaNiche(personaJson);
  const primaryNiche = readString(niche.primary);
  const secondaryNiche = readStringList(niche.secondary);
  const direction = joinPersonaCardTerms([
    ...splitPersonaCardTerms(readString(cardPreview.keywordsLabel)),
    primaryNiche,
    ...secondaryNiche,
    ...keywords,
  ], 2, 12);

  if (direction) return `适合写：${direction}`;

  const fallback = shortenPersonaCardTerm(getPersonaDisplaySummary(personaJson), 22);
  return fallback ? `适合写：${fallback}` : '适合写：继续探索图文方向';
}

function buildPersonaCardHookLine(personaJson: PersonaJson) {
  const cardPreview = readPersonaCardPreview(personaJson);
  const basicInfo = personaJson.basicInfo;
  const audience = readStringList(personaJson.audience);
  const baseProfile = splitPersonaCardTerms(readString(cardPreview.baseProfile));
  const ageText = basicInfo.age ? `${basicInfo.age}岁` : '';
  const hook = joinPersonaCardTerms([
    ...baseProfile,
    basicInfo.gender,
    ageText,
    basicInfo.occupation,
    ...audience,
  ], 3, 8);

  return hook ? `个人抓手：${hook}` : '个人抓手：真实日常';
}

function buildPersonaCardToneLine(personaJson: PersonaJson) {
  const cardPreview = readPersonaCardPreview(personaJson);
  const tone = joinPersonaCardTerms([
    ...splitPersonaCardTerms(readString(cardPreview.toneLabel)),
    ...readStringList(personaJson.contentStyle),
    personaJson.contentTone,
  ], 3, 8);

  return tone ? `内容气质：${tone}` : '内容气质：真实自然';
}

function buildPersonaCardMeta(
  personaJson: PersonaJson,
  recordMeta?: { savedAt?: string | null; expiresAt?: string | null; isFavorite?: boolean },
) {
  const savedAt = formatPersonaCardDate(recordMeta?.savedAt || personaJson.savedAt);
  if (recordMeta?.isFavorite) {
    return savedAt ? `保存于 ${savedAt}，长期保存` : '暂无保存时间，长期保存';
  }

  const prefix = savedAt ? `保存于 ${savedAt}` : '暂无保存时间';
  if (recordMeta?.expiresAt) {
    return `${prefix}，保留至 ${formatPersonaCardDate(recordMeta.expiresAt)}`;
  }
  return prefix;
}

export function normalizePersonaJson(value: unknown): PersonaJson | null {
  if (!isRecord(value)) return null;

  const persona = isRecord(value.persona) ? value.persona : {};
  const niche = isRecord(value.niche) ? value.niche : {};
  const title = readString(persona.name) || readString(value.title);
  if (!title) return null;

  const basicInfo = isRecord(value.basicInfo) ? value.basicInfo : {};
  const gender = basicInfo.gender === '男' ? '男' : '女';
  const age = readString(basicInfo.age);
  const occupation = readString(basicInfo.occupation);
  const primaryNiche = readString(niche.primary);
  const secondaryNiche = readStringList(niche.secondary);
  const audience = readStringList(value.audience);
  const contentStyle = readStringList(value.contentStyle);
  const cardPreview = isRecord(value.cardPreview) ? value.cardPreview : {};
  const referenceCreatorDirections = readStringList(value.referenceCreatorDirections);
  const followUpQuestions = readStringList(value.followUpQuestions);
  const keywordSource = isPersonaJson(value) ? value.keywords : [];
  const keywords = Array.from(new Set([primaryNiche, ...secondaryNiche, ...audience].filter(Boolean))).slice(0, 12);
  const normalizedKeywords = Array.from(new Set([...keywordSource, ...keywords])).slice(0, 12);
  const personaPosition =
    readString(value.personaPosition) ||
    [title, primaryNiche, ...secondaryNiche].filter(Boolean).join(' / ');
  const contentTone = readString(value.contentTone) || formatPersonaList(contentStyle) || '真实、经验分享、可操作';
  const conversation = Array.isArray(value.conversation)
    ? value.conversation.filter(
        (message): message is { role: 'assistant' | 'user'; content: string } =>
          isRecord(message) &&
          (message.role === 'assistant' || message.role === 'user') &&
          typeof message.content === 'string',
      )
    : [];
  const savedAt = readString(value.savedAt) || new Date().toISOString();

  return {
    title,
    basicInfo: {
      gender,
      age,
      occupation: occupation || audience[0] || '内容创作者',
      interests: readStringList(basicInfo.interests).length > 0 ? readStringList(basicInfo.interests) : [primaryNiche, ...secondaryNiche].filter(Boolean),
      skills: readStringList(basicInfo.skills).length > 0 ? readStringList(basicInfo.skills) : contentStyle,
    },
    keywords: normalizedKeywords,
    personaPosition,
    contentTone,
    conversation,
    savedAt,
    persona: Object.keys(persona).length > 0 ? persona : undefined,
    niche: Object.keys(niche).length > 0 ? niche : undefined,
    audience: audience.length > 0 ? audience : undefined,
    contentStyle: contentStyle.length > 0 ? contentStyle : undefined,
    cardPreview: Object.keys(cardPreview).length > 0 ? cardPreview : undefined,
    referenceCreatorDirections: referenceCreatorDirections.length > 0 ? referenceCreatorDirections : undefined,
    followUpQuestions: followUpQuestions.length > 0 ? followUpQuestions : undefined,
  };
}
