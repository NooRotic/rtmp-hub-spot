/**
 * The URL a participant opens to join the hub: the same app the admin is running,
 * but at the LAN IP instead of localhost. Port is taken from the admin's own
 * window.location so it's correct in dev (Vite 4443) and prod (Express 4001) alike.
 * Returns null when no LAN IP is known.
 */
export function clientJoinUrl(
  localIp: string | undefined | null,
  loc: { protocol: string; port: string },
): string | null {
  if (!localIp) return null;
  const port = loc.port ? `:${loc.port}` : '';
  return `${loc.protocol}//${localIp}${port}`;
}
