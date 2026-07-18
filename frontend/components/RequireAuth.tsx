'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';

export default function RequireAuth({
  children,
  title,
  description,
}: {
  children: ReactNode;
  title: string;
  description: string;
}) {
  const { status, isAuthenticated, openAuthDialog } = useAuth();

  if (status === 'loading') {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[920px] items-center justify-center px-6 py-12">
        <div className="rounded-[20px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] px-8 py-7 text-center shadow-[var(--box-shadow)]">
          <p className="text-[16px] font-medium text-[var(--foreground)]">正在确认登录状态…</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="mx-auto flex min-h-full w-full max-w-[920px] items-center justify-center px-6 py-12">
        <div className="w-full rounded-[24px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.92)] px-8 py-10 text-center shadow-[var(--box-shadow)]">
          <h1 className="koc-title-font text-[28px] leading-tight text-[var(--foreground)]">{title}</h1>
          <p className="mx-auto mt-4 max-w-[540px] text-[16px] leading-7 text-[var(--foreground)]">{description}</p>
          <button
            type="button"
            onClick={() => {
              openAuthDialog({
                mode: 'login',
                title,
                description,
              });
            }}
            className="koc-heading-font mt-7 inline-flex rounded-[16px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.94)] px-7 py-3 text-xl text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-[rgba(255,255,255,0.82)]"
          >
            登录
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
