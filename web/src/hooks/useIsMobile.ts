import { useSyncExternalStore } from 'react';

const MOBILE_QUERY = '(max-width: 767px)';
const mql = typeof window !== 'undefined' ? window.matchMedia(MOBILE_QUERY) : null;

function subscribe(callback: () => void): () => void {
  if (!mql) return () => {};
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot(): boolean {
  return mql?.matches ?? false;
}

function getServerSnapshot(): boolean {
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
