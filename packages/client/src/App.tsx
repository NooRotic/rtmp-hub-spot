import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useMediaDevices } from './hooks/useMediaDevices';
import VideoFeed from './components/VideoFeed';
import GridView from './components/GridView';
import ChatBox from './components/ChatBox';
import mpegts from 'mpegts.js';

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

  const { width: sidebarWidth, startResizing } = useResizableSidebar(250);

  // Grid management state
  const [gridMembers, setGridMembers] = useState<Set<string>>(new Set(['local']));
  const [gridAutoLayout, setGridAutoLayout] = useState(true);

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
  const [userName, setUserName] = useState<string>(isElectron ? 'Admin' : (localStorage.getItem('hub-username') || ''));
  const [adminCamActive, setAdminCamActive] = useState<boolean>(false);
  const [localCameraActive, setLocalCameraActive] = useState<boolean>(false);
  const [showGrid, setShowGrid] = useState<boolean>(isElectron); // Default ON for admin
  const [gridStream, setGridStream] = useState<MediaStream | null>(null);
  const [isGridShared, setIsGridShared] = useState<boolean>(false);
  
  // Broadcast Quality Settings
  const [broadcastBitrate, setBroadcastBitrate] = useState<string>('2500k');
  const [broadcastPreset, setBroadcastPreset] = useState<string>('ultrafast');
  const [hwAccel, setHwAccel] = useState<string>('none');
  
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

  const { serverStatus, isConnected, socketStatus, peers, userStream, isVideoEnabled, setIsVideoEnabled, isAudioEnabled, setIsAudioEnabled, chatMessages, sendMessage, disconnect, connect } = useWebRTC('main-hub', {
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

  useEffect(() => {
    if (isElectron && !isConnected) {
      console.log('[App] Auto-connecting Electron Admin...');
      connect();
    }
  }, [isElectron, isConnected]);

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
      <div className="status-bar">
        <div className="status-item">
          <div className={`status-led ${socketStatus === 'connected' ? 'led-on' : socketStatus === 'connecting' ? 'led-warn' : 'led-off'}`}></div>
          Hub: {socketStatus.toUpperCase()}
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
            <div className="status-item">| RTMP Players: {serverStatus.rtmpCount}</div>
          </>
        )}
      </div>

      <div className="main-layout" style={{ flex: 1, display: 'flex' }}>
        {/* Side Panel (Admin Only) */}
        {isElectron && (
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

                <h3 style={{ borderBottom: '1px solid #808080' }}>Connected Clients & Feeds</h3>
                <div className="inset-field" style={{ height: '120px', overflowY: 'auto', fontSize: '10px', marginBottom: '10px' }}>
                  {peers.length === 0 && syntheticFeeds.length === 0 ? 'No clients connected.' : null}
                  {peers.map(p => (
                    <div key={p.id} style={{ borderBottom: '1px solid #eee', padding: '2px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        <span style={{ marginRight: '5px' }}>⏺</span>
                        <span>{p.name || p.id.slice(0, 8)}</span>
                        {p.stream ? 
                          <span style={{ color: '#00ff00', marginLeft: '5px', fontSize: '8px' }}>[VIDEO OK]</span> : 
                          <span style={{ color: '#ff0000', marginLeft: '5px', fontSize: '8px' }}>[NO FEED]</span>
                        }
                      </div>
                      {isElectron && (
                        <label style={{ fontSize: '8px', cursor: 'pointer' }}>
                          <input 
                            type="checkbox" 
                            checked={gridMembers.has(p.id)} 
                            onChange={() => toggleGridMember(p.id)}
                            style={{ margin: 0, verticalAlign: 'middle' }}
                          /> Grid
                        </label>
                      )}
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
                        {isElectron && (
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

                {isElectron && (
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

                {isElectron && (
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
                  {isGridShared && isConnected && (
                    <div style={{ marginBottom: '4px' }}>
                      GRID: rtmp://{serverStatus?.local || 'localhost'}/live/grid
                    </div>
                  )}
                  {peers.filter(p => p.stream).map(p => (
                    <div key={p.id} style={{ marginBottom: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name.split(' ')[0]}: rtmp://{serverStatus?.local || 'localhost'}/live/feed-{p.name.replace(/\s+/g, '-').toLowerCase()}
                    </div>
                  ))}
                  {!isGridShared && peers.filter(p => p.stream).length === 0 && (
                    <div style={{ color: '#888' }}>No active broadcasts.</div>
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

                <h3 style={{ borderBottom: '1px solid #808080', marginTop: '10px' }}>Broadcast Settings</h3>
                <div className="inset-field" style={{ fontSize: '10px', padding: '10px', marginBottom: '10px' }}>
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
                      <option value="none">Software (x264)</option>
                      <option value="nvidia">NVIDIA NVENC</option>
                      <option value="amd">AMD AMF</option>
                      <option value="intel">Intel QSV</option>
                    </select>
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
                <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
                  <div>
                    <label>Camera: </label>
                    <select className="inset-field" value={selectedVideo} onChange={(e) => setSelectedVideo(e.target.value)}>
                      <option value="">{isElectron ? 'Off' : 'Default Camera'}</option>
                      {videoDevices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>)}
                    </select>
                  </div>
                  <div>
                    <label>Mic: </label>
                    <select className="inset-field" value={selectedAudio} onChange={(e) => setSelectedAudio(e.target.value)}>
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
                ) : (
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <input 
                      className="inset-field" 
                      type="text" 
                      value={userName} 
                      onChange={(e) => setUserName(e.target.value)} 
                      placeholder="Required: Enter your name" 
                      disabled={isConnected} 
                      style={{ border: !userName.trim() ? '1px solid #ff0000' : 'none' }}
                    />
                    <button 
                      className="btn" 
                      onClick={() => setLocalCameraActive(!localCameraActive)} 
                      style={{ padding: '2px 20px', backgroundColor: localCameraActive ? '#ff000022' : '#00ff0022' }}
                    >
                      {localCameraActive ? 'STOP CAMERA' : 'START CAMERA'}
                    </button>
                    <button 
                      className="btn" 
                      onClick={isConnected ? disconnect : handleConnect} 
                      style={{ padding: '2px 20px', backgroundColor: isConnected ? '#ff000022' : '#00ff0022' }}
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
                  />
                )}
                {peers.map((peer) => (
                  <VideoFeed key={peer.id} stream={peer.stream} label={peer.name || `User ${peer.id.slice(0, 4)}`} />
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
