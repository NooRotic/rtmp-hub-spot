import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useMediaDevices } from './hooks/useMediaDevices';
import { useElectronBridge } from './hooks/useElectronBridge';
import { useFfmpegPipeline } from './hooks/useFfmpegPipeline';
import { useRecordings } from './hooks/useRecordings';
import { useBroadcastSettings } from './hooks/useBroadcastSettings';
import { useRelays } from './hooks/useRelays';
import { useDestinations } from './hooks/useDestinations';
import { deriveSources } from './admin/sources';
import { AdminDataProvider, type AdminData } from './admin/AdminDataProvider';
import { AdminWorkspace } from './admin/AdminWorkspace';
import { ServerStatusBar } from './admin/ServerStatusBar';
import VideoFeed from './components/VideoFeed';
import GridView from './components/GridView';
import ChatBox from './components/ChatBox';
import Lobby from './components/Lobby';
import mpegts from 'mpegts.js';
import { localFlvUrl } from './components/RtmpPlayerTile';
import { feedKey } from './utils/streamKey';
export { RtmpPlayerTile, localFlvUrl } from './components/RtmpPlayerTile';

// Effect for persistence
export function usePersistence(selectedVideo: string, selectedAudio: string) {
  useEffect(() => {
    localStorage.setItem('hub-video-device', selectedVideo);
  }, [selectedVideo]);

  useEffect(() => {
    localStorage.setItem('hub-audio-device', selectedAudio);
  }, [selectedAudio]);
}

// Custom hook for resizable sidebar
function useResizableSidebar(initialWidth: number) {
  const [width, setWidth] = useState<number>(() => {
    const saved = localStorage.getItem('hub-sidebar-width');
    return saved ? parseInt(saved, 10) : initialWidth;
  });
  const isResizing = useRef(false);

  const startResizing = useCallback(() => {
    isResizing.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'col-resize';
  }, []);

  const stopResizing = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
    document.body.style.cursor = 'default';
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = e.clientX;
    if (newWidth > 150 && newWidth < 600) {
      setWidth(newWidth);
      localStorage.setItem('hub-sidebar-width', newWidth.toString());
    }
  }, []);

  return { width, startResizing };
}

/**
 * The primary WebRTC Hub application component.
 * 
 * Functions both as the Host/Admin dashboard (when running in Electron) and
 * as the remote Participant view (when running in a browser).
 * 
 * Responsibilities:
 * - Local hardware state (Camera, Mic)
 * - P2P Mesh Network orchestration via `useWebRTC`
 * - Synthetic Feed ingest (RTMP-to-WebRTC overlays via `mpegts.js`)
 * - Global Grid compositing state (`gridMembers`)
 * 
 * @returns {JSX.Element} The rendered React Application.
 */
function App() {
  const { isElectron, ipc } = useElectronBridge();

  /** True when running in admin capacity — either Electron or browser with ?role=admin query param. */
  const isAdminMode = useMemo(() => {
    if (isElectron) return true;
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('role') === 'admin';
  }, [isElectron]);

  const { width: sidebarWidth, startResizing } = useResizableSidebar(250);

  // Grid management state
  const [gridMembers, setGridMembers] = useState<Set<string>>(new Set(['local']));
  const [gridAutoLayout, setGridAutoLayout] = useState(true);
  const [lobbyDone, setLobbyDone] = useState(() => isElectron || isAdminMode); // Electron and admin monitor skip lobby
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState<Set<string>>(new Set());
  const pendingConnectRef = useRef(false);

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
  const [userName, setUserName] = useState<string>(() => {
    if (isElectron) return 'Admin';
    if (isAdminMode) return 'Admin Monitor';
    return localStorage.getItem('hub-username') || '';
  });
  const [adminCamActive, setAdminCamActive] = useState<boolean>(false);
  const [localCameraActive, setLocalCameraActive] = useState<boolean>(false);
  const [showGrid, setShowGrid] = useState<boolean>(isElectron); // Default ON for admin
  const [gridStream, setGridStream] = useState<MediaStream | null>(null);
  const [isGridShared, setIsGridShared] = useState<boolean>(false);
  
  const {
    bitrate: broadcastBitrate, setBitrate: setBroadcastBitrate,
    preset: broadcastPreset, setPreset: setBroadcastPreset,
    hwAccel, setHwAccel,
    detectedEncoder,
  } = useBroadcastSettings(ipc);

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

  const { serverStatus, isConnected, socketStatus, peers, userStream, isVideoEnabled, setIsVideoEnabled, isAudioEnabled, setIsAudioEnabled, chatMessages, sendMessage, disconnect, connect, recordingStopped, wasKicked, kickUser, isLive } = useWebRTC('main-hub', {
    videoId: (isElectron ? (adminCamActive ? selectedVideo : undefined) : (localCameraActive ? (selectedVideo || undefined) : undefined)),
    audioId: (isElectron ? (adminCamActive ? selectedAudio : undefined) : (localCameraActive ? (selectedAudio || undefined) : undefined)),
    userName: userName,
    cameraLabel: broadcastLabel,
    captureVideo: isElectron ? adminCamActive : localCameraActive,
    overrideStream: isGridShared ? gridStream : null
  });

  const { activeRecordings, recNow, startRecording, stopRecording, openRecordingsDir } = useRecordings(ipc, recordingStopped);

  const handleConnect = () => {
    if (!userName.trim()) {
      alert('Please enter your name before connecting.');
      return;
    }
    localStorage.setItem('hub-username', userName);
    connect();
  };

  const handleLobbyJoin = (name: string) => {
    setUserName(name);
    localStorage.setItem('hub-username', name);
    setLocalCameraActive(true);
    setLobbyDone(true);
    pendingConnectRef.current = true;
  };

  // Browser admin monitor auto-connect. Electron auto-connects via the useWebRTC hook itself.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isElectron && isAdminMode && !isConnected) {
      connect();
    }
  }, [isAdminMode, isElectron, isConnected]);

  // Connect after lobby sets userName (state update is async, so we use a ref flag)
  useEffect(() => {
    if (pendingConnectRef.current && lobbyDone && userName) {
      pendingConnectRef.current = false;
      connect();
    }
  }, [userName, lobbyDone]);

  // When kicked: reset non-admin browser clients to lobby state
  useEffect(() => {
    if (wasKicked && !isAdminMode) {
      setLobbyDone(false);
      setLocalCameraActive(false);
    }
  }, [wasKicked, isAdminMode]);

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

  const gridStreams = useMemo(() => {
    const all = [
      { id: 'local', stream: userStream || undefined, label: cameraLabel },
      ...peers.map(p => ({ id: p.id, stream: p.stream, label: p.name || p.id.slice(0, 8) })),
      ...syntheticFeeds.filter(f => f.stream).map(f => ({ id: f.id, stream: f.stream as MediaStream, label: f.label }))
    ];
    return all.filter(s => gridMembers.has(s.id));
  }, [peers, userStream, cameraLabel, gridMembers, syntheticFeeds]);

  const allStreams = useMemo(() => [
    ...(userStream && (isElectron ? (adminCamActive || isGridShared) : localCameraActive) ? [{ 
      id: 'local', 
      stream: userStream, 
      label: `${isElectron ? 'Admin Hub' : userName} - ${broadcastLabel}` 
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
  ], [userStream, adminCamActive, localCameraActive, isElectron, userName, broadcastLabel, peers, syntheticFeeds]);

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
    previewOpen,
    setPreviewOpen,
    refreshTelemetry,
  }), [
    socketStatus, isConnected, serverStatus, bindings, relays, destinations,
    ffmpegStatus, ffmpegStats, activeRecordings, recNow,
    startRecording, stopRecording, openRecordingsDir,
    broadcastBitrate, setBroadcastBitrate, broadcastPreset, setBroadcastPreset, hwAccel, setHwAccel, detectedEncoder,
    addDestination, updateDestination, removeDestination, setBinding, removeBinding, refreshDestinations,
    previewOpen, setPreviewOpen, refreshTelemetry,
  ]);

  return (
    <AdminDataProvider value={adminData}>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Pre-flight lobby for browser clients */}
      {!isAdminMode && !lobbyDone && (
        <Lobby
          onJoin={handleLobbyJoin}
          initialName={userName}
          wasKicked={wasKicked}
        />
      )}
      {/* "You are live" banner for connected clients */}
      {!isElectron && !isAdminMode && isLive && (
        <div className="live-banner">◉ YOU ARE LIVE</div>
      )}
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
      
      {/* Top Status Bar */}
      <ServerStatusBar />

      <div className="main-layout" style={{ flex: 1, display: 'flex' }}>
        {/* Side Panel (Admin + Admin Monitor) */}
        {isAdminMode && (
          <>
            <div className="side-panel ntd" style={{ width: `${sidebarWidth}px`, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: '5px' }}>
                <h3 style={{ marginTop: 0, borderBottom: '1px solid var(--ntd-sh)' }}>System Status</h3>
                <div className="ntd-field" style={{ marginBottom: '10px', fontSize: '10px' }}>
                  <div><strong>NMS Server</strong>: Listening (1935/8000)</div>
                  <div><strong>WebRTC Bridge</strong>: Ready</div>
                  <div><strong>Virtual Cam</strong>: {allStreams.length > 0 ? 'Feeds Available' : 'No Input'}</div>
                  <div><strong>Active RTMP</strong>: {serverStatus?.rtmpCount || 0} Viewer(s)</div>
                </div>

                <h3 style={{ borderBottom: '1px solid var(--ntd-sh)' }}>Connected Clients & Feeds</h3>
                <div className="ntd-field" style={{ height: '120px', overflowY: 'auto', fontSize: '10px', marginBottom: '10px' }}>
                  {peers.length === 0 && syntheticFeeds.length === 0 ? 'No clients connected.' : null}
                  {peers.map(p => (
                    <div key={p.id} style={{ borderBottom: '1px solid var(--ntd-sh)', padding: '2px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', overflow: 'hidden' }}>
                          <span>⏺</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90px' }}>{p.name || p.id.slice(0, 8)}</span>
                          {p.stream ?
                            <span style={{ color: 'var(--ntd-live)', fontSize: '8px', flexShrink: 0 }}>[OK]</span> :
                            <span style={{ color: 'var(--ntd-error)', fontSize: '8px', flexShrink: 0 }}>[–]</span>
                          }
                        </div>
                        {isAdminMode && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                            <label style={{ fontSize: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '2px' }}>
                              <input
                                type="checkbox"
                                checked={gridMembers.has(p.id)}
                                onChange={() => toggleGridMember(p.id)}
                                style={{ margin: 0 }}
                              /> Grid
                            </label>
                            <button
                              onClick={() => setSpotlightId(prev => prev === p.id ? null : p.id)}
                              title="Spotlight this feed in the grid"
                              style={{
                                fontSize: '8px', padding: '1px 4px', cursor: 'pointer',
                                background: spotlightId === p.id ? 'var(--ntd-navy-b)' : 'var(--ntd-face-2)',
                                color: spotlightId === p.id ? '#fff' : 'var(--ntd-text)',
                                border: '1px solid var(--ntd-sh)'
                              }}
                            >★</button>
                            <button
                              onClick={() => kickUser(p.id)}
                              title="Remove this user from the session"
                              style={{ fontSize: '8px', padding: '1px 4px', cursor: 'pointer', background: '#ff000022', color: 'var(--ntd-error)', border: '1px solid var(--ntd-error)' }}
                            >✕</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
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
                        {isAdminMode && (
                          <label style={{ fontSize: '8px', cursor: 'pointer' }}>
                            <input
                              type="checkbox"
                              checked={gridMembers.has(f.id)}
                              onChange={() => toggleGridMember(f.id)}
                              style={{ margin: 0, verticalAlign: 'middle' }}
                            /> Grid
                          </label>
                        )}
                        <button onClick={() => removeSyntheticFeed(f.id)} style={{ fontSize: '8px', background: '#ff000033', border: '1px solid var(--ntd-error)', color: 'var(--ntd-error)', cursor: 'pointer' }}>X</button>
                      </div>
                    </div>
                  ))}
                </div>

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

                {isAdminMode && (
                  <>
                    <h3 style={{ borderBottom: '1px solid var(--ntd-sh)', marginTop: '15px' }}>Add RTMP Feed</h3>
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
                    </div>
                  </>
                )}

                <h3 style={{ borderBottom: '1px solid var(--ntd-sh)' }}>Active RTMP Links</h3>
                <div className="ntd-field" style={{ padding: '8px', fontSize: '10px', marginBottom: '10px', color: 'var(--ntd-live)', fontFamily: 'monospace' }}>
                  {isGridShared && isConnected && (() => {
                    const url = `rtmp://${serverStatus?.local || 'localhost'}/live/grid`;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>GRID: {url}</span>
                        <button onClick={() => navigator.clipboard.writeText(url)} title="Copy to clipboard" className="ntd-btn ntd-btn--go" style={{ fontSize: '8px', padding: '1px 5px', marginLeft: '4px', flexShrink: 0 }}>COPY</button>
                      </div>
                    );
                  })()}
                  {peers.filter(p => p.stream).map(p => {
                    const url = `rtmp://${serverStatus?.local || 'localhost'}/live/${feedKey(p.name)}`;
                    return (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.name.split(' ')[0]}: {url}</span>
                        <button onClick={() => navigator.clipboard.writeText(url)} title="Copy to clipboard" className="ntd-btn ntd-btn--go" style={{ fontSize: '8px', padding: '1px 5px', marginLeft: '4px', flexShrink: 0 }}>COPY</button>
                      </div>
                    );
                  })}
                  {!isGridShared && peers.filter(p => p.stream).length === 0 && (
                    <div style={{ color: 'var(--ntd-text-dim)' }}>No active broadcasts.</div>
                  )}
                </div>

                <AdminWorkspace />
              </div>
              <ChatBox messages={chatMessages} onSendMessage={sendMessage} />
            </div>
            <div className="divider ntd" onMouseDown={startResizing}></div>
          </>
        )}

        {/* Main Content Area */}
        <div className="ntd" style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
          <div className="window ntd">
            <div className="window-title">
              <span>{isElectron ? 'Admin Video Hub' : 'Client Participant Portal'}</span>
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
                ) : isAdminMode ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0' }}>
                    <span style={{ background: 'var(--ntd-navy-b)', color: '#fff', padding: '3px 10px', fontFamily: 'monospace', fontSize: '10px', letterSpacing: '1px' }}>
                      ◈ MONITOR MODE
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--ntd-text-dim)' }}>
                      Connected as Admin Monitor. Broadcast controls require the Electron app.
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      className="ntd-field"
                      type="text"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      placeholder="Required: Enter your name"
                      disabled={isConnected}
                      style={{ border: !userName.trim() ? '2px solid var(--ntd-error)' : 'none', flex: '1 1 140px', minWidth: '140px' }}
                    />
                    <button
                      className="ntd-btn"
                      onClick={() => setLocalCameraActive(!localCameraActive)}
                      style={{ padding: '6px 16px', backgroundColor: localCameraActive ? 'var(--ntd-error)' : 'var(--ntd-go)', flex: '1 1 auto' }}
                    >
                      {localCameraActive ? 'STOP CAMERA' : 'START CAMERA'}
                    </button>
                    <button
                      className="ntd-btn"
                      onClick={isConnected ? disconnect : handleConnect}
                      style={{ padding: '6px 16px', backgroundColor: isConnected ? 'var(--ntd-error)' : 'var(--ntd-go)', flex: '1 1 auto' }}
                      disabled={!userName.trim()}
                    >
                      {isConnected ? 'DISCONNECT' : 'CONNECT TO HUB'}
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                {userStream && (
                  <VideoFeed 
                    stream={userStream} 
                    label={`${isElectron ? 'Admin Hub' : userName} (Self)`} 
                    isLocal 
                    isVideoEnabled={isVideoEnabled}
                    setIsVideoEnabled={setIsVideoEnabled}
                    isAudioEnabled={isAudioEnabled}
                    setIsAudioEnabled={setIsAudioEnabled}
                    serverLocalIP={serverStatus?.local}
                  />
                )}
                {peers.map((peer) => (
                  <VideoFeed key={peer.id} stream={peer.stream} label={peer.name || `User ${peer.id.slice(0, 4)}`} serverLocalIP={serverStatus?.local} />
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
              
              {!isElectron && <ChatBox messages={chatMessages} onSendMessage={sendMessage} />}
            </div>
          </div>
        </div>
      </div>
    </div>
    </AdminDataProvider>
  );
}

export default App;
