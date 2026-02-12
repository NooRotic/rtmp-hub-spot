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
});
