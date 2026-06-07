import { useState } from 'react';
import type { Platform, RtmpDestination } from '../../../../shared';
import { PLATFORMS, platformInfo } from '../platforms';
import { NTButton } from '../../ui/NTButton';

function newId(): string {
  const c = (globalThis as any).crypto;
  return c?.randomUUID ? c.randomUUID() : `dest-${Date.now()}-${Math.floor(performance.now())}`;
}

/** Add/edit an RTMP destination. `value` = edit mode (id preserved); absent = add mode. */
export function DestinationForm({
  value,
  onSubmit,
  onCancel,
}: {
  value?: RtmpDestination;
  onSubmit: (dest: RtmpDestination) => void;
  onCancel: () => void;
}) {
  const [platform, setPlatform] = useState<Platform>(value?.platform ?? 'youtube');
  const [name, setName] = useState(value?.name ?? '');
  const [url, setUrl] = useState(value?.url ?? platformInfo(value?.platform ?? 'youtube').ingestUrl);
  const [streamKey, setStreamKey] = useState(value?.streamKey ?? '');
  const [enabled, setEnabled] = useState(value?.enabled ?? true);
  const [priority, setPriority] = useState<string>(value?.priority != null ? String(value.priority) : '');

  const onPlatform = (p: Platform) => {
    setPlatform(p);
    const info = platformInfo(p);
    if (info.ingestUrl) setUrl(info.ingestUrl);
  };

  const submit = () => {
    if (!name.trim()) return; // name required
    const dest: RtmpDestination = {
      id: value?.id ?? newId(),
      name: name.trim(),
      platform,
      url: url.trim(),
      streamKey: streamKey.trim(),
      enabled,
      ...(priority.trim() ? { priority: Number(priority) } : {}),
    };
    onSubmit(dest);
  };

  return (
    <div className="ntd-destform">
      <label>Platform
        <select className="ntd-field" data-field="platform" value={platform} onChange={(e) => onPlatform(e.target.value as Platform)}>
          {PLATFORMS.map((p) => <option key={p} value={p}>{platformInfo(p).label}</option>)}
        </select>
      </label>
      <div className="ntd-destform__hint">{platformInfo(platform).hint}</div>
      <label>Name
        <input className="ntd-field" data-field="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main YouTube" />
      </label>
      <label>Ingest URL
        <input className="ntd-field" data-field="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="rtmp://…" />
      </label>
      <label>Stream Key
        <input className="ntd-field" data-field="streamKey" type="password" value={streamKey} onChange={(e) => setStreamKey(e.target.value)} placeholder="paste key" />
      </label>
      <label>Priority (optional)
        <input className="ntd-field" data-field="priority" value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="lower = sooner" />
      </label>
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" data-field="enabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Enabled
      </label>
      <div style={{ display: 'flex', gap: 6 }}>
        <NTButton go onClick={submit}>{value ? 'Update' : 'Add'}</NTButton>
        <NTButton onClick={onCancel}>Cancel</NTButton>
      </div>
    </div>
  );
}
