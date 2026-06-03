import { describe, it, expect } from 'vitest';
import { buildRelayArgs } from './relay-args.js';

describe('buildRelayArgs', () => {
  const destination = {
    id: 'd1',
    url: 'rtmp://a.rtmp.youtube.com/live2',
    streamKey: 'abcd-efgh',
  };

  it('pulls from local NMS and copies to the destination', () => {
    const a = buildRelayArgs({ sourceKey: 'grid', destination, rtmpPort: 1935 });
    expect(a.inputUrl).toBe('rtmp://localhost:1935/live/grid');
    expect(a.outputUrl).toBe('rtmp://a.rtmp.youtube.com/live2/abcd-efgh');
    expect(a.outputOptions).toContain('-c copy');
    expect(a.outputOptions).toContain('-f flv');
  });

  it('joins url + streamKey with a single slash even if url has a trailing slash', () => {
    const a = buildRelayArgs({
      sourceKey: 'feed-x',
      destination: { ...destination, url: 'rtmp://a.rtmp.youtube.com/live2/' },
      rtmpPort: 1935,
    });
    expect(a.outputUrl).toBe('rtmp://a.rtmp.youtube.com/live2/abcd-efgh');
  });
});
