'use client';

import type { ClipboardEvent, MouseEvent, ReactNode } from 'react';

export default function ChatMessageBubble({
  variant,
  children,
  className = '',
  inheritTextColor = false,
  innerClassName = '',
}: {
  variant: 'user' | 'assistant';
  children: ReactNode;
  className?: string;
  inheritTextColor?: boolean;
  innerClassName?: string;
}) {
  const baseClassName =
    variant === 'user'
      ? 'koc-song-font koc-chat-bubble-user ml-[12%] max-w-[min(78%,720px)] rounded-[12px] px-4 py-2.5 text-[15px] leading-7'
      : 'koc-song-font koc-chat-bubble-agent max-w-[min(78%,720px)] rounded-[12px] p-4 text-[15px] font-medium leading-[1.72] select-none';

  const textColorClassName = inheritTextColor ? 'text-[var(--foreground)]' : 'text-[var(--foreground)]';
  const blockCopyEvents =
    variant === 'assistant'
      ? {
          onCopy: (event: ClipboardEvent<HTMLDivElement>) => event.preventDefault(),
          onContextMenu: (event: MouseEvent<HTMLDivElement>) => event.preventDefault(),
        }
      : {};

  return (
    <div className={`${baseClassName} ${textColorClassName} ${className}`.trim()} {...blockCopyEvents}>
      <div className={innerClassName}>{children}</div>
    </div>
  );
}
