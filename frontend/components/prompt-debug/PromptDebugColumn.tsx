'use client';

import type { DebugMessage, RunStatus } from '@/components/prompt-debug/shared';
import MarkdownText from '@/components/MarkdownText';

interface PromptDebugColumnProps {
  title: string;
  subtitle: string;
  placeholder: string;
  composerPlaceholder: string;
  input: string;
  messages: DebugMessage[];
  status: RunStatus;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onOpenPrompt: () => void;
  scrollRef: (node: HTMLDivElement | null) => void;
  loadingText: string;
  footer?: React.ReactNode;
}

function statusLabel(status: RunStatus, messageCount: number) {
  if (status === 'loading') return '生成中';
  if (status === 'error') return '失败';
  if (messageCount > 0) return '已完成';
  return '待运行';
}

export default function PromptDebugColumn({
  title,
  subtitle,
  placeholder,
  composerPlaceholder,
  input,
  messages,
  status,
  onInputChange,
  onSubmit,
  onOpenPrompt,
  scrollRef,
  loadingText,
  footer,
}: PromptDebugColumnProps) {
  return (
    <section className="flex min-h-[360px] flex-col overflow-hidden rounded-[14px] bg-white/60 shadow-sm ring-1 ring-[#eadbcc]">
      <div className="shrink-0 border-b border-[#eadbcc] bg-[#dbc3b0] px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[20px] font-bold leading-tight text-[#241913]">{title}</h2>
            <p className="mt-1 text-[13px] font-semibold text-[#745043]">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-white/60 px-3 py-1 text-[12px] font-semibold text-[#745043]">
              {statusLabel(status, messages.length)}
            </span>
            <button
              type="button"
              onClick={onOpenPrompt}
              title={`编辑${title} Prompt`}
              aria-label={`编辑${title} Prompt`}
              className="grid size-8 shrink-0 place-items-center rounded-full bg-white/75 text-[13px] font-bold text-[#745043] shadow-sm ring-1 ring-[#eadbcc] transition hover:bg-white"
            >
              P
            </button>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-[15px] leading-[1.7] text-[#1f1712]">
        {messages.length === 0 ? (
          <div className="rounded-[14px] bg-[#f7efe8] p-5 text-[#5a4940]">
            <p className="font-semibold">建议输入</p>
            <p className="mt-2">{placeholder}</p>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={
                  message.role === 'user'
                    ? 'max-w-[86%] rounded-[18px] bg-[#a67369] px-5 py-3 text-white shadow-sm'
                    : 'max-w-[92%] rounded-[14px] bg-[#f7efe8] p-5 shadow-sm'
                }
              >
                <MarkdownText content={message.content} />
              </div>
            </div>
          ))
        )}
        {status === 'loading' && <p className="rounded-[14px] bg-[#f7efe8] p-5 text-[14px] text-[#a67369]">{loadingText}</p>}
        {footer}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="shrink-0 border-t border-[#eadbcc] bg-white px-4 py-3"
      >
        <div className="flex min-h-[48px] items-end rounded-full border border-[#d9d4cf] bg-white px-4 py-1 shadow-[0_2px_6px_rgba(72,58,50,0.14)]">
          <input
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSubmit();
              }
            }}
            disabled={status === 'loading'}
            placeholder={composerPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-[#3b2a21] outline-none placeholder:text-[#8d8a86] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={status === 'loading' || !input.trim()}
            className="grid size-10 place-items-center text-[26px] text-[#694a39] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45"
            aria-label={`发送${title}调试输入`}
          >
            {status === 'loading' ? '…' : '➤'}
          </button>
        </div>
      </form>
    </section>
  );
}
