'use strict';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** True if the socket's remote address is local (the trusted host machine). */
function isLoopback(address) {
  return !!address && LOOPBACK.has(address);
}

/**
 * Room access gate: holds the shared PIN + per-IP brute-force throttle.
 * Pure (no fs/electron); inject `now` for deterministic tests. Persistence is the caller's job.
 *
 * @param {object}   [opts]
 * @param {()=>number} [opts.now=Date.now]   - Clock injection for tests.
 * @param {number}   [opts.maxFails=5]       - Failed attempts before cooldown.
 * @param {number}   [opts.cooldownMs=60000] - Lockout duration in ms.
 * @returns {{ setPin, getPin, isLocked, check }}
 */
function createRoomGate({ now = () => Date.now(), maxFails = 5, cooldownMs = 60000 } = {}) {
  let pin = '';
  /** @type {Map<string, { fails: number, cooldownUntil: number }>} */
  const ipState = new Map();

  return {
    /** Set (or clear) the room PIN. Empty string = open hub. */
    setPin(p) { pin = (p || '').trim(); },

    /** Returns the current PIN (for persistence; main.js saves to disk). */
    getPin() { return pin; },

    /** True when a PIN is required. */
    isLocked() { return pin !== ''; },

    /**
     * Decide whether `address` may join the room.
     *
     * @param {string} address   - Remote socket address (e.g. '10.0.0.5', '::1').
     * @param {string} candidate - PIN supplied by the joining client.
     * @returns {{ allowed: true } | { allowed: false, reason: 'pin'|'cooldown', lockout?: true }}
     */
    check(address, candidate) {
      // The host machine is always trusted — no PIN needed.
      if (isLoopback(address)) return { allowed: true };

      // Enforce active cooldown regardless of candidate.
      const st = ipState.get(address);
      if (st && st.cooldownUntil > now()) return { allowed: false, reason: 'cooldown' };

      // Open hub — no PIN required.
      if (!pin) return { allowed: true };

      // Correct PIN: clear any accumulated fail state.
      if ((candidate || '') === pin) {
        ipState.delete(address);
        return { allowed: true };
      }

      // Wrong PIN: accumulate fails.
      const fails = (st && st.fails ? st.fails : 0) + 1;
      if (fails >= maxFails) {
        ipState.set(address, { fails, cooldownUntil: now() + cooldownMs });
        return { allowed: false, reason: 'pin', lockout: true };
      }
      ipState.set(address, { fails, cooldownUntil: 0 });
      return { allowed: false, reason: 'pin' };
    },
  };
}

module.exports = { isLoopback, createRoomGate };
