import VideoFeed from '../../components/VideoFeed';
import GridView from '../../components/GridView';
import { StageTileControls } from '../stage/StageTileControls';

/** A connected mesh peer (subset of useWebRTC's peer shape used by the stage). */
interface StagePeer {
  id: string;
  name: string;
  stream?: MediaStream;
}

/** Camera/mic device selection — the two `<select>`s at the top of the stage. */
export interface StageDeviceControls {
  videoDevices: MediaDeviceInfo[];
  audioDevices: MediaDeviceInfo[];
  selectedVideo: string;
  setSelectedVideo: (id: string) => void;
  selectedAudio: string;
  setSelectedAudio: (id: string) => void;
}

/** Electron broadcast button cluster state (admin cam / grid view / grid share). */
export interface StageBroadcastControls {
  adminCamActive: boolean;
  setAdminCamActive: (v: boolean) => void;
  showGrid: boolean;
  setShowGrid: (v: boolean) => void;
  isGridShared: boolean;
  setIsGridShared: (v: boolean) => void;
}

/** Local self-feed + camera-error state surfaced on the stage. */
export interface StageSelfFeed {
  cameraError: string | null;
  userStream: MediaStream | null;
  isVideoEnabled: boolean;
  setIsVideoEnabled: (v: boolean) => void;
  isAudioEnabled: boolean;
  setIsAudioEnabled: (v: boolean) => void;
  serverLocalIP?: string;
}

/** Peer tile list + the spotlight/kick controls overlaid on each peer. */
export interface StagePeerControls {
  peers: StagePeer[];
  spotlightId: string | null;
  setSpotlightId: React.Dispatch<React.SetStateAction<string | null>>;
  kickUser: (id: string) => void;
}

/** The composite GridView block (rendered when showGrid && allStreams.length > 0). */
export interface StageGridControls {
  allStreams: { id: string; stream: MediaStream | undefined; label: string }[];
  setGridStream: (v: MediaStream | null) => void;
  broadcastBitrate: string;
  broadcastPreset: string;
  hwAccel: string;
  gridAutoLayout: boolean;
  showWatermark: boolean;
  watermarkPos: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  showSettingsOverlay: boolean;
}

export interface StageZoneProps {
  isElectron: boolean;
  isAdminMode: boolean;
  deviceControls: StageDeviceControls;
  broadcastControls: StageBroadcastControls;
  selfFeed: StageSelfFeed;
  peerControls: StagePeerControls;
  gridControls: StageGridControls;
}

/**
 * ZONE 2 — the Stage "window": camera/mic selects, the Electron broadcast
 * controls vs the browser MONITOR MODE banner, the camera-error alert, the self
 * VideoFeed, the peers.map VideoFeed + StageTileControls, and the GridView block.
 *
 * Pure presentational extraction from AdminApp — markup/styles/handlers verbatim.
 * AdminApp still owns all hooks/state and passes it down via the grouped props.
 */
export function StageZone({
  isElectron,
  isAdminMode,
  deviceControls,
  broadcastControls,
  selfFeed,
  peerControls,
  gridControls,
}: StageZoneProps) {
  const { videoDevices, audioDevices, selectedVideo, setSelectedVideo, selectedAudio, setSelectedAudio } = deviceControls;
  const { adminCamActive, setAdminCamActive, showGrid, setShowGrid, isGridShared, setIsGridShared } = broadcastControls;
  const { cameraError, userStream, isVideoEnabled, setIsVideoEnabled, isAudioEnabled, setIsAudioEnabled, serverLocalIP } = selfFeed;
  const { peers, spotlightId, setSpotlightId, kickUser } = peerControls;
  const {
    allStreams, setGridStream,
    broadcastBitrate, broadcastPreset, hwAccel,
    gridAutoLayout, showWatermark, watermarkPos, showSettingsOverlay,
  } = gridControls;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
      <div className="window ntd">
        <div className="window-title">
          <span>{isElectron ? 'Admin Video Hub' : 'Admin Monitor'}</span>
        </div>
        <div className="window-content">
          <div className="inset-field" style={{ marginBottom: '15px' }}>
            <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 auto', minWidth: '120px' }}>
                <label>Camera: </label>
                <select className="ntd-field" style={{ width: '100%', boxSizing: 'border-box' }} value={selectedVideo} onChange={(e) => setSelectedVideo(e.target.value)}>
                  <option value="">{isElectron ? 'Off' : 'Default Camera'}</option>
                  {videoDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
                </select>
              </div>
              <div style={{ flex: '1 1 auto', minWidth: '120px' }}>
                <label>Mic: </label>
                <select className="ntd-field" style={{ width: '100%', boxSizing: 'border-box' }} value={selectedAudio} onChange={(e) => setSelectedAudio(e.target.value)}>
                  <option value="">{isElectron ? 'Off' : 'Default Mic'}</option>
                  {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
                </select>
              </div>
            </div>
            {isElectron ? (
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  className="ntd-btn"
                  onClick={() => setAdminCamActive(!adminCamActive)}
                  style={{ padding: '2px 20px', backgroundColor: adminCamActive ? 'var(--ntd-error)' : 'var(--ntd-go)' }}
                >
                  {adminCamActive ? 'STOP ADMIN CAMERA' : 'START ADMIN CAMERA'}
                </button>
                <button
                  className="ntd-btn"
                  onClick={() => setShowGrid(!showGrid)}
                  style={{ padding: '2px 20px', backgroundColor: showGrid ? 'var(--ntd-go)' : 'var(--ntd-face-2)' }}
                >
                  {showGrid ? 'DISABLE GRID VIEW' : 'ENABLE GRID VIEW'}
                </button>
                <button
                  className="ntd-btn"
                  onClick={() => setIsGridShared(!isGridShared)}
                  style={{ padding: '2px 20px', backgroundColor: isGridShared ? 'var(--ntd-error)' : 'var(--ntd-go)' }}
                >
                  {isGridShared ? 'STOP SHARING GRID' : 'SHARE GRID TO ALL'}
                </button>
                <span style={{ fontSize: '10px', color: 'var(--ntd-text-dim)' }}> (Visible to all connected clients)</span>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0' }}>
                <span style={{ background: 'var(--ntd-navy-b)', color: '#fff', padding: '3px 10px', fontFamily: 'monospace', fontSize: '10px', letterSpacing: '1px' }}>
                  ◈ MONITOR MODE
                </span>
                <span style={{ fontSize: '10px', color: 'var(--ntd-text-dim)' }}>
                  Connected as Admin Monitor. Broadcast controls require the Electron app.
                </span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {cameraError && !userStream && (
              <div role="alert" style={{
                flex: '1 1 100%', display: 'flex', alignItems: 'center', gap: '14px',
                padding: '16px 18px', background: 'var(--ntd-face-2)',
                border: '2px solid var(--ntd-error)', color: 'var(--ntd-text)',
              }}>
                <span aria-hidden style={{ fontSize: '30px', lineHeight: 1, color: 'var(--ntd-error)' }}>⚠</span>
                <div>
                  <div style={{ fontWeight: 'bold', color: 'var(--ntd-error)', letterSpacing: '1px' }}>CAMERA UNAVAILABLE</div>
                  <div style={{ fontSize: '12px', marginTop: '3px' }}>{cameraError}</div>
                </div>
              </div>
            )}
            {userStream && (
              <VideoFeed
                stream={userStream}
                label="Admin Hub"
                isLocal
                isVideoEnabled={isVideoEnabled}
                setIsVideoEnabled={setIsVideoEnabled}
                isAudioEnabled={isAudioEnabled}
                setIsAudioEnabled={setIsAudioEnabled}
                serverLocalIP={serverLocalIP}
                defaultHwAccel={hwAccel}
              />
            )}
            {peers.map((peer) => (
              <div key={peer.id} style={{ position: 'relative' }}>
                <VideoFeed stream={peer.stream} label={peer.name || `User ${peer.id.slice(0, 4)}`} serverLocalIP={serverLocalIP} defaultHwAccel={hwAccel} />
                {isAdminMode && (
                  <div style={{ position: 'absolute', top: 4, right: 4, zIndex: 2 }}>
                    <StageTileControls
                      peerId={peer.id}
                      isHost={isElectron}
                      spotlighted={spotlightId === peer.id}
                      onSpotlight={(id) => setSpotlightId(prev => prev === id ? null : id)}
                      onKick={kickUser}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {showGrid && allStreams.length > 0 && (
            <GridView
              streams={allStreams}
              onStreamUpdate={setGridStream}
              broadcastSettings={{
                bitrate: broadcastBitrate,
                preset: broadcastPreset,
                hwAccel: hwAccel
              }}
              autoLayout={gridAutoLayout}
              showWatermark={showWatermark}
              watermarkPos={watermarkPos}
              showSettingsOverlay={showSettingsOverlay}
              serverLocalIP={serverLocalIP}
              spotlightId={spotlightId ?? undefined}
            />
          )}

        </div>
      </div>
    </div>
  );
}
