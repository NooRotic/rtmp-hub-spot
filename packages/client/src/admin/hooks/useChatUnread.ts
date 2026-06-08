import { useState, useRef, useEffect, useCallback } from 'react';

/** Chat drawer open/unread state.
 *  - Default OPEN; persists open/closed choice to localStorage (`hub-chat-open`).
 *  - `count` = current chatMessages.length.
 *  - `unread` = messages that arrived while the drawer was closed.
 *    Resets to 0 when the drawer is opened.
 */
export function useChatUnread(count: number) {
  const [open, setOpenState] = useState<boolean>(
    () => localStorage.getItem('hub-chat-open') !== 'false'
  );

  // seenRef = message count that was "seen" at the moment the drawer last closed (or at mount).
  // We capture this in setOpen at the moment of closing so the delta is accurate.
  const seenRef = useRef<number>(count);

  const [unread, setUnread] = useState(0);

  // Recompute unread whenever count or open changes.
  useEffect(() => {
    if (open) {
      // Drawer is open: everything is seen, clear the badge.
      seenRef.current = count;
      setUnread(0);
    } else {
      // Drawer is closed: badge = new messages since it was closed.
      setUnread(Math.max(0, count - seenRef.current));
    }
  }, [count, open]);

  const setOpen = useCallback(
    (v: boolean) => {
      if (!v) {
        // Capture the current count as the seen baseline at the moment of closing.
        // The effect above will also set seenRef on the next render, but capturing
        // here avoids a stale-closure race if count changes in the same tick.
        seenRef.current = count;
      }
      setOpenState(v);
      localStorage.setItem('hub-chat-open', v ? 'true' : 'false');
    },
    [count]
  );

  return { open, setOpen, unread };
}
