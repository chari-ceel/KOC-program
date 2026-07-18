'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import AuthPanelShell from '@/components/AuthPanelShell';

export default function UnlockDialog() {
  const router = useRouter();
  const pathname = usePathname();
  const { unlockDialog, closeUnlockDialog, openAuthDialog } = useAuth();

  useEffect(() => {
    if (!unlockDialog.open) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeUnlockDialog();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [closeUnlockDialog, unlockDialog.open]);

  if (!unlockDialog.open || typeof document === 'undefined') {
    return null;
  }

  const handleClose = () => {
    const target = unlockDialog.closeRedirectTo;
    closeUnlockDialog();
    if (target && pathname !== target) {
      router.replace(target);
    }
  };

  const handleOpenAuth = (mode: 'login' | 'register') => {
    closeUnlockDialog();
    openAuthDialog({
      mode,
      redirectTo: unlockDialog.redirectTo,
      closeRedirectTo: unlockDialog.closeRedirectTo,
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-[rgba(11,24,56,0.08)] px-1.5 py-2 backdrop-blur-[2px] sm:px-5 sm:py-8">
      <AuthPanelShell
        title={unlockDialog.title}
        maxWidthClassName="max-w-[850px]"
        bodyClassName="px-7 py-10 sm:px-12 sm:py-12"
        titleClassName="text-[40px] sm:text-[56px]"
        ariaLabelledBy="unlock-dialog-title"
      >
        <button
          type="button"
          onClick={handleClose}
          className="koc-heading-font absolute right-5 top-4 text-[24px] leading-none text-[var(--foreground)] transition hover:opacity-75"
          aria-label="关闭功能解锁弹窗"
        >
          ×
        </button>

        <div className="mx-auto flex max-w-[560px] flex-col items-center text-center">
          <div className="mt-8 space-y-3 text-[var(--title-blue)]">
            {unlockDialog.descriptionLines.map((line) => (
              <p key={line} className="koc-heading-font text-[20px] leading-[1.45] sm:text-[25px]">
                {line}
              </p>
            ))}
          </div>

          <button
            type="button"
            onClick={() => handleOpenAuth('login')}
            className="koc-heading-font mt-10 inline-flex h-[72px] w-full max-w-[500px] items-center justify-center rounded-full border border-[#888888] bg-[#DE868F] px-8 text-[28px] text-white shadow-[var(--cta-shadow)] transition hover:opacity-92"
          >
            登录
          </button>

          <button
            type="button"
            onClick={() => handleOpenAuth('register')}
            className="koc-heading-font mt-8 text-[20px] leading-tight text-[var(--title-blue)] transition hover:opacity-80 sm:text-[24px]"
            >
              没有账号？点击注册
            </button>
        </div>
      </AuthPanelShell>
    </div>,
    document.body,
  );
}
