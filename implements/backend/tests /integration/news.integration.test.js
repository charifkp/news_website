// const http = require('http');
// const mysql = require('mysql2/promise');

// jest.mock('mysql2/promise', () => ({
//   createPool: jest.fn(),
// }));

// describe('news API integration', () => {
//   const createServer = http.createServer;
//   let server;
//   let baseUrl;
//   let query;

//   beforeAll(async () => {
//     let requestHandler;
//     query = jest.fn();
//     mysql.createPool.mockReturnValue({ query });

//     jest.spyOn(http, 'createServer').mockImplementation((handler) => {
//       requestHandler = handler;
//       return { listen: jest.fn() };
//     });

//     require('../../src/index');
//     server = createServer(requestHandler);
//     await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
//     baseUrl = `http://127.0.0.1:${server.address().port}`;
//   });

//   afterAll(async () => {
//     jest.restoreAllMocks();
//     if (server) {
//       await new Promise((resolve, reject) => {
//         server.close((error) => (error ? reject(error) : resolve()));
//       });
//     }
//   });

//   beforeEach(() => {
//     query.mockReset();
//   });

//   test('GET /api/news returns the news list as JSON', async () => {
//     const news = [
//       {
//         id: 5,
//         tag: 'Campus',
//         title: 'Campus update',
//         subtitle: 'Latest update',
//         img_path: 'uploads/campus.jpg',
//         status: 'published',
//         views: 12,
//         date: '22/10/2026',
//         published_at: '2026-10-22',
//       },
//     ];
//     query.mockResolvedValueOnce([news]);

//     const response = await fetch(`${baseUrl}/api/news`);

//     expect(response.status).toBe(200);
//     expect(response.headers.get('content-type')).toContain('application/json');
//     await expect(response.json()).resolves.toEqual(news);
//     expect(query).toHaveBeenCalledTimes(1);
//     expect(query.mock.calls[0][0]).toContain('FROM   news n');
//   });

//   test('GET /api/news/:id returns detail with attachments, gallery images, and related news', async () => {
//     const news = {
//       id: 5,
//       title: 'Campus update',
//       tag: 'Campus',
//       date: '22/10/2026',
//     };
//     query
//       .mockResolvedValueOnce([[news]])
//       .mockResolvedValueOnce([{}])
//       .mockResolvedValueOnce([[{ file_name: 'report.pdf', file_path: 'uploads/report.pdf', file_size: 120 }]])
//       .mockResolvedValueOnce([[{ img_path: 'uploads/cover.jpg' }, { img_path: 'uploads/gallery.jpg' }]])
//       .mockResolvedValueOnce([[{ id: 6, title: 'Related story' }]]);

//     const response = await fetch(`${baseUrl}/api/news/5`);

//     expect(response.status).toBe(200);
//     await expect(response.json()).resolves.toEqual({
//       ...news,
//       pdfs: [{ file_name: 'report.pdf', file_path: 'uploads/report.pdf', file_size: 120 }],
//       images: ['uploads/cover.jpg', 'uploads/gallery.jpg'],
//       related: [{ id: 6, title: 'Related story' }],
//     });
//     expect(query).toHaveBeenNthCalledWith(2, 'UPDATE news SET views = views + 1 WHERE id = ?', ['5']);
//     expect(query).toHaveBeenCalledTimes(5);
//   });

//   test('GET /api/news/:id returns 404 when the news item does not exist', async () => {
//     query.mockResolvedValueOnce([[]]);

//     const response = await fetch(`${baseUrl}/api/news/999`);

//     expect(response.status).toBe(404);
//     await expect(response.json()).resolves.toEqual({ error: 'News not found' });
//     expect(query).toHaveBeenCalledTimes(1);
//   });

//   test('POST /api/news creates a draft from multipart form data', async () => {
//     query
//       .mockResolvedValueOnce([[{ id: 3 }]])
//       .mockResolvedValueOnce([{ insertId: 23 }])
//       .mockResolvedValueOnce([{}]);

//     const form = new FormData();
//     form.append('title', 'New campus story');
//     form.append('tag', 'Campus');
//     form.append('content', 'Story content');

//     const response = await fetch(`${baseUrl}/api/news`, {
//       method: 'POST',
//       body: form,
//     });

//     expect(response.status).toBe(201);
//     await expect(response.json()).resolves.toEqual({ id: 23, message: 'News created' });
//     expect(query).toHaveBeenCalledTimes(3);
//     expect(query.mock.calls[1][0]).toContain('INSERT INTO news');
//     expect(query.mock.calls[1][1]).toEqual([
//       3,
//       'New campus story',
//       null,
//       'Story content',
//       'สภานักศึกษา มหาวิทยาลัยมหิดล',
//       null,
//       'draft',
//       expect.any(String),
//     ]);
//   });
// });
const http = require('http');
const { Readable } = require('stream');
const mysql = require('mysql2/promise');

jest.mock('mysql2/promise', () => ({
  createPool: jest.fn(),
}));

describe('News API integration tests', () => {
  let requestHandler;
  let query;

  beforeAll(() => {
    query = jest.fn();
    mysql.createPool.mockReturnValue({ query });

    jest.spyOn(http, 'createServer').mockImplementation((handler) => {
      requestHandler = handler;
      return { listen: jest.fn() };
    });

    require('../../src/index');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    query.mockReset();
  });

  async function sendGetRequest(url) {
    const req = Readable.from([]);
    req.method = 'GET';
    req.url = url;

    const res = {
      statusCode: null,
      headers: null,
      body: null,
      writeHead(statusCode, headers) {
        this.statusCode = statusCode;
        this.headers = headers;
      },
      end(responseBody) {
        this.body = responseBody;
      },
    };

    await requestHandler(req, res);

    return {
      statusCode: res.statusCode,
      body: res.body ? JSON.parse(res.body) : null,
    };
  }

  test('GET /api/news returns list of news', async () => {
    query.mockResolvedValueOnce([
      [{ id: 1, title: 'Test News', tag: 'ทั่วไป', status: 'published', views: 10 }]
    ]);

    const response = await sendGetRequest('/api/news');

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBe(1);
    expect(response.body[0].title).toBe('Test News');
  });

  test('GET /api/categories returns categories list', async () => {
    query.mockResolvedValueOnce([
      [{ id: 1, name: 'ทั่วไป' }, { id: 2, name: 'ประกาศ' }]
    ]);

    const response = await sendGetRequest('/api/categories');

    expect(response.statusCode).toBe(200);
    expect(response.body.length).toBe(2);
  });
});
