'use client';

export default function PromptDebugAccessFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center px-6 py-10">
      <section className="w-full max-w-[720px] rounded-[20px] bg-white/75 px-8 py-10 text-center shadow-sm ring-1 ring-[#eadbcc]">
        <h1 className="text-[28px] font-semibold text-[#241913]">Prompt 调试未开启</h1>
        <p className="mt-3 text-[15px] leading-7 text-[#5a4940]">
          当前开关默认是 false，所以这个页面不会在网站里显示。
          把 <code className="rounded bg-[#f8efe7] px-2 py-1 text-[13px]">NEXT_PUBLIC_SHOW_PROMPT_DEBUG=true</code> 打开后，它会按现在的位置重新显示出来。
        </p>
      </section>
    </div>
  );
}
