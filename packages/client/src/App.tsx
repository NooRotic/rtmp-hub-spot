import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useMediaDevices } from './hooks/useMediaDevices';
import VideoFeed from './components/VideoFeed';
import GridView from './components/GridView';
import ChatBox from './components/ChatBox';
import Lobby from './components/Lobby';
import mpegts from 'mpegts.js';

/**
 * Inline RTMP preview player using mpegts.js for a single publisher stream.
 * Self-contained: attaches/destroys its own mpegts instance.
 */
const RtmpPlayerTile = ({ streamKey, host }: { streamKey: string; host: string }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!videoRef.current || !mpegts.getFeatureList().mseLivePlayback) return;
    const player = mpegts.createPlayer({ type: 'flv', isLive: true, url: `http://${host}:8000/live/${streamKey}.flv` });
    player.attachMediaElement(videoRef.current);
    player.load();
    void (player.play() as unknown as Promise<void>)?.catch(() => {});
    return () => { try { player.destroy(); } catch (_) {} };
  }, [streamKey, host]);
  return <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', maxHeight: '120px', background: '#000', display: 'block', marginTop: '4px' }} />;
};

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
  const isElectron = useMemo(() => {
    return typeof window !== 'undefined' && 
           (navigator.userAgent.toLowerCase().indexOf(' electron/') > -1 || 
            (window as any).process?.versions?.electron);
  }, []);

  const ipc = useMemo(() => {
    if (!isElectron) return null;
    // Electron might not have window.electron if contextIsolation isn't set up that way
    // Try to get it from window or window.require if nodeIntegration is true
    return (window as any).electron?.ipcRenderer || 
           ((window as any).require ? (window as any).require('electron').ipcRenderer : null);
  }, [isElectron]);

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
  
  // Broadcast Quality Settings
  const [broadcastBitrate, setBroadcastBitrate] = useState<string>('2500k');
  const [broadcastPreset, setBroadcastPreset] = useState<string>('ultrafast');
  const [hwAccel, setHwAccel] = useState<string>('none');
  const [detectedEncoder, setDetectedEncoder] = useState<{ best: string; bestLabel: string; available: string[] } | null>(null);
  
  // Recording
  const [activeRecordings, setActiveRecordings] = useState<{ streamKey: string; path: string; startTime: number }[]>([]);
  const [recNow, setRecNow] = useState(Date.now());

  // FFmpeg pipeline health
  const [ffmpegStatus, setFfmpegStatus] = useState<{
    state: 'idle' | 'starting' | 'running' | 'error' | 'stopped';
    streamKey: string | null;
    message?: string;
  }>({ state: 'idle', streamKey: null });
  const [ffmpegStats, setFfmpegStats] = useState<{
    frame: number; fps: number; bitrate: string;
    speed: number; time: string; size: string; streamKey: string;
  } | null>(null);

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

  const refreshTelemetry = () => {
    if (ipc) {
      ipc.send('telemetry-refresh');
    }
  };

  useEffect(() => {
    if (isElectron && ipc) {
      const interval = setInterval(() => {
        refreshTelemetry();
      }, 5000);
      return () => clearInterval(interval);
    }
  }, [isElectron, ipc]);

  // GPU Encoder Auto-Detection (Electron only, runs once on startup)
  useEffect(() => {
    if (!isElectron || !ipc) return;
    ipc.invoke('detect-gpu-encoder')
      .then((result: { best: string; bestLabel: string; available: string[] }) => {
        console.log('[App] GPU encoder detection result:', result);
        setDetectedEncoder(result);
        // Only auto-set if user hasn't already picked something (we start at 'none')
        setHwAccel(prev => prev === 'none' ? result.best : prev);
      })
      .catch((err: any) => {
        console.error('[App] GPU detection failed:', err);
      });
  }, [isElectron, ipc]);

  // Listen for FFmpeg pipeline state and stats from the Electron main process
  useEffect(() => {
    if (!ipc) return;
    const handleStatus = (_: any, data: { state: 'idle' | 'starting' | 'running' | 'error' | 'stopped'; streamKey: string | null; message?: string }) => {
      setFfmpegStatus(data);
      if (data.state !== 'running') setFfmpegStats(null);
    };
    const handleStats = (_: any, data: typeof ffmpegStats) => {
      setFfmpegStats(data);
    };
    ipc.on('ffmpeg-status', handleStatus);
    ipc.on('ffmpeg-stats', handleStats);
    return () => {
      ipc.removeListener('ffmpeg-status', handleStatus);
      ipc.removeListener('ffmpeg-stats', handleStats);
    };
  }, [ipc]);

  // Tick every second while recordings are active (for elapsed time display)
  useEffect(() => {
    if (activeRecordings.length === 0) return;
    const t = setInterval(() => setRecNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [activeRecordings.length]);

  // Recording helpers
  const startRecording = async (streamKey: string) => {
    if (!ipc) return;
    try {
      const result = await ipc.invoke('start-recording', { streamKey });
      if (result.success) {
        setActiveRecordings(prev => [...prev, { streamKey, path: result.path, startTime: Date.now() }]);
      } else {
        console.error('[REC] Start failed:', result.error);
      }
    } catch (e) { console.error('[REC] IPC error:', e); }
  };

  const stopRecording = (streamKey: string) => {
    if (!ipc) return;
    ipc.send('stop-recording', { streamKey });
    setActiveRecordings(prev => prev.filter(r => r.streamKey !== streamKey));
  };

  const openRecordingsDir = () => {
    if (!ipc) return;
    ipc.send('open-recordings-dir');
  };

  // Sync recording state when the server auto-stops a recording (publisher disconnect, etc.)
  useEffect(() => {
    if (!recordingStopped) return;
    setActiveRecordings(prev => prev.filter(r => r.streamKey !== recordingStopped.streamKey));
  }, [recordingStopped]);

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

      // Extract NMS host cleanly
      const host = serverStatus?.local || 'localhost';
      
      if (mpegts.getFeatureList().mseLivePlayback) {
        const player = mpegts.createPlayer({
          type: 'flv',
          isLive: true,
          url: `http://${host}:8000/live/${feed.streamKey}.flv`
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

  return (
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
        <div className="app-title-bar">
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
      <div className="status-bar" style={{ flexWrap: 'wrap', rowGap: '4px' }}>
        <div className="status-item">
          <div className={`status-led ${
            socketStatus === 'connected'    ? 'led-on' :
            socketStatus === 'connecting'   ? 'led-warn' :
            socketStatus === 'disconnected' ? 'led-warn' : 'led-off'
          }`}></div>
          Hub: {socketStatus === 'disconnected' ? 'RECONNECTING…' : socketStatus.toUpperCase()}
        </div>
        <div className="status-item">
          <div className={`status-led ${isConnected ? 'led-on' : 'led-off'}`}></div>
          Signaling: {isConnected ? 'ACTIVE' : 'IDLE'}
        </div>
        {serverStatus && (
          <>
            <div className="status-item">| Local: {serverStatus.local}</div>
            <div className="status-item">| Network: {serverStatus.public}</div>
            <div className="status-item">| Clients: {serverStatus.clientCount}</div>
            <div className="status-item">| RTMP: {serverStatus.rtmpCount}</div>
          </>
        )}
      </div>

      <div className="main-layout" style={{ flex: 1, display: 'flex' }}>
        {/* Side Panel (Admin + Admin Monitor) */}
        {isAdminMode && (
          <>
            <div className="side-panel" style={{ width: `${sidebarWidth}px`, display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: '5px' }}>
                <h3 style={{ marginTop: 0, borderBottom: '1px solid #808080' }}>System Status</h3>
                <div className="inset-field" style={{ marginBottom: '10px', fontSize: '10px' }}>
                  <div><strong>NMS Server</strong>: Listening (1935/8000)</div>
                  <div><strong>WebRTC Bridge</strong>: Ready</div>
                  <div><strong>Virtual Cam</strong>: {allStreams.length > 0 ? 'Feeds Available' : 'No Input'}</div>
                  <div><strong>Active RTMP</strong>: {serverStatus?.rtmpCount || 0} Viewer(s)</div>
                </div>

                {/* ── FFmpeg Pipeline Health ── */}
                <h3 style={{ borderBottom: '1px solid #808080', marginTop: '10px' }}>FFmpeg Pipeline</h3>
                <div className="inset-field" style={{ padding: '6px', fontSize: '10px', marginBottom: '10px' }}>
                  {/* State indicator row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '5px' }}>
                    <div style={{
                      width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0,
                      backgroundColor:
                        ffmpegStatus.state === 'running'  ? '#00dd00' :
                        ffmpegStatus.state === 'starting' ? '#ffaa00' :
                        ffmpegStatus.state === 'error'    ? '#ff3333' : '#555555',
                      boxShadow:
                        ffmpegStatus.state === 'running'  ? '0 0 5px #00dd00' :
                        ffmpegStatus.state === 'starting' ? '0 0 5px #ffaa00' :
                        ffmpegStatus.state === 'error'    ? '0 0 5px #ff3333' : 'none'
                    }} />
                    <span style={{ fontFamily: 'monospace', fontWeight: 'bold', letterSpacing: '0.5px' }}>
                      {ffmpegStatus.state.toUpperCase()}
                    </span>
                    {ffmpegStatus.streamKey && (
                      <span style={{ color: '#555', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        → {ffmpegStatus.streamKey}
                      </span>
                    )}
                  </div>

                  {/* Live stats — shown only while running */}
                  {ffmpegStats ? (
                    <div style={{
                      background: '#111', color: '#00ee00', fontFamily: 'monospace',
                      fontSize: '9px', padding: '5px 6px', lineHeight: '1.6',
                      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 10px'
                    }}>
                      <div>FRAME <strong style={{ color: '#fff' }}>{ffmpegStats.frame}</strong></div>
                      <div>FPS <strong style={{ color: ffmpegStats.fps >= 25 ? '#00ee00' : '#ffaa00' }}>{ffmpegStats.fps.toFixed(1)}</strong></div>
                      <div>RATE <strong style={{ color: '#fff' }}>{ffmpegStats.bitrate}</strong></div>
                      <div>SPEED <strong style={{ color: ffmpegStats.speed >= 0.95 ? '#00ee00' : '#ff5555' }}>{ffmpegStats.speed.toFixed(2)}x</strong></div>
                      <div style={{ gridColumn: '1 / -1' }}>
                        TIME <strong style={{ color: '#aaa' }}>{ffmpegStats.time}</strong>
                        <span style={{ marginLeft: '8px' }}>SIZE <strong style={{ color: '#aaa' }}>{ffmpegStats.size}</strong></span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: '#888', fontSize: '9px', fontFamily: 'monospace' }}>
                      {ffmpegStatus.state === 'starting' && (ffmpegStatus.message || 'Initialising encoder…')}
                      {ffmpegStatus.state === 'idle'     && 'No active broadcast.'}
                      {ffmpegStatus.state === 'stopped'  && 'Broadcast stopped.'}
                      {ffmpegStatus.state === 'error'    && (ffmpegStatus.message || 'FFmpeg error.')}
                    </div>
                  )}

                  {/* Error detail */}
                  {ffmpegStatus.state === 'error' && ffmpegStatus.message && (
                    <div style={{ color: '#ff5555', fontSize: '8px', marginTop: '4px', wordBreak: 'break-word' }}>
                      {ffmpegStatus.message}
                    </div>
                  )}
                </div>

                <h3 style={{ borderBottom: '1px solid #808080' }}>Connected Clients & Feeds</h3>
                <div className="inset-field" style={{ height: '120px', overflowY: 'auto', fontSize: '10px', marginBottom: '10px' }}>
                  {peers.length === 0 && syntheticFeeds.length === 0 ? 'No clients connected.' : null}
                  {peers.map(p => (
                    <div key={p.id} style={{ borderBottom: '1px solid #eee', padding: '2px 0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', overflow: 'hidden' }}>
                          <span>⏺</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '90px' }}>{p.name || p.id.slice(0, 8)}</span>
                          {p.stream ?
                            <span style={{ color: '#00ff00', fontSize: '8px', flexShrink: 0 }}>[OK]</span> :
                            <span style={{ color: '#ff0000', fontSize: '8px', flexShrink: 0 }}>[–]</span>
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
                                background: spotlightId === p.id ? '#004488' : '#e0e0e0',
                                color: spotlightId === p.id ? '#fff' : '#000',
                                border: '1px solid #808080'
                              }}
                            >★</button>
                            <button
                              onClick={() => kickUser(p.id)}
                              title="Remove this user from the session"
                              style={{ fontSize: '8px', padding: '1px 4px', cursor: 'pointer', background: '#ff000022', color: '#cc0000', border: '1px solid #cc0000' }}
                            >✕</button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {syntheticFeeds.map(f => (
                    <div key={f.id} style={{ borderBottom: '1px solid #eee', padding: '2px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ marginRight: '5px' }}>📡</span>
                        <span>{f.label}</span>
                        {f.stream ? 
                          <span style={{ color: '#00ff00', marginLeft: '5px', fontSize: '8px' }}>[LIVE]</span> : 
                          <span style={{ color: '#ffaa00', marginLeft: '5px', fontSize: '8px' }}>[FETCHING]</span>
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
                        <button onClick={() => removeSyntheticFeed(f.id)} style={{ fontSize: '8px', background: '#ff000033', border: '1px solid #f00', cursor: 'pointer' }}>X</button>
                      </div>
                    </div>
                  ))}
                </div>

                {isAdminMode && (
                  <>
                    <h3 style={{ borderBottom: '1px solid #808080', marginTop: '15px' }}>Grid Controls</h3>
                    <div className="inset-field" style={{ padding: '5px', fontSize: '10px' }}>
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
                    <h3 style={{ borderBottom: '1px solid #808080', marginTop: '15px' }}>Add RTMP Feed</h3>
                    <div className="inset-field" style={{ padding: '5px', fontSize: '10px', marginBottom: '10px' }}>
                      <div style={{ marginBottom: '5px' }}>
                        <input 
                          type="text" 
                          placeholder="Stream Key (e.g., guest1)" 
                          className="inset-field" 
                          style={{ width: '100%', marginBottom: '2px', boxSizing: 'border-box' }}
                          value={newFeedKey}
                          onChange={(e) => setNewFeedKey(e.target.value)}
                        />
                        <input 
                          type="text" 
                          placeholder="Label (e.g., Guest Cam)" 
                          className="inset-field" 
                          style={{ width: '100%', marginBottom: '5px', boxSizing: 'border-box' }}
                          value={newFeedLabel}
                          onChange={(e) => setNewFeedLabel(e.target.value)}
                        />
                        <button className="btn" style={{ width: '100%' }} onClick={addSyntheticFeed}>CONNECT EXT FEED</button>
                      </div>
                    </div>
                  </>
                )}

                <h3 style={{ borderBottom: '1px solid #808080' }}>Active RTMP Links</h3>
                <div className="inset-field" style={{ padding: '8px', fontSize: '10px', marginBottom: '10px', color: '#00ff00', fontFamily: 'monospace' }}>
                  {isGridShared && isConnected && (() => {
                    const url = `rtmp://${serverStatus?.local || 'localhost'}/live/grid`;
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>GRID: {url}</span>
                        <button onClick={() => navigator.clipboard.writeText(url)} title="Copy to clipboard" style={{ fontSize: '8px', padding: '1px 5px', marginLeft: '4px', cursor: 'pointer', background: '#00440022', color: '#004400', border: '1px solid #006600', flexShrink: 0 }}>COPY</button>
                      </div>
                    );
                  })()}
                  {peers.filter(p => p.stream).map(p => {
                    const url = `rtmp://${serverStatus?.local || 'localhost'}/live/feed-${p.name.replace(/\s+/g, '-').toLowerCase()}`;
                    return (
                      <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.name.split(' ')[0]}: {url}</span>
                        <button onClick={() => navigator.clipboard.writeText(url)} title="Copy to clipboard" style={{ fontSize: '8px', padding: '1px 5px', marginLeft: '4px', cursor: 'pointer', background: '#00440022', color: '#004400', border: '1px solid #006600', flexShrink: 0 }}>COPY</button>
                      </div>
                    );
                  })}
                  {!isGridShared && peers.filter(p => p.stream).length === 0 && (
                    <div style={{ color: '#888' }}>No active broadcasts.</div>
                  )}
                </div>

                {/* Live Publishers — streams currently being ingested by RTMP server */}
                <h3 style={{ borderBottom: '1px solid #808080', marginTop: '15px' }}>Live Publishers</h3>
                <div className="inset-field" style={{ padding: '6px', fontSize: '10px', marginBottom: '10px', minHeight: '40px' }}>
                  {!serverStatus?.rtmpPublishers || serverStatus.rtmpPublishers.length === 0 ? (
                    <div style={{ color: '#888', padding: '4px' }}>No active publishers.</div>
                  ) : (
                    serverStatus.rtmpPublishers.map((pub: any) => {
                      const isRecording = activeRecordings.some(r => r.streamKey === pub.streamKey);
                      const isPreviewing = previewOpen.has(pub.streamKey);
                      const togglePreview = () => setPreviewOpen(prev => {
                        const next = new Set(prev);
                        if (next.has(pub.streamKey)) next.delete(pub.streamKey);
                        else next.add(pub.streamKey);
                        return next;
                      });
                      return (
                        <div key={pub.streamKey} style={{ padding: '3px 0', borderBottom: '1px solid #eee' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <span style={{ color: '#00cc00', fontSize: '9px' }}>●</span>
                              <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{pub.streamKey}</span>
                              <span style={{ color: '#888', fontSize: '9px' }}>⏱{pub.uptime}s</span>
                            </div>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button
                                onClick={togglePreview}
                                style={{
                                  fontSize: '9px', padding: '1px 6px',
                                  backgroundColor: isPreviewing ? '#004488' : '#e0e0e0',
                                  color: isPreviewing ? '#fff' : '#000',
                                  border: '1px solid #808080', cursor: 'pointer'
                                }}
                              >
                                {isPreviewing ? '⏹ PREVIEW' : '▶ PREVIEW'}
                              </button>
                              <button
                                className="btn"
                                onClick={() => isRecording ? stopRecording(pub.streamKey) : startRecording(pub.streamKey)}
                                style={{
                                  fontSize: '9px', padding: '1px 6px',
                                  backgroundColor: isRecording ? '#cc000022' : '#00440022',
                                  color: isRecording ? '#cc0000' : '#004400',
                                  border: `1px solid ${isRecording ? '#cc0000' : '#006600'}`
                                }}
                              >
                                {isRecording ? '⏹ STOP REC' : '⏺ REC'}
                              </button>
                            </div>
                          </div>
                          {isPreviewing && (
                            <RtmpPlayerTile streamKey={pub.streamKey} host={serverStatus?.local || 'localhost'} />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #808080' }}>
                  <h3 style={{ margin: 0 }}>RTMP Viewers</h3>
                  <button className="btn" style={{ fontSize: '9px', padding: '0 4px' }} onClick={refreshTelemetry}>REFRESH</button>
                </div>
                
                <div className="inset-field" style={{ height: '220px', overflowY: 'auto', padding: 0, marginBottom: '10px' }}>
                  {!serverStatus?.rtmpSessions || serverStatus.rtmpSessions.length === 0 ? (
                    <div style={{ padding: '10px', fontSize: '10px' }}>No RTMP viewers.</div>
                  ) : (
                    <table className="telemetry-table">
                      <thead>
                        <tr>
                          <th>IP/Source</th>
                          <th>Path</th>
                          <th>Stats</th>
                        </tr>
                      </thead>
                      <tbody>
                        {serverStatus.rtmpSessions.map(s => (
                          <tr key={s.id}>
                            <td style={{ fontWeight: 'bold' }}>{s.ip.replace('::ffff:', '')}</td>
                            <td style={{ color: '#666' }}>{s.path.split('/').pop()}</td>
                            <td>
                              <div className="metric-vibrant">⏱ {s.uptime}s</div>
                              <div>📊 {(s.bitrate / 1024 / 1024).toFixed(2)} Mbps</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="help-box">
                  <strong>What is "SET V-CAM"?</strong>
                  <p>This button routes the specific user's video feed into a virtual camera device on your system.</p>
                  <strong>Rendering Options:</strong>
                  <ul>
                    <li>Soft: CPU encoding (Safe)</li>
                    <li>NVENC: NVIDIA GPU (Fast)</li>
                    <li>AMF/QSV: AMD/Intel (Fast)</li>
                  </ul>
                </div>
                {/* Active Recordings Panel */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #808080', marginTop: '15px' }}>
                  <h3 style={{ margin: 0, color: activeRecordings.length > 0 ? '#cc0000' : undefined }}>
                    {activeRecordings.length > 0 ? `⏺ Recording (${activeRecordings.length})` : 'Recordings'}
                  </h3>
                  <button className="btn" style={{ fontSize: '9px', padding: '0 6px' }} onClick={openRecordingsDir}>
                    📁 FOLDER
                  </button>
                </div>
                <div className="inset-field" style={{ padding: '6px', fontSize: '10px', marginBottom: '10px', minHeight: '36px' }}>
                  {activeRecordings.length === 0 ? (
                    <div style={{ color: '#888', padding: '4px' }}>
                      No active recordings. Click ⏺ REC on a Live Publisher above.
                    </div>
                  ) : (
                    activeRecordings.map(rec => {
                      const elapsed = Math.floor((recNow - rec.startTime) / 1000);
                      const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
                      const ss = String(elapsed % 60).padStart(2, '0');
                      const filename = rec.path.split(/[/\\]/).pop() || rec.path;
                      return (
                        <div key={rec.streamKey} style={{ marginBottom: '5px', padding: '4px 5px', background: '#fff0f0', border: '1px solid #ffaaaa' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <span style={{ color: '#cc0000', fontSize: '11px' }}>⏺</span>
                              <span style={{ fontFamily: 'monospace', fontWeight: 'bold', color: '#cc0000' }}>{rec.streamKey}</span>
                              <span style={{ fontFamily: 'monospace', background: '#cc0000', color: '#fff', padding: '0 4px', fontSize: '9px' }}>{mm}:{ss}</span>
                            </div>
                            <button
                              className="btn"
                              onClick={() => stopRecording(rec.streamKey)}
                              style={{ fontSize: '9px', padding: '1px 6px', background: '#cc000022', color: '#cc0000', border: '1px solid #cc0000' }}
                            >
                              ⏹ STOP
                            </button>
                          </div>
                          <div style={{ fontSize: '8px', color: '#888', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rec.path}>
                            💾 {filename}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <h3 style={{ borderBottom: '1px solid #808080', marginTop: '10px' }}>Broadcast Settings</h3>

                <div className="inset-field" style={{ fontSize: '10px', padding: '10px', marginBottom: '10px' }}>

                  {/* GPU Detection Status */}
                  <div style={{ marginBottom: '10px', padding: '5px', background: '#f0f0f0', border: '1px solid #ccc' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '3px' }}>
                      <strong>GPU Detection:</strong>
                      {detectedEncoder ? (
                        <span style={{
                          background: detectedEncoder.best !== 'none' ? '#004000' : '#404000',
                          color: '#fff',
                          padding: '1px 5px',
                          fontSize: '9px',
                          fontFamily: 'monospace'
                        }}>
                          {detectedEncoder.best !== 'none' ? '● HW ACCEL' : '○ SOFTWARE'}
                        </span>
                      ) : (
                        <span style={{ color: '#808080', fontSize: '9px' }}>SCANNING...</span>
                      )}
                    </div>
                    {detectedEncoder && (
                      <div style={{ color: '#444', fontFamily: 'monospace', fontSize: '9px' }}>
                        Best: <strong>{detectedEncoder.bestLabel}</strong>
                        {detectedEncoder.available.length > 0 && (
                          <span style={{ marginLeft: '8px', color: '#888' }}>
                            Available: {detectedEncoder.available.join(', ')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', marginBottom: '2px' }}>Target Bitrate:</label>
                    <select 
                      className="inset-field" 
                      style={{ width: '100%' }}
                      value={broadcastBitrate} 
                      onChange={(e) => setBroadcastBitrate(e.target.value)}
                    >
                      <option value="1500k">1500k (Optimized)</option>
                      <option value="2500k">2500k (Standard)</option>
                      <option value="5000k">5000k (High Quality)</option>
                    </select>
                  </div>

                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', marginBottom: '2px' }}>FFmpeg Preset:</label>
                    <select 
                      className="inset-field" 
                      style={{ width: '100%' }}
                      value={broadcastPreset} 
                      onChange={(e) => setBroadcastPreset(e.target.value)}
                    >
                      <option value="ultrafast">Ultrafast (Low CPU)</option>
                      <option value="superfast">Superfast</option>
                      <option value="veryfast">Veryfast</option>
                      <option value="faster">Faster</option>
                      <option value="fast">Fast</option>
                      <option value="medium">Medium (Better Quality)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', marginBottom: '2px' }}>Encoder Accel:</label>
                    <select 
                      className="inset-field" 
                      style={{ width: '100%' }}
                      value={hwAccel} 
                      onChange={(e) => setHwAccel(e.target.value)}
                    >
                      {[
                        { value: 'none',   label: 'Software (x264)' },
                        { value: 'amd',    label: 'AMD AMF' },
                        { value: 'nvidia', label: 'NVIDIA NVENC' },
                        { value: 'intel',  label: 'Intel QSV' },
                      ].map(opt => {
                        const isDetected = detectedEncoder?.best === opt.value;
                        const isAvailable = opt.value === 'none' || !detectedEncoder || detectedEncoder.available.includes(opt.value);
                        return (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                            {isDetected ? ' ★ Auto-detected' : ''}
                            {opt.value !== 'none' && !isAvailable && detectedEncoder ? ' (not found)' : ''}
                          </option>
                        );
                      })}
                    </select>
                    {hwAccel !== (detectedEncoder?.best ?? 'none') && detectedEncoder && (
                      <div style={{ color: '#886600', fontSize: '9px', marginTop: '2px' }}>
                        ⚠ Override active. Auto-detected: {detectedEncoder.bestLabel}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <ChatBox messages={chatMessages} onSendMessage={sendMessage} />
            </div>
            <div className="divider" onMouseDown={startResizing}></div>
          </>
        )}

        {/* Main Content Area */}
        <div style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
          <div className="window">
            <div className="window-title">
              <span>{isElectron ? 'Admin Video Hub' : 'Client Participant Portal'}</span>
            </div>
            <div className="window-content">
              <div className="inset-field" style={{ marginBottom: '15px' }}>
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 auto', minWidth: '120px' }}>
                    <label>Camera: </label>
                    <select className="inset-field" style={{ width: '100%', boxSizing: 'border-box' }} value={selectedVideo} onChange={(e) => setSelectedVideo(e.target.value)}>
                      <option value="">{isElectron ? 'Off' : 'Default Camera'}</option>
                      {videoDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: '1 1 auto', minWidth: '120px' }}>
                    <label>Mic: </label>
                    <select className="inset-field" style={{ width: '100%', boxSizing: 'border-box' }} value={selectedAudio} onChange={(e) => setSelectedAudio(e.target.value)}>
                      <option value="">{isElectron ? 'Off' : 'Default Mic'}</option>
                      {audioDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>)}
                    </select>
                  </div>
                </div>
                {isElectron ? (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button 
                      className="btn" 
                      onClick={() => setAdminCamActive(!adminCamActive)} 
                      style={{ padding: '2px 20px', backgroundColor: adminCamActive ? '#ff000022' : '#00ff0022' }}
                    >
                      {adminCamActive ? 'STOP ADMIN CAMERA' : 'START ADMIN CAMERA'}
                    </button>
                    <button 
                      className="btn" 
                      onClick={() => setShowGrid(!showGrid)} 
                      style={{ padding: '2px 20px', backgroundColor: showGrid ? '#00ff0022' : '#cfcfcf' }}
                    >
                      {showGrid ? 'DISABLE GRID VIEW' : 'ENABLE GRID VIEW'}
                    </button>
                    <button 
                      className="btn" 
                      onClick={() => setIsGridShared(!isGridShared)} 
                      style={{ padding: '2px 20px', backgroundColor: isGridShared ? '#ff000022' : '#00ff0022' }}
                    >
                      {isGridShared ? 'STOP SHARING GRID' : 'SHARE GRID TO ALL'}
                    </button>
                    <span style={{ fontSize: '10px', color: '#666' }}> (Visible to all connected clients)</span>
                  </div>
                ) : isAdminMode ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 0' }}>
                    <span style={{ background: '#000080', color: '#fff', padding: '3px 10px', fontFamily: 'monospace', fontSize: '10px', letterSpacing: '1px' }}>
                      ◈ MONITOR MODE
                    </span>
                    <span style={{ fontSize: '10px', color: '#555' }}>
                      Connected as Admin Monitor. Broadcast controls require the Electron app.
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      className="inset-field"
                      type="text"
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)} 
                      placeholder="Required: Enter your name" 
                      disabled={isConnected} 
                      style={{ border: !userName.trim() ? '1px solid #ff0000' : 'none', flex: '1 1 140px', minWidth: '140px' }}
                    />
                    <button 
                      className="btn" 
                      onClick={() => setLocalCameraActive(!localCameraActive)} 
                      style={{ padding: '6px 16px', backgroundColor: localCameraActive ? '#ff000022' : '#00ff0022', flex: '1 1 auto' }}
                    >
                      {localCameraActive ? 'STOP CAMERA' : 'START CAMERA'}
                    </button>
                    <button 
                      className="btn" 
                      onClick={isConnected ? disconnect : handleConnect} 
                      style={{ padding: '6px 16px', backgroundColor: isConnected ? '#ff000022' : '#00ff0022', flex: '1 1 auto' }}
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
  );
}

export default App;
