"use client";

import { useEffect, useState } from "react";

function base64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalized);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

type PushState = "unsupported" | "disabled" | "off" | "on" | "denied";

/**
 * Bell toggle: registers the service worker and subscribes this device to
 * push. Shown in every role's header — engineers get the 6 pm consumption
 * reminder, accounts get fund-request alerts, the owner gets approval and
 * audit alerts.
 */
export function EnablePushButton() {
  const [state, setState] = useState<PushState>("unsupported");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      const config = await fetch("/api/push").then((r) => r.json()).catch(() => null);
      if (!config?.enabled) {
        setState("disabled");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      setState(existing ? "on" : "off");
    })().catch(() => {});
  }, []);

  async function toggle() {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        await existing.unsubscribe();
        setState("off");
        return;
      }
      const config = await fetch("/api/push").then((r) => r.json());
      if (!config.publicKey) return;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToUint8Array(config.publicKey) as BufferSource,
      });
      const json = subscription.toJSON();
      await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      });
      setState("on");
    } catch {
      setState(Notification.permission === "denied" ? "denied" : "off");
    }
  }

  if (state === "unsupported" || state === "disabled") return null;
  if (state === "denied") {
    return (
      <span className="text-[11px] text-slate-400" title="Notifications blocked in browser settings">
        🔕 blocked
      </span>
    );
  }

  return (
    <button
      onClick={toggle}
      className={
        state === "on"
          ? "rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700"
          : "rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
      }
      title={state === "on" ? "Push notifications are on — tap to turn off" : "Enable push notifications on this device"}
    >
      {state === "on" ? "🔔 Alerts on" : "🔕 Enable alerts"}
    </button>
  );
}
