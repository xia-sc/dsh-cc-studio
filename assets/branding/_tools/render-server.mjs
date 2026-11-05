// 最小静态服务器，用于把 SVG 渲染成 PNG（playwright 禁止 file://）
// 用法: node render-server.mjs <rootDir> <port>
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const port = Number(process.argv[3] || 58330);
const types = {
  '.svg': 'image/svg+xml',
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css',
};
http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, urlPath === '/' ? 'compare.html' : urlPath);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}).listen(port, '127.0.0.1', () => console.log('render server on http://127.0.0.1:' + port));
