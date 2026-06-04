import { describe, it, expect } from 'vitest';
import { parseFfmpegProgress } from './ffmpeg-progress.js';

const LINE =
  'frame=  123 fps= 30 q=28.0 size=    456kB time=00:00:04.10 bitrate=2500.0kbits/s speed=1.0x';

describe('parseFfmpegProgress', () => {
  it('parses a standard progress line', () => {
    expect(parseFfmpegProgress(LINE)).toEqual({
      frame: 123,
      fps: 30,
      size: '456kB',
      time: '00:00:04.10',
      bitrate: '2500.0kbits/s',
      speed: 1.0,
      droppedFrames: undefined,
    });
  });

  it('captures drop= when present', () => {
    const dropping =
      'frame=  900 fps= 30 q=28.0 drop=7 size=  1024kB time=00:00:30.00 bitrate=2500.0kbits/s speed=0.97x';
    const p = parseFfmpegProgress(dropping);
    expect(p.droppedFrames).toBe(7);
    expect(p.speed).toBe(0.97);
  });

  it('returns null for a non-progress line', () => {
    expect(parseFfmpegProgress('Input #0, matroska,webm')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseFfmpegProgress(null)).toBeNull();
    expect(parseFfmpegProgress(undefined)).toBeNull();
  });

  it('reports droppedFrames: 0 (not undefined) when drop=0', () => {
    const line =
      'frame=  10 fps= 30 q=28.0 drop=0 size=   12kB time=00:00:00.33 bitrate=2500.0kbits/s speed=1.0x';
    expect(parseFfmpegProgress(line).droppedFrames).toBe(0);
  });
});
