// Hoja de vida del cliente (/hv), pensada para abrirse como Dashboard App dentro de Chatwoot.
//
// Autenticación:
//  - Dentro de Chatwoot: la página /hv recibe el contexto por postMessage y llama a POST /hv/sesion con la clave
//    CHATWOOT_HV_SECRET (que va en la URL registrada en Chatwoot) y el correo del agente. El servidor entrega una
//    cookie propia "ferreobras_hv", firmada, limitada a /hv y con SameSite=None; Secure en producción.
//    Esa cookie no da acceso al resto de la aplicación y no reemplaza la sesión normal.
//  - Por fuera de Chatwoot: se usa la sesión normal de la aplicación (login de línea o administrador).
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const mun = require('./municipios');

// ---------- campos de la hoja (para cambiar el formulario solo se edita esta lista) ----------
// Sección normal: sus campos se guardan en datos.<id del campo>.
// Sección repetible (repetible: true): lista de 1 a N bloques guardada en datos.<id de la sección> = [{ id, ...campos }].
// Campo:
//   tipo: 'texto' | 'celular' | 'lista' | 'area'
//   identidad: es el celular que identifica la hoja; se muestra fijo y no se guarda en datos (va en la columna celular)
//   desdeChatwoot: se toma del contacto de Chatwoot y se muestra como solo lectura cuando hay contexto
//   sugerencias: 'municipios' muestra el catálogo de municipios mientras se escribe
const CAMPOS = [
  {
    id: 'cliente',
    seccion: 'Datos del cliente o empresa',
    campos: [
      { id: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, max: 160, desdeChatwoot: 'nombre', ayudaChatwoot: 'Tal como está guardado en Chatwoot' },
      { id: 'celular', etiqueta: 'Celular', tipo: 'celular', identidad: true, ayudaChatwoot: 'Tomado del contacto en Chatwoot' },
      { id: 'direccion', etiqueta: 'Dirección', tipo: 'texto', requerido: true, max: 300 },
      { id: 'notas', etiqueta: 'Notas', tipo: 'area', max: 2000 },
    ],
  },
  {
    id: 'obras',
    seccion: 'Obras',
    repetible: true,
    etiquetaItem: 'Obra',
    minimo: 1,
    maximo: 30,
    campos: [
      { id: 'residente', etiqueta: 'Nombre del residente de obra', tipo: 'texto', requerido: true, max: 160 },
      { id: 'nit', etiqueta: 'NIT / Cédula para facturación', tipo: 'texto', max: 30, placeholder: '900123456-7' },
      { id: 'celular', etiqueta: 'Celular', tipo: 'celular', requerido: true },
      { id: 'direccion', etiqueta: 'Dirección de la obra', tipo: 'texto', requerido: true, max: 300 },
      { id: 'municipio', etiqueta: 'Municipio', tipo: 'texto', requerido: true, max: 160, sugerencias: 'municipios' },
      { id: 'notas', etiqueta: 'Notas', tipo: 'area', max: 2000 },
    ],
  },
];

// ---------- configuración ----------
const leer = (n) => String(process.env[n] || '').replace(/\r|\n/g, '').trim().replace(/^(["'])(.*)\1$/, '$2');
const PRODUCCION = process.env.NODE_ENV === 'production';
function origenChatwoot() {
  try { return new URL(leer('CHATWOOT_ORIGIN') || 'https://ferreaceros.praxisia.org').origin; } catch (e) { return 'https://ferreaceros.praxisia.org'; }
}
const CHATWOOT_ORIGIN = origenChatwoot();
const SECRETO_HV = leer('CHATWOOT_HV_SECRET');
const SECRETO_COOKIE = process.env.SESSION_SECRET || 'cambiar';
const COOKIE = 'ferreobras_hv';
const DURACION_MS = 12 * 60 * 60 * 1000;
// Versión de los archivos estáticos de la vista: cambia en cada arranque (despliegue) para que el navegador
// no use un hv.js o hv.css viejo guardado en caché junto a una plantilla nueva.
const VERSION_ESTATICOS = Date.now().toString(36);
if (!SECRETO_HV) console.warn(`[hv] CHATWOOT_HV_SECRET no está definida: ${PRODUCCION ? 'el acceso desde Chatwoot queda deshabilitado' : 'en desarrollo se acepta el contexto sin clave'}`);

// ---------- esquema (idempotente; se ejecuta al arrancar) ----------
async function asegurarEsquema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS hojas_vida (
      id                  SERIAL PRIMARY KEY,
      celular             TEXT NOT NULL UNIQUE,
      datos               JSONB NOT NULL DEFAULT '{}',
      chatwoot_contact_id INTEGER,
      creado_por          TEXT,
      actualizado_por     TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`);
}

// ---------- utilidades ----------
// "+57 312 332 3123", "573123323123@c.us", "3123323123" -> "3123323123". Devuelve null si no son 10 dígitos.
function normalizarCelular(v) {
  let d = String(v == null ? '' : v).split('@')[0].replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
  return /^\d{10}$/.test(d) ? d : null;
}
const iguales = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
const firmar = (texto) => crypto.createHmac('sha256', SECRETO_COOKIE).update(texto).digest('base64url');

function leerCookie(req) {
  const crudo = String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (!crudo) return null;
  const [datos, firma] = crudo.slice(COOKIE.length + 1).split('.');
  if (!datos || !firma || !iguales(firma, firmar(datos))) return null;
  try {
    const s = JSON.parse(Buffer.from(datos, 'base64url').toString('utf8'));
    return s && s.exp > Date.now() && s.agente ? s : null;
  } catch (e) { return null; }
}
function escribirCookie(res, agente, nombre) {
  const datos = Buffer.from(JSON.stringify({ agente, nombre: nombre || '', exp: Date.now() + DURACION_MS })).toString('base64url');
  const atributos = [`${COOKIE}=${datos}.${firmar(datos)}`, 'Path=/hv', 'HttpOnly', `Max-Age=${DURACION_MS / 1000}`, PRODUCCION ? 'SameSite=None; Secure' : 'SameSite=Lax'];
  res.append('Set-Cookie', atributos.join('; '));
}

// Quién hace la petición: agente de Chatwoot (cookie /hv) o usuario con sesión normal de la aplicación
function usuarioHv(req) {
  const hv = leerCookie(req);
  if (hv) return { usuario: hv.agente, origen: 'chatwoot' };
  if (req.session && req.session.usuario) return { usuario: req.session.usuario, origen: 'sesion' };
  return null;
}
function authHv(req, res, next) {
  const u = usuarioHv(req);
  if (u) { req.hv = u; return next(); }
  if (req.method !== 'GET' || req.path.startsWith('/api/') || req.query.fragmento === '1') {
    return res.status(401).json({ error: 'La sesión expiró. Abre de nuevo la ficha desde Chatwoot o inicia sesión.', sesion: true });
  }
  res.redirect('/login');
}

// ---------- datos ----------
async function obtener(celular) {
  return (await db.query('SELECT * FROM hojas_vida WHERE celular = $1', [celular])).rows[0] || null;
}
// Limpia y valida un valor según su campo. Devuelve { valor } o { error }.
function validarCampo(c, bruto, prefijo = '') {
  let v = String(bruto == null ? '' : bruto).replace(/\r/g, '');
  v = c.tipo === 'area' ? v.trim() : v.replace(/\s+/g, ' ').trim();
  if (c.max) v = v.slice(0, c.max);
  if (c.requerido && !v) return { error: `${prefijo}el campo "${c.etiqueta}" es obligatorio.` };
  if (c.tipo === 'lista' && v && !c.opciones.includes(v)) return { error: `${prefijo}el valor de "${c.etiqueta}" no es válido.` };
  if (c.tipo === 'celular' && v) {
    const cel = normalizarCelular(v);
    if (!cel) return { error: `${prefijo}"${c.etiqueta}" debe ser un celular de 10 dígitos.` };
    v = cel;
  }
  return { valor: v };
}
const mayuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const idItem = (v) => (/^[a-z0-9-]{8,40}$/i.test(String(v || '')) ? String(v) : crypto.randomUUID());

// Valida el cuerpo contra CAMPOS. Devuelve { datos } o { error }.
function validar(body, contexto = {}) {
  const datos = {};
  for (const s of CAMPOS) {
    if (!s.repetible) {
      for (const c of s.campos) {
        if (c.identidad) continue; // el celular de la hoja va en su columna
        const bruto = c.desdeChatwoot && contexto[c.desdeChatwoot] ? contexto[c.desdeChatwoot] : body[c.id];
        const r = validarCampo(c, bruto);
        if (r.error) return { error: mayuscula(r.error) };
        datos[c.id] = r.valor;
      }
      continue;
    }
    // Bloques repetibles: se ignoran los que llegan completamente vacíos
    const items = (Array.isArray(body[s.id]) ? body[s.id] : []).filter(it => it && typeof it === 'object'
      && s.campos.some(c => String(it[c.id] == null ? '' : it[c.id]).trim()));
    if (items.length < (s.minimo || 0)) return { error: `Agrega al menos ${s.minimo === 1 ? 'una' : s.minimo} ${s.etiquetaItem.toLowerCase()}.` };
    if (s.maximo && items.length > s.maximo) return { error: `Se permiten máximo ${s.maximo} ${s.seccion.toLowerCase()}.` };
    datos[s.id] = [];
    for (const [i, it] of items.entries()) {
      const item = { id: idItem(it.id) };
      for (const c of s.campos) {
        const r = validarCampo(c, it[c.id], `${s.etiquetaItem} ${i + 1}: `);
        if (r.error) return { error: r.error };
        item[c.id] = r.valor;
      }
      datos[s.id].push(item);
    }
  }
  return { datos };
}
async function guardar(celular, datos, { usuario, contactId }, client = db) {
  // Los campos que ya no estén en CAMPOS se conservan (datos || nuevos) para no perder información al cambiar la lista.
  return (await client.query(
    `INSERT INTO hojas_vida (celular, datos, chatwoot_contact_id, creado_por, actualizado_por)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (celular) DO UPDATE SET
       datos = hojas_vida.datos || EXCLUDED.datos,
       chatwoot_contact_id = COALESCE(EXCLUDED.chatwoot_contact_id, hojas_vida.chatwoot_contact_id),
       actualizado_por = EXCLUDED.actualizado_por, updated_at = NOW()
     RETURNING *`,
    [celular, JSON.stringify(datos), contactId || null, usuario])).rows[0];
}
const fichaJson = (h) => (h ? { id: h.id, celular: h.celular, datos: h.datos || {}, chatwoot_contact_id: h.chatwoot_contact_id, creado_por: h.creado_por, actualizado_por: h.actualizado_por, created_at: h.created_at, updated_at: h.updated_at } : null);

// Contexto de Chatwoot que la página envía al pedir el contenido (nombre y id del contacto)
function contextoDe(req) {
  const q = req.query || {};
  const nombre = String(q.contacto_nombre || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const contactId = /^\d{1,10}$/.test(String(q.contacto_id || '')) ? Number(q.contacto_id) : null;
  return { nombre, contactId };
}

// ---------- rutas ----------
const router = express.Router();

// Cabeceras de todo /hv: se puede embeber solo desde Chatwoot y la clave de la URL no se filtra por Referer
router.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${CHATWOOT_ORIGIN}`);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.locals.chatwootOrigin = CHATWOOT_ORIGIN;
  res.locals.versionEstaticos = VERSION_ESTATICOS;
  next();
});
// Las peticiones que modifican datos solo se aceptan desde el propio JavaScript de la vista (cabecera propia + JSON):
// un formulario de otro sitio no puede enviarlas aunque la cookie viaje con SameSite=None.
function soloDesdeLaVista(req, res, next) {
  if (req.get('X-FerreObras') !== 'hv' || !req.is('application/json')) return res.status(403).json({ error: 'Petición no permitida.' });
  next();
}

// Página puente: sin datos; hace el handshake con Chatwoot y carga el contenido por fetch
router.get('/', (req, res) => {
  res.render('layout_hv', { puente: true, clave: String(req.query.k || ''), campos: CAMPOS, municipios: mun.MUNICIPIOS });
});

// Sesión de agente a partir del contexto de Chatwoot
router.post('/sesion', soloDesdeLaVista, (req, res) => {
  const b = req.body || {};
  if (!SECRETO_HV && PRODUCCION) return res.status(503).json({ error: 'El acceso desde Chatwoot no está configurado (falta CHATWOOT_HV_SECRET).' });
  if (SECRETO_HV && !iguales(String(b.k || ''), SECRETO_HV)) {
    console.warn('[hv] intento de sesión desde Chatwoot con clave incorrecta');
    return res.status(403).json({ error: 'La aplicación de Chatwoot no está bien configurada (clave incorrecta). Avisa al administrador.' });
  }
  const agente = b.agente || {};
  const correo = String(agente.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || correo.length > 200) return res.status(400).json({ error: 'Chatwoot no envió el correo del agente.' });
  escribirCookie(res, correo, String(agente.name || '').slice(0, 120));
  res.json({ ok: true, agente: correo });
});

// Una dirección con +57 o con 12 dígitos se lleva a la forma de 10 dígitos
router.get('/:celular(\\d{11,15})', authHv, (req, res, next) => {
  const c = normalizarCelular(req.params.celular);
  if (!c) return next();
  const q = new URLSearchParams(req.query).toString();
  res.redirect(`/hv/${c}${q ? '?' + q : ''}`);
});

// JSON de la hoja
router.get('/api/:celular(\\d{10})', authHv, async (req, res, next) => {
  try {
    res.json({ celular: req.params.celular, hoja: fichaJson(await obtener(req.params.celular)), campos: CAMPOS });
  } catch (e) { next(e); }
});

// Ficha o formulario. Con ?fragmento=1 devuelve solo el contenido (para cambiar de vista sin recargar la página).
router.get('/:celular(\\d{10})', authHv, async (req, res, next) => {
  try {
    const hoja = await obtener(req.params.celular);
    const contexto = contextoDe(req);
    const modo = !hoja || req.query.editar === '1' ? 'formulario' : 'ficha';
    const locals = { puente: false, celular: req.params.celular, hoja: fichaJson(hoja), modo, contexto, campos: CAMPOS, municipios: mun.MUNICIPIOS, quien: req.hv };
    if (req.query.fragmento === '1') return res.render('hv_contenido', locals);
    res.render('layout_hv', locals);
  } catch (e) { next(e); }
});

// Crear o actualizar (upsert por celular)
router.post('/:celular(\\d{10})', authHv, soloDesdeLaVista, async (req, res, next) => {
  try {
    const contexto = contextoDe(req);
    const v = validar(req.body || {}, contexto);
    if (v.error) return res.status(400).json({ error: v.error });
    const hoja = await guardar(req.params.celular, v.datos, { usuario: req.hv.usuario, contactId: contexto.contactId });
    res.json({ ok: true, hoja: fichaJson(hoja) });
  } catch (e) { next(e); }
});

// Errores de /hv en JSON o como mensaje dentro del layout propio
router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[hv]', err);
  if (res.headersSent) return;
  if (req.method !== 'GET' || req.path.startsWith('/api/') || req.query.fragmento === '1') return res.status(500).json({ error: 'No se pudo completar la operación. Intenta de nuevo.' });
  res.status(500).render('layout_hv', { puente: false, error: 'Ocurrió un error inesperado al cargar la hoja de vida. Intenta de nuevo.', campos: CAMPOS, municipios: [] });
});

module.exports = { router, asegurarEsquema, CAMPOS, normalizarCelular, validar, guardar, obtener, CHATWOOT_ORIGIN };
