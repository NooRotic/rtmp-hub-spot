import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { renderHook, cleanup } from '../../test/testUtils';
import { useChatUnread } from './useChatUnread';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('useChatUnread', () => {
  it('defaults to open with zero unread', () => {
    const { result } = renderHook(() => useChatUnread(0));
    expect(result.current.open).toBe(true);
    expect(result.current.unread).toBe(0);
  });

  it('persists the closed state to localStorage and reads it back', () => {
    const { result } = renderHook(() => useChatUnread(0));
    act(() => result.current.setOpen(false));
    expect(localStorage.getItem('hub-chat-open')).toBe('false');
    // a fresh mount with the persisted value starts closed
    const { result: r2 } = renderHook(() => useChatUnread(0));
    expect(r2.current.open).toBe(false);
  });

  it('counts messages that arrive while closed and clears on open', () => {
    // Drive changing count via a module-level mutable variable + rerender
    let n = 2;
    const { result, rerender } = renderHook(() => useChatUnread(n));
    act(() => result.current.setOpen(false)); // close; seen baseline = 2
    n = 5;
    act(() => { rerender(); });              // 3 new messages while closed
    expect(result.current.unread).toBe(3);
    act(() => result.current.setOpen(true)); // open clears unread
    expect(result.current.unread).toBe(0);
  });
});
