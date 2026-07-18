'use client';

import { useEffect, useRef, useState } from 'react';
import PromptDebugAccessFallback from '@/components/prompt-debug/PromptDebugAccessFallback';
import PromptDebugColumn from '@/components/prompt-debug/PromptDebugColumn';
import PromptEditorModal from '@/components/prompt-debug/PromptEditorModal';
import {
  type ChatRole,
  type DebugMessage,
  type PersonaContext,
  type RunStatus,
  buildPersonaAugmentedUserPrompt,
  defaultPersonaContext,
  getErrorMessage,
  readString,
  stringifyUnknown,
} from '@/components/prompt-debug/shared';
import { isRecord, readJsonResponse } from '@/lib/api';
import { SHOW_PROMPT_DEBUG } from '@/lib/features';

type ModelId = 'gemini' | 'glm' | 'qwen';
type StatusTone = 'idle' | 'success' | 'error' | 'info';

interface ModelModuleConfig {
  id: ModelId;
  title: string;
  provider: string;
  placeholder: string;
  defaultPrompt: string;
  defaultBaseUrl: string;
  defaultModel: string;
  apiKeyPlaceholder: string;
}

interface ModelState {
  status: RunStatus;
  prompt: string;
  input: string;
  messages: DebugMessage[];
}

interface ModelConnection {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface ModelConfigActionState {
  saveMessage: string;
  saveTone: StatusTone;
  connectMessage: string;
  connectTone: StatusTone;
  isTesting: boolean;
}

const MODEL_CONNECTION_STORAGE_KEY = 'koc_prompt_debug_multi_connections_v1';

const modelModules: ModelModuleConfig[] = [
  {
    id: 'gemini',
    title: 'Gemini',
    provider: 'gemini',
    placeholder: '例如：请结合这个人设给我 5 个近期更容易涨粉的选题，并说明理由',
    defaultPrompt:
      '你是小红书 KOC 增长助手。请结合用户输入和给定的人设上下文，用中文输出结构清晰、可执行的建议；如果信息不足，先明确假设再回答。',
    defaultBaseUrl: 'https://api.openai-proxy.org/google/v1beta',
    defaultModel: 'gemini-2.5-flash',
    apiKeyPlaceholder: 'AIza...',
  },
  {
    id: 'glm',
    title: 'GLM',
    provider: 'glm',
    placeholder: '例如：请把这个账号方向拆成 3 个可执行的内容栏目，并给出每栏 2 个示例选题',
    defaultPrompt:
      '你是小红书 KOC 策略助手。请结合用户输入和给定的人设上下文，优先给出结构化、具体、可直接执行的中文方案。',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4.5',
    apiKeyPlaceholder: '请输入 GLM API Key',
  },
  {
    id: 'qwen',
    title: 'Qwen',
    provider: 'qwen',
    placeholder: '例如：请根据这个人设写一版更像真实博主口吻的小红书笔记开头',
    defaultPrompt:
      '你是小红书 KOC 内容助手。请结合用户输入和给定的人设上下文，用自然、真实、少模板感的中文完成回答。',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    apiKeyPlaceholder: 'sk-...',
  },
];

function createInitialModelStates(): Record<ModelId, ModelState> {
  return {
    gemini: { status: 'idle', prompt: modelModules[0].defaultPrompt, input: modelModules[0].placeholder, messages: [] },
    glm: { status: 'idle', prompt: modelModules[1].defaultPrompt, input: modelModules[1].placeholder, messages: [] },
    qwen: { status: 'idle', prompt: modelModules[2].defaultPrompt, input: modelModules[2].placeholder, messages: [] },
  };
}

function createInitialConnections(): Record<ModelId, ModelConnection> {
  return {
    gemini: {
      apiKey: '',
      baseUrl: modelModules[0].defaultBaseUrl,
      model: modelModules[0].defaultModel,
    },
    glm: {
      apiKey: '',
      baseUrl: modelModules[1].defaultBaseUrl,
      model: modelModules[1].defaultModel,
    },
    qwen: {
      apiKey: '',
      baseUrl: modelModules[2].defaultBaseUrl,
      model: modelModules[2].defaultModel,
    },
  };
}

function createInitialActionStates(): Record<ModelId, ModelConfigActionState> {
  return {
    gemini: { saveMessage: '', saveTone: 'idle', connectMessage: '', connectTone: 'idle', isTesting: false },
    glm: { saveMessage: '', saveTone: 'idle', connectMessage: '', connectTone: 'idle', isTesting: false },
    qwen: { saveMessage: '', saveTone: 'idle', connectMessage: '', connectTone: 'idle', isTesting: false },
  };
}

function normalizeConnection(
  connection: unknown,
  config: ModelModuleConfig,
): ModelConnection {
  const data = isRecord(connection) ? connection : null;
  return {
    apiKey: typeof data?.apiKey === 'string' ? data.apiKey.trim() : '',
    baseUrl: typeof data?.baseUrl === 'string' && data.baseUrl.trim() ? data.baseUrl.trim() : config.defaultBaseUrl,
    model: typeof data?.model === 'string' && data.model.trim() ? data.model.trim() : config.defaultModel,
  };
}

function connectionsEqual(left: ModelConnection, right: ModelConnection) {
  return left.apiKey === right.apiKey && left.baseUrl === right.baseUrl && left.model === right.model;
}

function statusTextClassName(tone: StatusTone) {
  if (tone === 'success') return 'text-[#2f6f4f]';
  if (tone === 'error') return 'text-[#a64b4b]';
  if (tone === 'info') return 'text-[#7a5a48]';
  return 'text-[#927a6d]';
}

function formatUsage(usage: unknown) {
  const data = isRecord(usage) ? usage : {};
  const input = data.input_tokens ?? data.prompt_tokens ?? data.promptTokenCount;
  const output = data.output_tokens ?? data.completion_tokens ?? data.candidatesTokenCount;
  const total = data.total_tokens ?? data.totalTokenCount;

  const parts = [
    input != null ? `input ${String(input)}` : '',
    output != null ? `output ${String(output)}` : '',
    total != null ? `total ${String(total)}` : '',
  ].filter(Boolean);

  return parts.join(' / ');
}

function formatModelReply(payload: unknown) {
  const data = isRecord(payload) ? payload : {};
  const outputText = readString(data.outputText) || stringifyUnknown(payload);
  const usage = formatUsage(data.usage);
  const meta = [
    readString(data.provider) ? `供应商：${readString(data.provider)}` : '',
    readString(data.model) ? `模型：${readString(data.model)}` : '',
    typeof data.httpStatus === 'number' ? `HTTP：${String(data.httpStatus)}` : '',
    usage ? `用量：${usage}` : '',
  ].filter(Boolean);

  return meta.length ? `> ${meta.join(' | ')}\n\n${outputText}` : outputText;
}

async function runModelPrompt(
  modelConfig: ModelModuleConfig,
  connection: ModelConnection,
  systemPrompt: string,
  userInput: string,
  personaContext: PersonaContext,
) {
  const response = await fetch('/prompt-debug/model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: modelConfig.provider,
      apiKey: connection.apiKey,
      baseUrl: connection.baseUrl,
      model: connection.model,
      systemPrompt,
      userPrompt: buildPersonaAugmentedUserPrompt(userInput, personaContext),
      temperature: 0.4,
      responseFormat: 'text',
      enableGoogleSearch: false,
      requireGoogleSearch: false,
    }),
  });

  const json = await readJsonResponse(response);
  if (!response.ok || (isRecord(json) && json.status === 'failed')) {
    throw new Error(getErrorMessage(json));
  }
  return formatModelReply(json);
}

export default function MultiPromptDebugPage() {
  const [moduleStates, setModuleStates] = useState<Record<ModelId, ModelState>>(createInitialModelStates);
  const [modelConnections, setModelConnections] = useState<Record<ModelId, ModelConnection>>(createInitialConnections);
  const [savedConnections, setSavedConnections] = useState<Record<ModelId, ModelConnection>>(createInitialConnections);
  const [actionStates, setActionStates] = useState<Record<ModelId, ModelConfigActionState>>(createInitialActionStates);
  const [promptEditorModule, setPromptEditorModule] = useState<ModelId | null>(null);
  const [personaContext, setPersonaContext] = useState<PersonaContext>(defaultPersonaContext);
  const [showSettings, setShowSettings] = useState(false);
  const messageIdRef = useRef(0);
  const scrollRefs = useRef<Record<ModelId, HTMLDivElement | null>>({
    gemini: null,
    glm: null,
    qwen: null,
  });

  const activePromptModule = promptEditorModule ? modelModules.find((item) => item.id === promptEditorModule) : null;

  useEffect(() => {
    if (!SHOW_PROMPT_DEBUG) return;
    modelModules.forEach((item) => {
      const container = scrollRefs.current[item.id];
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }, [moduleStates]);

  useEffect(() => {
    if (!SHOW_PROMPT_DEBUG || typeof window === 'undefined') return;
    let frameId = 0;

    try {
      const raw = window.localStorage.getItem(MODEL_CONNECTION_STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) return;

      const nextConnections = createInitialConnections();
      modelModules.forEach((item) => {
        nextConnections[item.id] = normalizeConnection(isRecord(parsed[item.id]) ? parsed[item.id] : null, item);
      });

      frameId = window.requestAnimationFrame(() => {
        setModelConnections(nextConnections);
        setSavedConnections(nextConnections);
      });
    } catch (error) {
      console.error('Failed to load saved model connections', error);
    }

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  if (!SHOW_PROMPT_DEBUG) {
    return <PromptDebugAccessFallback />;
  }

  const updateModule = (moduleId: ModelId, nextState: Partial<ModelState>) => {
    setModuleStates((current) => ({
      ...current,
      [moduleId]: {
        ...current[moduleId],
        ...nextState,
      },
    }));
  };

  const updateModuleField = (moduleId: ModelId, field: 'prompt' | 'input', value: string) => {
    updateModule(moduleId, { [field]: value });
  };

  const updatePersonaField = (field: keyof PersonaContext, value: string) => {
    setPersonaContext((current) => ({ ...current, [field]: value }));
  };

  const updateConnectionField = (moduleId: ModelId, field: keyof ModelConnection, value: string) => {
    setModelConnections((current) => ({
      ...current,
      [moduleId]: {
        ...current[moduleId],
        [field]: value,
      },
    }));
  };

  const updateActionState = (moduleId: ModelId, nextState: Partial<ModelConfigActionState>) => {
    setActionStates((current) => ({
      ...current,
      [moduleId]: {
        ...current[moduleId],
        ...nextState,
      },
    }));
  };

  const createMessageId = (moduleId: ModelId, role: ChatRole) => {
    messageIdRef.current += 1;
    return `${moduleId}-${role}-${messageIdRef.current}`;
  };

  const sendModuleMessage = async (moduleId: ModelId, source: 'prompt' | 'input') => {
    const currentState = moduleStates[moduleId];
    if (currentState.status === 'loading') return;

    const modelConfig = modelModules.find((item) => item.id === moduleId);
    if (!modelConfig) return;

    const modulePrompt = currentState.prompt.trim();
    const userInput = (source === 'prompt' ? currentState.input || currentState.prompt : currentState.input).trim();
    if (!modulePrompt || !userInput) return;

    const userMessage: DebugMessage = {
      id: createMessageId(moduleId, 'user'),
      role: 'user',
      content: userInput,
    };
    const nextHistory = [...currentState.messages, userMessage];

    updateModule(moduleId, {
      status: 'loading',
      input: source === 'input' ? '' : currentState.input,
      messages: nextHistory,
    });

    try {
      const reply = await runModelPrompt(modelConfig, modelConnections[moduleId], modulePrompt, userInput, personaContext);
      updateModule(moduleId, {
        status: 'done',
        messages: [...nextHistory, { id: createMessageId(moduleId, 'assistant'), role: 'assistant', content: reply }],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '请求失败，请确认 Agent 调试服务可用。';
      updateModule(moduleId, {
        status: 'error',
        messages: [...nextHistory, { id: createMessageId(moduleId, 'assistant'), role: 'assistant', content: `出错了：${message}` }],
      });
    }
  };

  const saveModelConnection = (moduleId: ModelId) => {
    if (typeof window === 'undefined') return;

    const config = modelModules.find((item) => item.id === moduleId);
    if (!config) return;

    const normalized = normalizeConnection(modelConnections[moduleId], config);
    const nextSavedConnections = {
      ...savedConnections,
      [moduleId]: normalized,
    };

    try {
      window.localStorage.setItem(MODEL_CONNECTION_STORAGE_KEY, JSON.stringify(nextSavedConnections));
      setModelConnections((current) => ({
        ...current,
        [moduleId]: normalized,
      }));
      setSavedConnections(nextSavedConnections);
      updateActionState(moduleId, {
        saveMessage: '配置已保存到本地',
        saveTone: 'success',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败';
      updateActionState(moduleId, {
        saveMessage: `保存失败：${message}`,
        saveTone: 'error',
      });
    }
  };

  const testModelConnection = async (moduleId: ModelId) => {
    const config = modelModules.find((item) => item.id === moduleId);
    if (!config) return;

    const connection = normalizeConnection(modelConnections[moduleId], config);
    if (!connection.apiKey) {
      updateActionState(moduleId, {
        connectMessage: '请先填写 API Key',
        connectTone: 'error',
        isTesting: false,
      });
      return;
    }

    updateActionState(moduleId, {
      connectMessage: '正在测试连通性…',
      connectTone: 'info',
      isTesting: true,
    });

    try {
      const response = await fetch('/prompt-debug/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: config.provider,
          apiKey: connection.apiKey,
          baseUrl: connection.baseUrl,
          model: connection.model,
          systemPrompt: '你是模型连通性测试助手。请只回复“连接成功”。',
          userPrompt: '请回复：连接成功',
          temperature: 0,
          responseFormat: 'text',
          enableGoogleSearch: false,
          requireGoogleSearch: false,
        }),
      });

      const json = await readJsonResponse(response);
      if (!response.ok || (isRecord(json) && json.status === 'failed')) {
        throw new Error(getErrorMessage(json));
      }

      const data = isRecord(json) ? json : {};
      updateActionState(moduleId, {
        connectMessage: `连通成功 · ${readString(data.model) || connection.model} · HTTP ${typeof data.httpStatus === 'number' ? String(data.httpStatus) : '200'}`,
        connectTone: 'success',
        isTesting: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '测试失败';
      updateActionState(moduleId, {
        connectMessage: `连通失败：${message}`,
        connectTone: 'error',
        isTesting: false,
      });
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden px-[4vw] pb-6 pt-6">
      <section className="mx-auto flex min-h-0 w-full max-w-[1320px] flex-1 flex-col">
        <div className="mb-4 flex shrink-0 justify-end">
          <button
            type="button"
            onClick={() => setShowSettings((current) => !current)}
            title="人设与模型配置"
            aria-label="人设与模型配置"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-[#e8ddd0] text-[15px] font-bold text-[#5a4940] transition hover:bg-[#dcc9b6]"
          >
            人
          </button>
        </div>

        {showSettings && (
          <div className="mb-5 shrink-0 rounded-[16px] bg-white/70 px-5 py-4 shadow-sm ring-1 ring-[#eadbcc]">
            <div className="mb-5">
              <h2 className="text-[18px] font-bold text-[#241913]">人设与模型配置</h2>
              <p className="mt-1 text-[13px] text-[#5a4940]">这里会把账号人设自动拼进每次测试输入，同时可以为 Gemini、GLM、Qwen 分别填写 URL、API Key 和模型名。</p>
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

            <div className="mt-5 grid gap-4 xl:grid-cols-3">
              {modelModules.map((item) => {
                const connection = modelConnections[item.id];
                const savedConnection = savedConnections[item.id];
                const actionState = actionStates[item.id];
                const isDirty = !connectionsEqual(connection, savedConnection);
                return (
                  <section key={item.id} className="rounded-[14px] bg-[#f7efe8] p-4 ring-1 ring-[#eadbcc]">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[16px] font-bold text-[#241913]">{item.title}</h3>
                      <span className={`text-[12px] font-semibold ${isDirty ? 'text-[#9b5d52]' : 'text-[#6f8a74]'}`}>
                        {isDirty ? '未保存修改' : '已保存'}
                      </span>
                    </div>
                    <div className="mt-3 space-y-3">
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-semibold text-[#745043]">Base URL</span>
                        <div className="flex gap-2">
                          <input value={connection.baseUrl} onChange={(event) => updateConnectionField(item.id, 'baseUrl', event.target.value)} className="h-10 min-w-0 flex-1 rounded-[12px] bg-white px-3 text-[13px] text-[#3b2a21] outline-none focus:ring-1 focus:ring-[#a67369]" />
                          <button
                            type="button"
                            onClick={() => {
                              void testModelConnection(item.id);
                            }}
                            disabled={actionState.isTesting}
                            className="shrink-0 rounded-[12px] bg-[#eadbcc] px-3 text-[12px] font-semibold text-[#5a4940] transition hover:bg-[#dcc9b6] disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {actionState.isTesting ? '测试中…' : '测试连通性'}
                          </button>
                        </div>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-semibold text-[#745043]">API Key</span>
                        <input type="password" value={connection.apiKey} onChange={(event) => updateConnectionField(item.id, 'apiKey', event.target.value)} placeholder={item.apiKeyPlaceholder} className="h-10 w-full rounded-[12px] bg-white px-3 text-[13px] text-[#3b2a21] outline-none focus:ring-1 focus:ring-[#a67369]" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-semibold text-[#745043]">Model</span>
                        <input value={connection.model} onChange={(event) => updateConnectionField(item.id, 'model', event.target.value)} className="h-10 w-full rounded-[12px] bg-white px-3 text-[13px] text-[#3b2a21] outline-none focus:ring-1 focus:ring-[#a67369]" />
                      </label>
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <div className="min-h-9 flex-1">
                          {actionState.connectMessage ? (
                            <p className={`text-[12px] leading-5 ${statusTextClassName(actionState.connectTone)}`}>{actionState.connectMessage}</p>
                          ) : (
                            <p className="text-[12px] leading-5 text-[#927a6d]">修改 URL、API Key 或模型名后，可先测试连通性，再保存配置。</p>
                          )}
                          {actionState.saveMessage ? (
                            <p className={`mt-1 text-[12px] leading-5 ${statusTextClassName(actionState.saveTone)}`}>{actionState.saveMessage}</p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => saveModelConnection(item.id)}
                          className="shrink-0 rounded-[12px] bg-[#a67369] px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-[#8f5f57]"
                        >
                          保存配置
                        </button>
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-3">
          {modelModules.map((item) => {
            const state = moduleStates[item.id];
            const connection = modelConnections[item.id];
            return (
              <PromptDebugColumn
                key={item.id}
                title={item.title}
                subtitle={connection.model}
                placeholder={item.placeholder}
                composerPlaceholder="输入要发给当前模型的测试内容"
                input={state.input}
                messages={state.messages}
                status={state.status}
                onInputChange={(value) => updateModuleField(item.id, 'input', value)}
                onSubmit={() => {
                  void sendModuleMessage(item.id, 'input');
                }}
                onOpenPrompt={() => setPromptEditorModule(item.id)}
                scrollRef={(node) => {
                  scrollRefs.current[item.id] = node;
                }}
                loadingText="模型正在结合人设上下文生成结果…"
              />
            );
          })}
        </div>
      </section>

      <PromptEditorModal
        open={Boolean(activePromptModule && promptEditorModule)}
        title={activePromptModule ? `${activePromptModule.title} Prompt` : ''}
        meta={
          promptEditorModule
            ? `${modelConnections[promptEditorModule].model} · ${modelConnections[promptEditorModule].baseUrl}`
            : ''
        }
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
