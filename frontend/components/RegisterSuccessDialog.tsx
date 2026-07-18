'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/context/AuthContext';
import AuthPanelShell from '@/components/AuthPanelShell';

export default function RegisterSuccessDialog() {
  const {
    registerSuccessDialog,
    closeRegisterSuccessDialog,
    openAuthDialog,
  } = useAuth();

  useEffect(() => {
    if (!registerSuccessDialog.open) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeRegisterSuccessDialog();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [closeRegisterSuccessDialog, registerSuccessDialog.open]);

  if (!registerSuccessDialog.open || typeof document === 'undefined') {
    return null;
  }

  const handleAction = () => {
    closeRegisterSuccessDialog();
    openAuthDialog({
      mode: 'login',
      redirectTo: registerSuccessDialog.redirectTo,
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-[rgba(11,24,56,0.08)] px-1.5 py-2 backdrop-blur-[2px] sm:px-5 sm:py-8">
      <AuthPanelShell
        title={registerSuccessDialog.title}
        titleClassName="text-[34px]"
        ariaLabelledBy="register-success-dialog-title"
      >
        <button
          type="button"
          onClick={closeRegisterSuccessDialog}
          className="koc-heading-font absolute right-5 top-4 text-[24px] leading-none text-[var(--foreground)] transition hover:opacity-75"
          aria-label="关闭注册成功弹窗"
        >
          ×
        </button>

        <div className="mx-auto flex max-w-[520px] flex-col items-center text-center">
          <button
            type="button"
            onClick={handleAction}
            className="koc-heading-font mt-10 text-[18px] leading-tight text-[var(--title-blue)] transition hover:opacity-80"
            >
              {registerSuccessDialog.actionLabel}
            </button>
        </div>
      </AuthPanelShell>
    </div>,
    document.body,
  );
}
