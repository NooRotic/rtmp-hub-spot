import type { ReactNode } from 'react';
import { NTDrawer } from '../../ui/NTDrawer';
import { SettingsTab } from '../tabs/SettingsTab';

/** Settings drawer — broadcast quality + Pro + Room Access (via SettingsTab),
 *  plus an `extra` slot for grid-options/System-Status injected by AdminApp later. */
export function SettingsDrawer({ open, onClose, extra }: { open: boolean; onClose: () => void; extra?: ReactNode }) {
  return (
    <NTDrawer open={open} title="Settings" onClose={onClose}>
      <SettingsTab />
      {extra}
    </NTDrawer>
  );
}
