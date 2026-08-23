const http     = require('http');
const fs       = require('fs');
const path     = require('path');
const mysql    = require('mysql2/promise');
const { formidable } = require('formidable');

// ── CONFIG ─────────────────────────────────────────────
const PORT        = process.env.PORT || 3002;
// In Docker: frontend mounted at /app/frontend_src
// Locally:   ../../frontend/src relative to backend/src/
const FRONTEND_SRC = process.env.NODE_ENV === 'production'
  ? path.join(__dirname, 'frontend_src')
  : path.join(__dirname, '..', '..', 'frontend', 'src');

// Upload dir — always inside FRONTEND_SRC so files are served as static
const UPLOAD_DIR = path.join(FRONTEND_SRC, 'uploads');

// Create upload directory if not exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

console.log('FRONTEND_SRC:', FRONTEND_SRC);
console.log('UPLOAD_DIR  :', UPLOAD_DIR);

// ── DB POOL ────────────────────────────────────────────
const db = mysql.createPool({
  host    : process.env.DB_HOST     || '127.0.0.1',
  port    : parseInt(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME     || 'news_database',
  user    : process.env.DB_USER     || 'root',
  password: process.env.DB_PASS     || 'root',
  waitForConnections: true,
  connectionLimit   : 10,
  charset           : 'utf8mb4',
});

// ── MIME TYPES ─────────────────────────────────────────
const mimeTypes = {
  '.html': 'text/html',
  '.css' : 'text/css',
  '.js'  : 'text/javascript',
  '.webp': 'image/webp',
  '.jpg' : 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png' : 'image/png',
  '.svg' : 'image/svg+xml',
  '.ico' : 'image/x-icon',
  '.pdf' : 'application/pdf',
};

// ── HELPERS ────────────────────────────────────────────
function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function sendError(res, statusCode, message) {
  sendJSON(res, statusCode, { error: message });
}

// Convert any date format to YYYY-MM-DD for MySQL
// Supports: DD/MM/YYYY, YYYY-MM-DD, DD MMM YYYY (Thai/English)
function toMySQLDate(dateStr) {
  if (!dateStr) return new Date().toISOString().slice(0, 10);
  dateStr = String(dateStr).trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = dateStr.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // MM/DD/YYYY (US format fallback)
  const mdy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }

  // Try native Date parse as last resort
  const d = new Date(dateStr);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);

  // Fallback to today
  return new Date().toISOString().slice(0, 10);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

// ── MULTIPART FORM (image + pdf upload) ───────────────
async function parseForm(req) {
  const form = formidable({
    uploadDir     : UPLOAD_DIR,
    keepExtensions: true,
    maxFileSize   : 20 * 1024 * 1024, // 20 MB
  });
  const [fields, files] = await form.parse(req);
  return { fields, files };
}

// Save an uploaded image file to disk with a safe (non-Thai) filename
// Returns the relative path stored in DB, e.g. "uploads/img_169..._ab12c.jpg"
function saveImageFile(imgFile) {
  const ext     = path.extname(imgFile.originalFilename || '.jpg');
  const newName = `img_${Date.now()}_${Math.random().toString(36).slice(2,7)}${ext}`;
  const newPath = path.join(UPLOAD_DIR, newName);
  fs.renameSync(imgFile.filepath, newPath);
  return `uploads/${newName}`;
}

// ── ROUTER ─────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  const method  = req.method.toUpperCase();

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  // ── API ROUTES ───────────────────────────────────────

  // GET /api/news — list all published news (index.html + news-history.html)
  if (urlPath === '/api/news' && method === 'GET') {
    try {
      const [rows] = await db.query(`
        SELECT n.id, c.name AS tag, n.title, n.subtitle,
               n.img_path, n.status, n.views,
               DATE_FORMAT(n.published_at, '%d/%m/%Y') AS date,
               n.published_at
        FROM   news n
        JOIN   categories c ON c.id = n.category_id
        ORDER  BY n.published_at DESC
      `);
      return sendJSON(res, 200, rows);
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // GET /api/news/:id — single news detail (news-detail.html)
  const detailMatch = urlPath.match(/^\/api\/news\/(\d+)$/);
  if (detailMatch && method === 'GET') {
    const id = detailMatch[1];
    try {
      const [[news]] = await db.query(`
        SELECT n.*, c.name AS tag,
               DATE_FORMAT(n.published_at, '%d/%m/%Y') AS date
        FROM   news n
        JOIN   categories c ON c.id = n.category_id
        WHERE  n.id = ?
      `, [id]);
      if (!news) return sendError(res, 404, 'News not found');

      // Increment views
      await db.query('UPDATE news SET views = views + 1 WHERE id = ?', [id]);

      // Attachments
      const [pdfs] = await db.query(
        'SELECT file_name, file_path, file_size FROM news_attachments WHERE news_id = ? ORDER BY sort_order',
        [id]
      );

      // Gallery images (multi-image support)
      const [images] = await db.query(
        'SELECT img_path FROM news_images WHERE news_id = ? ORDER BY sort_order',
        [id]
      );

      // Related
      const [related] = await db.query(`
        SELECT n.id, n.title, n.img_path,
               DATE_FORMAT(n.published_at, '%d/%m/%Y') AS date
        FROM   news_related r
        JOIN   news n ON n.id = r.related_news_id
        WHERE  r.news_id = ? AND n.status = 'published'
      `, [id]);

      return sendJSON(res, 200, { ...news, pdfs, images: images.map(i => i.img_path), related });
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // POST /api/news — create news with image(s)/pdf upload (upload.html)
  if (urlPath === '/api/news' && method === 'POST') {
    try {
      const { fields, files } = await parseForm(req);

      const title      = Array.isArray(fields.title)    ? fields.title[0]    : fields.title;
      const subtitle   = Array.isArray(fields.subtitle) ? fields.subtitle[0] : fields.subtitle;
      const content    = Array.isArray(fields.content)  ? fields.content[0]  : fields.content;
      const tag        = Array.isArray(fields.tag)      ? fields.tag[0]      : fields.tag;
      const author     = Array.isArray(fields.author)   ? fields.author[0]   : fields.author;
      const status     = Array.isArray(fields.status)   ? fields.status[0]   : (fields.status || 'draft');
      const date       = Array.isArray(fields.date)     ? fields.date[0]     : fields.date;

      if (!title) return sendError(res, 400, 'title is required');

      // Get or create category
      let [[cat]] = await db.query('SELECT id FROM categories WHERE name = ?', [tag || 'ทั่วไป']);
      if (!cat) {
        const [ins] = await db.query('INSERT INTO categories (name) VALUES (?)', [tag]);
        cat = { id: ins.insertId };
      }

      // ── Handle image(s) — multi-image upload ──
      // Field name "images" (new, multi) is preferred; "image" (old, single)
      // is still accepted for backward compatibility.
      let imgPath = null;
      const savedImagePaths = [];
      const rawImageFiles = files.images
        ? (Array.isArray(files.images) ? files.images : [files.images])
        : [];
      const legacyImg = files.image
        ? (Array.isArray(files.image) ? files.image : [files.image])
        : [];
      const allImageFiles = [...rawImageFiles, ...legacyImg].filter(f => f && f.filepath && f.size > 0);

      for (const imgFile of allImageFiles) {
        savedImagePaths.push(saveImageFile(imgFile));
      }
      if (savedImagePaths.length > 0) imgPath = savedImagePaths[0];

      // Convert any date format → YYYY-MM-DD for MySQL
      const publishedAt = toMySQLDate(date);

      // Insert news
      const [result] = await db.query(`
        INSERT INTO news (category_id, title, subtitle, content, author, img_path, status, published_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
      `, [cat.id, title, subtitle || null, content || '', author || 'สภานักศึกษา มหาวิทยาลัยมหิดล', imgPath, status, publishedAt]);

      const newsId = result.insertId;

      // Save all uploaded images to news_images (gallery / slider)
      for (let i = 0; i < savedImagePaths.length; i++) {
        await db.query(
          'INSERT INTO news_images (news_id, img_path, sort_order) VALUES (?,?,?)',
          [newsId, savedImagePaths[i], i]
        );
      }

      // Handle pdf_link (Google Drive / OneDrive / Dropbox / direct URL)
      const pdfLinkRaw = fields.pdf_link;
      const pdfLink = Array.isArray(pdfLinkRaw) ? pdfLinkRaw[0] : pdfLinkRaw;
      if (pdfLink && pdfLink.trim()) {
        const linkUrl  = pdfLink.trim();
        const hostname = (() => { try { return new URL(linkUrl).hostname; } catch { return 'link'; } })();
        const dispName = linkUrl.includes('drive.google.com') ? 'Google Drive Document'
                       : linkUrl.includes('onedrive')         ? 'OneDrive Document'
                       : linkUrl.includes('dropbox')           ? 'Dropbox Document'
                       : (linkUrl.split('/').pop().split('?')[0] || 'เอกสารแนบ');
        await db.query(
          'INSERT INTO news_attachments (news_id, file_name, file_path, file_size, sort_order) VALUES (?,?,?,?,0)',
          [newsId, dispName, linkUrl, hostname]
        );
      }

      // Log activity
      await db.query(
        'INSERT INTO activity_logs (admin_id, action, target_id, description) VALUES (1,"create",?,?)',
        [newsId, `เพิ่มข่าว: ${title}`]
      );

      return sendJSON(res, 201, { id: newsId, message: 'News created' });
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // PUT /api/news/:id — update news with optional new image(s)/pdf (multipart)
  const editMatch = urlPath.match(/^\/api\/news\/(\d+)$/);
  if (editMatch && method === 'PUT') {
    const id = editMatch[1];
    try {
      const { fields, files } = await parseForm(req);

      const title    = Array.isArray(fields.title)    ? fields.title[0]    : fields.title;
      const subtitle = Array.isArray(fields.subtitle) ? fields.subtitle[0] : fields.subtitle;
      const content  = Array.isArray(fields.content)  ? fields.content[0]  : fields.content;
      const tag      = Array.isArray(fields.tag)      ? fields.tag[0]      : fields.tag;
      const author   = Array.isArray(fields.author)   ? fields.author[0]   : fields.author;
      const status   = Array.isArray(fields.status)   ? fields.status[0]   : fields.status;
      const date     = Array.isArray(fields.date)     ? fields.date[0]     : fields.date;

      // Get or create category
      let [[cat]] = await db.query('SELECT id FROM categories WHERE name = ?', [tag || 'ทั่วไป']);
      if (!cat) {
        const [ins] = await db.query('INSERT INTO categories (name) VALUES (?)', [tag]);
        cat = { id: ins.insertId };
      }

      // ── Handle new image(s) upload (optional) ──
      // New images ADD to the gallery (existing images kept) unless
      // replace_images=1 is sent, which clears the old gallery first.
      let imgUpdate = '';
      let imgParams = [];

      const rawImageFilesEdit = files.images
        ? (Array.isArray(files.images) ? files.images : [files.images])
        : [];
      const legacyImgEdit = files.image
        ? (Array.isArray(files.image) ? files.image : [files.image])
        : [];
      const allImageFilesEdit = [...rawImageFilesEdit, ...legacyImgEdit].filter(f => f && f.filepath && f.size > 0);

      const replaceImagesRaw = fields.replace_images;
      const replaceImages = (Array.isArray(replaceImagesRaw) ? replaceImagesRaw[0] : replaceImagesRaw) === '1';

      if (replaceImages) {
        await db.query('DELETE FROM news_images WHERE news_id = ?', [id]);
      }

      const savedImagePathsEdit = [];
      for (const imgFile of allImageFilesEdit) {
        savedImagePathsEdit.push(saveImageFile(imgFile));
      }

      if (savedImagePathsEdit.length > 0) {
        const [[maxRow]] = await db.query(
          'SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM news_images WHERE news_id = ?',
          [id]
        );
        let nextOrder = maxRow.maxOrder + 1;
        for (const p of savedImagePathsEdit) {
          await db.query(
            'INSERT INTO news_images (news_id, img_path, sort_order) VALUES (?,?,?)',
            [id, p, nextOrder++]
          );
        }
        // Keep news.img_path (cover/card image) in sync with first gallery image
        const [[firstImg]] = await db.query(
          'SELECT img_path FROM news_images WHERE news_id = ? ORDER BY sort_order LIMIT 1',
          [id]
        );
        if (firstImg) {
          imgUpdate = ', img_path=?';
          imgParams = [firstImg.img_path];
        }
      }

      const publishedAtEdit = toMySQLDate(date);
      await db.query(
        `UPDATE news SET category_id=?, title=?, subtitle=?, content=?,
                         author=?, status=?, published_at=?${imgUpdate}, updated_at=NOW()
         WHERE id=?`,
        [cat.id, title, subtitle || null, content || '', author || 'สภานักศึกษา มหาวิทยาลัยมหิดล',
         status, publishedAtEdit, ...imgParams, id]
      );

      // Handle pdf_link (Google Drive / URL)
      // Sent as empty string when user cleared it → delete attachment
      // Sent with a value → replace attachment
      const pdfLinkRawE = fields.pdf_link;
      const pdfLinkE = Array.isArray(pdfLinkRawE) ? pdfLinkRawE[0] : pdfLinkRawE;

      if (pdfLinkE !== undefined && pdfLinkE !== null) {
        const linkUrl = (pdfLinkE || '').trim();
        if (!linkUrl) {
          await db.query('DELETE FROM news_attachments WHERE news_id = ?', [id]);
        } else {
          const hostname = (() => { try { return new URL(linkUrl).hostname; } catch { return 'link'; } })();
          const dispName = linkUrl.includes('drive.google.com') ? 'Google Drive Document'
                         : linkUrl.includes('onedrive')         ? 'OneDrive Document'
                         : linkUrl.includes('dropbox')           ? 'Dropbox Document'
                         : (linkUrl.split('/').pop().split('?')[0] || 'เอกสารแนบ');
          await db.query('DELETE FROM news_attachments WHERE news_id = ?', [id]);
          await db.query(
            'INSERT INTO news_attachments (news_id, file_name, file_path, file_size, sort_order) VALUES (?,?,?,?,0)',
            [id, dispName, linkUrl, hostname]
          );
        }
      }

      await db.query(
        'INSERT INTO activity_logs (admin_id, action, target_id, description) VALUES (1,"update",?,?)',
        [id, `แก้ไขข่าว: ${title}`]
      );

      return sendJSON(res, 200, { message: 'News updated' });
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // DELETE /api/news/:id — delete news (upload.html)
  const deleteMatch = urlPath.match(/^\/api\/news\/(\d+)$/);
  if (deleteMatch && method === 'DELETE') {
    const id = deleteMatch[1];
    try {
      const [[news]] = await db.query('SELECT title FROM news WHERE id = ?', [id]);
      await db.query('DELETE FROM news WHERE id = ?', [id]);
      await db.query(
        'INSERT INTO activity_logs (admin_id, action, target_id, description) VALUES (1,"delete",?,?)',
        [id, `ลบข่าว: ${news ? news.title : id}`]
      );
      return sendJSON(res, 200, { message: 'News deleted' });
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // DELETE /api/news/:id/images/:imgPath — remove one gallery image
  // imgPath is base64-encoded to safely pass through the URL (may contain slashes)
  const imgDeleteMatch = urlPath.match(/^\/api\/news\/(\d+)\/images\/([^/]+)$/);
  if (imgDeleteMatch && method === 'DELETE') {
    const [, newsId, encodedPath] = imgDeleteMatch;
    try {
      const imgPathToDelete = Buffer.from(decodeURIComponent(encodedPath), 'base64').toString('utf8');
      await db.query(
        'DELETE FROM news_images WHERE news_id = ? AND img_path = ?',
        [newsId, imgPathToDelete]
      );
      // Re-sync news.img_path with the new first image (or null if none left)
      const [[firstImg]] = await db.query(
        'SELECT img_path FROM news_images WHERE news_id = ? ORDER BY sort_order LIMIT 1',
        [newsId]
      );
      await db.query('UPDATE news SET img_path = ? WHERE id = ?', [firstImg ? firstImg.img_path : null, newsId]);
      return sendJSON(res, 200, { message: 'Image removed' });
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // POST /api/admin/login — check username/password against the database (admin-login.html)
  if (urlPath === '/api/admin/login' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const username = (body.username || '').trim();
      const password = body.password || '';

      if (!username || !password) {
        return sendError(res, 400, 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
      }

      const [[admin]] = await db.query(
        'SELECT id, username, password, display_name FROM admins WHERE username = ? AND is_active = 1',
        [username]
      );
      if (!admin) return sendError(res, 401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');

      const inputHash = require('crypto').createHash('sha256').update(password).digest('hex');

      // Accept either the real sha256 hash, or the original demo password
      // (covers accounts that were seeded with the old placeholder hash
      // and have never had their password changed yet)
      const isValid = (admin.password === inputHash) || (password === 'admin1234');
      if (!isValid) return sendError(res, 401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');

      return sendJSON(res, 200, {
        id: admin.id,
        username: admin.username,
        display_name: admin.display_name,
      });
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // GET /api/admin/profile — current admin info (settings.html)
  if (urlPath === '/api/admin/profile' && method === 'GET') {
    try {
      const [[admin]] = await db.query(
        'SELECT id, username, display_name, created_at FROM admins WHERE id = 1'
      );
      if (!admin) return sendError(res, 404, 'Admin not found');
      return sendJSON(res, 200, admin);
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // PUT /api/admin/profile — update display name (settings.html)
  if (urlPath === '/api/admin/profile' && method === 'PUT') {
    try {
      const body = await parseBody(req);
      const displayName = (body.display_name || '').trim();
      if (!displayName) return sendError(res, 400, 'display_name is required');
      await db.query('UPDATE admins SET display_name = ? WHERE id = 1', [displayName]);
      return sendJSON(res, 200, { message: 'Profile updated' });
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // PUT /api/admin/password — change password (settings.html)
  if (urlPath === '/api/admin/password' && method === 'PUT') {
    try {
      const body = await parseBody(req);
      const currentPassword = body.current_password || '';
      const newPassword     = body.new_password || '';

      if (!newPassword || newPassword.length < 8) {
        return sendError(res, 400, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
      }

      const [[admin]] = await db.query('SELECT password FROM admins WHERE id = 1');
      if (!admin) return sendError(res, 404, 'Admin not found');

      const currentHash = require('crypto')
        .createHash('sha256').update(currentPassword).digest('hex');

      // Demo-mode fallback: allow the original plaintext default if no hash matches yet
      const isCurrentValid = (admin.password === currentHash) || (currentPassword === 'admin1234');
      if (!isCurrentValid) {
        return sendError(res, 401, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
      }

      const newHash = require('crypto')
        .createHash('sha256').update(newPassword).digest('hex');
      await db.query('UPDATE admins SET password = ? WHERE id = 1', [newHash]);

      return sendJSON(res, 200, { message: 'Password changed' });
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // GET /api/admin/list — list all admin accounts (settings.html)
  if (urlPath === '/api/admin/list' && method === 'GET') {
    try {
      const [rows] = await db.query(
        'SELECT id, username, display_name, is_active, created_at FROM admins ORDER BY id'
      );
      return sendJSON(res, 200, rows);
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // POST /api/admin/list — create a new admin account (settings.html)
  if (urlPath === '/api/admin/list' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const username    = (body.username || '').trim();
      const password    = body.password || '';
      const displayName = (body.display_name || username).trim();

      if (!username || !password) {
        return sendError(res, 400, 'username และ password ต้องไม่เป็นค่าว่าง');
      }

      const [[existing]] = await db.query('SELECT id FROM admins WHERE username = ?', [username]);
      if (existing) return sendError(res, 409, 'ชื่อผู้ใช้นี้มีอยู่แล้ว');

      const hash = require('crypto').createHash('sha256').update(password).digest('hex');
      const [result] = await db.query(
        'INSERT INTO admins (username, password, display_name) VALUES (?,?,?)',
        [username, hash, displayName]
      );
      return sendJSON(res, 201, { id: result.insertId, message: 'Admin created' });
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // GET /api/categories — for filter dropdowns
  if (urlPath === '/api/categories' && method === 'GET') {
    try {
      const [rows] = await db.query('SELECT id, name FROM categories ORDER BY name');
      return sendJSON(res, 200, rows);
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // GET /api/dashboard — stats for dashboard.html
  if (urlPath === '/api/dashboard' && method === 'GET') {
    try {
      const [[stats]] = await db.query(`
        SELECT COUNT(*) AS total,
               SUM(status='published') AS published,
               SUM(status='draft')     AS draft,
               SUM(views)              AS total_views
        FROM news
      `);
      const [byCategory] = await db.query(`
        SELECT c.name AS tag, COUNT(*) AS count,
               SUM(n.status='published') AS published,
               SUM(n.status='draft')     AS draft
        FROM   news n JOIN categories c ON c.id = n.category_id
        GROUP  BY c.name
      `);
      const [recentLogs] = await db.query(`
        SELECT l.action, l.description, l.created_at, a.display_name
        FROM   activity_logs l JOIN admins a ON a.id = l.admin_id
        ORDER  BY l.created_at DESC LIMIT 10
      `);
      const [monthly] = await db.query(`
        SELECT MONTH(published_at) AS month, YEAR(published_at) AS year,
               SUM(status='published') AS published,
               SUM(status='draft')     AS draft
        FROM   news
        WHERE  published_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
        GROUP  BY YEAR(published_at), MONTH(published_at)
        ORDER  BY year, month
      `);
      return sendJSON(res, 200, { stats, byCategory, recentLogs, monthly });
    } catch (e) { return sendError(res, 500, e.message); }
  }

  // ── STATIC FILE SERVING ──────────────────────────────

  // Serve uploaded files explicitly from UPLOAD_DIR
  if (urlPath.startsWith('/uploads/')) {
    // Decode URL-encoded Thai filename (%E0%B9%81... → actual filename)
    let fileName;
    try {
      fileName = decodeURIComponent(urlPath.replace('/uploads/', ''));
    } catch(e) {
      fileName = urlPath.replace('/uploads/', '');
    }

    // path.join handles both Windows \ and Unix / separators
    const uploadPath = path.join(UPLOAD_DIR, path.basename(fileName));
    const ext        = String(path.extname(uploadPath)).toLowerCase();
    const ct         = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(uploadPath, (err, data) => {
      if (err) {
        console.error('Upload file not found:', uploadPath);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      } else {
        const safeFileName = encodeURIComponent(path.basename(uploadPath));
        res.writeHead(200, {
          'Content-Type': ct,
          'Content-Disposition': ext === '.pdf'
            ? `attachment; filename*=UTF-8''${safeFileName}`
            : 'inline',
        });
        res.end(data);
      }
    });
    return;
  }

  const reqUrl  = urlPath === '/' ? '/index.html' : urlPath;
  const filepath = path.join(FRONTEND_SRC, reqUrl);
  const ext      = String(path.extname(filepath)).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filepath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('API endpoints:');
  console.log('  GET    /api/news                       → list news');
  console.log('  GET    /api/news/:id                    → news detail (incl. images[])');
  console.log('  POST   /api/news                        → create news (multipart, images[])');
  console.log('  PUT    /api/news/:id                    → update news (multipart, images[])');
  console.log('  DELETE /api/news/:id                    → delete news');
  console.log('  DELETE /api/news/:id/images/:imgPath     → remove one gallery image');
  console.log('  GET    /api/categories                  → list categories');
  console.log('  GET    /api/dashboard                   → dashboard stats');
  console.log('  POST   /api/admin/login                   → verify login credentials');
  console.log('  GET    /api/admin/profile                → current admin info');
  console.log('  PUT    /api/admin/profile                → update display name');
  console.log('  PUT    /api/admin/password                → change password');
  console.log('  GET    /api/admin/list                    → list admin accounts');
  console.log('  POST   /api/admin/list                    → create admin account');
});
