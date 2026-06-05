import { describe, it, expect } from 'vitest';
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
});
