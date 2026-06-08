import { useState } from 'react';
import type { ConsoleSource } from './deriveConsoleSources';
import { StatusDot } from '../../ui/StatusDot';
import { CopyRouteField } from '../../ui/CopyRouteField';
import { RtmpPlayerTile } from '../../components/RtmpPlayerTile';
import { NTButton } from '../../ui/NTButton';

/**
 * One SOURCES-lane row for a single RTMP publisher: health dot + streamKey +
 * one-click copyable RTMP pull route (CopyRouteField) + viewer count + ▸expand
 * (inline preview player) + REC. Unifies the legacy "Active RTMP Links" +
 * "Live Publishers" + "RTMP Viewers" into one glance-able line.
 */
export function ConsoleSourceRow({
  source,
  serverLocalIP,
  isRecording,
  onStartRec,
  onStopRec,
}: {
  source: ConsoleSource;
  serverLocalIP?: string;
  isRecording: boolean;
  onStartRec: (k: string) => void;
  onStopRec: (k: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ntd-console__row" style={{ flexWrap: 'wrap' }}>
      <StatusDot state={source.health} />
      <code style={{ fontWeight: 'bold' }}>{source.streamKey}</code>
      {/* Effortless RTMP pull-route copy (loopback default, localhost⇄LAN toggle). */}
      <CopyRouteField streamKey={source.streamKey} lanIp={serverLocalIP} />
      <span style={{ color: 'var(--ntd-text-dim)', fontSize: 11 }}>
        ▸{source.viewers} viewer{source.viewers === 1 ? '' : 's'}
      </span>
      {source.bitrate > 0 && (
        <span style={{ color: 'var(--ntd-text-dim)', fontSize: 11 }}>
          {(source.bitrate / 1024 / 1024).toFixed(1)}Mbps
        </span>
      )}
      <NTButton onClick={() => setOpen(!open)} title="Expand preview">{open ? '▾' : '▸'}</NTButton>
      {isRecording ? (
        <NTButton onClick={() => onStopRec(source.streamKey)}>Stop Rec</NTButton>
      ) : (
        <NTButton onClick={() => onStartRec(source.streamKey)}>Rec</NTButton>
      )}
      {open && (
        <div style={{ flexBasis: '100%' }}>
          <RtmpPlayerTile streamKey={source.streamKey} />
        </div>
      )}
    </div>
  );
}
