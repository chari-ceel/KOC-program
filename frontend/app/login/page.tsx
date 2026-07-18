'use client';

import { Suspense, useMemo, useState, type FormEvent } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import PasswordField from '@/components/PasswordField';
import AuthPanelShell from '@/components/AuthPanelShell';

type AuthMode = 'login' | 'register';
const AVATAR_OPTIONS = ['梨', '星', '花', '云', '光', '心'];
const AVATAR_UPLOAD_MAX_BYTES = 200 * 1024;

function normalizeAvatarInput(value: string) {
  return Array.from(value.trim()).slice(0, 2).join('');
}

function isImageAvatar(value?: string) {
  return Boolean(value?.startsWith('data:image/'));
}

function AvatarPreview({ value }: { value: string }) {
  return (
    <span className="koc-heading-font flex size-14 items-center justify-center overflow-hidden rounded-full border border-[#DE868F]/45 bg-[#fff3f5] text-[24px] text-[#DE868F] shadow-[var(--box-shadow)]">
      {isImageAvatar(value) ? <Image src={value} alt="" width={56} height={56} unoptimized className="size-full object-cover" /> : value || '梨'}
    </span>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, register, closeAuthDialog, openRegisterSuccessDialog } = useAuth();
  const [mode, setMode] = useState<AuthMode>(searchParams.get('mode') === 'register' ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('梨');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const nextUrl = useMemo(() => {
    const next = searchParams.get('next');
    return next && next.startsWith('/') && !next.startsWith('//') ? next : '/profile';
  }, [searchParams]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError('');
    if (mode === 'register' && password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setIsSubmitting(true);
    try {
      const payload = { username: email.trim(), password, name: name.trim(), avatar };
      if (mode === 'login') {
        await login(payload);
      } else {
        await register(payload);
        openRegisterSuccessDialog({
          redirectTo: nextUrl,
        });
        closeAuthDialog();
        return;
      }
      router.replace(nextUrl);
    } catch (error) {
      setError(error instanceof Error ? error.message : '登录失败，请稍后重试');
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

  return (
    <div className="flex min-h-full w-full items-center justify-center px-[5.5vw] py-10">
      <AuthPanelShell
        title={mode === 'login' ? '顶流养成计划 · 登录' : '顶流养成计划 · 注册'}
        titleClassName="text-[34px]"
      >
        <div className="sr-only">
          <h1>{mode === 'login' ? '顶流养成计划 · 登录' : '顶流养成计划 · 注册'}</h1>
        </div>

        <form onSubmit={handleSubmit} className="mx-auto mt-10 max-w-[540px] space-y-6">
          {mode === 'register' && (
            <div className="rounded-[24px] border border-[#FFFFFF] bg-[rgba(255,255,255,0.78)] px-6 py-5 shadow-[var(--box-shadow)]">
              <div className="mb-4 flex items-center gap-4">
                <AvatarPreview value={avatar} />
                <input
                  value={isImageAvatar(avatar) ? '' : avatar}
                  onChange={(event) => setAvatar(normalizeAvatarInput(event.target.value) || '梨')}
                  className="koc-input-font h-12 min-w-0 flex-1 rounded-full border border-[var(--box-border)] bg-white px-5 text-[16px] text-[var(--foreground)] outline-none"
                  placeholder="自定义头像，如一个字或 emoji"
                />
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
              <div className="grid grid-cols-6 gap-3">
                {AVATAR_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setAvatar(option)}
                    className={`koc-heading-font flex size-12 items-center justify-center rounded-full border text-[20px] transition ${
                      avatar === option
                        ? 'border-[#DE868F] bg-[#DE868F] text-white shadow-[var(--cta-shadow)]'
                        : 'border-[var(--box-border)] bg-white text-[var(--foreground)] hover:bg-[#fff3f5]'
                    }`}
                    aria-label={`选择头像 ${option}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === 'register' && (
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 16))}
              className="koc-auth-input koc-input-font h-[64px] w-full border border-[#FFFFFF] bg-[rgba(255,255,255,0.95)] px-8 text-[18px] text-[var(--foreground)] outline-none shadow-[var(--box-shadow)] placeholder:text-[#888888]"
              placeholder="请输入昵称，最多 16 个字"
            />
          )}

          {mode === 'register' && (
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="koc-auth-input koc-input-font h-[64px] w-full border border-[#FFFFFF] bg-[rgba(255,255,255,0.95)] px-8 text-[18px] text-[var(--foreground)] outline-none shadow-[var(--box-shadow)] placeholder:text-[#888888]"
              placeholder="请输入学校邮箱，示例：xxx@.gzhu.edu.cn"
            />
          )}

          {mode === 'register' && (
            <PasswordField
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="koc-auth-input koc-input-font h-[64px] w-full border border-[#FFFFFF] bg-[rgba(255,255,255,0.95)] px-8 text-[18px] text-[var(--foreground)] outline-none shadow-[var(--box-shadow)] placeholder:text-[#888888]"
              placeholder="请输入密码"
            />
          )}

          {mode === 'register' && (
            <PasswordField
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="koc-auth-input koc-input-font h-[64px] w-full border border-[#FFFFFF] bg-[rgba(255,255,255,0.95)] px-8 text-[18px] text-[var(--foreground)] outline-none shadow-[var(--box-shadow)] placeholder:text-[#888888]"
              placeholder="请再次输入密码"
            />
          )}

          {mode === 'login' && (
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="koc-auth-input koc-input-font h-[64px] w-full border border-[#FFFFFF] bg-[rgba(255,255,255,0.95)] px-8 text-[18px] text-[var(--foreground)] outline-none shadow-[var(--box-shadow)] placeholder:text-[#888888]"
              placeholder="请输入邮箱，示例：xxx@.gzhu.edu.cn"
            />
          )}

          {mode === 'login' && (
            <PasswordField
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="koc-auth-input koc-input-font h-[64px] w-full border border-[#FFFFFF] bg-[rgba(255,255,255,0.95)] px-8 text-[18px] text-[var(--foreground)] outline-none shadow-[var(--box-shadow)] placeholder:text-[#888888]"
              placeholder="请输入密码"
            />
          )}

          {error && <p className="rounded-[14px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] px-4 py-3 text-[14px] font-medium text-[var(--foreground)] shadow-[var(--box-shadow)]">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="koc-heading-font h-[58px] w-full rounded-full border border-[#888888] bg-[#DE868F] px-7 text-[24px] text-white shadow-[var(--cta-shadow)] transition hover:opacity-92 disabled:opacity-55"
          >
            {isSubmitting ? '提交中…' : mode === 'login' ? '登录' : '注册'}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between text-[14px] text-[var(--foreground)]">
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
              setEmail('');
              setName('');
              setAvatar('梨');
              setPassword('');
              setConfirmPassword('');
            }}
            className="koc-heading-font text-[var(--title-blue)] hover:opacity-80"
          >
            {mode === 'login' ? '没有账号？去注册' : '返回登录'}
          </button>
          <Link href="/" className="hover:opacity-80">
            返回首页
          </Link>
        </div>
      </AuthPanelShell>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  );
}
