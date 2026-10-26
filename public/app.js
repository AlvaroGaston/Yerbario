'use strict';

/* =========================================================
   Yerbario · diario de yerba mate
   Datos: API segura y Postgres
   ========================================================= */

/* ---------- Catálogos ---------- */
const CRITERIOS = [
  { key: 'sabor',       label: 'Sabor',            hint: 'Qué tan rica es en boca' },
  { key: 'aroma',       label: 'Aroma',            hint: 'Olor en el paquete y en el mate' },
  { key: 'amargor',     label: 'Amargor',          hint: '5 = justo como me gusta' },
  { key: 'espuma',      label: 'Espuma',           hint: 'Cómo se forma y cuánto dura' },
  { key: 'rendimiento', label: 'Rendimiento',      hint: 'Cuántos mates aguanta antes de lavarse' },
  { key: 'polvo',       label: 'Polvo',            hint: '5 = casi no tiene polvo, no tapa la bombilla' },
  { key: 'precio',      label: 'Precio / calidad', hint: '5 = vale cada peso' },
];
const TIPOS = ['Con palo (tradicional)', 'Despalada / sin palo', 'Compuesta con hierbas', 'Orgánica', 'Barbacuá / ahumada', 'Saborizada', 'Suave / baja astringencia', 'Otra'];
const ORIGENES = ['Misiones', 'Corrientes', 'Brasil', 'Paraguay', 'Uruguay', 'Otro'];
const MOLIENDAS = ['Fina', 'Media', 'Gruesa'];
const MODOS = ['Amargo', 'Dulce', 'Tereré', 'Cocido'];
const RECOMPRA = { si: 'La volvería a comprar', tal: 'Tal vez', no: 'No la compraría' };
const COLORES = ['#2f7d4f', '#d9822b', '#4a6fa5'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MAX_FOTOS = 6;

/* ---------- Utilidades ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf1 = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtRate = v => nf1.format(v);
const money = n => (n == null || n === '' || isNaN(n)) ? '—' : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtFecha = s => { if (!s) return '—'; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }); };
const precioKg = y => (y.precio > 0 && y.gramos > 0) ? y.precio / y.gramos * 1000 : null;
const sum = a => a.reduce((s, v) => s + v, 0);
const avg = a => a.length ? sum(a) / a.length : null;
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin storage */ } },
};
const debounce = (fn, ms = 160) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

/* ---------- API ---------- */
async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body != null && !(options.body instanceof Blob) && !(options.body instanceof ArrayBuffer)) {
    headers.set('Content-Type', 'application/json');
    options.body = JSON.stringify(options.body);
  }
  let response;
  try {
    response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  } catch {
    throw new Error('No se pudo conectar con el servidor. Revisá tu conexión e intentá de nuevo.');
  }
  if (response.status === 401 && path !== '/api/login') {
    state.yerbas = [];
    state.compare.clear();
    state.detailId = null;
    state.editingId = null;
    state.formFotos = [];
    state.dirty = false;
    ['#dlg-detail', '#dlg-compare', '#dlg-form'].forEach(selector => {
      const dialog = $(selector);
      if (dialog.open) dialog.close();
    });
    renderAll();
    mostrarLogin();
  }
  let data;
  let responseText;
  try { responseText = await response.text(); }
  catch {
    const error = new Error(`No pude leer la respuesta del servidor (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  try { data = JSON.parse(responseText); }
  catch {
    const error = new Error(`El servidor respondió con HTTP ${response.status}, pero no devolvió JSON. Revisá el despliegue de la API e intentá de nuevo.`);
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const message = data && typeof data.error === 'string' ? data.error : 'No se pudo completar la operación.';
    const error = new Error(`${message} (HTTP ${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function mostrarLogin() {
  const dialog = $('#dlg-login');
  if (!dialog.open) {
    $('#form-login').hidden = false;
    $('#form-register').hidden = true;
    dialog.showModal();
  }
}

async function subirFoto(blob, contentType = blob.type || 'image/jpeg') {
  const headers = { 'Content-Type': contentType };
  const data = await api('/api/fotos', { method: 'POST', headers, body: blob });
  return data.url;
}

/* ---------- Estado ---------- */
const state = {
  yerbas: [],
  view: 'coleccion',
  vista: ls.get('yerbario-vista') === 'list' ? 'list' : 'grid',
  filtros: { q: '', estado: 'todas', tipo: '', origen: '', tag: '', min: 0, fav: false, orden: 'recientes' },
  compare: new Set(),
  editingId: null,
  detailId: null,
  formFotos: [],
  dirty: false,
};
const formStars = {};

/* ---------- Estrellas ---------- */
function stars(v, cls = '') {
  v = +v || 0;
  let h = `<span class="stars ${cls}" role="img" aria-label="${v} de 5 estrellas">`;
  for (let i = 0; i < 5; i++) {
    const f = Math.max(0, Math.min(1, v - i));
    h += `<span class="star"><span class="star-fill" style="width:${f * 100}%">★</span>★</span>`;
  }
  return h + '</span>';
}

function mountStarInput(el, value, onChange) {
  let val = value || 0;
  el.classList.add('star-input');
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-valuemin', '0');
  el.setAttribute('aria-valuemax', '5');
  el.innerHTML = '<span class="stars lg">' + '<span class="star"><span class="star-fill">★</span>★</span>'.repeat(5) + '</span><span class="star-num"></span>';
  const fills = $$('.star-fill', el), num = $('.star-num', el), box = $('.stars', el);
  const paint = v => {
    fills.forEach((f, i) => { f.style.width = Math.max(0, Math.min(1, v - i)) * 100 + '%'; });
    num.textContent = v ? fmtRate(v) : '—';
    el.setAttribute('aria-valuenow', v);
  };
  const desdeEvento = e => {
    const r = box.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    return Math.max(0.5, Math.min(5, Math.ceil(x / r.width * 10) / 2));
  };
  el.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') paint(desdeEvento(e)); });
  el.addEventListener('pointerleave', () => paint(val));
  el.addEventListener('click', e => {
    const v = desdeEvento(e);
    val = (v === val) ? 0 : v;
    paint(val);
    onChange?.(val);
  });
  el.addEventListener('keydown', e => {
    const k = e.key;
    let n = val;
    if (k === 'ArrowRight' || k === 'ArrowUp') n = Math.min(5, val + 0.5);
    else if (k === 'ArrowLeft' || k === 'ArrowDown') n = Math.max(0, val - 0.5);
    else if (k === 'Home' || k === 'Delete' || k === 'Backspace') n = 0;
    else if (k === 'End') n = 5;
    else return;
    e.preventDefault();
    val = n; paint(val); onChange?.(val);
  });
  paint(val);
  return { get: () => val, set: v => { val = v || 0; paint(val); } };
}

/* ---------- Radar ---------- */
function radarSVG(series, { size = 360, labels = true } = {}) {
  const n = CRITERIOS.length, cx = size / 2, cy = size / 2;
  const R = size / 2 - (labels ? 62 : 14);
  const pt = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; const r = R * v / 5; return [cx + r * Math.cos(a), cy + r * Math.sin(a), Math.cos(a)]; };
  let g = '';
  for (let lv = 1; lv <= 5; lv++) g += `<polygon class="radar-ring" points="${CRITERIOS.map((_, i) => pt(i, lv).slice(0, 2).map(v => v.toFixed(1)).join(',')).join(' ')}"/>`;
  CRITERIOS.forEach((c, i) => {
    const [x, y] = pt(i, 5);
    g += `<line class="radar-axis" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    if (labels) {
      const [lx, ly, co] = pt(i, 5.75);
      const anchor = co > 0.3 ? 'start' : co < -0.3 ? 'end' : 'middle';
      g += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}">${esc(c.label.replace(' / calidad', ''))}</text>`;
    }
  });
  series.forEach(s => {
    const pts = CRITERIOS.map((c, i) => pt(i, +s.values?.[c.key] || 0));
    g += `<polygon points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" style="fill:${s.color};fill-opacity:.22;stroke:${s.color};stroke-width:2.2;stroke-linejoin:round"/>`;
    pts.forEach(p => { g += `<circle class="radar-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.6" style="fill:${s.color}"/>`; });
  });
  return `<svg viewBox="0 0 ${size} ${size}" class="radar" role="img" aria-label="Gráfico radar de criterios">${g}</svg>`;
}

/* ---------- Imágenes ---------- */
async function procesarImagen(file, max = 1100) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  let blob = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = k * (0.88 ** attempt);
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    blob = await new Promise(res => c.toBlob(res, 'image/jpeg', Math.max(0.5, 0.82 - attempt * 0.08)));
    if (blob && blob.size <= 1.5 * 1024 * 1024) break;
  }
  bmp.close?.();
  if (!blob || blob.size > 1.5 * 1024 * 1024) throw new Error('la imagen no se pudo comprimir al tamaño máximo');
  return blob;
}
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });

function fotoPortada(y) {
  return y.fotos?.[0] || null;
}

/* ---------- Carga y render general ---------- */
async function recargar() {
  $('#empty').hidden = true;
  $('#grid').innerHTML = '<p class="loading" role="status">Cargando tus yerbas…</p>';
  state.yerbas = await api('/api/yerbas');
  state.compare = new Set([...state.compare].filter(id => state.yerbas.some(y => y.id === id)));
  renderAll();
}

function renderAll() {
  renderFiltrosOpciones();
  renderResumen();
  renderGrid();
  renderCompareBar();
  if (state.view === 'stats') renderStats();
}

function renderResumen() {
  const probadas = state.yerbas.filter(y => y.estado === 'probada');
  const quiero = state.yerbas.filter(y => y.estado === 'quiero');
  const prom = avg(probadas.filter(y => y.general > 0).map(y => y.general));
  $('#summary').innerHTML = state.yerbas.length
    ? `<span><b>${state.yerbas.length}</b>${state.yerbas.length === 1 ? 'yerba' : 'yerbas'}</span>
       <span><b>${probadas.length}</b>probadas</span>
       <span><b>${quiero.length}</b>por probar</span>
       ${prom != null ? `<span><b>${fmtRate(prom)}</b>★ promedio</span>` : ''}`
    : '';
}

function llenarFiltro(sel, key, valores, etiqueta) {
  const actual = state.filtros[key];
  sel.innerHTML = `<option value="">${etiqueta}</option>` + valores.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  if (valores.includes(actual)) sel.value = actual; else { sel.value = ''; state.filtros[key] = ''; }
}
function renderFiltrosOpciones() {
  const uniq = f => [...new Set(state.yerbas.flatMap(f).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  llenarFiltro($('#f-tipo'), 'tipo', uniq(y => [y.tipo]), 'Todos los tipos');
  llenarFiltro($('#f-origen'), 'origen', uniq(y => [y.origen]), 'Todos los orígenes');
  llenarFiltro($('#f-tag'), 'tag', uniq(y => y.tags || []), 'Todas las etiquetas');
}

function filtradas() {
  const f = state.filtros, q = f.q.trim().toLowerCase();
  const lista = state.yerbas.filter(y => {
    if (f.estado !== 'todas' && y.estado !== f.estado) return false;
    if (f.tipo && y.tipo !== f.tipo) return false;
    if (f.origen && y.origen !== f.origen) return false;
    if (f.tag && !(y.tags || []).includes(f.tag)) return false;
    if (f.fav && !y.favorita) return false;
    if (f.min && !(y.general >= f.min)) return false;
    if (q) {
      const hay = [y.nombre, y.marca, y.notas, y.lugar, y.pros, y.contras, y.tipo, y.origen, (y.tags || []).join(' ')].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const cmp = {
    recientes: (a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.creado - a.creado,
    mejor: (a, b) => (b.general || 0) - (a.general || 0) || a.nombre.localeCompare(b.nombre, 'es'),
    peor: (a, b) => (a.general || Infinity) - (b.general || Infinity) || a.nombre.localeCompare(b.nombre, 'es'),
    nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    marca: (a, b) => (a.marca || '~').localeCompare(b.marca || '~', 'es') || a.nombre.localeCompare(b.nombre, 'es'),
    baratas: (a, b) => (precioKg(a) ?? Infinity) - (precioKg(b) ?? Infinity),
    caras: (a, b) => (precioKg(b) ?? -1) - (precioKg(a) ?? -1),
  }[f.orden];
  return lista.sort(cmp);
}

function cardHTML(y) {
  const url = fotoPortada(y);
  const kg = precioKg(y);
  const quiero = y.estado === 'quiero';
  return `<article class="card" data-id="${y.id}" tabindex="0" aria-label="${esc(y.nombre)}">
    <div class="card-photo">
      ${url ? `<img src="${url}" alt="Foto de ${esc(y.nombre)}" loading="lazy">` : `<div class="ph" aria-hidden="true"><span>🧉</span></div>`}
      ${quiero ? '<span class="ribbon">Quiero probarla</span>' : ''}
      ${y.fotos?.length > 1 ? `<span class="photo-count">📷 ${y.fotos.length}</span>` : ''}
      <button class="fav ${y.favorita ? 'on' : ''}" data-act="fav" aria-pressed="${!!y.favorita}" aria-label="${y.favorita ? 'Quitar de favoritas' : 'Marcar como favorita'}">♥</button>
    </div>
    <div class="card-body">
      <p class="card-brand">${esc(y.marca || 'Sin marca')}</p>
      <h3 class="card-title">${esc(y.nombre)}</h3>
      <div class="card-rate">${quiero ? '<span class="muted">Sin probar todavía</span>' : `${stars(y.general)}<b>${y.general ? fmtRate(y.general) : '—'}</b>`}</div>
      <div class="chips">
        ${y.tipo ? `<span class="chip">${esc(y.tipo)}</span>` : ''}
        ${y.origen ? `<span class="chip">${esc(y.origen)}</span>` : ''}
      </div>
      <div class="card-foot">
        <span class="muted">${kg ? money(kg) + ' / kg' : (y.precio ? money(y.precio) : '')}</span>
        <label class="cmp"><input type="checkbox" data-act="cmp" ${state.compare.has(y.id) ? 'checked' : ''}> Comparar</label>
      </div>
    </div>
  </article>`;
}

function renderGrid() {
  const grid = $('#grid');
  grid.classList.toggle('list', state.vista === 'list');
  const lista = filtradas();
  grid.innerHTML = lista.map(cardHTML).join('');
  const vacio = $('#empty');
  if (!state.yerbas.length) {
    vacio.hidden = false;
    $('#empty-title').textContent = 'Tu yerbatera está vacía';
    $('#empty-text').textContent = 'Cargá la primera yerba que pruebes y empezá a armar tu ranking.';
    $$('.empty-actions button', vacio).forEach(b => { b.hidden = false; });
  } else if (!lista.length) {
    vacio.hidden = false;
    $('#empty-title').textContent = 'Ninguna yerba coincide';
    $('#empty-text').textContent = 'Probá con otros filtros o limpiá la búsqueda.';
    $$('.empty-actions button', vacio).forEach(b => { b.hidden = true; });
  } else {
    vacio.hidden = true;
  }
}

function setVista(v) {
  state.vista = v;
  ls.set('yerbario-vista', v);
  $('#v-grid').classList.toggle('is-active', v === 'grid');
  $('#v-list').classList.toggle('is-active', v === 'list');
  $('#v-grid').setAttribute('aria-pressed', v === 'grid');
  $('#v-list').setAttribute('aria-pressed', v === 'list');
  renderGrid();
}

function cambiarVista(v) {
  state.view = v;
  $$('.tab').forEach(t => { const on = t.dataset.view === v; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on); });
  $('#view-coleccion').hidden = v !== 'coleccion';
  $('#view-stats').hidden = v !== 'stats';
  if (v === 'stats') renderStats();
  renderCompareBar();
  window.scrollTo({ top: 0 });
}

/* ---------- Favoritas y comparación ---------- */
async function toggleFav(id) {
  const y = state.yerbas.find(x => x.id === id);
  if (!y) return;
  const wasFavorite = y.favorita;
  y.favorita = !y.favorita;
  y.actualizado = Date.now();
  renderGrid();
  const b = $('#detail-fav');
  if (b && state.detailId === id) {
    b.setAttribute('aria-pressed', y.favorita);
    b.textContent = y.favorita ? '♥ Favorita' : '♡ Marcar favorita';
  }
  try {
    const { id: ignored, creado, actualizado, ...record } = y;
    const saved = await api(`/api/yerbas?id=${id}`, { method: 'PUT', body: record });
    Object.assign(y, saved);
  } catch (error) {
    y.favorita = wasFavorite;
    renderAll();
    if (state.detailId === id && $('#dlg-detail').open) abrirDetalle(id);
    toast(`No pude actualizar la favorita: ${error.message}`);
  }
}

function renderCompareBar() {
  const n = state.compare.size;
  $('#compare-bar').hidden = !(n > 0 && state.view === 'coleccion');
  $('#compare-text').textContent = `${n} seleccionada${n === 1 ? '' : 's'} (máx. 3)`;
  $('#compare-go').disabled = n < 2;
}

/* ---------- Detalle ---------- */
function abrirDetalle(id) {
  const y = state.yerbas.find(x => x.id === id);
  if (!y) return;
  state.detailId = id;
  $('#detail-body').innerHTML = detalleHTML(y, y.fotos || []);
  $('#dlg-detail').showModal();
  $('#detail-body .dlg-body')?.scrollTo?.(0, 0);
}

function detalleHTML(y, urls) {
  const kg = precioKg(y);
  const quiero = y.estado === 'quiero';
  const p = y.puntajes || {};
  const tienePuntajes = CRITERIOS.some(c => p[c.key] > 0);
  const hechos = [
    ['Tipo', y.tipo], ['Origen', y.origen], ['Molienda', y.molienda], ['Cómo la tomé', y.modo],
    ['Estacionamiento', y.estacionamiento != null ? `${y.estacionamiento} meses` : ''],
    ['Contenido', y.gramos ? `${y.gramos} g` : ''],
    ['Precio', y.precio != null ? money(y.precio) : ''],
    ['Precio por kg', kg ? money(kg) : ''],
    ['Comprada en', y.lugar],
    ['Fecha', y.fecha ? fmtFecha(y.fecha) : ''],
  ].filter(h => h[1]);

  const media = urls.length
    ? `<div class="detail-media">
         <a id="detail-main-link" class="detail-main" href="${urls[0]}" target="_blank" rel="noopener" title="Abrir foto en tamaño completo"><img id="detail-main-img" src="${urls[0]}" alt="Foto de ${esc(y.nombre)}"></a>
         ${urls.length > 1 ? `<div class="detail-thumbs">${urls.map((u, i) => `<button type="button" data-thumb="${i}" class="${i === 0 ? 'on' : ''}" aria-label="Ver foto ${i + 1}"><img src="${u}" alt=""></button>`).join('')}</div>` : ''}
       </div>`
    : `<div class="detail-media"><div class="detail-main"><div class="ph" aria-hidden="true"><span>🧉</span></div></div></div>`;

  return `
    <header class="dlg-head">
      <span class="muted small">${quiero ? 'En mi lista de deseos' : 'Detalle de la yerba'}</span>
      <button type="button" class="icon-btn" data-close aria-label="Cerrar">✕</button>
    </header>
    <div class="detail dlg-body" style="padding:0">
      ${media}
      <div class="detail-info">
        <div>
          <p class="detail-brand">${esc(y.marca || 'Sin marca')}</p>
          <h2>${esc(y.nombre)}</h2>
          ${quiero
            ? '<div class="badges"><span class="badge wish">🛒 Quiero probarla</span></div>'
            : `<div class="detail-rate">${stars(y.general, 'lg')}<span class="big">${y.general ? fmtRate(y.general) : '—'}</span></div>`}
        </div>
        <div class="badges">
          ${y.favorita ? '<span class="badge">♥ Favorita</span>' : ''}
          ${y.recompra ? `<span class="badge rec-${y.recompra}">${RECOMPRA[y.recompra]}</span>` : ''}
          ${(y.tags || []).map(t => `<span class="chip tag">#${esc(t)}</span>`).join('')}
        </div>
        ${hechos.length ? `<dl class="facts">${hechos.map(h => `<div><dt>${h[0]}</dt><dd>${esc(h[1])}</dd></div>`).join('')}</dl>` : ''}
        ${(!quiero && tienePuntajes) ? `
          <div class="detail-block">
            <h4>Criterios</h4>
            <div class="score-wrap">
              <ul class="crit-ro">${CRITERIOS.map(c => `<li><span>${c.label}</span><span>${stars(p[c.key], 'sm')} <span class="v">${p[c.key] ? fmtRate(p[c.key]) : '—'}</span></span></li>`).join('')}</ul>
              ${radarSVG([{ values: p, color: COLORES[0] }], { size: 360 })}
            </div>
          </div>` : ''}
        ${(y.pros || y.contras) ? `<div class="proscons">
          ${y.pros ? `<div><h4>👍 Lo bueno</h4><p>${esc(y.pros)}</p></div>` : ''}
          ${y.contras ? `<div><h4>👎 Lo malo</h4><p>${esc(y.contras)}</p></div>` : ''}
        </div>` : ''}
        ${y.notas ? `<div class="notes"><h4>Notas</h4><p>${esc(y.notas)}</p></div>` : ''}
        <div class="detail-actions">
          <button type="button" id="detail-fav" class="btn ghost" aria-pressed="${!!y.favorita}" data-act="d-fav">${y.favorita ? '♥ Favorita' : '♡ Marcar favorita'}</button>
          <button type="button" class="btn primary" data-act="d-edit">✎ Editar</button>
          <button type="button" class="btn ghost" data-act="d-del" style="color:var(--danger)">🗑 Eliminar</button>
        </div>
      </div>
    </div>`;
}

/* ---------- Comparación ---------- */
function abrirComparar() {
  const items = [...state.compare].map(id => state.yerbas.find(y => y.id === id)).filter(Boolean);
  if (items.length < 2) return;
  const urls = items.map(y => y.fotos?.[0] || null);

  const mejor = (vals, modo = 'max') => {
    const v = vals.filter(x => x != null && x > 0);
    if (v.length < 2) return null;
    return modo === 'max' ? Math.max(...v) : Math.min(...v);
  };
  const fila = (label, getter, render, modo) => {
    const vals = items.map(getter);
    const b = modo ? mejor(vals, modo) : null;
    return `<tr><td>${label}</td>${items.map((y, i) => `<td class="${b != null && vals[i] === b ? 'best' : ''}">${render(y, vals[i])}</td>`).join('')}</tr>`;
  };
  const txt = v => v ? esc(v) : '—';

  const filas = [
    fila('Puntaje general', y => y.general, (y, v) => v ? `${stars(v, 'sm')}<br><b>${fmtRate(v)}</b>` : '—', 'max'),
    ...CRITERIOS.map(c => fila(c.label, y => y.puntajes?.[c.key], (y, v) => v ? `${stars(v, 'sm')} ${fmtRate(v)}` : '—', 'max')),
    fila('Precio', y => y.precio, (y, v) => money(v), 'min'),
    fila('Precio por kg', y => precioKg(y), (y, v) => v ? money(v) : '—', 'min'),
    fila('Contenido', y => y.gramos, (y, v) => v ? `${v} g` : '—'),
    fila('Tipo', y => y.tipo, (y, v) => txt(v)),
    fila('Origen', y => y.origen, (y, v) => txt(v)),
    fila('Molienda', y => y.molienda, (y, v) => txt(v)),
    fila('¿La volvería a comprar?', y => y.recompra, (y, v) => v ? RECOMPRA[v] : '—'),
  ].join('');

  $('#compare-body').innerHTML = `
    <header class="dlg-head"><h2>Comparación</h2><button type="button" class="icon-btn" data-close aria-label="Cerrar">✕</button></header>
    <div class="cmp-scroll">
      <table class="cmp-table">
        <thead><tr><th></th>${items.map((y, i) => `<th>
          <div class="cmp-photo">${urls[i] ? `<img src="${urls[i]}" alt="">` : '🧉'}</div>
          <div class="cmp-brand">${esc(y.marca || '')}</div>
          <div class="cmp-name">${esc(y.nombre)}</div></th>`).join('')}</tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <div class="cmp-chart">
        ${radarSVG(items.map((y, i) => ({ values: y.puntajes || {}, color: COLORES[i] })), { size: 380 })}
        <div class="legend">${items.map((y, i) => `<span><i style="background:${COLORES[i]}"></i>${esc(y.nombre)}</span>`).join('')}
          <p class="muted small">Las celdas resaltadas marcan la mejor opción en cada fila.</p></div>
      </div>
    </div>`;
  $('#dlg-compare').showModal();
}

/* ---------- Formulario ---------- */
function opciones(arr, vacio) {
  return (vacio ? `<option value="">${vacio}</option>` : '') + arr.map(v => `<option>${esc(v)}</option>`).join('');
}

function montarForm() {
  const f = $('#form-yerba').elements;
  f.tipo.innerHTML = opciones(TIPOS, '— elegir —');
  f.origen.innerHTML = opciones(ORIGENES, '— elegir —');
  f.molienda.innerHTML = opciones(MOLIENDAS, '— elegir —');
  f.modo.innerHTML = opciones(MODOS, '— elegir —');

  $('#crit-list').innerHTML = CRITERIOS.map(c =>
    `<div class="crit-row"><div class="crit-name"><b>${c.label}</b><small>${c.hint}</small></div><div data-crit="${c.key}"></div></div>`).join('');
  $$('#form-yerba [data-crit]').forEach(el => {
    formStars[el.dataset.crit] = mountStarInput(el, 0, () => { state.dirty = true; });
  });
}

function actualizarPrecioKg() {
  const f = $('#form-yerba').elements;
  const kg = precioKg({ precio: +f.precio.value, gramos: +f.gramos.value });
  $('#pkg').textContent = kg ? `≈ ${money(kg)} por kg` : '';
}

function abrirForm(id = null) {
  state.editingId = id;
  const y = id != null ? state.yerbas.find(x => x.id === id) : null;
  const form = $('#form-yerba');
  const f = form.elements;
  form.reset();

  $('#form-title').textContent = y ? 'Editar yerba' : 'Nueva yerba';
  f.estado.value = y?.estado ?? 'probada';
  f.nombre.value = y?.nombre ?? '';
  f.marca.value = y?.marca ?? '';
  f.tipo.value = y?.tipo ?? '';
  f.origen.value = y?.origen ?? '';
  f.molienda.value = y?.molienda ?? '';
  f.modo.value = y?.modo ?? '';
  f.estacionamiento.value = y?.estacionamiento ?? '';
  f.gramos.value = y?.gramos ?? '';
  f.precio.value = y?.precio ?? '';
  f.lugar.value = y?.lugar ?? '';
  f.fecha.value = y ? (y.fecha ?? '') : hoy();
  f.recompra.value = y?.recompra ?? '';
  f.favorita.checked = !!y?.favorita;
  f.pros.value = y?.pros ?? '';
  f.contras.value = y?.contras ?? '';
  f.notas.value = y?.notas ?? '';
  f.tags.value = (y?.tags || []).join(', ');

  CRITERIOS.forEach(c => formStars[c.key].set(y?.puntajes?.[c.key] ?? 0));
  formStars.general.set(y?.general ?? 0);

  $('#dl-marcas').innerHTML = [...new Set(state.yerbas.map(x => x.marca).filter(Boolean))].map(m => `<option value="${esc(m)}">`).join('');
  $('#dl-lugares').innerHTML = [...new Set(state.yerbas.map(x => x.lugar).filter(Boolean))].map(m => `<option value="${esc(m)}">`).join('');

  state.formFotos = (y?.fotos || []).map(url => ({ url, existing: true }));
  renderThumbs();
  aplicarEstadoForm();
  actualizarPrecioKg();
  state.dirty = false;
  $('#dlg-form').showModal();
  if (!y) f.nombre.focus();
}

function aplicarEstadoForm() {
  const quiero = $('#form-yerba').elements.estado.value === 'quiero';
  $('#dlg-form').classList.toggle('form-quiero', quiero);
}

function renderThumbs() {
  $('#thumbs').innerHTML = state.formFotos.map((p, i) => `
    <figure class="thumb ${i === 0 ? 'is-cover' : ''}">
      <img src="${p.url}" alt="Foto ${i + 1}">
      ${i === 0 ? '<span class="cover-tag">Portada</span>' : `<button type="button" data-act="cover" data-i="${i}">Portada</button>`}
      <button type="button" class="thumb-x" data-act="rm" data-i="${i}" aria-label="Quitar foto">✕</button>
    </figure>`).join('');
}

async function agregarFotos(files) {
  const imgs = [...files].filter(f => f.type.startsWith('image/'));
  if (!imgs.length) return;
  const cupo = MAX_FOTOS - state.formFotos.length;
  if (cupo <= 0) { toast(`Máximo ${MAX_FOTOS} fotos por yerba`); return; }
  const dz = $('#dropzone');
  dz.classList.add('busy');
  for (const file of imgs.slice(0, cupo)) {
    try {
      const blob = await procesarImagen(file);
      if (blob.size > 1.5 * 1024 * 1024) {
        toast('Una imagen comprimida supera el límite de 1,5 MB');
        continue;
      }
      state.formFotos.push({ blob, url: await blobToDataURL(blob) });
    } catch {
      toast('No pude leer una de las imágenes (probá con JPG o PNG)');
    }
  }
  dz.classList.remove('busy');
  if (imgs.length > cupo) toast(`Solo entran ${MAX_FOTOS} fotos por yerba`);
  state.dirty = true;
  renderThumbs();
}

async function cerrarForm() {
  if (state.dirty && !(await confirmar('¿Descartar los cambios?', 'Lo que cargaste en este formulario no se va a guardar.', 'Descartar'))) return;
  state.dirty = false;
  $('#dlg-form').close();
}

async function guardar(e) {
  e.preventDefault();
  const submit = $('#form-yerba button[type="submit"]');
  if (submit.disabled) return;
  const f = $('#form-yerba').elements;
  const nombre = f.nombre.value.trim();
  if (!nombre) { f.nombre.focus(); toast('Poné el nombre de la yerba'); return; }

  const estado = f.estado.value;
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
  const prev = state.editingId != null ? state.yerbas.find(x => x.id === state.editingId) : null;
  const puntajes = {};
  CRITERIOS.forEach(c => { puntajes[c.key] = formStars[c.key].get(); });
  const tags = [...new Set(f.tags.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean))];

  const obj = {
    estado, nombre,
    marca: f.marca.value.trim(),
    tipo: f.tipo.value, origen: f.origen.value, molienda: f.molienda.value, modo: f.modo.value,
    estacionamiento: num(f.estacionamiento.value),
    gramos: num(f.gramos.value),
    precio: num(f.precio.value),
    lugar: f.lugar.value.trim(),
    fecha: f.fecha.value || (estado === 'probada' ? hoy() : ''),
    puntajes,
    general: formStars.general.get(),
    recompra: f.recompra.value,
    favorita: f.favorita.checked,
    pros: f.pros.value.trim(), contras: f.contras.value.trim(), notas: f.notas.value.trim(),
    tags,
    fotos: [],
  };

  const uploaded = [];
  let persisted = false;
  let saveAttempted = false;
  submit.disabled = true;
  try {
    for (const photo of state.formFotos) {
      if (photo.existing) obj.fotos.push(photo.url);
      else {
        const url = await subirFoto(photo.blob);
        uploaded.push(url);
        obj.fotos.push(url);
      }
    }
    saveAttempted = true;
    const saved = await api(prev ? `/api/yerbas?id=${prev.id}` : '/api/yerbas', {
      method: prev ? 'PUT' : 'POST',
      body: obj,
    });
    persisted = true;
    state.dirty = false;
    $('#dlg-form').close();
    await recargar();
    toast(prev ? 'Cambios guardados' : 'Yerba guardada 🧉');
    if (state.detailId === saved.id && $('#dlg-detail').open) abrirDetalle(saved.id);
  } catch (error) {
    const safeToDelete = !saveAttempted || (error.status && error.status < 500);
    if (safeToDelete) for (const url of uploaded) {
      try { await api('/api/fotos', { method: 'DELETE', body: { url } }); }
      catch { console.error('No se pudo limpiar una foto recién subida.'); }
    }
    else if (!persisted && uploaded.length) console.error('No se borran las fotos porque el resultado del guardado pudo ser ambiguo.');
    toast(persisted
      ? `La yerba se guardó, pero no pude actualizar la lista: ${error.message}`
      : `No pude guardar la yerba: ${error.message}`);
  } finally {
    submit.disabled = false;
  }
}

/* ---------- Confirmación ---------- */
function confirmar(titulo, mensaje, textoOk = 'Confirmar') {
  return new Promise(res => {
    const d = $('#dlg-confirm');
    $('#confirm-title').textContent = titulo;
    $('#confirm-msg').textContent = mensaje;
    $('#confirm-ok').textContent = textoOk;
    d.returnValue = '';
    d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true });
    d.showModal();
  });
}

async function eliminar(id) {
  const y = state.yerbas.find(x => x.id === id);
  if (!y) return;
  if (!(await confirmar(`¿Eliminar "${y.nombre}"?`, 'Se borra la yerba con todas sus fotos. No se puede deshacer.', 'Eliminar'))) return;
  try {
    await api(`/api/yerbas?id=${id}`, { method: 'DELETE' });
    state.compare.delete(id);
    $('#dlg-detail').close();
    await recargar();
    toast('Yerba eliminada');
  } catch (error) {
    toast(`No pude eliminar la yerba: ${error.message}`);
  }
}

/* ---------- Estadísticas ---------- */
function agrupar(lista, fn) {
  const m = new Map();
  lista.forEach(y => { const k = fn(y); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(y); });
  return [...m].map(([label, v]) => ({ label, n: v.length, prom: avg(v.filter(y => y.general > 0).map(y => y.general)) }));
}
function barList(items, max, fmt) {
  if (!items.length) return '<p class="muted small">Sin datos todavía.</p>';
  return `<ul class="bars">${items.map(i => `<li><span class="bl" title="${esc(i.label)}">${esc(i.label)}</span><span class="bt"><span class="bf" style="width:${Math.max(2, (i.value / max) * 100)}%"></span></span><span class="bv">${fmt(i)}</span></li>`).join('')}</ul>`;
}
function rankHTML(items, scoreFn) {
  if (!items.length) return '<p class="muted small">Sin datos todavía.</p>';
  return `<ol class="rank">${items.map((y, i) => {
    const u = fotoPortada(y);
    return `<li data-open="${y.id}"><span class="pos">${i + 1}</span>
      <span class="rthumb">${u ? `<img src="${u}" alt="">` : '🧉'}</span>
      <span><span class="rname">${esc(y.nombre)}</span><br><span class="rbrand">${esc(y.marca || 'Sin marca')}</span></span>
      <span class="rscore">${scoreFn(y)}</span></li>`;
  }).join('')}</ol>`;
}

function renderStats() {
  const root = $('#view-stats');
  const probadas = state.yerbas.filter(y => y.estado === 'probada');
  const quiero = state.yerbas.filter(y => y.estado === 'quiero');
  if (!probadas.length) {
    root.innerHTML = '<div class="empty-box"><h2>Todavía no hay estadísticas</h2><p>Cargá y puntuá al menos una yerba que hayas probado para ver tus números.</p></div>';
    return;
  }
  const rated = probadas.filter(y => y.general > 0);
  const prom = avg(rated.map(y => y.general));
  const gasto = sum(probadas.map(y => y.precio || 0));
  const promKg = avg(probadas.map(precioKg).filter(v => v != null));
  const favs = state.yerbas.filter(y => y.favorita).length;

  const top = [...rated].sort((a, b) => b.general - a.general).slice(0, 5);
  const valor = probadas.filter(y => y.puntajes?.precio > 0).sort((a, b) => b.puntajes.precio - a.puntajes.precio).slice(0, 3);

  // histograma
  const cubos = Array.from({ length: 10 }, (_, i) => ({ v: (i + 1) / 2, n: 0 }));
  rated.forEach(y => { const k = Math.max(1, Math.min(10, Math.round(y.general * 2))) - 1; cubos[k].n++; });
  const maxN = Math.max(1, ...cubos.map(c => c.n));

  // meses
  const ahora = new Date();
  const meses = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - (11 - i), 1);
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MESES[d.getMonth()], n: 0 };
  });
  probadas.forEach(y => {
    const k = (y.fecha || '').slice(0, 7) || new Date(y.creado).toISOString().slice(0, 7);
    const m = meses.find(x => x.key === k);
    if (m) m.n++;
  });
  const maxM = Math.max(1, ...meses.map(m => m.n));

  // perfil promedio
  const perfil = {};
  CRITERIOS.forEach(c => { perfil[c.key] = avg(probadas.map(y => y.puntajes?.[c.key]).filter(v => v > 0)) || 0; });
  const hayPerfil = Object.values(perfil).some(v => v > 0);

  const porTipo = agrupar(probadas, y => y.tipo).filter(g => g.prom != null).sort((a, b) => b.prom - a.prom);
  const porOrigen = agrupar(probadas, y => y.origen).sort((a, b) => b.n - a.n);
  const porMarca = agrupar(probadas, y => y.marca).filter(g => g.prom != null).sort((a, b) => b.prom - a.prom || b.n - a.n).slice(0, 8);
  const maxOrigen = Math.max(1, ...porOrigen.map(g => g.n));

  root.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="kpi-n">${probadas.length}</span><span class="kpi-l">yerbas probadas</span></div>
      <div class="kpi"><span class="kpi-n">${quiero.length}</span><span class="kpi-l">en la lista de deseos</span></div>
      <div class="kpi"><span class="kpi-n">${prom != null ? fmtRate(prom) + ' ★' : '—'}</span><span class="kpi-l">puntaje promedio</span></div>
      <div class="kpi"><span class="kpi-n">${money(gasto)}</span><span class="kpi-l">gastado en total</span></div>
      <div class="kpi"><span class="kpi-n">${promKg != null ? money(promKg) : '—'}</span><span class="kpi-l">precio promedio por kg</span></div>
      <div class="kpi"><span class="kpi-n">${favs}</span><span class="kpi-l">favoritas</span></div>
    </div>

    <div class="panels">
      <section class="panel"><h3>🏆 Mi top 5</h3><p class="sub">Las mejor puntuadas</p>${rankHTML(top, y => fmtRate(y.general) + ' ★')}</section>

      <section class="panel"><h3>💸 Mejor relación precio / calidad</h3><p class="sub">Según tu criterio de precio</p>${rankHTML(valor, y => fmtRate(y.puntajes.precio) + ' ★')}</section>

      <section class="panel"><h3>Distribución de puntajes</h3><p class="sub">Cuántas yerbas recibieron cada nota</p>
        ${rated.length ? `<div class="hist">${cubos.map(c => `<div class="col ${c.n ? '' : 'empty'}"><span class="n">${c.n || ''}</span><span class="bar" style="height:${(c.n / maxN) * 100}%"></span><span class="x">${fmtRate(c.v).replace(',0', '')}</span></div>`).join('')}</div>` : '<p class="muted small">Puntuá alguna yerba para ver esto.</p>'}
      </section>

      <section class="panel"><h3>Tu paladar</h3><p class="sub">Promedio de cada criterio en todas tus yerbas</p>
        ${hayPerfil ? radarSVG([{ values: perfil, color: COLORES[0] }], { size: 360 }) : '<p class="muted small">Cargá puntajes por criterio para ver tu perfil.</p>'}
      </section>

      <section class="panel"><h3>Promedio por tipo</h3><p class="sub">Qué tipo de yerba te gusta más</p>
        ${barList(porTipo.map(g => ({ label: g.label, value: g.prom, n: g.n })), 5, i => `${fmtRate(i.value)} ★ · ${i.n}`)}
      </section>

      <section class="panel"><h3>Promedio por marca</h3><p class="sub">Top 8 (el número es cuántas probaste)</p>
        ${barList(porMarca.map(g => ({ label: g.label, value: g.prom, n: g.n })), 5, i => `${fmtRate(i.value)} ★ · ${i.n}`)}
      </section>

      <section class="panel"><h3>Por origen</h3><p class="sub">Cuántas probaste de cada zona</p>
        ${barList(porOrigen.map(g => ({ label: g.label, value: g.n })), maxOrigen, i => i.value)}
      </section>

      <section class="panel"><h3>Yerbas probadas por mes</h3><p class="sub">Últimos 12 meses</p>
        <div class="hist">${meses.map(m => `<div class="col ${m.n ? '' : 'empty'}"><span class="n">${m.n || ''}</span><span class="bar" style="height:${(m.n / maxM) * 100}%"></span><span class="x">${m.label}</span></div>`).join('')}</div>
      </section>
    </div>`;
}

/* ---------- Exportar / importar ---------- */
function descargar(nombre, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

async function exportarJSON() {
  if (!state.yerbas.length) { toast('No hay nada para exportar todavía'); return; }
  const yerbas = state.yerbas.map(({ id, ...record }) => record);
  const payload = { app: 'yerbario', version: 1, exportado: new Date().toISOString(), yerbas };
  descargar(`yerbario-respaldo-${hoy()}.json`, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  toast('Respaldo descargado ✔');
}

function exportarCSV() {
  if (!state.yerbas.length) { toast('No hay nada para exportar todavía'); return; }
  const cab = ['Nombre', 'Marca', 'Estado', 'Tipo', 'Origen', 'Molienda', 'Modo', 'Estacionamiento (meses)', 'Contenido (g)', 'Precio', 'Precio por kg', 'Comprada en', 'Fecha',
    'General', ...CRITERIOS.map(c => c.label), 'Recompra', 'Favorita', 'Etiquetas', 'Lo bueno', 'Lo malo', 'Notas'];
  const cel = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const filas = state.yerbas.map(y => [
    y.nombre, y.marca, y.estado === 'probada' ? 'Probada' : 'Quiero probar', y.tipo, y.origen, y.molienda, y.modo, y.estacionamiento, y.gramos, y.precio,
    precioKg(y) ? Math.round(precioKg(y)) : '', y.lugar, y.fecha, y.general || '',
    ...CRITERIOS.map(c => y.puntajes?.[c.key] || ''), y.recompra ? RECOMPRA[y.recompra] : '', y.favorita ? 'Sí' : '', (y.tags || []).join(', '), y.pros, y.contras, y.notas,
  ].map(cel).join(';'));
  const csv = '﻿' + [cab.map(cel).join(';'), ...filas].join('\r\n');
  descargar(`yerbario-${hoy()}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

function normalizar(r) {
  const puntajes = r.puntajes ?? Object.fromEntries(CRITERIOS.map(c => [c.key, 0]));
  return {
    creado: r.creado ?? null,
    actualizado: r.actualizado ?? null,
    estado: r.estado ?? 'probada',
    nombre: r.nombre ?? '',
    marca: r.marca ?? '',
    tipo: r.tipo ?? '', origen: r.origen ?? '', molienda: r.molienda ?? '', modo: r.modo ?? '',
    estacionamiento: r.estacionamiento ?? null, gramos: r.gramos ?? null, precio: r.precio ?? null,
    lugar: r.lugar ?? '',
    fecha: r.fecha ?? '',
    puntajes,
    general: r.general ?? 0,
    recompra: r.recompra ?? '',
    favorita: r.favorita ?? false,
    pros: r.pros ?? '', contras: r.contras ?? '', notas: r.notas ?? '',
    tags: r.tags ?? [],
    fotos: r.fotos ?? [],
  };
}

async function importarEnLotes(items) {
  let imported = 0;
  for (let start = 0; start < items.length; start += 30) {
    const chunk = items.slice(start, start + 30).map(item => ({ ...item, fotos: [...(item.fotos || [])] }));
    const uploaded = [];
    let importAttempted = false;
    try {
      for (const item of chunk) {
        for (let i = 0; i < item.fotos.length; i++) {
          const photo = item.fotos[i];
          if (typeof photo === 'string' && photo.startsWith('data:image/')) {
            let blob = await (await fetch(photo)).blob();
            if (blob.size > 1.5 * 1024 * 1024) blob = await procesarImagen(blob);
            const url = await subirFoto(blob, blob.type);
            uploaded.push(url);
            item.fotos[i] = url;
          }
        }
      }
      importAttempted = true;
      const result = await api('/api/import', { method: 'POST', body: { yerbas: chunk } });
      imported += result.imported;
      if (result.cleanupPending) toast('La importación se completó, pero quedó pendiente limpiar alguna foto duplicada.');
    } catch (error) {
      const safeToDelete = !importAttempted || (error.status && error.status < 500);
      for (const url of safeToDelete ? uploaded : []) {
        try { await api('/api/fotos', { method: 'DELETE', body: { url } }); }
        catch { console.error('No se pudo limpiar una foto importada.'); }
      }
      if (!safeToDelete && uploaded.length) console.error('Se preservan fotos por si el resultado de la importación fue ambiguo.');
      throw new Error(imported ? `Se importaron ${imported} registros antes del error. ${error.message}` : error.message);
    }
  }
  await recargar();
  return imported;
}

async function importarArchivo(file) {
  try {
    const data = JSON.parse(await file.text());
    const arr = Array.isArray(data) ? data : data.yerbas;
    if (!Array.isArray(arr)) throw new Error('El respaldo no contiene una lista de yerbas.');
    const items = arr.map(normalizar);
    if (!items.length) { toast('El archivo no tiene yerbas'); return; }
    if (!(await confirmar('Importar respaldo', `Se van a importar hasta ${items.length} yerba${items.length === 1 ? '' : 's'}. Los duplicados por nombre, marca y fecha se omiten.`, 'Importar'))) return;
    const count = await importarEnLotes(items);
    toast(`Se importaron ${count} yerbas; los duplicados se omitieron ✔`);
  } catch (error) {
    toast(`No pude importar el respaldo: ${error.message}`);
  }
}

async function migrarDatosLocales() {
  if (!('indexedDB' in window) || typeof indexedDB.databases !== 'function') {
    toast('Este navegador no permite comprobar si existe la base local. Probá con una versión reciente.');
    return;
  }
  try {
    const databases = await indexedDB.databases();
    if (!databases.some(database => database.name === 'yerbario')) {
      toast('No encontré datos locales para migrar.');
      return;
    }
    const legacy = await new Promise((resolve, reject) => {
      const request = indexedDB.open('yerbario');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('yerbas')) {
          database.close();
          reject(new Error('No encontré la colección local de yerbas.'));
          return;
        }
        const transaction = database.transaction('yerbas', 'readonly');
        const get = transaction.objectStore('yerbas').getAll();
        get.onsuccess = () => { database.close(); resolve(get.result); };
        get.onerror = () => { database.close(); reject(get.error); };
      };
    });
    if (!legacy.length) { toast('La base local no tiene yerbas para migrar.'); return; }
    if (!(await confirmar('Migrar datos de este navegador', `Se van a enviar ${legacy.length} yerba${legacy.length === 1 ? '' : 's'} al servidor. Los duplicados se omiten.`, 'Migrar'))) return;
    const items = [];
    for (const entry of legacy) {
      const item = normalizar(entry);
      item.fotos = await Promise.all((entry.fotos || []).map(photo => {
        if (typeof photo === 'string') return photo;
        if (photo instanceof Blob) return procesarImagen(photo).then(blobToDataURL);
        return null;
      }));
      item.fotos = item.fotos.filter(Boolean);
      items.push(item);
    }
    const count = await importarEnLotes(items);
    toast(`Migración terminada: ${count} yerbas importadas; los duplicados se omitieron ✔`);
  } catch (error) {
    toast(`No pude migrar los datos locales: ${error.message}`);
  }
}

async function cargarEjemplos() {
  const base = (o) => ({
    creado: Date.now(), actualizado: Date.now(), estado: 'probada', marca: '', tipo: '', origen: '', molienda: '', modo: 'Amargo',
    estacionamiento: null, gramos: 1000, precio: null, lugar: '', fecha: hoy(), recompra: '', favorita: false, pros: '', contras: '',
    notas: 'Dato de ejemplo: editalo o borralo cuando quieras.', tags: ['ejemplo'], fotos: [], general: 0,
    puntajes: { sabor: 0, aroma: 0, amargor: 0, espuma: 0, rendimiento: 0, polvo: 0, precio: 0 }, ...o,
  });
  const items = [
    base({ nombre: 'Tradicional con palo 1 kg', marca: 'Selva Verde', tipo: TIPOS[0], origen: 'Misiones', molienda: 'Media', precio: 9800, lugar: 'Supermercado', fecha: '2026-09-02',
      general: 4, recompra: 'si', favorita: true, pros: 'Sabor parejo, espuma buena.', contras: 'Un poco de polvo al final.',
      puntajes: { sabor: 4, aroma: 4, amargor: 4, espuma: 4.5, rendimiento: 4, polvo: 3, precio: 4 }, tags: ['ejemplo', 'mañana'] }),
    base({ nombre: 'Suave despalada', marca: 'Don Ceferino', tipo: TIPOS[1], origen: 'Corrientes', molienda: 'Fina', precio: 13500, lugar: 'Almacén', fecha: '2026-09-15',
      general: 3.5, recompra: 'tal', pros: 'Muy suave, ideal para arrancar el día.', contras: 'Se lava rápido.',
      puntajes: { sabor: 4, aroma: 3.5, amargor: 3, espuma: 3, rendimiento: 2.5, polvo: 3.5, precio: 3 }, tags: ['ejemplo', 'suave'] }),
    base({ nombre: 'Compuesta con menta y boldo', marca: 'Cerro Bravo', tipo: TIPOS[2], origen: 'Paraguay', molienda: 'Gruesa', gramos: 500, precio: 6200, lugar: 'Dietética', fecha: '2026-10-01',
      general: 3, recompra: 'tal', pros: 'Aroma fresco.', contras: 'Tapa la bombilla.',
      puntajes: { sabor: 3.5, aroma: 4.5, amargor: 3, espuma: 2.5, rendimiento: 3, polvo: 2, precio: 3.5 }, tags: ['ejemplo', 'tarde'] }),
    base({ nombre: 'Orgánica estacionada', marca: 'La Reserva', tipo: TIPOS[3], origen: 'Misiones', molienda: 'Media', gramos: 500, precio: 8900, lugar: 'Online', fecha: '2026-10-10', estacionamiento: 18,
      general: 4.5, recompra: 'si', favorita: true, pros: 'Gusto profundo y duradero.', contras: 'Cara.',
      puntajes: { sabor: 5, aroma: 4.5, amargor: 4.5, espuma: 4, rendimiento: 5, polvo: 4, precio: 3 }, tags: ['ejemplo', 'fin de semana'] }),
    base({ nombre: 'Barbacuá ahumada', marca: 'Selva Verde', estado: 'quiero', tipo: TIPOS[4], origen: 'Brasil', gramos: 500, fecha: '', notas: 'Dato de ejemplo: me la recomendaron para probar.', tags: ['ejemplo'] }),
  ];
  try {
    const count = await importarEnLotes(items);
    toast(count ? 'Datos de ejemplo cargados' : 'Los datos de ejemplo ya estaban cargados');
  } catch (error) {
    toast(`No pude cargar los ejemplos: ${error.message}`);
  }
}

async function borrarTodo() {
  if (!state.yerbas.length) { toast('No hay nada para borrar'); return; }
  if (!(await confirmar('¿Borrar todo?', 'Se eliminan TODAS tus yerbas y fotos del servidor. Si no hiciste un respaldo, no se pueden recuperar.', 'Borrar todo'))) return;
  try {
    await api('/api/yerbas', { method: 'DELETE', body: { confirm: true } });
    state.compare.clear();
    await recargar();
    toast('Todo borrado');
  } catch (error) {
    toast(`No pude borrar los datos: ${error.message}`);
  }
}

async function cerrarSesion() {
  try {
    await api('/api/logout', { method: 'POST' });
    state.yerbas = [];
    state.compare.clear();
    renderAll();
    mostrarLogin();
    toast('Sesión cerrada');
  } catch (error) {
    toast(`No pude cerrar la sesión: ${error.message}`);
  }
}

/* ---------- Eventos ---------- */
function bindEventos() {
  // Pestañas
  $$('.tab').forEach(t => t.addEventListener('click', () => cambiarVista(t.dataset.view)));

  // Tema
  $('#btn-theme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    ls.set('yerbario-theme', next);
  });

  // Nueva yerba
  $('#btn-new').addEventListener('click', () => abrirForm());

  // Menú de datos
  const menu = $('#menu-data'), btnData = $('#btn-data');
  const cerrarMenu = () => { menu.hidden = true; btnData.setAttribute('aria-expanded', 'false'); };
  btnData.addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; btnData.setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', e => { if (!e.target.closest('.menu')) cerrarMenu(); });
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    cerrarMenu();
    const action = ({
      'export-json': exportarJSON,
      'export-csv': exportarCSV,
      import: () => $('#file-import').click(),
      migrate: migrarDatosLocales,
      logout: cerrarSesion,
      seed: cargarEjemplos,
      wipe: borrarTodo,
    })[b.dataset.act];
    if (action) Promise.resolve().then(action).catch(error => toast(`No pude completar la acción: ${error.message}`));
  });
  $('#file-import').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importarArchivo(f); });

  // Estado vacío
  $('#empty').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'new') abrirForm();
    if (b.dataset.act === 'seed') cargarEjemplos();
  });

  // Filtros
  const filtro = (sel, key, parse = v => v) => $(sel).addEventListener('change', e => { state.filtros[key] = parse(e.target.value); renderGrid(); });
  $('#f-q').addEventListener('input', debounce(e => { state.filtros.q = e.target.value; renderGrid(); }));
  filtro('#f-estado', 'estado'); filtro('#f-tipo', 'tipo'); filtro('#f-origen', 'origen'); filtro('#f-tag', 'tag');
  filtro('#f-min', 'min', Number); filtro('#f-orden', 'orden');
  $('#f-fav').addEventListener('click', e => {
    state.filtros.fav = !state.filtros.fav;
    e.currentTarget.setAttribute('aria-pressed', state.filtros.fav);
    renderGrid();
  });
  $('#v-grid').addEventListener('click', () => setVista('grid'));
  $('#v-list').addEventListener('click', () => setVista('list'));

  // Tarjetas
  const grid = $('#grid');
  grid.addEventListener('click', e => {
    const fav = e.target.closest('[data-act="fav"]');
    if (fav) { e.stopPropagation(); toggleFav(+fav.closest('.card').dataset.id); return; }
    if (e.target.closest('.cmp')) return;
    const card = e.target.closest('.card');
    if (card) abrirDetalle(+card.dataset.id);
  });
  grid.addEventListener('change', e => {
    if (!e.target.matches('[data-act="cmp"]')) return;
    const id = +e.target.closest('.card').dataset.id;
    if (e.target.checked) {
      if (state.compare.size >= 3) { e.target.checked = false; toast('Podés comparar hasta 3 yerbas a la vez'); return; }
      state.compare.add(id);
    } else state.compare.delete(id);
    renderCompareBar();
  });
  grid.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('card')) abrirDetalle(+e.target.dataset.id);
  });

  // Comparación
  $('#compare-go').addEventListener('click', abrirComparar);
  $('#compare-clear').addEventListener('click', () => { state.compare.clear(); renderGrid(); renderCompareBar(); });

  // Cierre de diálogos
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-close]');
    if (c) {
      const d = c.closest('dialog');
      if (d.id === 'dlg-form') cerrarForm(); else d.close();
      return;
    }
    if (e.target instanceof HTMLDialogElement && ['dlg-detail', 'dlg-compare'].includes(e.target.id)) e.target.close();
  });
  $('#dlg-form').addEventListener('cancel', e => { if (state.dirty) { e.preventDefault(); cerrarForm(); } });
  $('#dlg-form').addEventListener('close', () => { state.formFotos = []; });
  $('#dlg-detail').addEventListener('close', () => { state.detailId = null; });

  // Detalle
  $('#detail-body').addEventListener('click', e => {
    const th = e.target.closest('[data-thumb]');
    if (th) {
      const i = +th.dataset.thumb;
      const url = state.yerbas.find(y => y.id === state.detailId)?.fotos?.[i];
      if (!url) return;
      $('#detail-main-img').src = url;
      $('#detail-main-link').href = url;
      $$('.detail-thumbs button').forEach((b, j) => b.classList.toggle('on', i === j));
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = state.detailId;
    if (b.dataset.act === 'd-fav') toggleFav(id);
    if (b.dataset.act === 'd-edit') { $('#dlg-detail').close(); abrirForm(id); }
    if (b.dataset.act === 'd-del') eliminar(id);
  });

  // Estadísticas: abrir detalle desde rankings
  $('#view-stats').addEventListener('click', e => {
    const li = e.target.closest('[data-open]');
    if (li) abrirDetalle(+li.dataset.open);
  });

  // Formulario
  const form = $('#form-yerba');
  form.addEventListener('submit', guardar);
  form.addEventListener('input', () => { state.dirty = true; });
  form.addEventListener('change', e => { state.dirty = true; if (e.target.name === 'estado') aplicarEstadoForm(); });
  form.elements.precio.addEventListener('input', actualizarPrecioKg);
  form.elements.gramos.addEventListener('input', actualizarPrecioKg);

  $('#btn-promedio').addEventListener('click', () => {
    const v = CRITERIOS.map(c => formStars[c.key].get()).filter(x => x > 0);
    if (!v.length) { toast('Primero puntuá algún criterio'); return; }
    formStars.general.set(Math.round(avg(v) * 2) / 2);
    state.dirty = true;
  });

  // Fotos
  const dz = $('#dropzone'), inp = $('#file-fotos');
  dz.addEventListener('click', () => inp.click());
  inp.addEventListener('change', () => { agregarFotos(inp.files); inp.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => agregarFotos(e.dataTransfer.files));
  $('#dlg-form').addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); agregarFotos(files); }
  });
  $('#thumbs').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const i = +b.dataset.i;
    if (b.dataset.act === 'rm') state.formFotos.splice(i, 1);
    if (b.dataset.act === 'cover') { const [p] = state.formFotos.splice(i, 1); state.formFotos.unshift(p); }
    state.dirty = true;
    renderThumbs();
  });

  // Atajos
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !e.target.closest('input, textarea, select') && !document.querySelector('dialog[open]')) {
      e.preventDefault();
      cambiarVista('coleccion');
      $('#f-q').focus();
    }
  });

  const cambiarModoAcceso = register => {
    $('#form-login').hidden = register;
    $('#form-register').hidden = !register;
    $('#dlg-login').setAttribute('aria-labelledby', register ? 'register-title' : 'login-title');
    $('#login-error').hidden = true;
    $('#register-error').hidden = true;
    $(`${register ? '#register-usuario' : '#login-usuario'}`).focus();
  };
  $('#show-register').addEventListener('click', () => cambiarModoAcceso(true));
  $('#show-login').addEventListener('click', () => cambiarModoAcceso(false));

  $('#form-login').addEventListener('submit', async e => {
    e.preventDefault();
    const button = $('#login-submit');
    const usuario = $('#login-usuario').value;
    const password = $('#login-password').value;
    const error = $('#login-error');
    button.disabled = true;
    error.hidden = true;
    try {
      await api('/api/login', { method: 'POST', body: { usuario, password } });
      $('#form-login').reset();
      $('#dlg-login').close();
      await recargar();
    } catch (reason) {
      error.textContent = reason.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  $('#form-register').addEventListener('submit', async e => {
    e.preventDefault();
    const button = $('#register-submit');
    const error = $('#register-error');
    const body = {
      usuario: $('#register-usuario').value,
      password: $('#register-password').value,
      codigo: $('#register-codigo').value,
    };
    button.disabled = true;
    error.hidden = true;
    try {
      await api('/api/register', { method: 'POST', body });
      $('#form-register').reset();
      $('#dlg-login').close();
      await recargar();
      toast('Cuenta creada ✔');
    } catch (reason) {
      error.textContent = reason.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
  $('#dlg-login').addEventListener('cancel', e => e.preventDefault());
}

/* ---------- Inicio ---------- */
async function init() {
  montarForm();
  bindEventos();
  setVista(state.vista);
  $('#empty').hidden = true;
  $('#grid').innerHTML = '<p class="loading" role="status">Conectando con Yerbario…</p>';
  try {
    await api('/api/session');
    await recargar();
  } catch (error) {
    if (!$('#dlg-login').open) {
      $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-art">⚠️</div><h2>No pude cargar tus datos</h2><p>${esc(error.message)}</p></div>`;
      if (!error.message.includes('conectar')) toast(error.message);
    }
  }
}

init();
