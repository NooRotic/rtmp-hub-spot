import React, { useEffect, useRef, useState } from 'react';
import { feedKey } from '../utils/streamKey';
import { isElectron, getIpc } from '../hooks/useElectronBridge';
import { useNTWindow } from '../hooks/useNTWindow';

// For the Electron Admin environment
const ipc = getIpc();

interface VideoFeedProps {
  stream?: MediaStream;
  label: string;
  isLocal?: boolean;
  isVideoEnabled?: boolean;
  setIsVideoEnabled?: (val: boolean) => void;
  isAudioEnabled?: boolean;
  setIsAudioEnabled?: (val: boolean) => void;
  /** The real LAN IP of the server, used to display the RTMP stream URL. */
  serverLocalIP?: string;
  /** Detected best encoder (e.g. 'nvidia') used as the tile's default until the
   *  user picks one from the dropdown. Falls back to 'none' (software). */
  defaultHwAccel?: string;
}

const VideoFeed: React.FC<VideoFeedProps> = ({ 
  stream, label, isLocal, 
  isVideoEnabled = true, setIsVideoEnabled, 
  isAudioEnabled = true, setIsAudioEnabled,
  serverLocalIP, defaultHwAccel
}) => {
  const rtmpHost = serverLocalIP || window.location.hostname;
  const videoRef = useRef<HTMLVideoElement>(null);
  const { containerRef, titleBarProps, resizeHandleProps, containerStyle } = useNTWindow(label);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [isPiping, setIsPiping] = useState(false);
  const [hwAccel, setHwAccel] = useState(defaultHwAccel && defaultHwAccel !== 'none' ? defaultHwAccel : 'none');
  const userPickedHwAccelRef = useRef(false);

  // Adopt the detected best encoder as the tile default until the user picks one.
  // The per-tile dropdown is otherwise born 'none' (software) regardless of GPU,
  // which is why NVENC wasn't the default even on a 4080 box. A user override
  // (onChange below latches the ref) is never clobbered.
  useEffect(() => {
    if (userPickedHwAccelRef.current) return;
    if (defaultHwAccel && defaultHwAccel !== 'none' && defaultHwAccel !== hwAccel) {
      setHwAccel(defaultHwAccel);
    }
  }, [defaultHwAccel]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const toggleVirtualCam = () => {
    if (!ipc || !stream) return;

    if (isPiping) {
      mediaRecorderRef.current?.stop();
      ipc.send('ffmpeg-pipe-stop');
      setIsPiping(false);
    } else {
      const streamKey = feedKey(label);
      const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp8')
        ? 'video/webm; codecs=vp8'
        : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      let pipeStarted = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        event.data.arrayBuffer().then(async (buffer) => {
          if (!pipeStarted) {
            // Delay pipe-start until first chunk (contains WebM header + keyframe)
            ipc.send('ffmpeg-pipe-start', { hwAccel, streamKey });
            pipeStarted = true;
            await new Promise(r => setTimeout(r, 100));
          }
          ipc.send('ffmpeg-pipe-chunk', { chunk: buffer, streamKey });
        });
      };
      recorder.start(500); // 500ms chunks for stable header delivery
      mediaRecorderRef.current = recorder;
      setIsPiping(true);
    }
  };

  useEffect(() => {
    if (!ipc) return;
    const handleError = (_: any, msg: string) => {
      console.error('[FFMPEG Error]', msg);
      setIsPiping(false);
    };
    ipc.on('ffmpeg-error', handleError);
    return () => {
      ipc.removeListener('ffmpeg-error', handleError);
    };
  }, []);

  return (
    <div ref={containerRef} className="window resizable" style={{ display: 'inline-block', margin: '5px', ...containerStyle }}>
      <div className="window-title" onMouseDown={titleBarProps.onMouseDown} onDoubleClick={titleBarProps.onDoubleClick} style={titleBarProps.style}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span>{label} {isLocal ? '(Self)' : ''}</span>
          {isLocal && setIsVideoEnabled && setIsAudioEnabled && (
            <div style={{ display: 'flex', gap: '2px' }}>
              <button 
                className="btn" 
                onClick={() => setIsVideoEnabled(!isVideoEnabled)}
                style={{ padding: '0 4px', fontSize: '9px', backgroundColor: isVideoEnabled ? '#cfcfcf' : '#ff9999' }}
              >
                {isVideoEnabled ? 'HIDE' : 'SHOW'}
              </button>
              <button 
                className="btn" 
                onClick={() => setIsAudioEnabled(!isAudioEnabled)}
                style={{ padding: '0 4px', fontSize: '9px', backgroundColor: isAudioEnabled ? '#cfcfcf' : '#ff9999' }}
              >
                {isAudioEnabled ? 'MUTE' : 'TALK'}
              </button>
            </div>
          )}
        </div>
        {isElectron && (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <select 
              className="inset-field" 
              style={{ fontSize: '9px', padding: '0' }}
              value={hwAccel}
              onChange={(e) => { userPickedHwAccelRef.current = true; setHwAccel(e.target.value); }}
            >
              <option value="none">Soft</option>
              <option value="nvidia">NVENC</option>
              <option value="amd">AMF</option>
              <option value="intel">QSV</option>
            </select>
            <button className="btn" onClick={toggleVirtualCam} style={{ padding: '0 4px', fontSize: '9px' }}>
              {isPiping ? 'STOP' : 'BROADCAST'}
            </button>
          </div>
        )}
      </div>
      <div className="window-content" style={{ padding: '2px', height: 'calc(100% - 25px)', position: 'relative' }}>
        {isPiping && (
          <div style={{ 
            position: 'absolute', top: 5, left: 5, right: 5, zIndex: 10,
            backgroundColor: 'rgba(0,0,0,0.7)', color: '#0f0', fontSize: '8px', padding: '2px'
          }}>
            RTMP: rtmp://{rtmpHost}/live/{feedKey(label)}
          </div>
        )}
        <video
          ref={videoRef}
          autoPlay
          muted={true} // Hard-mute for now to guarantee autoplay works every time
          playsInline
          style={{ width: '100%', height: '100%', backgroundColor: '#000', display: 'block', objectFit: 'cover' }}
          onPlay={() => console.log(`[VideoFeed] Playing feed: ${label}`)}
          onLoadedMetadata={(e) => {
            const video = e.target as HTMLVideoElement;
            console.log(`[VideoFeed] Metadata loaded: ${video.videoWidth}x${video.videoHeight}`);
          }}
          onResize={(e) => {
             const video = e.target as HTMLVideoElement;
             console.log(`[VideoFeed] Video resized: ${video.videoWidth}x${video.videoHeight}`);
          }}
        />
      </div>
      <div className="resizable-handle" onMouseDown={resizeHandleProps.onMouseDown}></div>
    </div>
  );
};

export default VideoFeed;
