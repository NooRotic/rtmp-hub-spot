import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';

import { isElectron } from './useElectronBridge';
export { isElectron };

/**
 * Hook to manage Socket.io signaling and Simple-Peer connections for a Full Mesh WebRTC network.
 * 
 * Supports dynamically switching camera tracks or substituting entirely synthetic overrides (e.g. Grid capture streams).
 * 
 * @param {string} roomId - The specific socket room to join. The hub forces this to 'main-hub'.
 * @param {Object} options - Configuration overrides.
 * @param {string} [options.videoId] - Device ID for the local camera.
 * @param {string} [options.audioId] - Device ID for the local microphone.
 * @param {string} [options.userName] - Display name emitted across the signal transport.
 * @param {string} [options.cameraLabel] - Detailed label summarizing the selected hardware for the UI.
 * @param {boolean} [options.captureVideo] - Determines if the hook should automatically request system getUserMedia constraints upon mount.
 * @param {RTCIceServer[]} [options.iceServers] - Override default google ICE servers for NAT traversal.
 * @param {MediaStream|null} [options.overrideStream] - A synthetic MediaStream that circumvents the getUserMedia flow (used heavily by the Admin Grid).
 */
export const useWebRTC = (roomId: string, options: { videoId?: string; audioId?: string; userName?: string; cameraLabel?: string; captureVideo?: boolean; iceServers?: RTCIceServer[]; overrideStream?: MediaStream | null; pin?: string } = {}) => {
  const { videoId, audioId, userName, cameraLabel, captureVideo, iceServers, overrideStream, pin } = options;
  const [peers, setPeers] = useState<{ id: string; name: string; peer: any; stream?: MediaStream }[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [socketStatus, setSocketStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [userStream, setUserStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<{ senderName: string, message: string, timestamp: number }[]>([]);
  const [recordingStopped, setRecordingStopped] = useState<{ streamKey: string; reason: string } | null>(null);
  const [wasKicked, setWasKicked] = useState(false);
  const [joinDenied, setJoinDenied] = useState<{ reason: string } | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [serverStatus, setServerStatus] = useState<{ 
    local: string; 
    public: string; 
    clientCount: number; 
    rtmpCount: number;
    rtmpSessions: { 
      id: string, 
      ip: string, 
      path: string, 
      startTime: number,
      uptime: number,
      bitrate: number,
      bytes: number
    }[];
    rtmpPublishers: {
      streamKey: string,
      ip: string,
      path: string,
      uptime: number
    }[];
  } | null>(null);
  const socketRef = useRef<any>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<{ id: string; name: string; peer: any }[]>([]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 10;
  const RECONNECT_BASE_DELAY_MS = 2000;
  // Refs to always reflect the latest prop values inside async callbacks and timers
  const userNameRef = useRef(userName ?? '');
  const cameraLabelRef = useRef(cameraLabel ?? '');
  const pinRef = useRef(pin ?? '');

  const addLocalStatus = (message: string) => {
    setChatMessages(prev => [...prev.slice(-49), {
      senderName: '[Local Status Message]',
      message: message,
      timestamp: Date.now()
    }]);
  };

  const config: Peer.Options = {
    config: {
      iceServers: iceServers || [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    }
  };

  /**
   * Destroy all active peer connections and clear refs.
   * Called before reconnecting so stale peers don't accumulate.
   */
  const cleanupPeers = () => {
    peersRef.current.forEach(p => { try { p.peer.destroy(); } catch (_) {} });
    peersRef.current = [];
    setPeers([]);
  };

  /**
   * Schedule a reconnect attempt with exponential backoff.
   * Stops after MAX_RECONNECT_ATTEMPTS consecutive failures.
   */
  const scheduleReconnect = () => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      addLocalStatus('Max reconnect attempts reached. Reload the page to try again.');
      setSocketStatus('error');
      return;
    }
    const delay = RECONNECT_BASE_DELAY_MS * Math.pow(1.5, reconnectAttemptsRef.current);
    reconnectAttemptsRef.current += 1;
    addLocalStatus(`Reconnecting in ${Math.round(delay / 1000)}s… (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connectInternal();
    }, delay);
  };

  /**
   * Internal connect implementation. Cleans up any existing socket before creating a new one.
   * Always call this instead of directly touching socketRef.
   */
  const connectInternal = () => {
    // Tear down any lingering socket before creating a fresh one
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    cleanupPeers();

    setSocketStatus('connecting');
    addLocalStatus('Connecting to signaling server...');

    const signalingUrl = isElectron
      ? (import.meta.env.VITE_SIGNALING_SERVER_URL || 'https://localhost:4001')
      : window.location.origin;
    console.log('[WebRTC] Connecting to signaling:', signalingUrl);

    socketRef.current = io(signalingUrl, {
      rejectUnauthorized: false,
      transports: ['websocket'],
      reconnection: false, // We handle reconnection ourselves for full control
    });

    socketRef.current.on('connect', () => {
      console.log('[WebRTC] Socket connected:', socketRef.current.id);
      reconnectAttemptsRef.current = 0; // Reset backoff on successful connect
      setSocketStatus('connected');
      setIsConnected(true);
      setJoinDenied(null); // Clear any stale denial from a previous attempt
      const displayName = isElectron ? 'Admin Hub' : userNameRef.current;
      const fullIdentity = `${displayName} - ${cameraLabelRef.current || 'Hub'}`;
      const effectiveRoomId = 'main-hub';
      socketRef.current.emit('join-room', { roomId: effectiveRoomId, userName: fullIdentity, pin: pinRef.current || '' });
      addLocalStatus(`Joined room: ${effectiveRoomId} as ${fullIdentity}`);
    });

    socketRef.current.on('disconnect', (reason: string) => {
      console.warn('[WebRTC] Socket disconnected:', reason);
      setSocketStatus('disconnected');
      setIsConnected(false);
      cleanupPeers();
      addLocalStatus(`Disconnected: ${reason}`);
      // Server-initiated disconnects should reconnect; client-side closes should not
      if (reason !== 'io client disconnect') {
        scheduleReconnect();
      }
    });

    socketRef.current.on('connect_error', (err: any) => {
      console.error('[WebRTC] Socket connect error:', err);
      setSocketStatus('error');
      setIsConnected(false);
      addLocalStatus(`Connection error: ${err.message}`);
      scheduleReconnect();
    });

    socketRef.current.on('all-users', (usersList: { userId: string; userName: string }[]) => {
      console.log('[WebRTC] Catching up on existing users:', usersList.length);
      usersList.forEach(user => {
        if (peersRef.current.find(p => p.id === user.userId)) return;
        // The newcomer initiates with everyone already there
        const peer = createPeer(user.userId, user.userName, userStream || undefined);
        peersRef.current.push({ id: user.userId, name: user.userName, peer });
        setPeers((prev) => [...prev, { id: user.userId, name: user.userName, peer }]);
      });
    });

    socketRef.current.on('user-joined', (data: { userId: string; userName: string }) => {
      console.log('[WebRTC] Remote user joined signaling:', data.userName);
      addLocalStatus(`User joined: ${data.userName}`);
      // We DO NOT initiate here. We wait for the newcomer to see us via 'all-users' 
      // and send us an offer.
    });

    socketRef.current.on('offer', (data: { offer: any; senderId: string; senderName: string }) => {
      console.log('[WebRTC] Offer received from:', data.senderName);
      const existingPeer = peersRef.current.find(p => p.id === data.senderId);
      
      if (existingPeer) {
        console.log('[WebRTC] Processing re-negotiation offer for existing peer:', data.senderName);
        existingPeer.peer.signal(data.offer);
        return;
      }

      const peer = addPeer(data.offer, data.senderId, data.senderName, userStream || undefined);
      peersRef.current.push({ id: data.senderId, name: data.senderName, peer });
      setPeers((prev) => [...prev, { id: data.senderId, name: data.senderName, peer }]);
    });

    socketRef.current.on('answer', (data: { answer: any; senderId: string }) => {
      console.log('[WebRTC] Answer received from:', data.senderId);
      const item = peersRef.current.find((p) => p.id === data.senderId);
      if (item) item.peer.signal(data.answer);
    });

    socketRef.current.on('ice-candidate', (data: { candidate: any; senderId: string }) => {
      const item = peersRef.current.find((p) => p.id === data.senderId);
      if (item) item.peer.signal(data.candidate);
    });

    socketRef.current.on('user-disconnected', (userId: string) => {
      const peerObj = peersRef.current.find(p => p.id === userId);
      const userName = peerObj?.name || 'Unknown User';
      console.log('[WebRTC] User disconnected:', userId);
      if (peerObj) peerObj.peer.destroy();
      peersRef.current = peersRef.current.filter(p => p.id !== userId);
      setPeers(prev => prev.filter(p => p.id !== userId));
      addLocalStatus(`User left: ${userName}`);
    });

    socketRef.current.on('chat-message', (data: { senderName: string, message: string, timestamp: number }) => {
      setChatMessages(prev => [...prev.slice(-49), data]);
    });

    socketRef.current.on('recording-stopped', (data: { streamKey: string; reason: string }) => {
      console.log('[WebRTC] Recording stopped by server:', data);
      setRecordingStopped(data);
    });

    socketRef.current.on('kicked', () => {
      console.warn('[WebRTC] Kicked by admin.');
      reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS; // Suppress auto-reconnect
      cleanupPeers();
      setIsConnected(false);
      setSocketStatus('disconnected');
      setWasKicked(true);
      addLocalStatus('You have been removed from the session by the admin.');
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    });

    socketRef.current.on('join-denied', (info: { reason: string }) => {
      console.warn('[WebRTC] join denied:', info?.reason);
      setJoinDenied(info || { reason: 'pin' });
      addLocalStatus(`Join denied: ${info?.reason || 'pin'}`);
    });

    socketRef.current.on('server-status', (status: {
      local: string; 
      public: string; 
      clientCount: number; 
      rtmpCount: number;
      rtmpSessions: { 
        id: string, 
        ip: string, 
        path: string, 
        startTime: number,
        uptime: number,
        bitrate: number,
        bytes: number
      }[];
      rtmpPublishers: {
        streamKey: string,
        ip: string,
        path: string,
        uptime: number
      }[];
    }) => {
      console.log('[WebRTC] Server status updated:', status);
      setServerStatus(status);
    });
  };

  /**
   * Public connect — entry point for both manual and auto-connect flows.
   * Delegates to connectInternal which handles stale socket cleanup.
   * @returns {void}
   */
  const connect = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = 0;
    connectInternal();
  };

  /**
   * Destroys all active P2P connections and cleanly disconnects the signaling websocket.
   * Cancels any pending reconnect timer.
   * @returns {void}
   */
  const disconnect = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS; // Prevent scheduleReconnect from firing
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    cleanupPeers();
    setIsConnected(false);
    setSocketStatus('disconnected');
  };

  useEffect(() => {
    if (isElectron) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, []);

  useEffect(() => {
    if (overrideStream) {
      const videoTrack = overrideStream.getVideoTracks()[0];
      const audioTrack = overrideStream.getAudioTracks()[0];

      peersRef.current.forEach(({ peer }) => {
        if (peer.streams[0]) {
          const oldVideoTrack = peer.streams[0].getVideoTracks()[0];
          const oldAudioTrack = peer.streams[0].getAudioTracks()[0];
          
          if (videoTrack) {
            if (oldVideoTrack) {
              console.log('[WebRTC] Replacing video track for peer');
              peer.replaceTrack(oldVideoTrack, videoTrack, peer.streams[0]);
            } else {
              console.log('[WebRTC] Adding video track to existing stream for peer');
              peer.addTrack(videoTrack, peer.streams[0]);
            }
          }
          
          if (audioTrack) {
            if (oldAudioTrack) {
              peer.replaceTrack(oldAudioTrack, audioTrack, peer.streams[0]);
            } else {
              peer.addTrack(audioTrack, peer.streams[0]);
            }
          }
        } else {
          console.log('[WebRTC] Adding full stream to peer');
          peer.addStream(overrideStream);
        }
      });
      setUserStream(overrideStream);
    } else if (cameraStreamRef.current) {
      // Restore original camera stream
      const camStream = cameraStreamRef.current;
      const videoTrack = camStream.getVideoTracks()[0];
      const audioTrack = camStream.getAudioTracks()[0];

      peersRef.current.forEach(({ peer }) => {
        if (peer.streams[0]) {
          const oldVideoTrack = peer.streams[0].getVideoTracks()[0];
          const oldAudioTrack = peer.streams[0].getAudioTracks()[0];
          if (oldVideoTrack && videoTrack) {
            console.log('[WebRTC] Restoring camera video track for peer');
            peer.replaceTrack(oldVideoTrack, videoTrack, peer.streams[0]);
          }
          if (oldAudioTrack && audioTrack) peer.replaceTrack(oldAudioTrack, audioTrack, peer.streams[0]);
        } else {
           peer.addStream(camStream);
        }
      });
      setUserStream(camStream);
    }
  }, [overrideStream]);

  useEffect(() => {
    // We now allow media in both Client and Electron (Admin)
    const shouldCapture = captureVideo || (!!videoId || !!audioId);
    
    if (!shouldCapture) {
      setCameraError(null); // camera intentionally off — clear any prior error
      if (userStream && !overrideStream) {
        userStream.getTracks().forEach(t => t.stop());
        setUserStream(null);
        cameraStreamRef.current = null;
      }
      return;
    }

    const constraints = {
      video: videoId ? { deviceId: { exact: videoId } } : true,
      audio: audioId ? { deviceId: { exact: audioId } } : true,
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn('[useWebRTC] getUserMedia not available (possibly insecure origin)');
      const blocked = 'Camera access blocked. Accept the HTTPS certificate warning and reload.';
      addLocalStatus(blocked);
      setCameraError(blocked);
      return;
    }

    addLocalStatus('Requesting camera/mic access...');
    setCameraError(null); // clear before a fresh attempt
    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      addLocalStatus('Camera access granted.');
      setCameraError(null);
      cameraStreamRef.current = stream;
      
      // If we already have peers connected, add this new stream to them
      peersRef.current.forEach(({ peer }) => {
        if (!peer.streams.includes(stream)) {
          console.log('[WebRTC] Adding new camera stream to existing peer');
          peer.addStream(stream);
        }
      });

      setUserStream(stream);
    }).catch(err => {
      console.error('Error getting user media:', err);
      addLocalStatus(`Camera Error: ${err.name} - ${err.message}`);
      const friendly =
        err?.name === 'NotReadableError' ? 'Camera is in use by another app (a second app window, OBS, Teams, Camera…). Close it and try again.' :
        err?.name === 'NotAllowedError' ? 'Camera/mic permission denied. Allow access in the browser/OS, then try again.' :
        err?.name === 'NotFoundError' ? 'No camera/mic found. Check the device is connected.' :
        err?.name === 'OverconstrainedError' ? 'The selected camera/mic is unavailable. Pick a different device above.' :
        `${err?.name || 'Camera error'}: ${err?.message || 'Could not access the camera.'}`;
      setCameraError(friendly);
    });
  }, [videoId, audioId, captureVideo]);

  useEffect(() => {
    if (userStream) {
      userStream.getVideoTracks().forEach(t => t.enabled = isVideoEnabled);
      userStream.getAudioTracks().forEach(t => t.enabled = isAudioEnabled);
    }
  }, [userStream, isVideoEnabled, isAudioEnabled]);

  /**
   * Universal binder for simple-peer events (sdp signals, stream tracks, connection states, erors).
   * DRY abstraction to guarantee predictable stream propagation across both Peer Initiators and Receivers.
   * 
   * @param {Peer.Instance} peer - The instantiated simple-peer class object.
   * @param {string} remoteId - The socket.id of the remote participant across the transport loop.
   * @param {string} name - The human readable alias of the remote participant.
   */
  function bindPeerEvents(peer: Peer.Instance, remoteId: string, name: string) {
    peer.on('signal', (signal: any) => {
      console.log(`[WebRTC] Local Signal (${signal.type}) for ${name}`);
      if (socketRef.current) {
        if (signal.type === 'offer' || signal.type === 'transceiverRequest') {
            socketRef.current.emit('offer', { roomId: 'main-hub', offer: signal, to: remoteId });
        } else if (signal.type === 'answer') {
            socketRef.current.emit('answer', { roomId: 'main-hub', answer: signal, to: remoteId });
        } else if (signal.candidate) {
            socketRef.current.emit('ice-candidate', { roomId: 'main-hub', candidate: signal, to: remoteId });
        }
      }
    });

    peer.on('iceStateChange', (state: string) => {
      console.log(`[WebRTC] ICE State for ${name}: ${state}`);
    });

    peer.on('error', (err: any) => {
      console.error(`[WebRTC] Peer error with ${remoteId}:`, err);
      addLocalStatus(`P2P Error (${name}): ${err.code || err.message}`);
    });

    peer.on('stream', (remoteStream: MediaStream) => {
      const trackCount = remoteStream.getTracks().length;
      console.log(`[WebRTC] SUCCESS: Received stream from ${remoteId}. Tracks:`, trackCount);
      addLocalStatus(`Stream Received: ${name} (${trackCount} tracks)`);
      setPeers((prev) => prev.map((p) => p.id === remoteId ? { ...p, stream: remoteStream } : p));
    });
  }

  function createPeer(userToSignal: string, name: string, stream?: MediaStream) {
    const peer = new Peer({
      initiator: true,
      trickle: true, // Send ICE candidates as they're found — dramatically faster P2P setup
      stream,
      ...config
    });

    bindPeerEvents(peer, userToSignal, name);

    return peer;
  }

  function addPeer(incomingSignal: any, callerId: string, name: string, stream?: MediaStream) {
    const peer = new Peer({
      initiator: false,
      trickle: true, // Must match initiator side
      stream,
      ...config
    });

    bindPeerEvents(peer, callerId, name);

    peer.on('connect', () => {
      console.log(`[WebRTC] P2P Connection established with ${callerId} (${name})`);
      addLocalStatus(`P2P Connected: ${name}`);
    });

    peer.signal(incomingSignal);
    return peer;
  }

  const sendMessage = (message: string) => {
    if (socketRef.current && message.trim()) {
      socketRef.current.emit('chat-message', { roomId, message });
    }
  };

  /**
   * Emit a kick-user event to the signaling server.
   * Admin-only: the UI must gate this behind isElectron checks.
   * @param {string} targetId - The socket.id of the user to remove.
   */
  const kickUser = (targetId: string) => {
    if (socketRef.current) {
      socketRef.current.emit('kick-user', { targetId });
    }
  };

  // Keep refs in sync with latest prop values so reconnect timers always see current data
  useEffect(() => { userNameRef.current = userName ?? ''; }, [userName]);
  useEffect(() => { cameraLabelRef.current = cameraLabel ?? ''; }, [cameraLabel]);
  useEffect(() => { pinRef.current = pin ?? ''; }, [pin]);

  const isLive = isConnected && peers.some(p => p.stream);

  return {
    peers,
    userStream,
    cameraError,
    joinDenied,
    connect,
    disconnect,
    isConnected,
    socketStatus,
    chatMessages,
    sendMessage,
    isVideoEnabled,
    setIsVideoEnabled,
    isAudioEnabled,
    setIsAudioEnabled,
    serverStatus,
    recordingStopped,
    wasKicked,
    kickUser,
    isLive
  };
};
