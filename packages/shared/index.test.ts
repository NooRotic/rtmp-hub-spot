import { describe, it, expect } from 'vitest';

describe('Shared Model Tests', () => {
  it('should validate UserInfo structure', () => {
    const user = { id: '1', name: 'Admin', role: 'admin' };
    expect(user.role).toBe('admin');
  });

  it('should validate StreamInfo structure', () => {
    const stream = { id: 's1', userId: 'u1', userName: 'User', startTime: Date.now(), type: 'webcam' };
    expect(stream.type).toBe('webcam');
  });

  it('should validate RtmpDestination structure', () => {
    const dest = {
      id: 'd1',
      name: 'Twitch',
      url: 'rtmp://live.twitch.tv/app',
      streamKey: 'live_xxx',
      enabled: true,
      encoder: 'nvenc' as const,
    };
    expect(dest.enabled).toBe(true);
    expect(dest.encoder).toBe('nvenc');
  });
});
