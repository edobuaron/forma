"use client";
import { useCallback, useSyncExternalStore } from "react";

// Display-only preference: hiding the RIR column never touches logged values.
// Shared by every exercise card on the page and persisted on this device.
const KEY = "forma:show-rir";
const EVENT = "forma:show-rir-change";

function read(): boolean {
  try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb(); };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useShowRir(): [boolean, (show: boolean) => void] {
  const show = useSyncExternalStore(subscribe, read, () => true);
  const set = useCallback((next: boolean) => {
    try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* noop */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [show, set];
}
