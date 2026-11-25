// shots.mjs — render 4 screenshot Dapur Kilat dengan headless Chrome.
// Menyalakan server statis untuk game/, membuka tiap view (?shot=...)
// di page baru, lalu menyimpan JPEG ke screenshots/.
// Jalankan dari root repo:  node shots.mjs
// Memakai playwright-core + chrome-headless-shell bersama di
// ~/workspace/makefun/shot — tanpa install, tanpa network.
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const requireShot = createRequire('/home/hatch/workspace/makefun/shot/node_modules/playwright-core/index.js');
const { chromium } = requireShot('playwright-core');

const HERE = fileURLToPath(new URL('.', import.meta.url));
const GAME_DIR = join(HERE, 'game');
const SHOTS_DIR = join(HERE, 'screenshots');
const CHROME = '/home/hatch/workspace/makefun/shot/chrome/chrome-headless-shell-linux64/chrome-headless-shell';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

// Cover dulu: layanan tersibuk — 3 pesanan, piring dirakit, wajan 65%,
// satu hidangan siap saji, kombo x3. Lalu awal permainan, momen saji,
// dan layar akhir shift.
const VIEWS = [
  { file: '1-cover.jpg', path: '/index.html?shot=cover', note: 'Mid-service rush: 3 orders, plate assembling, wok 65%, dish ready' },
  { file: '2-play.jpg', path: '/index.html?shot=play', note: 'Early play: 1 order, 2 ingredients on the plate' },
  { file: '3-serve.jpg', path: '/index.html?shot=serve', note: 'Cooked plate ready to serve, matching ticket highlighted' },
  { file: '4-end.jpg', path: '/index.html?shot=end', note: 'Shift over: final score and stats' },
];

function serveFile(res, filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

async function main() {
  mkdirSync(SHOTS_DIR, { recursive: true });
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    serveFile(res, join(GAME_DIR, decodeURIComponent(rel)));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;

  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  try {
    for (const view of VIEWS) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.on('pageerror', (err) => console.error('PAGE ERROR', view.file, String(err)));
      page.on('console', (msg) => {
        if (msg.type() === 'error') console.error('CONSOLE ERROR', view.file, msg.text());
      });
      await page.goto(base + view.path, { waitUntil: 'load' });
      await page.waitForTimeout(700);
      const state = await page.evaluate(() => ({
        screen: window.dapurKilat ? window.dapurKilat.state.screen : 'n/a',
        orders: window.dapurKilat ? window.dapurKilat.state.orders.length : -1,
        plate: window.dapurKilat ? window.dapurKilat.state.plate.length : -1,
      }));
      await page.screenshot({ path: join(SHOTS_DIR, view.file), type: 'jpeg', quality: 82 });
      console.log(view.file, '—', view.note, JSON.stringify(state));
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log('done');
}

main().catch((e) => { console.error(e); process.exit(1); });
