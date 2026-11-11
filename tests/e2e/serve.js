// Serves dist/ under /splitit-claude with SPA fallback, like GitHub Pages + 404.html.
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], base = '/splitit-claude';
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith(base)) { res.writeHead(302, { Location: base + '/' }); return res.end(); }
  p = p.slice(base.length) || '/';
  let f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html');
  const ext = path.extname(f);
  const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(8099, () => console.log('serving on 8099'));
