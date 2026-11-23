import { vendorFor } from './oui.mjs';

const SEV = { high: 35, medium: 15, low: 5, info: 0, ok: 0, unknown: 0 };

function maskBssid(b) {
  if (!b) return null;
  const p = String(b).split(':');
  return p.length >= 3 ? `${p.slice(0, 3).join(':')}:··:··:··` : b;
}

const isOpenAuth = (a) => !a || /abierta|open|none|ninguna|sin seguridad/i.test(a);

/**
 * Análisis pasivo de la seguridad Wi-Fi. No captura handshakes, no hace deauth,
 * no prueba contraseñas y no guarda nada: solo interpreta lo que WlanAPI ya reporta.
 */
export function analyzeSecurity({ wifi, router }) {
  const link = wifi?.link || null;
  const nets = Array.isArray(wifi?.networks) ? wifi.networks : [];
  const findings = [];
  const add = (id, severity, title, detail, evidence, action) =>
    findings.push({ id, severity, title, detail, evidence: evidence || null, action: action || null });

  const auth = String(link?.auth || '');
  const wpa3 = /wpa3|sae/i.test(auth);
  const wpa2 = /wpa2/i.test(auth);
  const open = auth ? isOpenAuth(auth) : false;
  const wep = /wep/i.test(auth);

  if (!link) {
    add('no-link', 'unknown', 'Sin enlace Wi-Fi', 'No hay una conexión activa que analizar.', 'WlanAPI sin enlace', 'Conéctate a tu red y vuelve a abrir esta pantalla.');
  } else if (!auth) {
    add('auth-unknown', 'info', 'Tipo de seguridad no reportado', 'Windows no entregó la autenticación del enlace; no se puede evaluar.', 'WlanAPI sin datos de autenticación', 'Vuelve a escanear la red.');
  } else if (open) {
    add('open', 'high', 'Red abierta', 'Cualquiera dentro del alcance puede entrar sin clave.', `Autenticación: ${auth || 'abierta'}`, 'Activa WPA2 o WPA3 con una clave larga.');
  } else if (wep) {
    add('wep', 'high', 'WEP (obsoleto)', 'WEP se rompe en minutos; no protege nada.', `Cifrado: ${link.cipher || 'WEP'}`, 'Cambia a WPA2/WPA3.');
  } else if (wpa2 && !wpa3) {
    add('wpa2-only', 'medium', 'WPA2 sin WPA3', 'Con WPA2, quien capture un handshake o un PMKID puede adivinar la clave fuera de línea. WPA3/SAE lo impide.', `Autenticación: ${auth} · Cifrado: ${link.cipher || '—'}`, 'Activa WPA3/SAE si el panel lo permite. Si no, usa una clave larga y aleatoria.');
  }
  if (wpa3) add('wpa3', 'ok', 'WPA3 activo', 'El intercambio SAE evita los ataques de diccionario fuera de línea.', `Autenticación: ${auth}`, null);

  add('wps-unknown', 'info', 'WPS no verificable', 'Windows no expone si WPS está activo. Si lo está, es la vía más fácil para entrar.', 'WlanAPI no reporta WPS', 'Revisa el panel del router y apágalo.');
  add('pmf-unknown', 'info', 'PMF no confirmado', 'No se pudo confirmar 802.11w (PMF). Sin PMF, un deauth puede forzar reconexiones.', 'WlanAPI no reporta PMF', 'Actívalo si el panel lo permite; suele venir con WPA3.');

  if (link) {
    const myBssid = String(link.bssid || '').toLowerCase();
    const myVendor = vendorFor(link.bssid);
    const sameSsid = nets.filter((n) => n.ssid === link.ssid);
    const twins = sameSsid.filter((n) => {
      if (String(n.bssid || '').toLowerCase() === myBssid) return false;
      const v = vendorFor(n.bssid);
      const a = String(n.auth || '');
      const nOpen = a ? isOpenAuth(a) : false;
      return nOpen || (v && myVendor && v !== myVendor);
    });
    if (twins.length) {
      add('twin', 'high', 'Posible AP gemelo',
        `Hay ${twins.length} BSSID con tu mismo SSID, abierto o de otro fabricante. Podría ser un repetidor legítimo o un AP falso.`,
        twins.map((t) => `${maskBssid(t.bssid)} (${vendorFor(t.bssid) || 'fabricante desconocido'})`).join(', '),
        'Confirma si es tu repetidor. Si no, cambia la clave y revisa los equipos conectados.');
    } else {
      add('twin-ok', 'ok', 'Sin AP gemelo evidente', 'No se vio tu SSID abierto ni con otro fabricante.', `${sameSsid.length} BSSID con tu SSID`, null);
    }
  }

  if (router?.gateway?.web?.reachable && router.gateway.web.scheme === 'http') {
    add('admin-http', 'low', 'Panel del router sin TLS', 'El panel se sirve por HTTP en la LAN; quien ya esté dentro podría leer la sesión.', `http://${router.gateway.ip}`, 'Usa HTTPS si el equipo lo permite y cambia la clave del panel.');
  }
  if (router?.ont?.manageable) {
    add('ont-web', 'low', 'ONT con web accesible', 'El ONT responde en su interfaz web desde la LAN.', `${router.ont.ip}:80/443`, 'Mantén su clave distinta y actualizada.');
  }

  const openNeighbors = nets.filter((n) => n.ssid !== link?.ssid && isOpenAuth(n.auth)).length;
  const wpa3Neighbors = nets.filter((n) => /wpa3|sae/i.test(n.auth || '') && n.ssid !== link?.ssid).length;
  add('context', 'info', 'Contexto de vecinos',
    `${nets.length} BSSID visibles; ${wpa3Neighbors} usan WPA3 y ${openNeighbors} están abiertas.`,
    'Escaneo pasivo', 'Es contexto: no cambia la seguridad de tu red.');

  const penalty = findings.reduce((a, f) => a + (SEV[f.severity] ?? 0), 0);
  let score = Math.max(0, 100 - penalty);
  if (open) score = Math.min(score, 15);
  const level = score >= 85 ? 'fuerte' : score >= 65 ? 'aceptable' : score >= 40 ? 'débil' : 'crítico';

  return {
    at: new Date().toISOString(),
    score,
    level,
    findings,
    stats: { neighbors: nets.length, wpa3Neighbors, openNeighbors, findings: findings.length },
    method: 'Análisis pasivo de WlanAPI y del panel. Sin capturas, sin deauth y sin probar claves.',
  };
}
