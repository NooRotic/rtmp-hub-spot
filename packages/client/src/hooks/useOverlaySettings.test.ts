import { describe, it, expect, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook, cleanup } from '../test/testUtils';
import { useOverlaySettings } from './useOverlaySettings';

afterEach(cleanup);

describe('useOverlaySettings', () => {
  it('defaults: watermark off, pos bottom-right, settings overlay off', () => {
    const { result } = renderHook(() => useOverlaySettings());
    expect(result.current.showWatermark).toBe(false);
    expect(result.current.watermarkPos).toBe('bottom-right');
    expect(result.current.showSettingsOverlay).toBe(false);
  });

  it('toggles watermark and burn-in settings independently', () => {
    const { result } = renderHook(() => useOverlaySettings());

    act(() => { result.current.setShowWatermark(true); });
    expect(result.current.showWatermark).toBe(true);
    expect(result.current.showSettingsOverlay).toBe(false);

    act(() => { result.current.setShowSettingsOverlay(true); });
    expect(result.current.showSettingsOverlay).toBe(true);
    expect(result.current.showWatermark).toBe(true);
  });

  it('updates the watermark position', () => {
    const { result } = renderHook(() => useOverlaySettings());
    act(() => { result.current.setWatermarkPos('top-left'); });
    expect(result.current.watermarkPos).toBe('top-left');
    act(() => { result.current.setWatermarkPos('top-right'); });
    expect(result.current.watermarkPos).toBe('top-right');
  });
});
