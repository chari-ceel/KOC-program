'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { SHOW_PROMPT_DEBUG } from '@/lib/features';

interface SidebarLeafItem {
  id: string;
  href: string;
  label: string;
  iconSrc?: string;
  iconEmoji?: string;
  fullPageReload?: boolean;
  children?: never;
}

interface SidebarGroupItem {
  id: string;
  label: string;
  iconSrc?: string;
  iconEmoji?: string;
  children: Array<{
    id: string;
    href: string;
    label: string;
  }>;
  href?: never;
}

type SidebarItem = SidebarLeafItem | SidebarGroupItem;

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'koc-sidebar-collapsed';

const menuItems: SidebarLeafItem[] = [
  { id: 'profile', href: '/profile', label: '人设打造', iconSrc: '/koc-assets/icons/图标/人设打造.svg' },
  { id: 'persona-favorites', href: '/persona-favorites', label: '人设收藏', iconSrc: '/koc-assets/icons/图标/人设收藏.svg' },
  { id: 'trending', href: '/trending', label: '热门追踪', iconSrc: '/koc-assets/icons/图标/热门追踪.svg' },
  { id: 'content', href: '/content', label: '内容撰写', iconSrc: '/koc-assets/icons/图标/内容撰写.svg' },
  { id: 'image-guide', href: '/image-guide', label: '图文指导', iconSrc: '/koc-assets/icons/图标/图文指导.svg' },
];

const promptDebugItem: SidebarGroupItem = {
  id: 'prompt-debug',
  label: 'Prompt调试',
  iconSrc: '/koc-assets/icons/图标/等待.svg',
  children: [
    { id: 'prompt-debug-single', href: '/prompt-debug/single', label: '单prompt效果测试' },
    { id: 'prompt-debug-multi', href: '/prompt-debug/multi', label: '多prompt测试' },
  ],
};

const AVATAR_OPTIONS = ['梨', '星', '花', '云', '光', '心'];
const AVATAR_UPLOAD_MAX_BYTES = 200 * 1024;

function normalizeAvatarInput(value: string) {
  return Array.from(value.trim()).slice(0, 2).join('');
}

function isImageAvatar(value?: string): value is string {
  return Boolean(value?.startsWith('data:image/'));
}

function getUserAccountId(user: { id?: string; username?: string; email?: string } | null) {
  return user?.id || user?.username || user?.email || '';
}

function getUserAccountName(user: { username?: string; email?: string; name?: string } | null) {
  return user?.username || user?.email || user?.name || '';
}

function AvatarBadge({ value, size = 'md' }: { value?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClassName = size === 'lg' ? 'size-[56px] text-[24px]' : size === 'sm' ? 'size-9 text-[16px]' : 'size-12 text-[20px]';
  return (
    <span className={`koc-heading-font flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#DE868F]/45 bg-[#fff3f5] text-[#DE868F] shadow-[var(--box-shadow)] ${sizeClassName}`}>
      {isImageAvatar(value) ? <Image src={value} alt="" width={56} height={56} unoptimized className="size-full object-cover" /> : value || '梨'}
    </span>
  );
}

function readInitialCollapsed(pathname: string) {
  if (typeof window === 'undefined') {
    return pathname === '/';
  }

  const stored =
    window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) ??
    window.sessionStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
  if (stored === 'true') return true;
  if (stored === 'false') return false;

  return pathname === '/';
}

function persistCollapsedState(isCollapsed: boolean) {
  if (typeof window === 'undefined') return;
  const value = String(isCollapsed);
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value);
  window.sessionStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, value);
}

function SidebarInner({ pathname }: { pathname: string }) {
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isPromptDebugOpen, setIsPromptDebugOpen] = useState(false);
  const {
    user,
    status,
    isAuthenticated,
    knownAccounts,
    authDialog,
    logout,
    updateProfile,
    deleteAccount,
    removeKnownAccount,
    openAuthDialog,
    openUnlockDialog,
  } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(() => readInitialCollapsed(pathname));
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [profileAvatarDraft, setProfileAvatarDraft] = useState('梨');
  const [profileNotice, setProfileNotice] = useState('');
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const userModuleRef = useRef<HTMLDivElement | null>(null);
  const isPromptDebugRoute = pathname.startsWith('/prompt-debug');
  const isPromptDebugExpanded = isPromptDebugRoute || isPromptDebugOpen;
  const debugMenuItems: SidebarItem[] = [];
  if (SHOW_PROMPT_DEBUG) {
    debugMenuItems.push(promptDebugItem);
  }
  const visibleMenuItems: SidebarItem[] = [
    ...menuItems.slice(0, 5),
    ...debugMenuItems,
    ...menuItems.slice(5),
  ];
  const protectedRouteSet = useMemo(() => new Set(['/persona-favorites', '/trending', '/content', '/image-guide']), []);

  const handleProtectedNavigation = (href: string) => {
    if (isAuthenticated || !protectedRouteSet.has(href)) return false;
    openUnlockDialog({
      title: '登录后解锁完整功能',
      descriptionLines: ['热门追踪和内容撰写需要基于', '你的人设信息、历史记录和草稿内容生成'],
      redirectTo: href,
      closeRedirectTo: '/',
    });
    return true;
  };

  const titleText =
    status === 'loading' ? '读取中' : isAuthenticated ? user?.name || user?.email || user?.username || '已登录' : '未登录';
  const currentAccountId = getUserAccountId(user);
  const currentAccountName = getUserAccountName(user);
  const navIconClassName = 'size-[34px] shrink-0';
  const userModuleActive = isAuthenticated ? isUserMenuOpen : authDialog.open;
  const userModuleClassName = userModuleActive
    ? 'border-[var(--box-border)] bg-[rgba(255,255,255,0.43)] text-[var(--foreground)] shadow-[var(--box-shadow)]'
    : 'border-transparent bg-transparent text-[var(--foreground)] hover:border-[var(--box-border)] hover:bg-[rgba(255,255,255,0.62)] hover:shadow-[var(--box-shadow)]';

  const updateCollapsed = (value: boolean | ((current: boolean) => boolean)) => {
    setIsCollapsed((current) => {
      const next = typeof value === 'function' ? value(current) : value;
      persistCollapsedState(next);
      return next;
    });
  };

  useEffect(() => {
    if (!isAuthenticated || !isUserMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!userModuleRef.current?.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isAuthenticated, isUserMenuOpen]);

  useEffect(() => {
    if (!isUserMenuOpen || !user) return;
    const timer = window.setTimeout(() => {
      setProfileNameDraft(user.name || user.email || user.username || '');
      setProfileAvatarDraft(user.avatar || '梨');
      setProfileNotice('');
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isUserMenuOpen, user]);

  useEffect(() => {
    persistCollapsedState(isCollapsed);
  }, [isCollapsed]);

  const renderNavIcon = (item: SidebarItem) => {
    if (item.iconEmoji) {
      return (
        <span aria-hidden="true" className={`${navIconClassName} flex items-center justify-center text-[28px] leading-none`}>
          {item.iconEmoji}
        </span>
      );
    }
    if (!item.iconSrc) return null;
    return <Image src={item.iconSrc} alt="" width={34} height={34} className={navIconClassName} />;
  };

  const handleProfileAvatarUpload = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setProfileNotice('请选择图片文件作为头像');
      return;
    }
    if (file.size > AVATAR_UPLOAD_MAX_BYTES) {
      setProfileNotice('头像图片不能超过 200KB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProfileAvatarDraft(reader.result);
        setProfileNotice('');
      }
    };
    reader.onerror = () => setProfileNotice('头像读取失败，请重新选择');
    reader.readAsDataURL(file);
  };

  return (
    <aside
      className={`z-30 flex h-full shrink-0 flex-col overflow-visible rounded-[26px] border border-[var(--box-border)] bg-[var(--sidebar)] shadow-[var(--box-shadow)] transition-[width] duration-300 ${
        isCollapsed ? 'w-[84px]' : 'w-[274px]'
      }`}
    >
      <div className={`flex items-center px-8 pt-6 ${isCollapsed ? 'flex-col gap-4 px-4' : 'gap-8'}`}>
        <button
          type="button"
          aria-label={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
          title={isCollapsed ? '展开' : '收起'}
          onClick={() => updateCollapsed((current) => !current)}
          className={`koc-icon-center ${navIconClassName}`}
        >
          <Image src="/koc-assets/icons/图标/收缩.svg" alt="" width={34} height={34} className={navIconClassName} />
        </button>
        <Link href="/manual" aria-label="用户说明书" title="用户说明书" className={`koc-icon-center ${navIconClassName}`}>
          <Image src="/koc-assets/icons/图标/灵光一闪.svg" alt="" width={34} height={34} className="size-[56px] shrink-0" />
        </Link>
      </div>

      {!isCollapsed && (
        <Link href="/" className="koc-title-font mt-6 block pl-3 pr-8 text-center text-[28px] leading-none text-[var(--title-blue)]">
          <span className="flex flex-col items-center justify-center gap-1">
            <span>顶流养成计划</span>
            <span>Agent</span>
          </span>
        </Link>
      )}

      <nav className="mt-7 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4">
        {visibleMenuItems.map((item) => {
          const active = item.children ? isPromptDebugRoute : pathname === item.href;

          if (item.children) {
            return (
              <div key={item.id} className="space-y-2">
                <button
                  type="button"
                  title={isCollapsed ? item.label : undefined}
                  aria-expanded={isPromptDebugExpanded}
                  onClick={() => {
                    if (isCollapsed) {
                      updateCollapsed(false);
                      setIsPromptDebugOpen(true);
                      return;
                    }
                    setIsPromptDebugOpen((open) => !open);
                  }}
                  className={`flex min-h-[54px] w-full items-center gap-3 rounded-[22px] border text-[21px] transition ${
                    active
                      ? 'border-[var(--box-border)] bg-[rgba(255,255,255,0.43)] text-[var(--foreground)] shadow-[var(--box-shadow)]'
                      : 'border-transparent bg-transparent text-[var(--foreground)] hover:bg-[rgba(255,255,255,0.62)]'
                  } ${isCollapsed ? 'justify-center px-0' : 'px-4'}`}
                >
                  {renderNavIcon(item)}
                  {!isCollapsed && (
                    <>
                      <span className="koc-song-font truncate">{item.label}</span>
                      <span className={`ml-auto text-sm transition ${isPromptDebugExpanded ? 'rotate-90' : ''}`}>▸</span>
                    </>
                  )}
                </button>

                {!isCollapsed && isPromptDebugExpanded && (
                  <div className="space-y-2 pl-11">
                    {item.children.map((child) => {
                      const childActive = pathname === child.href;
                      return (
                        <Link
                          key={child.id}
                          href={child.href}
                          className={`flex min-h-10 items-center rounded-[12px] px-4 py-2 text-[15px] transition ${
                            childActive
                              ? 'border border-[var(--box-border)] bg-[rgba(255,255,255,0.43)] font-semibold text-[var(--foreground)] shadow-[var(--box-shadow)]'
                              : 'text-[var(--foreground)] hover:bg-[rgba(255,255,255,0.6)]'
                          }`}
                        >
                          {child.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          }

          const leafClassName = `flex min-h-[54px] items-center gap-3 rounded-[22px] border text-[21px] transition ${
            active
              ? 'border-[var(--box-border)] bg-[rgba(255,255,255,0.43)] text-[var(--foreground)] shadow-[var(--box-shadow)]'
              : 'border-transparent bg-transparent text-[var(--foreground)] hover:bg-[rgba(255,255,255,0.62)]'
          } ${isCollapsed ? 'justify-center px-0' : 'px-4'}`;
          const leafContent = (
            <>
              {renderNavIcon(item)}
              {!isCollapsed && <span className="koc-song-font truncate">{item.label}</span>}
            </>
          );

          if (item.fullPageReload) {
            return (
              <a
                key={item.id}
                href={item.href}
                title={isCollapsed ? item.label : undefined}
                className={leafClassName}
              >
                {leafContent}
              </a>
            );
          }

          return (
            <Link
              key={item.id}
              href={item.href}
              title={isCollapsed ? item.label : undefined}
              onClick={(event) => {
                if (handleProtectedNavigation(item.href)) {
                  event.preventDefault();
                }
              }}
              className={leafClassName}
            >
              {leafContent}
            </Link>
          );
        })}
      </nav>

      <div ref={userModuleRef} className={`relative z-40 mt-auto flex h-[96px] shrink-0 items-center overflow-visible ${isCollapsed ? 'justify-center px-0' : 'px-4'}`}>
        {isAuthenticated && isUserMenuOpen && (
          <div
            className={`absolute z-50 w-[312px] rounded-[18px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.98)] px-4 py-4 text-sm text-[var(--foreground)] shadow-[var(--box-shadow)] ${isCollapsed ? 'bottom-2 left-[72px]' : 'bottom-[88px] left-4'}`}
          >
            <div className="flex items-center gap-3">
              <AvatarBadge value={profileAvatarDraft} size="lg" />
              <div className="min-w-0">
                <p className="koc-heading-font truncate text-[18px] leading-tight">{titleText}</p>
                <p className="mt-1 truncate text-[12px] text-[var(--foreground)]/60">{currentAccountName}</p>
              </div>
            </div>

            <div className="mt-4 space-y-3 rounded-[14px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.72)] px-3 py-3">
              <div className="flex items-center gap-3">
                <AvatarBadge value={profileAvatarDraft} size="md" />
                <input
                  value={isImageAvatar(profileAvatarDraft) ? '' : profileAvatarDraft}
                  onChange={(event) => setProfileAvatarDraft(normalizeAvatarInput(event.target.value) || '梨')}
                  className="koc-input-font h-10 min-w-0 flex-1 rounded-full border border-[var(--box-border)] bg-white px-4 text-[14px] text-[var(--foreground)] outline-none"
                  placeholder="自定义头像"
                />
                <label className="koc-heading-font flex h-10 shrink-0 cursor-pointer items-center rounded-full border border-[var(--box-border)] bg-white px-3 text-[13px] text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-[#fff3f5]">
                  上传
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => handleProfileAvatarUpload(event.target.files?.[0])}
                  />
                </label>
              </div>
              <input
                value={profileNameDraft}
                onChange={(event) => setProfileNameDraft(event.target.value.slice(0, 16))}
                className="koc-input-font h-10 w-full rounded-full border border-[var(--box-border)] bg-white px-4 text-[14px] text-[var(--foreground)] outline-none"
                placeholder="设置昵称"
              />
              <div className="grid grid-cols-6 gap-2">
                {AVATAR_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setProfileAvatarDraft(option)}
                    className={`koc-heading-font flex size-8 items-center justify-center rounded-full border text-[14px] transition ${
                      profileAvatarDraft === option
                        ? 'border-[#DE868F] bg-[#DE868F] text-white'
                        : 'border-[var(--box-border)] bg-white text-[var(--foreground)] hover:bg-[#fff3f5]'
                    }`}
                    aria-label={`选择头像 ${option}`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={isProfileSaving || !profileNameDraft.trim()}
                onClick={async () => {
                  if (isProfileSaving) return;
                  setIsProfileSaving(true);
                  setProfileNotice('');
                  try {
                    await updateProfile({ name: profileNameDraft.trim(), avatar: profileAvatarDraft });
                    setProfileNotice('资料已保存');
                  } catch (error) {
                    setProfileNotice(error instanceof Error ? error.message : '保存失败');
                  } finally {
                    setIsProfileSaving(false);
                  }
                }}
                className="koc-heading-font h-9 w-full rounded-full border border-[#888888] bg-[#DE868F] text-[14px] text-white shadow-[var(--cta-shadow)] transition hover:opacity-90 disabled:opacity-50"
              >
                {isProfileSaving ? '保存中…' : '保存昵称和头像'}
              </button>
              {profileNotice && <p className="text-center text-[12px] text-[var(--foreground)]/70">{profileNotice}</p>}
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="koc-heading-font text-[15px]">切换账号</p>
                <span className="text-[12px] text-[var(--foreground)]/55">{knownAccounts.length}/5</span>
              </div>
              <div className="max-h-[176px] space-y-2 overflow-y-auto pr-1">
                {knownAccounts.length === 0 ? (
                  <p className="rounded-[12px] bg-[rgba(255,255,255,0.72)] px-3 py-2 text-[12px] text-[var(--foreground)]/60">
                    登录或添加账号后会显示在这里。
                  </p>
                ) : (
                  knownAccounts.map((account) => {
                    const isCurrentAccount = account.id === currentAccountId;
                    return (
                      <div
                        key={account.id}
                        className={`flex w-full items-center gap-2 rounded-[12px] border px-2 py-2 text-left transition ${
                          isCurrentAccount
                            ? 'border-[#DE868F]/45 bg-[#fff3f5]'
                            : 'border-[var(--box-border)] bg-[rgba(255,255,255,0.78)] hover:bg-white'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (isCurrentAccount) return;
                            setIsUserMenuOpen(false);
                            openAuthDialog({
                              mode: 'login',
                              title: '切换账号登录',
                              description: '请输入密码完成账号切换。',
                              redirectTo: pathname || '/',
                              initialUsername: account.username,
                            });
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          <AvatarBadge value={account.avatar} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{account.name || account.username}</span>
                            <span className="block truncate text-[11px] text-[var(--foreground)]/55">{account.username}</span>
                          </span>
                          {isCurrentAccount && <span className="rounded-full bg-[#DE868F] px-2 py-0.5 text-[10px] text-white">当前</span>}
                        </button>
                        <button
                          type="button"
                          title="从本机列表移除"
                          onClick={() => {
                            removeKnownAccount(account.id);
                          }}
                          className="flex size-6 shrink-0 items-center justify-center rounded-full text-[18px] leading-none text-[var(--foreground)]/55 hover:bg-white hover:text-[#DE868F]"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  openAuthDialog({
                    mode: 'login',
                    title: '添加账号',
                    description: '登录或注册另一个账号，最多保留 5 个账号。',
                    redirectTo: pathname || '/',
                  });
                }}
                className="koc-song-font rounded-[12px] px-3 py-2 font-medium transition hover:bg-[rgba(255,255,255,0.7)]"
                >
                添加账号
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  void logout();
                }}
                className="koc-song-font rounded-[12px] px-3 py-2 font-medium transition hover:bg-[rgba(255,255,255,0.7)]"
              >
                退出登录
              </button>
            </div>

            <button
              type="button"
              disabled={isDeletingAccount}
              onClick={async () => {
                if (isDeletingAccount) return;
                const confirmed = window.confirm('确定要注销当前账号吗？注销后会删除该账号和相关数据，并退出登录。');
                if (!confirmed) return;
                setIsDeletingAccount(true);
                try {
                  await deleteAccount();
                  setIsUserMenuOpen(false);
                } finally {
                  setIsDeletingAccount(false);
                }
              }}
              className="koc-song-font mt-2 w-full rounded-[12px] px-3 py-2 text-center font-medium text-[#A33] transition hover:bg-[#fff0f0] disabled:opacity-50"
            >
              {isDeletingAccount ? '注销中…' : '注销账号'}
            </button>
          </div>
        )}

        <button
          type="button"
          title={isAuthenticated ? '账号菜单' : '点击登录'}
          onClick={() => {
            if (!isAuthenticated) {
              openAuthDialog({
                mode: 'login',
                redirectTo: pathname || '/',
              });
              return;
            }
            setIsUserMenuOpen((open) => !open);
          }}
          className={`flex items-center rounded-[22px] border transition ${userModuleClassName} ${
            isCollapsed ? 'size-[56px] justify-center px-0' : 'min-h-[68px] w-full gap-4 px-4'
          }`}
        >
          {isAuthenticated ? (
            <AvatarBadge value={user?.avatar} size="lg" />
          ) : (
            <span className={`koc-icon-center shrink-0 ${isCollapsed ? 'size-[48px]' : 'size-[56px]'}`}>
              <Image src="/koc-assets/icons/图标/登录.svg" alt="" width={56} height={56} className={isCollapsed ? 'size-[46px]' : 'size-[56px]'} />
            </span>
          )}

          {!isCollapsed && (
            <span className="min-w-0 text-left">
              <span className="koc-title-font block max-w-[130px] truncate text-[28px] leading-tight text-[var(--foreground)]">
                {titleText}
              </span>
              {!isAuthenticated && <span className="mt-1 block text-sm text-[var(--foreground)]/50">游客体验中</span>}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  return <SidebarInner pathname={pathname} />;
}
