'use client';

type TopToastTone = 'success' | 'error' | 'info';

export default function TopToast({
  message,
  tone = 'info',
  actionLabel,
  onAction,
}: {
  message: string;
  tone?: TopToastTone;
  actionLabel?: string;
  onAction?: () => void;
}) {
  if (!message) return null;

  const toneClassName =
    tone === 'success'
      ? 'border-[var(--box-border)] bg-[rgba(255,255,255,0.95)] text-[var(--foreground)]'
      : tone === 'error'
        ? 'border-[var(--box-border)] bg-[rgba(255,255,255,0.95)] text-[var(--foreground)]'
        : 'border-[var(--box-border)] bg-[rgba(255,255,255,0.95)] text-[var(--foreground)]';

  return (
    <div className="pointer-events-none fixed inset-x-0 top-5 z-50 flex justify-center px-4">
      <div
        className={`koc-top-toast pointer-events-auto inline-flex min-h-11 items-center gap-3 rounded-full border px-5 py-2 text-sm font-medium shadow-[var(--box-shadow)] backdrop-blur-sm ${toneClassName}`}
      >
        <span>{message}</span>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.8)] px-3 py-1 text-xs font-semibold transition hover:bg-white"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
