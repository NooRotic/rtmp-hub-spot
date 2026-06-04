'use strict';

/**
 * Couples source liveness (NMS postPublish/donePublish) to relay fan-out. When a
 * source goes live on the local NMS, every ACTIVE binding for that source whose
 * destination is enabled is enqueued for a (staggered) relay start; when the
 * source stops, pending reconnects are cancelled and running relays are stopped.
 * Keeps this cross-module logic out of main.js and fully unit-testable.
 *
 * @param {object} deps
 * @param {{enqueue:Function, cancel:Function}} deps.supervisor
 * @param {{stopForSource:Function}} deps.relayManager
 * @param {() => Array} deps.listBindings
 * @param {() => Array} deps.listDestinations
 */
function createBroadcastOrchestrator({ supervisor, relayManager, listBindings, listDestinations }) {
  function destinationsForSource(sourceKey) {
    const active = listBindings().filter((b) => b.sourceKey === sourceKey && b.active);
    const byId = new Map(listDestinations().map((d) => [d.id, d]));
    return active.map((b) => byId.get(b.destinationId)).filter((d) => d && d.enabled);
  }

  function onSourcePublished(sourceKey) {
    for (const destination of destinationsForSource(sourceKey)) {
      supervisor.enqueue({ sourceKey, destination });
    }
  }

  function onSourceUnpublished(sourceKey) {
    supervisor.cancel(sourceKey);
    relayManager.stopForSource(sourceKey);
  }

  return { onSourcePublished, onSourceUnpublished, destinationsForSource };
}

module.exports = { createBroadcastOrchestrator };
