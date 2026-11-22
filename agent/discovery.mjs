import dgram from 'node:dgram';
import { cidrHosts, getArpTable, mapLimit, pingHost, reverseDns } from './net.mjs';
import { vendorFor } from './oui.mjs';

const TYPE_LABEL = {
  router: 'Router / red',
  mobile: 'Móvil',
  computer: 'Computador',
  tv: 'TV / streaming',
  console: 'Consola',
  printer: 'Impresora',
  iot: 'IoT',
  network: 'Equipo de red',
  unknown: 'Desconocido',
};

const VENDOR_NET = /fiberhome|huawei|mikrotik|cisco|ubiquiti|tp-?link|netgear|zyxel|d-?link|aruba|ruckus|juniper/i;

export function ssdpDiscover(localIp, timeoutMs = 2600) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      try { sock.close(); } catch {}
      resolve([...found.values()]);
    };
    const timer = setTimeout(finish, timeoutMs);
    sock.on('message', (msg, rinfo) => {
      const text = msg.toString('utf8');
      if (!/^HTTP\/1\.1 200/i.test(text)) return;
      const h = {};
      for (const line of text.split(/\r?\n/).slice(1)) {
        const i = line.indexOf(':');
        if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      const prev = found.get(rinfo.address) || { ip: rinfo.address, servers: [], locations: [], st: [] };
      if (h.server) prev.servers.push(h.server);
      if (h.location) prev.locations.push(h.location);
      if (h.st) prev.st.push(h.st);
      found.set(rinfo.address, prev);
    });
    sock.on('error', finish);
    sock.bind(0, () => {
      try {
        sock.setBroadcast(true);
        if (localIp) sock.setMulticastInterface(localIp);
      } catch {}
      const msg = Buffer.from(
        'M-SEARCH * HTTP/1.1\r\n' +
        'HOST: 239.255.255.250:1900\r\n' +
        'MAN: "ssdp:discover"\r\n' +
        'MX: 2\r\n' +
        'ST: ssdp:all\r\n' +
        'USER-AGENT: NetPilot/0.1 UPnP/1.1\r\n\r\n'
      );
      sock.send(msg, 0, msg.length, 1900, '239.255.255.250', () => {});
    });
    setTimeout(() => clearTimeout(timer), timeoutMs + 100);
  });
}

export async function enrichSsdp(entries) {
  const targets = entries.filter((e) => e.locations?.length).slice(0, 24);
  return mapLimit(targets, 6, async (e) => {
    const loc = e.locations.find((l) => /^https?:\/\//i.test(l));
    if (!loc) return e;
    try {
      const res = await fetch(loc, { signal: AbortSignal.timeout(1800) });
      const xml = await res.text();
      const pick = (tag) => {
        const m = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i').exec(xml);
        return m ? m[1].trim() : null;
      };
      return {
        ...e,
        friendlyName: pick('friendlyName'),
        manufacturer: pick('manufacturer'),
        modelName: pick('modelName'),
        modelNumber: pick('modelNumber'),
        deviceType: pick('deviceType'),
      };
    } catch { return e; }
  });
}

export function inferType({ vendor, hostname, ssdp, ttl, isGateway }) {
  if (isGateway) return { type: 'router', confidence: 'high', why: 'Es el gateway por defecto' };
  const name = `${hostname || ''} ${ssdp?.friendlyName || ''} ${ssdp?.modelName || ''} ${ssdp?.manufacturer || ''}`.toLowerCase();
  const st = `${ssdp?.deviceType || ''} ${(ssdp?.st || []).join(' ')}`.toLowerCase();

  if (/printer|epson|brother|canon|laserjet|deskjet/.test(name) || /printer/.test(st))
    return { type: 'printer', confidence: 'high', why: 'Nombre o descripción SSDP de impresora' };
  if (/xbox|playstation|\bps[45]\b|nintendo|switch/.test(name)) return { type: 'console', confidence: 'high', why: 'Nombre de consola' };
  if (/roku|chromecast|appletv|fire ?tv|smart ?tv|bravia|shield|mediarenderer|tv /.test(name) || /mediarenderer|mediaserver/.test(st))
    return { type: 'tv', confidence: 'high', why: 'SSDP de reproducción de medios o nombre de TV' };
  if (/esp_|espressif|tasmota|shelly|sonoff|tuya|smart ?plug|bulb|echo|alexa|google ?home|nest|iot/.test(name) || vendor === 'Espressif' || vendor === 'Tuya')
    return { type: 'iot', confidence: 'high', why: 'Fabricante o nombre típico de IoT' };
  if (/iphone|ipad|galaxy|pixel|redmi|oneplus|moto g|android/.test(name))
    return { type: 'mobile', confidence: 'high', why: 'Nombre de dispositivo móvil' };
  if (/laptop|desktop|thinkpad|macbook|notebook|-pc\b|workstation/.test(name))
    return { type: 'computer', confidence: 'high', why: 'Nombre de computador' };
  if (VENDOR_NET.test(vendor || '') && ttl === 255)
    return { type: 'network', confidence: 'medium', why: 'Fabricante de red y TTL 255' };
  if (vendor === 'Apple') return { type: 'mobile', confidence: 'low', why: 'Fabricante Apple; el tipo es una estimación' };
  if (ttl === 128) return { type: 'computer', confidence: 'low', why: 'TTL 128 típico de Windows' };
  if (ttl === 64) return { type: 'mobile', confidence: 'low', why: 'TTL 64 típico de Linux/Android' };
  return { type: 'unknown', confidence: 'low', why: 'Sin evidencia suficiente' };
}

export function maskMac(mac) {
  if (!mac) return null;
  const p = mac.split(':');
  if (p.length < 4) return mac;
  return `${p.slice(0, 3).join(':')}:··:··:··`;
}

export async function scanNetwork({ network, maxHosts = 254, onProgress = () => {} }) {
  const started = Date.now();
  const hosts = cidrHosts(network.ip, network.prefix, maxHosts);
  const self = network.ip;
  const gateway = network.gateway;

  onProgress({ phase: 'ping', done: 0, total: hosts.length, message: 'Barriendo la subred' });
  const results = new Map();
  let done = 0;
  await mapLimit(hosts, 32, async (ip) => {
    if (ip === self) { done++; return; }
    const r = await pingHost(ip, 650);
    done++;
    if (done % 16 === 0) onProgress({ phase: 'ping', done, total: hosts.length, message: 'Barriendo la subred' });
    if (r.up) results.set(ip, r);
  });

  onProgress({ phase: 'arp', message: 'Leyendo tabla ARP' });
  const arp = await getArpTable();

  const subnetHosts = new Set(cidrHosts(network.ip, network.prefix, 4000));
  const arpIps = Object.keys(arp).filter((ip) => subnetHosts.has(ip));
  const missing = arpIps.filter((ip) => !results.has(ip));
  if (missing.length) {
    onProgress({ phase: 'ping2', message: 'Confirmando equipos vistos en ARP' });
    await mapLimit(missing, 12, async (ip) => {
      const r = await pingHost(ip, 900);
      if (r.up) results.set(ip, r);
    });
  }

  const ips = new Set([...results.keys(), ...arpIps]);
  ips.add(gateway);
  ips.delete(self);
  const gatewayVendor = vendorFor(arp[gateway] || null);

  onProgress({ phase: 'dns', message: 'Resolviendo nombres' });
  const names = await mapLimit([...ips], 16, async (ip) => [ip, await reverseDns(ip, 600)]);
  const nameMap = Object.fromEntries(names.filter(([, n]) => n));

  onProgress({ phase: 'ssdp', message: 'Buscando servicios UPnP' });
  const ssdpRaw = await ssdpDiscover(network.ip, 2600);
  const ssdp = await enrichSsdp(ssdpRaw);
  const ssdpByIp = Object.fromEntries(ssdp.map((s) => [s.ip, s]));

  const devices = [];
  for (const ip of ips) {
    const mac = arp[ip] || null;
    const vendor = vendorFor(mac);
    const info = results.get(ip);
    const hostname = nameMap[ip] || null;
    const svc = ssdpByIp[ip] || null;
    const isGateway = ip === gateway;
    const guess = inferType({ vendor, hostname, ssdp: svc, ttl: info?.ttl, isGateway });

    let type = guess.type;
    let confidence = guess.confidence;
    let why = [guess.why];
    let name = svc?.friendlyName || hostname || null;

    if (isGateway) {
      name = vendor ? `Router principal (${vendor})` : 'Router principal';
    } else if ((type === 'unknown' || (confidence === 'low' && !hostname && !svc)) && vendor && gatewayVendor && vendor === gatewayVendor) {
      type = 'network';
      confidence = 'medium';
      why.push('Mismo fabricante que el gateway; posible nodo de malla o repetidor');
    }
    if (!name) {
      name = type === 'network' && vendor ? `Nodo de red (${vendor})` : vendor ? `${vendor} · ${TYPE_LABEL[type]}` : null;
    }

    devices.push({
      key: mac || `ip:${ip}`,
      ip,
      mac: mac || null,
      macMasked: maskMac(mac),
      name,
      vendor: vendor || svc?.manufacturer || null,
      type,
      typeLabel: TYPE_LABEL[type],
      confidence,
      reasons: why,
      hostname,
      ttl: info?.ttl ?? null,
      rttMs: info?.ms ?? null,
      online: Boolean(info) || isGateway || Boolean(svc) || Boolean(mac),
      isGateway,
      ssdp: svc ? {
        friendlyName: svc.friendlyName || null,
        manufacturer: svc.manufacturer || null,
        modelName: svc.modelName || null,
        deviceType: svc.deviceType || null,
      } : null,
      method: [
        info ? 'ICMP' : null,
        mac ? 'ARP' : null,
        hostname ? 'DNS inverso' : null,
        svc ? 'SSDP' : null,
      ].filter(Boolean),
    });
  }

  devices.sort((a, b) => {
    if (a.isGateway) return -1;
    if (b.isGateway) return 1;
    return ipNum(a.ip) - ipNum(b.ip);
  });

  onProgress({ phase: 'done', message: 'Inventario actualizado' });
  return {
    devices,
    stats: {
      hostsProbed: hosts.length,
      online: devices.filter((d) => d.online).length,
      durationMs: Date.now() - started,
      ssdpResponses: ssdp.length,
    },
  };
}

function ipNum(ip) {
  return ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0;
}

export { TYPE_LABEL };
