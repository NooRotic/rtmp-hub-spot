/**
 * Turn a human camera label into a safe RTMP stream-key segment.
 * RTMP paths and relay keys are derived from this, so it must produce only
 * [a-z0-9-] with no leading/trailing or doubled dashes.
 */
export function slugifyStreamKey(label: string): string {
  return (
    label
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '') // strip accents
      .replace(/[^a-z0-9]+/g, '-') // any run of non-alphanumerics -> one dash
      .replace(/^-+|-+$/g, '') // trim dashes
    || 'feed'
  );
}

/** The per-feed stream key, e.g. feed-mobile-rotic-camera-2-facing-back. */
export function feedKey(label: string): string {
  return `feed-${slugifyStreamKey(label)}`;
}
