import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function idFor(key) {
  return crypto.createHash('sha1').update(String(key)).digest('hex').slice(0, 10);
}

const empty = () => ({
  version: 1,
  createdAt: new Date().toISOString(),
  network: null,
  devices: {},
  wifi: null,
  router: null,
  tests: { latency: [], dns: [], speed: [] },
  snapshots: [],
  alerts: [],
  events: [],
  scans: [],
});

export class Store {
  constructor() {
    this.state = empty();
    this._timer = null;
    this._dirty = false;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        this.state = { ...empty(), ...raw, tests: { ...empty().tests, ...(raw.tests || {}) } };
      }
    } catch { this.state = empty(); }
  }

  save() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      if (!this._dirty) return;
      this._dirty = false;
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
      } catch (e) { console.error('[store] no se pudo guardar:', e.message); }
    }, 600);
  }

  setNetwork(net) {
    this.state.network = net;
    this.save();
  }

  addEvent(type, message, extra = {}) {
    const ev = { id: idFor(`${type}:${Date.now()}:${Math.random()}`), at: new Date().toISOString(), type, message, ...extra };
    this.state.events.unshift(ev);
    this.state.events = this.state.events.slice(0, 400);
    this.save();
    return ev;
  }

  mergeScan({ devices, stats }, { notify, alertNew = true } = {}) {
    const now = new Date().toISOString();
    const seen = new Set();
    const fresh = [];

    for (const d of devices) {
      const key = d.mac || `ip:${d.ip}`;
      let existing = Object.values(this.state.devices).find((x) => x.key === key);
      if (!existing && d.mac) existing = Object.values(this.state.devices).find((x) => x.mac === d.mac);

      if (existing) {
        seen.add(existing.id);
        const ips = new Set([...(existing.ips || []), d.ip]);
        existing.ips = [...ips].slice(-4);
        existing.ip = d.ip;
        existing.lastSeen = now;
        existing.online = d.online;
        existing.rttMs = d.rttMs;
        existing.ttl = d.ttl ?? existing.ttl;
        existing.method = [...new Set([...(existing.method || []), ...(d.method || [])])];
        if (d.name && (!existing.name || d.name.length > (existing.name?.length ?? 0))) existing.name = d.name;
        if (d.vendor) existing.vendor = d.vendor;
        if (d.type && d.type !== 'unknown' && d.confidence !== 'low') {
          existing.type = d.type;
          existing.typeLabel = d.typeLabel;
          existing.confidence = d.confidence;
        }
        existing.reasons = [...new Set([...(existing.reasons || []), ...(d.reasons || [])])].slice(0, 6);
        if (d.ssdp?.friendlyName) existing.ssdp = d.ssdp;
        if (existing.manualName) existing.name = existing.manualName;
      } else {
        const dev = {
          id: idFor(key),
          key,
          mac: d.mac || null,
          macMasked: d.macMasked || null,
          ip: d.ip,
          ips: [d.ip],
          name: d.name || null,
          vendor: d.vendor || null,
          type: d.type || 'unknown',
          typeLabel: d.typeLabel || 'Desconocido',
          confidence: d.confidence || 'low',
          reasons: d.reasons || [],
          hostname: d.hostname || null,
          ttl: d.ttl ?? null,
          rttMs: d.rttMs ?? null,
          online: d.online,
          isGateway: Boolean(d.isGateway),
          ssdp: d.ssdp || null,
          method: d.method || [],
          firstSeen: now,
          lastSeen: now,
        };
        this.state.devices[dev.id] = dev;
        seen.add(dev.id);
        fresh.push(dev);
      }
    }

    for (const dev of Object.values(this.state.devices)) {
      if (!seen.has(dev.id)) dev.online = false;
    }

    for (const dev of fresh) {
      if (!alertNew) continue;
      const ev = this.addEvent('device.new', `Nuevo dispositivo: ${dev.name || dev.ip}`, { deviceId: dev.id });
      this.state.alerts.unshift({
        id: idFor(`alert:${ev.id}`),
        at: ev.at,
        type: 'device.new',
        severity: 'info',
        deviceId: dev.id,
        title: 'Nuevo dispositivo en la red',
        detail: `${dev.name || dev.ip} · ${dev.vendor || 'fabricante desconocido'} · ${dev.typeLabel}`,
        ack: false,
      });
      if (notify) notify(ev, dev);
    }
    this.state.alerts = this.state.alerts.slice(0, 100);

    this.state.scans.unshift({ at: now, ...stats });
    this.state.scans = this.state.scans.slice(0, 50);
    this.addEvent('scan.done', `Escaneo completado: ${stats.online} equipos en línea`, { stats });
    this.save();
    return { fresh, total: Object.keys(this.state.devices).length };
  }

  addTest(kind, result) {
    if (kind === 'speed' && !(Number(result?.downloadMbps) > 0)) return;
    const bucket = this.state.tests[kind];
    if (!bucket) return;
    bucket.unshift({ id: idFor(`${kind}:${Date.now()}`), at: new Date().toISOString(), ...result });
    this.state.tests[kind] = bucket.slice(0, 30);
    this.save();
  }

  setWifi(wifi) {
    this.state.wifi = wifi;
    this.save();
  }

  addSnapshot({ label, note, metrics }) {
    const snap = {
      id: idFor(`snap:${Date.now()}:${Math.random()}`),
      at: new Date().toISOString(),
      label: label || `Estado ${new Date().toLocaleString('es-CO')}`,
      note: note || null,
      metrics,
    };
    this.state.snapshots.unshift(snap);
    this.state.snapshots = this.state.snapshots.slice(0, 50);
    this.save();
    return snap;
  }

  removeSnapshot(id) {
    const before = this.state.snapshots.length;
    this.state.snapshots = this.state.snapshots.filter((s) => s.id !== id);
    if (this.state.snapshots.length !== before) this.save();
    return { removed: before - this.state.snapshots.length };
  }

  setRouter(router) {
    this.state.router = router;
    this.save();
  }

  ackAlert(id) {
    const a = this.state.alerts.find((x) => x.id === id);
    if (a) { a.ack = true; this.save(); }
    return a || null;
  }

  setDeviceOverride(id, patch) {
    const d = this.state.devices[id];
    if (!d) return null;
    if (patch.name !== undefined) { d.manualName = patch.name || null; d.name = patch.name || d.hostname || d.name; }
    if (patch.type !== undefined) { d.type = patch.type; d.confidence = 'high'; d.reasons = [...new Set([...(d.reasons || []), 'Corregido manualmente'])]; }
    this.save();
    return d;
  }

  devices() {
    return Object.values(this.state.devices).sort((a, b) => {
      if (a.isGateway) return -1;
      if (b.isGateway) return 1;
      if (a.online !== b.online) return a.online ? -1 : 1;
      return a.ip.localeCompare(b.ip, undefined, { numeric: true });
    });
  }
}

export { DATA_DIR };
