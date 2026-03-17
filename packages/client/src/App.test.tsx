/// <reference types="vitest" />
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from './test/testUtils';
import App from './App';

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
  }),
}));

vi.mock('./hooks/useMediaDevices', () => ({
  useMediaDevices: () => ({ videoDevices: [], audioDevices: [] }),
}));

afterEach(cleanup);

describe('App Component', () => {
  it('renders the status bar with signaling state', () => {
    render(<App />);
    expect(screen.getByText(/signaling/i)).toBeInTheDocument();
  });

  it('shows the pre-flight lobby for non-Electron browser clients', () => {
    render(<App />);
    expect(screen.getByText(/join session/i)).toBeInTheDocument();
  });

  it('renders the JOIN HUB button in the lobby', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /join hub/i })).toBeInTheDocument();
  });
});
