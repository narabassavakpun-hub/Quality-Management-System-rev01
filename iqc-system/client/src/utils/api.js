import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // ไม่ redirect ถ้า request นั้นคือ /auth/me (AuthContext จัดการเอง)
    // redirect เฉพาะเมื่อ session หมดอายุขณะใช้งาน
    const url = err.config?.url || '';
    const isAuthEndpoint = url.includes('/auth/me') || url.includes('/auth/login');
    if (err.response?.status === 401 && !isAuthEndpoint) {
      const msg = err.response?.data?.error;
      if (msg) sessionStorage.setItem('login_notice', msg);
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

// Download any file from an API endpoint immediately (works cross-browser).
// Must append <a> to DOM before .click() — Firefox/Safari require it.
// res.data is already a Blob with correct Content-Type from server.
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

export async function downloadFile(endpoint, params, filename) {
  const res = await api.get(endpoint, { params, responseType: 'blob' });
  triggerDownload(res.data, filename);
}

// Convenience aliases
export const downloadExcel = (endpoint, params, filename) => downloadFile(endpoint, params, filename);
export const downloadPdf   = (endpoint, params, filename) => downloadFile(endpoint, params, filename);
