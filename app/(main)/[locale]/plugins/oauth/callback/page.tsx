"use client";

/**
 * Generic OAuth callback landing page for plugins.
 *
 * Plugins that connect to third-party OAuth providers (Google, Nextcloud, …)
 * cannot register their own routes. They send the user to the provider's
 * authorize URL with a redirect_uri pointing here; this page parks the
 * authorization code + state and notifies the plugin that initiated the flow.
 * No tokens ever pass through this page - the plugin exchanges the code
 * itself (via api.http.fetch, through its origin allowlist).
 *
 * Delivery chain:
 *   1. The payload `{ code, state, receivedAt }` is written to sessionStorage
 *      (`plugin-oauth-callback`) and mirrored into localStorage under the same
 *      key, plus a same-tab CustomEvent `plugin-oauth-callback`.
 *   2. The host listens via `PluginOAuthCallbackListener` (mounted in the
 *      [locale] layout): the localStorage write raises a `storage` event in
 *      every OTHER tab of this origin, including the tab that started the
 *      flow. The listener forwards the payload to plugins through the
 *      `authHooks.onOAuthCallback` hook bus.
 *   3. Each plugin validates `state` against the verifier it stashed before
 *      redirecting and ignores payloads that are not its own.
 *
 * The page then shows a status screen - the user closes the tab (or switches
 * back) while the original tab completes the token exchange.
 */

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

export const PLUGIN_OAUTH_STORAGE_KEY = "plugin-oauth-callback";
export const PLUGIN_OAUTH_EVENT = "plugin-oauth-callback";

function PluginOAuthCallbackInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"waiting" | "ok" | "error">("waiting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      setStatus("error");
      setErrorMessage(
        errorParam === "access_denied"
          ? "Authorization was denied."
          : `Authorization failed: ${errorParam}`,
      );
      return;
    }

    if (!code || !state) {
      setStatus("error");
      setErrorMessage("Missing authorization code or state.");
      return;
    }

    const payload = { code, state, receivedAt: Date.now() };
    try {
      sessionStorage.setItem(PLUGIN_OAUTH_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // sessionStorage unavailable - the event still fires for same-tab flows
    }
    try {
      // localStorage (unlike sessionStorage) raises a `storage` event in the
      // OTHER tabs of this origin - that is what carries the payload across
      // to the tab where the plugin's background instance is running.
      localStorage.setItem(PLUGIN_OAUTH_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // localStorage unavailable too - same-tab CustomEvent still works
    }
    // Same-tab consumers can react immediately without waiting for storage.
    window.dispatchEvent(
      new CustomEvent(PLUGIN_OAUTH_EVENT, { detail: payload }),
    );
    setStatus("ok");
  }, [searchParams]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
      {status === "waiting" && (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Completing authorization&hellip;
          </p>
        </>
      )}
      {status === "ok" && (
        <>
          <CheckCircle2 className="h-8 w-8 text-green-600" />
          <div>
            <p className="text-sm font-medium">Authorization received.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              You can return to the tab where you started the connection.
            </p>
          </div>
        </>
      )}
      {status === "error" && (
        <>
          <XCircle className="h-8 w-8 text-destructive" />
          <div>
            <p className="text-sm font-medium">Authorization failed.</p>
            {errorMessage && (
              <p className="mt-1 text-sm text-muted-foreground">
                {errorMessage}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function PluginOAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <PluginOAuthCallbackInner />
    </Suspense>
  );
}
