import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../../test/testUtils';
import { DestinationForm } from './DestinationForm';
import type { RtmpDestination } from '../../../../shared';

afterEach(cleanup);

describe('DestinationForm', () => {
  it('prefills the ingest URL when a platform is chosen, and submits a new destination', () => {
    const onSubmit = vi.fn();
    const { container } = render(<DestinationForm onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(container.querySelector('select[data-field="platform"]')!, { target: { value: 'youtube' } });
    const url = container.querySelector('input[data-field="url"]') as HTMLInputElement;
    expect(url.value).toBe('rtmp://a.rtmp.youtube.com/live2');
    fireEvent.change(container.querySelector('input[data-field="name"]')!, { target: { value: 'My YT' } });
    fireEvent.change(container.querySelector('input[data-field="streamKey"]')!, { target: { value: 'yt-key-123' } });
    fireEvent.click(screen.getByText(/save|add/i));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const dest = onSubmit.mock.calls[0][0] as RtmpDestination;
    expect(dest).toMatchObject({ name: 'My YT', platform: 'youtube', url: 'rtmp://a.rtmp.youtube.com/live2', streamKey: 'yt-key-123', enabled: true });
    expect(typeof dest.id).toBe('string');
    expect(dest.id.length).toBeGreaterThan(0);
  });

  it('edits an existing destination (preserves its id)', () => {
    const existing: RtmpDestination = { id: 'd1', name: 'Old', platform: 'twitch', url: 'rtmp://live.twitch.tv/app', streamKey: 'k', enabled: true };
    const onSubmit = vi.fn();
    const { container } = render(<DestinationForm value={existing} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(container.querySelector('input[data-field="name"]')!, { target: { value: 'New Name' } });
    fireEvent.click(screen.getByText(/save|update/i));
    const dest = onSubmit.mock.calls[0][0] as RtmpDestination;
    expect(dest.id).toBe('d1');
    expect(dest.name).toBe('New Name');
  });

  it('does not submit without a name', () => {
    const onSubmit = vi.fn();
    const { container } = render(<DestinationForm onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(container.querySelector('input[data-field="streamKey"]')!, { target: { value: 'k' } });
    fireEvent.click(screen.getByText(/save|add/i));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
