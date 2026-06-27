import { useState } from 'react';
import type { RtmpDestination } from '../../../../shared';
import { useAdminActions, useAdminTelemetry } from '../AdminDataProvider';
import { relayKey } from '../../hooks/useRelays';
import { StatusTag } from '../../ui/StatusTag';
import { NTButton } from '../../ui/NTButton';
import { DestinationForm } from '../tabs/DestinationForm';
import { platformInfo } from '../platforms';
import { maskKey } from '../maskKey';
import { deriveConsoleSources } from './deriveConsoleSources';
import { ConsoleSourceRow } from './ConsoleSourceRow';

/** Persistent broadcast dock: FFmpeg health chip + SOURCES lane + OUTPUTS (restream) lane. */
export function BroadcastConsole() {
  const { ffmpeg, sources, relays, serverStatus, recordings } = useAdminTelemetry();
  const { destinations, bindings, destinationActions } = useAdminActions();
  const consoleSources = deriveConsoleSources(serverStatus);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RtmpDestination | null>(null);

  const isBound = (sourceKey: string, destId: string) =>
    bindings.some((b) => b.sourceKey === sourceKey && b.destinationId === destId && b.active);

  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (d: RtmpDestination) => { setEditing(d); setFormOpen(true); };
  const submit = async (dest: RtmpDestination) => {
    if (editing) await destinationActions.update(dest);
    else await destinationActions.add(dest);
    setFormOpen(false);
    setEditing(null);
  };
  const toggleBind = (sourceKey: string, destId: string, bound: boolean) => {
    if (bound) destinationActions.removeBinding(sourceKey, destId);
    else destinationActions.setBinding({ sourceKey, destinationId: destId, active: true });
  };

  const { state, streamKey: sk, message } = ffmpeg.status;
  const stats = ffmpeg.stats;

  return (
    <div className="ntd ntd-console">
      {/* ── Head: FFmpeg health chip ─────────────────────────────────────── */}
      <div className="ntd-console__head">
        <strong>Broadcast</strong>
        <span>
          FFmpeg{' '}
          <StatusTag state={state} label={state.toUpperCase()} />
          {state === 'running' && stats
            ? ` ${stats.fps}fps · ${stats.bitrate}`
            : sk
            ? ` (${sk})`
            : ''}
        </span>
      </div>

      {/* ── Sticky failure banner: keep the real cause on screen instead of
            silently flipping the chip back to idle. ───────────────────────── */}
      {state === 'error' && (
        <div
          role="alert"
          data-testid="broadcast-error-banner"
          style={{
            backgroundColor: '#3a0000',
            color: '#ffb4b4',
            border: '1px solid #c0392b',
            borderRadius: 3,
            padding: '4px 8px',
            margin: '4px 0',
            fontSize: 11,
            fontWeight: 'bold',
          }}
        >
          ⚠ Broadcast failed{sk ? ` (${sk})` : ''}: {message || 'ffmpeg pipe error — see main.log for the ffmpeg stderr tail.'}
        </div>
      )}

      {/* ── SOURCES lane (one line per RTMP publisher) ──────────────────── */}
      <div className="ntd-console__lane">
        <span className="ntd-console__lane-label">SOURCES</span>
        {consoleSources.length === 0 ? (
          <div style={{ color: 'var(--ntd-text-dim)', fontSize: 11 }}>
            No live sources — start a publisher to broadcast.
          </div>
        ) : (
          consoleSources.map((src) => (
            <ConsoleSourceRow
              key={src.streamKey}
              source={src}
              serverLocalIP={serverStatus?.local}
              isRecording={recordings.active.some((r) => r.streamKey === src.streamKey)}
              onStartRec={recordings.start}
              onStopRec={recordings.stop}
            />
          ))
        )}
      </div>


      {/* ── OUTPUTS lane (destination library + routing + add form) ──────── */}
      <div className="ntd-console__lane">
        <span className="ntd-console__lane-label">OUTPUTS</span>

        {/* Destination library rows */}
        {formOpen ? (
          <DestinationForm
            value={editing ?? undefined}
            onSubmit={submit}
            onCancel={() => { setFormOpen(false); setEditing(null); }}
          />
        ) : (
          <NTButton go onClick={openAdd}>＋ Add destination</NTButton>
        )}

        <div style={{ marginTop: 4 }}>
          {destinations.length === 0 ? (
            <div style={{ color: 'var(--ntd-text-dim)', fontSize: 11 }}>
              No destinations yet — add your first.
            </div>
          ) : (
            destinations.map((d) => (
              <div key={d.id} className="ntd-destrow">
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                  <span className="ntd-badge">{platformInfo(d.platform).label.toUpperCase()}</span>
                  <strong>{d.name}</strong>
                  <code className="ntd-destrow__key">{maskKey(d.streamKey)}</code>
                </span>
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 11 }}>
                    <input
                      type="checkbox"
                      data-field={`dest-enabled-${d.id}`}
                      checked={d.enabled}
                      onChange={() => destinationActions.update({ ...d, enabled: !d.enabled })}
                    />
                    {' '}on
                  </label>
                  <NTButton onClick={() => openEdit(d)}>Edit</NTButton>
                  <NTButton onClick={() => destinationActions.remove(d.id)}>Remove</NTButton>
                </span>
              </div>
            ))
          )}
        </div>

        {/* Routing: per-source binding rows with relay StatusTag */}
        {destinations.length > 0 && sources.length > 0 && (
          <div className="ntd-bindgrid">
            <div style={{ fontSize: 10, fontWeight: 'bold', letterSpacing: 1, color: 'var(--ntd-text-dim)', margin: '6px 0 3px' }}>
              ROUTING
            </div>
            {sources.map((s) => (
              <div key={s.sourceKey} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                  <StatusTag state={s.isLive ? 'live' : 'idle'} label={s.sourceKey} />
                </div>
                {destinations.map((d) => {
                  const bound = isBound(s.sourceKey, d.id);
                  const relayState = relays.get(relayKey(s.sourceKey, d.id))?.state ?? 'idle';
                  return (
                    <div key={d.id} className="ntd-bindrow">
                      <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          data-field={`bind-${s.sourceKey}-${d.id}`}
                          checked={bound}
                          disabled={!d.enabled && !bound}
                          onChange={() => toggleBind(s.sourceKey, d.id, bound)}
                        />
                        {d.name}
                      </label>
                      {bound && <StatusTag state={relayState} label={relayState.toUpperCase()} />}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
