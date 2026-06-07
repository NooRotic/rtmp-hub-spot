import { useState, useEffect, useCallback } from 'react';
import type { IpcBridge } from './useElectronBridge';
import type { RtmpDestination, DestinationBinding } from '../../../shared';

/**
 * Destination library + source↔destination bindings, fronted by the destinations:*
 * / bindings:* IPC channels (routed through the orchestrator by the G1–G3 backend).
 * Loads on mount; mutations are optimistic, then reconciled by a re-fetch.
 */
export function useDestinations(ipc: IpcBridge | null): {
  destinations: RtmpDestination[];
  bindings: DestinationBinding[];
  refresh: () => Promise<void>;
  addDestination: (dest: RtmpDestination) => Promise<void>;
  updateDestination: (dest: RtmpDestination) => Promise<void>;
  removeDestination: (id: string) => Promise<void>;
  setBinding: (binding: DestinationBinding) => Promise<void>;
  removeBinding: (sourceKey: string, destinationId: string) => Promise<void>;
} {
  const [destinations, setDestinations] = useState<RtmpDestination[]>([]);
  const [bindings, setBindings] = useState<DestinationBinding[]>([]);

  const refresh = useCallback(async () => {
    if (!ipc) return;
    const [d, b] = await Promise.all([ipc.invoke('destinations:list'), ipc.invoke('bindings:list')]);
    setDestinations(d ?? []);
    setBindings(b ?? []);
  }, [ipc]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addDestination = useCallback(async (dest: RtmpDestination) => {
    if (!ipc) return;
    setDestinations((prev) => [...prev, dest]); // optimistic
    try {
      await ipc.invoke('destinations:add', dest);
    } finally {
      await refresh(); // reconcile with server truth (also on failure)
    }
  }, [ipc, refresh]);

  const updateDestination = useCallback(async (dest: RtmpDestination) => {
    if (!ipc) return;
    setDestinations((prev) => prev.map((x) => (x.id === dest.id ? dest : x))); // optimistic
    try {
      await ipc.invoke('destinations:update', dest);
    } finally {
      await refresh();
    }
  }, [ipc, refresh]);

  const removeDestination = useCallback(async (id: string) => {
    if (!ipc) return;
    setDestinations((prev) => prev.filter((x) => x.id !== id)); // optimistic
    setBindings((prev) => prev.filter((b) => b.destinationId !== id)); // mirror backend G3 cascade
    try {
      await ipc.invoke('destinations:remove', id);
    } finally {
      await refresh();
    }
  }, [ipc, refresh]);

  const setBinding = useCallback(async (binding: DestinationBinding) => {
    if (!ipc) return;
    setBindings((prev) => {
      const i = prev.findIndex((b) => b.sourceKey === binding.sourceKey && b.destinationId === binding.destinationId);
      if (i >= 0) { const next = [...prev]; next[i] = binding; return next; }
      return [...prev, binding];
    }); // optimistic upsert
    try {
      await ipc.invoke('bindings:set', binding);
    } finally {
      await refresh();
    }
  }, [ipc, refresh]);

  const removeBinding = useCallback(async (sourceKey: string, destinationId: string) => {
    if (!ipc) return;
    setBindings((prev) => prev.filter((b) => !(b.sourceKey === sourceKey && b.destinationId === destinationId))); // optimistic
    try {
      await ipc.invoke('bindings:remove', { sourceKey, destinationId });
    } finally {
      await refresh();
    }
  }, [ipc, refresh]);

  return { destinations, bindings, refresh, addDestination, updateDestination, removeDestination, setBinding, removeBinding };
}
