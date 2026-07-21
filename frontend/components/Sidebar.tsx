'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import LoginButton from '@/components/LoginButton';
import {
  AGENT_CHAT_CONVERSATIONS_UPDATED_EVENT,
  AGENT_CHAT_CREATE_CONVERSATION_EVENT,
  AGENT_CHAT_SELECT_CONVERSATION_EVENT,
  SIDEBAR_COLLAPSE_EVENT,
  createAndStoreConversation,
  readActiveConversationId,
  readLocalConversations,
} from '@/lib/agent-chat-store';
import type { AgentLocalConversation } from '@/lib/agent-chat-contract';

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'koc-sidebar-collapsed';

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

function compactConversationMeta(conversation: AgentLocalConversation) {
  const persona = conversation.summary.persona.text.trim();
  const content = conversation.summary.content.text.trim();
  const source = persona || content || '新的角色链路';
  return source.length > 24 ? `${source.slice(0, 24)}...` : source;
}

export default function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(() => readInitialCollapsed(pathname));
  const [searchValue, setSearchValue] = useState('');
  const [conversations, setConversations] = useState<AgentLocalConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');

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

  const filteredConversations = useMemo(() => {
    const keyword = searchValue.trim().toLowerCase();
    if (!keyword) return conversations;
    return conversations.filter((conversation) => {
      const text = [
        conversation.title,
        conversation.summary.persona.text,
        conversation.summary.trending.text,
        conversation.summary.content.text,
      ].join(' ').toLowerCase();
      return text.includes(keyword);
    });
  }, [conversations, searchValue]);

  const updateCollapsed = (nextValue: boolean | ((current: boolean) => boolean)) => {
    setIsCollapsed((current) => (typeof nextValue === 'function' ? nextValue(current) : nextValue));
  };

  const handleCreateConversation = () => {
    const conversation = createAndStoreConversation();
    window.dispatchEvent(new CustomEvent(AGENT_CHAT_CREATE_CONVERSATION_EVENT, { detail: { localId: conversation.local_id } }));
    if (pathname !== '/') {
      window.location.href = '/';
    }
  };

  const handleSelectConversation = (localId: string) => {
    window.dispatchEvent(new CustomEvent(AGENT_CHAT_SELECT_CONVERSATION_EVENT, { detail: { localId } }));
    if (pathname !== '/') {
      window.location.href = '/';
    }
  };

  return (
    <aside
      className={`koc-sidebar-root z-30 flex h-full shrink-0 flex-col overflow-hidden rounded-[18px] border border-[var(--box-border)] bg-white shadow-[var(--box-shadow)] transition-[width] duration-300 ${
        isCollapsed ? 'w-[84px]' : 'w-[292px]'
      }`}
    >
      <div className={`flex items-center gap-3 px-4 pt-5 ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
        {!isCollapsed && (
          <Link href="/" className="min-w-0">
            <span className="koc-heading-font block truncate text-[18px] leading-tight text-[var(--foreground)]">KOC Agent</span>
            <span className="mt-1 block text-[12px] text-[var(--muted-text)]">一个角色一个对话</span>
          </Link>
        )}
        <button
          type="button"
          aria-label={isCollapsed ? '展开侧边栏' : '收起侧边栏'}
          title={isCollapsed ? '展开' : '收起'}
          onClick={() => updateCollapsed((current) => !current)}
          className="grid size-9 shrink-0 place-items-center rounded-full text-[18px] text-[var(--foreground)] transition hover:bg-[var(--nav-hover)]"
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

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
          {!isCollapsed && <p className="px-3 text-[12px] font-medium text-[var(--muted-text)]">临时对话</p>}
          <div className="mt-2 space-y-1">
            {filteredConversations.map((conversation) => {
              const active = conversation.local_id === activeConversationId;
              return (
                <button
                  key={conversation.local_id}
                  type="button"
                  onClick={() => handleSelectConversation(conversation.local_id)}
                  title={isCollapsed ? conversation.title : undefined}
                  className={`flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left transition ${
                    active ? 'bg-[var(--nav-active)] text-[var(--foreground)]' : 'text-[var(--foreground)] hover:bg-[var(--nav-hover)]'
                  } ${isCollapsed ? 'justify-center' : ''}`}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-[14px] shadow-[var(--box-shadow)]">
                    {conversation.summary.persona.done ? '✓' : '…'}
                  </span>
                  {!isCollapsed && (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{conversation.title}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-[var(--muted-text)]">
                        {compactConversationMeta(conversation)}
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
            {!isCollapsed && filteredConversations.length === 0 && (
              <p className="rounded-[14px] px-3 py-4 text-[13px] leading-6 text-[var(--muted-text)]">
                还没有对话，点击「新建对话」开始。
              </p>
            )}
          </div>
        </div>
      </div>

      <div className={`shrink-0 border-t border-[var(--box-border)] px-3 py-4 ${isCollapsed ? 'space-y-3' : 'space-y-2'}`}>
        <Link
          href="/manual"
          title={isCollapsed ? '用户指南' : undefined}
          className={`flex min-h-11 items-center gap-3 rounded-[14px] px-3 text-[15px] text-[var(--foreground)] transition hover:bg-[var(--nav-hover)] ${
            isCollapsed ? 'justify-center' : ''
          }`}
        >
          <Image src="/koc-assets/icons/图标/灵光一闪.svg" alt="" width={24} height={24} className="size-6 shrink-0" style={{ filter: 'var(--primary-icon-filter)' }} />
          {!isCollapsed && <span>用户指南</span>}
        </Link>
        {!isCollapsed && <LoginButton className="w-full justify-center" />}
      </div>
    </aside>
  );
}
