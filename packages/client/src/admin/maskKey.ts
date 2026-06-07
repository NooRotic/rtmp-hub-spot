/** Mask a stream key for display: dots for all but the last 4 chars. */
export function maskKey(streamKey: string): string {
  if (!streamKey) return '';
  if (streamKey.length <= 4) return '•'.repeat(streamKey.length);
  return '•'.repeat(streamKey.length - 4) + streamKey.slice(-4);
}
