'use strict';

/**
 * Staggered, priority-ordered (re)connect scheduler for relays. Solves the
 * thundering-herd problem: a network drop fails every relay at once, so instead
 * of each spinning its own synchronized backoff, ALL (re)connects flow through
 * one queue drained serially (one start per tick), highest-priority first, each
 * paced by delay + jitter. Sustained failures grow a global backoff up to
 * maxDelay (holding the queue against a dead link); any relay reaching 'live'
 * calls notifyLive() to reset it. Time + jitter are injected for deterministic
 * tests.
 *
 * Timing contract:
 *   - The FIRST drain fires at ms=0 (immediate) — no artificial initial delay
 *     before the first reconnect attempt.
 *   - Subsequent drains are paced at delay() + jitter() per item.
 *   - notifyLive() resets the backoff streak AND reschedules any pending timer
 *     at the now-shorter delay so recovery is fast.
 *
 * @param {object} deps
 * @param {(item:{sourceKey:string,destination:object})=>void} deps.startRelay
 * @param {Function} [deps.setTimer]   - setTimeout-compatible
 * @param {Function} [deps.clearTimer] - clearTimeout-compatible
 * @param {() => number} [deps.now]
 * @param {() => number} [deps.jitter] - extra ms added to each scheduled delay
 * @param {number} [deps.baseDelay]
 * @param {number} [deps.maxDelay]
 */
function createReconnectionSupervisor({
  startRelay,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => Date.now(),
  jitter = () => 0,
  baseDelay = 1500,
  maxDelay = 30000,
}) {
  /** @type {Array<{sourceKey:string,destination:object}>} */
  const queue = [];
  /** @type {Map<string,number>} id -> timestamp of last startRelay call */
  const lastStart = new Map();
  // GLOBAL backoff streak (one shared uplink), NOT per-source: a network drop is
  // link-wide, so any single relay reaching 'live' (notifyLive) clears it for all.
  let streak = 0;
  let scheduled = false;
  let timer = null;

  const idOf = (i) => `${i.sourceKey}:${i.destination.id}`;
  const prio = (i) =>
    typeof i.destination.priority === 'number' ? i.destination.priority : Number.MAX_SAFE_INTEGER;
  const delay = () => Math.min(baseDelay * Math.pow(2, streak), maxDelay);

  function enqueue(item) {
    const id = idOf(item);
    const startedAt = lastStart.get(id);
    const wasEmpty = queue.length === 0;
    // Re-enqueued soon after we started it => that attempt failed; grow backoff.
    const failed = startedAt != null && now() - startedAt < maxDelay;
    if (failed) streak += 1;

    if (!queue.some((q) => idOf(q) === id)) {
      queue.push(item);
      queue.sort((a, b) => prio(a) - prio(b));
    }

    if (failed) {
      // A relay failed shortly after we started it — backoff streak grew.
      // Whether or not the queue was empty, we must schedule (or reschedule)
      // at the new longer delay so the thundering-herd guard kicks in.
      reschedule(delay());
    } else if (!scheduled) {
      // Nothing scheduled yet: the first item in an empty queue starts
      // immediately (0ms); items added while others already wait are paced at
      // the current delay.
      schedule(wasEmpty ? 0 : delay());
    }
    // else: already scheduled at the right pace — let the existing timer run.
  }

  /**
   * Cancel pending reconnects for a source (optionally filtered to one destinationId).
   * @param {string} sourceKey
   * @param {string} [destinationId]
   */
  function cancel(sourceKey, destinationId) {
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      if (
        q.sourceKey === sourceKey &&
        (destinationId == null || q.destination.id === destinationId)
      ) {
        lastStart.delete(idOf(q));
        queue.splice(i, 1);
      }
    }
    // If we just emptied the queue, drop any pending timer so a later enqueue
    // starts promptly instead of waiting on a stale (possibly long-backoff) timer.
    if (queue.length === 0 && timer != null) {
      clearTimer(timer);
      timer = null;
      scheduled = false;
    }
  }

  /**
   * Called when any relay for (sourceKey, destinationId) reaches 'live'.
   * Resets the global backoff streak and reschedules the queue drain at the
   * now-shorter delay so recovery is fast.
   * @param {string} sourceKey
   * @param {string} destinationId
   */
  function notifyLive(sourceKey, destinationId) {
    streak = 0;
    lastStart.delete(`${sourceKey}:${destinationId}`);
    // Reschedule with the shorter (reset) delay so the pending timer (which may
    // have been set with the old longer delay) fires at baseDelay instead.
    if (queue.length > 0) {
      reschedule(delay());
    }
  }

  function schedule(ms) {
    if (scheduled || queue.length === 0) return;
    scheduled = true;
    timer = setTimer(run, ms + jitter());
  }

  function reschedule(ms) {
    if (timer != null) clearTimer(timer);
    scheduled = false;
    schedule(ms);
  }

  function run() {
    scheduled = false;
    timer = null;
    if (queue.length === 0) return;
    const head = queue.shift();
    lastStart.set(idOf(head), now());
    startRelay({ sourceKey: head.sourceKey, destination: head.destination });
    // Pace the next start at the current delay (which may have grown or reset).
    schedule(delay());
  }

  return { enqueue, cancel, notifyLive, pending: () => queue.length };
}

module.exports = { createReconnectionSupervisor };
