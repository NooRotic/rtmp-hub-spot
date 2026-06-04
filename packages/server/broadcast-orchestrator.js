'use strict';

/**
 * Couples source liveness (NMS postPublish/donePublish) AND destination-binding
 * mutations to relay fan-out. When a source goes live, every ACTIVE binding whose
 * destination is enabled is enqueued for a (staggered) relay start; when a source
 * stops, pending reconnects are cancelled and running relays stopped. Binding/
 * destination CRUD reacts live: adding a binding to an already-live source starts
 * its relay; removing a binding or deleting a destination stops the relay(s).
 * Keeps all cross-module relay logic out of main.js and fully unit-testable.
 *
 * @param {object} deps
 * @param {{enqueue:Function, cancel:Function}} deps.supervisor
 * @param {{stopForSource:Function, stop:Function, stopForDestination:Function}} deps.relayManager
 * @param {() => Array} deps.listBindings
 * @param {() => Array} deps.listDestinations
 * @param {(sourceKey:string) => boolean} [deps.isSourceLive] - is this streamKey publishing
 *   now? Pass a real predicate in production (e.g. rtmpPublishers.has); the default `() => false`
 *   DISABLES live-add (onBindingAdded never enqueues) — safe-fail, never a spurious relay.
 */
function createBroadcastOrchestrator({
  supervisor,
  relayManager,
  listBindings,
  listDestinations,
  isSourceLive = () => false,
}) {
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

  // G1: a binding added (or re-activated) starts its relay immediately, but only
  // if the source is already publishing and the destination is enabled. A binding
  // to an offline source is just pre-wiring — it starts when the source goes live.
  function onBindingAdded(sourceKey, destination) {
    if (destination && destination.enabled && isSourceLive(sourceKey)) {
      supervisor.enqueue({ sourceKey, destination });
    }
  }

  // G2: a binding removed/deactivated cancels any pending reconnect and stops the
  // one running relay for that exact pair.
  function onBindingRemoved(sourceKey, destinationId) {
    supervisor.cancel(sourceKey, destinationId);
    relayManager.stop(sourceKey, destinationId);
  }

  // G3: a destination deleted stops its relays across every source.
  function onDestinationRemoved(destinationId) {
    relayManager.stopForDestination(destinationId);
  }

  return {
    onSourcePublished,
    onSourceUnpublished,
    onBindingAdded,
    onBindingRemoved,
    onDestinationRemoved,
    destinationsForSource,
  };
}

module.exports = { createBroadcastOrchestrator };
