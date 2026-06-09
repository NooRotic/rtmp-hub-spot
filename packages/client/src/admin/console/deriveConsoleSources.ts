export interface ConsoleSource {
  streamKey: string;
  active: boolean;
  viewers: number;
  bitrate: number;
  health: 'live' | 'warn' | 'idle';
}

/**
 * Build per-source rows from serverStatus: publishers ⋈ viewers (RTMP play
 * sessions whose `path` matches the publisher's streamKey). The server emits
 * session paths as `/live/{streamKey}` (see main.js postPlay → getSessionData),
 * so we match on `/{key}` (and fall back to a bare-key includes for safety).
 * `health: 'live'` for any active publisher is fine for v1 — a future task can
 * add ⚠ (warn) detection from bitrate/fps thresholds.
 */
export function deriveConsoleSources(
  serverStatus:
    | {
        rtmpPublishers?: { streamKey: string; uptime?: number }[];
        rtmpSessions?: { path?: string; bitrate?: number }[];
      }
    | null
    | undefined,
): ConsoleSource[] {
  const pubs = serverStatus?.rtmpPublishers ?? [];
  const sessions = serverStatus?.rtmpSessions ?? [];
  return pubs.map((p) => {
    const mine = sessions.filter(
      (s) => (s.path || '').includes(`/${p.streamKey}`) || (s.path || '').includes(p.streamKey),
    );
    const bitrate = mine.reduce((a, s) => a + (s.bitrate ?? 0), 0);
    return { streamKey: p.streamKey, active: true, viewers: mine.length, bitrate, health: 'live' as const };
  });
}
