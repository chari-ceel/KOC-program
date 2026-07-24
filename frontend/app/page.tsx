'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import type { AgentContentDraftPoint, AgentFlowSummaryItem, AgentQuestionBlock } from '@/lib/agent-chat-contract';

const guideItems = [
  {
    title: '人设打造',
    body: '填写基础信息，先生成一个能持续创作的小红书账号方向。',
    icon: '/koc-assets/icons/图标/人设打造.svg',
    tone: 'border-[#f9a8d4] bg-[#fff7fb]',
    iconTone: 'bg-[#fce7f3]',
  },
  {
    title: '热门追踪',
    body: '基于已保存人设查看适合追的公开趋势和选题机会。',
    icon: '/koc-assets/icons/图标/热门追踪.svg',
    tone: 'border-[#93c5fd] bg-[#f8fbff]',
    iconTone: 'bg-[#dbeafe]',
  },
  {
    title: '内容撰写',
    body: '选择主题或选题，生成标题、正文、封面文案、标签和图片顺序。',
    icon: '/koc-assets/icons/图标/内容撰写.svg',
    tone: 'border-[#86efac] bg-[#f7fff9]',
    iconTone: 'bg-[#dcfce7]',
  },
];

const productBoundaries = [
  '当前不会自动发布到小红书。',
  '公开搜索结果只作为创作参考，不等于小红书官方热度榜。',
  '当前前端主流程聚焦人设打造、热门追踪和内容撰写。',
  '模型和搜索能力只服务 Agent 生成链路，不影响你的账号资料。',
];

const titleGlitters = [
  { left: '96%', top: '1%', width: '4px', height: '20px', delay: '0s', dx: '-320px', dy: '168px', duration: '5.2s', rotate: '22deg', opacity: 0.98 },
  { left: '92%', top: '4%', width: '5px', height: '24px', delay: '0.16s', dx: '-300px', dy: '182px', duration: '5.6s', rotate: '28deg', opacity: 0.94 },
  { left: '88%', top: '6%', width: '3px', height: '16px', delay: '0.3s', dx: '-260px', dy: '146px', duration: '5s', rotate: '16deg', opacity: 0.98 },
  { left: '84%', top: '9%', width: '4px', height: '18px', delay: '0.48s', dx: '-230px', dy: '122px', duration: '4.9s', rotate: '10deg', opacity: 0.92 },
  { left: '78%', top: '11%', width: '6px', height: '26px', delay: '0.64s', dx: '-190px', dy: '108px', duration: '5.1s', rotate: '33deg', opacity: 0.88 },
  { left: '72%', top: '8%', width: '4px', height: '14px', delay: '0.82s', dx: '-160px', dy: '96px', duration: '4.8s', rotate: '12deg', opacity: 0.86 },
  { left: '90%', top: '13%', width: '5px', height: '22px', delay: '1s', dx: '-274px', dy: '138px', duration: '5.7s', rotate: '25deg', opacity: 0.9 },
  { left: '81%', top: '16%', width: '4px', height: '18px', delay: '1.18s', dx: '-216px', dy: '116px', duration: '5.4s', rotate: '18deg', opacity: 0.84 },
  { left: '95%', top: '8%', width: '3px', height: '13px', delay: '1.34s', dx: '-334px', dy: '216px', duration: '6s', rotate: '35deg', opacity: 0.78 },
  { left: '86%', top: '18%', width: '6px', height: '24px', delay: '1.52s', dx: '-246px', dy: '166px', duration: '5.8s', rotate: '20deg', opacity: 0.86 },
  { left: '76%', top: '0%', width: '4px', height: '16px', delay: '1.7s', dx: '-168px', dy: '84px', duration: '4.6s', rotate: '8deg', opacity: 0.82 },
  { left: '68%', top: '14%', width: '5px', height: '20px', delay: '1.88s', dx: '-138px', dy: '124px', duration: '5.5s', rotate: '14deg', opacity: 0.8 },
];

const robotActions = ['hop', 'sit', 'peace', 'poke'] as const;
type RobotAction = 'idle' | (typeof robotActions)[number];

const introRibbonParticles = [
  ...Array.from({ length: 74 }, (_, index) => {
    const t = index / 73;
    const curve = Math.sin(t * Math.PI * 1.12);
    const shimmer = Math.sin(index * 1.73);
    const scatter = Math.cos(index * 2.11);
    const left = 106 - t * 74 + Math.sin(t * 9.4) * 4.2 + scatter * 1.8;
    const top = 18 + curve * 32 + Math.cos(t * 7.2) * 6.5 + scatter * 3.8;
    const size = index % 9 === 0 ? 8.2 : index % 4 === 0 ? 6.4 : 4.4 + (index % 3) * 0.55;

    return {
      layer: 'coarse',
      left: `${left}%`,
      top: `${top}%`,
      size: `${size}px`,
      delay: `${0.12 + t * 1.18 + (index % 5) * 0.026}s`,
      duration: `${3.15 + (index % 6) * 0.2}s`,
      opacity: 0.58 + Math.abs(shimmer) * 0.36,
      driftX: `${-16 - t * 14 + shimmer * 4.5}vw`,
      driftY: `${-8 + curve * 5 + Math.cos(index * 0.91) * 5.5}vh`,
    };
  }),
  ...Array.from({ length: 156 }, (_, index) => {
    const t = index / 155;
    const curve = Math.sin(t * Math.PI * 1.12);
    const shimmer = Math.sin(index * 1.31);
    const scatter = Math.cos(index * 2.67);
    const left = 108 - t * 80 + Math.sin(t * 12.6) * 5.2 + scatter * 2.6;
    const top = 38 + curve * 42 + Math.cos(t * 8.7) * 8 + scatter * 6.2;
    const size = index % 13 === 0 ? 3.1 : index % 5 === 0 ? 2.35 : 1.25 + (index % 4) * 0.22;

    return {
      layer: 'fine',
      left: `${left}%`,
      top: `${top}%`,
      size: `${size}px`,
      delay: `${0.22 + t * 1.46 + (index % 7) * 0.018}s`,
      duration: `${3.45 + (index % 8) * 0.16}s`,
      opacity: 0.38 + Math.abs(shimmer) * 0.42,
      driftX: `${-20 - t * 18 + shimmer * 5.4}vw`,
      driftY: `${2 + curve * 11 + Math.cos(index * 0.83) * 8.2}vh`,
    };
  }),
];

function revealStyle(delayMs: number) {
  return { ['--koc-reveal-delay' as '--koc-reveal-delay']: `${delayMs}ms` } as CSSProperties;
}

function compactText(text: string, maxLength = 30) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  const firstSentence = normalized.split(/[。；;.!！?？]/)[0] || normalized;
  return firstSentence.length > maxLength ? `${firstSentence.slice(0, maxLength)}...` : firstSentence;
}

function FlowStepIcon({ done }: { done: boolean }) {
  return done ? (
    <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-[#22c55e] bg-[#dcfce7] text-[14px] font-bold text-[#16a34a]">
      ✓
    </span>
  ) : (
    <span className="mt-1 size-3 shrink-0 rounded-full border border-[#cbd5e1] bg-white" />
  );
}

function FeatureGuideCard({
  title,
  body,
  icon,
  tone,
  iconTone,
}: {
  title: string;
  body: string;
  icon: string;
  tone: string;
  iconTone: string;
}) {
  return (
    <article
      className={`group min-h-[172px] rounded-[16px] border px-5 py-5 text-center shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_18px_34px_rgba(15,23,42,0.1)] ${tone}`}
    >
      <div className={`mx-auto grid size-[52px] place-items-center rounded-[14px] ${iconTone}`}>
        <Image src={icon} alt="" width={30} height={30} className="size-[30px]" />
      </div>
      <h3 className="koc-heading-font mt-4 text-[20px] leading-tight text-[var(--foreground)]">{title}</h3>
      <p className="mx-auto mt-3 max-w-[15rem] text-[13px] leading-6 text-[var(--muted-text)]">
        {body}
      </p>
    </article>
  );
}

function RobotMascot() {
  const [robotAction, setRobotAction] = useState<RobotAction>('idle');

  const chooseRobotAction = () => {
    setRobotAction(robotActions[Math.floor(Math.random() * robotActions.length)]);
  };

  return (
    <svg
      viewBox="0 0 260 260"
      className={`koc-robot-mascot koc-robot-action-${robotAction} h-full w-full drop-shadow-[0_18px_30px_rgba(37,99,235,0.14)]`}
      aria-hidden="true"
      onMouseEnter={chooseRobotAction}
      onMouseLeave={() => setRobotAction('idle')}
    >
      <defs>
        <linearGradient id="robotShell" x1="8%" y1="5%" x2="92%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="52%" stopColor="#fffefe" />
          <stop offset="100%" stopColor="#e8eef9" />
        </linearGradient>
        <linearGradient id="robotBlue" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5dddf5" />
          <stop offset="54%" stopColor="#20a7dc" />
          <stop offset="100%" stopColor="#1679c9" />
        </linearGradient>
        <linearGradient id="robotScreen" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="62%" stopColor="#fffefe" />
          <stop offset="100%" stopColor="#eef5ff" />
        </linearGradient>
        <linearGradient id="robotShade" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#d7dee9" />
          <stop offset="100%" stopColor="#eef4ff" />
        </linearGradient>
        <radialGradient id="robotSoftHighlight" cx="34%" cy="18%" r="74%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="58%" stopColor="#ffffff" stopOpacity="0.26" />
          <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0.1" />
        </radialGradient>
        <filter id="robotSoftShadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#64748b" floodOpacity="0.18" />
        </filter>
      </defs>
      <g className="koc-robot-pose" filter="url(#robotSoftShadow)">
        <ellipse className="koc-robot-shadow" cx="130" cy="238" rx="60" ry="13" fill="rgba(148,163,184,0.18)" />

        <g className="koc-robot-legs">
          <g className="koc-robot-leg koc-robot-left-leg">
            <path d="M91 188C84 199 84 219 91 229C98 237 116 237 122 229C124 213 119 197 109 188Z" fill="url(#robotShell)" stroke="#b9c3d3" strokeWidth="2.2" />
            <ellipse cx="106" cy="229" rx="18" ry="10" fill="#fffefe" stroke="#cdd6e5" strokeWidth="2" />
          </g>
          <g className="koc-robot-leg koc-robot-right-leg">
            <path d="M151 188C141 197 136 213 138 229C144 237 162 237 169 229C176 219 176 199 169 188Z" fill="url(#robotShell)" stroke="#b9c3d3" strokeWidth="2.2" />
            <ellipse cx="154" cy="229" rx="18" ry="10" fill="#fffefe" stroke="#cdd6e5" strokeWidth="2" />
          </g>
        </g>

        <path className="koc-robot-body" d="M91 153C98 136 112 128 130 128C148 128 162 136 169 153L178 190C182 210 159 222 130 222C101 222 78 210 82 190Z" fill="url(#robotShell)" stroke="#b8c2d1" strokeWidth="2.5" />
        <path d="M96 160C110 169 150 169 164 160" fill="none" stroke="rgba(255,255,255,0.86)" strokeWidth="3.5" strokeLinecap="round" />

        <g className="koc-robot-arm koc-robot-left-arm">
          <path d="M91 158C77 164 70 179 72 195C74 210 88 218 98 209C96 192 100 177 109 168Z" fill="url(#robotShell)" stroke="#b9c3d3" strokeWidth="2.3" />
          <path d="M78 197C82 204 89 207 96 205" fill="none" stroke="#c8d1df" strokeWidth="2" strokeLinecap="round" />
          <path className="koc-robot-poke-finger" d="M86 198L119 184" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" />
        </g>
        <g className="koc-robot-arm koc-robot-right-arm">
          <path d="M169 158C183 164 190 179 188 195C186 210 172 218 162 209C164 192 160 177 151 168Z" fill="url(#robotShell)" stroke="#b9c3d3" strokeWidth="2.3" />
          <path d="M182 197C178 204 171 207 164 205" fill="none" stroke="#c8d1df" strokeWidth="2" strokeLinecap="round" />
          <path className="koc-robot-peace-finger koc-robot-peace-finger-1" d="M174 198L162 178" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" />
          <path className="koc-robot-peace-finger koc-robot-peace-finger-2" d="M179 196L190 177" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" />
          <path className="koc-robot-poke-finger" d="M174 198L141 184" fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" />
        </g>
        <g className="koc-robot-hop-arm koc-robot-hop-left-arm">
          <path d="M100 158C83 146 70 126 67 110C65 101 76 96 83 103C89 119 101 133 115 142Z" fill="url(#robotShell)" stroke="#b9c3d3" strokeWidth="2.4" />
          <ellipse cx="72" cy="104" rx="12" ry="15" fill="#fffefe" stroke="#cdd6e5" strokeWidth="2" transform="rotate(-18 72 104)" />
        </g>
        <g className="koc-robot-hop-arm koc-robot-hop-right-arm">
          <path d="M160 158C177 146 190 126 193 110C195 101 184 96 177 103C171 119 159 133 145 142Z" fill="url(#robotShell)" stroke="#b9c3d3" strokeWidth="2.4" />
          <ellipse cx="188" cy="104" rx="12" ry="15" fill="#fffefe" stroke="#cdd6e5" strokeWidth="2" transform="rotate(18 188 104)" />
        </g>

        <g className="koc-robot-head" transform="translate(10.4 9) scale(0.92)">
          <path d="M52 76C57 48 69 27 86 19C100 28 108 48 114 70Z" fill="url(#robotShell)" stroke="#b7c1d0" strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M208 76C203 48 191 27 174 19C160 28 152 48 146 70Z" fill="url(#robotShell)" stroke="#b7c1d0" strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M72 65C76 49 82 38 90 32C98 42 103 53 106 67Z" fill="#ffd8df" stroke="#efb6c2" strokeWidth="2" strokeLinejoin="round" />
          <path d="M188 65C184 49 178 38 170 32C162 42 157 53 154 67Z" fill="#ffd8df" stroke="#efb6c2" strokeWidth="2" strokeLinejoin="round" />
          <rect x="38" y="60" width="184" height="114" rx="37" fill="url(#robotShell)" stroke="#b4becd" strokeWidth="3" />
          <rect x="45" y="66" width="170" height="104" rx="33" fill="url(#robotSoftHighlight)" opacity="0.8" />
          <path d="M54 94C56 73 76 67 101 67H158C188 67 205 80 208 105" fill="none" stroke="rgba(255,255,255,0.82)" strokeWidth="4" strokeLinecap="round" />
          <path d="M45 107C49 64 82 38 130 38C178 38 211 64 215 107" fill="none" stroke="url(#robotBlue)" strokeWidth="13" strokeLinecap="round" />
          <path d="M50 111C50 128 39 141 25 139C13 137 10 123 13 104C16 85 28 74 41 77C49 79 50 94 50 111Z" fill="#ffffff" stroke="#b8c2d1" strokeWidth="2.4" />
          <path d="M32 83C43 84 49 96 49 111C49 127 42 139 29 140" fill="none" stroke="url(#robotBlue)" strokeWidth="13" strokeLinecap="round" />
          <ellipse cx="29" cy="112" rx="15" ry="28" fill="#f8fbff" stroke="#b8c2d1" strokeWidth="2" opacity="0.9" />
          <path d="M210 111C210 128 221 141 235 139C247 137 250 123 247 104C244 85 232 74 219 77C211 79 210 94 210 111Z" fill="#ffffff" stroke="#b8c2d1" strokeWidth="2.4" />
          <path d="M228 83C217 84 211 96 211 111C211 127 218 139 231 140" fill="none" stroke="url(#robotBlue)" strokeWidth="13" strokeLinecap="round" />
          <ellipse cx="231" cy="112" rx="15" ry="28" fill="#f8fbff" stroke="#b8c2d1" strokeWidth="2" opacity="0.9" />
          <rect x="62" y="86" width="136" height="70" rx="21" fill="url(#robotScreen)" stroke="#aeb9c9" strokeWidth="3" />
          <rect x="69" y="92" width="122" height="58" rx="17" fill="none" stroke="rgba(203,213,225,0.42)" strokeWidth="2" />
          <circle className="koc-robot-screen-dot" cx="184" cy="99" r="4.6" fill="#cbd5e1" />
          <g className="koc-robot-eye koc-robot-eye-left">
            <ellipse cx="102" cy="122" rx="11" ry="17" fill="#111827" />
            <ellipse cx="103" cy="130" rx="10" ry="8" fill="#020617" opacity="0.36" />
            <circle cx="97" cy="112" r="4.8" fill="#ffffff" />
          </g>
          <path className="koc-robot-reference-wink" d="M174 111L151 121L174 131" fill="none" stroke="#111827" strokeWidth="7.2" strokeLinecap="round" strokeLinejoin="round" />
          <path className="koc-robot-mouth-default" d="M119 132C119 139 127 139 127 132C127 139 136 139 136 132" fill="none" stroke="#111827" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          <path className="koc-robot-mouth-hop" d="M114 131C121 144 140 144 147 131" fill="none" stroke="#111827" strokeWidth="4.2" strokeLinecap="round" />
          <circle className="koc-robot-blush koc-robot-blush-left" cx="80" cy="134" r="7" fill="#f9a8d4" />
          <circle className="koc-robot-blush koc-robot-blush-right" cx="181" cy="134" r="7" fill="#f9a8d4" />
          <path d="M158 61C159 55 163 51 168 49" fill="none" stroke="#c7d3e5" strokeWidth="2" strokeLinecap="round" />
          <path d="M166 63C167 57 171 54 176 52" fill="none" stroke="#c7d3e5" strokeWidth="2" strokeLinecap="round" />
        </g>
        <g className="koc-robot-hop-foreground-arm koc-robot-hop-foreground-left-arm">
          <path className="koc-robot-hop-foreground-limb" d="M93 151C73 132 57 106 55 87C54 78 66 74 72 82C79 104 90 124 106 137Z" fill="url(#robotShell)" stroke="#b9c3d3" strokeWidth="2.5" />
          <ellipse cx="61" cy="81" rx="12" ry="15" fill="#fffefe" stroke="#cdd6e5" strokeWidth="2" transform="rotate(-24 61 81)" />
        </g>
        <g className="koc-robot-hop-foreground-arm koc-robot-hop-foreground-right-arm">
          <path className="koc-robot-hop-foreground-limb" d="M167 151C187 132 203 106 205 87C206 78 194 74 188 82C181 104 170 124 154 137Z" fill="url(#robotShell)" stroke="#b9c3d3" strokeWidth="2.5" />
          <ellipse cx="199" cy="81" rx="12" ry="15" fill="#fffefe" stroke="#cdd6e5" strokeWidth="2" transform="rotate(24 199 81)" />
        </g>
      </g>
    </svg>
  );
}


function DemoBubble({ text, className }: { text: string; className: string }) {
  return (
    <div className={`koc-home-bubble rounded-full border border-white/60 bg-white/62 px-5 py-3 text-[18px] text-[var(--foreground)] shadow-[0_14px_28px_rgba(15,23,42,0.08)] backdrop-blur-md ${className}`}>
      {text}
    </div>
  );
}

function FlowSummaryBlock({
  item,
  contentPoints,
  fallbackTitle,
  fallbackHint,
  active,
  onTrace,
}: {
  item: AgentFlowSummaryItem;
  contentPoints?: AgentContentDraftPoint[];
  fallbackTitle: string;
  fallbackHint: string;
  active: boolean;
  onTrace: (messageId: string | null) => void;
}) {
  const summaryText = compactText(item.text, active && item.title === '人设打造' ? 24 : 72);
  const hasContentPoints = Boolean(contentPoints?.length);
  const canTraceStep = Boolean(item.message_id);
  const evidence = item.evidence_summary;
  const evidenceLabel = evidence?.label || (evidence?.tier === 'direct_xhs' ? '直接小红书证据' : evidence?.tier === 'public_web' ? '公开网页佐证' : evidence?.tier ? '需要验证' : '');
  const evidenceClass = evidence?.tier === 'direct_xhs'
    ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
    : evidence?.tier === 'public_web'
      ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'
      : 'border-[#fde68a] bg-[#fffbeb] text-[#92400e]';
  return (
    <section className={`rounded-[16px] border px-4 py-4 ${active ? 'border-[#bfdbfe] bg-[#eff6ff]' : 'border-[var(--box-border)] bg-white'}`}>
      <div className="flex items-start gap-3">
        <FlowStepIcon done={item.done} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            {canTraceStep ? (
              <button
                type="button"
                onClick={() => onTrace(item.message_id)}
                className="koc-heading-font text-left text-[16px] leading-tight text-[var(--foreground)] transition hover:text-[#2563eb]"
              >
                {item.title || fallbackTitle}
              </button>
            ) : (
              <h3 className="koc-heading-font text-[16px] leading-tight text-[var(--foreground)]">{item.title || fallbackTitle}</h3>
            )}
            {active && <span className="rounded-full bg-[#dbeafe] px-2 py-0.5 text-[11px] text-[#1d4ed8]">当前</span>}
          </div>
          {evidenceLabel && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[11px] ${evidenceClass}`}>
                {evidenceLabel}
              </span>
              {evidence?.limitations && (
                <span className="block max-w-full truncate text-[11px] text-[var(--muted-text)]">
                  {evidence.limitations}
                </span>
              )}
            </div>
          )}
          {hasContentPoints ? (
            <div className="mt-2 space-y-1.5">
              {contentPoints?.map((point, index) => (
                <button
                  key={point.id || point.memory_id || `${point.title}-${index}`}
                  type="button"
                  onClick={() => onTrace(point.message_id)}
                  className={`block w-full whitespace-normal break-words text-left text-[13px] leading-6 transition hover:text-[#2563eb] ${
                    point.active ? 'font-semibold text-[var(--foreground)]' : 'text-[var(--muted-text)]'
                  }`}
                >
                  {index + 1}. {point.title}
                </button>
              ))}
            </div>
          ) : summaryText ? (
            <button type="button" onClick={() => onTrace(item.message_id)} className="mt-2 block w-full truncate text-left text-[13px] leading-6 text-[var(--muted-text)] transition hover:text-[#2563eb]">
              {summaryText}
            </button>
          ) : (
            <p className="mt-2 text-[13px] leading-6 text-[var(--muted-text)]">{fallbackHint}</p>
          )}
        </div>
      </div>
    </section>
  );
}

function AgentQuestionBlocks({
  blocks,
  disabled,
  onSelect,
}: {
  blocks: AgentQuestionBlock[];
  disabled: boolean;
  onSelect: (block: AgentQuestionBlock) => void;
}) {
  if (!blocks.length) return null;
  return (
    <div className="mt-4 space-y-3">
      {blocks.map((block) => (
        <div key={block.id || block.question} className="rounded-[12px] border border-[#dbeafe] bg-[#f8fbff] px-3.5 py-3">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(block)}
            className="block w-full text-left text-[14px] font-semibold leading-6 text-[#1d4ed8] transition hover:text-[#1e40af] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {block.question}
          </button>
        </div>
      ))}
    </div>
  );
}
function OpeningBrandIntro() {
  return (
    <div className="koc-brand-intro" aria-hidden="true">
      <div className="koc-brand-intro-glow" />
      <svg className="koc-brand-intro-ribbon" viewBox="0 0 1440 900" preserveAspectRatio="none">
        <defs>
          <linearGradient id="kocIntroRibbonGradient" x1="22%" y1="72%" x2="96%" y2="20%">
            <stop offset="0%" stopColor="#eaf4ff" stopOpacity="0.18" />
            <stop offset="38%" stopColor="#b8dcff" stopOpacity="0.72" />
            <stop offset="68%" stopColor="#b8a8ff" stopOpacity="0.82" />
            <stop offset="100%" stopColor="#f2f7ff" stopOpacity="0.34" />
          </linearGradient>
          <filter id="kocIntroRibbonBlur" x="-18%" y="-28%" width="136%" height="156%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="1 0 0 0 0.28  0 1 0 0 0.48  0 0 1 0 0.95  0 0 0 1 0"
            />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#kocIntroRibbonBlur)" className="koc-brand-intro-ribbon-lines">
          <path d="M1500 166C1244 186 1114 314 954 421C736 566 527 524 301 692" />
          <path d="M1518 214C1270 238 1134 334 980 448C765 606 536 596 285 746" />
          <path d="M1488 114C1240 122 1085 274 921 384C720 519 535 470 316 628" />
          <path d="M1464 286C1230 288 1084 386 919 498C724 630 544 662 339 791" />
          <path d="M1510 72C1249 114 1145 242 990 336C790 457 620 418 388 574" />
        </g>
      </svg>
      <div className="koc-brand-intro-particles">
        {introRibbonParticles.map((particle, index) => {
          const style = {
            left: particle.left,
            top: particle.top,
            width: particle.size,
            height: particle.size,
            animationDelay: particle.delay,
            animationDuration: particle.duration,
            ['--intro-opacity' as '--intro-opacity']: String(particle.opacity),
            ['--intro-drift-x' as '--intro-drift-x']: particle.driftX,
            ['--intro-drift-y' as '--intro-drift-y']: particle.driftY,
          } as CSSProperties;

          return <span key={`intro-particle-${index}`} className={`koc-brand-intro-particle koc-brand-intro-particle-${particle.layer}`} style={style} />;
        })}
      </div>
      <div className="koc-brand-intro-logo">
        <span className="koc-brand-intro-logo-ribbon" />
        <span className="koc-title-font koc-brand-intro-logo-text">顶流养成计划</span>
      </div>
    </div>
  );
}

export default function Home() {
  const { status } = useAuth();
  const pageRef = useRef<HTMLDivElement>(null);
  const guideSectionRef = useRef<HTMLElement>(null);

  const modeLabel = status === 'loading' ? '状态确认中' : status === 'authenticated' ? '已登录' : '游客模式';

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;

    const revealItems = Array.from(page.querySelectorAll<HTMLElement>('[data-koc-reveal]'));
    if (!revealItems.length) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      revealItems.forEach((item) => item.classList.add('is-visible'));
      return;
    }

    const scrollRoot = page.closest('.koc-app-shell') as HTMLElement | null;
    let lastScrollTop = scrollRoot?.scrollTop ?? window.scrollY;
    let scrollDirection: 'down' | 'up' = 'down';
    let animationFrame = 0;

    const updateScrollDirection = () => {
      const nextScrollTop = scrollRoot?.scrollTop ?? window.scrollY;
      scrollDirection = nextScrollTop >= lastScrollTop ? 'down' : 'up';
      lastScrollTop = nextScrollTop;
    };

    const syncRevealItems = () => {
      const rootRect = scrollRoot?.getBoundingClientRect();
      const viewportTop = rootRect?.top ?? 0;
      const viewportBottom = rootRect?.bottom ?? window.innerHeight;
      const margin = Math.max(56, (viewportBottom - viewportTop) * 0.08);
      const visibleItems: HTMLElement[] = [];

      revealItems.forEach((item) => {
        const rect = item.getBoundingClientRect();
        const isVisible = rect.bottom > viewportTop + margin && rect.top < viewportBottom - margin;
        item.style.setProperty('--koc-reveal-y', scrollDirection === 'down' ? '30px' : '-30px');

        if (isVisible) {
          visibleItems.push(item);
        } else {
          item.classList.remove('is-visible');
        }
      });

      visibleItems
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        .forEach((item, index) => {
          item.style.setProperty('--koc-reveal-delay', `${index * 80}ms`);
          item.classList.add('is-visible');
        });
    };

    const scheduleSync = () => {
      updateScrollDirection();
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(syncRevealItems);
    };

    scrollRoot?.addEventListener('scroll', scheduleSync, { passive: true });
    if (!scrollRoot) window.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', scheduleSync);
    animationFrame = window.requestAnimationFrame(syncRevealItems);
    const initialSyncTimers = [
      window.setTimeout(syncRevealItems, 80),
      window.setTimeout(syncRevealItems, 320),
      window.setTimeout(syncRevealItems, 720),
    ];

    return () => {
      window.cancelAnimationFrame(animationFrame);
      initialSyncTimers.forEach((timer) => window.clearTimeout(timer));
      scrollRoot?.removeEventListener('scroll', scheduleSync);
      if (!scrollRoot) window.removeEventListener('scroll', scheduleSync);
      window.removeEventListener('resize', scheduleSync);
    };
  }, []);

  const scrollToGuide = () => {
    guideSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div ref={pageRef} className="relative flex min-h-full w-full flex-col overflow-x-hidden px-[4vw] pb-7 pt-4">
      <OpeningBrandIntro />
      <section className="relative mx-auto flex min-h-[52svh] w-full max-w-6xl flex-col">
        <header
          data-koc-reveal
          style={revealStyle(0)}
          className="koc-scroll-reveal mx-auto flex min-h-12 w-full max-w-3xl items-center justify-center gap-4 rounded-[16px] border border-[var(--box-border)] bg-white/90 px-4 py-2 shadow-[0_8px_24px_rgba(15,23,42,0.06)] backdrop-blur-sm"
        >
          <span className="koc-heading-font whitespace-nowrap text-[16px] text-[var(--foreground)]">顶流养成计划</span>
          <button
            type="button"
            onClick={scrollToGuide}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full border border-[#facc15] bg-[#fffbeb] transition hover:-translate-y-0.5 hover:bg-[#fef3c7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ca8a04]"
            aria-label="查看用户指南"
            title="用户指南"
          >
            <Image src="/koc-assets/icons/图标/灵光一闪.svg" alt="" width={24} height={24} className="size-6" />
          </button>
          <span className="rounded-full border border-[var(--box-border)] bg-[#f8fafc] px-3 py-1 text-[13px] text-[var(--muted-text)]">
            {modeLabel}
          </span>
        </header>

        <div className="flex flex-1 flex-col items-center pt-10 text-center sm:pt-12">
          <div data-koc-reveal style={revealStyle(90)} className="koc-scroll-reveal relative w-full max-w-[820px]">
            <div className="pointer-events-none absolute inset-0">
              {titleGlitters.map((particle) => {
                const style = {
                  left: particle.left,
                  top: particle.top,
                  width: particle.width,
                  height: particle.height,
                  animationDuration: particle.duration,
                  animationDelay: particle.delay,
                  opacity: particle.opacity,
                  ['--dx' as '--dx']: particle.dx,
                  ['--dy' as '--dy']: particle.dy,
                  ['--rotate' as '--rotate']: particle.rotate,
                } as CSSProperties;
                return <span key={`${particle.left}-${particle.top}-${particle.delay}`} className="koc-home-glitter" style={style} />;
              })}
            </div>
            <h1 className="flex w-full flex-col text-[60px] leading-[0.95] text-[var(--foreground)] sm:text-[86px] lg:text-[112px]">
              <span className="koc-title-font koc-rise-in self-start pl-[8%]">顶流</span>
              <span className="koc-title-font koc-rise-in koc-rise-delay-1 self-center sm:self-end sm:pr-[4%]">养成计划</span>
            </h1>
          </div>
          <div data-koc-reveal style={revealStyle(180)} className="koc-scroll-reveal">
            <p className="koc-rise-in koc-rise-delay-2 mt-7 text-[17px] leading-7 text-[var(--muted-text)] sm:text-[19px]">
              小猪梨为您打造心仪人设~
            </p>
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto mt-8 w-full max-w-6xl">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center">
          <div
            data-koc-reveal
            style={revealStyle(0)}
            className="koc-scroll-reveal relative min-h-[280px] overflow-hidden rounded-[28px] border border-[var(--box-border)] bg-white/70 p-6 shadow-[0_18px_44px_rgba(15,23,42,0.08)] backdrop-blur-md"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_26%_28%,rgba(96,165,250,0.15),transparent_40%),radial-gradient(circle_at_74%_72%,rgba(167,139,250,0.14),transparent_38%)]" />
            <div className="relative flex min-h-[232px] items-center justify-center">
              <div className="absolute right-10 top-10">
                <DemoBubble text="你好" className="koc-home-bubble-1" />
              </div>
              <div className="absolute bottom-4 left-6 flex items-end gap-3 sm:gap-4">
                <div className="relative h-[200px] w-[200px] sm:h-[228px] sm:w-[228px]">
                  <RobotMascot />
                </div>
                <DemoBubble text="你好呀~" className="koc-home-bubble-2 mb-8" />
              </div>
            </div>
          </div>

          <div data-koc-reveal style={revealStyle(110)} className="koc-scroll-reveal flex min-h-[280px] flex-col justify-center text-center">
            <h2 className="koc-heading-font text-[34px] leading-tight text-[var(--foreground)] sm:text-[44px]">
              Agent全新工作模式
            </h2>
            <p className="mt-3 text-[16px] leading-7 text-[var(--muted-text)] sm:text-[17px]">引导用户了解工作流程</p>
          </div>
        </div>
      </section>

      <section
        ref={guideSectionRef}
        className="mx-auto mt-16 w-full max-w-6xl scroll-mt-6 pb-12"
      >
        <div data-koc-reveal style={revealStyle(0)} className="koc-scroll-reveal text-center">
          <p className="koc-heading-font mt-3 text-[30px] leading-tight text-[var(--foreground)]">我们支持：</p>
        </div>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {guideItems.map((item, index) => (
            <div key={item.title} data-koc-reveal style={revealStyle(90 + index * 90)} className="koc-scroll-reveal">
              <FeatureGuideCard {...item} />
            </div>
          ))}
        </div>
        <div data-koc-reveal style={revealStyle(390)} className="koc-scroll-reveal">
          <Link
            href="/chat"
            className="koc-heading-font mx-auto mt-5 flex min-h-16 w-full max-w-md items-center justify-center gap-3 rounded-[16px] border border-[var(--box-border)] bg-white px-5 text-[20px] text-[var(--foreground)] shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:bg-[var(--nav-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
          >
            <Image src="/koc-assets/icons/图标/发送.svg" alt="" width={24} height={24} className="size-6" />
            <span>进入对话</span>
          </Link>
        </div>
      </section>

      <section className="mx-auto mt-2 w-full max-w-6xl pb-1">
        <div data-koc-reveal style={revealStyle(0)} className="koc-scroll-reveal text-center text-[12px] leading-6 text-[var(--muted-text)]">
          <p className="koc-heading-font text-[13px] leading-6 text-[var(--muted-text)]">当前产品边界</p>
          <ul className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            {productBoundaries.map((item) => (
              <li key={item} className="flex items-center gap-1.5">
                <span className="size-1 shrink-0 rounded-full bg-[var(--muted-text)] opacity-45" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
