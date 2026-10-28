const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const mysql = require('mysql2/promise');
const { formidable } = require('formidable');

jest.mock('mysql2/promise', () => ({
  createPool: jest.fn(),
}));

jest.mock('formidable', () => ({
  formidable: jest.fn(),
}));

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const DEFAULT_AUTHOR = 'สภานักศึกษา มหาวิทยาลัยมหิดล';
const today = () => new Date().toISOString().slice(0, 10);

describe('news backend – full route coverage', () => {
  let requestHandler;
  let query;
  let listen;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    query = jest.fn();
    mysql.createPool.mockReturnValue({ query });

    // listen executes its callback so the "Server running" block is covered
    listen = jest.fn((port, host, cb) => cb && cb());
    jest.spyOn(http, 'createServer').mockImplementation((handler) => {
      requestHandler = handler;
      return { listen };
    });

    require('../../src/index');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    query.mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  // ── helpers ──────────────────────────────────────────
  async function sendRequest(method, url, opts = {}) {
    let chunks = [];
    if (opts.raw !== undefined) chunks = [opts.raw];
    else if (opts.body !== undefined) chunks = [JSON.stringify(opts.body)];

    const req = Readable.from(chunks);
    req.method = method;
    req.url = url;

    const res = { statusCode: null, headers: null, body: null };
    const done = new Promise((resolve) => {
      res.writeHead = (statusCode, headers) => {
        res.statusCode = statusCode;
        res.headers = headers;
      };
      res.end = (b) => {
        res.body = b;
        resolve();
      };
    });

    if (opts.form) {
      formidable.mockReturnValue({
        parse: jest.fn().mockResolvedValue([opts.form.fields || {}, opts.form.files || {}]),
      });
    } else {
      formidable.mockReturnValue({ parse: jest.fn().mockResolvedValue([{}, {}]) });
    }

    await requestHandler(req, res);
    await done;

    let json;
    try { json = JSON.parse(res.body); } catch { json = undefined; }
    return { statusCode: res.statusCode, headers: res.headers, body: res.body, json };
  }

  // Routes SQL by pattern so tests don't depend on exact call order
  function mockDb(o = {}) {
    const opts = {
      category: [{ id: 3 }],
      news: { title: 'Old title' },
      maxOrder: -1,
      firstImg: { img_path: 'uploads/first.jpg' },
      admin: { id: 1, username: 'admin', password: sha256('pw'), display_name: 'Admin', created_at: 'x' },
      existing: false,
      ...o,
    };
    query.mockImplementation(async (sql) => {
      if (/SELECT id FROM categories/.test(sql)) return [opts.category];
      if (/INSERT INTO categories/.test(sql)) return [{ insertId: 9 }];
      if (/INSERT INTO news \(/.test(sql)) return [{ insertId: 50 }];
      if (/SELECT title FROM news/.test(sql)) return [opts.news ? [opts.news] : []];
      if (/COALESCE\(MAX/.test(sql)) return [[{ maxOrder: opts.maxOrder }]];
      if (/SELECT img_path FROM news_images/.test(sql)) return [opts.firstImg ? [opts.firstImg] : []];
      if (/FROM admins WHERE username = \? AND is_active/.test(sql)) return [opts.admin ? [opts.admin] : []];
      if (/SELECT id FROM admins WHERE username/.test(sql)) return [opts.existing ? [{ id: 1 }] : []];
      if (/FROM admins WHERE id = 1/.test(sql)) return [opts.admin ? [opts.admin] : []];
      if (/INSERT INTO admins/.test(sql)) return [{ insertId: 11 }];
      if (/FROM admins ORDER BY id/.test(sql)) return [[{ id: 1, username: 'admin' }]];
      if (/FROM categories ORDER BY name/.test(sql)) return [[{ id: 1, name: 'Campus' }]];
      return [{}];
    });
    return opts;
  }

  const insertNewsCall = () => query.mock.calls.find((c) => /INSERT INTO news \(/.test(c[0]));
  const callsMatching = (re) => query.mock.calls.filter((c) => re.test(c[0]));
  const imgFile = (name = 'a.jpg') => ({ filepath: `/tmp/${name}`, size: 10, originalFilename: name });

  // ── CORS ─────────────────────────────────────────────
  test('server starts listening on configured port', () => {
    expect(listen).toHaveBeenCalledWith(expect.anything(), '0.0.0.0', expect.any(Function));
  });

  test('OPTIONS returns 204 with CORS headers', async () => {
    const r = await sendRequest('OPTIONS', '/api/news');
    expect(r.statusCode).toBe(204);
    expect(r.headers['Access-Control-Allow-Origin']).toBe('*');
  });

  // ── POST /api/news ───────────────────────────────────
  describe('POST /api/news', () => {
    test('returns 400 when title is missing', async () => {
      const r = await sendRequest('POST', '/api/news', { form: { fields: { tag: ['x'] } } });
      expect(r.statusCode).toBe(400);
      expect(r.json.error).toBe('title is required');
    });

    test('creates news with new category, several images, drive link and array fields', async () => {
      mockDb({ category: [] });
      const rename = jest.spyOn(fs, 'renameSync').mockImplementation(() => {});

      const r = await sendRequest('POST', '/api/news', {
        form: {
          fields: {
            title: ['Big news'], subtitle: ['Sub'], content: ['Body'], tag: ['Sports'],
            author: ['Me'], status: ['published'], date: ['05/03/2026'],
            pdf_link: ['https://drive.google.com/file/d/1/view'],
          },
          files: {
            images: [imgFile('a.jpg'), imgFile('b.png'), { filepath: '/tmp/empty', size: 0 }],
            image: imgFile('legacy.jpg'), // single object, legacy field
          },
        },
      });

      expect(r.statusCode).toBe(201);
      expect(r.json).toEqual({ id: 50, message: 'News created' });
      expect(rename).toHaveBeenCalledTimes(3);

      const params = insertNewsCall()[1];
      expect(params.slice(0, 5)).toEqual([9, 'Big news', 'Sub', 'Body', 'Me']);
      expect(params[5]).toMatch(/^uploads\/img_\d+_[a-z0-9]+\.jpg$/);
      expect(params.slice(6)).toEqual(['published', '2026-03-05']);

      expect(callsMatching(/INSERT INTO news_images/)).toHaveLength(3);
      const att = callsMatching(/INSERT INTO news_attachments/)[0][1];
      expect(att).toEqual([50, 'Google Drive Document', 'https://drive.google.com/file/d/1/view', 'drive.google.com']);
      expect(callsMatching(/INSERT INTO activity_logs/)).toHaveLength(1);
    });

    test('uses defaults when optional fields are missing (plain string fields)', async () => {
      mockDb();
      const r = await sendRequest('POST', '/api/news', { form: { fields: { title: 'Only title' } } });

      expect(r.statusCode).toBe(201);
      expect(query.mock.calls[0][1]).toEqual(['ทั่วไป']);
      expect(insertNewsCall()[1]).toEqual([3, 'Only title', null, '', DEFAULT_AUTHOR, null, 'draft', today()]);
      expect(callsMatching(/news_images/)).toHaveLength(0);
      expect(callsMatching(/news_attachments/)).toHaveLength(0);
    });

    test.each([
      ['https://onedrive.live.com/x', 'OneDrive Document', 'onedrive.live.com'],
      ['https://www.dropbox.com/s/abc', 'Dropbox Document', 'www.dropbox.com'],
      ['https://example.com/files/report.pdf?dl=1', 'report.pdf', 'example.com'],
      ['https://example.com/', 'เอกสารแนบ', 'example.com'],
      ['not a url', 'not a url', 'link'],
    ])('pdf_link %s is stored as "%s"', async (link, name, host) => {
      mockDb();
      await sendRequest('POST', '/api/news', { form: { fields: { title: 'T', pdf_link: link } } });
      expect(callsMatching(/INSERT INTO news_attachments/)[0][1]).toEqual([50, name, link, host]);
    });

    test('ignores a blank pdf_link', async () => {
      mockDb();
      await sendRequest('POST', '/api/news', { form: { fields: { title: 'T', pdf_link: '   ' } } });
      expect(callsMatching(/news_attachments/)).toHaveLength(0);
    });

    test.each([
      ['2026-10-22', '2026-10-22'],
      ['5/3/2026', '2026-03-05'],
      ['5-3-2026', '2026-03-05'],
      ['2026-10-22T10:00:00Z', '2026-10-22'],
      ['garbage', today()],
      [undefined, today()],
    ])('date %p is saved as %s', async (date, expected) => {
      mockDb();
      await sendRequest('POST', '/api/news', { form: { fields: { title: 'T', date } } });
      expect(insertNewsCall()[1][7]).toBe(expected);
    });

    test('image without original filename still gets a safe generated name', async () => {
      mockDb();
      jest.spyOn(fs, 'renameSync').mockImplementation(() => {});
      await sendRequest('POST', '/api/news', {
        form: { fields: { title: 'T' }, files: { images: [{ filepath: '/tmp/x', size: 5 }] } },
      });
      expect(insertNewsCall()[1][5]).toMatch(/^uploads\/img_/);
    });
  });

  // ── PUT /api/news/:id ────────────────────────────────
  describe('PUT /api/news/:id', () => {
    test('updates news, replaces gallery, adds images, new category and pdf link', async () => {
      mockDb({ category: [], maxOrder: 4 });
      jest.spyOn(fs, 'renameSync').mockImplementation(() => {});

      const r = await sendRequest('PUT', '/api/news/7', {
        form: {
          fields: {
            title: ['Edited'], subtitle: ['S'], content: ['C'], tag: ['Events'], author: ['A'],
            status: ['published'], date: ['2026-10-22'], replace_images: ['1'],
            pdf_link: ['https://example.com/doc.pdf'],
          },
          files: { images: [imgFile('1.jpg'), imgFile('2.jpg')], image: [imgFile('3.jpg')] },
        },
      });

      expect(r.statusCode).toBe(200);
      expect(r.json).toEqual({ message: 'News updated' });
      expect(callsMatching(/DELETE FROM news_images/)[0][1]).toEqual(['7']);

      const inserts = callsMatching(/INSERT INTO news_images/).map((c) => c[1]);
      expect(inserts.map((p) => p[2])).toEqual([5, 6, 7]);

      const update = callsMatching(/UPDATE news SET category_id/)[0];
      expect(update[0]).toContain('img_path=?');
      expect(update[1]).toEqual([9, 'Edited', 'S', 'C', 'A', 'published', '2026-10-22', 'uploads/first.jpg', '7']);

      expect(callsMatching(/DELETE FROM news_attachments/)).toHaveLength(1);
      expect(callsMatching(/INSERT INTO news_attachments/)[0][1]).toEqual([
        '7', 'doc.pdf', 'https://example.com/doc.pdf', 'example.com',
      ]);
    });

    test('updates plain fields only (no images, no pdf_link) and applies defaults', async () => {
      mockDb();
      const r = await sendRequest('PUT', '/api/news/8', {
        form: { fields: { title: 'T', status: 'draft', date: '2026-01-02', replace_images: '0' } },
      });

      expect(r.statusCode).toBe(200);
      const update = callsMatching(/UPDATE news SET category_id/)[0];
      expect(update[0]).not.toContain('img_path=?');
      expect(update[1]).toEqual([3, 'T', null, '', DEFAULT_AUTHOR, 'draft', '2026-01-02', '8']);
      expect(callsMatching(/news_attachments/)).toHaveLength(0);
      expect(callsMatching(/DELETE FROM news_images/)).toHaveLength(0);
    });

    test('removes the attachment when pdf_link is sent empty', async () => {
      mockDb();
      await sendRequest('PUT', '/api/news/8', { form: { fields: { title: 'T', pdf_link: '' } } });
      expect(callsMatching(/DELETE FROM news_attachments/)).toHaveLength(1);
      expect(callsMatching(/INSERT INTO news_attachments/)).toHaveLength(0);
    });

    test('keeps news.img_path unchanged when no gallery image remains after upload', async () => {
      mockDb({ firstImg: null });
      jest.spyOn(fs, 'renameSync').mockImplementation(() => {});
      await sendRequest('PUT', '/api/news/8', {
        form: { fields: { title: 'T' }, files: { images: [imgFile()] } },
      });
      expect(callsMatching(/UPDATE news SET category_id/)[0][0]).not.toContain('img_path=?');
    });
  });

  // ── DELETE ───────────────────────────────────────────
  describe('DELETE routes', () => {
    test('DELETE /api/news/:id logs the title of an existing news item', async () => {
      mockDb();
      const r = await sendRequest('DELETE', '/api/news/4');
      expect(r.statusCode).toBe(200);
      expect(r.json).toEqual({ message: 'News deleted' });
      expect(callsMatching(/INSERT INTO activity_logs/)[0][1]).toEqual(['4', 'ลบข่าว: Old title']);
    });

    test('DELETE /api/news/:id falls back to the id when the news no longer exists', async () => {
      mockDb({ news: null });
      await sendRequest('DELETE', '/api/news/4');
      expect(callsMatching(/INSERT INTO activity_logs/)[0][1]).toEqual(['4', 'ลบข่าว: 4']);
    });

    test('DELETE gallery image decodes the base64 path and re-syncs the cover image', async () => {
      mockDb();
      const enc = encodeURIComponent(Buffer.from('uploads/a.jpg').toString('base64'));
      const r = await sendRequest('DELETE', `/api/news/4/images/${enc}`);

      expect(r.statusCode).toBe(200);
      expect(r.json).toEqual({ message: 'Image removed' });
      expect(callsMatching(/DELETE FROM news_images/)[0][1]).toEqual(['4', 'uploads/a.jpg']);
      expect(callsMatching(/UPDATE news SET img_path/)[0][1]).toEqual(['uploads/first.jpg', '4']);
    });

    test('DELETE gallery image sets img_path to null when no image is left', async () => {
      mockDb({ firstImg: null });
      const enc = Buffer.from('uploads/a.jpg').toString('base64');
      await sendRequest('DELETE', `/api/news/4/images/${enc}`);
      expect(callsMatching(/UPDATE news SET img_path/)[0][1]).toEqual([null, '4']);
    });
  });

  // ── admin: login / profile / password / list ─────────
  describe('admin routes', () => {
    test('login returns 401 for an unknown user', async () => {
      mockDb({ admin: null });
      const r = await sendRequest('POST', '/api/admin/login', { body: { username: 'x', password: 'y' } });
      expect(r.statusCode).toBe(401);
    });

    test('login accepts the legacy demo password', async () => {
      mockDb();
      const r = await sendRequest('POST', '/api/admin/login', { body: { username: 'admin', password: 'admin1234' } });
      expect(r.statusCode).toBe(200);
      expect(r.json).toEqual({ id: 1, username: 'admin', display_name: 'Admin' });
    });

    test('login returns 500 "Invalid JSON" for a malformed body', async () => {
      const r = await sendRequest('POST', '/api/admin/login', { raw: '{bad json' });
      expect(r.statusCode).toBe(500);
      expect(r.json.error).toBe('Invalid JSON');
    });

    test('GET profile returns the admin', async () => {
      mockDb();
      const r = await sendRequest('GET', '/api/admin/profile');
      expect(r.statusCode).toBe(200);
      expect(r.json.username).toBe('admin');
    });

    test('GET profile returns 404 when the admin does not exist', async () => {
      mockDb({ admin: null });
      const r = await sendRequest('GET', '/api/admin/profile');
      expect(r.statusCode).toBe(404);
    });

    test('PUT profile updates the display name', async () => {
      mockDb();
      const r = await sendRequest('PUT', '/api/admin/profile', { body: { display_name: '  New Name ' } });
      expect(r.statusCode).toBe(200);
      expect(callsMatching(/UPDATE admins SET display_name/)[0][1]).toEqual(['New Name']);
    });

    test('PUT profile rejects an empty display name', async () => {
      const r = await sendRequest('PUT', '/api/admin/profile', { body: { display_name: '  ' } });
      expect(r.statusCode).toBe(400);
      expect(query).not.toHaveBeenCalled();
    });

    test('PUT password rejects a missing new password', async () => {
      const r = await sendRequest('PUT', '/api/admin/password', { body: { current_password: 'x' } });
      expect(r.statusCode).toBe(400);
    });

    test('PUT password returns 404 when the admin does not exist', async () => {
      mockDb({ admin: null });
      const r = await sendRequest('PUT', '/api/admin/password', {
        body: { current_password: 'x', new_password: 'long-enough' },
      });
      expect(r.statusCode).toBe(404);
    });

    test('PUT password returns 401 when the current password is wrong', async () => {
      mockDb();
      const r = await sendRequest('PUT', '/api/admin/password', {
        body: { current_password: 'nope', new_password: 'long-enough' },
      });
      expect(r.statusCode).toBe(401);
    });

    test('PUT password accepts the legacy demo password as the current one', async () => {
      mockDb();
      const r = await sendRequest('PUT', '/api/admin/password', {
        body: { current_password: 'admin1234', new_password: 'long-enough' },
      });
      expect(r.statusCode).toBe(200);
      expect(callsMatching(/UPDATE admins SET password/)[0][1]).toEqual([sha256('long-enough')]);
    });

    test('GET admin list returns the accounts', async () => {
      mockDb();
      const r = await sendRequest('GET', '/api/admin/list');
      expect(r.statusCode).toBe(200);
      expect(r.json).toEqual([{ id: 1, username: 'admin' }]);
    });

    test('POST admin list requires username and password', async () => {
      const r = await sendRequest('POST', '/api/admin/list', { body: { username: 'bob' } });
      expect(r.statusCode).toBe(400);
    });

    test('POST admin list returns 409 for a duplicate username', async () => {
      mockDb({ existing: true });
      const r = await sendRequest('POST', '/api/admin/list', { body: { username: 'bob', password: 'pw12345678' } });
      expect(r.statusCode).toBe(409);
    });

    test('POST admin list creates an admin and defaults display_name to username', async () => {
      mockDb();
      const r = await sendRequest('POST', '/api/admin/list', { body: { username: 'bob', password: 'pw12345678' } });
      expect(r.statusCode).toBe(201);
      expect(r.json).toEqual({ id: 11, message: 'Admin created' });
      expect(callsMatching(/INSERT INTO admins/)[0][1]).toEqual(['bob', sha256('pw12345678'), 'bob']);
    });

    test('POST admin list keeps an explicit display_name', async () => {
      mockDb();
      await sendRequest('POST', '/api/admin/list', {
        body: { username: 'bob', password: 'pw12345678', display_name: 'Bob B' },
      });
      expect(callsMatching(/INSERT INTO admins/)[0][1][2]).toBe('Bob B');
    });
  });

  // ── categories & dashboard ───────────────────────────
  test('GET /api/categories returns categories (query string ignored)', async () => {
    mockDb();
    const r = await sendRequest('GET', '/api/categories?x=1');
    expect(r.statusCode).toBe(200);
    expect(r.json).toEqual([{ id: 1, name: 'Campus' }]);
  });

  test('GET /api/dashboard aggregates stats, categories, logs and monthly data', async () => {
    query
      .mockResolvedValueOnce([[{ total: 2, published: 1, draft: 1, total_views: 10 }]])
      .mockResolvedValueOnce([[{ tag: 'Campus', count: 2, published: 1, draft: 1 }]])
      .mockResolvedValueOnce([[{ action: 'create', description: 'd', created_at: 'x', display_name: 'A' }]])
      .mockResolvedValueOnce([[{ month: 10, year: 2026, published: 1, draft: 1 }]]);

    const r = await sendRequest('GET', '/api/dashboard');

    expect(r.statusCode).toBe(200);
    expect(Object.keys(r.json)).toEqual(['stats', 'byCategory', 'recentLogs', 'monthly']);
    expect(r.json.stats.total).toBe(2);
  });

  // ── error handling: every route's catch block ────────
  describe('database failures return 500', () => {
    const enc = Buffer.from('uploads/a.jpg').toString('base64');
    const cases = [
      ['GET', '/api/news', {}],
      ['GET', '/api/news/1', {}],
      ['POST', '/api/news', { form: { fields: { title: 'T' } } }],
      ['PUT', '/api/news/1', { form: { fields: { title: 'T' } } }],
      ['DELETE', '/api/news/1', {}],
      ['DELETE', `/api/news/1/images/${enc}`, {}],
      ['POST', '/api/admin/login', { body: { username: 'a', password: 'b' } }],
      ['GET', '/api/admin/profile', {}],
      ['PUT', '/api/admin/profile', { body: { display_name: 'N' } }],
      ['PUT', '/api/admin/password', { body: { current_password: 'a', new_password: 'long-enough' } }],
      ['GET', '/api/admin/list', {}],
      ['POST', '/api/admin/list', { body: { username: 'a', password: 'b' } }],
      ['GET', '/api/categories', {}],
      ['GET', '/api/dashboard', {}],
    ];

    test.each(cases)('%s %s', async (method, url, opts) => {
      query.mockRejectedValue(new Error('db down'));
      const r = await sendRequest(method, url, opts);
      expect(r.statusCode).toBe(500);
      expect(r.json.error).toBe('db down');
    });
  });

  // ── static files ─────────────────────────────────────
  describe('static file serving', () => {
    let readFile;

    beforeEach(() => {
      jest.spyOn(console, 'error').mockImplementation(() => {});
      readFile = jest.spyOn(fs, 'readFile').mockImplementation((p, cb) => cb(null, Buffer.from('file-content')));
    });

    test('serves index.html for "/"', async () => {
      const r = await sendRequest('GET', '/');
      expect(r.statusCode).toBe(200);
      expect(r.headers['Content-Type']).toBe('text/html');
      expect(readFile.mock.calls[0][0]).toMatch(/index\.html$/);
    });

    test('serves a css file with the right content type', async () => {
      const r = await sendRequest('GET', '/css/style.css');
      expect(r.headers['Content-Type']).toBe('text/css');
    });

    test('falls back to octet-stream for unknown extensions', async () => {
      const r = await sendRequest('GET', '/file.xyz');
      expect(r.headers['Content-Type']).toBe('application/octet-stream');
    });

    test('returns 404 when the static file does not exist', async () => {
      readFile.mockImplementation((p, cb) => cb(new Error('ENOENT')));
      const r = await sendRequest('GET', '/missing.html');
      expect(r.statusCode).toBe(404);
      expect(r.body).toBe('404 Not Found');
    });

    test('blocks path traversal outside the frontend folder', async () => {
      const r = await sendRequest('GET', '/../secret.txt');
      expect(r.statusCode).toBe(403);
      expect(readFile).not.toHaveBeenCalled();
    });

    test('serves an uploaded image inline', async () => {
      const r = await sendRequest('GET', '/uploads/photo.jpg');
      expect(r.statusCode).toBe(200);
      expect(r.headers).toEqual({ 'Content-Type': 'image/jpeg', 'Content-Disposition': 'inline' });
    });

    test('serves an uploaded pdf as an attachment with an encoded Thai filename', async () => {
      const r = await sendRequest('GET', '/uploads/%E0%B9%80%E0%B8%AD%E0%B8%81.pdf');
      expect(r.headers['Content-Type']).toBe('application/pdf');
      expect(r.headers['Content-Disposition']).toMatch(/^attachment; filename\*=UTF-8''/);
    });

    test('handles an invalid URL-encoded upload name without crashing', async () => {
      const r = await sendRequest('GET', '/uploads/%E0%A4%A');
      expect(r.statusCode).toBe(200);
      expect(r.headers['Content-Type']).toBe('application/octet-stream');
    });

    test('returns 404 when an uploaded file is missing', async () => {
      readFile.mockImplementation((p, cb) => cb(new Error('ENOENT')));
      const r = await sendRequest('GET', '/uploads/gone.jpg');
      expect(r.statusCode).toBe(404);
      expect(r.body).toBe('File not found');
    });
  });
});
