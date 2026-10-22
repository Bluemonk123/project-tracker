// Small fetch wrapper. Throws Error(message) with .status on failure.
async function request(method, url, body, { raw = false } = {}) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + url, opts);
  if (raw) return res;
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json();
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status}).`);
    err.status = res.status;
    if (res.status === 401 && !url.startsWith('/auth/') && !url.startsWith('/setup')) window.dispatchEvent(new Event('pt:signed-out'));
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  patch: (url, body) => request('PATCH', url, body ?? {}),
  put: (url, body) => request('PUT', url, body ?? {}),
  del: (url, body) => request('DELETE', url, body),
  upload: (file, containerType, containerId) => {
    const fd = new FormData();
    fd.append('container_type', containerType);
    fd.append('container_id', containerId);
    fd.append('file', file);
    return request('POST', '/attachments', fd);
  },
};

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
