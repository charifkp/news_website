const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const apiSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'api.js'),
  'utf8',
);

function createApi(responseData = { success: true }) {
  const calls = [];
  const context = {
    fetch: async (...args) => {
      calls.push(args);
      return { json: async () => responseData };
    },
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    unescape,
  };

  vm.createContext(context);
  vm.runInContext(apiSource, context);

  return { api: vm.runInContext('API', context), calls };
}

test('getNews fetches the news collection', async () => {
  const { api, calls } = createApi([{ id: 1 }]);

  assert.deepEqual(await api.getNews(), [{ id: 1 }]);
  assert.deepEqual(calls, [['/api/news']]);
});

test('getNewsById fetches a news item by id', async () => {
  const { api, calls } = createApi({ id: 12 });

  assert.deepEqual(await api.getNewsById(12), { id: 12 });
  assert.deepEqual(calls, [['/api/news/12']]);
});

test('createNews sends FormData without setting a content type', async () => {
  const { api, calls } = createApi({ id: 8 });
  const formData = { title: 'Campus update' };

  assert.deepEqual(await api.createNews(formData), { id: 8 });
  assert.equal(calls[0][0], '/api/news');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].body, formData);
  assert.equal(calls[0][1].headers, undefined);
});

test('updateNews sends JSON to the news item endpoint', async () => {
  const { api, calls } = createApi({ message: 'News updated' });
  const data = { title: 'Updated headline' };

  assert.deepEqual(await api.updateNews(4, data), { message: 'News updated' });
  assert.equal(calls[0][0], '/api/news/4');
  assert.equal(calls[0][1].method, 'PUT');
  assert.equal(calls[0][1].headers['Content-Type'], 'application/json');
  assert.equal(calls[0][1].body, JSON.stringify(data));
});

test('deleteNews sends a DELETE request for the news item', async () => {
  const { api, calls } = createApi({ message: 'News deleted' });

  assert.deepEqual(await api.deleteNews(6), { message: 'News deleted' });
  assert.equal(calls[0][0], '/api/news/6');
  assert.equal(calls[0][1].method, 'DELETE');
});

test('deleteNewsImage encodes the image path before sending the request', async () => {
  const { api, calls } = createApi({ message: 'Image removed' });
  const imagePath = 'uploads/campus image.jpg';
  const encodedPath = encodeURIComponent(
    Buffer.from(imagePath, 'binary').toString('base64'),
  );

  assert.deepEqual(await api.deleteNewsImage(9, imagePath), { message: 'Image removed' });
  assert.equal(calls[0][0], `/api/news/9/images/${encodedPath}`);
  assert.equal(calls[0][1].method, 'DELETE');
});

test('getCategories fetches the category collection', async () => {
  const { api, calls } = createApi([{ id: 2, name: 'Campus' }]);

  assert.deepEqual(await api.getCategories(), [{ id: 2, name: 'Campus' }]);
  assert.deepEqual(calls, [['/api/categories']]);
});

test('getDashboard fetches dashboard data', async () => {
  const { api, calls } = createApi({ totalNews: 3 });

  assert.deepEqual(await api.getDashboard(), { totalNews: 3 });
  assert.deepEqual(calls, [['/api/dashboard']]);
});
