// Agenda del cliente (/hv/agenda): tareas programadas para un cliente, con copia en Google Calendar.
//
// Se abre como Dashboard App dentro de Chatwoot igual que la hoja de vida y comparte su autenticación
// (cookie ferreobras_hv, clave CHATWOOT_HV_SECRET, cabeceras; ver src/hoja_vida.js). Cada tarea se guarda en
// agenda_tareas y se envía a n8n (N8N_WEBHOOK_AGENDA), que la crea, actualiza o elimina en Google Calendar e
// invita a la línea responsable. Si n8n no responde, la tarea queda registrada con el calendario pendiente y se
// puede reintentar desde la vista.
const express = require('express');
const db = require('./db');
const calc = require('./calc');
const notify = require('./notify');
const hv = require('./hoja_vida');

const PRIORIDADES = [
  { id: 1, nombre: 'Alta', ayuda: 'Urgente o muy importante' },
  { id: 2, nombre: 'Media', ayuda: 'Importante, sin afán' },
  { id: 3, nombre: 'Baja', ayuda: 'Cuando haya tiempo' },
];
const DURACION_MIN = 60; // duración del evento en el calendario cuando la tarea tiene hora
// Color del evento en Google Calendar por prioridad (colorId de la API): 11 tomate, 5 banano, 7 pavo real.
// Las tareas hechas se muestran "sin fondo": la API no permite atenuar un evento ni quitarle la barra a uno de todo el día,
// pero en la vista de mes los eventos con hora se dibujan solo como punto y texto. Por eso una tarea hecha de todo el día
// pasa a un evento a las 12 a. m. sin duración, y su punto queda en 8 (grafito).
const COLOR_CALENDARIO = { 1: '11', 2: '5', 3: '7' };
const COLOR_HECHA = '8';

// ---------- esquema (idempotente; se ejecuta al arrancar) ----------
async function asegurarEsquema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS agenda_tareas (
      id                  SERIAL PRIMARY KEY,
      celular             TEXT NOT NULL,
      chatwoot_contact_id INTEGER,
      cliente             TEXT,
      prioridad           SMALLINT NOT NULL DEFAULT 2,
      tarea               TEXT NOT NULL,
      responsable         TEXT NOT NULL,
      fecha               DATE NOT NULL,
      hora                TIME,
      notas               TEXT,
      estado              TEXT NOT NULL DEFAULT 'pendiente',
      google_event_id     TEXT,
      google_link         TEXT,
      calendario_estado   TEXT NOT NULL DEFAULT 'pendiente',
      calendario_error    TEXT,
      creado_por          TEXT,
      actualizado_por     TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS agenda_tareas_celular ON agenda_tareas (celular, fecha);`);
}

// ---------- utilidades ----------
const lineasActivas = async () => (await db.query('SELECT numero, correo FROM lineas_whatsapp WHERE activa ORDER BY numero')).rows;
const horaCorta = (h) => (h ? String(h).slice(0, 5) : null);
// Fecha y hora de Bogotá (-05:00, sin horario de verano) más N minutos, en ISO con zona
function masMinutos(fecha, hora, min) {
  const d = new Date(`${fecha}T${hora}:00-05:00`);
  d.setUTCMinutes(d.getUTCMinutes() + min);
  return new Date(d.getTime() - 5 * 3600000).toISOString().slice(0, 16) + ':00-05:00';
}
function fichaJson(t, hoy) {
  const fecha = calc.toISO(t.fecha);
  return {
    id: t.id, celular: t.celular, cliente: t.cliente || '', prioridad: Number(t.prioridad), tarea: t.tarea, responsable: t.responsable,
    fecha, hora: horaCorta(t.hora), notas: t.notas || '', estado: t.estado, dias: hoy ? calc.diffDays(hoy, fecha) : null,
    google_event_id: t.google_event_id || null, google_link: t.google_link || null, calendario_estado: t.calendario_estado, calendario_error: t.calendario_error || null,
    creado_por: t.creado_por, actualizado_por: t.actualizado_por, created_at: t.created_at, updated_at: t.updated_at,
  };
}
// Nombre del cliente: el del contacto de Chatwoot, si no el de su hoja de vida y si no el de alguna obra
async function nombreCliente(celular, contexto) {
  if (contexto && contexto.nombre) return contexto.nombre;
  const h = (await db.query(`SELECT datos->>'nombre' AS nombre FROM hojas_vida WHERE celular = $1`, [celular])).rows[0];
  if (h && h.nombre) return h.nombre;
  const o = (await db.query('SELECT cliente FROM obras WHERE celular = $1 ORDER BY updated_at DESC LIMIT 1', [celular])).rows[0];
  return o ? o.cliente : '';
}

// Valida el cuerpo del formulario. Devuelve { datos } o { error }.
async function validar(body) {
  const b = body || {};
  const prioridad = Number(b.prioridad);
  if (!PRIORIDADES.some(p => p.id === prioridad)) return { error: 'Elige la prioridad de la tarea.' };
  const tarea = String(b.tarea == null ? '' : b.tarea).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!tarea) return { error: 'Escribe qué hay que hacer.' };
  const lineas = await lineasActivas();
  const responsable = String(b.responsable || '').trim();
  if (!lineas.some(l => l.numero === responsable)) return { error: 'Elige la línea responsable.' };
  const fecha = String(b.fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(fecha))) return { error: 'Elige la fecha de la tarea.' };
  let hora = String(b.hora || '').trim().slice(0, 5);
  if (hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) return { error: 'La hora no es válida.' };
  hora = hora || null;
  const notas = String(b.notas == null ? '' : b.notas).replace(/\r/g, '').trim().slice(0, 2000) || null;
  return { datos: { prioridad, tarea, responsable, fecha, hora, notas } };
}

// ---------- Google Calendar (a través de n8n) ----------
// Lo que recibe n8n: la tarea con el título, la descripción y las fechas ya armadas, para que el flujo solo
// tenga que crear, actualizar o eliminar el evento e invitar al correo de la línea responsable.
function cargaCalendario(t, lineas) {
  const fecha = calc.toISO(t.fecha), hora = horaCorta(t.hora), hecha = t.estado === 'hecha';
  const prioridad = PRIORIDADES.find(p => p.id === Number(t.prioridad)) || PRIORIDADES[1];
  const correo = (lineas.find(l => l.numero === t.responsable) || {}).correo || '';
  const descripcion = [
    `Cliente: ${t.cliente || 'sin nombre'} · ${t.celular}`, `Responsable: línea ${t.responsable}`, `Prioridad: ${prioridad.id} (${prioridad.nombre.toLowerCase()})`,
    t.notas ? `Notas: ${t.notas}` : '', t.estado === 'hecha' ? 'Estado: hecha' : '', 'Programada desde FerreObras (agenda del cliente en Chatwoot).',
  ].filter(Boolean).join('\n');
  return {
    id: t.id, celular: t.celular, cliente: t.cliente || '', prioridad: prioridad.id, prioridad_nombre: prioridad.nombre, tarea: t.tarea,
    responsable: t.responsable, correo_responsable: correo, fecha, hora, notas: t.notas || '', estado: t.estado, google_event_id: t.google_event_id || null,
    // Formato del título en Calendar: "#prioridad - Tarea - responsable", p. ej. "1 - Enviarle observaciones - 3535"
    titulo: `${t.estado === 'hecha' ? '✔ ' : ''}${prioridad.id} - ${t.tarea} - ${t.responsable}`, descripcion,
    color_id: t.estado === 'hecha' ? COLOR_HECHA : (COLOR_CALENDARIO[prioridad.id] || '7'),
    ...(hora ? { todo_el_dia: false, inicio: `${fecha}T${hora}:00-05:00`, fin: masMinutos(fecha, hora, DURACION_MIN) }
      : hecha ? { todo_el_dia: false, inicio: `${fecha}T00:00:00-05:00`, fin: `${fecha}T00:00:00-05:00` }
      : { todo_el_dia: true, inicio: fecha, fin: calc.addDays(fecha, 1) }),
  };
}
// Envía la tarea a n8n y guarda el resultado en la fila (id del evento, enlace y estado de sincronización)
async function sincronizar(t, evento) {
  const r = await notify.agenda(evento, cargaCalendario(t, await lineasActivas()));
  if (evento === 'tarea_eliminada') { if (!r.ok) console.warn(`[agenda] la tarea ${t.id} se eliminó pero no se pudo quitar del calendario: ${r.error}`); return null; }
  const d = r.datos || {};
  const eventId = r.ok ? (d.google_event_id || d.id || t.google_event_id || null) : t.google_event_id || null;
  const link = r.ok ? (d.html_link || d.htmlLink || t.google_link || null) : t.google_link || null;
  const estado = r.ok ? 'sincronizada' : (r.configurado ? 'error' : 'sin_configurar');
  return (await db.query(
    `UPDATE agenda_tareas SET google_event_id = $2, google_link = $3, calendario_estado = $4, calendario_error = $5 WHERE id = $1 RETURNING *`,
    [t.id, eventId, link, estado, r.ok ? null : r.error])).rows[0];
}

// ---------- datos ----------
async function obtenerTarea(celular, id) {
  return (await db.query('SELECT * FROM agenda_tareas WHERE id = $1 AND celular = $2', [id, celular])).rows[0] || null;
}
async function datosCliente(celular, contexto) {
  const hoy = calc.hoyBogota();
  const [tareas, avisos, lineas, cliente] = await Promise.all([
    db.query('SELECT * FROM agenda_tareas WHERE celular = $1 ORDER BY fecha, hora NULLS LAST, prioridad, id', [celular]).then(r => r.rows),
    // Avisos de etapas de obras en curso del mismo cliente: también están en Google Calendar (flujo VIP_Calendar)
    db.query(`SELECT o.id AS obra_id, o.cliente, o.obra, o.linea, e.id AS etapa_id, e.nombre AS etapa, e.fecha_programada, e.fecha_aviso, e.google_event_id
              FROM etapas e JOIN obras o ON o.id = e.obra_id
              WHERE o.celular = $1 AND o.estado = 'activa' AND e.estado = 'pendiente' AND e.fecha_aviso IS NOT NULL ORDER BY e.fecha_aviso, e.orden`, [celular]).then(r => r.rows),
    lineasActivas(), nombreCliente(celular, contexto),
  ]);
  return {
    celular, cliente, hoy, prioridades: PRIORIDADES, lineas: lineas.map(l => l.numero),
    tareas: tareas.map(t => fichaJson(t, hoy)),
    avisos: avisos.map(a => ({ obra_id: a.obra_id, obra: a.obra, linea: a.linea, etapa: a.etapa, fecha: calc.toISO(a.fecha_programada), fecha_aviso: calc.toISO(a.fecha_aviso), dias: calc.diffDays(hoy, calc.toISO(a.fecha_aviso)), en_calendario: !!a.google_event_id })),
  };
}
async function crear(celular, datos, { usuario, contexto }) {
  const cliente = await nombreCliente(celular, contexto);
  const t = (await db.query(
    `INSERT INTO agenda_tareas (celular, chatwoot_contact_id, cliente, prioridad, tarea, responsable, fecha, hora, notas, creado_por, actualizado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
    [celular, contexto.contactId || null, cliente || null, datos.prioridad, datos.tarea, datos.responsable, datos.fecha, datos.hora, datos.notas, usuario])).rows[0];
  return (await sincronizar(t, 'tarea_creada')) || t;
}
async function actualizar(t, datos, { usuario, contexto }) {
  const cliente = (contexto && contexto.nombre) || t.cliente || await nombreCliente(t.celular, null);
  const n = (await db.query(
    `UPDATE agenda_tareas SET cliente = $2, prioridad = $3, tarea = $4, responsable = $5, fecha = $6, hora = $7, notas = $8, actualizado_por = $9, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [t.id, cliente || null, datos.prioridad, datos.tarea, datos.responsable, datos.fecha, datos.hora, datos.notas, usuario])).rows[0];
  return (await sincronizar(n, n.google_event_id ? 'tarea_actualizada' : 'tarea_creada')) || n;
}
async function cambiarEstado(t, estado, usuario) {
  const n = (await db.query('UPDATE agenda_tareas SET estado = $2, actualizado_por = $3, updated_at = NOW() WHERE id = $1 RETURNING *', [t.id, estado, usuario])).rows[0];
  return (await sincronizar(n, n.google_event_id ? 'tarea_actualizada' : 'tarea_creada')) || n;
}
async function eliminar(t) {
  await db.query('DELETE FROM agenda_tareas WHERE id = $1', [t.id]);
  if (t.google_event_id) await sincronizar(t, 'tarea_eliminada');
}

// ---------- rutas (montadas en /hv/agenda) ----------
const router = express.Router();
router.use(hv.cabecerasHv);
const vista = (res, locals) => res.render('layout_hv', { vista: 'agenda', puente: false, campos: [], municipios: [], ...locals });

// Página puente para Chatwoot: sin datos; hace el handshake y carga la agenda del contacto por la API
router.get('/', (req, res) => vista(res, { puente: true, clave: String(req.query.k || '') }));
// Una dirección con +57 o con 12 dígitos se lleva a la forma de 10 dígitos
router.get('/:celular(\\d{11,15})', hv.authHv, (req, res, next) => {
  const c = hv.normalizarCelular(req.params.celular);
  if (!c) return next();
  res.redirect(`/hv/agenda/${c}`);
});
// Agenda de un cliente por fuera de Chatwoot (sesión normal de la aplicación)
router.get('/:celular(\\d{10})', hv.authHv, (req, res) => vista(res, { celular: req.params.celular }));

router.get('/api/:celular(\\d{10})', hv.authHv, async (req, res, next) => {
  try { res.json(await datosCliente(req.params.celular, hv.contextoDe(req))); } catch (e) { next(e); }
});
router.post('/api/:celular(\\d{10})', hv.authHv, hv.soloDesdeLaVista, async (req, res, next) => {
  try {
    const v = await validar(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    const t = await crear(req.params.celular, v.datos, { usuario: req.hv.usuario, contexto: hv.contextoDe(req) });
    res.json({ ok: true, tarea: fichaJson(t, calc.hoyBogota()) });
  } catch (e) { next(e); }
});
// Carga la tarea de la URL (debe ser del mismo celular)
async function conTarea(req, res, next) {
  try {
    const t = await obtenerTarea(req.params.celular, req.params.id);
    if (!t) return res.status(404).json({ error: 'La tarea ya no existe.' });
    req.tarea = t; next();
  } catch (e) { next(e); }
}
router.post('/api/:celular(\\d{10})/:id(\\d+)', hv.authHv, hv.soloDesdeLaVista, conTarea, async (req, res, next) => {
  try {
    const v = await validar(req.body);
    if (v.error) return res.status(400).json({ error: v.error });
    res.json({ ok: true, tarea: fichaJson(await actualizar(req.tarea, v.datos, { usuario: req.hv.usuario, contexto: hv.contextoDe(req) }), calc.hoyBogota()) });
  } catch (e) { next(e); }
});
router.post('/api/:celular(\\d{10})/:id(\\d+)/estado', hv.authHv, hv.soloDesdeLaVista, conTarea, async (req, res, next) => {
  try {
    const estado = req.body && req.body.estado === 'hecha' ? 'hecha' : 'pendiente';
    res.json({ ok: true, tarea: fichaJson(await cambiarEstado(req.tarea, estado, req.hv.usuario), calc.hoyBogota()) });
  } catch (e) { next(e); }
});
router.post('/api/:celular(\\d{10})/:id(\\d+)/sincronizar', hv.authHv, hv.soloDesdeLaVista, conTarea, async (req, res, next) => {
  try {
    const t = await sincronizar(req.tarea, req.tarea.google_event_id ? 'tarea_actualizada' : 'tarea_creada');
    res.json({ ok: t.calendario_estado === 'sincronizada', tarea: fichaJson(t, calc.hoyBogota()), error: t.calendario_estado === 'sincronizada' ? null : (t.calendario_estado === 'sin_configurar' ? 'El calendario no está configurado (falta N8N_WEBHOOK_AGENDA).' : `No se pudo enviar al calendario: ${t.calendario_error}`) });
  } catch (e) { next(e); }
});
router.post('/api/:celular(\\d{10})/:id(\\d+)/eliminar', hv.authHv, hv.soloDesdeLaVista, conTarea, async (req, res, next) => {
  try { await eliminar(req.tarea); res.json({ ok: true }); } catch (e) { next(e); }
});

router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[agenda]', err);
  if (res.headersSent) return;
  if (req.method !== 'GET' || req.path.startsWith('/api/')) return res.status(500).json({ error: 'No se pudo completar la operación. Intenta de nuevo.' });
  res.status(500);
  vista(res, { error: 'Ocurrió un error inesperado al cargar la agenda. Intenta de nuevo.' });
});

module.exports = { router, asegurarEsquema, PRIORIDADES, validar, cargaCalendario };
