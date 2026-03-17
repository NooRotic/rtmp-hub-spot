/// <reference types="vitest" />
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '../test/testUtils';
import Lobby from './Lobby';

afterEach(cleanup);

describe('Lobby', () => {
  it('renders name input and JOIN HUB button', () => {
    render(<Lobby onJoin={vi.fn()} />);
    expect(screen.getByPlaceholderText(/enter your name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /join hub/i })).toBeInTheDocument();
  });

  it('JOIN HUB button is disabled when name is empty', () => {
    render(<Lobby onJoin={vi.fn()} />);
    expect(screen.getByRole('button', { name: /join hub/i })).toBeDisabled();
  });

  it('JOIN HUB button enables after typing a name', () => {
    render(<Lobby onJoin={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/enter your name/i) as HTMLInputElement, { target: { value: 'Alice' } });
    expect(screen.getByRole('button', { name: /join hub/i })).not.toBeDisabled();
  });

  it('calls onJoin with the trimmed name when button is clicked', () => {
    const onJoin = vi.fn();
    render(<Lobby onJoin={onJoin} />);
    fireEvent.change(screen.getByPlaceholderText(/enter your name/i) as HTMLInputElement, { target: { value: '  Bob  ' } });
    fireEvent.click(screen.getByRole('button', { name: /join hub/i }));
    expect(onJoin).toHaveBeenCalledWith('Bob');
  });

  it('calls onJoin when Enter is pressed in the name field', () => {
    const onJoin = vi.fn();
    render(<Lobby onJoin={onJoin} />);
    const input = screen.getByPlaceholderText(/enter your name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Carol' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onJoin).toHaveBeenCalledWith('Carol');
  });

  it('does not call onJoin when Enter is pressed with an empty name', () => {
    const onJoin = vi.fn();
    render(<Lobby onJoin={onJoin} />);
    fireEvent.keyDown(screen.getByPlaceholderText(/enter your name/i) as HTMLInputElement, { key: 'Enter' });
    expect(onJoin).not.toHaveBeenCalled();
  });

  it('shows the kicked-by-admin banner when wasKicked is true', () => {
    render(<Lobby onJoin={vi.fn()} wasKicked />);
    expect(screen.getByText(/removed from the session by the admin/i)).toBeInTheDocument();
  });

  it('does not show the kicked banner by default', () => {
    render(<Lobby onJoin={vi.fn()} />);
    expect(screen.queryByText(/removed from the session/i)).not.toBeInTheDocument();
  });

  it('pre-fills the name input from initialName prop', () => {
    render(<Lobby onJoin={vi.fn()} initialName="Dave" />);
    expect(screen.getByDisplayValue('Dave')).toBeInTheDocument();
  });

  it('shows camera checking state on initial render', () => {
    render(<Lobby onJoin={vi.fn()} />);
    expect(screen.getByText(/checking camera/i)).toBeInTheDocument();
  });
});
