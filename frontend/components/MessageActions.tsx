'use client';

import Image from 'next/image';
import { createPortal } from 'react-dom';
import { useRef, useState, type ReactNode } from 'react';
import { trackAnalyticsEvent, type AgentOutputCopyEvent } from '@/lib/analytics';

interface MessageActionsProps {
  onRefresh?: () => void;
  onSave?: () => void;
  copyEvent?: AgentOutputCopyEvent;
  copyText?: string;
  refreshDisabled?: boolean;
  saveDisabled?: boolean;
  saving?: boolean;
}

function ActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [tooltipState, setTooltipState] = useState<{ visible: boolean; x: number; y: number }>({
    visible: false,
    x: 0,
    y: 0,
  });
  const [mounted] = useState(() => typeof window !== 'undefined');

  const updateTooltipPosition = (clientX: number, clientY: number) => {
    setTooltipState({
      visible: true,
      x: clientX + 14,
      y: clientY + 14,
    });
  };

  const handleFocus = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipState({
      visible: true,
      x: rect.right + 14,
      y: rect.top + 14,
    });
  };

  const tooltip =
    mounted && tooltipState.visible
      ? createPortal(
          <div
            className="pointer-events-none fixed z-[2147483647] whitespace-nowrap rounded-[2px] border border-[#cfcfcf] bg-[rgba(236,236,236,0.98)] px-2 py-1 text-[11px] leading-none text-[#777777] shadow-none"
            style={{ left: tooltipState.x, top: tooltipState.y }}
          >
            {label}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="koc-icon-center size-11 border border-transparent bg-transparent shadow-none text-[22px] font-semibold text-[var(--foreground)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45"
        aria-label={label}
        onMouseEnter={(event) => updateTooltipPosition(event.clientX, event.clientY)}
        onMouseMove={(event) => updateTooltipPosition(event.clientX, event.clientY)}
        onMouseLeave={() => setTooltipState((current) => ({ ...current, visible: false }))}
        onFocus={handleFocus}
        onBlur={() => setTooltipState((current) => ({ ...current, visible: false }))}
      >
        {children}
      </button>
      {tooltip}
    </>
  );
}

async function writeCopyText(value: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }

  if (typeof document === 'undefined') {
    throw new Error('clipboard unavailable');
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand('copy');
    if (!copied) {
      throw new Error('execCommand copy failed');
    }
  } finally {
    document.body.removeChild(textarea);
  }
}

export default function MessageActions({
  onRefresh,
  onSave,
  copyEvent,
  copyText,
  refreshDisabled = false,
  saveDisabled = false,
  saving = false,
}: MessageActionsProps) {
  const [copying, setCopying] = useState(false);

  const handleCopy = async () => {
    if (!copyEvent || !copyText || !copyText.trim() || copying) return;
    try {
      setCopying(true);
      await writeCopyText(copyText);
      await trackAnalyticsEvent(copyEvent);
    } catch (error) {
      console.warn('copy failed', error);
    } finally {
      setCopying(false);
    }
  };

  if (!onRefresh && !onSave && !copyEvent) return null;

  return (
    <div className="koc-safe-shadow-area flex items-center gap-2 pt-1">
      {onRefresh && (
        <ActionButton label="重新生成" disabled={refreshDisabled} onClick={onRefresh}>
          <Image src="/koc-assets/icons/图标/刷新.svg" alt="" width={28} height={28} className="size-[28px]" />
        </ActionButton>
      )}
      {copyEvent && copyText && (
        <ActionButton label="复制这段内容" disabled={copying} onClick={() => void handleCopy()}>
          <Image src="/koc-assets/icons/图标/复制.svg" alt="" width={28} height={28} className="size-[28px]" />
        </ActionButton>
      )}
      {onSave && (
        <ActionButton label="保存这段记录" disabled={saveDisabled || saving} onClick={onSave}>
          {saving ? <Image src="/koc-assets/icons/图标/等待.svg" alt="" width={30} height={30} className="koc-loading-spin size-[30px]" /> : <Image src="/koc-assets/icons/图标/保存.svg" alt="" width={28} height={28} className="size-[28px]" />}
        </ActionButton>
      )}
    </div>
  );
}
