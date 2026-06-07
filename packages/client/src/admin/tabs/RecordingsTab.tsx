import { useAdminData } from '../AdminDataProvider';
import { NTButton } from '../../ui/NTButton';

/** Dark-NT Active Recordings panel (spec §4 Recordings tab). Behavior mirrors the
 *  legacy sidebar section; styling refined live. */
export function RecordingsTab() {
  const { recordings } = useAdminData();
  const { active, now, stop, openDir } = recordings;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong>{active.length > 0 ? `Recording (${active.length})` : 'Recordings'}</strong>
        <NTButton onClick={openDir}>Folder</NTButton>
      </div>
      {active.length === 0 ? (
        <div style={{ color: 'var(--ntd-text-dim)' }}>No active recordings. Use REC on a Live source.</div>
      ) : (
        active.map((rec) => {
          const elapsed = Math.floor((now - rec.startTime) / 1000);
          const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
          const ss = String(elapsed % 60).padStart(2, '0');
          const filename = rec.path.split(/[/\\]/).pop() || rec.path;
          return (
            <div key={rec.streamKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 5, padding: '4px 6px', background: 'var(--ntd-face-2)', border: '1px solid var(--ntd-error)' }}>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <code style={{ color: 'var(--ntd-error)', fontWeight: 'bold' }}>{rec.streamKey}</code>
                <code style={{ background: 'var(--ntd-error)', color: '#fff', padding: '0 4px' }}>{mm}:{ss}</code>
                <span title={rec.path} style={{ color: 'var(--ntd-text-dim)', fontSize: 11 }}>{filename}</span>
              </span>
              <NTButton onClick={() => stop(rec.streamKey)}>Stop</NTButton>
            </div>
          );
        })
      )}
    </div>
  );
}
