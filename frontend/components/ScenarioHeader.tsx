'use client';

import type { ReactNode } from 'react';

interface ScenarioHeaderProps {
  subtitle: string;
  action?: ReactNode;
  title?: string;
}

export default function ScenarioHeader({
  subtitle,
  action,
  title = '顶流小猪梨',
}: ScenarioHeaderProps) {
  return (
    <div className="mx-auto w-full max-w-[980px] shrink-0">
      <div className="mb-5 flex flex-col gap-4 rounded-[24px] border border-transparent bg-transparent px-1 py-5 shadow-none sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-5">
          <div
            className="koc-heading-font grid size-[64px] place-items-center rounded-[16px] border border-[var(--box-border)] bg-[#f6f7f9] text-[30px] text-[var(--foreground)] shadow-[var(--box-shadow)]"
          >
            梨
          </div>
          <div>
            <h1 className="koc-title-font koc-gradient-title text-[30px] leading-tight">{title}</h1>
            <p className="koc-song-font mt-1 text-[16px] leading-6 text-[var(--muted-text)]">{subtitle}</p>
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}
