'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE, isRecord, readJsonResponse } from '@/lib/api';
import {
  getPersonaCardViewModel,
  normalizePersonaRecord,
  writeSelectedPersona,
  type PersonaRecord,
} from '@/lib/persona';
import TopToast from '@/components/TopToast';
import { useAuth } from '@/context/AuthContext';

type NoticeTone = 'success' | 'error' | 'info';

export default function PersonaFavoritesPage() {
  const router = useRouter();
  const { isAuthenticated, openUnlockDialog } = useAuth();
  const [records, setRecords] = useState<PersonaRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [noticeTone, setNoticeTone] = useState<NoticeTone>('info');

  const showNotice = useCallback((message: string, tone: NoticeTone = 'info') => {
    setNotice(message);
    setNoticeTone(tone);
  }, []);

  const loadFavorites = useCallback(async () => {
    if (!isAuthenticated) {
      setIsLoading(false);
      openUnlockDialog({
        title: '登录后查看人设收藏',
        descriptionLines: ['收藏人设会长期保存，普通人设历史只保留 7 天'],
        redirectTo: '/persona-favorites',
      });
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/persona/favorites`, { credentials: 'include' });
      const result = await readJsonResponse(response);
      const nextRecords = isRecord(result) && isRecord(result.data) && Array.isArray(result.data.favoritePersonas)
        ? result.data.favoritePersonas.map(normalizePersonaRecord).filter((record): record is PersonaRecord => Boolean(record))
        : [];
      setRecords(nextRecords);
      showNotice('', 'info');
    } catch (error) {
      console.error('Failed to load favorite personas', error);
      showNotice('读取人设收藏失败，请稍后重试。', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, openUnlockDialog, showNotice]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFavorites();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFavorites]);

  const unfavorite = async (record: PersonaRecord) => {
    try {
      const response = await fetch(`${API_BASE}/api/persona/favorite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ recordId: record.id, isFavorited: false }),
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !isRecord(result) || result.code !== 200) {
        throw new Error('取消收藏失败');
      }
      setRecords((items) => items.filter((item) => item.id !== record.id));
      showNotice('已取消收藏，普通记录仍按 7 天保留。', 'success');
    } catch (error) {
      console.error('Failed to unfavorite persona', error);
      showNotice('取消收藏失败，请稍后重试。', 'error');
    }
  };

  const deletePersonaRecord = async (record: PersonaRecord) => {
    if (!window.confirm('确定要删除这条收藏人设吗？删除后历史和收藏中都不会再显示。')) return;
    try {
      const response = await fetch(`${API_BASE}/api/persona/record/${encodeURIComponent(record.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const result = await readJsonResponse(response);
      if (!response.ok || !isRecord(result) || result.code !== 200) {
        throw new Error('删除人设记录失败');
      }
      setRecords((items) => items.filter((item) => item.id !== record.id));
      showNotice('已删除这条人设记录。', 'success');
    } catch (error) {
      console.error('Failed to delete persona record', error);
      showNotice('删除人设记录失败，请稍后重试。', 'error');
    }
  };

  const openPersonaInModule = (record: PersonaRecord, target: 'trending' | 'content') => {
    writeSelectedPersona(record, 'favorite');
    router.push(target === 'trending' ? '/trending' : '/content');
  };

  const continuePersona = (record: PersonaRecord) => {
    writeSelectedPersona(record, 'favorite');
    router.push('/profile');
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden px-[4vw] pb-6 pt-7 sm:px-[5.5vw]">
      <TopToast message={notice} tone={noticeTone} />
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mx-auto mt-8 w-full max-w-[980px] shrink-0 text-center">
          <h1 className="koc-title-font text-[30px] leading-tight text-[var(--title-blue)]">人设收藏</h1>
          <p className="koc-song-font mt-2 text-[22px] leading-tight text-[var(--foreground)]">
            收藏人设会长期保存，普通保存历史只保留 7 天
          </p>
        </div>

        <div className="mx-auto mt-6 flex min-h-0 w-full max-w-[980px] flex-1 flex-col">
          <div className="mb-4 rounded-[14px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.74)] px-5 py-4 text-[15px] leading-7 text-[var(--foreground)] shadow-[var(--box-shadow)]">
            你可以从收藏人设直接进入热门追踪或内容撰写；进入后页面会优先使用你刚选择的人设，而不是默认最新人设。
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-8 pr-3">
            {isLoading ? (
              <div className="flex min-h-[280px] items-center justify-center text-[18px] text-[var(--foreground)]">
                正在读取收藏人设...
              </div>
            ) : records.length === 0 ? (
              <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[18px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.72)] px-8 text-center shadow-[var(--box-shadow)]">
                <h2 className="koc-heading-font text-[24px] text-[var(--foreground)]">还没有收藏人设</h2>
                <p className="mt-3 max-w-[520px] text-[16px] leading-7 text-[var(--foreground)]">
                  在人设打造页查看 7 天历史时，点击卡片右上角收藏图标，就能把重要人设长期保存到这里。
                </p>
                <button
                  type="button"
                  onClick={() => router.push('/profile')}
                  className="koc-heading-font mt-6 rounded-full border border-[#888888] bg-[#DE868F] px-6 py-3 text-[15px] text-white shadow-[var(--cta-shadow)] transition hover:opacity-90"
                >
                  去人设打造
                </button>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {records.map((record) => {
                  const card = getPersonaCardViewModel(record.persona, {
                    savedAt: record.savedAt,
                    expiresAt: record.expiresAt,
                    isFavorite: true,
                  });
                  return (
                  <article
                    key={record.id}
                    className="relative rounded-[14px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.74)] p-4 text-left shadow-[var(--box-shadow)]"
                  >
                    <button
                      type="button"
                      onClick={() => void unfavorite(record)}
                      className="absolute right-3 top-3 rounded-full border border-[#DE868F]/45 bg-white px-2.5 py-1 text-[16px] text-[#DE868F] shadow-[var(--box-shadow)] transition hover:bg-[#fff3f5]"
                      title="取消收藏"
                    >
                      ★
                    </button>
                    <button
                      type="button"
                      onClick={() => void deletePersonaRecord(record)}
                      className="absolute right-14 top-3 flex size-[32px] items-center justify-center rounded-full border border-[var(--box-border)] bg-[rgba(255,255,255,0.94)] text-[15px] text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-[rgba(255,255,255,0.82)]"
                      title="删除人设"
                      aria-label="删除人设"
                    >
                      🗑
                    </button>
                    <p className="koc-heading-font line-clamp-1 pr-28 text-[18px] leading-tight text-[var(--foreground)]">{card.title}</p>
                    <div className="mt-2 space-y-1 text-[13px] leading-5 text-[var(--foreground)]">
                      <p className="line-clamp-1">{card.fitLine}</p>
                      <p className="line-clamp-1">{card.hookLine}</p>
                      <p className="line-clamp-1">{card.toneLine}</p>
                    </div>
                    <p className="mt-2 text-[12px] text-[var(--foreground)]/70">{card.metaText}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openPersonaInModule(record, 'trending')}
                        className="koc-heading-font rounded-full border border-[#888888] bg-[#DE868F] px-3 py-1.5 text-[12px] text-white shadow-[var(--cta-shadow)] transition hover:opacity-90"
                      >
                        热门追踪
                      </button>
                      <button
                        type="button"
                        onClick={() => openPersonaInModule(record, 'content')}
                        className="koc-heading-font rounded-full border border-[#888888] bg-[#DE868F] px-3 py-1.5 text-[12px] text-white shadow-[var(--cta-shadow)] transition hover:opacity-90"
                      >
                        写内容
                      </button>
                      <button
                        type="button"
                        onClick={() => continuePersona(record)}
                        className="koc-heading-font rounded-full border border-[#888888] bg-[rgba(255,255,255,0.94)] px-3 py-1.5 text-[12px] text-[var(--foreground)] shadow-[var(--box-shadow)] transition hover:bg-[rgba(255,255,255,0.82)]"
                      >
                        继续完善
                      </button>
                    </div>
                  </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
