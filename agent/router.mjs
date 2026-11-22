import { tcpProbe, traceroute } from './net.mjs';
import { vendorFor } from './oui.mjs';

const CAP = (key, label, status, evidence, mvp) => ({ key, label, status, evidence, mvp });

const COMMON_LOCAL = [
  CAP('discovery', 'Descubrimiento e inventario', 'supported', 'Sondas locales del agente (ICMP, ARP, DNS inverso, SSDP)', 'supported'),
  CAP('latency', 'Latencia, jitter y pérdida', 'supported', 'Sondas ICMP/TCP del agente', 'supported'),
  CAP('speedtest', 'Prueba de velocidad', 'supported', 'Descarga y subida HTTP desde el agente', 'supported'),
  CAP('wifi_diag', 'Diagnóstico Wi-Fi', 'supported', 'WlanAPI de Windows (canal, RSSI, vecinos)', 'supported'),
  CAP('history', 'Historial y auditoría', 'supported', 'Base local del agente', 'supported'),
];

const FAMILIES = {
  fiberhome: {
    label: 'Fiberhome (panel mínimo)',
    caps: [
      CAP('router_inventory', 'Inventario desde el router', 'unavailable', 'El panel solo expone configuración básica; sin endpoint de clientes', 'unavailable'),
      CAP('traffic_per_device', 'Tráfico por dispositivo', 'unavailable', 'Sin contadores por estación en la API observada', 'unavailable'),
      CAP('block', 'Bloqueo / desbloqueo', 'unavailable', 'Sin API de firewall o lista de acceso', 'unavailable'),
      CAP('ssid', 'Cambiar SSID, contraseña o bandas', 'unavailable', 'Solo desde el asistente del propio equipo', 'unavailable'),
      CAP('qos', 'QoS / límites por equipo', 'unavailable', 'Sin colas ni perfiles configurables por API', 'unavailable'),
      CAP('guide', 'Modo guía', 'supported', 'Pasos manuales para el panel del fabricante', 'supported'),
    ],
  },
  huawei: {
    label: 'Huawei EchoLife',
    caps: [
      CAP('router_inventory', 'Inventario desde el router', 'unknown', 'Depende del firmware y de si el operador habilita el acceso local', 'unavailable'),
      CAP('traffic_per_device', 'Tráfico por dispositivo', 'unknown', 'No verificado en este firmware', 'unavailable'),
      CAP('block', 'Bloqueo / desbloqueo', 'unknown', 'Puede existir filtro MAC en el panel; no verificado', 'unavailable'),
      CAP('ssid', 'Cambiar SSID, contraseña o bandas', 'config_required', 'Requiere acceso de administrador al panel del ONT', 'unavailable'),
      CAP('qos', 'QoS / límites por equipo', 'unknown', 'Depende del firmware del operador', 'unavailable'),
      CAP('guide', 'Modo guía', 'supported', 'Pasos manuales', 'supported'),
    ],
  },
  openwrt: {
    label: 'OpenWrt',
    caps: [
      CAP('router_inventory', 'Inventario desde el router', 'config_required', 'ubus + dnsmasq; requiere rpcd y ACLs', 'read_only'),
      CAP('traffic_per_device', 'Tráfico por dispositivo', 'config_required', 'Requiere contabilidad nft/conntrack adicional', 'unavailable'),
      CAP('block', 'Bloqueo / desbloqueo', 'config_required', 'nft o ACL de hostapd', 'unavailable'),
      CAP('ssid', 'Cambiar SSID, contraseña o bandas', 'config_required', 'uci + hostapd', 'unavailable'),
      CAP('qos', 'QoS / límites por equipo', 'config_required', 'SQM/CAKE o tc', 'unavailable'),
      CAP('guide', 'Modo guía', 'supported', 'Pasos manuales', 'supported'),
    ],
  },
  mikrotik: {
    label: 'MikroTik RouterOS',
    caps: [
      CAP('router_inventory', 'Inventario desde el router', 'config_required', 'REST (v7) o API-SSL; requiere servicio y permisos', 'read_only'),
      CAP('traffic_per_device', 'Tráfico por dispositivo', 'config_required', 'registration-table por estación', 'read_only'),
      CAP('block', 'Bloqueo / desbloqueo', 'config_required', 'address-list + firewall', 'unavailable'),
      CAP('ssid', 'Cambiar SSID, contraseña o bandas', 'config_required', 'interfaces wireless/wifi', 'unavailable'),
      CAP('qos', 'QoS / límites por equipo', 'config_required', 'simple queue / queue tree; CAKE en v7', 'unavailable'),
      CAP('guide', 'Modo guía', 'supported', 'Pasos manuales', 'supported'),
    ],
  },
  generic: {
    label: 'Genérico',
    caps: [
      CAP('router_inventory', 'Inventario desde el router', 'unknown', 'Sin interfaz documentada detectada', 'unavailable'),
      CAP('traffic_per_device', 'Tráfico por dispositivo', 'unavailable', 'Sin endpoint observado', 'unavailable'),
      CAP('block', 'Bloqueo / desbloqueo', 'unavailable', 'Sin API documentada', 'unavailable'),
      CAP('ssid', 'Cambiar SSID, contraseña o bandas', 'unknown', 'Puede requerir el panel del fabricante', 'unavailable'),
      CAP('qos', 'QoS / límites por equipo', 'unknown', 'Depende del firmware', 'unavailable'),
      CAP('guide', 'Modo guía', 'supported', 'Pasos manuales', 'supported'),
    ],
  },
};

function titleOf(html) {
  const m = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(html || '');
  return m ? m[1].trim() : null;
}

async function httpFingerprint(ip) {
  for (const scheme of ['http', 'https']) {
    try {
      const res = await fetch(`${scheme}://${ip}/`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(4000),
        headers: { 'User-Agent': 'NetPilot/0.1 (diagnóstico local)' },
      });
      const html = await res.text().catch(() => '');
      return {
        scheme,
        status: res.status,
        server: res.headers.get('server'),
        title: titleOf(html),
        reachable: true,
        bodyHint: html.slice(0, 4000),
      };
    } catch { /* siguiente esquema */ }
  }
  return { reachable: false };
}

function detectFamily(fp) {
  if (!fp?.reachable) return 'generic';
  const hay = `${fp.title || ''} ${fp.server || ''} ${fp.bodyHint || ''}`.toLowerCase();
  if (hay.includes('mikrotik') || hay.includes('routeros')) return 'mikrotik';
  if (hay.includes('openwrt') || hay.includes('luci')) return 'openwrt';
  if (hay.includes('fiberhome') || hay.includes('smartfiberhome')) return 'fiberhome';
  if (hay.includes('huawei') || hay.includes('echolife')) return 'huawei';
  return 'generic';
}

export async function inspectRouter({ gateway, gatewayMac, gatewayVendor }) {
  const fp = await httpFingerprint(gateway);
  const family = detectFamily(fp);
  const hops = await traceroute('1.1.1.1', { maxHops: 5, waitMs: 700 }).catch(() => []);

  const upstream = hops.find((h) => h.hop === 2 && h.ip !== gateway) || null;
  let ont = null;
  if (upstream && upstream.ip && /^\d+\.\d+\.\d+\.\d+$/.test(upstream.ip)) {
    const [p80, p443] = await Promise.all([
      tcpProbe(upstream.ip, 80, 1400),
      tcpProbe(upstream.ip, 443, 1400),
    ]);
    ont = {
      ip: upstream.ip,
      ms: upstream.ms,
      web80: p80,
      web443: p443,
      manageable: p80 || p443,
      note: p80 || p443
        ? 'Responde en la web; puede requerir credenciales del operador'
        : 'No expone administración web desde esta subred',
    };
  } else if (upstream) {
    ont = { ip: upstream.ip, ms: upstream.ms, web80: false, web443: false, manageable: false, note: 'Salto intermedio no identificado' };
  }

  const familyCaps = FAMILIES[family] || FAMILIES.generic;
  const caps = [...COMMON_LOCAL, ...familyCaps.caps];
  const summary = {
    supported: caps.filter((c) => c.status === 'supported').length,
    configRequired: caps.filter((c) => c.status === 'config_required').length,
    readOnly: caps.filter((c) => c.status === 'read_only').length,
    unavailable: caps.filter((c) => c.status === 'unavailable').length,
    unknown: caps.filter((c) => c.status === 'unknown').length,
  };

  return {
    gateway: {
      ip: gateway,
      macMasked: gatewayMac ? `${gatewayMac.split(':').slice(0, 3).join(':')}:··:··:··` : null,
      vendor: gatewayVendor || null,
      web: { reachable: fp.reachable, scheme: fp.scheme || null, status: fp.status || null, server: fp.server || null, title: fp.title || null },
      family,
      familyLabel: familyCaps.label,
    },
    hops,
    ont,
    capabilities: caps,
    summary,
    inspectedAt: new Date().toISOString(),
  };
}

export function familyLabel(family) {
  return FAMILIES[family]?.label || FAMILIES.generic.label;
}

export { vendorFor };
