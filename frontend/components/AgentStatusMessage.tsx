'use client';

import Image from 'next/image';

import type { AgentStatusState } from '@/lib/agent-status';

export default function AgentStatusMessage({
  status,
  className = '',
  onRefresh,
  refreshDisabled = false,
}: {
  status: AgentStatusState;
  className?: string;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
}) {
  const toneClassName =
    status.kind === 'error'
      ? 'border-[var(--box-border)] bg-[rgba(255,255,255,0.94)] text-[var(--foreground)]'
      : status.kind === 'stopped'
        ? 'border-[var(--box-border)] bg-[rgba(255,255,255,0.94)] text-[var(--foreground)]'
        : 'border-[var(--box-border)] bg-[rgba(255,255,255,0.94)] text-[var(--foreground)]';

  const indicatorClassName =
    status.kind === 'error'
      ? 'bg-[var(--accent-rose)]'
      : status.kind === 'stopped'
        ? 'bg-[var(--title-blue)]'
        : 'bg-[var(--accent-rose)] animate-pulse';

  return (
    <div
      className={`koc-song-font mb-2 inline-flex w-fit max-w-full items-center gap-3 rounded-[14px] border px-4 py-3 text-[14px] leading-6 shadow-[var(--box-shadow)] ${toneClassName} ${className}`.trim()}
      aria-live="polite"
    >
      {status.kind === 'running' ? (
        <Image
          src="/koc-assets/icons/图标/等待.svg"
          alt=""
          width={18}
          height={18}
          className="koc-loading-spin size-[18px] shrink-0"
        />
      ) : (
        <span className={`mt-1 size-2.5 shrink-0 rounded-full ${indicatorClassName}`} aria-hidden="true" />
      )}
      <span>{status.message}</span>
      {status.kind === 'error' && onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshDisabled}
          className="koc-icon-center ml-1 size-9 rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.76)] text-[var(--foreground)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45"
          aria-label="重试上一次请求"
          title="重试上一次请求"
        >
          <Image src="/koc-assets/icons/图标/刷新.svg" alt="" width={22} height={22} className="size-[22px]" />
        </button>
      )}
    </div>
  );
}
