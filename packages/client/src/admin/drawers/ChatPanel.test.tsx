import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '../../test/testUtils';
import { ChatPanel } from './ChatPanel';

afterEach(cleanup);

describe('ChatPanel', () => {
  it('renders ChatBox docked (not an overlay drawer) and collapses via the header button', () => {
    const onClose = vi.fn();
    const { container } = render(<ChatPanel messages={[]} onSendMessage={() => {}} onClose={onClose} />);
    expect(container.querySelector('.ntd-chatdock')).toBeTruthy();
    expect(container.querySelector('.ntd-drawer')).toBeNull(); // docked, NOT a fixed overlay
    expect(container.querySelector('input[placeholder="Type message..."]')).toBeTruthy();
    fireEvent.click(container.querySelector('button[title="Collapse chat"]') as HTMLButtonElement);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
