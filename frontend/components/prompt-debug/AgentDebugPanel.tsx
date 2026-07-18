'use client';

import type { AgentDebugSettings } from '@/components/prompt-debug/shared';

interface AgentDebugPanelProps {
  settings: AgentDebugSettings;
  onBooleanChange: (field: 'enableTools' | 'requireRealWebResearch' | 'exposeAgentDetails', value: boolean) => void;
  onFieldChange: (field: 'maxToolCalls' | 'contentType' | 'language', value: string) => void;
  onDebugAuthChange: (field: 'webSearchApiKey' | 'webSearchProvider', value: string) => void;
}

export default function AgentDebugPanel({
  settings,
  onBooleanChange,
  onFieldChange,
  onDebugAuthChange,
}: AgentDebugPanelProps) {
  return (
    <section className="mt-5 rounded-[14px] bg-[#f7efe8] p-4 ring-1 ring-[#eadbcc]">
      <div className="mb-3">
        <h3 className="text-[16px] font-bold text-[#241913]">Harness 检索调试</h3>
        <p className="mt-1 text-[12px] leading-5 text-[#745043]">
          这里只影响 Prompt Debug / harness 调试链路，不改正式业务默认开关。
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-start gap-3 rounded-[12px] bg-white/75 px-3 py-3 ring-1 ring-[#eadbcc]">
          <input
            type="checkbox"
            checked={settings.enableTools}
            onChange={(event) => onBooleanChange('enableTools', event.target.checked)}
            className="mt-1 size-4 shrink-0 accent-[#a67369]"
          />
          <span>
            <span className="block text-[13px] font-semibold text-[#3b2a21]">启用 Agent 工具</span>
            <span className="mt-1 block text-[12px] leading-5 text-[#745043]">允许 `/agent/run` 进入 `web_search` 工具链路。</span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-[12px] bg-white/75 px-3 py-3 ring-1 ring-[#eadbcc]">
          <input
            type="checkbox"
            checked={settings.requireRealWebResearch}
            onChange={(event) => onBooleanChange('requireRealWebResearch', event.target.checked)}
            className="mt-1 size-4 shrink-0 accent-[#a67369]"
          />
          <span>
            <span className="block text-[13px] font-semibold text-[#3b2a21]">强制真实检索</span>
            <span className="mt-1 block text-[12px] leading-5 text-[#745043]">检索失败时直接报错，不允许 mock fallback。</span>
          </span>
        </label>

        <label className="flex items-start gap-3 rounded-[12px] bg-white/75 px-3 py-3 ring-1 ring-[#eadbcc] md:col-span-2">
          <input
            type="checkbox"
            checked={settings.exposeAgentDetails}
            onChange={(event) => onBooleanChange('exposeAgentDetails', event.target.checked)}
            className="mt-1 size-4 shrink-0 accent-[#a67369]"
          />
          <span>
            <span className="block text-[13px] font-semibold text-[#3b2a21]">回传 Agent 调试细节</span>
            <span className="mt-1 block text-[12px] leading-5 text-[#745043]">显示 `sources`、`toolCalls`、`metadata` 和首个工具错误。</span>
          </span>
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-[#745043]">最大检索条数</span>
          <input
            value={settings.maxToolCalls}
            onChange={(event) => onFieldChange('maxToolCalls', event.target.value)}
            className="h-10 w-full rounded-[12px] bg-white px-3 text-[13px] text-[#3b2a21] outline-none ring-1 ring-[#eadbcc] focus:ring-[#a67369]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-[#745043]">内容类型</span>
          <input
            value={settings.contentType}
            onChange={(event) => onFieldChange('contentType', event.target.value)}
            className="h-10 w-full rounded-[12px] bg-white px-3 text-[13px] text-[#3b2a21] outline-none ring-1 ring-[#eadbcc] focus:ring-[#a67369]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-[#745043]">语言</span>
          <input
            value={settings.language}
            onChange={(event) => onFieldChange('language', event.target.value)}
            className="h-10 w-full rounded-[12px] bg-white px-3 text-[13px] text-[#3b2a21] outline-none ring-1 ring-[#eadbcc] focus:ring-[#a67369]"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px]">
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-[#745043]">Tavily API Key</span>
          <input
            type="password"
            value={settings.debugAuth.webSearchApiKey}
            onChange={(event) => onDebugAuthChange('webSearchApiKey', event.target.value)}
            placeholder="tvly-..."
            className="h-10 w-full rounded-[12px] bg-white px-3 text-[13px] text-[#3b2a21] outline-none ring-1 ring-[#eadbcc] focus:ring-[#a67369]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-[#745043]">搜索 Provider</span>
          <input
            value={settings.debugAuth.webSearchProvider}
            onChange={(event) => onDebugAuthChange('webSearchProvider', event.target.value)}
            className="h-10 w-full rounded-[12px] bg-white px-3 text-[13px] text-[#3b2a21] outline-none ring-1 ring-[#eadbcc] focus:ring-[#a67369]"
          />
        </label>
      </div>
    </section>
  );
}
