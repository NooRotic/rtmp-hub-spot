import type { ReactNode } from 'react';

/** Dark-NT beveled window with an optional navy title bar. */
export function NTWindow({
  title,
  children,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`ntd-window${className ? ` ${className}` : ''}`}>
      {title != null && <div className="ntd-window__title">{title}</div>}
      <div className="ntd-window__body">{children}</div>
    </div>
  );
}
