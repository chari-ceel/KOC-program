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
    ? 'w-full max-w-[980px]'
    : 'mx-auto w-full max-w-[980px] shrink-0';

  return (
    <div className={`koc-safe-shadow-area ${widthClassName} ${compact ? '' : 'mt-8'} pb-2 ${className}`.trim()}>
      {children}
    </div>
  );
}
