/// <reference types="vitest" />
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from './test/testUtils';
import App from './App';

// In jsdom: isElectron=false, no ?role=admin → App routes to <ClientPortal />.
// ClientPortal calls useWebRTC, so mock it here the same way ClientPortal.test does.
vi.mock('./hooks/useWebRTC', () => ({
  useWebRTC: () => ({
    peers: [],
    userStream: null,
    isConnected: false,
    socketStatus: 'disconnected',
    chatMessages: [],
    sendMessage: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isVideoEnabled: true,
    setIsVideoEnabled: vi.fn(),
    isAudioEnabled: true,
    setIsAudioEnabled: vi.fn(),
    serverStatus: null,
    recordingStopped: null,
    wasKicked: false,
    kickUser: vi.fn(),
    isLive: false,
    cameraError: null,
  }),
}));

vi.mock('./hooks/useMediaDevices', () => ({
  useMediaDevices: () => ({ videoDevices: [], audioDevices: [] }),
}));

afterEach(cleanup);

describe('App routing (browser/participant mode)', () => {
  it('renders the participant lobby (Join Session) in jsdom — not the admin console', () => {
    render(<App />);
    // ClientPortal shows Lobby first: "RTMP Hub Spot — Join Session"
    expect(screen.getByText(/join session/i)).toBeInTheDocument();
    // Admin-only content must not be present
    expect(screen.queryByText(/System Status|Admin Video Hub/i)).toBeNull();
  });

  it('renders the JOIN HUB button in the pre-flight lobby', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /join hub/i })).toBeInTheDocument();
  });
});
