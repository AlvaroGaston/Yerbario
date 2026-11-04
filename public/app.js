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
const COLORES = ['#2f7d4f', '#d9822b', '#4a6fa5'];
const MODOS = ['Amargo', 'Dulce', 'Tereré', 'Cocido'];
const MATERIALES = ['Calabaza', 'Algarrobo', 'Palo santo', 'Madera', 'Cerámica', 'Vidrio', 'Acero inoxidable', 'Silicona', 'Imperial', 'Camionero', 'Torpedo'];
const MAX_MATES = 10;
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

// Los avisos se dibujan dentro del diálogo abierto (si hay uno): fuera de él quedan tapados por el fondo oscuro.
function toast(msg, { error = false } = {}) {
  const box = $('#toasts');
  const host = $$('dialog[open]').pop() || document.body;
  if (box.parentElement !== host) host.appendChild(box);
  const el = document.createElement('div');
  el.className = error ? 'toast toast-error' : 'toast';
  el.textContent = msg;
  el.title = 'Tocá para cerrar';
  el.addEventListener('click', () => el.remove());
  box.appendChild(el);
  setTimeout(() => el.remove(), error ? 10000 : 3200);
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
    state.cuenta = null;
    $('#aviso-cuenta').hidden = true;
    ['#dlg-detail', '#dlg-compare', '#dlg-form', '#dlg-email', '#dlg-post', '#dlg-perfil', '#dlg-lista'].forEach(selector => {
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
    error.mensaje = message; // sin el código HTTP, para mostrar en las pantallas de acceso
    error.code = data?.code;
    error.email = data?.email;
    throw error;
  }
  return data;
}

/* ---------- Acceso: ingresar, crear cuenta, confirmar correo, recuperar contraseña ---------- */
const VISTAS_ACCESO = {
  login: ['Iniciá sesión', 'Entrá con tu usuario o tu correo.'],
  registro: ['Creá tu cuenta', 'Vas a recibir un correo para confirmarla.'],
  pendiente: ['Revisá tu correo', ''],
  olvide: ['Recuperá tu contraseña', 'Te mandamos un enlace a tu correo para elegir una nueva.'],
  restablecer: ['Elegí una contraseña nueva', 'Después vas a entrar directo a tu diario.'],
};
const acceso = { emailPendiente: '', tokenRestablecer: '' };

function mensajeAcceso(texto, tipo = 'error', boton = null) {
  const box = $('#auth-msg');
  box.className = `auth-msg ${tipo}`;
  box.textContent = texto;
  if (boton) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link-btn';
    b.textContent = boton.texto;
    b.addEventListener('click', boton.accion);
    box.append(' ', b);
  }
  box.hidden = !texto;
}

function irAVista(vista, { conservarMensaje = false } = {}) {
  const [titulo, sub] = VISTAS_ACCESO[vista];
  $('#auth-title').textContent = titulo;
  $('#auth-sub').textContent = sub;
  $('#auth-sub').hidden = !sub;
  $$('#dlg-login .auth-view').forEach(v => { v.hidden = v.dataset.vista !== vista; });
  if (vista === 'pendiente') $('#auth-email-pendiente').textContent = acceso.emailPendiente;
  if (!conservarMensaje) mensajeAcceso('');
  $(`#dlg-login .auth-view[data-vista="${vista}"] input`)?.focus();
}

function mostrarLogin(vista = 'login') {
  const dialog = $('#dlg-login');
  irAVista(vista);
  if (!dialog.open) dialog.showModal();
}

// Ejecuta un envío de formulario de acceso con el botón deshabilitado y el error visible.
async function enviarAcceso(form, accion) {
  const boton = $('button[type="submit"], [data-act="reenviar"]', form);
  const texto = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Un momento…';
  mensajeAcceso('');
  try {
    await accion();
  } catch (error) {
    mensajeAcceso(error.mensaje || error.message);
  } finally {
    boton.disabled = false;
    boton.textContent = texto;
  }
}

async function entrarALaApp(mensaje) {
  $$('#dlg-login form').forEach(f => f.reset());
  $('#dlg-login').close();
  await cargarCuenta();
  await recargar();
  if (mensaje) toast(mensaje);
}

async function reenviarVerificacion(identificador) {
  const r = await api('/api/cuenta?accion=reenviar', { method: 'POST', body: { identificador } });
  return r.mensaje;
}

function bindAcceso() {
  const dlg = $('#dlg-login');
  dlg.addEventListener('cancel', e => e.preventDefault());
  dlg.addEventListener('click', e => {
    const ir = e.target.closest('[data-ir]');
    if (ir) { irAVista(ir.dataset.ir); return; }
    const ver = e.target.closest('.pass-toggle');
    if (ver) {
      const input = ver.previousElementSibling;
      const mostrar = input.type === 'password';
      input.type = mostrar ? 'text' : 'password';
      ver.textContent = mostrar ? 'Ocultar' : 'Ver';
      ver.setAttribute('aria-pressed', String(mostrar));
      ver.setAttribute('aria-label', mostrar ? 'Ocultar contraseña' : 'Mostrar contraseña');
    }
  });

  const vista = v => $(`#dlg-login .auth-view[data-vista="${v}"]`);

  vista('login').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.currentTarget;
    const identificador = f.identificador.value.trim();
    const password = f.password.value;
    if (!identificador || !password) { mensajeAcceso('Completá tu usuario o correo y la contraseña.'); return; }
    enviarAcceso(f, async () => {
      try {
        await api('/api/login', { method: 'POST', body: { identificador, password } });
        await entrarALaApp();
      } catch (error) {
        if (error.code !== 'email_no_verificado') throw error;
        acceso.emailPendiente = error.email || identificador;
        mensajeAcceso(error.mensaje, 'info', {
          texto: 'Reenviar el correo',
          accion: async () => {
            try { mensajeAcceso(await reenviarVerificacion(identificador), 'ok'); }
            catch (err) { mensajeAcceso(err.mensaje || err.message); }
          },
        });
      }
    });
  });

  vista('registro').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.currentTarget;
    const body = { email: f.email.value.trim(), usuario: f.usuario.value.trim(), password: f.password.value, password2: f.password2.value };
    if (!body.email || !body.usuario || !body.password || !body.password2) { mensajeAcceso('Completá todos los campos.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email)) { mensajeAcceso('Revisá el correo: no parece válido.'); f.email.focus(); return; }
    if (body.password.length < 8) { mensajeAcceso('La contraseña tiene que tener al menos 8 caracteres.'); f.password.focus(); return; }
    if (body.password !== body.password2) { mensajeAcceso('Las contraseñas no coinciden.'); f.password2.focus(); return; }
    enviarAcceso(f, async () => {
      const r = await api('/api/register', { method: 'POST', body });
      acceso.emailPendiente = r.email;
      f.reset();
      irAVista('pendiente');
    });
  });

  vista('pendiente').addEventListener('click', e => {
    if (!e.target.closest('[data-act="reenviar"]')) return;
    enviarAcceso(vista('pendiente'), async () => {
      mensajeAcceso(await reenviarVerificacion(acceso.emailPendiente), 'ok');
    });
  });

  vista('olvide').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.currentTarget;
    const email = f.email.value.trim();
    if (!email) { mensajeAcceso('Escribí el correo de tu cuenta.'); return; }
    enviarAcceso(f, async () => {
      const r = await api('/api/cuenta?accion=recuperar', { method: 'POST', body: { email } });
      f.reset();
      irAVista('login');
      mensajeAcceso(r.mensaje, 'ok');
    });
  });

  vista('restablecer').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.currentTarget;
    const body = { token: acceso.tokenRestablecer, password: f.password.value, password2: f.password2.value };
    if (body.password.length < 8) { mensajeAcceso('La contraseña tiene que tener al menos 8 caracteres.'); return; }
    if (body.password !== body.password2) { mensajeAcceso('Las contraseñas no coinciden.'); return; }
    enviarAcceso(f, async () => {
      await api('/api/cuenta?accion=restablecer', { method: 'POST', body });
      acceso.tokenRestablecer = '';
      await entrarALaApp('Contraseña actualizada ✔');
    });
  });

  // Agregar o cambiar el correo de la cuenta (para cuentas creadas antes de pedir correo).
  $('#form-email').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.currentTarget;
    const msg = $('#email-msg');
    const boton = $('button[type="submit"]', f);
    boton.disabled = true;
    msg.hidden = true;
    try {
      await api('/api/cuenta?accion=email', { method: 'POST', body: { email: f.email.value.trim() } });
      $('#dlg-email').close();
      await cargarCuenta();
      toast('Te mandamos un correo para confirmarlo ✉️');
    } catch (error) {
      msg.className = 'auth-msg error';
      msg.textContent = error.mensaje || error.message;
      msg.hidden = false;
    } finally {
      boton.disabled = false;
    }
  });
  $('#aviso-cuenta').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'agregar-email') abrirDialogoEmail();
    if (b.dataset.act === 'reenviar-email') {
      reenviarVerificacion(state.cuenta.email)
        .then(m => toast(m))
        .catch(err => toast(err.mensaje || err.message, { error: true }));
    }
  });
}

function abrirDialogoEmail() {
  const f = $('#form-email');
  f.reset();
  f.email.value = state.cuenta?.email || '';
  $('#email-msg').hidden = true;
  $('#dlg-email').showModal();
  f.email.focus();
}

// Datos de la cuenta y aviso si falta el correo o no está confirmado.
async function cargarCuenta() {
  state.cuenta = await api('/api/session');
  const aviso = $('#aviso-cuenta');
  const c = state.cuenta;
  if (!c.email) {
    aviso.innerHTML = '<span>✉️ Tu cuenta no tiene correo. Agregalo para poder recuperar la contraseña si te la olvidás.</span><button type="button" class="btn primary sm" data-act="agregar-email">Agregar correo</button>';
  } else if (!c.email_verificado) {
    aviso.innerHTML = `<span>✉️ Confirmá tu correo <b>${esc(c.email)}</b> con el enlace que te enviamos.</span><button type="button" class="btn ghost sm" data-act="reenviar-email">Reenviar</button><button type="button" class="btn ghost sm" data-act="agregar-email">Cambiar</button>`;
  } else {
    aviso.innerHTML = '';
  }
  aviso.hidden = !aviso.innerHTML;
  window.alCargarCuenta?.(); // social.js: avatar, notificaciones y navegación
}

// Enlaces de los correos: /?verificar=TOKEN y /?restablecer=TOKEN.
// Se procesan desde la página (no con un GET directo a la API) para que los
// antivirus de correo que abren los enlaces solos no gasten el token.
async function procesarEnlaceDeCorreo() {
  const params = new URLSearchParams(location.search);
  const verificar = params.get('verificar');
  const restablecer = params.get('restablecer');
  if (!verificar && !restablecer) return false;
  history.replaceState(null, '', location.pathname);
  if (restablecer) {
    acceso.tokenRestablecer = restablecer;
    mostrarLogin('restablecer');
    return true;
  }
  try {
    await api('/api/cuenta?accion=verificar', { method: 'POST', body: { token: verificar } });
    await cargarCuenta();
    await recargar();
    toast('¡Correo confirmado! Bienvenido a Yerbario 🧉');
  } catch (error) {
    mostrarLogin('login');
    mensajeAcceso(error.mensaje || error.message);
  }
  return true;
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
  filtros: { q: '', estado: 'todas', tipo: '', min: 0, fav: false, orden: 'recientes' },
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
}

function filtradas() {
  const f = state.filtros, q = f.q.trim().toLowerCase();
  const lista = state.yerbas.filter(y => {
    if (f.estado !== 'todas' && y.estado !== f.estado) return false;
    if (f.tipo && y.tipo !== f.tipo) return false;
    if (f.fav && !y.favorita) return false;
    if (f.min && !(y.general >= f.min)) return false;
    if (q) {
      const hay = [y.nombre, y.marca, y.notas, y.tipo, y.modo, ...(y.mates || []).flatMap(m => [m.material, m.notas])].join(' ').toLowerCase();
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
        ${!quiero && y.primer_mate ? `<span class="chip" title="Primer mate">1.er mate ${fmtRate(y.primer_mate)} ★</span>` : ''}
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

// Muestra una sección (inicio, coleccion, stats, buscar, perfil, notifs). La navegación
// la maneja el router de social.js con el hash de la URL (#/inicio, #/u/usuario…).
function cambiarVista(v) {
  state.view = v;
  $$('.tab').forEach(t => { const on = t.dataset.view === v; t.classList.toggle('is-active', on); t.setAttribute('aria-selected', on); });
  $$('main > section').forEach(s => { s.hidden = s.id !== `view-${v}`; });
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
  const hechos = [
    ['Tipo', y.tipo],
    ['Cómo la tomé', y.modo],
    ['Contenido', y.gramos ? `${y.gramos} g` : ''],
    ['Precio', y.precio != null ? money(y.precio) : ''],
    ['Precio por kg', kg ? money(kg) : ''],
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
        ${y.favorita ? '<div class="badges"><span class="badge">♥ Favorita</span></div>' : ''}
        ${hechos.length ? `<dl class="facts">${hechos.map(h => `<div><dt>${h[0]}</dt><dd>${esc(h[1])}</dd></div>`).join('')}</dl>` : ''}
        ${!quiero ? (() => {
          const p = y.puntajes || {};
          const filaRo = (label, v) => `<li><span>${label}</span><span>${stars(v, 'sm')} <span class="v">${v ? fmtRate(v) : '—'}</span></span></li>`;
          const hayCriterios = CRITERIOS.some(c => p[c.key] > 0);
          return `
          <div class="detail-block">
            <h4>Valoración</h4>
            <div class="score-wrap">
              <ul class="crit-ro">${filaRo('Primer mate', y.primer_mate)}${CRITERIOS.map(c => filaRo(c.label, p[c.key])).join('')}</ul>
              ${hayCriterios ? radarSVG([{ values: p, color: COLORES[0] }], { size: 360 }) : ''}
            </div>
          </div>`;
        })() : ''}
        ${!quiero && y.mates?.length ? `<div class="detail-block"><h4>Mates en los que la tomé</h4>${matesHTML(y.mates)}</div>` : ''}
        ${y.notas ? `<div class="notes"><h4>Notas</h4><p>${esc(y.notas)}</p></div>` : ''}
        ${!quiero && y.likes != null ? `<div class="detail-social">
          <span>♥ ${y.likes} me gusta</span><span>💬 ${y.comentarios} comentario${y.comentarios === 1 ? '' : 's'}</span>
          <button type="button" class="link-btn" data-act="d-post">Ver publicación</button>
        </div>` : ''}
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
    fila('Primer mate', y => y.primer_mate, (y, v) => v ? `${stars(v, 'sm')} ${fmtRate(v)}` : '—', 'max'),
    ...CRITERIOS.map(c => fila(c.label, y => y.puntajes?.[c.key], (y, v) => v ? `${stars(v, 'sm')} ${fmtRate(v)}` : '—', 'max')),
    fila('Precio', y => y.precio, (y, v) => money(v), 'min'),
    fila('Precio por kg', y => precioKg(y), (y, v) => v ? money(v) : '—', 'min'),
    fila('Contenido', y => y.gramos, (y, v) => v ? `${v} g` : '—'),
    fila('Tipo', y => y.tipo, (y, v) => txt(v)),
    fila('Cómo la tomé', y => y.modo, (y, v) => txt(v)),
    fila('Mates', y => y.mates || [], (y, v) => v.length
      ? v.map(m => `${esc(m.material)}${m.puntaje ? ` · ${fmtRate(m.puntaje)} ★` : ''}`).join('<br>') : '—'),
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
  f.modo.innerHTML = opciones(MODOS, '— elegir —');
  $('#crit-list').insertAdjacentHTML('beforeend', CRITERIOS.map(c =>
    `<div class="crit-row"><div class="crit-name"><b>${c.label}</b><small>${c.hint}</small></div><div data-crit="${c.key}"></div></div>`).join(''));
  $$('#form-yerba [data-crit]').forEach(el => {
    formStars[el.dataset.crit] = mountStarInput(el, 0, () => { state.dirty = true; });
  });
}

/* ---------- Mates del formulario ---------- */
const mateStars = new WeakMap();

function agregarFilaMate(m = {}) {
  const list = $('#mates-list');
  if (list.children.length >= MAX_MATES) { toast(`Hasta ${MAX_MATES} mates por yerba`); return; }
  const row = document.createElement('div');
  row.className = 'mate-row';
  row.innerHTML = `
    <div class="mate-top">
      <label class="f">Tipo de mate
        <input class="mate-material" list="dl-materiales" maxlength="40" placeholder="Ej: Calabaza, Algarrobo…">
      </label>
      <div class="mate-stars"><span class="mate-stars-label">Puntaje en este mate</span><div class="mate-star-input"></div></div>
      <button type="button" class="icon-btn mate-x" data-act="rm-mate" aria-label="Quitar este mate">✕</button>
    </div>
    <label class="f">Diferencias / notas
      <textarea class="mate-notas" rows="2" maxlength="400" placeholder="Qué cambió con este mate: sabor, temperatura, espuma…"></textarea>
    </label>`;
  $('.mate-material', row).value = m.material ?? '';
  $('.mate-notas', row).value = m.notas ?? '';
  mateStars.set(row, mountStarInput($('.mate-star-input', row), m.puntaje ?? 0, () => { state.dirty = true; }));
  list.appendChild(row);
  return row;
}

function leerMates() {
  return $$('#mates-list .mate-row').map(row => ({
    material: $('.mate-material', row).value.trim(),
    puntaje: mateStars.get(row).get(),
    notas: $('.mate-notas', row).value.trim(),
  })).filter(m => m.material || m.notas || m.puntaje);
}

function matesHTML(lista) {
  return `<ul class="mates-ro">${lista.map(m => `<li>
    <div class="mates-ro-head"><b>${esc(m.material)}</b><span>${stars(m.puntaje, 'sm')} <span class="v">${m.puntaje ? fmtRate(m.puntaje) : '—'}</span></span></div>
    ${m.notas ? `<p>${esc(m.notas)}</p>` : ''}</li>`).join('')}</ul>`;
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
  f.gramos.value = y?.gramos ?? '';
  f.precio.value = y?.precio ?? '';
  f.fecha.value = y ? (y.fecha ?? '') : hoy();
  f.favorita.checked = !!y?.favorita;
  f.notas.value = y?.notas ?? '';
  f.modo.value = y?.modo ?? '';
  $('#mates-list').innerHTML = '';
  (y?.mates || []).forEach(m => agregarFilaMate(m));
  const materiales = [...new Set([...MATERIALES, ...state.yerbas.flatMap(x => (x.mates || []).map(m => m.material))].filter(Boolean))];
  $('#dl-materiales').innerHTML = materiales.map(m => `<option value="${esc(m)}">`).join('');

  formStars.primer_mate.set(y?.primer_mate ?? 0);
  CRITERIOS.forEach(c => formStars[c.key].set(y?.puntajes?.[c.key] ?? 0));
  formStars.general.set(y?.general ?? 0);
  mostrarErrorForm('');

  $('#dl-marcas').innerHTML = [...new Set(state.yerbas.map(x => x.marca).filter(Boolean))].map(m => `<option value="${esc(m)}">`).join('');

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

// Muestra el error dentro del formulario, al lado de los botones, para que no se pierda.
function mostrarErrorForm(msg) {
  const el = $('#form-error');
  el.textContent = msg;
  el.hidden = !msg;
}

async function guardar(e) {
  e.preventDefault();
  const submit = $('#form-yerba button[type="submit"]');
  if (submit.disabled) return;
  const f = $('#form-yerba').elements;
  const nombre = f.nombre.value.trim();
  if (!nombre) { f.nombre.focus(); mostrarErrorForm('Poné el nombre de la yerba.'); return; }
  mostrarErrorForm('');

  const estado = f.estado.value;
  const mates = estado === 'probada' ? leerMates() : [];
  if (mates.some(m => !m.material)) {
    mostrarErrorForm('Poné el tipo de mate (calabaza, algarrobo…) en cada mate que agregaste.');
    $$('#mates-list .mate-material').find(i => !i.value.trim())?.focus();
    return;
  }
  const num = v => (v === '' || v == null || isNaN(+v)) ? null : +v;
  const prev = state.editingId != null ? state.yerbas.find(x => x.id === state.editingId) : null;
  // Al editar se conservan los datos que ya no muestra el formulario (yerbas cargadas con la versión anterior).
  const { id: ignorado, creado, actualizado, ...anterior } = prev || {};

  const obj = {
    ...anterior,
    estado, nombre,
    marca: f.marca.value.trim(),
    tipo: f.tipo.value,
    gramos: num(f.gramos.value),
    precio: num(f.precio.value),
    fecha: estado === 'probada' ? (f.fecha.value || hoy()) : '',
    modo: estado === 'probada' ? f.modo.value : (anterior.modo ?? ''),
    mates: estado === 'probada' ? mates : (anterior.mates ?? []),
    primer_mate: formStars.primer_mate.get(),
    puntajes: Object.fromEntries(CRITERIOS.map(c => [c.key, formStars[c.key].get()])),
    general: formStars.general.get(),
    favorita: f.favorita.checked,
    notas: f.notas.value.trim(),
    fotos: [],
  };

  const uploaded = [];
  let fotoError = null;
  let persisted = false;
  let saveAttempted = false;
  submit.disabled = true;
  submit.textContent = 'Guardando…';
  try {
    // Si una foto no se puede subir, la yerba se guarda igual (sin esa foto) y se avisa el motivo.
    for (const photo of state.formFotos) {
      if (photo.existing) { obj.fotos.push(photo.url); continue; }
      if (fotoError) continue;
      try {
        const url = await subirFoto(photo.blob);
        uploaded.push(url);
        obj.fotos.push(url);
      } catch (error) {
        if (error.status === 401) throw error;
        fotoError = error;
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
    if (fotoError) toast(`La yerba se guardó, pero sin las fotos nuevas: ${fotoError.message}`, { error: true });
    else toast(prev ? 'Cambios guardados' : 'Yerba guardada 🧉');
    if (state.detailId === saved.id && $('#dlg-detail').open) abrirDetalle(saved.id);
  } catch (error) {
    const safeToDelete = !saveAttempted || (error.status && error.status < 500);
    if (safeToDelete) for (const url of uploaded) {
      try { await api('/api/fotos', { method: 'DELETE', body: { url } }); }
      catch { console.error('No se pudo limpiar una foto recién subida.'); }
    }
    else if (!persisted && uploaded.length) console.error('No se borran las fotos porque el resultado del guardado pudo ser ambiguo.');
    console.error('Error al guardar la yerba:', error);
    if (persisted) toast(`La yerba se guardó, pero no pude actualizar la lista: ${error.message}`, { error: true });
    else mostrarErrorForm(`No pude guardar la yerba: ${error.message}`);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Guardar yerba';
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
  const conPrimerMate = probadas.filter(y => y.primer_mate > 0);
  const promPrimer = avg(conPrimerMate.map(y => y.primer_mate));

  const top = [...rated].sort((a, b) => b.general - a.general).slice(0, 5);
  const topPrimer = [...conPrimerMate].sort((a, b) => b.primer_mate - a.primer_mate).slice(0, 5);
  const valor = probadas.filter(y => y.puntajes?.precio > 0).sort((a, b) => b.puntajes.precio - a.puntajes.precio).slice(0, 3);
  const perfil = {};
  CRITERIOS.forEach(c => { perfil[c.key] = avg(probadas.map(y => y.puntajes?.[c.key]).filter(v => v > 0)) || 0; });
  const hayPerfil = Object.values(perfil).some(v => v > 0);

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

  const porTipo = agrupar(probadas, y => y.tipo).filter(g => g.prom != null).sort((a, b) => b.prom - a.prom);
  const porMarca = agrupar(probadas, y => y.marca).filter(g => g.prom != null).sort((a, b) => b.prom - a.prom || b.n - a.n).slice(0, 8);
  // Promedio del puntaje de cada tipo de mate, juntando todas las yerbas (sin distinguir mayúsculas).
  const matesPorTipo = new Map();
  probadas.flatMap(y => y.mates || []).filter(m => m.puntaje > 0).forEach(m => {
    const k = m.material.trim().toLowerCase();
    if (!matesPorTipo.has(k)) matesPorTipo.set(k, { label: m.material.trim(), vals: [] });
    matesPorTipo.get(k).vals.push(m.puntaje);
  });
  const porMate = [...matesPorTipo.values()].map(g => ({ label: g.label, value: avg(g.vals), n: g.vals.length })).sort((a, b) => b.value - a.value || b.n - a.n);

  root.innerHTML = `
    <div class="kpis">
      <div class="kpi"><span class="kpi-n">${probadas.length}</span><span class="kpi-l">yerbas probadas</span></div>
      <div class="kpi"><span class="kpi-n">${quiero.length}</span><span class="kpi-l">en la lista de deseos</span></div>
      <div class="kpi"><span class="kpi-n">${prom != null ? fmtRate(prom) + ' ★' : '—'}</span><span class="kpi-l">puntaje promedio</span></div>
      <div class="kpi"><span class="kpi-n">${promPrimer != null ? fmtRate(promPrimer) + ' ★' : '—'}</span><span class="kpi-l">primer mate promedio</span></div>
      <div class="kpi"><span class="kpi-n">${money(gasto)}</span><span class="kpi-l">gastado en total</span></div>
      <div class="kpi"><span class="kpi-n">${promKg != null ? money(promKg) : '—'}</span><span class="kpi-l">precio promedio por kg</span></div>
      <div class="kpi"><span class="kpi-n">${favs}</span><span class="kpi-l">favoritas</span></div>
    </div>

    <div class="panels">
      <section class="panel"><h3>🏆 Mi top 5</h3><p class="sub">Las mejor puntuadas</p>${rankHTML(top, y => fmtRate(y.general) + ' ★')}</section>

      <section class="panel"><h3>🧉 Mejor primer mate</h3><p class="sub">Las que mejor arrancan</p>${rankHTML(topPrimer, y => fmtRate(y.primer_mate) + ' ★')}</section>

      <section class="panel"><h3>💸 Mejor relación precio / calidad</h3><p class="sub">Según tu criterio de precio</p>${rankHTML(valor, y => fmtRate(y.puntajes.precio) + ' ★')}</section>

      <section class="panel"><h3>Tu paladar</h3><p class="sub">Promedio de cada criterio en todas tus yerbas</p>
        ${hayPerfil ? radarSVG([{ values: perfil, color: COLORES[0] }], { size: 360 }) : '<p class="muted small">Cargá puntajes por criterio para ver tu perfil.</p>'}
      </section>

      <section class="panel"><h3>Distribución de puntajes</h3><p class="sub">Cuántas yerbas recibieron cada nota</p>
        ${rated.length ? `<div class="hist">${cubos.map(c => `<div class="col ${c.n ? '' : 'vacia'}"><span class="n">${c.n || ''}</span><span class="track"><span class="bar" style="height:${(c.n / maxN) * 100}%"></span></span><span class="x">${fmtRate(c.v).replace(',0', '')}</span></div>`).join('')}</div>` : '<p class="muted small">Puntuá alguna yerba para ver esto.</p>'}
      </section>

      <section class="panel"><h3>Yerbas probadas por mes</h3><p class="sub">Últimos 12 meses</p>
        <div class="hist">${meses.map(m => `<div class="col ${m.n ? '' : 'vacia'}"><span class="n">${m.n || ''}</span><span class="track"><span class="bar" style="height:${(m.n / maxM) * 100}%"></span></span><span class="x">${m.label}</span></div>`).join('')}</div>
      </section>

      <section class="panel"><h3>Promedio por tipo</h3><p class="sub">Qué tipo de yerba te gusta más</p>
        ${barList(porTipo.map(g => ({ label: g.label, value: g.prom, n: g.n })), 5, i => `${fmtRate(i.value)} ★ · ${i.n}`)}
      </section>

      <section class="panel"><h3>Promedio por marca</h3><p class="sub">Top 8 (el número es cuántas probaste)</p>
        ${barList(porMarca.map(g => ({ label: g.label, value: g.prom, n: g.n })), 5, i => `${fmtRate(i.value)} ★ · ${i.n}`)}
      </section>

      <section class="panel"><h3>Promedio por tipo de mate</h3><p class="sub">En qué mate te gusta más (el número es cuántas veces lo puntuaste)</p>
        ${barList(porMate, 5, i => `${fmtRate(i.value)} ★ · ${i.n}`)}
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
  const cab = ['Nombre', 'Marca', 'Estado', 'Tipo', 'Contenido (g)', 'Precio', 'Precio por kg', 'Fecha', 'Cómo la tomé', 'Primer mate', ...CRITERIOS.map(c => c.label), 'General', 'Favorita', 'Mates', 'Notas'];
  const cel = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const filas = state.yerbas.map(y => [
    y.nombre, y.marca, y.estado === 'probada' ? 'Probada' : 'Quiero probar', y.tipo, y.gramos, y.precio,
    precioKg(y) ? Math.round(precioKg(y)) : '', y.fecha, y.modo, y.primer_mate || '', ...CRITERIOS.map(c => y.puntajes?.[c.key] || ''), y.general || '', y.favorita ? 'Sí' : '',
    (y.mates || []).map(m => `${m.material}${m.puntaje ? ` (${fmtRate(m.puntaje)})` : ''}${m.notas ? `: ${m.notas}` : ''}`).join(' | '), y.notas,
  ].map(cel).join(';'));
  const csv = '﻿' + [cab.map(cel).join(';'), ...filas].join('\r\n');
  descargar(`yerbario-${hoy()}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}

function normalizar(r) {
  const puntajes = r.puntajes ?? { sabor: 0, aroma: 0, amargor: 0, espuma: 0, rendimiento: 0, polvo: 0, precio: 0 };
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
    primer_mate: r.primer_mate ?? 0,
    mates: r.mates ?? [],
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
    creado: Date.now(), actualizado: Date.now(), estado: 'probada', marca: '', tipo: '',
    gramos: 1000, precio: null, fecha: hoy(), favorita: false,
    notas: 'Dato de ejemplo: editalo o borralo cuando quieras.', fotos: [], general: 0, primer_mate: 0, ...o,
  });
  const items = [
    base({ nombre: 'Tradicional con palo 1 kg', marca: 'Selva Verde', tipo: TIPOS[0], precio: 9800, fecha: '2026-09-02',
      general: 4, primer_mate: 4.5, favorita: true, notas: 'Dato de ejemplo: sabor parejo, buena espuma.' }),
    base({ nombre: 'Suave despalada', marca: 'Don Ceferino', tipo: TIPOS[1], precio: 13500, fecha: '2026-09-15',
      general: 3.5, primer_mate: 3, notas: 'Dato de ejemplo: muy suave, se lava rápido.' }),
    base({ nombre: 'Compuesta con menta y boldo', marca: 'Cerro Bravo', tipo: TIPOS[2], gramos: 500, precio: 6200, fecha: '2026-10-01',
      general: 3, primer_mate: 4 }),
    base({ nombre: 'Orgánica', marca: 'La Reserva', tipo: TIPOS[3], gramos: 500, precio: 8900, fecha: '2026-10-10',
      general: 4.5, primer_mate: 5, favorita: true }),
    base({ nombre: 'Barbacuá ahumada', marca: 'Selva Verde', estado: 'quiero', tipo: TIPOS[4], gramos: 500, fecha: '', notas: 'Dato de ejemplo: me la recomendaron para probar.' }),
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
    state.cuenta = null;
    state.compare.clear();
    $('#aviso-cuenta').hidden = true;
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
  $$('.tab').forEach(t => t.addEventListener('click', () => { location.hash = `#/${t.dataset.view}`; }));

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
      email: abrirDialogoEmail,
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
  filtro('#f-estado', 'estado'); filtro('#f-tipo', 'tipo');
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
    if (e.target instanceof HTMLDialogElement && ['dlg-detail', 'dlg-compare', 'dlg-post', 'dlg-lista'].includes(e.target.id)) e.target.close();
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
    if (b.dataset.act === 'd-post') { $('#dlg-detail').close(); window.abrirPost?.(id); }
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

  $('#btn-add-mate').addEventListener('click', () => {
    const row = agregarFilaMate();
    if (row) { $('.mate-material', row).focus(); state.dirty = true; }
  });
  $('#mates-list').addEventListener('click', e => {
    const b = e.target.closest('[data-act="rm-mate"]');
    if (!b) return;
    b.closest('.mate-row').remove();
    state.dirty = true;
  });

  $('#btn-promedio').addEventListener('click', () => {
    const v = ['primer_mate', ...CRITERIOS.map(c => c.key)].map(k => formStars[k].get()).filter(x => x > 0);
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
      location.hash = '#/coleccion';
      setTimeout(() => $('#f-q').focus(), 0);
    }
  });

  bindAcceso();
}

/* ---------- Inicio ---------- */
async function init() {
  montarForm();
  bindEventos();
  setVista(state.vista);
  $('#empty').hidden = true;
  $('#grid').innerHTML = '<p class="loading" role="status">Conectando con Yerbario…</p>';
  try {
    if (await procesarEnlaceDeCorreo()) return;
    await cargarCuenta();
    await recargar();
  } catch (error) {
    if (!$('#dlg-login').open) {
      $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="empty-art">⚠️</div><h2>No pude cargar tus datos</h2><p>${esc(error.message)}</p></div>`;
      if (!error.message.includes('conectar')) toast(error.message);
    }
  }
}

init();
