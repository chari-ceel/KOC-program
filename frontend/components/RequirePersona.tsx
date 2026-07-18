'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useAppState } from '@/context/AppStateContext';

export default function RequirePersona({
  children,
  emptyTitle,
  emptyDescription,
}: {
  children: ReactNode;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const { state } = useAppState();

  if (state.personaHydrating) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[920px] items-center justify-center px-6 py-12">
        <div className="rounded-[20px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] px-8 py-7 text-center shadow-[var(--box-shadow)]">
          <p className="text-[16px] font-medium text-[var(--foreground)]">正在读取已保存人设…</p>
        </div>
      </div>
    );
  }

  if (!state.persona) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[920px] items-center justify-center px-6 py-12">
        <div className="w-full rounded-[24px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.92)] px-8 py-10 text-center shadow-[var(--box-shadow)]">
          <h1 className="koc-title-font text-[28px] leading-tight text-[var(--foreground)]">{emptyTitle}</h1>
          <p className="mx-auto mt-4 max-w-[540px] text-[16px] leading-7 text-[var(--foreground)]">{emptyDescription}</p>
          <Link
            href="/profile"
            className="koc-heading-font mt-7 inline-flex rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.94)] px-7 py-3 text-[15px] text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-[rgba(255,255,255,0.82)]"
          >
            先去完成人设打造
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
