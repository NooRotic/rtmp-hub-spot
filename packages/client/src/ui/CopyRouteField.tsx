import { useState } from 'react';
import { NTButton } from './NTButton';

/** `rtmp://{host}:{port}/live/{streamKey}` — the hub's RTMP ingest route. */
export function buildRouteUrl(host: string, streamKey: string, port = 1935): string {
  return `rtmp://${host}:${port}/live/${streamKey}`;
}

type HostMode = 'local' | 'lan';

/**
 * One-click copy of the hub's RTMP ingest route (spec D3/§6). `local` resolves to
 * loopback (OBS on this machine); `lan` resolves to the provided LAN IP (a device
 * on the network). Shows a transient "copied!" confirmation.
 */
export function CopyRouteField({
  streamKey,
  lanIp,
  port = 1935,
}: {
  streamKey: string;
  lanIp?: string;
  port?: number;
}) {
  const [mode, setMode] = useState<HostMode>('local');
  const [copied, setCopied] = useState(false);

  const host = mode === 'lan' ? lanIp || '127.0.0.1' : '127.0.0.1';
  const url = buildRouteUrl(host, streamKey, port);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — no-op; the URL is selectable for manual copy */
    }
  };

  return (
    <span className="ntd-copy">
      <code className="ntd-copy__url">{url}</code>
      <NTButton go onClick={copy}>Copy</NTButton>
      {lanIp && (
        <button
          className="ntd-copy__toggle"
          onClick={() => setMode((m) => (m === 'local' ? 'lan' : 'local'))}
        >
          {mode === 'local' ? 'use LAN' : 'use localhost'}
        </button>
      )}
      {copied && <span className="ntd-copy__copied">copied!</span>}
    </span>
  );
}
