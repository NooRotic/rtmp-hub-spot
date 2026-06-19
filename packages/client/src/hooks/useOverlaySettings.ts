import { useState } from 'react';

export type WatermarkPos = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Grid overlay settings — watermark toggle + position, and the burn-in settings
 * overlay toggle. Self-contained UI state extracted verbatim from AdminApp's
 * inline `showWatermark`/`watermarkPos`/`showSettingsOverlay` useState trio.
 */
export function useOverlaySettings(): {
  showWatermark: boolean;
  setShowWatermark: (v: boolean) => void;
  watermarkPos: WatermarkPos;
  setWatermarkPos: (v: WatermarkPos) => void;
  showSettingsOverlay: boolean;
  setShowSettingsOverlay: (v: boolean) => void;
} {
  const [showWatermark, setShowWatermark] = useState<boolean>(false);
  const [watermarkPos, setWatermarkPos] = useState<WatermarkPos>('bottom-right');
  const [showSettingsOverlay, setShowSettingsOverlay] = useState<boolean>(false);

  return {
    showWatermark,
    setShowWatermark,
    watermarkPos,
    setWatermarkPos,
    showSettingsOverlay,
    setShowSettingsOverlay,
  };
}
