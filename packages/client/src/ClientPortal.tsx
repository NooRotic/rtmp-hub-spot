import { useState, useEffect, useRef } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useMediaDevices } from './hooks/useMediaDevices';
import { usePersistence } from './hooks/usePersistence';
import Lobby from './components/Lobby';
import VideoFeed from './components/VideoFeed';
import ChatBox from './components/ChatBox';

/**
 * Self-contained browser-participant component.
 *
 * Owns its own useWebRTC instance + all participant state + lobby flow.
 * Reproduces the current participant behavior from AdminApp's non-electron,
 * non-adminMode branch, extracted into its own isolated component.
 *
 * Not wired into App yet — a later routing task does that.
 */
export function ClientPortal() {
  const [lobbyDone, setLobbyDone] = useState(false);
  const [userName, setUserName] = useState<string>(
    () => localStorage.getItem('hub-username') || ''
  );
  const [selectedVideo, setSelectedVideo] = useState<string>(
    () => localStorage.getItem('hub-video-device') || ''
  );
  const [selectedAudio, setSelectedAudio] = useState<string>(
    () => localStorage.getItem('hub-audio-device') || ''
  );
  const [localCameraActive, setLocalCameraActive] = useState(false);
  const pendingConnectRef = useRef(false);

  usePersistence(selectedVideo, selectedAudio);
  const { videoDevices, audioDevices } = useMediaDevices();

  const {
    isConnected,
    peers,
    userStream,
    cameraError,
    isVideoEnabled,
    setIsVideoEnabled,
    isAudioEnabled,
    setIsAudioEnabled,
    chatMessages,
    sendMessage,
    disconnect,
    connect,
    wasKicked,
    isLive,
    serverStatus,
  } = useWebRTC('main-hub', {
    videoId: localCameraActive ? (selectedVideo || undefined) : undefined,
    audioId: localCameraActive ? (selectedAudio || undefined) : undefined,
    userName,
    cameraLabel:
      videoDevices.find((d) => d.deviceId === selectedVideo)?.label ||
      'Default Camera',
    captureVideo: localCameraActive,
    overrideStream: null,
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

  // Connect after lobby sets userName (state update is async, so we use a ref flag)
  useEffect(() => {
    if (pendingConnectRef.current && lobbyDone && userName) {
      pendingConnectRef.current = false;
      connect();
    }
  }, [userName, lobbyDone]); // eslint-disable-line react-hooks/exhaustive-deps

  // When kicked: reset to lobby state
  useEffect(() => {
    if (wasKicked) {
      setLobbyDone(false);
      setLocalCameraActive(false);
    }
  }, [wasKicked]);

  // Pre-flight lobby
  if (!lobbyDone) {
    return (
      <Lobby
        onJoin={handleLobbyJoin}
        initialName={userName}
        wasKicked={wasKicked}
      />
    );
  }

  // In-session participant view
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {isLive && <div className="live-banner">◉ YOU ARE LIVE</div>}

      <div className="ntd" style={{ flex: 1, padding: '20px', overflowY: 'auto' }}>
        <div className="window ntd">
          <div className="window-title">
            <span>Client Participant Portal</span>
          </div>
          <div className="window-content">
            <div className="inset-field" style={{ marginBottom: '15px' }}>
              {/* Device selects */}
              <div style={{ display: 'flex', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 auto', minWidth: '120px' }}>
                  <label>Camera: </label>
                  <select
                    className="ntd-field"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    value={selectedVideo}
                    onChange={(e) => setSelectedVideo(e.target.value)}
                  >
                    <option value="">Default Camera</option>
                    {videoDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || 'Camera'}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: '1 1 auto', minWidth: '120px' }}>
                  <label>Mic: </label>
                  <select
                    className="ntd-field"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    value={selectedAudio}
                    onChange={(e) => setSelectedAudio(e.target.value)}
                  >
                    <option value="">Default Mic</option>
                    {audioDevices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || 'Microphone'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Name + camera toggle + connect/disconnect controls */}
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="ntd-field"
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Required: Enter your name"
                  disabled={isConnected}
                  style={{
                    border: !userName.trim() ? '2px solid var(--ntd-error)' : 'none',
                    flex: '1 1 140px',
                    minWidth: '140px',
                  }}
                />
                <button
                  className="ntd-btn"
                  onClick={() => setLocalCameraActive(!localCameraActive)}
                  style={{
                    padding: '6px 16px',
                    backgroundColor: localCameraActive
                      ? 'var(--ntd-error)'
                      : 'var(--ntd-go)',
                    flex: '1 1 auto',
                  }}
                >
                  {localCameraActive ? 'STOP CAMERA' : 'START CAMERA'}
                </button>
                <button
                  className="ntd-btn"
                  onClick={isConnected ? disconnect : handleConnect}
                  style={{
                    padding: '6px 16px',
                    backgroundColor: isConnected
                      ? 'var(--ntd-error)'
                      : 'var(--ntd-go)',
                    flex: '1 1 auto',
                  }}
                  disabled={!userName.trim()}
                >
                  {isConnected ? 'DISCONNECT' : 'CONNECT TO HUB'}
                </button>
              </div>
            </div>

            {/* Camera error placeholder */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
              {cameraError && !userStream && (
                <div
                  role="alert"
                  style={{
                    flex: '1 1 100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    padding: '16px 18px',
                    background: 'var(--ntd-face-2)',
                    border: '2px solid var(--ntd-error)',
                    color: 'var(--ntd-text)',
                  }}
                >
                  <span aria-hidden style={{ fontSize: '30px', lineHeight: 1, color: 'var(--ntd-error)' }}>
                    ⚠
                  </span>
                  <div>
                    <div
                      style={{
                        fontWeight: 'bold',
                        color: 'var(--ntd-error)',
                        letterSpacing: '1px',
                      }}
                    >
                      CAMERA UNAVAILABLE
                    </div>
                    <div style={{ fontSize: '12px', marginTop: '3px' }}>{cameraError}</div>
                  </div>
                </div>
              )}

              {/* Self view */}
              {userStream && (
                <VideoFeed
                  stream={userStream}
                  label={`${userName} (Self)`}
                  isLocal
                  isVideoEnabled={isVideoEnabled}
                  setIsVideoEnabled={setIsVideoEnabled}
                  isAudioEnabled={isAudioEnabled}
                  setIsAudioEnabled={setIsAudioEnabled}
                  serverLocalIP={serverStatus?.local}
                />
              )}

              {/* Peer feeds */}
              {peers.map((peer) => (
                <VideoFeed
                  key={peer.id}
                  stream={peer.stream}
                  label={peer.name || `User ${peer.id.slice(0, 4)}`}
                  serverLocalIP={serverStatus?.local}
                />
              ))}
            </div>

            {/* Chat */}
            <ChatBox messages={chatMessages} onSendMessage={sendMessage} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ClientPortal;
