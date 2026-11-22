import fs from 'node:fs';
import path from 'node:path';

const OUI_URL = 'https://standards-oui.ieee.org/oui/oui.csv';

const FALLBACK = {
  AC80AE: 'Fiberhome',
  A081AE: 'Fiberhome',
  C40F08: 'Huawei',
  '00259E': 'Huawei',
  '00E0FC': 'Huawei',
  '48AD08': 'Huawei',
  B827EB: 'Raspberry Pi',
  DCA632: 'Raspberry Pi',
  '240AC4': 'Espressif',
  '3C6105': 'Espressif',
  '0017FA': 'Microsoft',
  '7C1E52': 'Microsoft',
  F4F5D8: 'Google',
};

const NORMALIZE = [
  [/huawei/i, 'Huawei'],
  [/fiberhome/i, 'Fiberhome'],
  [/apple/i, 'Apple'],
  [/samsung/i, 'Samsung'],
  [/xiaomi/i, 'Xiaomi'],
  [/espressif/i, 'Espressif'],
  [/tp-?link/i, 'TP-Link'],
  [/intel/i, 'Intel'],
  [/mediatek/i, 'MediaTek'],
  [/realtek/i, 'Realtek'],
  [/qualcomm/i, 'Qualcomm'],
  [/sony/i, 'Sony'],
  [/china dragon/i, 'LG'],
  [/lg electronics/i, 'LG'],
  [/amazon/i, 'Amazon'],
  [/roku/i, 'Roku'],
  [/google/i, 'Google'],
  [/microsoft/i, 'Microsoft'],
  [/raspberry/i, 'Raspberry Pi'],
  [/sonos/i, 'Sonos'],
  [/nintendo/i, 'Nintendo'],
  [/dell/i, 'Dell'],
  [/hewlett|hp inc/i, 'HP'],
  [/lenovo/i, 'Lenovo'],
  [/asus/i, 'ASUS'],
  [/netgear/i, 'Netgear'],
  [/d-?link/i, 'D-Link'],
  [/zyxel/i, 'Zyxel'],
  [/ubiquiti/i, 'Ubiquiti'],
  [/cisco/i, 'Cisco'],
  [/mikrotik/i, 'MikroTik'],
  [/tuya/i, 'Tuya'],
  [/broadcom/i, 'Broadcom'],
  [/azurewave/i, 'AzureWave'],
  [/hon hai|foxconn/i, 'Foxconn'],
];

let table = null;
let source = 'none';

export async function loadOui(dataDir) {
  const cache = path.join(dataDir, 'oui.csv');
  try {
    if (fs.existsSync(cache) && fs.statSync(cache).size > 100000) {
      table = parseCsv(fs.readFileSync(cache, 'utf8'));
      source = 'cache';
      return { count: table.size, source };
    }
  } catch {}
  try {
    const res = await fetch(OUI_URL, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(cache, text);
    table = parseCsv(text);
    source = 'download';
    return { count: table.size, source };
  } catch (e) {
    table = new Map(Object.entries(FALLBACK));
    source = 'fallback';
    return { count: table.size, source, error: String(e?.message ?? e) };
  }
}

function parseCsv(text) {
  const map = new Map();
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = splitCsv(line);
    if (cols.length < 3) continue;
    const prefix = (cols[1] || '').trim().toUpperCase();
    const org = (cols[2] || '').trim();
    if (prefix.length !== 6 || !org) continue;
    map.set(prefix, normalizeOrg(org));
  }
  return map;
}

function splitCsv(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (q && line[i + 1] === '"') { cur += '"'; i++; }
      else q = !q;
    } else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function normalizeOrg(org) {
  for (const [re, name] of NORMALIZE) if (re.test(org)) return name;
  return org.replace(/\s+(co\.?,?\s*ltd\.?|inc\.?|corp\.?|corporation|company|gmbh|s\.a\.?|ltda\.?|llc)\.?$/i, '').trim();
}

export function vendorFor(mac) {
  if (!mac) return null;
  const prefix = mac.replace(/[^0-9A-F]/gi, '').slice(0, 6).toUpperCase();
  if (table?.has(prefix)) return table.get(prefix);
  if (FALLBACK[prefix]) return FALLBACK[prefix];
  return null;
}

export function ouiSource() { return source; }
