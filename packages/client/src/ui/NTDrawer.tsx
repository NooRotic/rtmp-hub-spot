import type { ReactNode } from 'react';

/** Dark-NT slide-in drawer. Renders nothing when `open` is false. */
export function NTDrawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="ntd ntd-drawer" role="dialog" aria-label={title}>
      <div className="ntd-drawer__head">
        <span>{title}</span>
        <button className="ntd-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="ntd-drawer__body">{children}</div>
    </div>
  );
}
