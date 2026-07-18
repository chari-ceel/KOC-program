import { redirect } from 'next/navigation';
import { SHOW_ANALYSIS_MODULES } from '@/lib/features';

export default function OperationPage() {
  if (!SHOW_ANALYSIS_MODULES) {
    redirect('/');
  }

  return (
    <div className="flex-1 p-8">
      <div className="mx-auto max-w-5xl rounded-[32px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.92)] p-8 shadow-[var(--box-shadow)]">
        <div className="rounded-[28px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] p-6 shadow-[var(--box-shadow)]">
          <h1 className="koc-title-font text-3xl text-[var(--foreground)]">运营规划</h1>
          <p className="mt-3 text-sm text-[var(--foreground)]">构建发布节奏、内容类型与长期执行策略，帮助人设持续增长。</p>
        </div>
        <div className="mt-6 space-y-4 rounded-[28px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.88)] p-6 text-[var(--foreground)] shadow-[var(--box-shadow)]">
          <div className="rounded-[20px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] p-5 shadow-[var(--box-shadow)]">
            <h2 className="koc-heading-font text-xl text-[var(--foreground)]">发布节奏</h2>
            <p className="mt-3 leading-7">建议先保持 2-3 次/周的稳定更新频率，优先测试人设相关题材的真实反馈。</p>
          </div>
          <div className="rounded-[20px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] p-5 shadow-[var(--box-shadow)]">
            <h2 className="koc-heading-font text-xl text-[var(--foreground)]">内容布局</h2>
            <p className="mt-3 leading-7">组合“人设故事”、“热点跟风”和“干货体验”三类内容，避免单一风格导致用户认知不清。</p>
          </div>
          <div className="rounded-[20px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.96)] p-5 shadow-[var(--box-shadow)]">
            <h2 className="koc-heading-font text-xl text-[var(--foreground)]">持续迭代</h2>
            <p className="mt-3 leading-7">根据趋势发现和评论反馈每周复盘一次，及时优化人设表达和选题方向。</p>
          </div>
        </div>
      </div>
    </div>
  );
}
