import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '../../test/testUtils';
import { StageTileControls } from './StageTileControls';
afterEach(cleanup);
const q = (t: string) => document.querySelector(`button[title="${t}"]`) as HTMLButtonElement;
describe('StageTileControls', () => {
  it('fires spotlight; shows kick only for the host', () => {
    const onSpotlight = vi.fn(), onKick = vi.fn();
    const { rerender } = render(<StageTileControls peerId="p1" isHost spotlighted={false} onSpotlight={onSpotlight} onKick={onKick} />);
    fireEvent.click(q('Spotlight')); expect(onSpotlight).toHaveBeenCalledWith('p1');
    expect(q('Remove from session')).toBeTruthy();
    fireEvent.click(q('Remove from session')); expect(onKick).toHaveBeenCalledWith('p1');
    rerender(<StageTileControls peerId="p1" isHost={false} spotlighted={false} onSpotlight={onSpotlight} onKick={onKick} />);
    expect(q('Remove from session')).toBeNull(); // kick hidden for non-host
  });
});
