import type { CSSProperties } from 'react';
import { useRef } from 'react';
import { useAdminData } from '../AdminDataProvider';
import { NTButton } from '../../ui/NTButton';

const BITRATES = [
  { value: '1500k', label: '1500k (Optimized)' },
  { value: '2500k', label: '2500k (Standard)' },
  { value: '5000k', label: '5000k (High Quality)' },
];
const PRESETS = [
  { value: 'ultrafast', label: 'Ultrafast (Low CPU)' },
  { value: 'superfast', label: 'Superfast' },
  { value: 'veryfast', label: 'Veryfast' },
  { value: 'faster', label: 'Faster' },
  { value: 'fast', label: 'Fast' },
  { value: 'medium', label: 'Medium (Better Quality)' },
];
const ENCODERS = [
  { value: 'none', label: 'Software (x264)' },
  { value: 'amd', label: 'AMD AMF' },
  { value: 'nvidia', label: 'NVIDIA NVENC' },
  { value: 'intel', label: 'Intel QSV' },
];
const sel: CSSProperties = { width: '100%' };

/** Dark-NT Broadcast Settings (spec §4 Settings tab). Behavior mirrors the legacy
 *  section; styling refined live. Option values are preserved exactly. */
export function SettingsTab() {
  const { settings, roomAccess } = useAdminData();
  const { bitrate, setBitrate, preset, setPreset, hwAccel, setHwAccel, detectedEncoder } = settings;
  const pinRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ padding: 6, background: 'var(--ntd-face-2)', border: '1px solid var(--ntd-sh)' }}>
        <strong>GPU Detection: </strong>
        {detectedEncoder ? (
          <span>{detectedEncoder.best !== 'none' ? '● HW ACCEL' : '○ SOFTWARE'} — best: <strong>{detectedEncoder.bestLabel}</strong></span>
        ) : (
          <span style={{ color: 'var(--ntd-text-dim)' }}>SCANNING…</span>
        )}
      </div>

      <label>Target Bitrate
        <select className="ntd-field" data-field="bitrate" style={sel} value={bitrate} onChange={(e) => setBitrate(e.target.value)}>
          {BITRATES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      <label>FFmpeg Preset
        <select className="ntd-field" data-field="preset" style={sel} value={preset} onChange={(e) => setPreset(e.target.value)}>
          {PRESETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>

      <label>Encoder Accel
        <select className="ntd-field" data-field="hwAccel" style={sel} value={hwAccel} onChange={(e) => setHwAccel(e.target.value)}>
          {ENCODERS.map((o) => {
            const detected = detectedEncoder?.best === o.value;
            const available = o.value === 'none' || !detectedEncoder || detectedEncoder.available.includes(o.value);
            return (
              <option key={o.value} value={o.value}>
                {o.label}{detected ? ' ★ Auto-detected' : ''}{o.value !== 'none' && !available && detectedEncoder ? ' (not found)' : ''}
              </option>
            );
          })}
        </select>
        {detectedEncoder && hwAccel !== detectedEncoder.best && (
          <div style={{ color: 'var(--ntd-warn)', fontSize: 11 }}>⚠ Override active. Auto-detected: {detectedEncoder.bestLabel}</div>
        )}
      </label>

      <div style={{ padding: 8, background: 'var(--ntd-face-2)', border: '1px solid var(--ntd-sh)' }}>
        <strong>Room Access</strong>
        <div style={{ marginTop: 6, marginBottom: 6, fontSize: 12, color: 'var(--ntd-text-dim)' }}>
          Participants must enter this PIN to join. The host (this app) is always exempt.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span title={roomAccess.locked ? 'Room locked — PIN required' : 'Room open'}>
            {roomAccess.locked ? '🔒' : '🔓'}
          </span>
          <span style={{ fontSize: 12 }}>{roomAccess.locked ? 'Locked — PIN required' : 'Open — no PIN'}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            ref={pinRef}
            className="ntd-field"
            data-field="room-pin-set"
            type="password"
            placeholder="Enter PIN"
            style={{ flex: 1 }}
          />
          <NTButton
            go
            onClick={() => {
              const v = (pinRef.current?.value ?? '').trim();
              if (!v) return; // empty = use Clear, not Set
              roomAccess.setPin(v);
              if (pinRef.current) pinRef.current.value = ''; // don't leave the PIN sitting in the field
            }}
          >
            Set PIN
          </NTButton>
          <NTButton onClick={() => roomAccess.clearPin()}>
            Clear
          </NTButton>
        </div>
      </div>

      <div style={{ marginTop: 12, padding: 8, background: 'var(--ntd-face-2)', border: '1px solid var(--ntd-sh)', opacity: 0.85 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="ntd-badge" style={{ background: 'var(--ntd-warn)', color: '#000' }}>PRO</span>
          <strong>Per-destination watermark</strong>
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, color: 'var(--ntd-text-dim)' }}>
          <input type="checkbox" data-field="pro-watermark" disabled checked={false} readOnly /> Add a custom logo/text overlay per destination
        </label>
        <div style={{ color: 'var(--ntd-text-dim)', fontSize: 11, marginTop: 4 }}>
          Requires re-encode (decode → overlay → encode). Available in Pro — upgrade to unlock.
        </div>
      </div>
    </div>
  );
}
