import { describe, it, expect } from 'vitest';
import { buildFfmpegArgs } from './ffmpeg-args.js';

// Characterization tests: pin the EXACT FFmpeg arguments the current pipe builds,
// so the upcoming Map<streamKey, Pipe> refactor (audit #1) can be proven to leave
// the encoder/audio/output flags unchanged.
const base = { bitrate: '2500k', preset: 'ultrafast', fps: 30, rtmpPort: 1935 };

describe('buildFfmpegArgs', () => {
  it('grid (canvas) software: full arg set with injected silent audio', () => {
    const a = buildFfmpegArgs({ ...base, streamKey: 'grid', hwAccel: 'none' });

    expect(a.accelFlags).toEqual([]);
    expect(a.inputOptions).toEqual([
      '-probesize 5000000',
      '-analyzeduration 500000',
      '-fflags nobuffer+igndts+genpts',
      '-flags low_delay',
      '-err_detect ignore_err',
    ]);
    expect(a.needsSilentAudio).toBe(true);
    expect(a.silentAudioInput).toBe('aevalsrc=0:channel_layout=stereo:sample_rate=44100');
    expect(a.audioOutputOptions).toEqual([
      '-map 0:v:0', '-map 1:a:0', '-c:a aac', '-b:a 32k', '-ac 2', '-ar 44100',
    ]);
    expect(a.outputOptions).toEqual([
      '-f flv',
      '-vcodec libx264', '-b:v 2500k', '-preset ultrafast', '-tune zerolatency',
      '-pix_fmt yuv420p', '-g 30', '-r 30', '-flush_packets 1',
      '-map 0:v:0', '-map 1:a:0', '-c:a aac', '-b:a 32k', '-ac 2', '-ar 44100',
    ]);
    expect(a.outputUrl).toBe('rtmp://localhost:1935/live/grid');
  });

  it('feed-* uses real AAC audio and NO injected silent source', () => {
    const a = buildFfmpegArgs({ ...base, streamKey: 'feed-alice', hwAccel: 'none' });

    expect(a.needsSilentAudio).toBe(false);
    expect(a.audioOutputOptions).toEqual(['-c:a aac', '-b:a 128k', '-ar 44100']);
    expect(a.audioOutputOptions).not.toContain('-map 1:a:0');
    expect(a.outputUrl).toBe('rtmp://localhost:1935/live/feed-alice');
  });

  it.each([
    ['nvidia', '-vcodec h264_nvenc', ['-hwaccel nvdec']],
    ['amd', '-vcodec h264_amf', []],
    ['intel', '-vcodec h264_qsv', []],
    ['none', '-vcodec libx264', []],
  ])('selects the %s encoder and accel flags', (hwAccel, codec, accelFlags) => {
    const a = buildFfmpegArgs({ ...base, streamKey: 'grid', hwAccel });
    expect(a.encoderOptions[0]).toBe(codec);
    expect(a.accelFlags).toEqual(accelFlags);
    // accel flags are folded into inputOptions
    accelFlags.forEach((f) => expect(a.inputOptions).toContain(f));
  });

  it('nvidia encoder uses low-latency NVENC flags', () => {
    const a = buildFfmpegArgs({ ...base, streamKey: 'grid', hwAccel: 'nvidia' });
    expect(a.encoderOptions).toEqual(['-vcodec h264_nvenc', '-b:v 2500k', '-preset:v p1', '-tune:v ll']);
  });

  it('threads bitrate, preset and fps through', () => {
    const a = buildFfmpegArgs({
      streamKey: 'grid', hwAccel: 'none', bitrate: '6000k', preset: 'fast', fps: 60, rtmpPort: 1935,
    });
    expect(a.encoderOptions).toContain('-b:v 6000k');
    expect(a.encoderOptions).toContain('-preset fast');
    expect(a.outputOptions).toContain('-r 60');
  });
});
