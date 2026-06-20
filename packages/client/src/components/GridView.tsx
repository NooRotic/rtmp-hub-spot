import React, { useEffect, useRef, useState } from 'react';
import { isElectron, getIpc } from '../hooks/useElectronBridge';
import { useNTWindow } from '../hooks/useNTWindow';

// For the Electron Admin environment
const ipc = getIpc();

interface GridViewProps {
  streams: { id: string; stream: MediaStream | undefined; label: string }[];
  onStreamUpdate?: (stream: MediaStream | null) => void;
  broadcastSettings?: {
    bitrate: string;
    preset: string;
    hwAccel: string;
  };
  autoLayout?: boolean;
  showWatermark?: boolean;
  watermarkPos?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  showSettingsOverlay?: boolean;
  /** The real LAN IP of the server, used to build the RTMP display URL. */
  serverLocalIP?: string;
  /** When set, this stream occupies 80% of the canvas; others fill a 20% bottom strip. */
  spotlightId?: string;
}

const GridView: React.FC<GridViewProps> = ({
  streams,
  onStreamUpdate,
  broadcastSettings,
  autoLayout = true,
  showWatermark = false,
  watermarkPos = 'bottom-right',
  showSettingsOverlay = false,
  serverLocalIP,
  spotlightId
}) => {
  const rtmpHost = serverLocalIP || window.location.hostname;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { containerRef, titleBarProps, resizeHandleProps, containerStyle } = useNTWindow('gridview');
  const [isPiping, setIsPiping] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const requestRef = useRef<number | undefined>(undefined);
  const tempVideosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const hasCapturedRef = useRef(false);

  useEffect(() => {
    const updateCanvasSize = () => {
      if (!canvasRef.current) return;
      
      if (autoLayout) {
        // Standard 16:9 1080p for high-quality composite
        canvasRef.current.width = 1920;
        canvasRef.current.height = 1080;
      } else if (containerRef.current) {
        // Match container size exactly for manual layout
        const rect = containerRef.current.getBoundingClientRect();
        canvasRef.current.width = rect.width * window.devicePixelRatio;
        canvasRef.current.height = rect.height * window.devicePixelRatio;
        canvasRef.current.style.width = '100%';
        canvasRef.current.style.height = '100%';
      }
    };

    updateCanvasSize();
    if (!autoLayout) {
      window.addEventListener('resize', updateCanvasSize);
      return () => window.removeEventListener('resize', updateCanvasSize);
    }
  }, [autoLayout]);

  const activeStreams = streams.filter(s => s.stream);

  useEffect(() => {
    if (onStreamUpdate && canvasRef.current && !hasCapturedRef.current) {
      const gridStream = canvasRef.current.captureStream(30);
      onStreamUpdate(gridStream);
      hasCapturedRef.current = true;
    }
  }, [onStreamUpdate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const count = activeStreams.length;

      // Clear background
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (count === 0) {
        ctx.fillStyle = '#ff0000';
        ctx.font = '20px Tahoma';
        ctx.fillText('NO INPUT FEEDS', 220, 240);
        requestRef.current = requestAnimationFrame(draw);
        return;
      }

      const spotlightStream = spotlightId ? activeStreams.find(s => s.id === spotlightId) : null;

      const ensureVideo = (s: { id: string; stream: MediaStream | undefined; label: string }) => {
        if (!tempVideosRef.current || !s.stream) return null;
        let video = tempVideosRef.current.get(s.id);
        if (!video || video.srcObject !== s.stream) {
          if (video) video.srcObject = null;
          video = document.createElement('video');
          video.srcObject = s.stream;
          video.muted = true;
          video.play().catch(() => {});
          tempVideosRef.current.set(s.id, video);
        }
        return video;
      };

      if (spotlightStream) {
        // ── Spotlight layout: 80% main + 20% thumbnail strip ────────────────
        const mainH = Math.floor(canvas.height * 0.8);
        const stripY = mainH;
        const stripH = canvas.height - mainH;
        const otherStreams = activeStreams.filter(s => s.id !== spotlightId);

        // Draw spotlight stream
        const mainVid = ensureVideo(spotlightStream);
        if (mainVid && mainVid.readyState >= 2) {
          ctx.drawImage(mainVid, 0, 0, canvas.width, mainH);
          // Name badge
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(0, 0, 180, 26);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 13px Tahoma';
          ctx.fillText(spotlightStream.label, 6, 18);
          // LIVE badge top-right
          ctx.fillStyle = '#cc0000';
          ctx.fillRect(canvas.width - 68, 6, 60, 18);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 11px Tahoma';
          ctx.fillText('◉ LIVE', canvas.width - 62, 19);
        }

        // Separator line
        ctx.fillStyle = '#000';
        ctx.fillRect(0, stripY, canvas.width, 2);

        // Draw thumbnail strip
        if (otherStreams.length > 0) {
          const thumbW = canvas.width / otherStreams.length;
          otherStreams.forEach((s, i) => {
            const vid = ensureVideo(s);
            if (vid && vid.readyState >= 2) {
              ctx.drawImage(vid, i * thumbW, stripY + 2, thumbW, stripH - 2);
              ctx.fillStyle = 'rgba(0,0,0,0.5)';
              ctx.fillRect(i * thumbW, stripY + 2, 90, 16);
              ctx.fillStyle = '#ccc';
              ctx.font = '10px Tahoma';
              ctx.fillText(s.label, i * thumbW + 4, stripY + 14);
            }
            // Thumbnail separator
            if (i > 0) {
              ctx.fillStyle = '#555';
              ctx.fillRect(i * thumbW, stripY, 1, stripH);
            }
          });
        }
      } else {
        // ── Standard auto-grid layout ────────────────────────────────────────
        const cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);
        const w = canvas.width / cols;
        const h = canvas.height / rows;

        activeStreams.forEach((s, i) => {
          if (!s.stream) return;
          const x = (i % cols) * w;
          const y = Math.floor(i / cols) * h;

          const video = ensureVideo(s);
          if (video && video.readyState >= 2) {
            ctx.drawImage(video, x, y, w, h);

            // Draw Label
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(x, y, 100, 20);
            ctx.fillStyle = '#fff';
            ctx.font = '12px Tahoma';
            ctx.fillText(s.label, x + 5, y + 15);
          }
        });
      }

      // Internal Status (Diagnostic)
      ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
      ctx.fillRect(5, canvas.height - 20, 150, 15);
      ctx.fillStyle = '#0f0';
      ctx.font = '10px Courier New';
      ctx.fillText(`GRID ACTIVE: ${count} FEEDS`, 10, canvas.height - 8);

      // Diagnostic Overlay (Burn-in Settings)
      if (showSettingsOverlay && broadcastSettings) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(5, 5, 200, 50);
        ctx.fillStyle = '#0f0';
        ctx.font = '12px Courier New';
        ctx.fillText(`BITRATE: ${broadcastSettings.bitrate}`, 10, 20);
        ctx.fillText(`PRESET:  ${broadcastSettings.preset}`, 10, 35);
        ctx.fillText(`ENC/HW:  ${broadcastSettings.hwAccel}`, 10, 50);
      }

      // Timestamp Watermark
      if (showWatermark) {
        const timestamp = new Date().toLocaleString();
        ctx.font = 'bold 18px Tahoma';
        const txtWidth = ctx.measureText(timestamp).width;
        let x = 0, y = 0;
        
        switch (watermarkPos) {
          case 'top-left':
            x = 10;
            y = 25;
            break;
          case 'top-right':
            x = canvas.width - txtWidth - 10;
            y = 25;
            break;
          case 'bottom-left':
            x = 10;
            y = canvas.height - 35;
            break;
          case 'bottom-right':
            x = canvas.width - txtWidth - 10;
            y = canvas.height - 35;
            break;
        }

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(x - 5, y - 18, txtWidth + 10, 24);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(timestamp, x, y);
      }

      // Cleanup videos for streams that are gone
      if (!tempVideosRef.current) return;
      const currentIds = new Set(activeStreams.map(s => s.id));
      for (const [id, video] of tempVideosRef.current.entries()) {
        if (!currentIds.has(id)) {
          video.pause();
          video.srcObject = null;
          video.load();
          tempVideosRef.current.delete(id);
        }
      }

      requestRef.current = requestAnimationFrame(draw);
    };

    requestRef.current = requestAnimationFrame(draw);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [activeStreams, spotlightId]);

  const toggleGridPipe = () => {
    if (!ipc || !canvasRef.current) return;

    if (isPiping) {
      mediaRecorderRef.current?.stop();
      ipc.send('ffmpeg-pipe-stop');
      setIsPiping(false);
    } else {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }

      console.log('[GridView] Starting MediaRecorder for Grid Broadcast...');

      const stream = canvasRef.current.captureStream(30);
      let recorder: MediaRecorder;
      try {
        // Prefer vp8 explicitly — ensures stable WebM container structure
        const mimeType = MediaRecorder.isTypeSupported('video/webm; codecs=vp8')
          ? 'video/webm; codecs=vp8'
          : 'video/webm';
        recorder = new MediaRecorder(stream, { mimeType });
        console.log('[GridView] MediaRecorder created with:', recorder.mimeType);
      } catch (e: any) {
        console.error('[GridView] Failed to create MediaRecorder:', e);
        return;
      }

      let chunkCount = 0;
      let pipeStarted = false;

      recorder.ondataavailable = async (event) => {
        if (event.data.size === 0) return;
        try {
          const buffer = await event.data.arrayBuffer();
          const uint8 = new Uint8Array(buffer);
          chunkCount++;

          if (!pipeStarted) {
            // Start FFmpeg ONLY after we have the first chunk, which always
            // contains the WebM initialization segment (EBML header + keyframe).
            // This prevents "Discarding interframe without a prior keyframe" errors.
            console.log('[GridView] First chunk received — starting FFmpeg pipe.');
            ipc.send('ffmpeg-pipe-start', {
              ...broadcastSettings,
              streamKey: 'grid'
            });
            pipeStarted = true;
            // Give FFmpeg ~100ms to initialize its stdin before writing
            await new Promise(r => setTimeout(r, 100));
          }

          if (chunkCount <= 10) {
            console.log(`[GridView] Sending chunk #${chunkCount}: ${uint8.length} bytes for grid`);
          }
          ipc.send('ffmpeg-pipe-chunk', { chunk: uint8, streamKey: 'grid' });
        } catch (err) {
          console.error('[GridView] Error processing chunk:', err);
        }
      };

      recorder.onerror = (err) => console.error('[GridView] MediaRecorder error:', err);

      // 500ms chunks give FFmpeg a bigger initial block containing the full header
      recorder.start(500);
      mediaRecorderRef.current = recorder;
      setIsPiping(true);
    }
  };

  return (
    <div ref={containerRef} className="window resizable" style={{ width: '100%', maxWidth: '100%', marginTop: '20px', ...containerStyle }}>
      <div className="window-title" onMouseDown={titleBarProps.onMouseDown} onDoubleClick={titleBarProps.onDoubleClick} style={titleBarProps.style}>
        <span>Combined Grid View</span>
        {isElectron && (
          <button className="btn" onClick={toggleGridPipe} style={{ padding: '0 4px' }}>
            {isPiping ? 'STOP GRID BROADCAST' : 'START GRID BROADCAST'}
          </button>
        )}
      </div>
      <div 
        className="window-content" 
        style={{ 
          backgroundColor: '#404040', 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center',
          flexGrow: 1,
          minHeight: '200px',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <div style={{ fontSize: '10px', color: '#ccc', marginBottom: '5px', zIndex: 5 }}>
          {isPiping ? (
            <span>RTMP LIVE: <strong style={{color: '#00ff00'}}>rtmp://{rtmpHost}/live/grid</strong></span>
          ) : (
            <span>Ready to pipe to local RTMP (Source for OBS)</span>
          )}
        </div>
        <canvas 
          ref={canvasRef} 
          width={640} 
          height={480} 
          style={{ width: '100%', height: 'auto', border: '1px solid #000' }}
        />
      </div>
      <div className="resizable-handle" onMouseDown={resizeHandleProps.onMouseDown}></div>
    </div>
  );
};

export default GridView;
