/**
 * useMediaDevices hook tests.
 * Uses the same custom renderHook as useWebRTC.test.ts to avoid the
 * dual-React-instance issue with @testing-library/react.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { useMediaDevices } from './useMediaDevices';

function renderHook<T>(fn: () => T): { result: { current: T } } {
  const result = { current: undefined as unknown as T };
  function TestComponent() {
    result.current = fn();
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(createElement(TestComponent)); });
  return { result };
}

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

    // Flush the resolved enumerateDevices promise + React state update
    await act(async () => {});

    expect(result.current.videoDevices).toHaveLength(1);
    expect(result.current.audioDevices).toHaveLength(1);
    expect(result.current.videoDevices[0].label).toBe('Camera 1');
  });
});
