'use client';

import { useEffect, useRef, useState } from 'react';
import AgentDebugDetails from '@/components/prompt-debug/AgentDebugDetails';
import AgentDebugPanel from '@/components/prompt-debug/AgentDebugPanel';
import PromptDebugAccessFallback from '@/components/prompt-debug/PromptDebugAccessFallback';
import PromptDebugColumn from '@/components/prompt-debug/PromptDebugColumn';
import PromptEditorModal from '@/components/prompt-debug/PromptEditorModal';
import {
  type AgentDebugSettings,
  type ChatRole,
  type DebugMessage,
  type PersonaContext,
  type RunStatus,
  buildAgentDebugPayload,
  buildPersonaContext,
  defaultAgentDebugSettings,
  defaultPersonaContext,
  getErrorMessage,
  readString,
  readStringList,
  stringifyUnknown,
} from '@/components/prompt-debug/shared';
import { API_BASE, isRecord, readJsonResponse } from '@/lib/api';
import { SHOW_PROMPT_DEBUG } from '@/lib/features';
import { buildInitialContentAgentPrompt, buildInitialTrendAgentPrompt } from '@/lib/initial-agent-prompts';

type ModuleId = 'persona' | 'trending' | 'content';

interface ModuleConfig {
  id: ModuleId;
  title: string;
  subtitle: string;
  placeholder: string;
  defaultPrompt: string;
}

interface ModuleState {
  status: RunStatus;
  prompt: string;
  input: string;
  messages: DebugMessage[];
  debug: unknown;
}

const modules: ModuleConfig[] = [
  {
    id: 'persona',
    title: '人设打造',
    subtitle: 'persona.follow_up',
    placeholder: '例如：我是一个爱探店的大学生，想做松弛感生活账号',
    defaultPrompt:
      '你是小红书 KOC 人设打造助手。请根据用户输入补全账号人设定位、内容方向、关键词、表达语气，并给出下一轮追问。',
  },
  {
    id: 'trending',
    title: '热门追踪',
    subtitle: 'trend.track',
    placeholder: '例如：帮我看最近适合大学生生活博主的选题趋势',
    defaultPrompt:
      '你是小红书热点追踪助手。请围绕用户账号方向输出近一周热点趋势、受众需求洞察和适合继续创作的选题机会。',
  },
  {
    id: 'content',
    title: '内容撰写',
    subtitle: 'content.draft',
    placeholder: '例如：围绕低成本周末探店写一篇小红书笔记',
    defaultPrompt:
      '你是小红书内容撰写助手。请根据用户主题生成标题、引入、正文结构、结尾互动和标签建议。',
  },
];

function createInitialModuleStates(): Record<ModuleId, ModuleState> {
  return {
    persona: { status: 'idle', prompt: modules[0].defaultPrompt, input: modules[0].placeholder, messages: [], debug: null },
    trending: { status: 'idle', prompt: modules[1].defaultPrompt, input: modules[1].placeholder, messages: [], debug: null },
    content: { status: 'idle', prompt: modules[2].defaultPrompt, input: modules[2].placeholder, messages: [], debug: null },
  };
}

function formatPersonaReply(payload: unknown) {
  const data = isRecord(payload) ? payload : {};
  const reply = readString(data.reply);
  const draft = isRecord(data.personaDraft) ? data.personaDraft : null;
  const questions = readStringList(data.nextQuestions ?? data.followUpQuestions);
  const lines = [];

  if (reply) lines.push(reply);
  if (draft) {
    lines.push('## 人设草稿');
    lines.push(`\`\`\`json\n${JSON.stringify(draft, null, 2)}\n\`\`\``);
  }
  if (questions.length) {
    lines.push('## 追问');
    lines.push(questions.map((question, index) => `${index + 1}. ${question}`).join('\n'));
  }

  return lines.join('\n\n') || stringifyUnknown(payload);
}

function formatTrendReply(payload: unknown) {
  const data = isRecord(payload) ? payload : {};
  const text = readString(data.text);
  const completeAnalysis = isRecord(data.completeAnalysis)
    ? data.completeAnalysis
    : isRecord(data.structured)
      ? data.structured
      : null;
  if (!completeAnalysis) return text || stringifyUnknown(payload);

  const topics = readStringList(completeAnalysis.topics);
  return [
    readString(completeAnalysis.trackName) ? `## ${readString(completeAnalysis.trackName)}` : '## 热门追踪结果',
    readString(completeAnalysis.trends) ? `### 近一周热点趋势\n${readString(completeAnalysis.trends)}` : '',
    readString(completeAnalysis.audience) ? `### 受众需求洞察\n${readString(completeAnalysis.audience)}` : '',
    topics.length ? `### 选题机会\n${topics.map((topic, index) => `${index + 1}. ${topic}`).join('\n')}` : '',
    !text || text.includes(readString(completeAnalysis.trends)) ? '' : `### 原始回复\n${text}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function formatContentReply(payload: unknown) {
  const data = isRecord(payload) ? payload : {};
  const draft = isRecord(data.completeDraft)
    ? data.completeDraft
    : isRecord(data.revisedDraft)
      ? data.revisedDraft
      : isRecord(data.draft)
        ? data.draft
        : data;
  const text = readString(data.text);
  if (!isRecord(draft)) return text || stringifyUnknown(payload);

  const title = readString(draft.selectedTitle) || readString(draft.noteTitle) || readString(draft.title);
  const titleOptions = readStringList(draft.titleOptions);
  const intro = readString(draft.intro) || readString(draft.hook);
  const body = readStringList(draft.body);
  const tags = readStringList(draft.tags).map((tag) => tag.replace(/^#/, ''));

  return [
    title ? `## ${title}` : titleOptions.length ? `## ${titleOptions[0]}` : '## 内容草稿',
    titleOptions.length > 1 ? `### 标题备选\n${titleOptions.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : '',
    intro ? `### 引入\n${intro}` : '',
    body.length ? `### 正文内容\n${body.join('\n\n')}` : '',
    readString(draft.ending) ? `### 结尾互动\n${readString(draft.ending)}` : '',
    tags.length ? `### 标签建议\n${tags.map((tag) => `#${tag}`).join(' ')}` : '',
    !title && !body.length && text ? text : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function runModule(
  moduleId: ModuleId,
  modulePrompt: string,
  userInput: string,
  history: DebugMessage[],
  personaContext: ReturnType<typeof buildPersonaContext>,
  agentDebug: AgentDebugSettings,
) {
  const conversationHistory = history.map((message) => ({
    role: message.role,
    content: message.content,
  }));
  const basicInfo = personaContext.basicInfo;
  const requestAgentDebug = buildAgentDebugPayload(agentDebug);
  const isInitialTurn = history.filter((message) => message.role === 'user').length === 1;

  if (moduleId === 'persona') {
    const response = await fetch(`${API_BASE}/api/persona/follow_up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'demo-user',
        basicInfo,
        userMessage: userInput,
        conversationHistory,
        promptOverride: modulePrompt,
        agentDebug: requestAgentDebug,
      }),
    });
    const json = await readJsonResponse(response);
    if (!response.ok || (isRecord(json) && json.code !== 200)) throw new Error(getErrorMessage(json));
    const data = isRecord(json) ? json.data : json;
    return {
      content: formatPersonaReply(data),
      debug: isRecord(json) ? json.debug : null,
    };
  }

  if (moduleId === 'trending') {
    const preference = isInitialTurn ? buildInitialTrendAgentPrompt(userInput) : userInput;
    const response = await fetch(`${API_BASE}/api/trends/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'demo-user',
        preference,
        persona: personaContext,
        conversationHistory,
        promptOverride: modulePrompt,
        agentDebug: requestAgentDebug,
      }),
    });
    const json = await readJsonResponse(response);
    if (!response.ok || (isRecord(json) && json.code !== 200)) throw new Error(getErrorMessage(json));
    const data = isRecord(json) ? json.data : json;
    return {
      content: formatTrendReply(data),
      debug: isRecord(json) ? json.debug : null,
    };
  }

  const response = await fetch(`${API_BASE}/api/content/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'demo-user',
      topic: userInput,
      instruction: isInitialTurn ? buildInitialContentAgentPrompt(userInput, userInput) : userInput,
      conversationHistory,
      persona: personaContext,
      promptOverride: modulePrompt,
      agentDebug: requestAgentDebug,
    }),
  });
  const json = await readJsonResponse(response);
  if (!response.ok || (isRecord(json) && json.code !== 200)) throw new Error(getErrorMessage(json));
  const data = isRecord(json) ? json.data : json;
  return {
    content: formatContentReply(data),
    debug: isRecord(json) ? json.debug : null,
  };
}

export default function SinglePromptDebugPage() {
  const [moduleStates, setModuleStates] = useState<Record<ModuleId, ModuleState>>(createInitialModuleStates);
  const [promptEditorModule, setPromptEditorModule] = useState<ModuleId | null>(null);
  const [personaContext, setPersonaContext] = useState<PersonaContext>(defaultPersonaContext);
  const [agentDebug, setAgentDebug] = useState<AgentDebugSettings>(defaultAgentDebugSettings);
  const [showPersonaContext, setShowPersonaContext] = useState(false);
  const [promptMeta, setPromptMeta] = useState<Record<ModuleId, string>>({
    persona: 'persona.prompt.md',
    trending: 'trend-tracking.prompt.md',
    content: 'xhs-content-writing.prompt.md',
  });
  const messageIdRef = useRef(0);
  const scrollRefs = useRef<Record<ModuleId, HTMLDivElement | null>>({
    persona: null,
    trending: null,
    content: null,
  });

  const activePromptModule = promptEditorModule ? modules.find((module) => module.id === promptEditorModule) : null;

  useEffect(() => {
    if (!SHOW_PROMPT_DEBUG) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/prompt-debug/prompts');
        const json = await readJsonResponse(response);
        const prompts = isRecord(json) && isRecord(json.data) && isRecord(json.data.prompts) ? json.data.prompts : null;
        if (!response.ok || !prompts) {
          throw new Error(getErrorMessage(json));
        }
        if (cancelled) return;
        setModuleStates((current) => {
          const next = { ...current };
          modules.forEach((module) => {
            const promptInfo = prompts[module.id];
            if (isRecord(promptInfo) && typeof promptInfo.content === 'string') {
              next[module.id] = { ...next[module.id], prompt: promptInfo.content };
            }
          });
          return next;
        });
        setPromptMeta((current) => {
          const next = { ...current };
          modules.forEach((module) => {
            const promptInfo = prompts[module.id];
            if (isRecord(promptInfo) && typeof promptInfo.fileName === 'string') {
              next[module.id] = promptInfo.fileName;
            }
          });
          return next;
        });
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to load real prompts', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!SHOW_PROMPT_DEBUG) return;
    modules.forEach((module) => {
      const container = scrollRefs.current[module.id];
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }, [moduleStates]);

  if (!SHOW_PROMPT_DEBUG) {
    return <PromptDebugAccessFallback />;
  }

  const updateModule = (moduleId: ModuleId, nextState: Partial<ModuleState>) => {
    setModuleStates((current) => ({
      ...current,
      [moduleId]: {
        ...current[moduleId],
        ...nextState,
      },
    }));
  };

  const updateModuleField = (moduleId: ModuleId, field: 'prompt' | 'input', value: string) => {
    updateModule(moduleId, { [field]: value });
  };

  const updateAgentDebugBoolean = (
    field: 'enableTools' | 'requireRealWebResearch' | 'exposeAgentDetails',
    value: boolean,
  ) => {
    setAgentDebug((current) => ({ ...current, [field]: value }));
  };

  const updateAgentDebugField = (field: 'maxToolCalls' | 'contentType' | 'language', value: string) => {
    setAgentDebug((current) => ({ ...current, [field]: value }));
  };

  const updateAgentDebugAuthField = (
    field: 'webSearchApiKey' | 'webSearchProvider',
    value: string,
  ) => {
    setAgentDebug((current) => ({
      ...current,
      debugAuth: {
        ...current.debugAuth,
        [field]: value,
      },
    }));
  };

  const updatePersonaField = (field: keyof PersonaContext, value: string) => {
    setPersonaContext((current) => ({ ...current, [field]: value }));
  };

  const createMessageId = (moduleId: ModuleId, role: ChatRole) => {
    messageIdRef.current += 1;
    return `${moduleId}-${role}-${messageIdRef.current}`;
  };

  const sendModuleMessage = async (moduleId: ModuleId, source: 'prompt' | 'input') => {
    const currentState = moduleStates[moduleId];
    if (currentState.status === 'loading') return;

    const modulePrompt = currentState.prompt.trim();
    const userInput = (source === 'prompt' ? currentState.input || currentState.prompt : currentState.input).trim();
    if (!modulePrompt || !userInput) return;

    const isInitialTurn = currentState.messages.filter((message) => message.role === 'user').length === 0;
    const displayedUserInput =
      isInitialTurn && moduleId === 'trending'
        ? buildInitialTrendAgentPrompt(userInput)
        : isInitialTurn && moduleId === 'content'
          ? buildInitialContentAgentPrompt(userInput, userInput)
          : userInput;
    const userMessage: DebugMessage = {
      id: createMessageId(moduleId, 'user'),
      role: 'user',
      content: displayedUserInput,
    };
    const nextHistory = [...currentState.messages, userMessage];

    updateModule(moduleId, {
      status: 'loading',
      input: source === 'input' ? '' : currentState.input,
      messages: nextHistory,
      debug: null,
    });

    try {
      const reply = await runModule(
        moduleId,
        modulePrompt,
        userInput,
        nextHistory,
        buildPersonaContext(personaContext),
        agentDebug,
      );
      updateModule(moduleId, {
        status: 'done',
        messages: [...nextHistory, { id: createMessageId(moduleId, 'assistant'), role: 'assistant', content: reply.content }],
        debug: reply.debug,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '请求失败，请确认后端服务已启动。';
      updateModule(moduleId, {
        status: 'error',
        messages: [...nextHistory, { id: createMessageId(moduleId, 'assistant'), role: 'assistant', content: `出错了：${message}` }],
        debug: null,
      });
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden px-[4vw] pb-6 pt-6">
      <section className="mx-auto flex min-h-0 w-full max-w-[1320px] flex-1 flex-col">
        <div className="mb-4 flex shrink-0 justify-end">
          <button
            type="button"
            onClick={() => setShowPersonaContext((current) => !current)}
            title="人设上下文"
            aria-label="人设上下文"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-[#e8ddd0] text-[15px] font-bold text-[#5a4940] transition hover:bg-[#dcc9b6]"
          >
            人
          </button>
        </div>

        {showPersonaContext && (
          <div className="mb-5 shrink-0 rounded-[16px] bg-white/70 px-5 py-4 shadow-sm ring-1 ring-[#eadbcc]">
            <div className="mb-3">
              <h2 className="text-[18px] font-bold text-[#241913]">内置人设上下文</h2>
              <p className="mt-1 text-[13px] text-[#5a4940]">这里模拟人设打造页已经内置好的基础信息，三大板块调用时会自动带上。</p>
            </div>
            <div className="grid gap-3 md:grid-cols-5">
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-[#745043]">性别</span>
                <input value={personaContext.gender} onChange={(event) => updatePersonaField('gender', event.target.value)} className="h-10 w-full rounded-[12px] bg-[#f8efe7] px-3 text-[13px] text-[#3b2a21] outline-none focus:ring-1 focus:ring-[#a67369]" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-[#745043]">年龄</span>
                <input value={personaContext.age} onChange={(event) => updatePersonaField('age', event.target.value)} className="h-10 w-full rounded-[12px] bg-[#f8efe7] px-3 text-[13px] text-[#3b2a21] outline-none focus:ring-1 focus:ring-[#a67369]" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-[#745043]">职业</span>
                <input value={personaContext.occupation} onChange={(event) => updatePersonaField('occupation', event.target.value)} className="h-10 w-full rounded-[12px] bg-[#f8efe7] px-3 text-[13px] text-[#3b2a21] outline-none focus:ring-1 focus:ring-[#a67369]" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-[#745043]">兴趣爱好</span>
                <input value={personaContext.interests} onChange={(event) => updatePersonaField('interests', event.target.value)} className="h-10 w-full rounded-[12px] bg-[#f8efe7] px-3 text-[13px] text-[#3b2a21] outline-none focus:ring-1 focus:ring-[#a67369]" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-semibold text-[#745043]">技能特长</span>
                <input value={personaContext.skills} onChange={(event) => updatePersonaField('skills', event.target.value)} className="h-10 w-full rounded-[12px] bg-[#f8efe7] px-3 text-[13px] text-[#3b2a21] outline-none focus:ring-1 focus:ring-[#a67369]" />
              </label>
            </div>

            <AgentDebugPanel
              settings={agentDebug}
              onBooleanChange={updateAgentDebugBoolean}
              onFieldChange={updateAgentDebugField}
              onDebugAuthChange={updateAgentDebugAuthField}
            />
          </div>
        )}

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-3">
          {modules.map((module) => {
            const state = moduleStates[module.id];
            return (
              <PromptDebugColumn
                key={module.id}
                title={module.title}
                subtitle={module.subtitle}
                placeholder={module.placeholder}
                composerPlaceholder="输入这个板块的独立对话"
                input={state.input}
                messages={state.messages}
                status={state.status}
                onInputChange={(value) => updateModuleField(module.id, 'input', value)}
                onSubmit={() => {
                  void sendModuleMessage(module.id, 'input');
                }}
                onOpenPrompt={() => setPromptEditorModule(module.id)}
                scrollRef={(node) => {
                  scrollRefs.current[module.id] = node;
                }}
                loadingText="Agent 正在结合上下文生成草稿…"
                footer={state.debug ? <AgentDebugDetails payload={state.debug} /> : null}
              />
            );
          })}
        </div>
      </section>

      <PromptEditorModal
        open={Boolean(activePromptModule && promptEditorModule)}
        title={activePromptModule ? `${activePromptModule.title} Prompt` : ''}
        meta={promptEditorModule ? promptMeta[promptEditorModule] : ''}
        value={promptEditorModule ? moduleStates[promptEditorModule].prompt : ''}
        disabled={promptEditorModule ? moduleStates[promptEditorModule].status === 'loading' : false}
        canRun={
          Boolean(
            promptEditorModule &&
              moduleStates[promptEditorModule].status !== 'loading' &&
              moduleStates[promptEditorModule].prompt.trim() &&
              moduleStates[promptEditorModule].input.trim(),
          )
        }
        onChange={(value) => {
          if (!promptEditorModule) return;
          updateModuleField(promptEditorModule, 'prompt', value);
        }}
        onClose={() => setPromptEditorModule(null)}
        onRun={() => {
          if (!promptEditorModule) return;
          void sendModuleMessage(promptEditorModule, 'prompt');
          setPromptEditorModule(null);
        }}
      />
    </div>
  );
}
