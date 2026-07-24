#!/usr/bin/env node
/*
 * Zero-dependency live-reload dev server for the Navanta Lens prototypes.
 *
 *   node design/dev-server.js            # serves ./design on http://localhost:4173
 *   PORT=8080 node design/dev-server.js  # custom port
 *
 * Edit any .html/.css/.js in design/ and the open browser tab reloads itself.
 * The reload snippet is injected only in the HTTP response — the files on
 * disk stay clean and still open standalone via file://.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT, 10) || 4173;
const DEFAULT_FILE = 'vendor_qualification_prototype.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

// ── SSE clients for live reload ──
const clients = new Set();
function broadcastReload() {
  for (const res of clients) {
    try { res.write('data: reload\n\n'); } catch (_) {}
  }
}

// Injected into every served HTML page.
const RELOAD_SNIPPET = `
<script>
(function(){
  try {
    var es = new EventSource('/__livereload');
    es.onmessage = function(e){ if (e.data === 'reload') location.reload(); };
    es.onerror = function(){ /* server restarting; EventSource auto-retries */ };
  } catch (err) {}
})();
</script>`;

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  // Live-reload event stream
  if (url === '/__livereload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  let rel = url === '/' ? DEFAULT_FILE : url.replace(/^\/+/, '');
  const filePath = path.join(ROOT, rel);

  // Prevent path traversal outside ROOT
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'Forbidden');

  fs.readFile(filePath, (err, data) => {
    if (err) {
      const list = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'))
        .map(f => `<li><a href="/${f}">${f}</a></li>`).join('');
      return send(res, 404,
        `<h1>404 — ${rel}</h1><p>Available prototypes:</p><ul>${list}</ul>`,
        'text/html; charset=utf-8');
    }
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.html') {
      let html = data.toString('utf8');
      html = html.includes('</body>')
        ? html.replace('</body>', RELOAD_SNIPPET + '\n</body>')
        : html + RELOAD_SNIPPET;
      return send(res, 200, html, MIME['.html']);
    }
    return send(res, 200, data, MIME[ext] || 'application/octet-stream');
  });
});

// ── Watch design/ and push reloads (debounced) ──
let timer = null;
fs.watch(ROOT, { recursive: false }, (evt, name) => {
  if (!name || !/\.(html|css|js)$/.test(name) || name === 'dev-server.js') return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    process.stdout.write(`  ↻ ${name} changed — reloading\n`);
    broadcastReload();
  }, 80);
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(
    `\n  Navanta Lens dev server — live reload on\n` +
    `  → http://localhost:${PORT}/${DEFAULT_FILE}\n` +
    `  serving: ${ROOT}\n` +
    `  edit any .html/.css/.js in design/ and the tab refreshes.\n` +
    `  Ctrl+C to stop.\n\n`);
});
