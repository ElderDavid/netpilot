import { run } from './net.mjs';

async function netsh(args) {
  const r = await run('cmd.exe', ['/c', `chcp 65001>nul && netsh ${args}`], { timeout: 20000 });
  return r.out;
}

const RX = {
  ssid: /^SSID$/i,
  bssid: /^AP BSSID$/i,
  band: /^(Banda|Band)$/i,
  channel: /^(Canal|Channel)$/i,
  radio: /^(Tipo de radio|Radio type)$/i,
  auth: /^(Autenticaci[oó]n|Authentication)$/i,
  cipher: /^(Cifrado|Cipher)$/i,
  rx: /^(Velocidad de recepci[oó]n.*|Receive rate.*)$/i,
  tx: /^(Velocidad de transmisi[oó]n.*|Transmit rate.*)$/i,
  signal: /^(Se[ñn]al|Signal)$/i,
  rssi: /^Rssi$/i,
  state: /^(Estado|State)$/i,
  profile: /^(Perfil|Profile)$/i,
  desc: /^(Descripci[oó]n|Description)$/i,
};

function parseLink(text) {
  const link = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*([^:]+?)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    for (const [field, re] of Object.entries(RX)) {
      if (re.test(key) && link[field] === undefined) link[field] = val;
    }
  }
  if (link.profile === undefined) link.profile = null;
  return {
    connected: /conectado|connected/i.test(link.state || ''),
    state: link.state || null,
    ssid: link.ssid || null,
    bssid: link.bssid || null,
    band: link.band || null,
    channel: link.channel ? Number(link.channel) : null,
    radio: link.radio || null,
    auth: link.auth || null,
    cipher: link.cipher || null,
    rxMbps: link.rx ? Number(String(link.rx).replace(/[^\d.]/g, '')) || null : null,
    txMbps: link.tx ? Number(String(link.tx).replace(/[^\d.]/g, '')) || null : null,
    signalPct: link.signal ? Number(String(link.signal).replace(/[^\d]/g, '')) || null : null,
    rssi: link.rssi ? Number(link.rssi) : null,
    adapter: link.desc || null,
    profile: link.profile,
  };
}

function parseScan(text) {
  const nets = [];
  let cur = null;
  let bss = null;
  const push = () => { if (cur && bss) cur.bssids.push(bss); if (cur) nets.push(cur); cur = null; bss = null; };

  for (const raw of text.split(/\r?\n/)) {
    let m;
    if ((m = /^\s*SSID\s+(\d+)\s*:\s*(.*)$/i.exec(raw))) {
      if (bss && cur) { cur.bssids.push(bss); bss = null; }
      if (cur) nets.push(cur);
      cur = { ssid: m[2].trim() || '(oculta)', bssids: [] };
      continue;
    }
    if (!cur) continue;
    if ((m = /^\s*BSSID\s+\d+\s*:\s*([0-9a-f:]{17})/i.exec(raw))) {
      if (bss) cur.bssids.push(bss);
      bss = { bssid: m[1].toUpperCase(), signalPct: null, band: null, channel: null, radio: null, auth: null, cipher: null, stations: null, utilization: null };
      continue;
    }
    if (!bss) {
      if ((m = /^\s*(Autenticaci[oó]n|Authentication)\s*:\s*(.*)$/i.exec(raw))) cur.auth = m[2].trim();
      if ((m = /^\s*(Cifrado|Cipher)\s*:\s*(.*)$/i.exec(raw))) cur.cipher = m[2].trim();
      continue;
    }
    if ((m = /^\s*(Se[ñn]al|Signal)\s*:\s*(\d+)\s*%/i.exec(raw))) bss.signalPct = Number(m[2]);
    else if ((m = /^\s*(Banda|Band)\s*:\s*(.*)$/i.exec(raw))) bss.band = m[2].trim();
    else if ((m = /^\s*(Canal|Channel)\s*:\s*(\d+)/i.exec(raw))) bss.channel = Number(m[2]);
    else if ((m = /^\s*(Tipo de radio|Radio type)\s*:\s*(.*)$/i.exec(raw))) bss.radio = m[2].trim();
    else if ((m = /^\s*(Autenticaci[oó]n|Authentication)\s*:\s*(.*)$/i.exec(raw))) bss.auth = m[2].trim();
    else if ((m = /^\s*(Cifrado|Cipher)\s*:\s*(.*)$/i.exec(raw))) bss.cipher = m[2].trim();
    else if ((m = /(Estaciones conectadas|Connected stations)\s*:\s*(\d+)/i.exec(raw))) bss.stations = Number(m[2]);
    else if ((m = /(Uso del canal|Channel utilization)\s*:\s*(\d+)\s*\(\s*(\d+)\s*%\s*\)/i.exec(raw))) bss.utilization = Number(m[3]);
    else if ((m = /(Uso del canal|Channel utilization)\s*:\s*(\d+)/i.exec(raw))) bss.utilization = Number(m[2]);
  }
  if (bss && cur) cur.bssids.push(bss);
  if (cur) nets.push(cur);

  const rows = [];
  for (const n of nets) {
    for (const b of n.bssids) {
      rows.push({
        ...b,
        ssid: n.ssid,
        auth: b.auth || n.auth || null,
        cipher: b.cipher || n.cipher || null,
      });
    }
  }
  return rows;
}

const CH24 = [1, 6, 11];
const BLOCKS5 = [
  { start: 36, end: 48, primary: 36, dfs: false },
  { start: 52, end: 64, primary: 52, dfs: true },
  { start: 100, end: 112, primary: 100, dfs: true },
  { start: 116, end: 128, primary: 116, dfs: true },
  { start: 132, end: 144, primary: 132, dfs: true },
  { start: 149, end: 161, primary: 149, dfs: false },
  { start: 165, end: 165, primary: 165, dfs: false },
];

function bandOf(n) {
  if (n.band) return /2[.,]?4/i.test(n.band) ? '2.4' : /5/i.test(n.band) ? '5' : /6/i.test(n.band) ? '6' : n.band;
  return n.channel && n.channel <= 14 ? '2.4' : '5';
}

export function analyzeChannels(nets) {
  const used = nets.filter((n) => n.channel);
  const score24 = CH24.map((ch) => {
    const overlap = used.filter((n) => bandOf(n) === '2.4' && Math.abs(n.channel - ch) <= 4);
    const util = overlap.reduce((a, n) => a + (n.utilization ?? 25), 0);
    return { channel: ch, label: String(ch), aps: overlap.length, utilization: Math.min(100, util), score: overlap.length * 10 + util / 10 };
  });
  const score5 = BLOCKS5.map((b) => {
    const same = used.filter((n) => bandOf(n) === '5' && n.channel >= b.start && n.channel <= b.end);
    const util = same.reduce((a, n) => a + (n.utilization ?? 10), 0);
    const label = b.start === b.end ? String(b.start) : `${b.start}-${b.end}`;
    return { channel: b.primary, label, start: b.start, end: b.end, dfs: b.dfs, wide: b.end > b.start, aps: same.length, utilization: Math.min(100, util), score: same.length * 10 + util / 10 };
  });
  return { '2.4': score24, '5': score5 };
}

export function recommend(nets, link, channels) {
  const band = link?.band && /2[.,]?4/i.test(link.band) ? '2.4' : '5';
  const list = channels[band] || [];
  if (!list.length || !link?.channel) return null;
  const current = band === '2.4'
    ? list.find((c) => c.channel === link.channel)
    : list.find((c) => link.channel >= c.start && link.channel <= c.end);

  // En 5 GHz se prefieren bloques no DFS y con ancho suficiente; 165 es solo 20 MHz.
  const allowDfs = band !== '5' || Boolean(current?.dfs);
  let pool = band === '5' ? list.filter((c) => c.wide !== false) : list;
  if (band === '5' && !allowDfs) pool = pool.filter((c) => !c.dfs);
  if (!pool.length) pool = list;
  const sorted = [...pool].sort((a, b) => a.score - b.score);
  const best = sorted[0];
  const delta = current ? current.score - best.score : 0;
  const congested = Boolean(current) && (current.utilization >= 20 || current.aps >= 5);
  const shouldChange = congested && best.channel !== current.channel && delta > 15;
  const describe = (c) => `bloque ${c.label}: ${c.aps} AP(s), ${Math.round(c.utilization)}% de ocupación estimada`;
  return {
    band,
    current: current?.label ?? String(link.channel),
    best: best.label,
    bestDfs: Boolean(best.dfs),
    shouldChange,
    delta: Math.round(delta * 10) / 10,
    reason: shouldChange
      ? `Estás en el ${describe(current)}. Mejor opción: ${describe(best)}${best.dfs ? ' (requiere DFS)' : ''}.`
      : congested
        ? `Estás en el ${describe(current)}. No hay una mejora clara con la información disponible.`
        : `Estás en el ${describe(current ?? { label: link.channel, aps: 0, utilization: 0 })}. El canal está poco ocupado; no conviene tocarlo.`,
    alternatives: sorted.slice(1, 3).map((c) => c.label),
    note: band === '5'
      ? 'Se evalúan bloques de 80 MHz porque Windows no reporta el ancho real. Se evitan canales DFS salvo que el equipo ya use uno; en un nodo mesh el canal puede estar impuesto por el enlace de retorno.'
      : 'En 2,4 GHz se evalúan los canales 1, 6 y 11 y el solapamiento de ±4 canales.',
  };
}

export async function getWifi() {
  const [linkText, scanText] = await Promise.all([
    netsh('wlan show interfaces'),
    netsh('wlan show networks mode=bssid'),
  ]);
  const link = parseLink(linkText);
  const networks = parseScan(scanText);
  const channels = analyzeChannels(networks);
  return { link, networks, channels, recommendation: recommend(networks, link, channels), at: new Date().toISOString() };
}
