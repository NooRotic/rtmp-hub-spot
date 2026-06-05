import type { DestinationBinding } from '../../../shared';

/** Minimal shape this helper needs from serverStatus (avoids importing the full type). */
export interface ServerStatusLike {
  rtmpPublishers?: { streamKey: string }[];
}

export interface SourceRow {
  sourceKey: string;
  isLive: boolean;
}

/**
 * Union of currently-publishing source keys and any source referenced by a binding
 * (spec §6). isLive = present in the publisher set right now. The union surfaces
 * pre-wired-but-offline sources alongside live ones.
 */
export function deriveSources(
  serverStatus: ServerStatusLike | null,
  bindings: DestinationBinding[],
): SourceRow[] {
  const live = new Set((serverStatus?.rtmpPublishers ?? []).map((p) => p.streamKey));
  const keys = new Set<string>([...live, ...bindings.map((b) => b.sourceKey)]);
  return [...keys].map((sourceKey) => ({ sourceKey, isLive: live.has(sourceKey) }));
}
