import ScenarioHeader from '@/components/ScenarioHeader';

const steps = [
  { title: '1. 人设打造', body: '填写基础信息，先生成一个能持续创作的小红书账号方向。' },
  { title: '2. 热门追踪', body: '基于已保存人设查看适合追的公开趋势和选题机会。' },
  { title: '3. 内容撰写', body: '选择主题或选题，生成标题、正文、封面文案、标签和图片顺序。' },
  { title: '4. 图文指导', body: '保存满意草稿后，按每张图的素材和制作方式生成操作步骤。' },
];

const boundaries = [
  '当前不会自动发布到小红书。',
  '公开搜索结果只作为创作参考，不等于小红书官方热度榜。',
  '图文指导提供制作步骤，不是内置图片编辑器。',
  '模型和搜索能力只服务 Agent 生成链路，不影响你的账号资料。',
];

export default function ManualPage() {
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-[5.5vw] pb-6 pt-7">
      <ScenarioHeader title="用户说明书" subtitle="按这条链路完成一篇可发布的小红书图文" />
      <section className="mx-auto grid w-full max-w-5xl gap-4 md:grid-cols-2">
        {steps.map((step) => (
          <article key={step.title} className="rounded-[22px] border border-[var(--box-border)] bg-[var(--card)] p-6 shadow-[var(--box-shadow)]">
            <h2 className="koc-heading-font text-xl text-[var(--foreground)]">{step.title}</h2>
            <p className="mt-3 text-sm leading-7 text-[var(--foreground)]/70">{step.body}</p>
          </article>
        ))}
      </section>
      <section className="mx-auto mt-5 w-full max-w-5xl rounded-[22px] border border-[var(--box-border)] bg-[var(--card)] p-6 shadow-[var(--box-shadow)]">
        <h2 className="koc-heading-font text-xl text-[var(--foreground)]">当前产品边界</h2>
        <ul className="mt-3 grid gap-2 text-sm leading-7 text-[var(--foreground)]/70">
          {boundaries.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
