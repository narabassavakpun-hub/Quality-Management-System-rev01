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
