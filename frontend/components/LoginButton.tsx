'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function LoginButton({ className = '' }: { className?: string }) {
  const pathname = usePathname();
  const { openAuthDialog } = useAuth();
  const next = pathname || '/';

  return (
    <button
      type="button"
      onClick={() => {
        openAuthDialog({
          mode: 'login',
          redirectTo: next,
        });
      }}
      className={`koc-heading-font rounded-[20px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.3)] px-9 py-4 text-[34px] text-[#6f5140] shadow-[var(--box-shadow)] transition hover:bg-[rgba(255,255,255,0.42)] ${className}`}
    >
      登录
    </button>
  );
}
