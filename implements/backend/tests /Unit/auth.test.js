const http = require('http');
const { Readable } = require('stream');
const mysql = require('../../src/node_modules/mysql2/promise');

jest.mock('../../src/node_modules/mysql2/promise', () => ({
  createPool: jest.fn(),
}));

describe('admin authentication routes', () => {
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

  async function sendRequest(method, url, body) {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    req.method = method;
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
      headers: res.headers,
      body: JSON.parse(res.body),
    };
  }

  function hashPassword(password) {
    return require('crypto').createHash('sha256').update(password).digest('hex');
  }

  test('rejects login when username or password is missing', async () => {
    const response = await sendRequest('POST', '/api/admin/login', {
      username: 'admin',
      password: '',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toHaveProperty('error');
    expect(query).not.toHaveBeenCalled();
  });

  test('returns the admin profile for valid credentials', async () => {
    query.mockResolvedValueOnce([[
      {
        id: 7,
        username: 'admin',
        password: hashPassword('correct-password'),
        display_name: 'News Admin',
      },
    ]]);

    const response = await sendRequest('POST', '/api/admin/login', {
      username: ' admin ',
      password: 'correct-password',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      id: 7,
      username: 'admin',
      display_name: 'News Admin',
    });
    expect(query).toHaveBeenCalledWith(
      'SELECT id, username, password, display_name FROM admins WHERE username = ? AND is_active = 1',
      ['admin'],
    );
  });

  test('rejects incorrect login credentials', async () => {
    query.mockResolvedValueOnce([[
      {
        id: 7,
        username: 'admin',
        password: hashPassword('correct-password'),
        display_name: 'News Admin',
      },
    ]]);

    const response = await sendRequest('POST', '/api/admin/login', {
      username: 'admin',
      password: 'wrong-password',
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toHaveProperty('error');
  });

  test('rejects a password change when the new password is shorter than eight characters', async () => {
    const response = await sendRequest('PUT', '/api/admin/password', {
      current_password: 'current-password',
      new_password: 'short',
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toHaveProperty('error');
    expect(query).not.toHaveBeenCalled();
  });

  test('updates the password hash after validating the current password', async () => {
    query
      .mockResolvedValueOnce([[{ password: hashPassword('current-password') }]])
      .mockResolvedValueOnce([{}]);

    const response = await sendRequest('PUT', '/api/admin/password', {
      current_password: 'current-password',
      new_password: 'new-password',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ message: 'Password changed' });
    expect(query).toHaveBeenNthCalledWith(
      2,
      'UPDATE admins SET password = ? WHERE id = 1',
      [hashPassword('new-password')],
    );
  });
});
