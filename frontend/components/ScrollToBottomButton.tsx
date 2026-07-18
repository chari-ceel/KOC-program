'use client';

export default function ScrollToBottomButton({
  onClick,
}: {
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute bottom-[96px] left-1/2 z-20 grid size-10 -translate-x-1/2 place-items-center rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] text-xl text-[var(--foreground)] shadow-[var(--box-shadow)]"
      aria-label="滚动到底部"
    >
      ↓
    </button>
  );
}
