import { type FC, useState, useRef, useEffect } from 'react';

interface LobbyProps {
  onJoin: (name: string) => void;
  initialName?: string;
  wasKicked?: boolean;
}

/**
 * Pre-flight lobby for browser (non-Electron) clients.
 * Shows a camera preview and name input before joining the hub.
 */
const Lobby: FC<LobbyProps> = ({ onJoin, initialName = '', wasKicked = false }) => {
  const [name, setName] = useState(initialName);
  const [cameraState, setCameraState] = useState<'checking' | 'ready' | 'denied'>('checking');
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('denied');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(stream => {
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraState('ready');
      })
      .catch(() => setCameraState('denied'));

    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
  }, []);

  const handleJoin = () => {
    if (!name.trim()) return;
    // Stop preview — the hook will open a fresh getUserMedia after join
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    onJoin(name.trim());
  };

  return (
    <div className="lobby-overlay">
      <div className="lobby-window window">
        <div className="window-title">RTMP Hub Spot — Join Session</div>
        <div className="window-content" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {wasKicked && (
            <div style={{ background: '#fff0f0', border: '1px solid #cc0000', padding: '6px 10px', color: '#cc0000', fontSize: '11px', fontWeight: 'bold' }}>
              You were removed from the session by the admin.
            </div>
          )}
          <div className="lobby-preview">
            {cameraState === 'ready' ? (
              <video ref={videoRef} autoPlay muted playsInline className="lobby-video" />
            ) : cameraState === 'denied' ? (
              <div className="lobby-no-cam">Camera unavailable — check permissions</div>
            ) : (
              <div className="lobby-no-cam">Checking camera…</div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '11px', fontWeight: 'bold' }}>Your Display Name:</label>
            <input
              className="inset-field"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleJoin()}
              placeholder="Enter your name"
              autoFocus
              style={{ fontSize: '13px', padding: '6px 8px' }}
            />
            <button
              className="btn lobby-join-btn"
              onClick={handleJoin}
              disabled={!name.trim()}
            >
              JOIN HUB
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Lobby;
