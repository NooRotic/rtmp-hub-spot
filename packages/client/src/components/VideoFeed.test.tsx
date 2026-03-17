/// <reference types="vitest" />
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '../test/testUtils';
import VideoFeed from './VideoFeed';

afterEach(cleanup);

describe('VideoFeed Component', () => {
  const mockStream = {
    getTracks: () => [{ stop: vi.fn() }],
  } as unknown as MediaStream;

  it('renders the label correctly', () => {
    render(<VideoFeed label="Test Feed" stream={mockStream} />);
    expect(screen.getByText(/Test Feed/i)).toBeInTheDocument();
  });

  it('shows (Self) for local feeds', () => {
    render(<VideoFeed label="My Feed" stream={mockStream} isLocal />);
    expect(screen.getByText(/My Feed \(Self\)/i)).toBeInTheDocument();
  });
});
