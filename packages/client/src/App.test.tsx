/// <reference types="vitest" />
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from './App';
import React from 'react';

// Mock the useWebRTC hook
vi.mock('./hooks/useWebRTC', () => ({
  useWebRTC: () => ({
    peers: [],
    userStream: new MediaStream(),
  }),
}));

describe('App Component', () => {
  it('renders the main dashboard', () => {
    render(<App />);
    expect(screen.getByText(/RTMP Hub Spot - Dashboard/i)).toBeInTheDocument();
  });

  it('shows connection status when live', () => {
    render(<App />);
    expect(screen.getByText(/Connection Status: LIVE/i)).toBeInTheDocument();
  });
});
