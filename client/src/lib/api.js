import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export const api = axios.create({
  baseURL: `${baseURL}/api`,
  withCredentials: true,
  headers: { 'X-Requested-With': 'recruitly' },
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const e = err.response?.data?.error;
    err.userMessage = e?.message || (err.code === 'ERR_NETWORK' ? 'Cannot reach the server. Is the backend running?' : err.message || 'Something went wrong');
    err.code2 = e?.code;
    err.details = e?.details;
    if (err.response?.status === 401 && !err.config?.url?.includes('/auth/')) window.dispatchEvent(new Event('recruitly:unauthorized'));
    return Promise.reject(err);
  },
);

export const get = (url, params) => api.get(url, { params }).then((r) => r.data.data);
export const post = (url, body) => api.post(url, body).then((r) => r.data.data);
export const put = (url, body) => api.put(url, body).then((r) => r.data.data);
export const patch = (url, body) => api.patch(url, body).then((r) => r.data.data);
export const del = (url) => api.delete(url).then((r) => r.data.data);
export const apiUrl = (path) => `${baseURL}/api${path}`;

export async function download(path, filename) {
  const r = await api.get(path, { responseType: 'blob' });
  const url = URL.createObjectURL(r.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const errMsg = (e) => e?.userMessage || e?.message || 'Something went wrong';
