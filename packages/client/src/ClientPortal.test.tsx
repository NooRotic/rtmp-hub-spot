import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from './test/testUtils';

const wrtc = {
  serverStatus: null, isConnected: false, socketStatus: 'disconnected', peers: [],
  userStream: null, cameraError: null,
  isVideoEnabled: true, setIsVideoEnabled: vi.fn(), isAudioEnabled: true, setIsAudioEnabled: vi.fn(),
  chatMessages: [], sendMessage: vi.fn(), disconnect: vi.fn(), connect: vi.fn(),
  recordingStopped: null, wasKicked: false, kickUser: vi.fn(), isLive: false,
  joinDenied: null as { reason: string } | null,
};
vi.mock('./hooks/useWebRTC', () => ({ useWebRTC: () => wrtc }));

import { ClientPortal } from './ClientPortal';

beforeEach(() => { wrtc.connect.mockClear(); localStorage.clear(); wrtc.joinDenied = null; });
afterEach(cleanup);

describe('ClientPortal', () => {
  it('shows the lobby (join) before joining', () => {
    render(<ClientPortal />);
    // Lobby renders a name input and JOIN HUB button; camera controls are not visible yet
    expect(document.querySelector('input')).toBeTruthy();
    expect(screen.queryByText(/start camera|stop camera/i)).toBeNull();
  });

  it('after joining the lobby, shows the in-session camera control', () => {
    render(<ClientPortal />);
    // Set the name in the Lobby's input and click JOIN HUB
    const nameInput = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Tester' } });
    // JOIN HUB button — name-scoped so it stays correct if Lobby gains more buttons
    fireEvent.click(screen.getByRole('button', { name: /join hub/i }));
    // After joining, in-session controls appear including START CAMERA / STOP CAMERA
    expect(screen.getByText(/start camera|stop camera/i)).toBeTruthy();
  });

  it('returns to the lobby with an error when the join is denied', () => {
    wrtc.joinDenied = { reason: 'pin' };
    render(<ClientPortal />);
    const name = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Tester' } });
    fireEvent.click(screen.getByRole('button', { name: /join hub/i }));
    expect(screen.queryByText(/start camera|stop camera/i)).toBeNull(); // not in-session
    expect(screen.getByText(/requires a valid pin|wrong pin|invalid pin/i)).toBeTruthy();
    wrtc.joinDenied = null; // reset for other tests
  });
});
