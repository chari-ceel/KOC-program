'use client';

import Image from 'next/image';
import { useState, type InputHTMLAttributes } from 'react';

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export default function PasswordField({ className = '', disabled, ...props }: PasswordFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const rawValue = props.value ?? props.defaultValue ?? '';
  const hasValue = String(rawValue).length > 0;
  const inputClassName = [className, hasValue ? 'pr-16' : ''].filter(Boolean).join(' ');

  return (
    <div className="relative w-full">
      <input
        {...props}
        disabled={disabled}
        type={isVisible && hasValue ? 'text' : 'password'}
        className={inputClassName}
      />
      {hasValue && (
        <button
          type="button"
          onClick={() => setIsVisible((current) => !current)}
          disabled={disabled}
          className="absolute right-5 top-1/2 grid size-7 -translate-y-1/2 place-items-center transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={isVisible ? '隐藏密码' : '显示密码'}
          title={isVisible ? '隐藏密码' : '显示密码'}
        >
          <Image
            src={isVisible ? '/koc-assets/icons/图标/小眼睛开.svg' : '/koc-assets/icons/图标/小眼睛闭.svg'}
            alt=""
            aria-hidden="true"
            width={22}
            height={22}
            className="size-[22px]"
          />
        </button>
      )}
    </div>
  );
}
