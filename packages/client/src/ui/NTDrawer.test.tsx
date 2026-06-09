import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '../test/testUtils';
import { NTDrawer } from './NTDrawer';

afterEach(cleanup);

describe('NTDrawer', () => {
  it('renders title + children when open and fires onClose', () => {
    const onClose = vi.fn();
    render(<NTDrawer open title="Settings" onClose={onClose}><p>inside</p></NTDrawer>);
    expect(screen.getByText('Settings')).toBeTruthy();
    expect(screen.getByText('inside')).toBeTruthy();
    fireEvent.click(screen.getByText('✕'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('renders nothing when closed', () => {
    const { container } = render(<NTDrawer open={false} title="X" onClose={() => {}}><p>inside</p></NTDrawer>);
    expect(container.querySelector('.ntd-drawer')).toBeNull();
  });
});
