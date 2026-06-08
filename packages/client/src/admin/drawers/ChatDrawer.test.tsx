import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '../../test/testUtils';
import { ChatDrawer } from './ChatDrawer';

afterEach(cleanup);

describe('ChatDrawer', () => {
  it('renders ChatBox inside a drawer when open', () => {
    const { container } = render(
      <ChatDrawer open onClose={() => {}} messages={[]} onSendMessage={() => {}} />
    );
    expect(container.querySelector('.ntd-drawer')).toBeTruthy();
    expect(container.querySelector('input[placeholder="Type message..."]')).toBeTruthy();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <ChatDrawer open={false} onClose={() => {}} messages={[]} onSendMessage={() => {}} />
    );
    expect(container.querySelector('.ntd-drawer')).toBeNull();
  });
});
