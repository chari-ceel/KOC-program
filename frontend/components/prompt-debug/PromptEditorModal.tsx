'use client';

import { createPortal } from 'react-dom';

interface PromptEditorModalProps {
  open: boolean;
  title: string;
  meta: string;
  value: string;
  disabled: boolean;
  canRun: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onRun: () => void;
}

export default function PromptEditorModal({
  open,
  title,
  meta,
  value,
  disabled,
  canRun,
  onChange,
  onClose,
  onRun,
}: PromptEditorModalProps) {
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#241913]/35 px-5 py-8">
      <section className="flex max-h-full w-full max-w-[860px] flex-col rounded-[16px] bg-white shadow-[0_22px_80px_rgba(36,25,19,0.28)] ring-1 ring-[#eadbcc]">
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[#eadbcc] px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-[20px] font-bold leading-tight text-[#241913]">{title}</h2>
            <p className="mt-1 text-[13px] text-[#745043]">{meta}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f8efe7] text-[18px] font-semibold text-[#745043] transition hover:bg-[#eadbcc]"
            aria-label="关闭 Prompt 编辑"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 p-6">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            disabled={disabled}
            className="h-[58vh] min-h-[360px] w-full resize-none rounded-[14px] bg-[#f8efe7] px-4 py-3 font-mono text-[13px] leading-6 text-[#241913] outline-none ring-1 ring-[#eadbcc] focus:ring-[#a67369] disabled:opacity-60"
          />
        </div>

        <div className="flex shrink-0 justify-end gap-3 border-t border-[#eadbcc] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-[#e8ddd0] px-5 py-2 text-[14px] font-medium text-[#5a4940] transition hover:bg-[#dcc9b6]"
          >
            完成
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={!canRun}
            className="rounded-full bg-[#a67369] px-5 py-2 text-[14px] font-semibold text-white shadow-sm transition hover:bg-[#8f5f57] disabled:cursor-not-allowed disabled:opacity-50"
          >
            运行 Prompt
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
