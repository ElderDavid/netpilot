import { execFile } from 'node:child_process';
import { promises as dns } from 'node:dns';
import net from 'node:net';
import os from 'node:os';

const PS = process.env.SystemRoot
  ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
  : 'powershell.exe';

export function run(cmd, args = [], { timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => resolve({
        ok: !err,
        code: err?.code ?? 0,
        out: String(stdout ?? ''),
        err: String(stderr ?? ''),
      }));
  });
}

export async function ps(script, timeout = 25000) {
  const r = await run(PS, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout });
  return r.out.trim();
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); }
      catch (e) { out[idx] = { error: String(e?.message ?? e) }; }
    }
  });
  await Promise.all(workers);
  return out;
}

export function cidrHosts(ip, prefix, max = 512) {
  const parts = ip.split('.').map(Number);
  const ipNum = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipNum & mask) >>> 0;
  const size = 2 ** (32 - prefix);
  const usable = Math.max(1, size - 2);
  const hosts = [];
  for (let k = 1; k <= usable && hosts.length < max; k++) {
    const n = (network + k) >>> 0;
    hosts.push([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  return hosts;
}

export function isPrivateIp(ip) {
  if (!net.isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export async function getLocalNetworks() {
  const script = [
    "$r = Get-NetIPConfiguration | Where-Object { $_.NetAdapter.Status -eq 'Up' } | ForEach-Object {",
    "  [pscustomobject]@{",
    "    alias = $_.InterfaceAlias;",
    "    ip = @($_.IPv4Address.IPAddress) | Where-Object { $_ };",
    "    prefix = @($_.IPv4Address.PrefixLength);",
    "    gw = $_.IPv4DefaultGateway.NextHop",
    "  }",
    "} | Where-Object { $_.ip.Count -gt 0 };",
    "$r | ConvertTo-Json -Compress -Depth 5",
  ].join('\n');
  const raw = await ps(script);
  let list = [];
  try { list = JSON.parse(raw || '[]'); } catch { list = []; }
  if (!Array.isArray(list)) list = [list];
  return list.map((n) => ({
    alias: n.alias,
    ip: Array.isArray(n.ip) ? n.ip[0] : n.ip,
    prefix: Number(Array.isArray(n.prefix) ? n.prefix[0] : n.prefix) || 24,
    gateway: n.gw || null,
  })).filter((n) => n.ip && net.isIPv4(n.ip));
}

export function pickPrimaryNetwork(list) {
  const virtual = /vEthernet|Loopback|Bluetooth|WSL|Hyper-V|Virtual|VPN|TAP|Tailscale|ZeroTier/i;
  const real = list.filter((n) => !virtual.test(n.alias) && isPrivateIp(n.ip));
  const wifi = real.find((n) => /Wi-?Fi|WLAN|Inal/i.test(n.alias));
  const withGw = real.find((n) => n.gateway);
  return wifi || withGw || real[0] || null;
}

export function getArpTable() {
  return run('arp', ['-a'], { timeout: 8000 }).then(({ out }) => {
    const map = {};
    const re = /^\s*(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+\S+/gim;
    let m;
    while ((m = re.exec(out))) {
      const ip = m[1];
      const mac = m[2].toUpperCase().replace(/-/g, ':');
      if (mac !== 'FF:FF:FF:FF:FF:FF' && mac !== '00:00:00:00:00:00') map[ip] = mac;
    }
    return map;
  });
}

export function pingHost(ip, timeoutMs = 700) {
  return run('ping', ['-n', '1', '-w', String(timeoutMs), ip], { timeout: timeoutMs + 2500 }).then(({ out }) => {
    const ttl = /TTL=(\d+)/i.exec(out);
    const t = /(?:tiempo|time)\s*[=<]\s*(\d+)\s*ms/i.exec(out);
    if (!ttl) return { up: false, ttl: null, ms: null };
    return {
      up: true,
      ttl: ttl ? Number(ttl[1]) : null,
      ms: t ? Number(t[1]) : 0,
    };
  }).catch(() => ({ up: false, ttl: null, ms: null }));
}

export function tcpProbe(ip, port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    const done = (v) => { try { s.destroy(); } catch {} resolve(v); };
    s.setTimeout(timeoutMs);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
    s.connect(port, ip);
  });
}

export async function reverseDns(ip, timeoutMs = 700) {
  try {
    const r = await Promise.race([
      dns.reverse(ip),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
    ]);
    return r?.[0]?.replace(/\.$/, '') || null;
  } catch { return null; }
}

export async function traceroute(target, { maxHops = 5, waitMs = 700 } = {}) {
  const r = await run('tracert', ['-d', '-h', String(maxHops), '-w', String(waitMs), target], { timeout: 30000 });
  const hops = [];
  for (const line of r.out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(?:(\d+)\s*ms\s*)?(?:(\d+)\s*ms\s*)?(?:(\d+)\s*ms\s*)?([0-9a-f:.]+)\s*$/i.exec(line);
    if (!m) continue;
    const times = [m[2], m[3], m[4]].filter(Boolean).map(Number);
    hops.push({
      hop: Number(m[1]),
      ip: m[5],
      ms: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
    });
  }
  return hops;
}

export function systemInfo() {
  const ni = os.networkInterfaces();
  const phys = Object.entries(ni)
    .flatMap(([name, addrs]) => (addrs || []).map((a) => ({ name, ...a })))
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => ({ name: a.name, ip: a.address, mac: a.mac }));
  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
    interfaces: phys,
    uptimeSec: Math.round(os.uptime()),
  };
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
