'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import PasswordField from '@/components/PasswordField';
import AuthPanelShell from '@/components/AuthPanelShell';

function createEmptyFormState() {
  return {
    email: '',
    name: '',
    avatar: '',
    password: '',
    confirmPassword: '',
    error: '',
    isSubmitting: false,
  };
}

const AVATAR_UPLOAD_MAX_BYTES = 200 * 1024;

function isImageAvatar(value?: string) {
  return Boolean(value?.startsWith('data:image/'));
}

function AvatarPreview({ value }: { value: string }) {
  return (
    <span className="koc-heading-font flex size-14 items-center justify-center overflow-hidden rounded-full border border-[#DE868F]/45 bg-[#fff3f5] text-[24px] text-[#DE868F] shadow-[var(--box-shadow)]">
      {isImageAvatar(value) ? (
        <Image src={value} alt="" width={56} height={56} unoptimized className="size-full object-cover" />
      ) : (
        <span className="block size-6 rounded-full bg-[#bfdbfe]" />
      )}
    </span>
  );
}

export default function AuthDialog() {
  const router = useRouter();
  const pathname = usePathname();
  const { authDialog, closeAuthDialog, login, register, setAuthDialogMode } = useAuth();
  const [email, setEmail] = useState(createEmptyFormState().email);
  const [name, setName] = useState(createEmptyFormState().name);
  const [avatar, setAvatar] = useState(createEmptyFormState().avatar);
  const [password, setPassword] = useState(createEmptyFormState().password);
  const [confirmPassword, setConfirmPassword] = useState(createEmptyFormState().confirmPassword);
  const [error, setError] = useState(createEmptyFormState().error);
  const [isSubmitting, setIsSubmitting] = useState(createEmptyFormState().isSubmitting);

  const nextUrl = useMemo(() => {
    const candidate = authDialog.redirectTo || pathname || '/profile';
    return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/profile';
  }, [authDialog.redirectTo, pathname]);

  useEffect(() => {
    if (!authDialog.open) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeAuthDialog();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [authDialog.open, closeAuthDialog]);

  useEffect(() => {
    if (!authDialog.open) return;
    const timer = window.setTimeout(() => {
      const next = createEmptyFormState();
      setEmail(authDialog.initialUsername || next.email);
      setName(next.name);
      setAvatar(next.avatar);
      setPassword(next.password);
      setConfirmPassword(next.confirmPassword);
      setError(next.error);
      setIsSubmitting(next.isSubmitting);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authDialog.initialUsername, authDialog.open]);

  if (!authDialog.open || typeof document === 'undefined') {
    return null;
  }

  const resetForm = () => {
    const next = createEmptyFormState();
    setEmail(next.email);
    setName(next.name);
    setAvatar(next.avatar);
    setPassword(next.password);
    setConfirmPassword(next.confirmPassword);
    setError(next.error);
    setIsSubmitting(next.isSubmitting);
  };

  const handleClose = () => {
    const target = authDialog.closeRedirectTo;
    resetForm();
    closeAuthDialog();
    if (target && pathname !== target) {
      router.replace(target);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setError('');
    if (authDialog.mode === 'register' && password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = {
        username: email.trim(),
        password,
        name: name.trim(),
        avatar,
      };
      if (authDialog.mode === 'login') {
        await login(payload);
      } else {
        await register(payload);
      }
      resetForm();
      closeAuthDialog();
      if (pathname !== nextUrl) {
        router.replace(nextUrl);
      }
    } catch (currentError) {
      setError(currentError instanceof Error ? currentError.message : '请求失败，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAvatarUpload = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件作为头像');
      return;
    }
    if (file.size > AVATAR_UPLOAD_MAX_BYTES) {
      setError('头像图片不能超过 200KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAvatar(reader.result);
        setError('');
      }
    };
    reader.onerror = () => setError('头像读取失败，请重新选择');
    reader.readAsDataURL(file);
  };

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[rgba(11,24,56,0.08)] px-5 py-8 backdrop-blur-[2px]">
      <AuthPanelShell
        title={authDialog.mode === 'login' ? '顶流养成计划 · 登录' : '顶流养成计划 · 注册'}
        titleClassName="text-[28px]"
        ariaLabelledBy="auth-dialog-title"
      >
        <button
          type="button"
          onClick={handleClose}
          className="koc-heading-font absolute right-5 top-4 text-[24px] leading-none text-[var(--foreground)]"
          aria-label="关闭登录弹窗"
        >
          ×
        </button>

        <form onSubmit={handleSubmit} className="mx-auto mt-10 max-w-[540px] space-y-6">
          {authDialog.mode === 'register' && (
            <div className="rounded-[24px] border border-[#FFFFFF] bg-[rgba(255,255,255,0.78)] px-6 py-5 shadow-[var(--box-shadow)]">
              <div className="flex items-center gap-4">
                <AvatarPreview value={avatar} />
                <label className="koc-heading-font flex h-12 shrink-0 cursor-pointer items-center rounded-full border border-[#888888] bg-white px-4 text-[14px] text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-[#fff3f5]">
                  上传
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => handleAvatarUpload(event.target.files?.[0])}
                  />
                </label>
              </div>
            </div>
          )}

          {authDialog.mode === 'register' && (
            <input
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 16))}
              required
              className="koc-auth-input koc-input-font h-[64px] w-full border border-[#FFFFFF] bg-[rgba(255,255,255,0.94)] px-8 text-[18px] text-[var(--foreground)] outline-none shadow-[var(--box-shadow)] placeholder:text-[#888888]"
              placeholder="请输入昵称，最多 16 个字"
            />
          )}

          {authDialog.mode === 'register' ? (
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              required
              className="koc-auth-input koc-input-font h-[64px] w-full border border-[#FFFFFF] bg-[rgba(255,255,255,0.94)] px-8 text-[18px] text-[var(--foreground)] outline-none shadow-[var(--box-shadow)] placeholder:text-[#888888]"
              placeholder="请输入学校邮箱，示例：xxx@.gzhu.edu.cn"
            />
          ) : null}

          {authDialog.mode === 'register' && (
            <PasswordField
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="koc-auth-input koc-input-font h-[64px] w-full border border-[#FFFFFF] bg-[rgba(255,255,255,0.94)] px-8 text-[18px] text-[var(--foreground)] outline-none shadow-[var(--box-shadow)] placeholder:text-[#888888]"
              placeholder="请输入密码"
            />
          )}

          {authDialog.mode === 'register' && (
            <PasswordField
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="koc-auth-input koc-input-font h-[64px] w-full border border-[#FFFFFF] bg-[rgba(255,255,255,0.94)] px-8 text-[18px] text-[var(--foreground)] outline-none shadow-[var(--box-shadow)] placeholder:text-[#888888]"
              placeholder="请再次输入密码"
            />
          )}

          {authDialog.mode === 'login' && (
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="koc-auth-input koc-input-font h-[64px] w-full border border-[#FFFFFF] bg-[rgba(255,255,255,0.94)] px-8 text-[18px] text-[var(--foreground)] outline-none shadow-[var(--box-shadow)] placeholder:text-[#888888]"
              placeholder="请输入学校邮箱，示例：xxx@.gzhu.edu.cn"
            />
          )}

          {authDialog.mode === 'login' && (
            <PasswordField
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="koc-auth-input koc-input-font h-[64px] w-full border border-[#FFFFFF] bg-[rgba(255,255,255,0.94)] px-8 text-[18px] text-[var(--foreground)] outline-none shadow-[var(--box-shadow)] placeholder:text-[#888888]"
              placeholder="请输入密码"
            />
          )}

          {error && (
            <p className="rounded-[18px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.82)] px-5 py-4 text-[15px] font-medium text-[var(--foreground)] shadow-[var(--box-shadow)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="koc-heading-font inline-flex h-[56px] w-full items-center justify-center rounded-[12px] border border-[var(--box-border)] bg-[var(--primary)] px-7 text-[24px] text-white shadow-[var(--cta-shadow)] transition hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? '提交中…' : authDialog.mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <div className="mx-auto mt-8 flex max-w-[540px] items-center justify-between text-left">
          {authDialog.mode === 'login' ? (
            <button
              type="button"
              onClick={() => {
                resetForm();
                setAuthDialogMode('register');
              }}
              className="koc-heading-font text-[18px] text-[var(--title-blue)] transition hover:opacity-80"
            >
              没有账号？点击注册
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                resetForm();
                setAuthDialogMode('login');
              }}
              className="koc-heading-font text-[18px] text-[var(--title-blue)] transition hover:opacity-80"
            >
              返回登录
            </button>
          )}
        </div>
      </AuthPanelShell>
    </div>,
    document.body,
  );
}
