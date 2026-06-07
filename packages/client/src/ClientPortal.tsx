import { useState, useEffect, useRef } from 'react';
import { useWebRTC } from './hooks/useWebRTC';
import { useMediaDevices } from './hooks/useMediaDevices';
import { usePersistence } from './hooks/usePersistence';
import Lobby from './components/Lobby';
import VideoFeed from './components/VideoFeed';
import ChatBox from './components/ChatBox';
import { NTButton } from './ui/NTButton';
import { StatusTag } from './ui/StatusTag';

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

  // Derive status tag state from connection state
  const statusState = isLive ? 'live' : isConnected ? 'running' : 'idle';
  const statusLabel = isLive ? '● LIVE' : isConnected ? 'CONNECTED' : 'IDLE';

  // In-session participant view — mobile-first dark-NT layout
  return (
    <div className="ntd ntd-portal">
      {/* Status row */}
      <div>
        <StatusTag state={statusState} label={statusLabel} />
      </div>

      {/* Preview block — self view or camera error placeholder */}
      <div className="ntd-portal__preview">
        {cameraError && !userStream && (
          <div
            role="alert"
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '16px 18px',
              background: 'var(--ntd-face-2)',
              border: '2px solid var(--ntd-error)',
              color: 'var(--ntd-text)',
              boxSizing: 'border-box',
            }}
          >
            <span aria-hidden style={{ fontSize: '30px', lineHeight: 1, color: 'var(--ntd-error)' }}>
              ⚠
            </span>
            <div>
              <div style={{ fontWeight: 'bold', color: 'var(--ntd-error)', letterSpacing: '1px' }}>
                CAMERA UNAVAILABLE
              </div>
              <div style={{ fontSize: '12px', marginTop: '3px' }}>{cameraError}</div>
            </div>
          </div>
        )}
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
      </div>

      {/* Name input */}
      <input
        className={`ntd-field ntd-portal__field${!userName.trim() ? ' ntd-field--error' : ''}`}
        type="text"
        value={userName}
        onChange={(e) => setUserName(e.target.value)}
        placeholder="Required: Enter your name"
        disabled={isConnected}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />

      {/* Device selects */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 auto', minWidth: '120px' }}>
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--ntd-text-dim)', marginBottom: '3px' }}>
            Camera
          </label>
          <select
            className="ntd-field"
            style={{ width: '100%', boxSizing: 'border-box', minHeight: '44px' }}
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
          <label style={{ display: 'block', fontSize: '11px', color: 'var(--ntd-text-dim)', marginBottom: '3px' }}>
            Mic
          </label>
          <select
            className="ntd-field"
            style={{ width: '100%', boxSizing: 'border-box', minHeight: '44px' }}
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

      {/* Action bar — camera toggle + connect/disconnect */}
      <div className="ntd-portal__bar">
        <NTButton
          go={!localCameraActive}
          onClick={() => setLocalCameraActive(!localCameraActive)}
          style={{ backgroundColor: localCameraActive ? 'var(--ntd-error)' : undefined }}
        >
          {localCameraActive ? 'STOP CAMERA' : 'START CAMERA'}
        </NTButton>
        <NTButton
          go={!isConnected}
          onClick={isConnected ? disconnect : handleConnect}
          disabled={!userName.trim()}
          style={{ backgroundColor: isConnected ? 'var(--ntd-error)' : undefined }}
        >
          {isConnected ? 'DISCONNECT' : 'CONNECT TO HUB'}
        </NTButton>
      </div>

      {/* Peer feeds */}
      {peers.map((peer) => (
        <VideoFeed
          key={peer.id}
          stream={peer.stream}
          label={peer.name || `User ${peer.id.slice(0, 4)}`}
          serverLocalIP={serverStatus?.local}
        />
      ))}

      {/* Chat — pushed to bottom via margin-top: auto */}
      <div className="ntd-portal__chat">
        <ChatBox messages={chatMessages} onSendMessage={sendMessage} />
      </div>
    </div>
  );
}

export default ClientPortal;
