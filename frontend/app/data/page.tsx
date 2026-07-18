import { redirect } from 'next/navigation';
import { SHOW_ANALYSIS_MODULES } from '@/lib/features';

export default function DataPage() {
  if (!SHOW_ANALYSIS_MODULES) {
    redirect('/');
  }

  return (
    <div className="flex-1 p-8">
      <div className="mx-auto max-w-5xl rounded-[32px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.92)] p-8 shadow-[var(--box-shadow)]">
        <div className="rounded-[28px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] p-6 shadow-[var(--box-shadow)]">
          <h1 className="koc-title-font text-3xl text-[var(--foreground)]">数据分析</h1>
          <p className="mt-3 text-sm text-[var(--foreground)]">通过已有运营数据、笔记表现与趋势反馈，帮助你判断内容方向是否稳定。</p>
        </div>
        <div className="mt-6 space-y-4 rounded-[28px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] p-6 text-[var(--foreground)] shadow-[var(--box-shadow)]">
          <div className="rounded-[20px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] p-5 shadow-[var(--box-shadow)]">
            <h2 className="koc-heading-font text-xl text-[var(--foreground)]">内容表现洞察</h2>
            <p className="mt-3 leading-7">暂未接入实时数据时，可先使用“热门追踪”输出的趋势方向作为验证依据，观察哪些题材和表达方式更受目标受众欢迎。</p>
          </div>
          <div className="rounded-[20px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] p-5 shadow-[var(--box-shadow)]">
            <h2 className="koc-heading-font text-xl text-[var(--foreground)]">选题热度评估</h2>
            <p className="mt-3 leading-7">将人设与追踪结果结合，判断当前赛道是否存在低门槛、高共鸣的内容机会。</p>
          </div>
          <div className="rounded-[20px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] p-5 shadow-[var(--box-shadow)]">
            <h2 className="koc-heading-font text-xl text-[var(--foreground)]">当前建议</h2>
            <p className="mt-3 leading-7">先构建清晰的人设定位，再通过趋势快照反复验证；若结果趋于稳定，可进入内容撰写阶段。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
