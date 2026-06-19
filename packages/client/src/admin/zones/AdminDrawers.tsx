import { SettingsDrawer } from '../drawers/SettingsDrawer';
import { NTDrawer } from '../../ui/NTDrawer';
import { RecordingsTab } from '../tabs/RecordingsTab';
import type { SyntheticFeed } from '../../hooks/useSyntheticFeeds';

/** Open/close state for the three drawers. */
export interface DrawerOpenState {
  settingsOpen: boolean;
  recOpen: boolean;
  addFeedOpen: boolean;
  onCloseSettings: () => void;
  onCloseRecordings: () => void;
  onCloseAddFeed: () => void;
}

/** Grid-options + System-Status block injected into the Settings drawer. */
export interface SettingsGridControls {
  isAdminMode: boolean;
  /** Whether 'local' is a grid member (the "Include Admin" checkbox). */
  includeAdmin: boolean;
  toggleGridMember: (id: string) => void;
  gridAutoLayout: boolean;
  setGridAutoLayout: (v: boolean) => void;
  showWatermark: boolean;
  setShowWatermark: (v: boolean) => void;
  watermarkPos: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  setWatermarkPos: (v: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right') => void;
  showSettingsOverlay: boolean;
  setShowSettingsOverlay: (v: boolean) => void;
  /** Derived: number of composite streams (drives the Virtual Cam line). */
  streamCount: number;
  /** Derived: active RTMP viewer count. */
  rtmpCount: number;
}

/** The Add-RTMP-Feed drawer's form fields + feed list controls. */
export interface FeedControls {
  newFeedKey: string;
  setNewFeedKey: (v: string) => void;
  newFeedLabel: string;
  setNewFeedLabel: (v: string) => void;
  addSyntheticFeed: () => void;
  removeSyntheticFeed: (id: string) => void;
  syntheticFeeds: SyntheticFeed[];
  /** Whether a given feed id is a grid member (the per-feed "Grid" checkbox). */
  isGridMember: (id: string) => boolean;
  toggleGridMember: (id: string) => void;
}

export interface AdminDrawersProps {
  drawers: DrawerOpenState;
  settingsControls: SettingsGridControls;
  feedControls: FeedControls;
}

/**
 * ZONE 4 — the three drawers: the SettingsDrawer (Grid Controls incl. Include-Admin
 * + Auto Layout + Watermark + Burn-in, and System Status), the Recordings NTDrawer,
 * and the Add-RTMP-Feed NTDrawer. Pure presentational extraction; markup verbatim.
 */
export function AdminDrawers({ drawers, settingsControls, feedControls }: AdminDrawersProps) {
  const {
    settingsOpen, recOpen, addFeedOpen,
    onCloseSettings, onCloseRecordings, onCloseAddFeed,
  } = drawers;
  const {
    isAdminMode, includeAdmin, toggleGridMember,
    gridAutoLayout, setGridAutoLayout,
    showWatermark, setShowWatermark,
    watermarkPos, setWatermarkPos,
    showSettingsOverlay, setShowSettingsOverlay,
    streamCount, rtmpCount,
  } = settingsControls;
  const {
    newFeedKey, setNewFeedKey,
    newFeedLabel, setNewFeedLabel,
    addSyntheticFeed, removeSyntheticFeed,
    syntheticFeeds, isGridMember, toggleGridMember: toggleFeedMember,
  } = feedControls;

  return (
    <>
      {/* ── ZONE 4: Drawers ── */}
      <SettingsDrawer open={settingsOpen} onClose={onCloseSettings} extra={
        <>
          {isAdminMode && (
            <>
              <h3 style={{ borderBottom: '1px solid var(--ntd-sh)', marginTop: '15px' }}>Grid Controls</h3>
              <div className="ntd-field" style={{ padding: '5px', fontSize: '10px' }}>
                <div style={{ marginBottom: '5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Include Admin:</span>
                  <input
                    type="checkbox"
                    checked={includeAdmin}
                    onChange={() => toggleGridMember('local')}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Auto Layout:</span>
                  <input
                    type="checkbox"
                    checked={gridAutoLayout}
                    onChange={(e) => setGridAutoLayout(e.target.checked)}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '5px' }}>
                  <span>Timestamp Watermark:</span>
                  <input
                    type="checkbox"
                    checked={showWatermark}
                    onChange={(e) => setShowWatermark(e.target.checked)}
                  />
                </div>
                {showWatermark && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '5px' }}>
                    <span>Watermark Pos:</span>
                    <select
                      value={watermarkPos}
                      onChange={(e) => setWatermarkPos(e.target.value as any)}
                      style={{ fontSize: '9px', padding: '1px' }}
                    >
                      <option value="top-left">Top Left</option>
                      <option value="top-right">Top Right</option>
                      <option value="bottom-left">Bottom Left</option>
                      <option value="bottom-right">Bottom Right</option>
                    </select>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '5px' }}>
                  <span>Burn-in Settings:</span>
                  <input
                    type="checkbox"
                    checked={showSettingsOverlay}
                    onChange={(e) => setShowSettingsOverlay(e.target.checked)}
                  />
                </div>
              </div>
            </>
          )}

          <h3 style={{ borderBottom: '1px solid var(--ntd-sh)', marginTop: '15px' }}>System Status</h3>
          <div className="ntd-field" style={{ marginBottom: '10px', fontSize: '10px' }}>
            <div><strong>NMS Server</strong>: Listening (1935/8000)</div>
            <div><strong>WebRTC Bridge</strong>: Ready</div>
            <div><strong>Virtual Cam</strong>: {streamCount > 0 ? 'Feeds Available' : 'No Input'}</div>
            <div><strong>Active RTMP</strong>: {rtmpCount || 0} Viewer(s)</div>
          </div>
        </>
      } />


      <NTDrawer open={recOpen} title="Recordings" onClose={onCloseRecordings}>
        <RecordingsTab />
      </NTDrawer>

      <NTDrawer open={addFeedOpen} title="Add RTMP Feed" onClose={onCloseAddFeed}>
        <div className="ntd-field" style={{ padding: '5px', fontSize: '10px', marginBottom: '10px' }}>
          <div style={{ marginBottom: '5px' }}>
            <input
              type="text"
              placeholder="Stream Key (e.g., guest1)"
              className="ntd-field"
              style={{ width: '100%', marginBottom: '2px', boxSizing: 'border-box' }}
              value={newFeedKey}
              onChange={(e) => setNewFeedKey(e.target.value)}
            />
            <input
              type="text"
              placeholder="Label (e.g., Guest Cam)"
              className="ntd-field"
              style={{ width: '100%', marginBottom: '5px', boxSizing: 'border-box' }}
              value={newFeedLabel}
              onChange={(e) => setNewFeedLabel(e.target.value)}
            />
            <button className="ntd-btn ntd-btn--go" style={{ width: '100%' }} onClick={addSyntheticFeed}>CONNECT EXT FEED</button>
          </div>

          {syntheticFeeds.length > 0 && (
            <div style={{ marginTop: '8px', borderTop: '1px solid var(--ntd-sh)', paddingTop: '6px' }}>
              {syntheticFeeds.map(f => (
                <div key={f.id} style={{ borderBottom: '1px solid var(--ntd-sh)', padding: '2px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ marginRight: '5px' }}>📡</span>
                    <span>{f.label}</span>
                    {f.stream ?
                      <span style={{ color: 'var(--ntd-live)', marginLeft: '5px', fontSize: '8px' }}>[LIVE]</span> :
                      <span style={{ color: 'var(--ntd-warn)', marginLeft: '5px', fontSize: '8px' }}>[FETCHING]</span>
                    }
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <label style={{ fontSize: '8px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={isGridMember(f.id)}
                        onChange={() => toggleFeedMember(f.id)}
                        style={{ margin: 0, verticalAlign: 'middle' }}
                      /> Grid
                    </label>
                    <button onClick={() => removeSyntheticFeed(f.id)} style={{ fontSize: '8px', background: '#ff000033', border: '1px solid var(--ntd-error)', color: 'var(--ntd-error)', cursor: 'pointer' }}>X</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </NTDrawer>
    </>
  );
}
