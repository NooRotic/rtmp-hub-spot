import { useState, useEffect, useRef } from 'react';
import mpegts from 'mpegts.js';
import { localFlvUrl } from '../components/RtmpPlayerTile';

export interface SyntheticFeed {
  id: string;
  streamKey: string;
  label: string;
  stream: MediaStream | null;
}

interface UseSyntheticFeedsArgs {
  /** Effect dep ONLY — never tear down players in cleanup on its account. */
  serverStatus: unknown;
  /** Called when a feed's mpegts player reaches 'playing' (was setGridMembers add). */
  onFeedLive: (id: string) => void;
  /** Called when a feed is manually removed (was setGridMembers delete). */
  onFeedRemoved: (id: string) => void;
}

/**
 * RTMP synthetic-feed ingest for AdminApp.
 *
 * Owns the `syntheticFeeds` list + the Add-Feed form fields (`newFeedKey`,
 * `newFeedLabel`) + the INTERNAL `feedPlayersRef` map (never returned), plus the
 * two effects extracted verbatim from AdminApp:
 *
 *  1. The `[syntheticFeeds, serverStatus]` effect that spins up an mpegts.js FLV
 *     player per feed and captureStream()s the playing video into a MediaStream.
 *  2. The unmount-only (`[]`) effect that tears every player + video element down.
 *
 * CRITICAL INVARIANTS (preserved exactly):
 *  (a) The `[syntheticFeeds, serverStatus]` effect's cleanup stays EMPTY — it
 *      fires on every serverStatus tick, so tearing down players there would churn
 *      live feeds every few seconds.
 *  (b) Teardown lives ONLY in the unmount-only effect (deps []).
 *  (c) The 'playing' handler uses the functional setSyntheticFeeds(prev => …).
 *  (d) The 'playing' handler calls onFeedLive(feed.id) (was setGridMembers add).
 *  (e) removeSyntheticFeed calls onFeedRemoved(id) (was setGridMembers delete).
 */
export function useSyntheticFeeds({ serverStatus, onFeedLive, onFeedRemoved }: UseSyntheticFeedsArgs): {
  syntheticFeeds: SyntheticFeed[];
  newFeedKey: string;
  setNewFeedKey: (v: string) => void;
  newFeedLabel: string;
  setNewFeedLabel: (v: string) => void;
  addSyntheticFeed: () => void;
  removeSyntheticFeed: (id: string) => void;
} {
  const [syntheticFeeds, setSyntheticFeeds] = useState<SyntheticFeed[]>([]);
  const [newFeedKey, setNewFeedKey] = useState('');
  const [newFeedLabel, setNewFeedLabel] = useState('');
  const feedPlayersRef = useRef<Map<string, { video: HTMLVideoElement, player: any }>>(new Map());

  /**
   * RTMP Synthetic Feed Effect
   *
   * Iterates over any user-defined `syntheticFeeds`.
   * If a feed doesn't have an active player, it injects an `mpegts.js` FLV player
   * pointing to the local Node Media Server HTTP-FLV egress.
   * Upon playback, it uses `.captureStream()` to turn the video into a standard MediaStream
   * and automatically adds it to the composite Grid.
   */
  useEffect(() => {
    syntheticFeeds.forEach(feed => {
      if (feed.stream || !feedPlayersRef.current) return;

      const pMap = feedPlayersRef.current;
      if (pMap.has(feed.id)) return;

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;

      if (mpegts.getFeatureList().mseLivePlayback) {
        const player = mpegts.createPlayer({
          type: 'flv',
          isLive: true,
          url: localFlvUrl(feed.streamKey) // local NMS over loopback (see localFlvUrl)
        });
        player.attachMediaElement(video);
        player.load();
        const playPromise = player.play() as Promise<void> | undefined;
        if (playPromise !== undefined) {
          playPromise.catch((e: any) => console.error('[Feeds] Autoplay error:', e));
        }

        pMap.set(feed.id, { video, player });

        video.addEventListener('playing', () => {
          if ((video as any).captureStream) {
            const stream = (video as any).captureStream();
            setSyntheticFeeds(prev => prev.map(f => f.id === feed.id ? { ...f, stream } : f));
            // Automatically add to grid upon playing
            onFeedLive(feed.id);
          }
        });
      }
    });

    return () => {
      // Per-feed players are torn down on manual removal; full teardown is the
      // unmount-only effect below (NOT here — this cleanup runs every serverStatus
      // tick, which would churn live feeds every few seconds).
    };
  }, [syntheticFeeds, serverStatus]);

  // Tear down all synthetic-feed mpegts players + video elements on UNMOUNT only.
  useEffect(() => {
    const pMap = feedPlayersRef.current;
    return () => {
      pMap?.forEach(({ player, video }) => {
        try { player?.destroy?.(); } catch (_) { /* noop */ }
        try { video?.remove?.(); } catch (_) { /* noop */ }
      });
      pMap?.clear();
    };
  }, []);

  const addSyntheticFeed = () => {
    if (!newFeedKey.trim()) return;
    const id = `rtmp-${Date.now()}`;
    setSyntheticFeeds(prev => [...prev, {
      id,
      streamKey: newFeedKey.trim(),
      label: newFeedLabel.trim() || newFeedKey.trim(),
      stream: null
    }]);
    setNewFeedKey('');
    setNewFeedLabel('');
  };

  const removeSyntheticFeed = (id: string) => {
    const pMap = feedPlayersRef.current;
    if (pMap && pMap.has(id)) {
      const { player, video } = pMap.get(id)!;
      player.destroy();
      video.srcObject = null;
      pMap.delete(id);
    }
    setSyntheticFeeds(prev => prev.filter(f => f.id !== id));
    onFeedRemoved(id);
  };

  return {
    syntheticFeeds,
    newFeedKey,
    setNewFeedKey,
    newFeedLabel,
    setNewFeedLabel,
    addSyntheticFeed,
    removeSyntheticFeed,
  };
}
