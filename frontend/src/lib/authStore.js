import { apiGet, apiPost } from './http.js';

let state = { user: null, ready: false };
const listeners = new Set();

function set(patch) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state));
}

export const Auth = {
  get() { return state; },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  async init() {
    try {
      const { user } = await apiGet('/api/auth/me');
      set({ user, ready: true });
    } catch {
      set({ user: null, ready: true });
    }
    return state.user;
  },
  async register(username, email, password, turnstileToken) {
    const { user } = await apiPost('/api/auth/register', { username, email, password, turnstileToken });
    set({ user });
    return user;
  },
  // Resolves to the user, or to { twoFactor: true, ticket } when the account
  // has two-factor login on and the code step (loginSecondStep) comes next.
  async login(identifier, password) {
    const res = await apiPost('/api/auth/login', { identifier, password });
    if (res.twoFactor) return res;
    set({ user: res.user });
    return res.user;
  },
  async loginSecondStep(ticket, code) {
    const { user } = await apiPost('/api/auth/login/2fa', { ticket, code });
    set({ user });
    return user;
  },
  // Server-side, a deleted account's session is already gone; this just
  // forgets it here.
  async setPrivate(isPrivate) {
    const res = await apiPost('/api/auth/privacy', { private: isPrivate });
    set({ user: { ...state.user, isPrivate: res.isPrivate } });
  },
  // Re-reads the signed-in user, e.g. after confirming the email.
  async refresh() {
    return this.init();
  },
  forget() {
    set({ user: null });
  },
  async logout() {
    await apiPost('/api/auth/logout').catch(() => {});
    set({ user: null });
  },
};
