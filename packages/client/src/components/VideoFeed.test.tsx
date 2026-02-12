/// <reference types="vitest" />
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VideoFeed from './VideoFeed';
import React from 'react';

describe('VideoFeed Component', () => {
  const mockStream = {
    getTracks: () => [{ stop: vi.fn() }],
  } as any;

  it('renders the label correctly', () => {
    render(<VideoFeed label="Test Feed" stream={mockStream} />);
    expect(screen.getByText(/Test Feed/i)).toBeInTheDocument();
  });

  it('shows (Self) for local feeds', () => {
    render(<VideoFeed label="My Feed" stream={mockStream} isLocal />);
    expect(screen.getByText(/My Feed \(Self\)/i)).toBeInTheDocument();
  });
});
