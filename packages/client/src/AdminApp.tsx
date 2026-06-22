import { useState, useEffect, useMemo, useCallback } from 'react';
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
import {
  AdminActionsContext,
  AdminTelemetryContext,
  type AdminActions,
  type AdminTelemetry,
} from './admin/AdminDataProvider';
import { AdminTopBar } from './admin/AdminTopBar';
import { useChatUnread } from './admin/hooks/useChatUnread';
import { StageZone } from './admin/zones/StageZone';
import { ConsoleZone } from './admin/zones/ConsoleZone';
import { AdminDrawers } from './admin/zones/AdminDrawers';
import { useDrawerState } from './hooks/useDrawerState';
import { useOverlaySettings } from './hooks/useOverlaySettings';
import { useGridState } from './hooks/useGridState';
import { useSyntheticFeeds } from './hooks/useSyntheticFeeds';

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
  const {
    settingsOpen, recOpen, addFeedOpen,
    setSettingsOpen, setRecOpen, setAddFeedOpen,
  } = useDrawerState();

  // Grid management state (membership Set + display/share toggles).
  // showGrid defaults to isElectron, so the hook takes isElectron as an arg.
  const {
    gridMembers, addGridMember, removeGridMember, toggleGridMember,
    gridAutoLayout, setGridAutoLayout,
    spotlightId, setSpotlightId,
    previewOpen, setPreviewOpen,
    showGrid, setShowGrid,
    gridStream, setGridStream,
    isGridShared, setIsGridShared,
  } = useGridState(isElectron);

  const [selectedVideo, setSelectedVideo] = useState<string>(localStorage.getItem('hub-video-device') || '');
  const [selectedAudio, setSelectedAudio] = useState<string>(localStorage.getItem('hub-audio-device') || '');
  const [userName] = useState<string>(() => {
    if (isElectron) return 'Admin';
    if (isAdminMode) return 'Admin Monitor';
    return localStorage.getItem('hub-username') || '';
  });
  const [adminCamActive, setAdminCamActive] = useState<boolean>(false);

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
  const {
    showWatermark, setShowWatermark,
    watermarkPos, setWatermarkPos,
    showSettingsOverlay, setShowSettingsOverlay,
  } = useOverlaySettings();

  usePersistence(selectedVideo, selectedAudio);

  const { videoDevices, audioDevices } = useMediaDevices();

  const currentVideoDevice = videoDevices.find(d => d.deviceId === selectedVideo);
  // Strip the trailing USB hardware id Chrome appends to device labels
  // (e.g. "Elgato 4K X (0fd9:0091)" -> "Elgato 4K X") so the broadcast/peer
  // name shown to clients is clean.
  const cameraLabel = (currentVideoDevice?.label || (isElectron ? 'Admin Hub' : 'Default Camera'))
    .replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '');
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

  // RTMP synthetic feeds — owns the feed list, form fields, mpegts players, and
  // both effects. onFeedLive/onFeedRemoved wire feed lifecycle to grid membership
  // (preserving today's "a feed auto-joins the grid when it goes live" behavior).
  const {
    syntheticFeeds,
    newFeedKey, setNewFeedKey,
    newFeedLabel, setNewFeedLabel,
    addSyntheticFeed, removeSyntheticFeed,
  } = useSyntheticFeeds({
    serverStatus,
    onFeedLive: addGridMember,
    onFeedRemoved: removeGridMember,
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

  // `allStreams` is the single source for GridView. Grid membership (`gridMembers`)
  // now gates which tiles compose the grid:
  //  - PEERS are always included (default-in) — there is no per-peer membership
  //    checkbox, so they must NOT be filtered by gridMembers.
  //  - LOCAL ('local') is included only when its existing condition holds AND
  //    gridMembers.has('local') (the Settings "Include Admin" checkbox).
  //  - FEEDS are included only when streamed AND gridMembers.has(feed.id) (the
  //    per-feed "Grid" checkbox).
  // gridMembers is seeded with 'local' and feeds auto-add on live, so the default
  // grid is visually identical to before — only unchecking now removes a tile.
  const allStreams = useMemo(() => [
    ...(userStream && (adminCamActive || isGridShared) && gridMembers.has('local') ? [{
      id: 'local',
      stream: userStream,
      label: `Admin Hub - ${broadcastLabel}`
    }] : []),
    ...peers.filter(p => p.stream).map(p => ({
      id: p.id,
      stream: p.stream as MediaStream,
      label: p.name
    })),
    ...syntheticFeeds.filter(f => f.stream && gridMembers.has(f.id)).map(f => ({
      id: f.id,
      stream: f.stream as MediaStream,
      label: `[Feed] ${f.label}`
    }))
  ], [userStream, adminCamActive, isGridShared, broadcastLabel, peers, syntheticFeeds, gridMembers]);

  // ── Context split (Phase 3) ──────────────────────────────────────────────
  // Two memos with DISJOINT dep arrays so the STABLE (actions) value's identity
  // survives a telemetry tick. The actions memo MUST NOT depend on any volatile
  // field (socketStatus/isConnected/serverStatus/relays/ffmpeg*/activeRecordings/
  // recNow/sources) — only on config, action callbacks, and preview state.
  const actionsValue: AdminActions = useMemo(() => ({
    destinations,
    bindings,
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
    destinations, bindings,
    broadcastBitrate, setBroadcastBitrate, broadcastPreset, setBroadcastPreset, hwAccel, setHwAccel, detectedEncoder,
    addDestination, updateDestination, removeDestination, setBinding, removeBinding, refreshDestinations,
    roomLocked, setRoomPin, clearRoomPin,
    previewOpen, setPreviewOpen, refreshTelemetry,
  ]);

  const telemetryValue: AdminTelemetry = useMemo(() => ({
    socketStatus,
    isConnected,
    serverStatus: (serverStatus ?? null) as AdminTelemetry['serverStatus'],
    sources: deriveSources(serverStatus ?? null, bindings),
    relays,
    ffmpeg: { status: ffmpegStatus, stats: ffmpegStats },
    recordings: { active: activeRecordings, now: recNow, start: startRecording, stop: stopRecording, openDir: openRecordingsDir },
  }), [
    socketStatus, isConnected, serverStatus, bindings, relays,
    ffmpegStatus, ffmpegStats, activeRecordings, recNow,
    startRecording, stopRecording, openRecordingsDir,
  ]);

  return (
    <AdminActionsContext.Provider value={actionsValue}>
    <AdminTelemetryContext.Provider value={telemetryValue}>
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
        <StageZone
          isElectron={isElectron}
          isAdminMode={isAdminMode}
          deviceControls={{
            videoDevices, audioDevices,
            selectedVideo, setSelectedVideo,
            selectedAudio, setSelectedAudio,
          }}
          broadcastControls={{
            adminCamActive, setAdminCamActive,
            showGrid, setShowGrid,
            isGridShared, setIsGridShared,
          }}
          selfFeed={{
            cameraError, userStream,
            isVideoEnabled, setIsVideoEnabled,
            isAudioEnabled, setIsAudioEnabled,
            serverLocalIP: serverStatus?.local,
          }}
          peerControls={{ peers, spotlightId, setSpotlightId, kickUser }}
          gridControls={{
            allStreams, setGridStream,
            broadcastBitrate, broadcastPreset, hwAccel,
            gridAutoLayout, showWatermark, watermarkPos, showSettingsOverlay,
          }}
        />

        {/* ── ZONE 3: Persistent broadcast console + docked chat (side by side) ── */}
        <ConsoleZone
          chatOpen={chatOpen}
          chatMessages={chatMessages}
          onSendMessage={sendMessage}
          onCloseChat={() => setChatOpen(false)}
        />
      </div>

      {/* ── ZONE 4: Drawers ── */}
      <AdminDrawers
        drawers={{
          settingsOpen, recOpen, addFeedOpen,
          onCloseSettings: () => setSettingsOpen(false),
          onCloseRecordings: () => setRecOpen(false),
          onCloseAddFeed: () => setAddFeedOpen(false),
        }}
        settingsControls={{
          isAdminMode,
          includeAdmin: gridMembers.has('local'),
          toggleGridMember,
          gridAutoLayout, setGridAutoLayout,
          showWatermark, setShowWatermark,
          watermarkPos, setWatermarkPos,
          showSettingsOverlay, setShowSettingsOverlay,
          streamCount: allStreams.length,
          rtmpCount: serverStatus?.rtmpCount || 0,
        }}
        feedControls={{
          newFeedKey, setNewFeedKey,
          newFeedLabel, setNewFeedLabel,
          addSyntheticFeed, removeSyntheticFeed,
          syntheticFeeds,
          isGridMember: (id: string) => gridMembers.has(id),
          toggleGridMember,
        }}
      />
    </div>
    </AdminTelemetryContext.Provider>
    </AdminActionsContext.Provider>
  );
}

export default AdminApp;
