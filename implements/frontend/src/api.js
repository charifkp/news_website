// ================================
// api.js -- shared API helper
// วางไว้ใน frontend/src/api.js
//แล้ว <script src='/api.js'></script> ในทุกหน้า
// ================================



const API_BASE = '' // same origin - if deploy isolate domain change to http://localhost:3002'

const API = {
    // ── NEWS ─────────────────────────────────────────

    // GET all news
    async getNews(){
        const res = await fetch(`${API_BASE}/api/news`);
        return res.json()
    },

    // GET single news by id
    async getNewsById(id) {
        const res = await fetch(`${API_BASE}/api/news/${id}`);
        return res.json();
    },

    // POST create news (FormData — supports image + pdf)
    async createNews(formData) {
        const res = await fetch(`${API_BASE}/api/news`, {
            method: 'POST',
            body: formData,   // multipart/form-data — no Content-Type header needed
        });
        return res.json();
    },
 
  // PUT update news
  async updateNews(id, data) {
    const res = await fetch(`${API_BASE}/api/news/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },
  // DELETE news
  async deleteNews(id) {
    const res = await fetch(`${API_BASE}/api/news/${id}`, { method: 'DELETE' });
    return res.json();
  },
 
   // DELETE one gallery image from a news item
  async deleteNewsImage(newsId, imgPath) {
    const encoded = encodeURIComponent(btoa(unescape(encodeURIComponent(imgPath))));
    const res = await fetch(`${API_BASE}/api/news/${newsId}/images/${encoded}`, { method: 'DELETE' });
    return res.json();
  },
  
  // ── CATEGORIES ────────────────────────────────────
  async getCategories() {
    const res = await fetch(`${API_BASE}/api/categories`);
    return res.json();
  },
 
  // ── DASHBOARD ─────────────────────────────────────
  async getDashboard() {
    const res = await fetch(`${API_BASE}/api/dashboard`);
    return res.json();
  },
};







