'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { API_BASE, readJsonResponse } from '@/lib/api';
import {
  AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT,
  AGENT_CHAT_CREATE_CONVERSATION_EVENT,
  AGENT_CHAT_SELECT_CONVERSATION_EVENT,
  SIDEBAR_COLLAPSE_EVENT,
  canCreateNextConversation,
  createAndStoreConversation,
  deleteLocalConversation,
  readActiveConversationId,
  readLocalConversations,
  writeActiveConversationId,
} from '@/lib/agent-chat-store';
import type { AgentLocalConversation } from '@/lib/agent-chat-contract';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'koc-sidebar-collapsed';
const AVATAR_UPLOAD_MAX_BYTES = 200 * 1024;
const AVATAR_CANVAS_SIZE = 256;

function readInitialCollapsed(pathname: string) {
  if (typeof window === 'undefined') return pathname === '/';
  const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
  if (stored === 'true') return true;
  if (stored === 'false') return false;
  return pathname === '/';
}

function persistCollapsedState(isCollapsed: boolean) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isCollapsed));
}

function isImageAvatar(value?: string): value is string {
  return Boolean(value?.startsWith('data:image/'));
}

function getAccountId(user: { id?: string; username?: string; email?: string } | null) {
  return user?.id || user?.username || user?.email || '';
}

function compactText(text: string, maxLength = 24) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function getConversationTitle(conversation: AgentLocalConversation) {
  if (conversation.summary.persona.done) {
    return compactText(conversation.summary.persona.text, 18) || compactText(conversation.title, 18) || conversation.title;
  }
  return conversation.title;
}

function compactConversationMeta(conversation: AgentLocalConversation) {
  const persona = conversation.summary.persona.text.trim();
  const content = conversation.summary.content.text.trim();
  const source = persona || content || '新的角色链路';
  return compactText(source);
}

function AvatarBadge({ value, size = 'md' }: { value?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClassName = size === 'lg' ? 'size-12 text-[20px]' : size === 'sm' ? 'size-8 text-[14px]' : 'size-10 text-[17px]';
  return (
    <span className={`koc-heading-font flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#bfdbfe] bg-[#eff6ff] text-[#2563eb] shadow-[var(--box-shadow)] ${sizeClassName}`}>
      {isImageAvatar(value) ? (
        <Image src={value} alt="" width={48} height={48} unoptimized className="size-full object-cover" />
      ) : (
        <span className="block size-[42%] rounded-full bg-[#bfdbfe]" />
      )}
    </span>
  );
}

function cropAvatarImage(source: string, scale: number, offsetX: number, offsetY: number) {
  return new Promise<string>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_CANVAS_SIZE;
      canvas.height = AVATAR_CANVAS_SIZE;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('头像处理失败'));
        return;
      }
      const coverScale = Math.max(AVATAR_CANVAS_SIZE / image.width, AVATAR_CANVAS_SIZE / image.height) * scale;
      const width = image.width * coverScale;
      const height = image.height * coverScale;
      const extraX = Math.max(0, width - AVATAR_CANVAS_SIZE);
      const extraY = Math.max(0, height - AVATAR_CANVAS_SIZE);
      const dx = -extraX / 2 - ((offsetX - 50) / 50) * (extraX / 2);
      const dy = -extraY / 2 - ((offsetY - 50) / 50) * (extraY / 2);
      context.clearRect(0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);
      context.drawImage(image, dx, dy, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('头像读取失败，请重新选择'));
    image.src = source;
  });
}

function AvatarCropPreview({
  source,
  scale,
  offsetX,
  offsetY,
  sizeClassName = 'size-32',
}: {
  source?: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  sizeClassName?: string;
}) {
  return (
    <div className={`${sizeClassName} overflow-hidden rounded-full border border-[var(--box-border)] bg-[#eff6ff] shadow-[var(--box-shadow)]`}>
      {isImageAvatar(source) ? (
        <Image
          src={source}
          alt=""
          width={160}
          height={160}
          unoptimized
          className="size-full object-cover"
          style={{
            transform: `translate(${(offsetX - 50) * 0.42}px, ${(offsetY - 50) * 0.42}px) scale(${scale})`,
          }}
        />
      ) : (
        <span className="flex size-full items-center justify-center">
          <span className="block size-12 rounded-full bg-[#bfdbfe]" />
        </span>
      )}
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const {
    user,
    status,
    isAuthenticated,
    knownAccounts,
    logout,
    updateProfile,
    deleteAccount,
    switchKnownAccount,
    removeKnownAccount,
    openAuthDialog,
    openUnlockDialog,
  } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(() => readInitialCollapsed(pathname));
  const [searchValue, setSearchValue] = useState('');
  const [conversations, setConversations] = useState<AgentLocalConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [sidebarNotice, setSidebarNotice] = useState('');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [profileAvatarDraft, setProfileAvatarDraft] = useState('');
  const [profileAvatarSource, setProfileAvatarSource] = useState('');
  const [profileAvatarScale, setProfileAvatarScale] = useState(1);
  const [profileAvatarOffsetX, setProfileAvatarOffsetX] = useState(50);
  const [profileAvatarOffsetY, setProfileAvatarOffsetY] = useState(50);
  const [profileNotice, setProfileNotice] = useState('');
  const [accountNotice, setAccountNotice] = useState('');
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [switchingAccountId, setSwitchingAccountId] = useState('');
  const userModuleRef = useRef<HTMLDivElement | null>(null);

  const syncConversations = useCallback(() => {
    setConversations(readLocalConversations());
    setActiveConversationId(readActiveConversationId());
  }, []);

  useEffect(() => {
    syncConversations();
    window.addEventListener(AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT, syncConversations);
    return () => window.removeEventListener(AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT, syncConversations);
  }, [syncConversations]);

  useEffect(() => {
    persistCollapsedState(isCollapsed);
  }, [isCollapsed]);

  useEffect(() => {
    const handleCollapseRequest = () => setIsCollapsed(true);
    window.addEventListener(SIDEBAR_COLLAPSE_EVENT, handleCollapseRequest);
    return () => window.removeEventListener(SIDEBAR_COLLAPSE_EVENT, handleCollapseRequest);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !isUserMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!userModuleRef.current?.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isAuthenticated, isUserMenuOpen]);

  useEffect(() => {
    if (!isUserMenuOpen || !user) return;
    setProfileNameDraft(user.name || user.email || user.username || '');
    setProfileAvatarDraft(user.avatar || '');
    setProfileAvatarSource(isImageAvatar(user.avatar) ? user.avatar || '' : '');
    setProfileAvatarScale(1);
    setProfileAvatarOffsetX(50);
    setProfileAvatarOffsetY(50);
    setProfileNotice('');
    setAccountNotice('');
  }, [isUserMenuOpen, user]);

  const filteredConversations = useMemo(() => {
    const keyword = searchValue.trim().toLowerCase();
    if (!keyword) return conversations;
    return conversations.filter((conversation) => {
      const text = [
        conversation.title,
        conversation.summary.persona.title,
        conversation.summary.persona.text,
        conversation.summary.trending.text,
        conversation.summary.content.text,
      ].join(' ').toLowerCase();
      return text.includes(keyword);
    });
  }, [conversations, searchValue]);

  const titleText = status === 'loading' ? '读取中' : isAuthenticated ? user?.name || user?.email || user?.username || '已登录' : '未登录';
  const currentAccountId = getAccountId(user);
  const hasReachedAccountLimit = knownAccounts.length >= 5;

  const updateCollapsed = (nextValue: boolean | ((current: boolean) => boolean)) => {
    setIsCollapsed((current) => (typeof nextValue === 'function' ? nextValue(current) : nextValue));
  };

  const handleCreateConversation = () => {
    setSidebarNotice('');
    if (status === 'loading') {
      setSidebarNotice('正在确认登录状态，请稍等。');
      return;
    }
    if (!canCreateNextConversation(conversations, activeConversationId)) {
      setSidebarNotice('请先完成当前人设打造，再新建下一个角色对话。');
      if (activeConversationId) {
        window.dispatchEvent(new CustomEvent(AGENT_CHAT_SELECT_CONVERSATION_EVENT, { detail: { localId: activeConversationId } }));
      }
      if (pathname !== '/') {
        window.location.href = '/';
      }
      return;
    }
    if (!isAuthenticated && conversations.length > 0) {
      openUnlockDialog({
        title: '登录后新建更多角色对话',
        descriptionLines: ['游客模式只能免费生成一次初版人设。', '新建更多角色、继续追问、热门追踪和内容撰写需要登录。'],
        redirectTo: '/',
        closeRedirectTo: '/',
      });
      return;
    }
    const conversation = createAndStoreConversation();
    window.dispatchEvent(new CustomEvent(AGENT_CHAT_CREATE_CONVERSATION_EVENT, { detail: { localId: conversation.local_id } }));
    if (pathname !== '/') {
      window.location.href = '/';
    }
  };

  const handleSelectConversation = (localId: string) => {
    setSidebarNotice('');
    setActiveConversationId(localId);
    writeActiveConversationId(localId);
    window.dispatchEvent(new CustomEvent(AGENT_CHAT_SELECT_CONVERSATION_EVENT, { detail: { localId } }));
    if (pathname !== '/') {
      window.location.href = '/';
    }
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
        setProfileAvatarSource(reader.result);
        setProfileAvatarDraft(reader.result);
        setProfileAvatarScale(1);
        setProfileAvatarOffsetX(50);
        setProfileAvatarOffsetY(50);
        setProfileNotice('');
      }
    };
    reader.onerror = () => setProfileNotice('头像读取失败，请重新选择');
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async () => {
    if (isProfileSaving || !profileNameDraft.trim()) return;
    setIsProfileSaving(true);
    setProfileNotice('');
    try {
      const avatar = isImageAvatar(profileAvatarSource)
        ? await cropAvatarImage(profileAvatarSource, profileAvatarScale, profileAvatarOffsetX, profileAvatarOffsetY)
        : '';
      await updateProfile({ name: profileNameDraft.trim(), avatar });
      setProfileAvatarDraft(avatar);
      setProfileAvatarSource(avatar);
      setProfileNotice('资料已保存');
    } catch (error) {
      setProfileNotice(error instanceof Error ? error.message : '保存失败');
    } finally {
      setIsProfileSaving(false);
    }
  };

  const handleDeleteConversation = async (conversation: AgentLocalConversation) => {
    setSidebarNotice('');
    const confirmed = window.confirm(`确定删除「${getConversationTitle(conversation)}」吗？`);
    if (!confirmed) return;
    deleteLocalConversation(conversation.local_id);
    if (isAuthenticated && conversation.conversation_id) {
      try {
        const response = await fetch(`${API_BASE}/api/agent/conversations/${conversation.conversation_id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (!response.ok) {
          const payload = await readJsonResponse(response).catch(() => ({}));
          const message = typeof (payload as { message?: unknown }).message === 'string' ? (payload as { message: string }).message : '后端删除失败';
          setSidebarNotice(message);
        }
      } catch {
        setSidebarNotice('本地已删除，后端服务连接失败。');
      }
    }
  };

  const handleSwitchKnownAccount = async (accountId: string) => {
    if (accountId === currentAccountId || switchingAccountId) return;
    setAccountNotice('');
    setSwitchingAccountId(accountId);
    try {
      await switchKnownAccount(accountId);
      setIsUserMenuOpen(false);
      if (pathname !== '/') {
        window.location.href = '/';
      }
    } catch (error) {
      setAccountNotice(error instanceof Error ? error.message : '切换账号失败');
    } finally {
      setSwitchingAccountId('');
    }
  };

  return (
    <aside
      className={`koc-sidebar-root z-30 flex h-full shrink-0 flex-col overflow-visible rounded-[18px] border border-[var(--box-border)] bg-white shadow-[var(--box-shadow)] transition-[width] duration-300 ${
        isCollapsed ? 'w-[84px]' : 'w-[292px]'
      }`}
    >
      <div className={`flex pt-5 ${isCollapsed ? 'flex-col items-center justify-center gap-1 px-0' : 'items-center justify-between gap-3 px-4'}`}>
        {!isCollapsed && (
          <div className="flex min-w-0 items-start gap-2">
            <Link href="/" className="min-w-0">
              <span className="koc-heading-font block truncate text-[18px] leading-tight text-[var(--foreground)]">顶流养成计划</span>
              <span className="koc-heading-font mt-1 block text-[16px] leading-tight text-[var(--foreground)]">Agent</span>
            </Link>
            <Link
              href="/manual"
              title="用户指南"
              aria-label="用户指南"
              className="grid size-8 shrink-0 place-items-center rounded-full transition hover:bg-[var(--nav-hover)]"
            >
              <Image src="/koc-assets/icons/图标/灵光一闪.svg" alt="" width={22} height={22} className="size-[22px] shrink-0" />
            </Link>
          </div>
        )}
        {isCollapsed && (
          <Link
            href="/manual"
            title="用户指南"
            aria-label="用户指南"
            className="ml-1 grid size-10 shrink-0 place-items-center rounded-full transition hover:bg-[var(--nav-hover)]"
          >
            <Image src="/koc-assets/icons/图标/灵光一闪.svg" alt="" width={24} height={24} className="size-6 shrink-0" />
          </Link>
        )}
        <button
          type="button"
          aria-label={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
          title={isCollapsed ? '展开' : '收起'}
          onClick={() => updateCollapsed((current) => !current)}
          className="grid size-10 shrink-0 place-items-center rounded-full text-[24px] text-[var(--foreground)] transition hover:bg-[var(--nav-hover)]"
        >
          {isCollapsed ? '›' : '‹'}
        </button>
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col px-3">
        <button
          type="button"
          onClick={handleCreateConversation}
          title={isCollapsed ? '新建对话' : undefined}
          className={`flex min-h-11 items-center gap-3 rounded-[14px] px-3 text-[15px] font-medium text-[var(--foreground)] transition hover:bg-[var(--nav-hover)] ${
            isCollapsed ? 'justify-center' : ''
          }`}
        >
          <span className="text-[20px] leading-none">＋</span>
          {!isCollapsed && <span>新建对话</span>}
        </button>

        {!isCollapsed && (
          <label className="mt-2 flex min-h-11 items-center gap-3 rounded-[14px] border border-[var(--box-border)] bg-[#f8fbff] px-3">
            <span className="text-[17px] text-[var(--muted-text)]">⌕</span>
            <input
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
              placeholder="搜索对话"
              className="min-w-0 flex-1 bg-transparent text-[14px] text-[var(--foreground)] outline-none"
            />
          </label>
        )}

        {!isCollapsed && sidebarNotice && (
          <p className="mt-2 rounded-[12px] bg-[#eff6ff] px-3 py-2 text-[12px] leading-5 text-[#1d4ed8]">{sidebarNotice}</p>
        )}

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
          {!isCollapsed && <p className="px-3 text-[12px] font-medium text-[var(--muted-text)]">对话</p>}
          <div className="mt-2 space-y-1">
            {filteredConversations.map((conversation) => {
              const active = conversation.local_id === activeConversationId;
              return (
                <div
                  key={conversation.local_id}
                  className={`group flex w-full items-center gap-2 rounded-[14px] transition ${
                    active ? 'bg-[var(--nav-active)] text-[var(--foreground)]' : 'text-[var(--foreground)] hover:bg-[var(--nav-hover)]'
                  } ${isCollapsed ? 'justify-center' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectConversation(conversation.local_id)}
                    title={isCollapsed ? getConversationTitle(conversation) : undefined}
                    className={`flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left ${isCollapsed ? 'justify-center' : ''}`}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-[14px] shadow-[var(--box-shadow)]">
                      {conversation.summary.content.done ? '✓' : conversation.summary.persona.done ? '•' : '·'}
                    </span>
                    {!isCollapsed && (
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{getConversationTitle(conversation)}</span>
                        <span className="mt-0.5 block truncate text-[12px] text-[var(--muted-text)]">
                          {compactConversationMeta(conversation)}
                        </span>
                      </span>
                    )}
                  </button>
                  {!isCollapsed && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteConversation(conversation)}
                      title="删除"
                      aria-label={`删除 ${getConversationTitle(conversation)}`}
                      className="mr-2 grid size-8 shrink-0 place-items-center rounded-full text-[15px] text-[var(--muted-text)] opacity-70 transition hover:bg-white hover:text-[#dc2626] group-hover:opacity-100"
                    >
                      🗑
                    </button>
                  )}
                </div>
              );
            })}
            {!isCollapsed && filteredConversations.length === 0 && (
              <p className="rounded-[14px] px-3 py-4 text-[13px] leading-6 text-[var(--muted-text)]">
                还没有对话，点击“新建对话”开始。
              </p>
            )}
          </div>
        </div>
      </div>

      <div ref={userModuleRef} className={`relative z-40 shrink-0 border-t border-[var(--box-border)] px-3 py-4 ${isCollapsed ? 'space-y-3' : 'space-y-2'}`}>
        {isAuthenticated && isUserMenuOpen && (
          <div className={`fixed z-50 max-h-[calc(100vh-316px)] w-[380px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-[18px] border border-[var(--box-border)] bg-white p-3 text-sm text-[var(--foreground)] shadow-[var(--box-shadow)] ${isCollapsed ? 'bottom-3 left-[104px]' : 'left-[60px] top-[292px]'}`}>
            <div className="flex items-center gap-3">
              <AvatarBadge value={profileAvatarDraft} size="lg" />
              <div className="min-w-0">
                <p className="koc-heading-font truncate text-[17px] leading-tight">{titleText}</p>
                <p className="mt-1 truncate text-[12px] text-[var(--muted-text)]">{user?.username || user?.email || '当前账号'}</p>
              </div>
            </div>

            <div className="mt-2 rounded-[14px] border border-[var(--box-border)] bg-[#f8fbff] p-2">
              <div className="grid gap-2 md:grid-cols-[88px_minmax(0,1fr)]">
                <div className="flex flex-col items-center gap-1.5">
                  <AvatarCropPreview
                    source={profileAvatarSource || profileAvatarDraft}
                    scale={profileAvatarScale}
                    offsetX={profileAvatarOffsetX}
                    offsetY={profileAvatarOffsetY}
                    sizeClassName="size-16"
                  />
                  <label className="koc-heading-font flex h-8 w-full cursor-pointer items-center justify-center rounded-[12px] border border-[var(--box-border)] bg-white px-2 text-[12px] shadow-[var(--box-shadow)] transition hover:bg-[var(--nav-hover)]">
                    上传头像
                    <input type="file" accept="image/*" className="sr-only" onChange={(event) => handleProfileAvatarUpload(event.target.files?.[0])} />
                  </label>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] text-[var(--foreground)]">用户名</span>
                    <input
                      value={profileNameDraft}
                      onChange={(event) => setProfileNameDraft(event.target.value.slice(0, 16))}
                      className="koc-input-font h-8 w-full rounded-[12px] border border-[var(--box-border)] bg-white px-3 text-[13px] text-[var(--foreground)] outline-none"
                      placeholder="用户名 / 昵称"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[13px] text-[var(--foreground)]">缩放</span>
                    <input
                      type="range"
                      min="1"
                      max="2.4"
                      step="0.01"
                      value={profileAvatarScale}
                      onChange={(event) => setProfileAvatarScale(Number(event.target.value))}
                      className="koc-avatar-range"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[13px] text-[var(--foreground)]">左右</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={profileAvatarOffsetX}
                      onChange={(event) => setProfileAvatarOffsetX(Number(event.target.value))}
                      className="koc-avatar-range"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[13px] text-[var(--foreground)]">上下</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={profileAvatarOffsetY}
                      onChange={(event) => setProfileAvatarOffsetY(Number(event.target.value))}
                      className="koc-avatar-range"
                    />
                  </label>
                </div>
              </div>
              <div className="mt-1.5 flex flex-col items-center gap-1.5 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setProfileAvatarSource('');
                    setProfileAvatarDraft('');
                    setProfileAvatarScale(1);
                    setProfileAvatarOffsetX(50);
                    setProfileAvatarOffsetY(50);
                  }}
                  className="koc-heading-font h-8 rounded-[12px] border border-[var(--box-border)] bg-white px-3 text-[12px] shadow-[var(--box-shadow)] transition hover:bg-[var(--nav-hover)]"
                >
                  重置头像
                </button>
              </div>
              <button
                type="button"
                disabled={isProfileSaving || !profileNameDraft.trim()}
                onClick={() => void handleSaveProfile()}
                className="koc-heading-font mt-1.5 h-8 w-full rounded-full bg-[var(--primary)] text-[13px] text-white shadow-[var(--cta-shadow)] transition hover:bg-[var(--primary-hover)] disabled:opacity-50"
              >
                {isProfileSaving ? '保存中...' : '保存昵称和头像'}
              </button>
              {profileNotice && <p className="text-center text-[12px] text-[var(--muted-text)]">{profileNotice}</p>}
            </div>

            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="koc-heading-font text-[15px]">切换账号</p>
                <span className="text-[12px] text-[var(--muted-text)]">{knownAccounts.length}/5</span>
              </div>
              <div className="max-h-[96px] space-y-2 overflow-y-auto pr-1">
                {knownAccounts.length === 0 ? (
                  <p className="rounded-[12px] bg-[#f8fbff] px-3 py-2 text-[12px] text-[var(--muted-text)]">登录或添加账号后会显示在这里。</p>
                ) : (
                  knownAccounts.map((account) => {
                    const isCurrentAccount = account.id === currentAccountId;
                    return (
                      <div key={account.id} className={`flex items-center gap-2 rounded-[12px] border px-2 py-2 ${isCurrentAccount ? 'border-[#bfdbfe] bg-[#eff6ff]' : 'border-[var(--box-border)] bg-white'}`}>
                        <button
                          type="button"
                          disabled={Boolean(switchingAccountId)}
                          onClick={() => {
                            if (isCurrentAccount) return;
                            void handleSwitchKnownAccount(account.id);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
                        >
                          <AvatarBadge value={account.avatar} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{account.name || account.username}</span>
                            <span className="block truncate text-[11px] text-[var(--muted-text)]">{account.username}</span>
                          </span>
                          {isCurrentAccount && <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-[10px] text-white">当前</span>}
                          {switchingAccountId === account.id && <span className="text-[10px] text-[var(--muted-text)]">切换中</span>}
                        </button>
                        <button
                          type="button"
                          title="从本机列表移除"
                          onClick={() => removeKnownAccount(account.id)}
                          className="grid size-6 shrink-0 place-items-center rounded-full text-[18px] leading-none text-[var(--muted-text)] hover:bg-[var(--nav-hover)]"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  if (hasReachedAccountLimit) {
                    setAccountNotice('每个设备最多只能添加5个账号 数量已达到上限');
                    return;
                  }
                  setAccountNotice('');
                  setIsUserMenuOpen(false);
                  openAuthDialog({
                    mode: 'login',
                    title: '添加账号',
                    description: '登录或注册另一个账号，最多保留 5 个账号。',
                    redirectTo: pathname || '/',
                  });
                }}
                className="rounded-[12px] px-3 py-2 font-medium transition hover:bg-[var(--nav-hover)]"
              >
                添加账号
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsUserMenuOpen(false);
                  void logout();
                }}
                className="rounded-[12px] px-3 py-2 font-medium transition hover:bg-[var(--nav-hover)]"
              >
              退出登录
              </button>
            </div>
            {accountNotice && (
              <p className="mt-2 text-center text-[12px] font-medium text-[#dc2626]">
                {accountNotice}
              </p>
            )}

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
              className="mt-2 w-full rounded-[12px] px-3 py-2 text-center font-medium text-[#b91c1c] transition hover:bg-[#fef2f2] disabled:opacity-50"
            >
              {isDeletingAccount ? '注销中...' : '注销账号'}
            </button>
          </div>
        )}

        <button
          type="button"
          title={isAuthenticated ? '账号菜单' : '点击登录'}
          onClick={() => {
            if (status === 'loading') return;
            if (!isAuthenticated) {
              openAuthDialog({
                mode: 'login',
                redirectTo: pathname || '/',
              });
              return;
            }
            setIsUserMenuOpen((open) => !open);
          }}
          className={`flex min-h-11 items-center gap-3 rounded-[14px] px-3 text-[15px] text-[var(--foreground)] transition hover:bg-[var(--nav-hover)] ${
            isCollapsed ? 'w-full justify-center' : 'w-full'
          }`}
        >
          {isAuthenticated ? (
            <AvatarBadge value={user?.avatar} />
          ) : (
            <Image src="/koc-assets/icons/图标/登录.svg" alt="" width={24} height={24} className="size-6 shrink-0" style={{ filter: 'var(--primary-icon-filter)' }} />
          )}
          {!isCollapsed && (
            <span className="min-w-0 text-left">
              <span className="block truncate text-[14px] font-medium">{titleText}</span>
              {!isAuthenticated && <span className="mt-0.5 block text-[12px] text-[var(--muted-text)]">游客体验中</span>}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
}
