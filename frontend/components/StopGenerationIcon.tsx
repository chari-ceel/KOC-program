'use client';

export default function StopGenerationIcon({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block size-[18px] rounded-[3px] border border-[#DE868F] bg-[#DE868F] ${className}`.trim()}
    />
  );
}
