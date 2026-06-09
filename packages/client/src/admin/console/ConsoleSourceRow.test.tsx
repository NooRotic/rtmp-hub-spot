import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../../test/testUtils';
import { ConsoleSourceRow } from './ConsoleSourceRow';

// RtmpPlayerTile uses mpegts.js; mock it so the expand preview renders inertly.
vi.mock('../../components/RtmpPlayerTile', () => ({
  RtmpPlayerTile: ({ streamKey }: { streamKey: string }) => <div data-testid="preview">{streamKey}</div>,
  localFlvUrl: (k: string) => `http://127.0.0.1:8000/live/${k}.flv`,
}));

afterEach(cleanup);

describe('ConsoleSourceRow', () => {
  it('shows streamKey, viewers and a health dot; expand reveals the preview; REC fires', () => {
    const start = vi.fn();
    const src = { streamKey: 'grid', active: true, viewers: 2, bitrate: 3500000, health: 'live' as const };
    render(
      <ConsoleSourceRow
        source={src}
        serverLocalIP="10.0.0.5"
        isRecording={false}
        onStartRec={start}
        onStopRec={() => {}}
      />,
    );
    expect(screen.getByText('grid')).toBeTruthy();
    expect(screen.getByText(/2 viewer/i)).toBeTruthy(); // viewers
    expect(document.querySelector('.ntd-dot')).toBeTruthy(); // health dot
    // preview hidden until expanded
    expect(document.querySelector('[data-testid="preview"]')).toBeNull();
    fireEvent.click(document.querySelector('button[title="Expand preview"]')!); // expand
    expect(document.querySelector('[data-testid="preview"]')).toBeTruthy();
    fireEvent.click(screen.getByText(/^rec$/i));
    expect(start).toHaveBeenCalledWith('grid');
  });

  it('shows Stop Rec and fires onStopRec when recording', () => {
    const stop = vi.fn();
    const src = { streamKey: 'feed-a', active: true, viewers: 0, bitrate: 0, health: 'live' as const };
    render(
      <ConsoleSourceRow source={src} isRecording={true} onStartRec={() => {}} onStopRec={stop} />,
    );
    fireEvent.click(screen.getByText(/stop rec/i));
    expect(stop).toHaveBeenCalledWith('feed-a');
  });

  it('renders a copyable RTMP route for the source', () => {
    const src = { streamKey: 'grid', active: true, viewers: 0, bitrate: 0, health: 'live' as const };
    const { container } = render(
      <ConsoleSourceRow source={src} serverLocalIP="10.0.0.5" isRecording={false} onStartRec={() => {}} onStopRec={() => {}} />,
    );
    expect(container.textContent).toContain('rtmp://127.0.0.1:1935/live/grid');
  });
});
