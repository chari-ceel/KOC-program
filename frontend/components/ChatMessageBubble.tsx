'use client';

import type { ClipboardEvent, MouseEvent, ReactNode, SyntheticEvent } from 'react';

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
      ? 'koc-song-font koc-chat-bubble-user ml-[12%] max-w-[min(72%,680px)] rounded-[18px] px-5 py-3 text-[15px] leading-7'
      : 'koc-song-font koc-chat-bubble-agent rounded-[18px] p-6 text-[16px] font-medium leading-[1.75] select-none';

  const textColorClassName = inheritTextColor ? 'text-[var(--foreground)]' : 'text-[var(--foreground)]';
  const blockCopyEvents =
    variant === 'assistant'
      ? {
          onCopy: (event: ClipboardEvent<HTMLDivElement>) => event.preventDefault(),
          onContextMenu: (event: MouseEvent<HTMLDivElement>) => event.preventDefault(),
          onSelectStart: (event: SyntheticEvent<HTMLDivElement>) => event.preventDefault(),
        }
      : {};

  return (
    <div className={`${baseClassName} ${textColorClassName} ${className}`.trim()} {...blockCopyEvents}>
      <div className={innerClassName}>{children}</div>
    </div>
  );
}
