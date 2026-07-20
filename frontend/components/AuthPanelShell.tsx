'use client';

import type { ReactNode } from 'react';

export default function AuthPanelShell({
  children,
  title,
  maxWidthClassName = 'max-w-[620px]',
  bodyClassName = 'px-10 py-10 sm:px-14',
  titleClassName = 'text-[34px]',
  role = 'dialog',
  ariaModal = true,
  ariaLabelledBy,
  titleId,
}: {
  children: ReactNode;
  title: ReactNode;
  maxWidthClassName?: string;
  bodyClassName?: string;
  titleClassName?: string;
  role?: 'dialog' | 'alertdialog';
  ariaModal?: boolean;
  ariaLabelledBy?: string;
  titleId?: string;
}) {
  return (
    <section
      className={`koc-auth-ambient-background relative w-full ${maxWidthClassName} rounded-[18px] border border-[var(--box-border)] shadow-[var(--box-shadow)] ${bodyClassName}`.trim()}
      role={role}
      aria-modal={ariaModal}
      aria-labelledby={ariaLabelledBy}
    >
      <div className="mx-auto max-w-[520px] text-center">
        <h2 id={titleId || ariaLabelledBy} className={`koc-title-font whitespace-nowrap leading-none text-[var(--title-blue)] ${titleClassName}`.trim()}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}
