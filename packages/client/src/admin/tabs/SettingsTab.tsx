import type { CSSProperties } from 'react';
import { useAdminData } from '../AdminDataProvider';

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
  const { settings } = useAdminData();
  const { bitrate, setBitrate, preset, setPreset, hwAccel, setHwAccel, detectedEncoder } = settings;

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
    </div>
  );
}
