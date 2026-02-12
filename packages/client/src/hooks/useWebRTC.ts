import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';

export const isElectron = navigator.userAgent.toLowerCase().indexOf(' electron/') > -1;

export const useWebRTC = (roomId: string, options: { videoId?: string; audioId?: string; userName?: string; cameraLabel?: string; iceServers?: RTCIceServer[]; overrideStream?: MediaStream | null } = {}) => {
  const { videoId, audioId, userName, cameraLabel, iceServers, overrideStream } = options;
  const [peers, setPeers] = useState<{ id: string; name: string; peer: any; stream?: MediaStream }[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [socketStatus, setSocketStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [userStream, setUserStream] = useState<MediaStream | null>(null);
  const [chatMessages, setChatMessages] = useState<{ senderName: string, message: string, timestamp: number }[]>([]);
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
    }[]
  } | null>(null);
  const socketRef = useRef<any>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<{ id: string; name: string; peer: any }[]>([]);

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

  const connect = () => {
    if (isConnected) return;
    setSocketStatus('connecting');
    addLocalStatus('Connecting to signaling server...');
    const signalingUrl = `${window.location.protocol}//${window.location.hostname}:4001`;
    console.log('[WebRTC] Connecting to signaling:', signalingUrl);
    socketRef.current = io(signalingUrl);

    socketRef.current.on('connect', () => {
      console.log('[WebRTC] Socket connected:', socketRef.current.id);
      setSocketStatus('connected');
      setIsConnected(true);
      const displayName = isElectron ? 'Admin Hub' : userName;
      const fullIdentity = `${displayName} - ${cameraLabel || 'Hub'}`;
      socketRef.current.emit('join-room', { roomId, userName: fullIdentity });
      addLocalStatus(`Joined room: ${roomId} as ${fullIdentity}`);
    });

    socketRef.current.on('connect_error', (err: any) => {
      console.error('[WebRTC] Socket connect error:', err);
      setSocketStatus('error');
      setIsConnected(false);
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
      if (peersRef.current.find(p => p.id === data.senderId)) return;
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
      }[]
    }) => {
      console.log('[WebRTC] Server status updated:', status);
      setServerStatus(status);
    });

    // Connection state is now handled in the 'connect' event listener
  };

  const disconnect = () => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    peersRef.current.forEach(p => p.peer.destroy());
    peersRef.current = [];
    setPeers([]);
    setIsConnected(false);
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
          if (oldVideoTrack && videoTrack) peer.replaceTrack(oldVideoTrack, videoTrack, peer.streams[0]);
          if (oldAudioTrack && audioTrack) peer.replaceTrack(oldAudioTrack, audioTrack, peer.streams[0]);
        } else {
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
          if (oldVideoTrack && videoTrack) peer.replaceTrack(oldVideoTrack, videoTrack, peer.streams[0]);
          if (oldAudioTrack && audioTrack) peer.replaceTrack(oldAudioTrack, audioTrack, peer.streams[0]);
        }
      });
      setUserStream(camStream);
    }
  }, [overrideStream]);

  useEffect(() => {
    // We now allow media in both Client and Electron (Admin)
    if (!videoId && !audioId) {
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
      addLocalStatus('Camera access blocked. Please ensure you have accepted the HTTPS certificate warning.');
      return;
    }

    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      cameraStreamRef.current = stream;
      if (userStream) {
        // Replace tracks on existing peers
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];

        peersRef.current.forEach(({ peer }) => {
          if (peer.streams[0]) {
            const oldVideoTrack = peer.streams[0].getVideoTracks()[0];
            const oldAudioTrack = peer.streams[0].getAudioTracks()[0];
            if (oldVideoTrack) peer.replaceTrack(oldVideoTrack, videoTrack, peer.streams[0]);
            if (oldAudioTrack) peer.replaceTrack(oldAudioTrack, audioTrack, peer.streams[0]);
          } else {
            peer.addStream(stream);
          }
        });
        
        userStream.getTracks().forEach(t => t.stop());
      }
      setUserStream(stream);

      // If already connected, we might need to tell others or update?
      // For now, track replacement handles it for existing users.
    }).catch(err => {
      console.error('Error getting user media:', err);
    });
  }, [videoId, audioId]);

  useEffect(() => {
    if (userStream) {
      userStream.getVideoTracks().forEach(t => t.enabled = isVideoEnabled);
      userStream.getAudioTracks().forEach(t => t.enabled = isAudioEnabled);
    }
  }, [userStream, isVideoEnabled, isAudioEnabled]);

  function createPeer(userToSignal: string, name: string, stream?: MediaStream) {
    const peer = new Peer({
      initiator: true,
      trickle: false,
      stream,
      ...config
    });

    peer.on('signal', (signal: any) => {
      if (socketRef.current) {
        socketRef.current.emit('offer', { roomId, offer: signal, to: userToSignal });
      }
    });

    peer.on('stream', (remoteStream: MediaStream) => {
      console.log(`[WebRTC] SUCCESS: Received stream from ${userToSignal}. Tracks:`, remoteStream.getTracks().length);
      setPeers((prev) => prev.map((p) => p.id === userToSignal ? { ...p, stream: remoteStream } : p));
    });

    return peer;
  }

  function addPeer(incomingSignal: any, callerId: string, name: string, stream?: MediaStream) {
    const peer = new Peer({
      initiator: false,
      trickle: false,
      stream,
      ...config
    });

    peer.on('signal', (signal: any) => {
      if (socketRef.current) {
        socketRef.current.emit('answer', { roomId, answer: signal, to: callerId });
      }
    });

    peer.on('stream', (remoteStream: MediaStream) => {
      console.log(`[WebRTC] SUCCESS: Received stream from ${callerId}. Tracks:`, remoteStream.getTracks().length);
      setPeers((prev) => prev.map((p) => p.id === callerId ? { ...p, stream: remoteStream } : p));
    });

    peer.signal(incomingSignal);
    return peer;
  }

  const sendMessage = (message: string) => {
    if (socketRef.current && message.trim()) {
      socketRef.current.emit('chat-message', { roomId, message });
    }
  };

  return { 
    peers, 
    userStream, 
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
    serverStatus
  };
};
