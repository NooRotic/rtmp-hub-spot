import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Beveled dark-NT button. `go` = green primary variant (used for copy actions). */
export function NTButton({
  go,
  children,
  className,
  ...rest
}: { go?: boolean; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`ntd-btn${go ? ' ntd-btn--go' : ''}${className ? ` ${className}` : ''}`} {...rest}>
      {children}
    </button>
  );
}
