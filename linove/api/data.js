// Общее хранилище контент-плана: каждое сохранение — новый неизменяемый JSON в Vercel Blob,
// читаем самый свежий. Так нет проблем с CDN-кэшем при перезаписи.
import { put, list, del } from '@vercel/blob';

const PREFIX = 'linove/state-';
const KEEP = 30;

async function snapshots() {
  const { blobs } = await list({ prefix: PREFIX, limit: 1000 });
  return blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

async function load() {
  const [latest] = await snapshots();
  if (!latest) return null;
  const r = await fetch(latest.url, { cache: 'no-store' });
  return r.ok ? r.json() : null;
}

async function save(state) {
  state.updatedAt = Date.now();
  await put(`${PREFIX}${String(state.updatedAt).padStart(15, '0')}.json`, JSON.stringify(state), {
    access: 'public',
    addRandomSuffix: true,
    contentType: 'application/json',
  });
  const old = (await snapshots()).slice(KEEP).map((b) => b.url);
  if (old.length) await del(old).catch(() => {});
  return state;
}

function apply(state, op) {
  const items = state.items;
  if (op.type === 'replace') state.items = op.items;
  else if (op.type === 'upsert') {
    const i = items.findIndex((x) => x.id === op.item.id);
    if (i === -1) items.push(op.item);
    else items[i] = { ...items[i], ...op.item };
  } else if (op.type === 'delete') state.items = items.filter((x) => x.id !== op.id);
  else throw new Error('unknown op');
  return state;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: 'no storage' });
  try {
    if (req.method === 'GET') return res.json((await load()) || { items: null, updatedAt: 0 });
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const state = (await load()) || { items: [] };
      const ops = Array.isArray(body.ops) ? body.ops : [body];
      for (const op of ops) apply(state, op);
      return res.json(await save(state));
    }
    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
}
