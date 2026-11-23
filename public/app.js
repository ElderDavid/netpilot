const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const state = {
  data: null,
  route: location.hash.replace('#', '') || 'overview',
  deviceFilter: { q: '', type: 'all', only: 'all' },
  busy: {},
  activeJob: null,
  wifiBand: null,
  historySel: { a: 'current', b: 'current' },
};

const TYPE_ICON = {
  router: '⌂', mobile: '▯', computer: '▭', tv: '▣', console: '◉',
  printer: '▤', iot: '◌', network: '⇄', unknown: '?',
};

const CAP_STATUS = {
  supported: ['Soportado', 'ok'],
  config_required: ['Requiere configuración', 'warn'],
  read_only: ['Solo lectura', 'info'],
  unavailable: ['No disponible', 'bad'],
  unknown: ['Desconocido', ''],
};

const CONF = { high: ['alta', 'ok'], medium: ['media', 'warn'], low: ['baja', ''] };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function num(v, d = 0) { return v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d); }
function ago(iso) {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'hace ' + Math.round(s) + ' s';
  if (s < 3600) return 'hace ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'hace ' + Math.round(s / 3600) + ' h';
  return 'hace ' + Math.round(s / 86400) + ' d';
}
function clock(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function toast(title, body = '', tone = 'info') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<b>${esc(title)}</b>${body ? `<span class="muted">${esc(body)}</span>` : ''}`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 5200);
  setTimeout(() => el.remove(), 5600);
}

async function pollJob(id, onTick) {
  for (;;) {
    const j = await api(`/api/jobs/${id}`);
    if (onTick) onTick(j);
    if (j.status === 'done') return j.result;
    if (j.status === 'error') throw new Error(j.error || 'El trabajo falló');
    await new Promise((r) => setTimeout(r, 700));
  }
}

/* ---------------- data ---------------- */
async function refresh() {
  state.data = await api('/api/bootstrap');
  render();
}

function devices() { return state.data?.state?.devices || []; }
function alerts() { return state.data?.state?.alerts || []; }
function events() { return state.data?.state?.events || []; }
function lastTest(kind) { return state.data?.state?.tests?.[kind]?.[0] || null; }

/* ---------------- health ---------------- */
function health() {
  const d = state.data;
  const lat = lastTest('latency');
  const wifi = d?.state?.wifi;
  const factors = [];

  if (lat?.gateway?.p50 != null) {
    const v = lat.gateway.p50;
    factors.push({
      name: 'Latencia', val: `${num(v, 1)} ms`, score: v <= 5 ? 100 : v <= 15 ? 82 : v <= 30 ? 55 : 25,
      hint: v <= 5 ? 'Excelente' : v <= 15 ? 'Normal' : v <= 30 ? 'Alta para un salto local' : 'Muy alta',
    });
  }
  if (lat?.gateway?.lossPct != null) {
    const v = lat.gateway.lossPct;
    factors.push({
      name: 'Pérdida', val: `${num(v, 1)} %`, score: v === 0 ? 100 : v < 1 ? 85 : v < 3 ? 55 : 20,
      hint: v === 0 ? 'Sin pérdidas' : v < 3 ? 'Pérdida leve' : 'Pérdida notable',
    });
  }
  const rssi = wifi?.link?.rssi;
  if (rssi != null) {
    factors.push({
      name: 'Señal Wi-Fi', val: `${rssi} dBm`, score: rssi >= -55 ? 100 : rssi >= -67 ? 78 : rssi >= -75 ? 52 : 25,
      hint: rssi >= -55 ? 'Muy buena' : rssi >= -67 ? 'Buena' : rssi >= -75 ? 'Débil' : 'Muy débil',
    });
  }
  const score = factors.length >= 2 ? Math.round(factors.reduce((a, f) => a + f.score, 0) / factors.length) : null;
  return { score, factors, partial: factors.length === 1 };
}

/* ---------------- render ---------------- */
function render() {
  if (!state.data) return;
  const { network, system } = state.data;
  $('#net-name').textContent = state.data.state.wifi?.link?.ssid || network?.iface || 'Red local';
  $('#net-sub').textContent = network
    ? `${network.ip}/${network.prefix} · gateway ${network.gateway} · ${network.gatewayVendor || 'fabricante desconocido'}`
    : 'Sin interfaz de red';
  $('#agent-pill').classList.add('on');
  $('#agent-pill').classList.remove('off');
  $('#agent-pill span').textContent = `Agente activo · ${system?.hostname || ''}`;

  $$('#nav button, #bottom-nav button').forEach((b) => b.classList.toggle('active', b.dataset.route === state.route));

  const view = $('#view');
  switch (state.route) {
    case 'devices': view.innerHTML = viewDevices(); bindDevices(); break;
    case 'wifi': view.innerHTML = viewWifi(); bindWifi(); break;
    case 'security': view.innerHTML = viewSecurity(); bindSecurity(); break;
    case 'tests': view.innerHTML = viewTests(); bindTests(); break;
    case 'history': view.innerHTML = viewHistory(); bindHistory(); break;
    case 'router': view.innerHTML = viewRouter(); bindRouter(); break;
    default: view.innerHTML = viewOverview(); bindOverview();
  }
}

function viewOverview() {
  const h = health();
  const list = devices();
  const online = list.filter((d) => d.online).length;
  const lat = lastTest('latency');
  const speed = lastTest('speed');
  const wifi = state.data.state.wifi;
  const router = state.data.state.router;
  const gw = lat?.gateway;
  const pending = alerts().filter((a) => !a.ack);

  const scoreColor = h.score == null ? '#64748b' : h.score >= 80 ? 'var(--ok)' : h.score >= 55 ? 'var(--warn)' : 'var(--bad)';

  return `
  <div class="section">
    <div class="grid cols-4">
      ${kpi('Equipos en línea', online, 'en línea', list.length + ' en el inventario')}
      ${kpi('Latencia al router', gw?.p50 != null ? num(gw.p50, 1) : '—', 'ms · p95 ' + num(gw?.p95, 1), gw?.lossPct != null ? `${num(gw.lossPct, 1)} % de pérdida` : 'sin medición')}
      ${kpi('Señal Wi-Fi', wifi?.link?.rssi != null ? wifi.link.rssi : '—', 'dBm · ' + (wifi?.link?.band || 'sin banda'), wifi?.link?.rxMbps ? `${wifi.link.rxMbps} Mbps PHY` : '')}
      ${kpi('Bajada', speed?.downloadMbps != null ? num(speed.downloadMbps, 1) : '—', 'Mbps · ' + (speed ? 'medido' : 'sin prueba'), speed ? `subida ${num(speed.uploadMbps, 1)} Mbps` : 'ejecuta una prueba')}
    </div>
  </div>

  <div class="section grid cols-2">
    <div class="card">
      <div class="card-head"><div class="card-title">Estado de la red</div><span class="badge ${h.score == null ? (h.partial ? 'warn' : '') : h.score >= 80 ? 'ok' : h.score >= 55 ? 'warn' : 'bad'}">${h.score == null ? (h.partial ? 'Datos parciales' : 'Sin datos') : h.score >= 80 ? 'Saludable' : h.score >= 55 ? 'Mejorable' : 'Con problemas'}</span></div>
      <div class="card-body">
        ${h.score == null
          ? `<div class="empty">${h.partial ? 'Solo tengo la señal Wi-Fi. Falta medir la latencia para puntuar la red.' : 'Ejecuta una prueba de latencia para calcular el estado.'}<br><br><button class="btn primary small" data-go="tests">Ir a Pruebas</button></div>`
          : `<div class="health">
              <div class="score-ring" style="--pct:${h.score};--col:${scoreColor}">
                <div class="score-inner"><div class="score-num">${h.score}</div><div class="score-cap">de 100</div></div>
              </div>
              <div class="factors">
                ${h.factors.map((f) => `
                  <div class="factor">
                    <div class="factor-name">${esc(f.name)}</div>
                    <div class="factor-val">${esc(f.val)}</div>
                    <div class="factor-hint">${esc(f.hint)}</div>
                    <div class="factor-bar"><i style="width:${f.score}%;background:${f.score >= 80 ? 'var(--ok)' : f.score >= 55 ? 'var(--warn)' : 'var(--bad)'}"></i></div>
                  </div>`).join('')}
              </div>
            </div>
            <p class="note" style="margin-top:14px">La puntuación usa latencia local, pérdida y señal. La velocidad se muestra medida, no puntuada, porque depende de tu plan contratado.</p>`}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Topología observada</div><button class="btn ghost small" data-go="router">Ver router</button></div>
      <div class="card-body">
        <div class="path">
          <div class="path-row">
            <div class="path-role">Aguas arriba</div>
            <div class="path-main">${router?.ont?.ip ? 'ONT / salto 2' : 'Internet'}</div>
            <div class="path-meta">${router?.ont?.ip ? esc(router.ont.ip) + ' · ' + (router.ont.manageable ? 'web activa' : 'sin web') : 'vía gateway'}</div>
          </div>
          <div class="path-row">
            <div class="path-role">Gateway</div>
            <div class="path-main">${esc(router?.gateway?.vendor || 'Router principal')}</div>
            <div class="path-meta">${esc(state.data.network?.gateway || '—')}</div>
          </div>
          <div class="path-row">
            <div class="path-role">Enlace actual</div>
            <div class="path-main">${esc(wifi?.link?.ssid || 'Wi-Fi')}</div>
            <div class="path-meta">${wifi?.link?.band || '—'} · canal ${wifi?.link?.channel ?? '—'} · ${wifi?.link?.rssi ?? '—'} dBm</div>
          </div>
          <div class="path-row">
            <div class="path-role">Este equipo</div>
            <div class="path-main">${esc(state.data.system?.hostname || 'PC')}</div>
            <div class="path-meta">${esc(state.data.network?.ip || '')}</div>
          </div>
        </div>
        ${wifi?.recommendation ? `<p class="note" style="margin-top:14px">${esc(wifi.recommendation.reason)}</p>` : ''}
      </div>
    </div>
  </div>

  <div class="section grid cols-2">
    <div class="card">
      <div class="card-head"><div class="card-title">Alertas</div><span class="badge ${pending.length ? 'warn' : 'ok'}">${pending.length} pendientes</span></div>
      <div class="card-body">
        ${alerts().length ? `<div class="list">${alerts().slice(0, 6).map((a) => `
          <div class="list-item">
            <span class="badge ${a.severity === 'warn' ? 'warn' : 'info'}">${a.type === 'device.new' ? 'Nuevo' : 'Aviso'}</span>
            <div class="what"><b>${esc(a.title)}</b><span>${esc(a.detail)}</span></div>
            <div class="when">${a.ack ? 'visto' : `<button class="btn ghost small" data-ack="${a.id}">Marcar</button>`}</div>
          </div>`).join('')}</div>` : `<div class="empty">Sin alertas todavía.</div>`}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Actividad</div><span class="badge">${events().length} eventos</span></div>
      <div class="card-body">
        ${events().length ? `<div class="list">${events().slice(0, 7).map((e) => `
          <div class="list-item">
            <span class="badge ${e.type === 'device.new' ? 'accent' : ''}">${esc(e.type)}</span>
            <div class="what"><b>${esc(e.message)}</b></div>
            <div class="when">${ago(e.at)}</div>
          </div>`).join('')}</div>` : `<div class="empty">La actividad aparecerá aquí.</div>`}
      </div>
    </div>
  </div>`;
}

function bindOverview() {
  /* acciones delegadas en el listener global (data-go, data-ack) */
}

function kpi(label, value, unit, note) {
  return `<div class="card kpi">
    <div class="kpi-value">${esc(value)}<small>&nbsp;${esc(unit)}</small></div>
    <div class="kpi-label">${esc(label)}</div>
    <div class="kpi-note">${esc(note || '')}</div>
  </div>`;
}

/* ---------------- devices ---------------- */
function viewDevices() {
  const f = state.deviceFilter;
  const list = devices().filter((d) => {
    if (f.only === 'online' && !d.online) return false;
    if (f.only === 'offline' && d.online) return false;
    if (f.type !== 'all' && d.type !== f.type) return false;
    if (f.q) {
      const hay = `${d.name || ''} ${d.ip} ${d.vendor || ''} ${d.macMasked || ''} ${d.typeLabel || ''}`.toLowerCase();
      if (!hay.includes(f.q.toLowerCase())) return false;
    }
    return true;
  });
  const types = [...new Set(devices().map((d) => d.type))];

  return `
  <div class="section-head"><h2>Dispositivos</h2><p>${list.length} de ${devices().length} · evidencia por equipo</p></div>
  <div class="toolbar">
    <input class="input" id="dev-q" placeholder="Buscar nombre, IP, fabricante…" value="${esc(f.q)}" />
    <select class="select" id="dev-type">
      <option value="all">Todos los tipos</option>
      ${types.map((t) => `<option value="${t}" ${f.type === t ? 'selected' : ''}>${esc(typeLabel(t))}</option>`).join('')}
    </select>
    <select class="select" id="dev-only">
      <option value="all" ${f.only === 'all' ? 'selected' : ''}>Todos</option>
      <option value="online" ${f.only === 'online' ? 'selected' : ''}>En línea</option>
      <option value="offline" ${f.only === 'offline' ? 'selected' : ''}>No vistos</option>
    </select>
    <div class="spacer"></div>
    <span class="note">MAC completa nunca sale del agente</span>
  </div>
  <div class="table-wrap">
    <table class="data">
      <thead><tr><th>Equipo</th><th>Tipo</th><th>IP</th><th>Fabricante</th><th>Estado</th><th>Última vez</th></tr></thead>
      <tbody>
        ${list.map((d) => `
          <tr data-dev="${d.id}">
            <td><div class="cell-main">${TYPE_ICON[d.type] || '·'} ${esc(d.name || 'Sin nombre')}</div><div class="cell-sub mono">${esc(d.macMasked || 'MAC no vista')}</div></td>
            <td><span class="badge">${esc(d.typeLabel || typeLabel(d.type))}</span><div class="cell-sub">confianza ${esc(CONF[d.confidence]?.[0] || d.confidence)}</div></td>
            <td class="mono">${esc(d.ip)}</td>
            <td>${esc(d.vendor || '—')}</td>
            <td>${d.online ? '<span class="badge ok">En línea</span>' : '<span class="badge">No visto</span>'}</td>
            <td class="cell-sub">${ago(d.lastSeen)}</td>
          </tr>`).join('') || `<tr><td colspan="6"><div class="empty">Sin resultados.</div></td></tr>`}
      </tbody>
    </table>
  </div>`;
}

function bindDevices() {
  $('#dev-q')?.addEventListener('input', (e) => { state.deviceFilter.q = e.target.value; render(); $('#dev-q')?.focus(); });
  $('#dev-type')?.addEventListener('change', (e) => { state.deviceFilter.type = e.target.value; render(); });
  $('#dev-only')?.addEventListener('change', (e) => { state.deviceFilter.only = e.target.value; render(); });
  $$('#view tr[data-dev]').forEach((tr) => tr.addEventListener('click', () => openDevice(tr.dataset.dev)));
}

function typeLabel(t) {
  return ({ router: 'Router / red', mobile: 'Móvil', computer: 'Computador', tv: 'TV / streaming', console: 'Consola', printer: 'Impresora', iot: 'IoT', network: 'Equipo de red', unknown: 'Desconocido' })[t] || t;
}

async function openDevice(id) {
  const d = devices().find((x) => x.id === id);
  if (!d) return;
  $('#drawer').hidden = false;
  $('#scrim').hidden = false;
  $('#drawer-eyebrow').textContent = d.typeLabel || 'Dispositivo';
  $('#drawer-title').textContent = d.name || d.ip;
  $('#drawer-body').innerHTML = `
    <div class="card"><div class="card-body">
      <dl class="kv">
        <dt>Dirección IP</dt><dd class="mono">${esc(d.ips?.join(', ') || d.ip)}</dd>
        <dt>MAC (parcial)</dt><dd class="mono">${esc(d.macMasked || 'no observada')}</dd>
        <dt>Fabricante</dt><dd>${esc(d.vendor || 'desconocido')}</dd>
        <dt>Tipo estimado</dt><dd>${esc(d.typeLabel)} <span class="badge ${CONF[d.confidence]?.[1] || ''}">confianza ${esc(CONF[d.confidence]?.[0] || d.confidence)}</span></dd>
        <dt>TTL</dt><dd>${d.ttl ?? '—'}</dd>
        <dt>RTT</dt><dd>${d.rttMs != null ? d.rttMs + ' ms' : '—'}</dd>
        <dt>Primera vez</dt><dd>${clock(d.firstSeen)}</dd>
        <dt>Última vez</dt><dd>${clock(d.lastSeen)}</dd>
        <dt>Métodos</dt><dd>${(d.method || []).map((m) => `<span class="badge">${esc(m)}</span>`).join(' ') || '—'}</dd>
      </dl>
    </div></div>

    <div>
      <div class="eyebrow" style="margin-bottom:8px">Por qué creo que es esto</div>
      <div class="reasons">${(d.reasons || []).map((r) => `<div class="reason">${esc(r)}</div>`).join('') || '<div class="reason">Sin evidencia suficiente</div>'}</div>
    </div>

    ${d.ssdp?.friendlyName ? `
      <div>
        <div class="eyebrow" style="margin-bottom:8px">UPnP / SSDP</div>
        <dl class="kv">
          <dt>Nombre</dt><dd>${esc(d.ssdp.friendlyName)}</dd>
          <dt>Fabricante</dt><dd>${esc(d.ssdp.manufacturer || '—')}</dd>
          <dt>Modelo</dt><dd>${esc(d.ssdp.modelName || '—')}</dd>
          <dt>Tipo</dt><dd class="mono">${esc(d.ssdp.deviceType || '—')}</dd>
        </dl>
      </div>` : ''}

    <div class="hr"></div>
    <div>
      <div class="eyebrow" style="margin-bottom:8px">Corregir identificación</div>
      <div class="grid" style="gap:10px">
        <input class="input" id="dev-name" placeholder="Nombre" value="${esc(d.name || '')}" />
        <select class="select" id="dev-edit-type">
          ${Object.keys(TYPE_ICON).map((t) => `<option value="${t}" ${d.type === t ? 'selected' : ''}>${esc(typeLabel(t))}</option>`).join('')}
        </select>
        <button class="btn primary" id="dev-save">Guardar cambios</button>
        <p class="note">Tu corrección tiene prioridad sobre la estimación automática.</p>
      </div>
    </div>

    <div class="card"><div class="card-body">
      <div class="eyebrow">Acciones del router</div>
      <p class="note" style="margin-top:8px">${state.data.state.router?.family === 'fiberhome'
        ? 'Este router no expone bloqueo por API. NetPilot no puede bloquearlo desde aquí.'
        : 'El bloqueo no está habilitado en este MVP; requiere un adaptador con escritura.'}</p>
      <button class="btn" disabled style="margin-top:10px">Bloquear dispositivo</button>
    </div></div>`;

  $('#dev-save').onclick = async () => {
    await api(`/api/devices/${id}`, { method: 'PATCH', body: JSON.stringify({ name: $('#dev-name').value.trim(), type: $('#dev-edit-type').value }) });
    closeDrawer();
    await refresh();
    toast('Cambios guardados', 'La identificación manual prevalece');
  };
}

function closeDrawer() {
  $('#drawer').hidden = true;
  $('#scrim').hidden = true;
}

/* ---------------- wifi ---------------- */
function viewWifi() {
  const wifi = state.data.state.wifi;
  if (!wifi) return `<div class="empty">Sin datos de Wi-Fi. Pulsa «Escanear red».</div>`;
  const l = wifi.link;
  const pct = l.rssi != null ? Math.max(0, Math.min(100, Math.round(((l.rssi + 90) / 60) * 100))) : 0;
  const col = pct >= 75 ? 'var(--ok)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)';
  const band = state.wifiBand || (l?.band && /2[.,]?4/.test(l.band) ? '2.4' : '5');
  const channels = wifi.channels?.[band] || [];
  const maxU = Math.max(20, ...channels.map((c) => c.utilization));
  const rec = wifi.recommendation;
  const isCur = (c) => (band === '2.4' ? c.channel === l.channel : (l.channel >= c.start && l.channel <= c.end));
  const nets = (wifi.networks || []).filter((n) => (band === '2.4' ? /2[.,]?4/.test(n.band || '') || (n.channel && n.channel <= 14) : !(n.channel && n.channel <= 14)));

  return `
  <div class="section-head"><h2>Wi-Fi</h2><p>${esc(l.ssid || '—')} · ${esc(l.radio || '')}</p></div>

  <div class="grid cols-3 section">
    <div class="card">
      <div class="card-head"><div class="card-title">Enlace actual</div><span class="badge ${l.connected ? 'ok' : 'bad'}">${l.connected ? 'Conectado' : l.state || '—'}</span></div>
      <div class="card-body">
        <div class="gauge">
          <div class="gauge-dial" style="--pct:${pct};--col:${col}">
            <div class="gauge-val"><b>${l.rssi ?? '—'}</b><span>dBm</span></div>
          </div>
          <dl class="kv" style="grid-template-columns:auto 1fr">
            <dt>Banda</dt><dd>${esc(l.band || '—')}</dd>
            <dt>Canal</dt><dd>${l.channel ?? '—'}</dd>
            <dt>PHY</dt><dd>${l.rxMbps ?? '—'} Mbps</dd>
            <dt>Señal</dt><dd>${l.signalPct ?? '—'} %</dd>
          </dl>
        </div>
        <p class="note" style="margin-top:14px">${esc(l.adapter || '')}</p>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Canal recomendado</div><span class="badge ${rec?.shouldChange ? 'warn' : 'ok'}">${rec?.shouldChange ? 'Conviene revisar' : 'Sin cambios'}</span></div>
      <div class="card-body">
        <div class="kpi-value">${esc(rec?.shouldChange ? rec.best : (rec?.current ?? '—'))}<small>&nbsp;${rec?.shouldChange ? 'recomendado' : 'actual'}</small></div>
        <p class="note" style="margin-top:8px">${esc(rec?.reason || 'Sin datos de canales.')}</p>
        <p class="note" style="margin-top:8px">${esc(rec?.note || '')}</p>
        ${rec?.shouldChange ? `<p class="note" style="margin-top:8px">Alternativas: ${(rec?.alternatives || []).join(', ') || '—'}.</p>` : ''}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Seguridad y capacidades</div></div>
      <div class="card-body">
        <dl class="kv" style="grid-template-columns:auto 1fr">
          <dt>Autenticación</dt><dd>${esc(l.auth || '—')}</dd>
          <dt>Cifrado</dt><dd>${esc(l.cipher || '—')}</dd>
          <dt>Perfil</dt><dd>${esc(l.profile || '—')}</dd>
          <dt>Vecinos</dt><dd>${(wifi.networks || []).length} redes</dd>
        </dl>
        <p class="note" style="margin-top:12px">Los datos provienen de WlanAPI. Si el driver no expone ocupación, NetPilot lo indica en lugar de inventarla.</p>
      </div>
    </div>
  </div>

  <div class="card section">
    <div class="card-head">
      <div class="card-title">Ocupación por canal</div>
      <div class="pill" style="border-color:var(--line);color:var(--muted);background:transparent">
        <button class="btn ghost small" data-band="2.4" style="${band === '2.4' ? 'color:var(--accent)' : ''}">2,4 GHz</button>
        <button class="btn ghost small" data-band="5" style="${band === '5' ? 'color:var(--accent)' : ''}">5 GHz</button>
      </div>
    </div>
    <div class="card-body">
      <div class="bars">
        ${channels.map((c) => {
          const height = Math.max(3, Math.round((c.utilization / maxU) * 100));
          const cls = isCur(c) ? 'current' : (rec && String(c.label) === String(rec.best)) ? 'best' : '';
          return `<div class="bar-col" title="${band === '5' ? 'Bloque' : 'Canal'} ${c.label}: ${c.aps} AP(s), ${Math.round(c.utilization)}% estimado">
            <div class="bar ${cls}" style="height:${height}%"></div>
            <div class="bar-label">${esc(c.label)}</div>
          </div>`;
        }).join('')}
      </div>
      <div class="bars-legend">
        <span><i class="legend-dot" style="background:#1d7ea8"></i>Canal actual</span>
        <span><i class="legend-dot" style="background:#15803d"></i>Recomendado</span>
        <span><i class="legend-dot" style="background:#24313f"></i>Otros</span>
        <span class="spacer"></span>
        <span>${band === '2.4' ? 'Canales 1 / 6 / 11' : 'Bloques de 80 MHz'}</span>
      </div>
    </div>
  </div>

  <div class="section-head"><h2>Redes cercanas</h2><p>${nets.length} en ${band} GHz</p></div>
  <div class="table-wrap">
    <table class="data">
      <thead><tr><th>SSID</th><th>Banda</th><th>Canal</th><th>Señal</th><th>Radio</th><th>Estaciones</th><th>Uso</th></tr></thead>
      <tbody>
        ${nets.sort((a, b) => (b.signalPct ?? 0) - (a.signalPct ?? 0)).map((n) => `
          <tr>
            <td class="cell-main">${esc(n.ssid)}${n.current ? ' <span class="badge accent">actual</span>' : ''}</td>
            <td>${esc(n.band || '—')}</td>
            <td class="mono">${n.channel ?? '—'}</td>
            <td>${n.signalPct != null ? n.signalPct + ' %' : '—'}</td>
            <td>${esc(n.radio || '—')}</td>
            <td>${n.stations ?? '—'}</td>
            <td>${n.utilization != null ? n.utilization + ' %' : '—'}</td>
          </tr>`).join('') || `<tr><td colspan="7"><div class="empty">Sin redes en esta banda.</div></td></tr>`}
      </tbody>
    </table>
  </div>`;
}

function bindWifi() {
  $$('#view [data-band]').forEach((b) => b.addEventListener('click', () => { state.wifiBand = b.dataset.band; render(); }));
  refreshWifiIfStale();
}

let wifiRefreshAt = 0;
async function refreshWifiIfStale() {
  if (Date.now() - wifiRefreshAt < 30000) return;
  wifiRefreshAt = Date.now();
  try {
    const w = await api('/api/wifi?refresh=1');
    state.data.state.wifi = w;
    render();
  } catch {}
}

/* ---------------- tests ---------------- */
function viewTests() {
  const lat = lastTest('latency');
  const dns = lastTest('dns');
  const sp = lastTest('speed');

  return `
  <div class="section-head"><h2>Pruebas</h2><p>Mediciones desde este agente; incluyen tu enlace Wi-Fi</p></div>

  <div class="grid cols-3 section">
    <div class="card">
      <div class="card-head"><div class="card-title">Latencia y pérdida</div><button class="btn primary small" id="run-latency" ${state.busy.latency ? 'disabled' : ''}>${state.busy.latency ? 'Midiendo…' : 'Medir'}</button></div>
      <div class="card-body">
        ${lat ? `
          <div class="grid cols-2" style="gap:10px">
            ${miniKpi('Router p50', lat.gateway?.p50, 'ms')}
            ${miniKpi('Router p95', lat.gateway?.p95, 'ms')}
            ${miniKpi('Internet p50', lat.internet?.p50, 'ms')}
            ${miniKpi('Pérdida', lat.gateway?.lossPct, '%')}
          </div>
          <p class="note" style="margin-top:12px">Jitter local: ${num(lat.gateway?.jitter, 1)} ms · ${clock(lat.at)}</p>
        ` : '<div class="empty">Sin medición. Pulsa «Medir».</div>'}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">DNS</div><button class="btn primary small" id="run-dns" ${state.busy.dns ? 'disabled' : ''}>${state.busy.dns ? 'Midiendo…' : 'Medir'}</button></div>
      <div class="card-body">
        ${dns ? `
          <div class="grid cols-2" style="gap:10px">
            ${miniKpi('Router', dns.system?.p50, 'ms')}
            ${miniKpi('8.8.8.8', dns.public?.p50, 'ms')}
          </div>
          <p class="note" style="margin-top:12px">${dns.system?.fails || 0} fallos con el resolver del sistema. Cambiar DNS solo si la diferencia es clara y estable.</p>
        ` : '<div class="empty">Compara el resolver del router con uno público sin cambiar la configuración.</div>'}
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Velocidad</div><button class="btn primary small" id="run-speed" ${state.busy.speed ? 'disabled' : ''}>${state.busy.speed ? 'Midiendo…' : 'Medir'}</button></div>
      <div class="card-body">
        ${sp ? `
          <div class="grid cols-2" style="gap:10px">
            ${miniKpi('Bajada', sp.downloadMbps, 'Mbps')}
            ${miniKpi('Subida', sp.uploadMbps, 'Mbps')}
            ${miniKpi('Latencia en reposo', sp.idleLatency, 'ms')}
            ${miniKpi('Latencia bajo carga', sp.loadedLatency, 'ms')}
          </div>
          <p class="note" style="margin-top:12px">Bufferbloat: ${sp.bufferbloatMs != null ? `${sp.bufferbloatMs > 0 ? '+' : ''}${sp.bufferbloatMs} ms` : '—'} · servidor ${esc(sp.server)} · medición puntual, puede variar</p>
          ${(sp.warnings || []).length ? `<p class="note warn" style="margin-top:8px">${sp.warnings.map((w) => esc(w)).join('<br>')}</p>` : ''}
        ` : '<div class="empty">Mide bajada, subida y el efecto de la carga sobre la latencia.</div>'}
      </div>
    </div>
  </div>

  <div class="section-head"><h2>Historial</h2><p>Últimas mediciones guardadas localmente</p></div>
  <div class="table-wrap">
    <table class="data">
      <thead><tr><th>Cuándo</th><th>Prueba</th><th>Resultado</th><th>Detalle</th></tr></thead>
      <tbody>
        ${historyRows()}
      </tbody>
    </table>
  </div>`;
}

function miniKpi(label, value, unit) {
  return `<div class="card" style="box-shadow:none;background:var(--panel-2)">
    <div style="padding:10px 12px">
      <div class="kpi-value" style="font-size:20px">${value == null ? '—' : num(value, 1)}<small>&nbsp;${esc(unit)}</small></div>
      <div class="kpi-label">${esc(label)}</div>
    </div>
  </div>`;
}

function historyRows() {
  const t = state.data.state.tests;
  const rows = [
    ...t.latency.map((x) => ({ at: x.at, kind: 'Latencia', main: `${num(x.gateway?.p50, 1)} ms`, detail: `pérdida ${num(x.gateway?.lossPct, 1)} %` })),
    ...t.dns.map((x) => ({ at: x.at, kind: 'DNS', main: `${num(x.system?.p50, 1)} ms`, detail: `público ${num(x.public?.p50, 1)} ms` })),
    ...t.speed.map((x) => ({ at: x.at, kind: 'Velocidad', main: `${num(x.downloadMbps, 1)} / ${num(x.uploadMbps, 1)}`, detail: 'Mbps bajada / subida' })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 12);
  if (!rows.length) return `<tr><td colspan="4"><div class="empty">Aún no hay mediciones.</div></td></tr>`;
  return rows.map((r) => `<tr><td class="cell-sub">${clock(r.at)}</td><td>${r.kind}</td><td class="mono cell-main">${r.main}</td><td class="cell-sub">${r.detail}</td></tr>`).join('');
}

function bindTests() {
  $('#run-latency')?.addEventListener('click', () => runTest('latency', 'Midiendo latencia'));
  $('#run-dns')?.addEventListener('click', () => runTest('dns', 'Midiendo DNS'));
  $('#run-speed')?.addEventListener('click', () => runTest('speed', 'Midiendo velocidad'));
}

async function runTest(kind, label) {
  if (state.busy[kind]) return;
  state.busy[kind] = true;
  render();
  try {
    const job = await api(`/api/tests/${kind}`, { method: 'POST' });
    await pollJob(job.id);
    toast(label, 'Listo');
    await refresh();
  } catch (e) {
    toast('No se pudo completar', e.message);
  } finally {
    state.busy[kind] = false;
    render();
  }
}

/* ---------------- security ---------------- */

const SEC_CHECKS = [
  ['wps', 'WPS desactivado'],
  ['admin', 'Contraseña del panel cambiada'],
  ['firmware', 'Firmware actualizado'],
  ['guest', 'Red de invitados para IoT'],
  ['devices', 'Revisé los equipos conectados'],
];

const COMMON_PASSWORDS = [
  '123456', '12345678', '123456789', '1234567890', 'password', 'contrasena', 'contraseña',
  'qwerty', 'admin', 'clave', 'wifi', 'internet', 'claro', 'fiberhome', 'hogar', 'familia',
  'casa', 'amor', 'teamo', 'colombia', 'bogota', 'medellin', 'cali', 'verano', 'invierno',
  'primavera', 'otono', 'cumple', 'mama', 'papa', '000000', '111111', 'abc123', 'iloveyou',
  'welcome', 'monkey', 'dragon', 'master', 'shadow', 'superman', 'football', 'princess',
  'sunshine', 'letmein', 'passw0rd',
];

function readChecks() {
  try { return JSON.parse(localStorage.getItem('netpilot.security') || '{}') || {}; } catch { return {}; }
}
function writeChecks(c) {
  try { localStorage.setItem('netpilot.security', JSON.stringify(c)); } catch {}
}

function humanTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  if (seconds < 1) return 'menos de un segundo';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  if (seconds < 31536000) return `${Math.round(seconds / 86400)} días`;
  const years = seconds / 31536000;
  if (years < 1000) return `${Math.round(years)} años`;
  if (years < 1e6) return `${Math.round(years / 1000)} mil años`;
  if (years < 1e9) return `${Math.round(years / 1e6)} millones de años`;
  return 'más de mil millones de años';
}

function estimatePassword(pw) {
  if (!pw) return null;
  const low = pw.toLowerCase();
  let charset = 0;
  if (/[a-z]/.test(pw)) charset += 26;
  if (/[A-Z]/.test(pw)) charset += 26;
  if (/\d/.test(pw)) charset += 10;
  if (/[^A-Za-z0-9]/.test(pw)) charset += 33;
  let bits = pw.length * Math.log2(Math.max(charset, 1));
  const notes = [];
  if (COMMON_PASSWORDS.some((w) => low === w || (w.length >= 5 && low.includes(w)))) {
    bits = Math.min(bits, 16);
    notes.push('contiene una clave común');
  }
  if (/^\d+$/.test(pw)) { bits = Math.min(bits, pw.length * 3.3); notes.push('solo números'); }
  if (/(.)\1{2,}/.test(pw)) { bits -= 8; notes.push('repeticiones'); }
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwerty|asdf)/i.test(pw)) { bits -= 8; notes.push('secuencia predecible'); }
  if (/(19|20)\d{2}/.test(pw)) { bits -= 6; notes.push('contiene un año'); }
  if (pw.length < 8) { bits -= 10; notes.push('muy corta'); }
  bits = Math.max(0, Math.round(bits));
  const seconds = Math.pow(2, bits) / 1e6;
  const verdict = bits < 40 ? ['débil', 'bad'] : bits < 60 ? ['aceptable', 'warn'] : bits < 80 ? ['fuerte', 'ok'] : ['muy fuerte', 'ok'];
  return { bits, seconds, verdict, notes };
}

function viewSecurity() {
  const s = state.data.security;
  if (!s) return '<div class="empty">Sin datos de seguridad todavía. Pulsa «Escanear red».</div>';
  const link = state.data.state.wifi?.link;
  const checks = readChecks();
  const done = SEC_CHECKS.filter(([k]) => checks[k]).length;
  const color = s.score >= 85 ? 'var(--ok)' : s.score >= 65 ? 'var(--warn)' : 'var(--bad)';
  const sev = {
    high: ['Alto', 'bad'], medium: ['Medio', 'warn'], low: ['Bajo', 'info'],
    info: ['Info', ''], ok: ['OK', 'ok'], unknown: ['—', ''],
  };
  const highs = s.findings.filter((f) => f.severity === 'high').length;
  const meds = s.findings.filter((f) => f.severity === 'medium').length;

  return `
  <div class="section-head"><h2>Seguridad Wi-Fi</h2><p>${esc(s.method)}</p></div>

  <div class="grid cols-2 section">
    <div class="card"><div class="card-body" style="display:flex;gap:18px;align-items:center">
      <div class="score-ring" style="--pct:${s.score};--col:${color};width:118px;height:118px;flex:0 0 auto">
        <div class="score-inner"><div class="score-num" style="font-size:30px">${s.score}</div><div class="score-cap">de 100</div></div>
      </div>
      <div>
        <div class="eyebrow">Nivel</div>
        <div style="font-size:22px;font-weight:700;text-transform:capitalize">${esc(s.level)}</div>
        <p class="note" style="margin-top:6px">${highs} alto(s) · ${meds} medio(s) · ${s.stats.neighbors} BSSID visibles</p>
        <p class="note">Checklist: <span id="sec-check-count">${done}</span>/5 completado</p>
      </div>
    </div></div>

    <div class="card"><div class="card-head"><div class="card-title">Tu red</div></div><div class="card-body">
      <dl class="kv">
        <dt>SSID</dt><dd>${esc(link?.ssid || '—')}</dd>
        <dt>Autenticación</dt><dd>${esc(link?.auth || '—')}</dd>
        <dt>Cifrado</dt><dd>${esc(link?.cipher || '—')}</dd>
        <dt>Banda / canal</dt><dd>${esc(link?.band || '—')} · ${link?.channel ?? '—'}</dd>
        <dt>WPA3</dt><dd>${/wpa3|sae/i.test(link?.auth || '') ? '<span class="badge ok">Sí</span>' : '<span class="badge warn">No anunciado</span>'}</dd>
        <dt>PMF / WPS</dt><dd>No verificable desde Windows</dd>
      </dl>
    </div></div>
  </div>

  <div class="section-head"><h2>Hallazgos</h2><p>Pasivos, con evidencia</p></div>
  <div class="list section">
    ${s.findings.map((f) => {
      const [label, cls] = sev[f.severity] || sev.info;
      return `<div class="list-item">
        <span class="badge ${cls}">${label}</span>
        <div class="what">
          <b>${esc(f.title)}</b>
          <span>${esc(f.detail)}</span>
          ${f.evidence ? `<span class="mono" style="font-size:11px;color:var(--muted-2)">${esc(f.evidence)}</span>` : ''}
          ${f.action ? `<span style="color:var(--accent);font-size:12px">→ ${esc(f.action)}</span>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>

  <div class="grid cols-2 section">
    <div class="card">
      <div class="card-head"><div class="card-title">Fortaleza de la clave</div><span class="badge">Local</span></div>
      <div class="card-body">
        <p class="note" style="margin-top:0">Se calcula en tu navegador. No se envía al agente, no se guarda y no se registra.</p>
        <div class="toolbar" style="margin-top:10px">
          <input class="input" id="pw-input" type="password" autocomplete="off" spellcheck="false" placeholder="Escribe una clave para estimarla" />
          <button class="btn small" id="pw-toggle">Ver</button>
        </div>
        <div id="pw-out" class="note" style="margin-top:10px">Sin evaluar.</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Checklist</div><span class="badge" id="sec-check-badge">${done}/5</span></div>
      <div class="card-body" style="padding-top:6px">
        ${SEC_CHECKS.map(([k, label]) => `<label class="check-row"><input type="checkbox" data-check="${k}" ${checks[k] ? 'checked' : ''}/><span>${esc(label)}</span></label>`).join('')}
        <p class="note" style="margin-top:10px">Se guarda solo en este navegador (localStorage).</p>
      </div>
    </div>
  </div>

  <p class="note">Este módulo no captura handshakes, no hace deauth y no prueba contraseñas. Solo interpreta lo que el sistema ya reporta y te dice qué revisar.</p>`;
}

function bindSecurity() {
  const input = $('#pw-input');
  const out = $('#pw-out');
  const update = () => {
    const r = estimatePassword(input?.value || '');
    if (!r) { out.innerHTML = 'Sin evaluar.'; return; }
    out.innerHTML = `<span class="badge ${r.verdict[1]}">${esc(r.verdict[0])}</span> ~${r.bits} bits · ${esc(humanTime(r.seconds))} a 1 M intentos/s`
      + (r.notes.length ? `<br><span style="color:var(--warn)">${r.notes.map(esc).join(' · ')}</span>` : '')
      + `<br><span class="note">Estimación aproximada; los diccionarios reales pueden acortar el tiempo.</span>`;
  };
  input?.addEventListener('input', update);
  $('#pw-toggle')?.addEventListener('click', () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('#pw-toggle').textContent = show ? 'Ocultar' : 'Ver';
  });
  $$('#view [data-check]').forEach((cb) => cb.addEventListener('change', () => {
    const c = readChecks();
    c[cb.dataset.check] = cb.checked;
    writeChecks(c);
    const done = SEC_CHECKS.filter(([k]) => c[k]).length;
    $('#sec-check-badge').textContent = `${done}/5`;
    $('#sec-check-count').textContent = String(done);
  }));
}

/* ---------------- history ---------------- */

function svgLines(series, { unit = '', height = 150 } = {}) {
  const points = series.flatMap((s) => s.points || []);
  if (!points.length) return '<div class="empty">Sin datos todavía. Ejecuta una prueba o guarda un estado.</div>';
  const W = 520, H = height, P = { l: 42, r: 10, t: 12, b: 22 };
  const xs = points.map((p) => +new Date(p.t));
  const ys = points.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (minY === maxY) { minY = Math.max(0, minY - 1); maxY += 1; }
  const spanX = maxX - minX || 1;
  const sx = (t) => P.l + ((+new Date(t) - minX) / spanX) * (W - P.l - P.r);
  const sy = (v) => P.t + (1 - (v - minY) / (maxY - minY || 1)) * (H - P.t - P.b);
  const grid = [0, 0.5, 1].map((f) => {
    const y = P.t + f * (H - P.t - P.b);
    const val = maxY - (maxY - minY) * f;
    return `<line x1="${P.l}" y1="${y.toFixed(1)}" x2="${W - P.r}" y2="${y.toFixed(1)}" stroke="#1e2a36" stroke-width="1"/>` +
      `<text x="4" y="${(y + 4).toFixed(1)}" fill="#64748b" font-size="10">${Math.round(val * 10) / 10}</text>`;
  }).join('');
  const paths = series.map((s) => {
    const pts = [...(s.points || [])].sort((a, b) => +new Date(a.t) - +new Date(b.t));
    if (!pts.length) return '';
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.t).toFixed(1)},${sy(p.v).toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
      `<circle cx="${sx(last.t).toFixed(1)}" cy="${sy(last.v).toFixed(1)}" r="3" fill="${s.color}"/>`;
  }).join('');
  const t0 = new Date(minX).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
  const t1 = new Date(maxX).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" role="img">
    ${grid}${paths}
    <text x="${P.l}" y="${H - 4}" fill="#64748b" font-size="10">${t0}</text>
    <text x="${W - P.r}" y="${H - 4}" text-anchor="end" fill="#64748b" font-size="10">${t1}</text>
    ${unit ? `<text x="${W - P.r}" y="${P.t + 8}" text-anchor="end" fill="#64748b" font-size="10">${esc(unit)}</text>` : ''}
  </svg>`;
}

function legend(series) {
  return `<div class="bars-legend">${series.map((s) => `<span><i class="legend-dot" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

function compareMetrics(a, b) {
  const rows = [];
  const add = (label, unit, av, bv, better, digits = 1) => {
    if (av == null && bv == null) return;
    let verdict = 'sin datos';
    let d = null;
    if (av != null && bv != null) {
      d = bv - av;
      const rel = Math.abs(d) / (Math.abs(av) || 1);
      if (rel < 0.05 || better === 'neutral') verdict = 'igual';
      else verdict = (better === 'lower' ? d < 0 : d > 0) ? 'mejor' : 'peor';
    }
    rows.push({ label, unit, a: av, b: bv, d, verdict, digits });
  };
  add('Latencia p50', 'ms', a?.latency?.p50, b?.latency?.p50, 'lower');
  add('Latencia p95', 'ms', a?.latency?.p95, b?.latency?.p95, 'lower');
  add('Pérdida', '%', a?.latency?.loss, b?.latency?.loss, 'lower');
  add('Jitter', 'ms', a?.latency?.jitter, b?.latency?.jitter, 'lower');
  add('Internet p50', 'ms', a?.latency?.inet, b?.latency?.inet, 'lower');
  add('Bajada', 'Mbps', a?.speed?.down, b?.speed?.down, 'higher');
  add('Subida', 'Mbps', a?.speed?.up, b?.speed?.up, 'higher');
  add('Bufferbloat', 'ms', a?.speed?.bufferbloat, b?.speed?.bufferbloat, 'lower');
  add('Señal', 'dBm', a?.wifi?.rssi, b?.wifi?.rssi, 'higher');
  add('PHY', 'Mbps', a?.wifi?.phy, b?.wifi?.phy, 'higher');
  add('Equipos en línea', '', a?.devices?.online, b?.devices?.online, 'neutral', 0);
  return rows;
}

function cmpRow(r) {
  const fmt = (v) => (v == null ? '—' : `${num(v, r.digits)}${r.unit ? ' ' + r.unit : ''}`);
  const cls = r.verdict === 'mejor' ? 'ok' : r.verdict === 'peor' ? 'bad' : '';
  const delta = r.d == null ? '—' : `${r.d > 0 ? '+' : ''}${num(r.d, r.digits)}${r.unit ? ' ' + r.unit : ''}`;
  return `<tr>
    <td>${esc(r.label)}</td>
    <td class="mono">${fmt(r.a)}</td>
    <td class="mono">${fmt(r.b)}</td>
    <td class="mono">${delta}</td>
    <td><span class="badge ${cls}">${esc(r.verdict)}</span></td>
  </tr>`;
}

function viewHistory() {
  const st = state.data.state;
  const tests = st.tests || {};
  const snaps = st.snapshots || [];
  const cur = state.data.current || state.data.state.current || null;
  const sel = { ...state.historySel };
  if (!snaps.some((s) => s.id === sel.b) && sel.b !== 'current') sel.b = snaps[0]?.id || 'current';
  if (sel.a === sel.b && snaps.length) sel.b = snaps[0].id;
  const byId = (id) => (id === 'current' ? cur : snaps.find((s) => s.id === id)?.metrics) || null;
  const A = byId(sel.a);
  const B = byId(sel.b);
  const rows = compareMetrics(A, B);
  const better = rows.filter((r) => r.verdict === 'mejor').length;
  const worse = rows.filter((r) => r.verdict === 'peor').length;

  const latSeries = [{ name: 'p50', color: '#2dd4bf', points: (tests.latency || []).map((x) => ({ t: x.at, v: x.gateway?.p50 })).filter((p) => p.v != null) }];
  const lossSeries = [{ name: 'pérdida', color: '#f87171', points: (tests.latency || []).map((x) => ({ t: x.at, v: x.gateway?.lossPct })).filter((p) => p.v != null) }];
  const speedSeries = [
    { name: 'Bajada', color: '#38bdf8', points: (tests.speed || []).map((x) => ({ t: x.at, v: x.downloadMbps })).filter((p) => p.v != null) },
    { name: 'Subida', color: '#fbbf24', points: (tests.speed || []).map((x) => ({ t: x.at, v: x.uploadMbps })).filter((p) => p.v != null) },
  ];
  const devSeries = [{ name: 'equipos', color: '#34d399', points: (st.scans || []).map((x) => ({ t: x.at, v: x.online })).filter((p) => p.v != null) }];

  return `
  <div class="section-head"><h2>Historial</h2><p>Mediciones locales y estados guardados</p></div>
  <div class="toolbar">
    <input class="input" id="snap-label" placeholder="Etiqueta (ej. antes de cablear)" />
    <button class="btn primary small" id="snap-save">Guardar estado actual</button>
    <div class="spacer"></div>
    <a class="btn small" href="/api/export?format=csv" download>Exportar CSV</a>
    <a class="btn small" href="/api/export?format=json" download>Exportar JSON</a>
  </div>

  <div class="grid cols-2 section">
    <div class="card"><div class="card-head"><div class="card-title">Latencia al router (p50)</div><span class="badge">ms</span></div><div class="card-body">${svgLines(latSeries, { unit: 'ms' })}</div></div>
    <div class="card"><div class="card-head"><div class="card-title">Velocidad</div><span class="badge">Mbps</span></div><div class="card-body">${svgLines(speedSeries)}${legend(speedSeries)}</div></div>
    <div class="card"><div class="card-head"><div class="card-title">Pérdida de paquetes</div><span class="badge">%</span></div><div class="card-body">${svgLines(lossSeries, { unit: '%' })}</div></div>
    <div class="card"><div class="card-head"><div class="card-title">Equipos en línea</div><span class="badge">por escaneo</span></div><div class="card-body">${svgLines(devSeries)}</div></div>
  </div>

  <div class="section-head"><h2>Comparar</h2><p>${A && B ? `${better} mejor · ${worse} peor · ${rows.length - better - worse} igual o sin datos` : 'Elige dos estados'}</p></div>
  <div class="toolbar">
    <select class="select" id="cmp-a">${cmpOptions(sel.a, snaps)}</select>
    <span class="note">vs</span>
    <select class="select" id="cmp-b">${cmpOptions(sel.b, snaps)}</select>
  </div>
  <div class="table-wrap section">
    <table class="data">
      <thead><tr><th>Métrica</th><th>Antes</th><th>Después</th><th>Cambio</th><th>Veredicto</th></tr></thead>
      <tbody>${rows.map(cmpRow).join('') || `<tr><td colspan="5"><div class="empty">Sin datos comparables. Guarda dos estados con mediciones.</div></td></tr>`}</tbody>
    </table>
  </div>

  <div class="section-head"><h2>Estados guardados</h2><p>${snaps.length} de 50 · solo local</p></div>
  <div class="table-wrap">
    <table class="data">
      <thead><tr><th>Etiqueta</th><th>Fecha</th><th>Latencia</th><th>Bajada</th><th>Señal</th><th></th></tr></thead>
      <tbody>${snaps.map(snapRow).join('') || `<tr><td colspan="6"><div class="empty">Aún no has guardado estados. Pulsa «Guardar estado actual».</div></td></tr>`}</tbody>
    </table>
  </div>
  <p class="note" style="margin-top:10px">Un estado guarda la última medición de latencia, velocidad, DNS, señal y equipos. Úsalo antes y después de un cambio físico (por ejemplo, cablear el nodo) para comparar con datos.</p>`;
}

function cmpOptions(selected, snaps) {
  return [`<option value="current" ${selected === 'current' ? 'selected' : ''}>Medición actual</option>`]
    .concat(snaps.map((s) => `<option value="${s.id}" ${selected === s.id ? 'selected' : ''}>${esc(s.label)} · ${clock(s.at)}</option>`))
    .join('');
}

function snapRow(s) {
  const m = s.metrics || {};
  return `<tr>
    <td><div class="cell-main">${esc(s.label)}</div>${s.note ? `<div class="cell-sub">${esc(s.note)}</div>` : ''}</td>
    <td class="cell-sub">${clock(s.at)}</td>
    <td class="mono">${m.latency?.p50 != null ? num(m.latency.p50, 1) + ' ms' : '—'}</td>
    <td class="mono">${m.speed?.down != null ? num(m.speed.down, 1) + ' Mbps' : '—'}</td>
    <td class="mono">${m.wifi?.rssi != null ? m.wifi.rssi + ' dBm' : '—'}</td>
    <td style="white-space:nowrap">
      <button class="btn ghost small" data-cmp="a" data-id="${s.id}" title="Usar como antes">A</button>
      <button class="btn ghost small" data-cmp="b" data-id="${s.id}" title="Usar como después">B</button>
      <button class="btn ghost small" data-del="${s.id}" title="Borrar">✕</button>
    </td>
  </tr>`;
}

function bindHistory() {
  $('#snap-save')?.addEventListener('click', async () => {
    const btn = $('#snap-save');
    const label = $('#snap-label').value.trim();
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const snap = await api('/api/snapshots', { method: 'POST', body: JSON.stringify({ label }) });
      state.historySel.b = snap.id;
      await refresh();
      toast('Estado guardado', snap.label);
    } catch (e) {
      toast('No se pudo guardar', e.message);
      btn.disabled = false;
      btn.textContent = 'Guardar estado actual';
    }
  });
  $('#cmp-a')?.addEventListener('change', (e) => { state.historySel.a = e.target.value; render(); });
  $('#cmp-b')?.addEventListener('change', (e) => { state.historySel.b = e.target.value; render(); });
  $$('#view [data-cmp]').forEach((b) => b.addEventListener('click', () => {
    state.historySel[b.dataset.cmp] = b.dataset.id;
    render();
  }));
  $$('#view [data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('¿Borrar este estado guardado?')) return;
    try {
      await api(`/api/snapshots/${b.dataset.del}`, { method: 'DELETE' });
      await refresh();
      toast('Estado borrado');
    } catch (e) { toast('No se pudo borrar', e.message); }
  }));
}

/* ---------------- router ---------------- */
function viewRouter() {
  const r = state.data.state.router;
  if (!r) return `<div class="empty">Inspeccionando el router… <button class="btn small" id="router-refresh">Reintentar</button></div>`;
  const fam = r.gateway?.familyLabel || 'Genérico';
  return `
  <div class="section-head"><h2>Router</h2><p>Detección por HTTP, TTL y traceroute · sin credenciales</p></div>

  <div class="grid cols-2 section">
    <div class="card">
      <div class="card-head"><div class="card-title">Gateway</div><span class="badge accent">${esc(fam)}</span></div>
      <div class="card-body">
        <dl class="kv">
          <dt>IP</dt><dd class="mono">${esc(r.gateway?.ip || '—')}</dd>
          <dt>MAC (parcial)</dt><dd class="mono">${esc(r.gateway?.macMasked || '—')}</dd>
          <dt>Fabricante</dt><dd>${esc(r.gateway?.vendor || 'desconocido')}</dd>
          <dt>Web</dt><dd>${r.gateway?.web?.reachable ? `<span class="badge ok">${esc(r.gateway.web.scheme)} ${r.gateway.web.status}</span> ${esc(r.gateway.web.title || '')}` : '<span class="badge">No responde</span>'}</dd>
          <dt>Servidor</dt><dd>${esc(r.gateway?.web?.server || '—')}</dd>
        </dl>
        <p class="note" style="margin-top:12px">El agente no inicia sesión ni envía credenciales. La detección es pasiva o una consulta HTTP sin autenticación.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div class="card-title">Aguas arriba</div><span class="badge ${r.ont?.manageable ? 'info' : ''}">${r.ont?.manageable ? 'Web activa' : 'No administrable'}</span></div>
      <div class="card-body">
        ${r.ont ? `<dl class="kv">
          <dt>Salto 2</dt><dd class="mono">${esc(r.ont.ip)}</dd>
          <dt>Latencia</dt><dd>${num(r.ont.ms, 0)} ms</dd>
          <dt>HTTP :80</dt><dd>${r.ont.web80 ? '<span class="badge ok">abierto</span>' : '<span class="badge">cerrado</span>'}</dd>
          <dt>HTTPS :443</dt><dd>${r.ont.web443 ? '<span class="badge ok">abierto</span>' : '<span class="badge">cerrado</span>'}</dd>
        </dl>
        <p class="note" style="margin-top:12px">${esc(r.ont.note || '')}</p>`
        : '<div class="empty">No se detectó un salto intermedio.</div>'}
        <div class="hr"></div>
        <div class="eyebrow" style="margin-bottom:8px">Ruta observada</div>
        <div class="list">
          ${(r.hops || []).map((h) => `<div class="list-item"><span class="badge">${h.hop}</span><div class="what"><b class="mono">${esc(h.ip)}</b><span>${num(h.ms, 0)} ms</span></div><div class="when">${h.hop === 1 ? 'gateway' : h.hop === 2 ? 'aguas arriba' : ''}</div></div>`).join('')}
        </div>
      </div>
    </div>
  </div>

  <div class="section">
    ${accessCard()}
  </div>

  <div class="section-head"><h2>Matriz de capacidades</h2><p>${r.summary?.supported || 0} soportadas · ${r.summary?.configRequired || 0} requieren configuración · ${r.summary?.unavailable || 0} no disponibles · ${r.summary?.unknown || 0} desconocidas</p></div>
  <div class="cap-list">
    <div class="cap-row head"><div>Función</div><div>Estado</div><div>Evidencia</div></div>
    ${(r.capabilities || []).map((c) => {
      const [label, cls] = CAP_STATUS[c.status] || CAP_STATUS.unknown;
      return `<div class="cap-row">
        <div class="cap-name">${esc(c.label)}${c.mvp ? `<div class="cap-ev">MVP: ${esc(CAP_STATUS[c.mvp]?.[0] || c.mvp)}</div>` : ''}</div>
        <div><span class="badge ${cls}">${esc(label)}</span></div>
        <div class="cap-ev">${esc(c.evidence)}</div>
      </div>`;
    }).join('')}
  </div>

  <div class="grid cols-2 section" style="margin-top:22px">
    <div class="card"><div class="card-body">
      <div class="eyebrow">Qué significa cada estado</div>
      <div class="list" style="margin-top:10px">
        <div class="list-item"><span class="badge ok">Soportado</span><div class="what"><b>Trabaja hoy</b><span>Con evidencia del propio equipo o del agente</span></div></div>
        <div class="list-item"><span class="badge info">Solo lectura</span><div class="what"><b>Consulta sí, control no</b><span>El MVP no escribe en el router</span></div></div>
        <div class="list-item"><span class="badge warn">Requiere configuración</span><div class="what"><b>Depende de ti</b><span>Servicio, permisos o paquete del router</span></div></div>
        <div class="list-item"><span class="badge bad">No disponible</span><div class="what"><b>No hay interfaz</b><span>Sin API documentada; solo guía manual</span></div></div>
      </div>
    </div></div>
    <div class="card"><div class="card-body">
      <div class="eyebrow">Notas del agente</div>
      <p class="note" style="margin-top:10px">Base OUI: ${esc(state.data.oui?.source || '—')}. ${esc(state.data.oui?.note || '')}.</p>
      <p class="note" style="margin-top:8px">Inspección: ${clock(r.inspectedAt)}.</p>
      <p class="note" style="margin-top:8px">Descubrir un equipo no implica poder medir su tráfico ni bloquearlo. NetPilot separa esas tres cosas en la interfaz.</p>
      <button class="btn small" id="router-refresh" style="margin-top:12px">Volver a inspeccionar</button>
    </div></div>
  </div>`;
}

function accessCard() {
  const a = state.data?.access || { connected: false };
  const gw = state.data?.network?.gateway || '';
  if (!a.connected) {
    return `<div class="card">
      <div class="card-head"><div class="card-title">Acceso administrativo</div><span class="badge">Opcional · solo lectura</span></div>
      <div class="card-body">
        <p class="note" style="margin-top:0">Conecta con un <b>MikroTik</b> (REST) o un <b>OpenWrt</b> (ubus) para leer inventario y clientes Wi-Fi. Las credenciales viven en memoria y no se guardan ni se registran.</p>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px">
          <div><div class="eyebrow">Familia</div>
            <select class="select" id="acc-family">
              <option value="auto">Detectar automáticamente</option>
              <option value="mikrotik">MikroTik RouterOS</option>
              <option value="openwrt">OpenWrt</option>
            </select>
          </div>
          <div><div class="eyebrow">Host</div><input class="input" id="acc-host" value="${esc(gw)}" placeholder="192.168.88.1" /></div>
          <div><div class="eyebrow">Puerto</div><input class="input" id="acc-port" placeholder="automático" inputmode="numeric" /></div>
          <div><div class="eyebrow">Usuario</div><input class="input" id="acc-user" autocomplete="username" placeholder="solo lectura" /></div>
          <div><div class="eyebrow">Contraseña</div><input class="input" id="acc-pass" type="password" autocomplete="off" /></div>
        </div>
        <div style="display:flex;gap:12px;align-items:center;margin-top:14px;flex-wrap:wrap">
          <button class="btn primary" id="acc-connect">Conectar</button>
          <span class="note">Recomendado: una cuenta de solo lectura. El bloqueo en RouterOS requiere permisos de escritura.</span>
        </div>
      </div>
    </div>`;
  }
  const canBlock = (a.capabilities || []).some((c) => c.key === 'block' && c.status === 'supported');
  return `<div class="card">
    <div class="card-head">
      <div class="card-title">Acceso administrativo</div>
      <span class="badge ok">${esc(a.label)}</span>
    </div>
    <div class="card-body">
      <dl class="kv">
        <dt>Host</dt><dd class="mono">${esc(a.host)}</dd>
        <dt>Conectado</dt><dd>${clock(a.connectedAt)}</dd>
        <dt>Escritura</dt><dd>${a.writes ? '<span class="badge warn">Habilitada con confirmación</span>' : '<span class="badge info">Solo lectura</span>'}</dd>
        <dt>Verificación</dt><dd>${a.verified ? '<span class="badge ok">Probado en hardware</span>' : '<span class="badge warn">No verificado en hardware</span>'}</dd>
      </dl>
      ${(a.warnings || []).length ? `<p class="note warn" style="margin-top:8px">${a.warnings.map((w) => esc(w)).join('<br>')}</p>` : ''}
      <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
        <button class="btn small" id="acc-refresh">Actualizar datos</button>
        <button class="btn small ghost" id="acc-disconnect">Desconectar</button>
      </div>
    </div>
    <div class="card-body" style="padding-top:0">
      <div class="eyebrow" style="margin-bottom:8px">Clientes vistos por el router (${(a.clients || []).length})</div>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Equipo</th><th>IP</th><th>MAC</th><th>Señal</th><th>PHY rx/tx</th><th>Estado</th><th>Acción</th></tr></thead>
          <tbody>
            ${(a.clients || []).map((c) => `<tr>
              <td><div class="cell-main">${esc(c.hostname || c.ip || 'Sin nombre')}</div><div class="cell-sub">${esc(c.source || '')}${c.interface ? ' · ' + esc(c.interface) : ''}</div></td>
              <td class="mono">${esc(c.ip || '—')}</td>
              <td class="mono">${esc(c.macMasked || '—')}</td>
              <td>${c.signal != null ? c.signal + ' dBm' : '—'}</td>
              <td class="mono">${esc(c.rxRate || '—')} / ${esc(c.txRate || '—')}</td>
              <td>${c.blocked ? '<span class="badge bad">Bloqueado</span>' : '<span class="badge ok">Activo</span>'}</td>
              <td>${canBlock
                ? `<button class="btn small ${c.blocked ? '' : 'ghost'}" data-block-id="${esc(c.id)}" data-block-ip="${esc(c.ip || '')}" data-blocked="${c.blocked ? '1' : '0'}">${c.blocked ? 'Desbloquear' : 'Bloquear'}</button>`
                : '<span class="note">No disponible</span>'}</td>
            </tr>`).join('') || `<tr><td colspan="7"><div class="empty">Sin clientes reportados.</div></td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="note" style="margin-top:10px">Credenciales en memoria. Al cerrar el agente se descartan; no se escriben en disco ni en logs.</p>
    </div>
  </div>`;
}

function bindRouter() {
  $('#router-refresh')?.addEventListener('click', async () => {
    const btn = $('#router-refresh');
    btn.disabled = true;
    btn.textContent = 'Inspeccionando…';
    try {
      await api('/api/router?refresh=1');
      await refresh();
    } catch (e) { toast('No se pudo inspeccionar', e.message); btn.disabled = false; btn.textContent = 'Reintentar'; }
  });

  $('#acc-connect')?.addEventListener('click', async () => {
    const btn = $('#acc-connect');
    const payload = {
      family: $('#acc-family').value,
      host: $('#acc-host').value.trim(),
      port: $('#acc-port').value.trim() || null,
      username: $('#acc-user').value.trim(),
      password: $('#acc-pass').value,
    };
    if (!payload.host || !payload.username) { toast('Faltan datos', 'Host y usuario son obligatorios'); return; }
    btn.disabled = true;
    btn.textContent = 'Conectando…';
    try {
      const acc = await api('/api/router/connect', { method: 'POST', body: JSON.stringify(payload) });
      $('#acc-pass').value = '';
      await refresh();
      toast('Acceso conectado', acc.label || '');
    } catch (e) {
      toast('No se pudo conectar', e.message);
      btn.disabled = false;
      btn.textContent = 'Conectar';
    }
  });

  $('#acc-disconnect')?.addEventListener('click', async () => {
    try {
      await api('/api/router/disconnect', { method: 'POST' });
      await refresh();
      toast('Acceso cerrado', 'Las credenciales se descartaron');
    } catch (e) { toast('No se pudo cerrar', e.message); }
  });

  $('#acc-refresh')?.addEventListener('click', async () => {
    try {
      await api('/api/router/access/refresh', { method: 'POST' });
      await refresh();
      toast('Datos actualizados');
    } catch (e) { toast('No se pudo actualizar', e.message); }
  });

  $$('#view [data-block-id]').forEach((b) => b.addEventListener('click', async () => {
    const clientId = b.dataset.blockId;
    const ip = b.dataset.blockIp;
    const blocked = b.dataset.blocked === '1';
    if (!blocked && !confirm(`¿Bloquear ${ip || clientId}? La regla se aplica en el router.`)) return;
    b.disabled = true;
    try {
      await api('/api/router/block', { method: 'POST', body: JSON.stringify({ clientId, ip, blocked: !blocked }) });
      await refresh();
      toast(blocked ? 'Desbloqueado' : 'Bloqueado', ip || clientId);
    } catch (e) {
      toast('No se pudo aplicar', e.message);
      b.disabled = false;
    }
  }));
}

/* ---------------- scan ---------------- */
async function scan() {
  const pill = $('#scan-pill');
  pill.hidden = false;
  $$('#btn-scan, #btn-scan-side').forEach((b) => (b.disabled = true));
  try {
    await api('/api/scan', { method: 'POST' });
    await new Promise((resolve) => {
      const t = setInterval(async () => {
        try {
          const b = await api('/api/bootstrap');
          if (!b.runningJobs?.some((j) => j.type === 'scan')) { clearInterval(t); resolve(); }
        } catch {}
      }, 1200);
      setTimeout(() => { clearInterval(t); resolve(); }, 90000);
    });
    await refresh();
    toast('Red escaneada', 'Inventario actualizado');
  } catch (e) {
    toast('No se pudo escanear', e.message);
  } finally {
    pill.hidden = true;
    $$('#btn-scan, #btn-scan-side').forEach((b) => (b.disabled = false));
  }
}

/* ---------------- events ---------------- */
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('device.new', (ev) => {
    try {
      const d = JSON.parse(ev.data).device;
      toast('Nuevo dispositivo', `${d?.name || d?.ip || ''} · ${d?.vendor || ''}`);
    } catch {}
    refresh().catch(() => {});
  });
  es.addEventListener('scan.progress', (ev) => {
    try {
      const p = JSON.parse(ev.data);
      if (p.message) $('#scan-pill span').textContent = p.message;
    } catch {}
  });
  es.addEventListener('job.done', (ev) => {
    try {
      const j = JSON.parse(ev.data);
      if (j.type === 'scan') refresh().catch(() => {});
      if (j.type === 'router') refresh().catch(() => {});
    } catch {}
  });
  es.addEventListener('wifi.updated', () => {
    if (state.route === 'wifi') api('/api/bootstrap').then((b) => { state.data = b; render(); }).catch(() => {});
  });
  es.onerror = () => {
    $('#agent-pill').classList.remove('on');
    $('#agent-pill').classList.add('off');
    $('#agent-pill span').textContent = 'Agente sin conexión';
  };
  es.onopen = () => {
    $('#agent-pill').classList.add('on');
    $('#agent-pill').classList.remove('off');
  };
}

/* ---------------- boot ---------------- */
function routeTo(r) {
  state.route = r;
  location.hash = r;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function boot() {
  $$('#nav button, #bottom-nav button').forEach((b) => b.addEventListener('click', () => routeTo(b.dataset.route)));
  $('#btn-scan').addEventListener('click', scan);
  $('#btn-scan-side').addEventListener('click', scan);
  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#scrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) routeTo(go.dataset.go);
    const ack = e.target.closest('[data-ack]');
    if (ack) {
      api(`/api/alerts/${ack.dataset.ack}/ack`, { method: 'POST' }).then(refresh).catch(() => {});
    }
  });

  refresh().catch((e) => {
    $('#view').innerHTML = `<div class="empty">No se pudo cargar el agente: ${esc(e.message)}</div>`;
  });
  connect();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

boot();
