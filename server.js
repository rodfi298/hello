// Саундборд: телефон жмёт кнопки — Мак говорит/играет звук.
// Запуск на Маке: node server.js   (без зависимостей)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const PIN = process.env.PIN || ''; // если задан — телефон должен его ввести
const SOUNDS_DIR = path.join(__dirname, 'sounds');
const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aiff', '.aif', '.aac', '.caf']);
const IS_MAC = process.platform === 'darwin';

// Готовые фразы. Меняй/добавляй сколько хочешь.
const PRESETS = [
  { label: 'Оууу гадэм бро', text: 'Оууу, гадэм, бро!', voice: 'Milena' },
  { label: 'Oh god damn bro', text: 'Ohhh god damn, bro!', voice: 'Daniel' },
  { label: 'Ну ты красавчик', text: 'Ну ты красавчик!', voice: 'Milena' },
  { label: 'Это база', text: 'Это база.', voice: 'Milena' },
  { label: 'Bruh', text: 'Bruuuh.', voice: 'Fred' },
  { label: 'Let\'s go!', text: 'Let\'s gooooo!', voice: 'Samantha' },
  { label: 'Шок контент', text: 'Шок контент!', voice: 'Milena' },
  { label: 'Ахахах', text: 'Ахахахахаха!', voice: 'Milena' },
];

const running = new Set();

function run(cmd, args) {
  if (!IS_MAC) {
    console.log('[не Мак, пропускаю]', cmd, args.join(' '));
    return;
  }
  const child = execFile(cmd, args, (err) => {
    if (err && !err.killed) console.error(cmd, err.message);
  });
  running.add(child);
  child.on('exit', () => running.delete(child));
}

function stopAll() {
  for (const child of running) child.kill();
  running.clear();
}

function listSounds() {
  try {
    return fs.readdirSync(SOUNDS_DIR)
      .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
      .sort();
  } catch {
    return [];
  }
}

function listVoices(cb) {
  if (!IS_MAC) return cb(['Milena', 'Daniel', 'Samantha', 'Fred']);
  execFile('say', ['-v', '?'], (err, out) => {
    if (err) return cb([]);
    // строка вида: "Milena              ru_RU    # Здравствуйте..."
    const voices = out.split('\n')
      .map((l) => l.split('#')[0].trim().replace(/\s+[a-z]{2}[_-][A-Z0-9]+$/, '').trim())
      .filter(Boolean);
    cb([...new Set(voices)]);
  });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readJson(req, cb) {
  let data = '';
  req.on('data', (c) => {
    data += c;
    if (data.length > 10_000) req.destroy();
  });
  req.on('end', () => {
    try { cb(JSON.parse(data || '{}')); } catch { cb({}); }
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname === '/') {
    return send(res, 200, fs.readFileSync(path.join(__dirname, 'index.html')), 'text/html; charset=utf-8');
  }

  if (PIN && req.headers['x-pin'] !== PIN) return send(res, 401, { error: 'pin' });

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return listVoices((voices) => send(res, 200, { presets: PRESETS, sounds: listSounds(), voices }));
  }

  if (req.method === 'POST' && url.pathname === '/api/say') {
    return readJson(req, ({ text, voice, rate }) => {
      text = String(text || '').trim().slice(0, 500);
      if (!text) return send(res, 400, { error: 'empty' });
      const args = [];
      if (voice) args.push('-v', String(voice));
      if (rate) args.push('-r', String(Math.min(Math.max(Number(rate) || 180, 80), 400)));
      args.push('--', text);
      console.log('🗣 ', voice || '(default)', '—', text);
      run('say', args);
      send(res, 200, { ok: true });
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/play') {
    return readJson(req, ({ name }) => {
      // только файлы из папки sounds, никаких путей
      if (!listSounds().includes(name)) return send(res, 404, { error: 'not found' });
      console.log('🔊', name);
      run('afplay', [path.join(SOUNDS_DIR, name)]);
      send(res, 200, { ok: true });
    });
  }

  if (req.method === 'POST' && url.pathname === '/api/stop') {
    stopAll();
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  console.log('\n🎛  Саундборд запущен. Открой на телефоне (тот же Wi-Fi):');
  for (const ip of ips) console.log(`   http://${ip}:${PORT}`);
  if (PIN) console.log(`   PIN: ${PIN}`);
  console.log('');
});
