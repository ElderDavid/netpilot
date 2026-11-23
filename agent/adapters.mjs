import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

/**
 * Adaptadores de administración (solo lectura por defecto).
 * Las credenciales viven únicamente en memoria: nunca se persisten ni se devuelven.
 */

function requestJson({ url, method = 'GET', body, timeout = 8000, insecure = true, auth }) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('URL inválida')); }
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = { accept: 'application/json' };
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(payload);
    }
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers,
      timeout,
      rejectUnauthorized: !insecure,
    };
    if (auth) opts.auth = `${auth.username}:${auth.password}`;
    const req = lib.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch { /* texto plano */ }
        resolve({ status: res.statusCode, headers: res.headers, text: data, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado')));
    req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? 'Conexión rechazada' : e.message)));
    if (payload) req.write(payload);
    req.end();
  });
}

const clean = (v) => (v == null ? null : String(v).trim());

function isPrivateHost(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function normalizeMac(m) {
  const s = String(m || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  return s.length === 12 ? s.match(/.{2}/g).join(':') : null;
}

/** Identificador opaco por MAC: la API nunca devuelve la MAC completa. */
function idForMac(mac) {
  return crypto.createHash('sha1').update(String(mac)).digest('hex').slice(0, 12);
}

/* ------------------------------------------------------------------ MikroTik */

function mtBase(cfg) {
  const scheme = cfg.scheme || 'https';
  const port = cfg.port || (scheme === 'https' ? 443 : 80);
  return `${scheme}://${cfg.host}:${port}/rest`;
}

async function mtGet(base, path, cfg) {
  const r = await requestJson({ url: `${base}${path}`, auth: cfg, insecure: true });
  if (r.status === 401 || r.status === 403) throw new Error('Credenciales rechazadas por el router');
  if (r.status !== 200) throw new Error(`El router respondió ${r.status} en ${path}`);
  return Array.isArray(r.json) ? r.json : r.json ? [r.json] : [];
}

async function mtPost(base, path, cfg, body) {
  const r = await requestJson({ url: `${base}${path}`, method: 'POST', auth: cfg, body, insecure: true });
  if (r.status === 401 || r.status === 403) throw new Error('Credenciales rechazadas por el router');
  if (r.status >= 300) throw new Error(`El router respondió ${r.status}: ${r.text.slice(0, 200)}`);
  return r.json;
}

async function mtDelete(base, path, cfg) {
  const r = await requestJson({ url: `${base}${path}`, method: 'DELETE', auth: cfg, insecure: true });
  if (r.status >= 300) throw new Error(`El router respondió ${r.status}`);
  return true;
}

export async function connectMikrotik(cfg) {
  const base = mtBase(cfg);
  const resource = await mtGet(base, '/system/resource', cfg);
  const info = resource[0] || {};
  const identity = await mtGet(base, '/system/identity', cfg).catch(() => []);
  const version = clean(info.version) || 'desconocida';
  const board = clean(info['board-name']) || null;

  let leases = [];
  try { leases = await mtGet(base, '/ip/dhcp-server/lease', cfg); }
  catch { leases = await mtGet(base, '/ip/dhcp-server/lease?status=bound', cfg).catch(() => []); }
  const arp = await mtGet(base, '/ip/arp', cfg).catch(() => []);

  let reg = [];
  let regSource = null;
  try { reg = await mtGet(base, '/interface/wireless/registration-table', cfg); regSource = 'wireless'; }
  catch {
    try { reg = await mtGet(base, '/interface/wifi/registration-table', cfg); regSource = 'wifi'; }
    catch { reg = []; }
  }

  const clients = new Map();
  const put = (mac, patch) => {
    const key = normalizeMac(mac);
    if (!key) return;
    clients.set(key, { mac: key, ...(clients.get(key) || {}), ...patch });
  };
  for (const l of leases) put(l['mac-address'], {
    ip: clean(l['active-address']) || clean(l.address),
    hostname: clean(l['host-name']) || clean(l.comment),
    source: 'DHCP',
    lease: clean(l.status),
  });
  for (const a of arp) put(a['mac-address'], { ip: clients.get(normalizeMac(a['mac-address']))?.ip || clean(a.address), interface: clean(a.interface) });
  for (const r of reg) put(r['mac-address'], {
    signal: clean(r['signal-strength'])?.replace('dBm', '') ? Number(String(r['signal-strength']).replace(/[^\d-]/g, '')) : null,
    rxRate: clean(r['rx-rate']) || null,
    txRate: clean(r['tx-rate']) || null,
    interface: clean(r.interface),
    bytes: r.bytes != null ? Number(r.bytes) : null,
  });

  const list = [...clients.values()]
    .filter((c) => c.mac)
    .map((c) => ({
      ...c,
      id: idForMac(c.mac),
      macMasked: `${c.mac.split(':').slice(0, 3).join(':')}:··:··:··`,
      online: c.lease === 'bound' || Boolean(c.signal) || Boolean(c.ip),
      blocked: false,
    }))
    .sort((a, b) => String(a.ip || '').localeCompare(String(b.ip || ''), undefined, { numeric: true }));

  const macById = new Map(list.map((c) => [c.id, c.mac]));
  for (const c of list) delete c.mac;

  const addressList = await mtGet(base, '/ip/firewall/address-list', cfg).catch(() => []);
  const blockedIps = new Set(addressList.filter((e) => e.list === 'netpilot-block').map((e) => e.address));
  for (const c of list) c.blocked = Boolean(c.ip && blockedIps.has(c.ip));

  return {
    family: 'mikrotik',
    label: `${identity[0]?.name ? identity[0].name + ' · ' : ''}MikroTik RouterOS ${version}`,
    info: { version, board, uptime: clean(info.uptime), cpuLoad: clean(info['cpu-load']) },
    clients: list,
    macById,
    capabilities: [
      { key: 'router_inventory', label: 'Inventario desde el router', status: 'supported', evidence: `REST /ip/dhcp-server/lease y /ip/arp · RouterOS ${version}` },
      { key: 'traffic_per_device', label: 'Señal y tasas por cliente', status: regSource ? 'supported' : 'unavailable', evidence: regSource ? `registration-table (${regSource})` : 'Sin tabla de registro Wi-Fi' },
      { key: 'block', label: 'Bloqueo / desbloqueo', status: 'supported', evidence: 'address-list netpilot-block + regla forward' },
      { key: 'qos', label: 'QoS / límites', status: 'unavailable', evidence: 'No implementado en este MVP' },
      { key: 'ssid', label: 'Cambiar SSID / bandas', status: 'unavailable', evidence: 'No implementado en este MVP' },
    ],
    writes: true,
  };
}

export async function blockMikrotik(cfg, { mac, ip }, blocked) {
  const base = mtBase(cfg);
  if (!ip) throw new Error('El bloqueo en RouterOS requiere una IP conocida');
  const entries = await mtGet(base, '/ip/firewall/address-list', cfg).catch(() => []);
  const mine = entries.filter((e) => e.list === 'netpilot-block' && e.address === ip);

  if (blocked) {
    if (!mine.length) await mtPost(base, '/ip/firewall/address-list', cfg, { list: 'netpilot-block', address: ip, comment: 'NetPilot' });
    const rules = await mtGet(base, '/ip/firewall/filter', cfg).catch(() => []);
    const hasRule = rules.some((r) => r['src-address-list'] === 'netpilot-block' && r.action === 'drop');
    if (!hasRule) {
      await mtPost(base, '/ip/firewall/filter', cfg, {
        chain: 'forward',
        'src-address-list': 'netpilot-block',
        action: 'drop',
        comment: 'netpilot-block',
        'place-before': '0',
      });
    }
  } else {
    for (const e of mine) {
      if (e['.id']) await mtDelete(base, `/ip/firewall/address-list/${encodeURIComponent(e['.id'])}`, cfg);
    }
  }
  return true;
}

/* ------------------------------------------------------------------ OpenWrt */

async function ubusCall(base, session, object, method, args = {}) {
  const r = await requestJson({
    url: `${base}/ubus`,
    method: 'POST',
    body: { jsonrpc: '2.0', id: 1, method: 'call', params: [session, object, method, args] },
  });
  if (r.status !== 200 || !r.json) throw new Error(`ubus respondió ${r.status}`);
  if (r.json.error) throw new Error(`ubus: ${r.json.error.message || 'error'}`);
  const result = r.json.result;
  if (!Array.isArray(result) || result[0] !== 0) {
    throw new Error(`ubus ${object}.${method}: ${JSON.stringify(result?.[1] ?? result)}`);
  }
  return result[1];
}

export async function connectOpenwrt(cfg) {
  const scheme = cfg.scheme || 'http';
  const port = cfg.port || (scheme === 'https' ? 443 : 80);
  const base = `${scheme}://${cfg.host}:${port}`;

  const login = await requestJson({
    url: `${base}/ubus`,
    method: 'POST',
    insecure: true,
    body: {
      jsonrpc: '2.0', id: 1, method: 'call',
      params: ['00000000000000000000000000000000', 'session', 'login', { username: cfg.username, password: cfg.password }],
    },
  });
  const session = login.json?.result?.[1]?.ubus_rpc_session;
  if (!session) throw new Error('OpenWrt rechazó el inicio de sesión (ubus)');

  const devices = await ubusCall(base, session, 'iwinfo', 'devices').catch(() => []);
  const radios = [];
  const clients = new Map();

  for (const dev of devices) {
    const info = await ubusCall(base, session, 'iwinfo', 'info', { device: dev }).catch(() => null);
    if (info) radios.push({ device: dev, ssid: info.ssid || null, channel: info.channel ?? null, mode: info.mode || null, txpower: info.txpower ?? null });
    const assoc = await ubusCall(base, session, 'iwinfo', 'assoclist', { device: dev }).catch(() => null);
    const results = assoc?.results || [];
    for (const a of results) {
      const mac = normalizeMac(a.mac);
      if (!mac) continue;
      const prev = clients.get(mac) || {};
      clients.set(mac, {
        ...prev,
        mac,
        macMasked: `${mac.split(':').slice(0, 3).join(':')}:··:··:··`,
        interface: dev,
        signal: a.signal ?? null,
        noise: a.noise ?? null,
        rxRate: a['rx']?.rate ?? null,
        txRate: a['tx']?.rate ?? null,
        online: true,
        source: 'iwinfo',
      });
    }
  }

  let leases = [];
  try {
    const l = await ubusCall(base, session, 'dhcp', 'ipv4leases');
    leases = l?.device || l?.leases || [];
  } catch {
    try {
      const f = await ubusCall(base, session, 'file', 'read', { path: '/tmp/dhcp.leases' });
      const text = f?.data ? Buffer.from(f.data, 'base64').toString('utf8') : '';
      leases = text.split(/\r?\n/).filter(Boolean).map((line) => {
        const [ts, mac, ip, hostname] = line.split(' ');
        return { mac: mac, ip: ip, hostname: hostname === '*' ? null : hostname };
      });
    } catch { leases = []; }
  }
  for (const l of leases) {
    const mac = normalizeMac(l.mac || l['mac-address']);
    if (!mac) continue;
    const prev = clients.get(mac) || { mac, macMasked: `${mac.split(':').slice(0, 3).join(':')}:··:··:··` };
    clients.set(mac, { ...prev, ip: l.ip || l.address || prev.ip, hostname: l.hostname || l.host || prev.hostname, online: true, source: prev.source || 'DHCP' });
  }

  const list = [...clients.values()]
    .map((c) => ({ ...c, id: idForMac(c.mac), macMasked: `${c.mac.split(':').slice(0, 3).join(':')}:··:··:··` }))
    .sort((a, b) => String(a.ip || '').localeCompare(String(b.ip || ''), undefined, { numeric: true }));
  const macById = new Map(list.map((c) => [c.id, c.mac]));
  for (const c of list) delete c.mac;

  return {
    family: 'openwrt',
    label: 'OpenWrt (ubus)',
    info: { radios, leases: leases.length },
    clients: list,
    macById,
    capabilities: [
      { key: 'router_inventory', label: 'Inventario desde el router', status: leases.length || list.length ? 'supported' : 'unknown', evidence: 'ubus: iwinfo + dhcp/file' },
      { key: 'traffic_per_device', label: 'Tráfico por dispositivo', status: 'unavailable', evidence: 'Sin contabilidad por cliente expuesta por ubus' },
      { key: 'block', label: 'Bloqueo / desbloqueo', status: 'unavailable', evidence: 'Requiere nft o acceso shell; no expuesto por ubus' },
      { key: 'qos', label: 'QoS / límites', status: 'unavailable', evidence: 'Requiere SQM/tc desde shell' },
      { key: 'ssid', label: 'Cambiar SSID / bandas', status: 'unavailable', evidence: 'No implementado en este MVP' },
    ],
    writes: false,
  };
}

/* ------------------------------------------------------------------ Manager */

let session = null;

const cleanCfg = (cfg) => ({
  host: clean(cfg.host),
  port: cfg.port ? Number(cfg.port) : null,
  scheme: cfg.scheme === 'http' ? 'http' : 'https',
  username: clean(cfg.username),
  password: cfg.password == null ? '' : String(cfg.password),
});

async function tryFamily(family, cfg) {
  if (family === 'mikrotik') return connectMikrotik(cfg);
  if (family === 'openwrt') return connectOpenwrt(cfg);
  // auto: primero RouterOS (REST), luego ubus
  try { return await connectMikrotik({ ...cfg, scheme: cfg.scheme || 'https' }); }
  catch (e1) {
    try { return await connectOpenwrt({ ...cfg, scheme: 'http' }); }
    catch (e2) { throw new Error(`No se pudo conectar. RouterOS: ${e1.message}. OpenWrt: ${e2.message}`); }
  }
}

export async function connectAccess(input = {}) {
  const cfg = cleanCfg(input);
  if (!cfg.host || !cfg.username) throw new Error('Faltan host o usuario');
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(cfg.host) && !/^[a-z0-9.-]+$/i.test(cfg.host)) throw new Error('Host inválido');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(cfg.host) && !isPrivateHost(cfg.host)) throw new Error('Solo se permite administrar equipos de la red local');
  const family = ['mikrotik', 'openwrt', 'auto'].includes(input.family) ? input.family : 'auto';
  const result = await tryFamily(family, cfg);
  session = {
    ...result,
    cfg: { ...cfg, password: cfg.password },
    host: cfg.host,
    connectedAt: new Date().toISOString(),
    verified: false,
    warnings: ['Adaptador probado solo contra las APIs documentadas; falta verificación en hardware'],
  };
  return accessStatus();
}

export function disconnectAccess() {
  session = null;
  return accessStatus();
}

export function accessStatus() {
  if (!session) return { connected: false };
  const { cfg, macById, ...rest } = session;
  return { connected: true, ...rest };
}

export async function refreshAccess() {
  if (!session) throw new Error('No hay sesión de administración');
  const cfg = session.cfg;
  const result = session.family === 'mikrotik' ? await connectMikrotik(cfg) : await connectOpenwrt(cfg);
  session = { ...session, ...result, cfg };
  return accessStatus();
}

export async function setBlock({ clientId, ip }, blocked) {
  if (!session) throw new Error('No hay sesión de administración');
  if (session.family !== 'mikrotik') throw new Error('Este adaptador no soporta bloqueo');
  const mac = session.macById?.get(clientId);
  if (!mac) throw new Error('Dispositivo no encontrado en la sesión; actualiza la lista');
  await blockMikrotik(session.cfg, { mac, ip }, blocked);
  await refreshAccess();
  return accessStatus();
}
