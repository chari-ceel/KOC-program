'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { normalizeAiMarkdown } from '@/lib/markdown-normalize';

interface MarkdownTextProps {
  content: string;
  className?: string;
  disableEmphasis?: boolean;
  inheritTextColor?: boolean;
  plainValidationKeywords?: boolean;
}

const boldLineLabels = [
  '人设标题',
  '内容方向',
  '目标受众',
  '内容风格',
  '趋势维度',
  '趋势总结',
  '当前热点包括',
  '受众需求',
  '推荐选题',
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function boldKnownLineLabels(content: string) {
  const labelPattern = boldLineLabels.map(escapeRegExp).join('|');
  return content.replace(new RegExp(`^(\\s*(?:[-*]\\s*)?)(?!\\*\\*)(${labelPattern})\\s*[:：]\\s*`, 'gmu'), '$1**$2：**');
}

export default function MarkdownText({
  content,
  className = '',
  disableEmphasis = false,
  inheritTextColor = false,
  plainValidationKeywords = false,
}: MarkdownTextProps) {
  const normalized = boldKnownLineLabels(normalizeAiMarkdown(content, { plainValidationKeywords }));
  const textColor = inheritTextColor ? 'text-inherit' : 'text-[var(--foreground)]';
  const headingColor = inheritTextColor ? 'text-inherit' : '';

  return (
    <div className={`break-words whitespace-normal ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className={`koc-heading-font mt-4 break-words text-[1.18em] leading-snug ${headingColor || 'text-[var(--foreground)]'}`}>{children}</h1>,
          h2: ({ children }) => <h2 className={`koc-heading-font mt-4 break-words text-[1.1em] leading-snug ${headingColor || 'text-[var(--foreground)]'}`}>{children}</h2>,
          h3: ({ children }) => <h3 className={`koc-heading-font mt-3 break-words text-[1.02em] leading-snug ${headingColor || 'text-[var(--foreground)]'}`}>{children}</h3>,
          p: ({ children }) => <p className={`my-2 break-words whitespace-pre-line leading-[1.8] ${textColor}`}>{children}</p>,
          ul: ({ children }) => <ul className={`my-3 list-disc space-y-1.5 break-words pl-5 ${textColor}`}>{children}</ul>,
          ol: ({ children }) => <ol className={`my-3 list-decimal space-y-1.5 break-words pl-5 ${textColor}`}>{children}</ol>,
          li: ({ children }) => <li className="break-words whitespace-pre-line leading-[1.8]">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-4 rounded-r-[12px] border-l-4 border-[var(--box-border)] bg-[rgba(255,255,255,0.55)] px-4 py-3 text-[var(--foreground)]">
              {children}
            </blockquote>
          ),
          code: ({ className: codeClassName, children }) =>
            codeClassName ? (
              <code className="block min-w-max text-[0.95em] leading-[1.8] text-[var(--foreground)]">
                {children}
              </code>
            ) : (
              <code className="rounded-[8px] bg-[rgba(255,255,255,0.92)] px-1.5 py-0.5 text-[0.92em] text-[var(--foreground)]">{children}</code>
            ),
          pre: ({ children }) => (
            <pre className="my-4 overflow-x-auto rounded-[16px] border border-[var(--box-border)] bg-[rgba(255,255,255,0.94)] px-5 py-4 font-mono text-[0.95em] shadow-[var(--box-shadow)]">
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              className="break-all text-[var(--title-blue)] underline underline-offset-4 transition hover:opacity-70"
              target={href?.startsWith('http') ? '_blank' : undefined}
              rel={href?.startsWith('http') ? 'noreferrer' : undefined}
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-4 border-[var(--box-border)]" />,
          strong: ({ children }) => <strong className="font-bold text-black">{children}</strong>,
          em: ({ children }) => (disableEmphasis ? <>{children}</> : <em className="italic">{children}</em>),
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
