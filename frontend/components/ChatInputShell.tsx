'use client';

import type { ReactNode } from 'react';

export default function ChatInputShell({
  children,
  className = '',
  compact = false,
}: {
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  const widthClassName = compact
    ? 'w-full max-w-[960px]'
    : 'mx-auto w-full max-w-[960px] shrink-0';

  return (
    <div className={`koc-safe-shadow-area ${widthClassName} ${compact ? '' : 'mt-4'} pb-1.5 ${className}`.trim()}>
      {children}
    </div>
  );
}
