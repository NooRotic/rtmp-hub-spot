import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useMediaDevices } from './hooks/useMediaDevices';
import { usePersistence } from './hooks/usePersistence';
import { useElectronBridge } from './hooks/useElectronBridge';
import { useFfmpegPipeline } from './hooks/useFfmpegPipeline';
import { useRecordings } from './hooks/useRecordings';
import { useBroadcastSettings } from './hooks/useBroadcastSettings';
import { useRelays } from './hooks/useRelays';
import { useDestinations } from './hooks/useDestinations';
import { useRoomPin } from './hooks/useRoomPin';
import { deriveSources } from './admin/sources';
import { AdminDataProvider, type AdminData } from './admin/AdminDataProvider';
import { AdminTopBar } from './admin/AdminTopBar';
import { SettingsDrawer } from './admin/drawers/SettingsDrawer';
import { ChatDrawer } from './admin/drawers/ChatDrawer';
import { useChatUnread } from './admin/hooks/useChatUnread';
import { BroadcastConsole } from './admin/console/BroadcastConsole';
import { StageTileControls } from './admin/stage/StageTileControls';
import { RecordingsTab } from './admin/tabs/RecordingsTab';
import { NTDrawer } from './ui/NTDrawer';
import VideoFeed from './components/VideoFeed';
import GridView from './components/GridView';
import mpegts from 'mpegts.js';
import { localFlvUrl } from './components/RtmpPlayerTile';

/**
 * The Host/Admin dashboard — either Electron (full broadcast console) or a
 * browser with ?role=admin (monitor-only). Participants are handled by ClientPortal.
 *
 * Responsibilities:
 * - Local hardware state (Camera, Mic)
 * - P2P Mesh Network orchestration via `useWebRTC`
 * - Synthetic Feed ingest (RTMP-to-WebRTC overlays via `mpegts.js`)
 * - Global Grid compositing state (`gridMembers`)
 *
 * @returns {JSX.Element} The rendered React Application.
 */
function AdminApp() {
  const { isElectron, ipc } = useElectronBridge();

  /** True when running in admin capacity — either Electron or browser with ?role=admin query param. */
  const isAdminMode = useMemo(() => {
    if (isElectron) return true;
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('role') === 'admin';
  }, [isElectron]);

  // Zone open-state (drawers)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [addFeedOpen, setAddFeedOpen] = useState(false);

  // Grid management state
  const [gridMembers, setGridMembers] = useState<Set<string>>(new Set(['local']));
  const [gridAutoLayout, setGridAutoLayout] = useState(true);
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState<Set<string>>(new Set());

  const toggleGridMember = (id: string) => {
    setGridMembers(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const [selectedVideo, setSelectedVideo] = useState<string>(localStorage.getItem('hub-video-device') || '');
  const [selectedAudio, setSelectedAudio] = useState<string>(localStorage.getItem('hub-audio-device') || '');
  const [userName] = useState<string>(() => {
    if (isElectron) return 'Admin';
    if (isAdminMode) return 'Admin Monitor';
    return localStorage.getItem('hub-username') || '';
  });
  const [adminCamActive, setAdminCamActive] = useState<boolean>(false);
  const [showGrid, setShowGrid] = useState<boolean>(isElectron); // Default ON for admin
  const [gridStream, setGridStream] = useState<MediaStream | null>(null);
  const [isGridShared, setIsGridShared] = useState<boolean>(false);

  const {
    bitrate: broadcastBitrate, setBitrate: setBroadcastBitrate,
    preset: broadcastPreset, setPreset: setBroadcastPreset,
    hwAccel, setHwAccel,
    detectedEncoder,
  } = useBroadcastSettings(ipc);

  const { locked: roomLocked, setPin: setRoomPin, clearPin: clearRoomPin } = useRoomPin(ipc);

  // Host token — minted by the Electron main process at startup and delivered
  // via IPC. Sent in join-room so the PIN gate can trust the Electron host
  // without relying on socket address (which the Vite proxy collapses to
  // 127.0.0.1, defeating the old loopback-based exemption).
  const [hostToken, setHostToken] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (ipc) ipc.invoke('get-host-token').then((t: string) => setHostToken(t)).catch(() => {});
  }, [ipc]);

  const { relays } = useRelays(ipc);
  const {
    destinations,
    bindings,
    addDestination,
    updateDestination,
    removeDestination,
    setBinding,
    removeBinding,
    refresh: refreshDestinations,
  } = useDestinations(ipc);

  const { status: ffmpegStatus, stats: ffmpegStats } = useFfmpegPipeline(ipc);

  // Grid Overlay Settings
  const [showWatermark, setShowWatermark] = useState<boolean>(false);
  const [watermarkPos, setWatermarkPos] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('bottom-right');
  const [showSettingsOverlay, setShowSettingsOverlay] = useState<boolean>(false);

  // RTMP Feed Cameras
  const [syntheticFeeds, setSyntheticFeeds] = useState<{ id: string, streamKey: string, label: string, stream: MediaStream | null }[]>([]);
  const [newFeedKey, setNewFeedKey] = useState('');
  const [newFeedLabel, setNewFeedLabel] = useState('');
  const feedPlayersRef = useRef<Map<string, { video: HTMLVideoElement, player: any }>>(new Map());

  usePersistence(selectedVideo, selectedAudio);

  const { videoDevices, audioDevices } = useMediaDevices();

  const currentVideoDevice = videoDevices.find(d => d.deviceId === selectedVideo);
  const cameraLabel = currentVideoDevice?.label || (isElectron ? 'Admin Hub' : 'Default Camera');
  const broadcastLabel = isGridShared ? 'Composite Grid' : cameraLabel;

  const { serverStatus, isConnected, socketStatus, peers, userStream, cameraError, isVideoEnabled, setIsVideoEnabled, isAudioEnabled, setIsAudioEnabled, chatMessages, sendMessage, connect, recordingStopped, kickUser } = useWebRTC('main-hub', {
    videoId: adminCamActive ? selectedVideo : undefined,
    audioId: adminCamActive ? selectedAudio : undefined,
    userName: userName,
    cameraLabel: broadcastLabel,
    captureVideo: adminCamActive,
    overrideStream: isGridShared ? gridStream : null,
    hostToken,
  });

  const { activeRecordings, recNow, startRecording, stopRecording, openRecordingsDir } = useRecordings(ipc, recordingStopped);

  const { open: chatOpen, setOpen: setChatOpen, unread: chatUnread } = useChatUnread(chatMessages.length);

  // Browser admin monitor auto-connect. Electron auto-connects via the useWebRTC hook itself.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isElectron && isAdminMode && !isConnected) {
      connect();
    }
  }, [isAdminMode, isElectron, isConnected]);

  const refreshTelemetry = useCallback(() => {
    if (ipc) {
      ipc.send('telemetry-refresh');
    }
  }, [ipc]);

  useEffect(() => {
    if (isElectron && ipc) {
      const interval = setInterval(() => {
        refreshTelemetry();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [isElectron, ipc]);

  /**
   * RTMP Synthetic Feed Effect
   *
   * Iterates over any user-defined `syntheticFeeds`.
   * If a feed doesn't have an active player, it injects an `mpegts.js` FLV player
   * pointing to the local Node Media Server HTTP-FLV egress.
   * Upon playback, it uses `.captureStream()` to turn the video into a standard MediaStream
   * and automatically adds it to the composite Grid.
   */
  useEffect(() => {
    syntheticFeeds.forEach(feed => {
      if (feed.stream || !feedPlayersRef.current) return;

      const pMap = feedPlayersRef.current;
      if (pMap.has(feed.id)) return;

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;

      if (mpegts.getFeatureList().mseLivePlayback) {
        const player = mpegts.createPlayer({
          type: 'flv',
          isLive: true,
          url: localFlvUrl(feed.streamKey) // local NMS over loopback (see localFlvUrl)
        });
        player.attachMediaElement(video);
        player.load();
        const playPromise = player.play() as Promise<void> | undefined;
        if (playPromise !== undefined) {
          playPromise.catch((e: any) => console.error('[Feeds] Autoplay error:', e));
        }

        pMap.set(feed.id, { video, player });

        video.addEventListener('playing', () => {
          if ((video as any).captureStream) {
            const stream = (video as any).captureStream();
            setSyntheticFeeds(prev => prev.map(f => f.id === feed.id ? { ...f, stream } : f));
            // Automatically add to grid upon playing
            setGridMembers(prev => {
              const next = new Set(prev);
              next.add(feed.id);
              return next;
            });
          }
        });
      }
    });

    return () => {
      // Cleanup happens upon manual removal
    };
  }, [syntheticFeeds, serverStatus]);

  const addSyntheticFeed = () => {
    if (!newFeedKey.trim()) return;
    const id = `rtmp-${Date.now()}`;
    setSyntheticFeeds(prev => [...prev, {
      id,
      streamKey: newFeedKey.trim(),
      label: newFeedLabel.trim() || newFeedKey.trim(),
      stream: null
    }]);
    setNewFeedKey('');
    setNewFeedLabel('');
  };

  const removeSyntheticFeed = (id: string) => {
    const pMap = feedPlayersRef.current;
    if (pMap && pMap.has(id)) {
      const { player, video } = pMap.get(id)!;
      player.destroy();
      video.srcObject = null;
      pMap.delete(id);
    }
    setSyntheticFeeds(prev => prev.filter(f => f.id !== id));
    setGridMembers(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // NOTE: every connected peer appears in the grid (intended). `allStreams` is the
  // single source for GridView — there is no per-peer grid-membership filter.
  const allStreams = useMemo(() => [
    ...(userStream && (adminCamActive || isGridShared) ? [{
      id: 'local',
      stream: userStream,
      label: `Admin Hub - ${broadcastLabel}`
    }] : []),
    ...peers.filter(p => p.stream).map(p => ({
      id: p.id,
      stream: p.stream as MediaStream,
      label: p.name
    })),
    ...syntheticFeeds.filter(f => f.stream).map(f => ({
      id: f.id,
      stream: f.stream as MediaStream,
      label: `[Feed] ${f.label}`
    }))
  ], [userStream, adminCamActive, isGridShared, broadcastLabel, peers, syntheticFeeds]);

  const adminData: AdminData = useMemo(() => ({
    socketStatus,
    isConnected,
    serverStatus: (serverStatus ?? null) as AdminData['serverStatus'],
    sources: deriveSources(serverStatus ?? null, bindings),
    relays,
    destinations,
    bindings,
    ffmpeg: { status: ffmpegStatus, stats: ffmpegStats },
    recordings: { active: activeRecordings, now: recNow, start: startRecording, stop: stopRecording, openDir: openRecordingsDir },
    settings: {
      bitrate: broadcastBitrate, setBitrate: setBroadcastBitrate,
      preset: broadcastPreset, setPreset: setBroadcastPreset,
      hwAccel, setHwAccel, detectedEncoder,
    },
    destinationActions: {
      add: addDestination, update: updateDestination, remove: removeDestination,
      setBinding, removeBinding, refresh: refreshDestinations,
    },
    roomAccess: { locked: roomLocked, setPin: setRoomPin, clearPin: clearRoomPin },
    previewOpen,
    setPreviewOpen,
    refreshTelemetry,
  }), [
    socketStatus, isConnected, serverStatus, bindings, relays, destinations,
    ffmpegStatus, ffmpegStats, activeRecordings, recNow,
    startRecording, stopRecording, openRecordingsDir,
    broadcastBitrate, setBroadcastBitrate, broadcastPreset, setBroadcastPreset, hwAccel, setHwAccel, detectedEncoder,
    addDestination, updateDestination, removeDestination, setBinding, removeBinding, refreshDestinations,
    roomLocked, setRoomPin, clearRoomPin,
    previewOpen, setPreviewOpen, refreshTelemetry,
  ]);

  return (
    <AdminDataProvider value={adminData}>
    <div className="ntd" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Draggable Title Bar (Electron Only) */}
      {isElectron && (
        <div className="app-title-bar ntd">
          <div className="app-title-text">
            <div style={{ width: '16px', height: '16px', backgroundColor: '#000080', border: '1px solid #fff' }}></div>
            <span>RTMP HUB SPOT - ADMINISTRATOR</span>
          </div>
          <div className="window-controls">
            <button className="window-control-btn" onClick={() => (window as any).electron?.ipcRenderer?.send('window-minimize')}>0</button>
            <button className="window-control-btn" onClick={() => (window as any).electron?.ipcRenderer?.send('window-close')}>r</button>
          </div>
        </div>
      )}

      {/* ── ZONE 1: Top bar (status + action cluster) ── */}
      <AdminTopBar
        onSettings={() => setSettingsOpen(true)}
        onRecordings={() => setRecOpen(true)}
        onAddFeed={() => setAddFeedOpen(true)}
        onChat={() => setChatOpen(!chatOpen)}
        chatUnread={chatUnread}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* ── ZONE 2: Stage (scrollable) ── */}
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
                    label="Admin Hub (Self)"
                    isLocal
                    isVideoEnabled={isVideoEnabled}
                    setIsVideoEnabled={setIsVideoEnabled}
                    isAudioEnabled={isAudioEnabled}
                    setIsAudioEnabled={setIsAudioEnabled}
                    serverLocalIP={serverStatus?.local}
                  />
                )}
                {peers.map((peer) => (
                  <div key={peer.id} style={{ position: 'relative' }}>
                    <VideoFeed stream={peer.stream} label={peer.name || `User ${peer.id.slice(0, 4)}`} serverLocalIP={serverStatus?.local} />
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
                  streams={isGridShared ? allStreams.filter((s: any) => s.id !== 'local') : allStreams}
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
                  serverLocalIP={serverStatus?.local}
                  spotlightId={spotlightId ?? undefined}
                />
              )}

            </div>
          </div>
        </div>

        {/* ── ZONE 3: Persistent broadcast console dock ── */}
        <BroadcastConsole />
      </div>

      {/* ── ZONE 4: Drawers ── */}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} extra={
        <>
          {isAdminMode && (
            <>
              <h3 style={{ borderBottom: '1px solid var(--ntd-sh)', marginTop: '15px' }}>Grid Controls</h3>
              <div className="ntd-field" style={{ padding: '5px', fontSize: '10px' }}>
                <div style={{ marginBottom: '5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Include Admin:</span>
                  <input
                    type="checkbox"
                    checked={gridMembers.has('local')}
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
            <div><strong>Virtual Cam</strong>: {allStreams.length > 0 ? 'Feeds Available' : 'No Input'}</div>
            <div><strong>Active RTMP</strong>: {serverStatus?.rtmpCount || 0} Viewer(s)</div>
          </div>
        </>
      } />

      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} messages={chatMessages} onSendMessage={sendMessage} />

      <NTDrawer open={recOpen} title="Recordings" onClose={() => setRecOpen(false)}>
        <RecordingsTab />
      </NTDrawer>

      <NTDrawer open={addFeedOpen} title="Add RTMP Feed" onClose={() => setAddFeedOpen(false)}>
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
                        checked={gridMembers.has(f.id)}
                        onChange={() => toggleGridMember(f.id)}
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
    </div>
    </AdminDataProvider>
  );
}

export default AdminApp;
