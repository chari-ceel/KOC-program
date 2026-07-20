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
      className={`koc-heading-font rounded-[14px] border border-[var(--box-border)] bg-white px-7 py-3 text-[20px] text-[var(--primary)] shadow-[var(--box-shadow)] transition hover:bg-[var(--nav-hover)] ${className}`}
    >
      登录
    </button>
  );
}
