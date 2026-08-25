'use client';

/**
 * Bridges third-party OAuth callbacks to plugins.
 *
 * The generic callback page (`/[locale]/plugins/oauth/callback`) parks the
 * provider's `{ code, state }` payload in localStorage. A `storage` event
 * fires in every OTHER same-origin tab - i.e. in the tab where the plugin's
 * background sandbox instance is actually running. This listener forwards
 * those payloads (and same-tab CustomEvents from the callback page) into the
 * `authHooks.onOAuthCallback` hook bus so plugins can finish their PKCE
 * exchange.
 *
 * This component intentionally does nothing when mounted ON the callback
 * route: the callback tab must not process its own payload, otherwise two
 * app instances would race to exchange the single-use authorization code.
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { authHooks } from '@/lib/plugin-hooks';

const STORAGE_KEY = 'plugin-oauth-callback';
const EVENT_NAME = 'plugin-oauth-callback';
/** Window in which identical payloads are treated as duplicates. */
const DEDUP_MS = 60_000;

interface OAuthCallbackPayload {
  code?: unknown;
  state?: unknown;
  receivedAt?: unknown;
}

function parsePayload(raw: string | null | undefined): OAuthCallbackPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OAuthCallbackPayload;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.code !== 'string' ||
      typeof parsed.state !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function PluginOAuthCallbackListener() {
  const pathname = usePathname();
  // The callback route ends with /plugins/oauth/callback (locale is a
  // preceding segment). On that route this component is a no-op.
  const isCallbackRoute = !!pathname && pathname.endsWith('/plugins/oauth/callback');

  useEffect(() => {
    if (isCallbackRoute) return;

    let lastCode: string | null = null;
    let lastState: string | null = null;
    let lastAt = 0;

    const deliver = (payload: OAuthCallbackPayload | null) => {
      if (!payload || typeof payload.code !== 'string' || typeof payload.state !== 'string') return;
      const now = Date.now();
      if (payload.code === lastCode && payload.state === lastState && now - lastAt < DEDUP_MS) return;
      lastCode = payload.code;
      lastState = payload.state;
      lastAt = now;
      void authHooks.onOAuthCallback.emit(payload);
      // Best-effort cleanup so a reload doesn't replay an old payload.
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    };

    const onStorage = (ev: StorageEvent) => {
      if (ev.key !== STORAGE_KEY && ev.key !== null) return;
      deliver(parsePayload(ev.newValue ?? (() => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } })()));
    };
    const onCustomEvent = (ev: Event) => {
      const detail = (ev as CustomEvent<OAuthCallbackPayload>).detail;
      if (detail) deliver(detail);
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT_NAME, onCustomEvent);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(EVENT_NAME, onCustomEvent);
    };
  }, [isCallbackRoute]);

  return null;
}
