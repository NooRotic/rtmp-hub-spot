'use strict';

/**
 * Room access gate: shared PIN + per-key brute-force throttle.
 * Host exemption is decided by the CALLER (opts.trusted) — NOT by network address,
 * because a proxy (e.g. the Vite dev /socket.io proxy) collapses remote clients to loopback.
 * Pure (no fs/electron); inject `now` for deterministic tests.
 *
 * @param {object}     [opts]
 * @param {()=>number} [opts.now=Date.now]   - Clock injection for tests.
 * @param {number}     [opts.maxFails=5]     - Failed attempts before cooldown.
 * @param {number}     [opts.cooldownMs=60000] - Lockout duration in ms.
 * @returns {{ setPin, getPin, isLocked, check }}
 */
function createRoomGate({ now = () => Date.now(), maxFails = 5, cooldownMs = 60000 } = {}) {
  let pin = '';
  /** @type {Map<string, { fails: number, cooldownUntil: number }>} */
  const keyState = new Map(); // key -> { fails, cooldownUntil }

  return {
    /** Set (or clear) the room PIN. Empty string = open hub. */
    setPin(p) { pin = (p || '').trim(); },

    /** Returns the current PIN (for persistence; main.js saves to disk). */
    getPin() { return pin; },

    /** True when a PIN is required. */
    isLocked() { return pin !== ''; },

    /**
     * Decide whether the caller may join the room.
     *
     * @param {string} key           - Throttle bucket (e.g. socket address).
     * @param {string} candidate     - PIN supplied by the joining client.
     * @param {object} [opts]
     * @param {boolean} [opts.trusted] - Host exemption flag; set by the caller
     *   when the client has presented a valid server-minted host token (Electron
     *   only). Never use network address for this — a proxy collapses remote
     *   clients to loopback.
     * @returns {{ allowed: true } | { allowed: false, reason: 'pin'|'cooldown', lockout?: true }}
     */
    check(key, candidate, opts = {}) {
      // The host is always trusted — no PIN needed.
      if (opts.trusted) return { allowed: true };

      // Enforce active cooldown regardless of candidate.
      const st = keyState.get(key);
      if (st && st.cooldownUntil > now()) return { allowed: false, reason: 'cooldown' };

      // Open hub — no PIN required.
      if (!pin) return { allowed: true };

      // Correct PIN: clear any accumulated fail state.
      if ((candidate || '') === pin) {
        keyState.delete(key);
        return { allowed: true };
      }

      // Wrong PIN: accumulate fails.
      const fails = (st && st.fails ? st.fails : 0) + 1;
      if (fails >= maxFails) {
        keyState.set(key, { fails, cooldownUntil: now() + cooldownMs });
        return { allowed: false, reason: 'pin', lockout: true };
      }
      keyState.set(key, { fails, cooldownUntil: 0 });
      return { allowed: false, reason: 'pin' };
    },
  };
}

module.exports = { createRoomGate };
