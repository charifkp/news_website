const http = require('http');
const fs = require('fs');
const path = require('path');


const FRONTEND_SRC = path.join(__dirname, '..', '..', 'frontend', 'src');
const LOCAL_PAGES = ['/index.html','/upload.html','/dashboard.html','/news-admin.html'];


const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.webp': 'image/webp', // Now this will actually be used!
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.pdf':  'application/pdf',
};

const routeMap = {
  '/':             '/index.html',
  '/upload':       '/upload.html',
  '/dashboard':    '/dashboard.html',
  '/admin-login':  '/admin-login.html',
};





const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  // 1. DYNAMIC PATH: If request is "/" use "/index.html", otherwise use what the browser asked for (like "/image/gradualfact.webp")
  // const reqUrl = urlPath === '/' ? '/index.html' : urlPath;
  const reqUrl = routeMap[urlPath] || urlPath;

  
  // 2. Combine it dynamically so it finds the correct file
  // const filepath = path.join(__dirname, '..', '..', 'frontend', 'src', reqUrl);
  let filepath = path.join(FRONTEND_SRC, reqUrl);
  



  const extname = String(path.extname(filepath)).toLowerCase();

  // const mimeTypes = {
  //   '.html': 'text/html',
  //   '.css': 'text/css',
  //   '.js': 'text/javascript',
  //   '.webp': 'image/webp', // Now this will actually be used!
  //   '.jpg': 'image/jpeg',
  //   '.png': 'image/png'
  // };

  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filepath, (err, data) => {
    if (err) {
      // console.error(`404: ${filepath}`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

server.listen(3002, '0.0.0.0', () => {
  console.log('Serving frontend from:', FRONTEND_SRC); 
  console.log('Server running at http://0.0.0.0:3002');
  console.log('Backend is running');
  console.log('Path exists:', fs.existsSync(FRONTEND_SRC));
  console.log('/                 --> index.html (mainpage)');
  console.log('/upload           --> upload.html (upload)');
  console.log('/admin-login.html --> admin-login.html (admin-login)');
  console.log('/dashboard        --> dashboard.html (dashboard)');
});
