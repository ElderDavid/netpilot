import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';
import { getLocalNetworks, pickPrimaryNetwork, getArpTable, isPrivateIp, systemInfo } from './net.mjs';
import { loadOui, vendorFor, ouiSource } from './oui.mjs';
import { getWifi } from './wifi.mjs';
import { scanNetwork } from './discovery.mjs';
import { inspectRouter } from './router.mjs';
import { latencySuite, dnsSuite, speedTest } from './speed.mjs';
import { Store } from './store.mjs';
import { connectAccess, disconnectAccess, accessStatus, refreshAccess, setBlock } from './adapters.mjs';

// En Windows con IPv6 parcial, fetch puede fallar al resolver primero AAAA.
dns.setDefaultResultOrder('ipv4first');

const HERE = path.dirname(fileURLToPath(import.meta.url));const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

const store = new Store();
const sse = new Set();
const jobs = new Map();
let network = null;
let scanning = false;
let scanTimer = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function json(res, code, body) {
  const data = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sse) { try { res.write(payload); } catch {} }
}

function makeJob(type, label) {
  const id = crypto.randomUUID();
  const job = { id, type, label, status: 'running', progress: 0, message: 'Iniciando', startedAt: new Date().toISOString(), result: null, error: null };
  jobs.set(id, job);
  broadcast('job.started', { id, type, label });
  return job;
}

function finishJob(job, result) {
  job.status = 'done';
  job.progress = 1;
  job.finishedAt = new Date().toISOString();
  job.result = result;
  broadcast('job.done', { id: job.id, type: job.type });
  setTimeout(() => jobs.delete(job.id), 30 * 60 * 1000).unref?.();
}

function failJob(job, err) {
  job.status = 'error';
  job.error = String(err?.message ?? err);
  job.finishedAt = new Date().toISOString();
  broadcast('job.error', { id: job.id, type: job.type, error: job.error });
  setTimeout(() => jobs.delete(job.id), 30 * 60 * 1000).unref?.();
}

function jobView(job) {
  return { id: job.id, type: job.type, label: job.label, status: job.status, progress: job.progress, message: job.message, error: job.error, result: job.result, startedAt: job.startedAt };
}

async function initNetwork() {
  const nets = await getLocalNetworks();
  const primary = pickPrimaryNetwork(nets);
  if (!primary) throw new Error('No se encontró una interfaz de red activa');
  const arp = await getArpTable();
  const gwMac = primary.gateway ? arp[primary.gateway] || null : null;
  network = {
    iface: primary.alias,
    ip: primary.ip,
    prefix: primary.prefix,
    subnet: `${primary.ip}/${primary.prefix}`,
    gateway: primary.gateway,
    gatewayMac: gwMac,
    gatewayMacMasked: gwMac ? `${gwMac.split(':').slice(0, 3).join(':')}:··:··:··` : null,
    gatewayVendor: gwMac ? vendorFor(gwMac) : null,
  };
  store.setNetwork(network);
  console.log(`[net] interfaz ${primary.alias} · ${primary.ip}/${primary.prefix} · gateway ${primary.gateway}`);
}

async function runScan({ reason = 'manual' } = {}) {
  if (scanning) return { already: true, job: [...jobs.values()].find((j) => j.type === 'scan' && j.status === 'running') };
  if (!network) await initNetwork();
  const job = makeJob('scan', 'Descubrimiento de red');
  scanning = true;
  try {
    const res = await scanNetwork({
      network,
      onProgress: (p) => {
        job.message = p.message;
        job.progress = p.total ? p.done / p.total : 0.5;
        broadcast('scan.progress', { ...p, jobId: job.id });
      },
    });
    const merged = store.mergeScan(res, {
      alertNew: reason !== 'inicio',
      notify: (ev, dev) => fetchRoute({ type: 'device.new', device: dev, event: ev }),
    });
    finishJob(job, { ...res.stats, total: merged.total, fresh: merged.fresh.length, reason });
    setTimeout(() => { runRouterInspect({ silent: true }); }, 500);
    setTimeout(() => { refreshWifi({ silent: true }); }, 800);
    return { job: jobView(job) };
  } catch (e) {
    failJob(job, e);
    throw e;
  } finally {
    scanning = false;
  }
}

function fetchRoute(payload) { broadcast(payload.type, payload); }

async function refreshWifi({ silent = false } = {}) {
  const wifi = await getWifi();
  store.setWifi(wifi);
  if (!silent) broadcast('wifi.updated', { at: wifi.at });
  return wifi;
}

async function runRouterInspect({ silent = false } = {}) {
  if (!network) return null;
  const router = await inspectRouter({
    gateway: network.gateway,
    gatewayMac: network.gatewayMac,
    gatewayVendor: network.gatewayVendor,
  });
  store.setRouter(router);
  if (!silent) broadcast('router.updated', { at: router.inspectedAt });
  return router;
}

function startJob(type, label, fn) {
  const job = makeJob(type, label);
  fn(job)
    .then((result) => finishJob(job, result))
    .catch((e) => failJob(job, e));
  return jobView(job);
}

const server = http.createServer(async (req, res) => {
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  if (!ip || !(ip === '::1' || ip === '127.0.0.1' || isPrivateIp(ip))) {
    return json(res, 403, { error: 'Solo se permite acceso desde la red local' });
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const o = new URL(origin);
        if (o.host !== req.headers.host) return json(res, 403, { error: 'Origen no permitido' });
      } catch { return json(res, 403, { error: 'Origen inválido' }); }
    }
  }

  try {
    if (p === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      res.write('event: hello\ndata: {"ok":true}\n\n');
      sse.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
      req.on('close', () => { clearInterval(ping); sse.delete(res); });
      return;
    }

    if (p === '/api/bootstrap') {
      return json(res, 200, {
        version: '0.1.0',
        system: systemInfo(),
        network,
        oui: { source: ouiSource(), note: 'Base OUI local' },
        access: accessStatus(),
        state: {
          devices: store.devices(),
          alerts: store.state.alerts,
          events: store.state.events.slice(0, 60),
          tests: store.state.tests,
          wifi: store.state.wifi,
          router: store.state.router,
          scans: store.state.scans.slice(0, 10),
        },
        runningJobs: [...jobs.values()].filter((j) => j.status === 'running').map(jobView),
      });
    }

    if (p === '/api/scan' && req.method === 'POST') {
      if (scanning) {
        const j = [...jobs.values()].find((x) => x.type === 'scan' && x.status === 'running');
        return json(res, 202, { job: j ? jobView(j) : null, already: true });
      }
      runScan({ reason: 'manual' }).catch((e) => console.error('[scan]', e.message));
      await new Promise((r) => setTimeout(r, 50));
      const j = [...jobs.values()].find((x) => x.type === 'scan');
      return json(res, 202, { job: j ? jobView(j) : null });
    }

    if (p.startsWith('/api/jobs/')) {
      const id = p.split('/')[3];
      const j = jobs.get(id);
      if (!j) return json(res, 404, { error: 'Trabajo no encontrado o expirado' });
      return json(res, 200, jobView(j));
    }

    if (p === '/api/wifi') {
      const force = url.searchParams.get('refresh') === '1';
      const cached = store.state.wifi;
      if (!force && cached && Date.now() - new Date(cached.at).getTime() < 30000) return json(res, 200, cached);
      const wifi = await refreshWifi();
      return json(res, 200, wifi);
    }

    if (p === '/api/router') {
      if (url.searchParams.get('refresh') === '1' || !store.state.router) {
        const r = await runRouterInspect();
        return json(res, 200, r);
      }
      return json(res, 200, store.state.router);
    }

    if (p === '/api/router/connect' && req.method === 'POST') {
      const body = await readJson(req);
      try {
        const access = await connectAccess(body || {});
        store.addEvent('router.access', `Acceso administrativo conectado: ${access.label}`);
        broadcast('router.access', { connected: true, family: access.family });
        return json(res, 200, access);
      } catch (e) {
        return json(res, 502, { error: e.message });
      }
    }

    if (p === '/api/router/disconnect' && req.method === 'POST') {
      const access = disconnectAccess();
      store.addEvent('router.access', 'Acceso administrativo cerrado');
      broadcast('router.access', { connected: false });
      return json(res, 200, access);
    }

    if (p === '/api/router/access/refresh' && req.method === 'POST') {
      const access = await refreshAccess();
      return json(res, 200, access);
    }

    if (p === '/api/router/block' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body || !body.mac) return json(res, 400, { error: 'Falta el dispositivo' });
      try {
        const access = await setBlock({ mac: body.mac, ip: body.ip }, Boolean(body.blocked));
        store.addEvent('router.block', `${body.blocked ? 'Bloqueado' : 'Desbloqueado'} ${body.ip || body.mac}`, { device: body.mac });
        broadcast('router.access', { connected: true });
        return json(res, 200, access);
      } catch (e) {
        return json(res, 502, { error: e.message });
      }
    }

    if (p === '/api/tests/latency' && req.method === 'POST') {
      if (scanning) return json(res, 409, { error: 'Hay un escaneo en curso. Espera a que termine para medir.' });
      const job = startJob('latency', 'Latencia y pérdida', async (j) => {
        j.message = 'Midiendo gateway e Internet';
        const r = await latencySuite({ gateway: network.gateway });
        store.addTest('latency', r);
        return r;
      });
      return json(res, 202, job);
    }

    if (p === '/api/tests/dns' && req.method === 'POST') {
      const job = startJob('dns', 'Prueba de DNS', async (j) => {
        j.message = 'Consultando resolvedores';
        const r = await dnsSuite();
        store.addTest('dns', r);
        return r;
      });
      return json(res, 202, job);
    }

    if (p === '/api/tests/speed' && req.method === 'POST') {
      const job = startJob('speed', 'Prueba de velocidad', async (j) => {
        j.message = 'Midiendo latencia base';
        const r = await speedTest({ gateway: network.gateway });
        store.addTest('speed', r);
        return r;
      });
      return json(res, 202, job);
    }

    if (p === '/api/history') {
      return json(res, 200, {
        scans: store.state.scans,
        latency: store.state.tests.latency,
        dns: store.state.tests.dns,
        speed: store.state.tests.speed,
        events: store.state.events,
        alerts: store.state.alerts,
      });
    }

    const ack = /^\/api\/alerts\/([^/]+)\/ack$/.exec(p);
    if (ack && req.method === 'POST') {
      const a = store.ackAlert(ack[1]);
      return a ? json(res, 200, a) : json(res, 404, { error: 'Alerta no encontrada' });
    }

    const dev = /^\/api\/devices\/([^/]+)$/.exec(p);
    if (dev) {
      const d = store.state.devices[dev[1]];
      if (!d) return json(res, 404, { error: 'Dispositivo no encontrado' });
      if (req.method === 'PATCH') {
        const body = await readJson(req);
        const out = store.setDeviceOverride(dev[1], body || {});
        broadcast('device.updated', { deviceId: dev[1] });
        return json(res, 200, out);
      }
      return json(res, 200, d);
    }

    if (p.startsWith('/api/')) return json(res, 404, { error: 'Ruta no encontrada' });

    // estáticos
    const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'Ruta inválida' });
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
      return fs.createReadStream(file).pipe(res);
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(PUBLIC, 'index.html')).pipe(res);
  } catch (e) {
    console.error('[api]', p, e);
    if (!res.headersSent) json(res, 500, { error: String(e?.message ?? e) });
    else res.end();
  }
});

function readJson(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 65536) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve(null); } });
  });
}

server.listen(PORT, HOST, async () => {
  const nets = await getLocalNetworks().catch(() => []);
  const primary = pickPrimaryNetwork(nets);
  console.log('');
  console.log('  NetPilot 0.1 — agente local');
  console.log(`  Local:  http://localhost:${PORT}`);
  if (primary) console.log(`  Red:    http://${primary.ip}:${PORT}`);
  console.log('  Solo lectura. Sin credenciales. Ctrl+C para detener.');
  console.log('');

  try {
    await initNetwork();
  } catch (e) {
    console.error('[init]', e.message);
  }
  const oui = await loadOui(DATA).catch(() => ({ count: 0, source: 'none' }));
  console.log(`[oui] ${oui.count} prefijos (${oui.source})`);

  try { await refreshWifi({ silent: true }); } catch (e) { console.error('[wifi]', e.message); }
  runScan({ reason: 'inicio' }).catch((e) => console.error('[scan]', e.message));
  clearInterval(scanTimer);
  scanTimer = setInterval(() => runScan({ reason: 'programado' }).catch(() => {}), 5 * 60 * 1000);
});

process.on('SIGINT', () => {
  console.log('\n[netpilot] cerrando…');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
});
