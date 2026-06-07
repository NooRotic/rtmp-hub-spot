import { useRef, useEffect } from 'react';
import mpegts from 'mpegts.js';

// The admin renderer is always co-located with NMS, which binds 0.0.0.0:8000 by
// default — so it plays its OWN local NMS back over LOOPBACK. Using serverStatus.local
// (the LAN IP) here was wrong: it's CSP-blocked (connect-src only allows loopback
// http) and pointless. The LAN address is for SHARING routes to other devices — a
// separate concern. 127.0.0.1 (not "localhost") matches NMS's IPv4 0.0.0.0 bind exactly.
export const localFlvUrl = (streamKey: string) => `http://127.0.0.1:8000/live/${streamKey}.flv`;

/**
 * Inline RTMP preview player using mpegts.js for a single publisher stream.
 * Self-contained: attaches/destroys its own mpegts instance. Always plays the
 * local NMS over loopback (see localFlvUrl).
 */
export const RtmpPlayerTile = ({ streamKey }: { streamKey: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!videoRef.current || !mpegts.getFeatureList().mseLivePlayback) return;
    const player = mpegts.createPlayer({ type: 'flv', isLive: true, url: localFlvUrl(streamKey) });
    player.attachMediaElement(videoRef.current);
    player.load();
    void (player.play() as unknown as Promise<void>)?.catch(() => {});
    return () => { try { player.destroy(); } catch (_) {} };
  }, [streamKey]);
  return <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', maxHeight: '120px', background: '#000', display: 'block', marginTop: '4px' }} />;
};
