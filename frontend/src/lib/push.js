import { apiGet, apiPost } from './http.js';

// Browser push for the notifications page (backend/src/lib/push.js). Only
// offered when the browser supports it, the service worker is registered
// (production builds) and the server has VAPID keys.

export function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function supported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// {available, subscribed, denied}; available=false means don't show anything.
export async function pushState() {
  if (!supported()) return { available: false };
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return { available: false };
  let key;
  try {
    key = await apiGet('/api/notifications/push/key');
  } catch {
    return { available: false };
  }
  if (!key.enabled || !key.publicKey) return { available: false };
  const sub = await reg.pushManager.getSubscription();
  return { available: true, subscribed: Boolean(sub), denied: Notification.permission === 'denied', publicKey: key.publicKey, reg };
}

export async function enablePush(state) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Alerts are blocked for this site. Allow notifications in your browser settings first.');
  let sub;
  try {
    sub = await state.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(state.publicKey) });
  } catch {
    throw new Error('This browser couldn’t turn on alerts. Try again, or install AniNest as an app first.');
  }
  const json = sub.toJSON();
  await apiPost('/api/notifications/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
}

export async function disablePush(state) {
  const sub = await state.reg.pushManager.getSubscription();
  if (!sub) return;
  await apiPost('/api/notifications/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}
