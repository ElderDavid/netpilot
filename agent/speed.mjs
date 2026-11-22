import { promises as dns } from 'node:dns';
import { pingHost, sleep } from './net.mjs';

function stats(values) {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return { min: null, max: null, avg: null, p50: null, p95: null, jitter: null };
  const avg = v.reduce((a, b) => a + b, 0) / v.length;
  const jitter = v.length > 1
    ? v.slice(1).reduce((a, x, i) => a + Math.abs(x - v[i]), 0) / (v.length - 1)
    : 0;
  return {
    min: Math.round(v[0] * 10) / 10,
    max: Math.round(v[v.length - 1] * 10) / 10,
    avg: Math.round(avg * 10) / 10,
    p50: Math.round(v[Math.floor(v.length * 0.5)] * 10) / 10,
    p95: Math.round(v[Math.min(v.length - 1, Math.floor(v.length * 0.95))] * 10) / 10,
    jitter: Math.round(jitter * 10) / 10,
  };
}

export async function pingBurst(target, count = 20, gapMs = 120) {
  const times = [];
  let lost = 0;
  for (let i = 0; i < count; i++) {
    const r = await pingHost(target, 1200);
    if (r.up) times.push(r.ms ?? 0); else lost++;
    if (gapMs) await sleep(gapMs);
  }
  return { sent: count, lost, lossPct: Math.round((lost / count) * 1000) / 10, ...stats(times) };
}

export async function latencySuite({ gateway }) {
  const started = new Date().toISOString();
  const [gw, internet] = await Promise.all([
    pingBurst(gateway, 20, 100),
    pingBurst('8.8.8.8', 20, 100),
  ]);
  return { at: started, gateway: { target: gateway, ...gw }, internet: { target: '8.8.8.8', ...internet } };
}

const DOMAINS = ['www.google.com', 'youtube.com', 'instagram.com', 'netflix.com', 'whatsapp.com'];

export async function dnsSuite() {
  const system = await measureResolver(null);
  const publicDns = await measureResolver(['8.8.8.8']);
  return { at: new Date().toISOString(), system, public: publicDns };
}

async function measureResolver(servers) {
  const resolver = new dns.Resolver({ timeout: 2500, tries: 2 });
  if (servers) resolver.setServers(servers);
  const times = [];
  let fails = 0;
  for (const d of DOMAINS) {
    const t0 = performance.now();
    try {
      await Promise.race([
        resolver.resolve4(d),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
      ]);
      times.push(performance.now() - t0);
    } catch { fails++; }
  }
  const s = stats(times);
  return {
    servers: servers || ['resolver del sistema'],
    p50: s.p50,
    avg: s.avg,
    max: s.max,
    fails,
    samples: times.length,
    label: servers ? servers.join(', ') : 'Sistema (router)',
  };
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NetPilot/0.1';
const HEADERS = { 'user-agent': UA, 'cache-control': 'no-store' };

const DOWN_URL = (i) => `https://speed.cloudflare.com/__down?bytes=8000000&r=${i}-${Date.now()}`;
const UP_URL = (i) => `https://speed.cloudflare.com/__up?r=${i}-${Date.now()}`;

async function downloadStream(url, timeoutMs, onBytes) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(1200);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: HEADERS });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      let bytes = 0;
      for await (const chunk of res.body) {
        bytes += chunk.length;
        if (onBytes) onBytes(chunk.length);
      }
      return bytes;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('descarga fallida');
}

export async function speedTest({ gateway, streams = 3, durationMs = 30000 }) {
  const startedAt = new Date().toISOString();
  const warnings = [];
  await sleep(1200);
  const base = await pingBurst(gateway, 10, 0);
  let bytes = 0;
  const t0 = performance.now();
  let stop = false;
  const load = [];
  const monitor = (async () => {
    while (!stop) {
      const r = await pingHost(gateway, 900);
      if (r.up) load.push(r.ms ?? 0);
      await sleep(250);
    }
  })();

  const results = await Promise.allSettled(Array.from({ length: streams }, (_, i) =>
    downloadStream(DOWN_URL(i), durationMs, (n) => { bytes += n; }).catch((e) => { warnings.push(`descarga ${i + 1}: ${e?.cause?.code || e?.message || 'error'}`); return 0; })
  ));
  const downSec = (performance.now() - t0) / 1000;
  stop = true;
  await monitor.catch(() => {});

  if (bytes <= 0) {
    throw new Error(`La prueba de descarga no recibió datos. ${warnings.join(' | ') || 'Sin detalle del servidor'}`);
  }

  const payload = Buffer.alloc(4 * 1024 * 1024, 0x61);
  let upBytes = 0;
  const u0 = performance.now();
  await Promise.all(Array.from({ length: 2 }, (_, i) =>
    fetch(UP_URL(i), {
      method: 'POST',
      body: payload,
      signal: AbortSignal.timeout(durationMs),
      headers: { ...HEADERS, 'content-type': 'application/octet-stream' },
    }).then(async (res) => {
      if (res.ok) upBytes += payload.length;
      else warnings.push(`subida ${i + 1}: HTTP ${res.status}`);
      await res.arrayBuffer().catch(() => {});
    }).catch((e) => { warnings.push(`subida ${i + 1}: ${e?.message || 'error'}`); })
  ));
  const upSec = (performance.now() - u0) / 1000;

  const downMbps = downSec > 0 ? (bytes * 8) / downSec / 1e6 : 0;
  const upMbps = upSec > 0 ? (upBytes * 8) / upSec / 1e6 : 0;
  const loaded = stats(load);
  const settled = results.filter((r) => r.status === 'fulfilled' && r.value > 0).length;

  if (upBytes === 0) warnings.push('No se pudo medir la subida');
  if (upMbps > downMbps * 2) warnings.push('La subida supera ampliamente la bajada: el servidor de prueba puede estar limitando la descarga. Repite la medición.');

  return {
    at: startedAt,
    server: 'speed.cloudflare.com',
    downloadMbps: Math.round(downMbps * 10) / 10,
    uploadMbps: Math.round(upMbps * 10) / 10,
    bytesDown: bytes,
    bytesUp: upBytes,
    idleLatency: base.min,
    loadedLatency: loaded.p50,
    loadedLatencyP95: loaded.p95,
    bufferbloatMs: loaded.p50 != null && base.min != null ? Math.max(0, Math.round((loaded.p50 - base.min) * 10) / 10) : null,
    jitterUnderLoad: loaded.jitter,
    lossUnderLoadPct: null,
    streams: settled,
    warnings: [...new Set(warnings)],
    notes: [
      'Medición desde el agente; incluye el enlace Wi-Fi del equipo',
      'Servidor público: puede variar con la ruta del ISP',
    ],
  };
}
