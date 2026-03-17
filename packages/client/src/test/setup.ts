import '@testing-library/jest-dom';
import { vi, expect } from 'vitest';

// Tell React 18 that this is a test environment so act() warnings are suppressed.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

// jsdom does not implement MediaStream, MediaRecorder, navigator.mediaDevices —
// define them all before any test file imports components that reference them.

// Minimal MediaStream stub
class MockMediaStream {
  id = `mock-stream-${Math.random().toString(36).slice(2)}`;
  active = true;
  private tracks: MediaStreamTrack[] = [];
  getTracks() { return this.tracks; }
  getAudioTracks() { return []; }
  getVideoTracks() { return []; }
  addTrack = vi.fn();
  removeTrack = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
  dispatchEvent = vi.fn();
}

(global as any).MediaStream = MockMediaStream;

// Mock MediaDevices
Object.defineProperty(global.navigator, 'mediaDevices', {
  value: {
    getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream()),
    enumerateDevices: vi.fn().mockResolvedValue([]),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  configurable: true,
});

global.MediaRecorder = vi.fn().mockImplementation(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  ondataavailable: null,
  onerror: null,
  mimeType: 'video/webm',
  state: 'inactive',
})) as any;

// Stub canvas captureStream (used by GridView)
HTMLCanvasElement.prototype.captureStream = vi.fn().mockReturnValue(new MockMediaStream());

// jsdom does not implement ResizeObserver — stub it so VideoFeed / GridView can mount
(global as any).ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

