import { useState } from 'react';
import type { RtmpDestination } from '../../../../shared';
import { useAdminData } from '../AdminDataProvider';
import { relayKey } from '../../hooks/useRelays';
import { platformInfo } from '../platforms';
import { maskKey } from '../maskKey';
import { NTButton } from '../../ui/NTButton';
import { StatusTag } from '../../ui/StatusTag';
import { DestinationForm } from './DestinationForm';

/** Destinations tab (spec §4/§8): manage the destination library + bind to sources w/ live relay status. */
export function DestinationsTab() {
  const { destinations, bindings, relays, sources, destinationActions } = useAdminData();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RtmpDestination | null>(null);

  const isBound = (sourceKey: string, destId: string) =>
    bindings.some((b) => b.sourceKey === sourceKey && b.destinationId === destId && b.active);

  const openAdd = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (d: RtmpDestination) => { setEditing(d); setFormOpen(true); };
  const submit = async (dest: RtmpDestination) => {
    if (editing) await destinationActions.update(dest);
    else await destinationActions.add(dest);
    setFormOpen(false); setEditing(null);
  };
  const toggleBind = (sourceKey: string, destId: string, bound: boolean) => {
    if (bound) destinationActions.removeBinding(sourceKey, destId);
    else destinationActions.setBinding({ sourceKey, destinationId: destId, active: true });
  };

  return (
    <div>
      {formOpen ? (
        <DestinationForm value={editing ?? undefined} onSubmit={submit} onCancel={() => { setFormOpen(false); setEditing(null); }} />
      ) : (
        <NTButton go onClick={openAdd}>＋ Add destination</NTButton>
      )}

      <div style={{ marginTop: 10 }}>
        {destinations.length === 0 ? (
          <div style={{ color: 'var(--ntd-text-dim)' }}>No destinations yet — add your first.</div>
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
                  <input type="checkbox" data-field={`dest-enabled-${d.id}`} checked={d.enabled} onChange={() => destinationActions.update({ ...d, enabled: !d.enabled })} /> on
                </label>
                <NTButton onClick={() => openEdit(d)}>Edit</NTButton>
                <NTButton onClick={() => destinationActions.remove(d.id)}>Remove</NTButton>
              </span>
            </div>
          ))
        )}
      </div>

      {destinations.length > 0 && sources.length > 0 && (
        <div className="ntd-bindgrid">
          <h4 style={{ margin: '12px 0 4px' }}>Routing</h4>
          {sources.map((s) => (
            <div key={s.sourceKey} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <StatusTag state={s.isLive ? 'live' : 'idle'} label={s.sourceKey} />
              </div>
              {destinations.map((d) => {
                const bound = isBound(s.sourceKey, d.id);
                const relayState = relays.get(relayKey(s.sourceKey, d.id))?.state ?? 'idle';
                return (
                  <div key={d.id} className="ntd-bindrow">
                    <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                      <input type="checkbox" data-field={`bind-${s.sourceKey}-${d.id}`} checked={bound} disabled={!d.enabled} onChange={() => toggleBind(s.sourceKey, d.id, bound)} />
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
  );
}
