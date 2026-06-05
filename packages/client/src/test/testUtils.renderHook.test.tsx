import { describe, it, expect } from 'vitest';
import { act } from 'react';
import { useState, useEffect } from 'react';
import { renderHook } from './testUtils';

describe('renderHook helper', () => {
  it('returns the latest hook value and reflects effect-driven updates', () => {
    const { result, unmount } = renderHook(() => {
      const [n, setN] = useState(0);
      useEffect(() => { setN(42); }, []);
      return n;
    });
    expect(result.current).toBe(42); // effect flushed inside act()
    unmount();
  });

  it('rerender preserves hook state instead of remounting', () => {
    const { result, rerender, unmount } = renderHook(() => {
      const [n, setN] = useState(0);
      return { n, setN };
    });
    act(() => result.current.setN(7));
    expect(result.current.n).toBe(7);
    rerender();
    expect(result.current.n).toBe(7); // would reset to 0 if rerender remounted
    unmount();
  });
});
