import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { render, cleanup, screen, fireEvent } from '../test/testUtils';
import { CopyRouteField, buildRouteUrl } from './CopyRouteField';

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(cleanup);

describe('buildRouteUrl', () => {
  it('builds the RTMP ingest URL', () => {
    expect(buildRouteUrl('127.0.0.1', 'grid')).toBe('rtmp://127.0.0.1:1935/live/grid');
    expect(buildRouteUrl('10.0.0.5', 'feed-cam', 1936)).toBe('rtmp://10.0.0.5:1936/live/feed-cam');
  });
});

describe('CopyRouteField', () => {
  it('defaults to loopback and copies that URL on click', async () => {
    const { container } = render(<CopyRouteField streamKey="grid" lanIp="10.0.0.5" />);
    expect(container.querySelector('.ntd-copy__url')!.textContent).toBe('rtmp://127.0.0.1:1935/live/grid');
    await act(async () => { fireEvent.click(screen.getByText(/copy/i)); });
    expect(writeText).toHaveBeenCalledWith('rtmp://127.0.0.1:1935/live/grid');
  });

  it('toggles to the LAN IP and copies that instead', async () => {
    const { container } = render(<CopyRouteField streamKey="grid" lanIp="10.0.0.5" />);
    await act(async () => { fireEvent.click(screen.getByText(/LAN/i)); });
    expect(container.querySelector('.ntd-copy__url')!.textContent).toBe('rtmp://10.0.0.5:1935/live/grid');
    await act(async () => { fireEvent.click(screen.getByText(/copy/i)); });
    expect(writeText).toHaveBeenCalledWith('rtmp://10.0.0.5:1935/live/grid');
  });

  it('shows a copied! flash after copying', async () => {
    render(<CopyRouteField streamKey="grid" lanIp="10.0.0.5" />);
    await act(async () => { fireEvent.click(screen.getByText(/copy/i)); });
    expect(screen.queryByText(/copied/i)).toBeTruthy();
  });
});
