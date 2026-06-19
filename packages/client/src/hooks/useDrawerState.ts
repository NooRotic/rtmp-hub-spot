import { useState } from 'react';

/**
 * Drawer open-state for the three AdminApp drawers (Settings, Recordings,
 * Add-Feed). Pure UI state with zero coupling to the rest of the app — extracted
 * verbatim from AdminApp's inline `settingsOpen`/`recOpen`/`addFeedOpen` useState
 * trio plus their open/close handlers.
 */
export function useDrawerState(): {
  settingsOpen: boolean;
  recOpen: boolean;
  addFeedOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  setRecOpen: (open: boolean) => void;
  setAddFeedOpen: (open: boolean) => void;
  openSettings: () => void;
  closeSettings: () => void;
  openRecordings: () => void;
  closeRecordings: () => void;
  openAddFeed: () => void;
  closeAddFeed: () => void;
} {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [addFeedOpen, setAddFeedOpen] = useState(false);

  return {
    settingsOpen,
    recOpen,
    addFeedOpen,
    setSettingsOpen,
    setRecOpen,
    setAddFeedOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    openRecordings: () => setRecOpen(true),
    closeRecordings: () => setRecOpen(false),
    openAddFeed: () => setAddFeedOpen(true),
    closeAddFeed: () => setAddFeedOpen(false),
  };
}
