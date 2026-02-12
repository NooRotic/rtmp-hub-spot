/// <reference types="vitest" />
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import GridView from './GridView';
import React from 'react';

describe('GridView Component', () => {
  const mockStreams = [
    { id: '1', stream: {} as MediaStream, label: 'Feed 1' },
    { id: '2', stream: {} as MediaStream, label: 'Feed 2' },
  ];

  it('renders the canvas', () => {
    render(<GridView streams={mockStreams} />);
    const canvas = screen.getByRole('img', { hidden: true }); // Canvas often doesn't have a role, but we'll check it's in the DOM
    expect(canvas).toBeInTheDocument();
  });

  it('renders the title', () => {
    render(<GridView streams={mockStreams} />);
    expect(screen.getByText(/Combined Grid View/i)).toBeInTheDocument();
  });
});
