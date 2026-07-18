'use client';

import Image from 'next/image';
import type { ClipboardEvent, MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { API_BASE, extractTextFromResponse } from '@/lib/api';
import MarkdownText from '@/components/MarkdownText';
import StopGenerationIcon from '@/components/StopGenerationIcon';

interface ChatDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function blockAssistantCopy(event: ClipboardEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) {
  event.preventDefault();
}

export default function ChatDialog({ isOpen, onClose }: ChatDialogProps) {
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const handleSend = async () => {
    const question = inputValue.trim();
    if (!question || loading) return;

    const nextHistory: ChatMessage[] = [...messages, { role: 'user', content: question }];
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setMessages(nextHistory);
    setInputValue('');
    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          message: question,
          conversationHistory: nextHistory,
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      const reply = extractTextFromResponse(data.data || data);
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setMessages((prev) => [...prev, { role: 'assistant', content: '本次输出已停止。' }]);
        return;
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: '请求失败，请确认后端服务已启动。' }]);
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const clearConversation = () => {
    if (loading) return;
    setMessages([]);
  };

  if (!isOpen) return null;

  return (
    <div className="koc-surface absolute bottom-7 left-7 z-40 flex w-[380px] flex-col rounded-[24px] p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="koc-heading-font text-xl text-[var(--foreground)]">临时对话框</p>
          <p className="mt-1 text-sm text-[var(--foreground)]/70">支持多轮上下文，关闭后保留</p>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearConversation}
              className="rounded-full px-2 py-1 text-xs text-[var(--foreground)]/70 hover:bg-[rgba(255,255,255,0.72)] disabled:opacity-50"
              disabled={loading}
            >
              清空
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-2 py-1 text-sm text-[var(--foreground)]/70 hover:bg-[rgba(255,255,255,0.72)]"
          >
            关闭
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="mb-4 max-h-[320px] min-h-[120px] space-y-3 overflow-y-auto rounded-[18px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] p-4 text-sm leading-6 text-[var(--foreground)] shadow-[var(--box-shadow)]"
      >
        {messages.length === 0 && !loading ? (
          <p className="text-[var(--foreground)]/70">可用于临时资料查询，不影响主页面任务。</p>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={msg.role === 'user' ? 'text-right' : 'text-left'}
              {...(msg.role === 'assistant'
                ? {
                    onCopy: blockAssistantCopy,
                    onContextMenu: blockAssistantCopy,
                  }
                : {})}
            >
              <div
                className={
                  msg.role === 'user'
                    ? 'koc-song-font inline-block max-w-[85%] rounded-[14px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.94)] px-3 py-2 text-left text-[var(--foreground)] shadow-[var(--box-shadow)]'
                    : 'koc-song-font inline-block max-w-[85%] rounded-[14px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.98)] px-3 py-2 text-left text-[var(--foreground)] shadow-[var(--box-shadow)] select-none'
                }
              >
                <MarkdownText content={msg.content} />
              </div>
            </div>
          ))
        )}
        {loading && <p className="text-left text-[var(--foreground)]/70">思考中…</p>}
      </div>

      <div className="flex h-11 items-center rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] pl-4 shadow-[var(--box-shadow)]">
        <input
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder={loading ? '等待回复中…' : '输入临时问题'}
          className="koc-song-font koc-chat-placeholder min-w-0 flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--foreground)]/70 disabled:opacity-60"
          onKeyDown={(event) => event.key === 'Enter' && !loading && handleSend()}
          disabled={loading}
        />
        <button
          type="button"
          onClick={loading ? handleStop : handleSend}
          className="koc-icon-center mr-1 size-9 rounded-full text-xl text-[var(--foreground)] hover:bg-[rgba(255,255,255,0.72)] disabled:opacity-50"
          disabled={!loading && !inputValue.trim()}
          aria-label={loading ? '停止生成' : '发送'}
          title={loading ? '停止生成' : '发送'}
        >
          {loading ? <StopGenerationIcon /> : <Image src="/koc-assets/icons/图标/发送.svg" alt="" width={22} height={22} className="size-[22px]" />}
        </button>
      </div>
    </div>
  );
}
