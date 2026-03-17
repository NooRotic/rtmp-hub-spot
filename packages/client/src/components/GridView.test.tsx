/// <reference types="vitest" />
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '../test/testUtils';
import GridView from './GridView';

afterEach(cleanup);

describe('GridView Component', () => {
  const mockStreams = [
    { id: '1', stream: {} as MediaStream, label: 'Feed 1' },
    { id: '2', stream: {} as MediaStream, label: 'Feed 2' },
  ];

  it('renders the canvas', () => {
    const { container } = render(<GridView streams={mockStreams} />);
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('renders the title', () => {
    render(<GridView streams={mockStreams} />);
    expect(screen.getByText(/Combined Grid View/i)).toBeInTheDocument();
  });
});
