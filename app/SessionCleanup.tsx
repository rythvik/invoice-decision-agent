"use client";

import { useEffect } from "react";

/**
 * Wipes this visitor's run data the moment the tab/app closes. Fires via
 * navigator.sendBeacon on pagehide (reliable on mobile) and beforeunload (desktop
 * fallback) — both survive the page tearing down, unlike a normal fetch. Client-side
 * route changes within the app (Inbox ↔ Dashboard) don't unload the document, so they
 * never trigger this; only actually leaving/closing the tab does.
 */
export default function SessionCleanup() {
  useEffect(() => {
    let sent = false;
    const clear = () => {
      if (sent) return;
      sent = true;
      navigator.sendBeacon?.("/api/session/clear");
    };
    window.addEventListener("pagehide", clear);
    window.addEventListener("beforeunload", clear);
    return () => {
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("beforeunload", clear);
    };
  }, []);

  return null;
}
