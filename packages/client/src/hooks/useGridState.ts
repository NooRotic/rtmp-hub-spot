import { useState, useCallback } from 'react';

/**
 * Composite-grid state for AdminApp.
 *
 * Owns the grid membership Set (`gridMembers`) plus all grid display/share toggles
 * extracted verbatim from AdminApp: `gridAutoLayout`, `spotlightId`, `previewOpen`,
 * `showGrid`, `gridStream`, `isGridShared`.
 *
 * `showGrid`'s initial value is `isElectron` (grid defaults ON for the Electron
 * host, OFF for the browser monitor), so the hook accepts `isElectron` as an arg.
 *
 * NOTE (Phase 1b — Decision Gate D1-B): `gridMembers` now GATES the composite
 * grid in AdminApp's `allStreams` memo. The local tile is included only when
 * `gridMembers.has('local')` (Settings "Include Admin"), and each synthetic feed
 * tile only when `gridMembers.has(feed.id)` (per-feed "Grid"); peers are always
 * included (default-in, no per-peer checkbox). The Set is still seeded with 'local'
 * and feeds auto-add on live, so the DEFAULT grid is visually identical to before —
 * only unchecking a membership checkbox now removes a tile.
 */
export function useGridState(isElectron: boolean): {
  gridMembers: Set<string>;
  addGridMember: (id: string) => void;
  removeGridMember: (id: string) => void;
  toggleGridMember: (id: string) => void;
  gridAutoLayout: boolean;
  setGridAutoLayout: (v: boolean) => void;
  spotlightId: string | null;
  setSpotlightId: React.Dispatch<React.SetStateAction<string | null>>;
  previewOpen: Set<string>;
  setPreviewOpen: React.Dispatch<React.SetStateAction<Set<string>>>;
  showGrid: boolean;
  setShowGrid: (v: boolean) => void;
  gridStream: MediaStream | null;
  setGridStream: (v: MediaStream | null) => void;
  isGridShared: boolean;
  setIsGridShared: (v: boolean) => void;
} {
  const [gridMembers, setGridMembers] = useState<Set<string>>(new Set(['local']));
  const [gridAutoLayout, setGridAutoLayout] = useState(true);
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState<Set<string>>(new Set());
  const [showGrid, setShowGrid] = useState<boolean>(isElectron); // Default ON for admin
  const [gridStream, setGridStream] = useState<MediaStream | null>(null);
  const [isGridShared, setIsGridShared] = useState<boolean>(false);

  const addGridMember = useCallback((id: string) => {
    setGridMembers(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const removeGridMember = useCallback((id: string) => {
    setGridMembers(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const toggleGridMember = useCallback((id: string) => {
    setGridMembers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return {
    gridMembers,
    addGridMember,
    removeGridMember,
    toggleGridMember,
    gridAutoLayout,
    setGridAutoLayout,
    spotlightId,
    setSpotlightId,
    previewOpen,
    setPreviewOpen,
    showGrid,
    setShowGrid,
    gridStream,
    setGridStream,
    isGridShared,
    setIsGridShared,
  };
}
