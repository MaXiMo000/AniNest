import { apiGet } from './http.js';

export const Users = {
  profile: (username) => apiGet(`/api/users/${encodeURIComponent(username)}`),
};
