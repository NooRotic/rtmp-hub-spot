import React, { useEffect, useRef, useState } from 'react';

const isElectron = navigator.userAgent.toLowerCase().indexOf(' electron/') > -1;
const ipc = isElectron ? (window as any).require('electron').ipcRenderer : null;

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
}

const GridView: React.FC<GridViewProps> = ({ 
  streams, 
  onStreamUpdate, 
  broadcastSettings, 
  autoLayout = true,
  showWatermark = false,
  watermarkPos = 'bottom-right',
  showSettingsOverlay = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPiping, setIsPiping] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const requestRef = useRef<number | undefined>(undefined);
  const tempVideosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const hasCapturedRef = useRef(false);

  useEffect(() => {
    const savedSize = localStorage.getItem('hub-size-gridview');
    if (savedSize && containerRef.current) {
      const { width, height } = JSON.parse(savedSize);
      containerRef.current.style.width = width;
      containerRef.current.style.height = height;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        localStorage.setItem('hub-size-gridview', JSON.stringify({ 
          width: `${entry.target.clientWidth}px`, 
          height: `${entry.target.clientHeight}px` 
        }));
      }
    });

    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

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

      // Calculate grid (e.g., 2x2 for 4 streams)
      const cols = Math.ceil(Math.sqrt(count));
      const rows = Math.ceil(count / cols);
      const w = canvas.width / cols;
      const h = canvas.height / rows;

      activeStreams.forEach((s, i) => {
        if (!s.stream) return;
        const x = (i % cols) * w;
        const y = Math.floor(i / cols) * h;
        
        if (!tempVideosRef.current) return;
        let video = tempVideosRef.current.get(s.id);
        if (!video || video.srcObject !== s.stream) {
          if (video) {
            video.srcObject = null;
          }
          video = document.createElement('video');
          video.srcObject = s.stream;
          video.muted = true;
          video.play().catch(() => {});
          tempVideosRef.current.set(s.id, video);
        }

        if (video.readyState >= 2) {
          ctx.drawImage(video, x, y, w, h);
          
          // Draw Label
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(x, y, 100, 20);
          ctx.fillStyle = '#fff';
          ctx.font = '12px Tahoma';
          ctx.fillText(s.label, x + 5, y + 15);
        }
      });

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
  }, [activeStreams]);

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
      
      ipc.send('ffmpeg-pipe-start', {
        ...broadcastSettings,
        streamKey: 'grid'
      });
      console.log('[GridView] Starting MediaRecorder for Grid Broadcast...');
      
      const stream = canvasRef.current.captureStream(30);
      let recorder: MediaRecorder;
      try {
        const options = { mimeType: 'video/webm' };
        if (MediaRecorder.isTypeSupported('video/webm; codecs=vp8')) {
          (options as any).codecs = 'vp8';
        }
        recorder = new MediaRecorder(stream, options);
        console.log('[GridView] MediaRecorder created with:', recorder.mimeType);
      } catch (e: any) {
        console.error('[GridView] Failed to create MediaRecorder:', e);
        return;
      }
      
      let chunkCount = 0;
      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          try {
            const buffer = await event.data.arrayBuffer();
            const uint8 = new Uint8Array(buffer);
            chunkCount++;
            if (chunkCount < 10) {
              console.log(`[GridView] Sending chunk #${chunkCount}: ${uint8.length} bytes for grid`);
            }
            ipc.send('ffmpeg-pipe-chunk', { chunk: uint8, streamKey: 'grid' });
          } catch (err) {
            console.error('[GridView] Error processing chunk:', err);
          }
        }
      };
      
      recorder.onerror = (err) => console.error('[GridView] MediaRecorder error:', err);
      
      recorder.start(200); // 200ms chunks for stability
      mediaRecorderRef.current = recorder;
      setIsPiping(true);
    }
  };

  return (
    <div ref={containerRef} className="window resizable" style={{ width: '100%', maxWidth: '100%', marginTop: '20px' }}>
      <div className="window-title">
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
            <span>RTMP LIVE: <strong style={{color: '#00ff00'}}>rtmp://{window.location.hostname}/live/grid</strong></span>
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
      <div className="resizable-handle"></div>
    </div>
  );
};

export default GridView;
