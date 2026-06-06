import { useAdminData } from '../AdminDataProvider';
import { StatusTag } from '../../ui/StatusTag';
import { NTButton } from '../../ui/NTButton';
import { RtmpPlayerTile } from '../../components/RtmpPlayerTile';

/** Dark-NT Live operating view (spec §4): FFmpeg health + Live Publishers + RTMP Viewers.
 *  Behavior mirrors the legacy sidebar sections; styling refined live. */
export function LiveTab() {
  const { ffmpeg, serverStatus, recordings, previewOpen, setPreviewOpen, refreshTelemetry } = useAdminData();
  const publishers = serverStatus?.rtmpPublishers ?? [];
  const sessions = serverStatus?.rtmpSessions ?? [];
  const isRecording = (key: string) => recordings.active.some((r) => r.streamKey === key);
  const togglePreview = (key: string) =>
    setPreviewOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* FFmpeg pipeline health */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <strong>FFmpeg Pipeline</strong>
          <StatusTag state={ffmpeg.status.state} label={ffmpeg.status.state.toUpperCase()} />
        </div>
        {ffmpeg.status.state === 'running' && ffmpeg.stats ? (
          <code style={{ color: 'var(--ntd-text-dim)' }}>
            {ffmpeg.stats.fps}fps · {ffmpeg.stats.bitrate} · {ffmpeg.stats.speed}x · {ffmpeg.stats.time}
          </code>
        ) : (
          <span style={{ color: 'var(--ntd-text-dim)' }}>{ffmpeg.status.message ?? 'No active broadcast.'}</span>
        )}
      </section>

      {/* Live Publishers */}
      <section>
        <strong>Live Publishers</strong>
        {publishers.length === 0 ? (
          <div style={{ color: 'var(--ntd-text-dim)' }}>No publishers.</div>
        ) : (
          publishers.map((p) => (
            <div key={p.streamKey} style={{ borderTop: '1px solid var(--ntd-sh)', paddingTop: 4, marginTop: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <code style={{ fontWeight: 'bold' }}>{p.streamKey}</code>
                <span style={{ display: 'inline-flex', gap: 4 }}>
                  <NTButton onClick={() => togglePreview(p.streamKey)}>{previewOpen.has(p.streamKey) ? 'Hide' : 'Preview'}</NTButton>
                  {isRecording(p.streamKey)
                    ? <NTButton onClick={() => recordings.stop(p.streamKey)}>Stop Rec</NTButton>
                    : <NTButton onClick={() => recordings.start(p.streamKey)}>Rec</NTButton>}
                </span>
              </div>
              {previewOpen.has(p.streamKey) && <RtmpPlayerTile streamKey={p.streamKey} />}
            </div>
          ))
        )}
      </section>

      {/* RTMP Viewers */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <strong>RTMP Viewers</strong>
          <NTButton onClick={refreshTelemetry}>Refresh</NTButton>
        </div>
        {sessions.length === 0 ? (
          <div style={{ color: 'var(--ntd-text-dim)' }}>No viewers.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 11 }}>
            <thead><tr><th style={{ textAlign: 'left' }}>IP</th><th style={{ textAlign: 'left' }}>Path</th><th style={{ textAlign: 'left' }}>Uptime</th></tr></thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={s.id ?? i}><td>{s.ip ?? 'Unknown'}</td><td>{s.path ?? 'Unknown'}</td><td>{s.uptime ?? 0}s</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
