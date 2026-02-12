import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useMediaDevices } from './useMediaDevices';

describe('useMediaDevices Hook', () => {
  it('enumerates devices on mount', async () => {
    const mockDevices = [
      { kind: 'videoinput', label: 'Camera 1', deviceId: 'cam1' },
      { kind: 'audioinput', label: 'Mic 1', deviceId: 'mic1' },
    ];
    
    vi.stubGlobal('navigator', {
      mediaDevices: {
        enumerateDevices: vi.fn().mockResolvedValue(mockDevices),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    const { result } = renderHook(() => useMediaDevices());

    await waitFor(() => {
      expect(result.current.videoDevices).toHaveLength(1);
      expect(result.current.audioDevices).toHaveLength(1);
    });

    expect(result.current.videoDevices[0].label).toBe('Camera 1');
  });
});
