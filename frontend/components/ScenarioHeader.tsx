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
            className="koc-heading-font grid size-[72px] place-items-center rounded-full border border-[var(--box-border)] bg-[rgba(239,229,217,0.8)] text-[34px] text-[var(--foreground)] shadow-[var(--box-shadow)]"
          >
            梨
          </div>
          <div>
            <h1 className="koc-title-font text-[34px] leading-tight text-[var(--foreground)]">{title}</h1>
            <p className="koc-song-font mt-1 text-[17px] leading-6 text-[var(--foreground)]">{subtitle}</p>
          </div>
        </div>
        {action}
      </div>
    </div>
  );
}
