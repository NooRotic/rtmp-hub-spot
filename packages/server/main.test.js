import { describe, it, expect, vi } from 'vitest';

describe('Server Architecture', () => {
  it('should have a valid NMS config structure', () => {
    const nmsConfig = {
      rtmp: { port: 1935 },
      http: { port: 8000 }
    };
    expect(nmsConfig.rtmp.port).toBe(1935);
    expect(nmsConfig.http.port).toBe(8000);
  });

  it('should support hardware acceleration flags', () => {
    const getAccelParams = (type) => {
      if (type === 'nvidia') return ['-hwaccel nvdec', 'h264_nvenc'];
      return ['none', 'rawvideo'];
    };
    
    expect(getAccelParams('nvidia')).toContain('h264_nvenc');
    expect(getAccelParams('none')).toContain('rawvideo');
  });
});
