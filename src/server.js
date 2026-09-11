const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');
const db = require('./db');
const calc = require('./calc');
const notify = require('./notify');
const reportes = require('./reportes');
const excel = require('./excel');
const rutas = require('./rutas');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
app.use(cookieSession({ name: 'ferreobras', secret: process.env.SESSION_SECRET || 'cambiar', maxAge: 12 * 60 * 60 * 1000, sameSite: 'lax' }));

// Lee una variable de entorno tolerando comillas, espacios y retornos de carro que suelen colarse
// al pegar valores en Dokploy o en un .env editado en Windows.
const leerEnv = (nombre) => {
  let v = process.env[nombre];
  if (v == null) return '';
  v = String(v).replace(/\r|\n/g, '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
};
const ADMIN_USER = leerEnv('ADMIN_USER') || 'admin';
const ADMIN_PASS = leerEnv('ADMIN_PASS');
const ADMIN_TOKEN = '__admin__'; // valor fijo que envía el <select> del login para el administrador
const adminHabilitado = () => !!ADMIN_PASS;
console.log(adminHabilitado() ? `[auth] administrador habilitado (usuario "${ADMIN_USER}")` : '[auth] ADMIN_PASS no definida: acceso de administrador deshabilitado');

// ---------- helpers ----------
const fmt = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
app.locals.fmt = fmt;
app.locals.hoy = calc.hoyBogota;
app.locals.toISO = calc.toISO;
app.locals.toISOBogota = calc.toISOBogota;
app.locals.diffDays = calc.diffDays;
// Envuelve rutas async para que los errores lleguen al manejador de Express
const ruta = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const noEncontrado = (res, que = 'Obra') => res.status(404).render('mensaje', { titulo: `${que} no encontrada`, mensaje: `La ${que.toLowerCase()} que buscas no existe o fue eliminada.` });

async function lineasWhatsapp() { return (await db.query('SELECT numero, correo FROM lineas_whatsapp WHERE activa ORDER BY numero')).rows; }
async function lineasProducto(todas = false) {
  return (await db.query(`SELECT id, nombre, orden, activa FROM lineas_producto ${todas ? '' : 'WHERE activa'} ORDER BY orden, id`)).rows;
}
async function cargarObra(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const obra = (await db.query('SELECT * FROM obras WHERE id = $1', [id])).rows[0];
  if (!obra) return null;
  const etapas = (await db.query('SELECT * FROM etapas WHERE obra_id = $1 ORDER BY orden', [id])).rows
    .map(e => ({ ...e, fecha_programada: calc.toISO(e.fecha_programada), fecha_real: calc.toISO(e.fecha_real), fecha_aviso: calc.toISO(e.fecha_aviso) }));
  const ventas = (await db.query('SELECT v.* FROM ventas_etapa v JOIN etapas e ON e.id = v.etapa_id WHERE e.obra_id = $1', [id])).rows;
  const mapa = {};
  for (const v of ventas) mapa[`${v.etapa_id}:${v.linea_id}`] = v;
  return { obra, etapas, ventas: mapa };
}
// Guarda las etapas recalculadas de una obra (dentro de una transacción)
async function guardarEtapas(client, obraId, etapas) {
  for (const e of etapas) {
    await client.query(
      `UPDATE etapas SET nombre=$3, intervalo_dias=$4, dias_aviso=$5, fecha_programada=$6, fecha_fija=$7, fecha_real=$8, fecha_aviso=$9, estado=$10, notas=$11
       WHERE id=$1 AND obra_id=$2`,
      [e.id, obraId, e.nombre, e.intervalo_dias, e.dias_aviso, e.fecha_programada, !!e.fecha_fija, e.fecha_real, e.fecha_aviso, e.estado || 'pendiente', e.notas || null]);
  }
  await client.query('UPDATE obras SET updated_at = NOW() WHERE id = $1', [obraId]);
}
function enviarExcel(res, nombre, buffer) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.send(Buffer.from(buffer));
}

// ---------- auth ----------
// Dos tipos de usuario: las líneas de WhatsApp (PASS_<línea>) y el administrador (ADMIN_USER / ADMIN_PASS).
function requireLogin(req, res, next) { if (req.session && req.session.usuario) return next(); res.redirect('/login'); }
function requireAdmin(req, res, next) {
  if (req.session.rol === 'admin') return next();
  res.status(403).render('mensaje', { titulo: 'Acceso restringido', mensaje: 'El panel de administración solo está disponible para la cuenta de administrador.' });
}
app.get('/login', ruta(async (req, res) => {
  if (req.session && req.session.usuario) return res.redirect(req.session.rol === 'admin' ? '/admin' : '/');
  res.render('login', { lineas: await lineasWhatsapp(), adminUser: adminHabilitado() ? ADMIN_USER : null, error: null });
}));
app.post('/login', ruta(async (req, res) => {
  const usuario = String(req.body.usuario || '').trim(), clave = String(req.body.clave || '').replace(/\r|\n/g, '').trim();
  const esAdmin = usuario === ADMIN_TOKEN || usuario === ADMIN_USER;
  if (esAdmin) {
    if (adminHabilitado() && clave === ADMIN_PASS) {
      req.session.usuario = ADMIN_USER; req.session.rol = 'admin'; req.session.linea = null;
      return res.redirect('/admin');
    }
    console.warn(`[auth] intento de administrador rechazado: ${adminHabilitado() ? 'la clave no coincide con ADMIN_PASS' : 'ADMIN_PASS no está definida'} (clave recibida de ${clave.length} caracteres, esperada de ${ADMIN_PASS.length})`);
  } else {
    const esperada = /^\d{3,6}$/.test(usuario) ? leerEnv(`PASS_${usuario}`) : '';
    if (esperada && clave === esperada) {
      req.session.usuario = usuario; req.session.rol = 'linea'; req.session.linea = usuario;
      return res.redirect('/');
    }
    console.warn(`[auth] intento rechazado para "${usuario}": ${esperada ? 'clave incorrecta' : `no existe la variable PASS_${usuario}`}`);
  }
  res.status(401).render('login', { lineas: await lineasWhatsapp(), adminUser: adminHabilitado() ? ADMIN_USER : null, error: 'Usuario o clave incorrecta.' });
}));
app.post('/logout', (req, res) => { req.session = null; res.redirect('/login'); });
app.use(requireLogin);
app.use((req, res, next) => {
  res.locals.usuario = req.session.usuario;
  res.locals.rol = req.session.rol;
  res.locals.linea = req.session.linea;
  res.locals.esAdmin = req.session.rol === 'admin';
  res.locals.ruta = req.path;
  res.locals.msg = req.query.msg || null;
  next();
});

// ---------- lista de obras ----------
app.get('/', ruta(async (req, res) => {
  const ver = req.query.ver === 'cerradas' ? 'cerradas' : 'activas';
  const rows = (await db.query(`
    SELECT o.*,
      (SELECT json_build_object('nombre', e.nombre, 'fecha_programada', e.fecha_programada, 'fecha_aviso', e.fecha_aviso)
         FROM etapas e WHERE e.obra_id = o.id AND e.estado = 'pendiente' AND e.orden > 0 ORDER BY e.orden LIMIT 1) AS proxima,
      (SELECT COUNT(*) FROM etapas e WHERE e.obra_id = o.id AND e.orden > 0) AS total_etapas,
      (SELECT COUNT(*) FROM etapas e WHERE e.obra_id = o.id AND e.orden > 0 AND e.estado <> 'pendiente') AS etapas_hechas,
      (SELECT COUNT(*) FROM etapas e WHERE e.obra_id = o.id AND e.estado = 'vendida') AS etapas_vendidas
    FROM obras o WHERE o.estado = $1 ORDER BY o.updated_at DESC`, [ver === 'cerradas' ? 'cerrada' : 'activa'])).rows;
  const conteos = { activas: 0, cerradas: 0 };
  for (const r of (await db.query('SELECT estado, COUNT(*)::int AS n FROM obras GROUP BY estado')).rows) conteos[r.estado === 'cerrada' ? 'cerradas' : 'activas'] = r.n;
  const hoy = calc.hoyBogota();
  const resumen = { vencidos: 0, hoy: 0, semana: 0 };
  for (const o of rows) {
    o.total_etapas = Number(o.total_etapas); o.etapas_hechas = Number(o.etapas_hechas); o.etapas_vendidas = Number(o.etapas_vendidas);
    if (o.proxima) {
      o.proxima.fecha_programada = calc.toISO(o.proxima.fecha_programada);
      o.proxima.fecha_aviso = calc.toISO(o.proxima.fecha_aviso);
      o.dias_para_aviso = o.proxima.fecha_aviso ? calc.diffDays(hoy, o.proxima.fecha_aviso) : null;
      if (o.dias_para_aviso !== null) { if (o.dias_para_aviso < 0) resumen.vencidos++; else if (o.dias_para_aviso === 0) resumen.hoy++; else if (o.dias_para_aviso <= 7) resumen.semana++; }
    }
  }
  // más urgentes primero
  rows.sort((a, b) => (a.dias_para_aviso ?? 9999) - (b.dias_para_aviso ?? 9999));
  res.render('index', { obras: rows, ver, conteos, resumen });
}));

// ---------- nueva obra ----------
app.get('/obras/nueva', ruta(async (req, res) => {
  res.render('obra_form', { obra: null, lineas: await lineasWhatsapp(), productos: await lineasProducto(), error: null });
}));
app.post('/obras', ruta(async (req, res) => {
  const b = req.body;
  const productos = await lineasProducto();
  const precios = {};
  for (const p of productos) if (b[`precio_${p.id}`]) precios[p.nombre] = b[`precio_${p.id}`];
  const datos = {
    cliente: b.cliente?.trim(), celular: b.celular?.replace(/\D/g, ''), direccion_cliente: b.direccion_cliente?.trim(),
    obra: b.obra?.trim(), direccion_obra: b.direccion_obra?.trim(), maestro: b.maestro?.trim(), celular_maestro: b.celular_maestro?.replace(/\D/g, ''),
    linea: b.linea, fecha_cimentacion: b.fecha_cimentacion, num_placas: Number(b.num_placas), intervalo_dias: Number(b.intervalo_dias),
    dias_aviso: Number(b.dias_aviso), notas: b.notas?.trim() || null,
  };
  if (!datos.cliente || !datos.celular || !datos.obra || !datos.fecha_cimentacion || !datos.num_placas || !datos.intervalo_dias || !datos.dias_aviso) {
    return res.render('obra_form', { obra: b, lineas: await lineasWhatsapp(), productos, error: 'Faltan datos obligatorios.' });
  }
  const obraId = await db.tx(async (client) => {
    const r = await client.query(
      `INSERT INTO obras (cliente, celular, direccion_cliente, obra, direccion_obra, maestro, celular_maestro, linea, fecha_cimentacion, num_placas, intervalo_dias, dias_aviso, precios, notas, creada_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [datos.cliente, datos.celular, datos.direccion_cliente, datos.obra, datos.direccion_obra, datos.maestro, datos.celular_maestro, datos.linea,
       datos.fecha_cimentacion, datos.num_placas, datos.intervalo_dias, datos.dias_aviso, JSON.stringify(precios), datos.notas, req.session.usuario]);
    const id = r.rows[0].id;
    for (const e of calc.etapasIniciales(datos)) {
      await client.query(
        `INSERT INTO etapas (obra_id, orden, nombre, intervalo_dias, dias_aviso, fecha_programada, fecha_fija, fecha_aviso) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, e.orden, e.nombre, e.intervalo_dias, e.dias_aviso, e.fecha_programada, e.fecha_fija, e.fecha_aviso]);
    }
    return id;
  });
  notify.calendar('obra_creada', obraId);
  res.redirect(`/obras/${obraId}?msg=${encodeURIComponent('Obra creada y seguimientos programados')}`);
}));

// ---------- detalle ----------
app.get('/obras/:id', ruta(async (req, res) => {
  const data = await cargarObra(req.params.id);
  if (!data) return noEncontrado(res);
  res.render('obra', { ...data, productos: await lineasProducto(), lineas: await lineasWhatsapp() });
}));

// editar cabecera
app.get('/obras/:id/editar', ruta(async (req, res) => {
  const data = await cargarObra(req.params.id);
  if (!data) return noEncontrado(res);
  res.render('obra_form', { obra: { ...data.obra, fecha_cimentacion: calc.toISO(data.obra.fecha_cimentacion) }, lineas: await lineasWhatsapp(), productos: await lineasProducto(), error: null });
}));
app.post('/obras/:id/editar', ruta(async (req, res) => {
  const b = req.body, id = req.params.id;
  const productos = await lineasProducto();
  const precios = {};
  for (const p of productos) if (b[`precio_${p.id}`]) precios[p.nombre] = b[`precio_${p.id}`];
  await db.query(
    `UPDATE obras SET cliente=$2, celular=$3, direccion_cliente=$4, obra=$5, direccion_obra=$6, maestro=$7, celular_maestro=$8, linea=$9, precios=$10, notas=$11, dias_aviso=$12, intervalo_dias=$13, updated_at=NOW() WHERE id=$1`,
    [id, b.cliente?.trim(), b.celular?.replace(/\D/g, ''), b.direccion_cliente?.trim(), b.obra?.trim(), b.direccion_obra?.trim(), b.maestro?.trim(), b.celular_maestro?.replace(/\D/g, ''),
     b.linea, JSON.stringify(precios), b.notas?.trim() || null, Number(b.dias_aviso), Number(b.intervalo_dias)]);
  notify.calendar('fechas_actualizadas', Number(id)); // el invitado o la descripción pudieron cambiar
  res.redirect(`/obras/${id}?msg=Datos guardados`);
}));

// guardar una etapa (fecha, nombre, estado, ventas) y recalcular las siguientes
app.post('/obras/:id/etapas/:eid', ruta(async (req, res) => {
  const { id, eid } = req.params; const b = req.body;
  const data = await cargarObra(id);
  if (!data) return noEncontrado(res);
  const productos = await lineasProducto();
  const etapa = data.etapas.find(e => String(e.id) === String(eid));
  if (!etapa) return noEncontrado(res, 'Etapa');

  const antes = data.etapas.map(e => e.fecha_aviso);
  etapa.nombre = b.nombre?.trim() || etapa.nombre;
  etapa.intervalo_dias = Number(b.intervalo_dias) || etapa.intervalo_dias;
  etapa.dias_aviso = Number(b.dias_aviso) || etapa.dias_aviso;
  etapa.notas = b.notas?.trim() || null;
  etapa.estado = ['pendiente', 'vendida', 'sin_venta'].includes(b.estado) ? b.estado : etapa.estado;
  const nuevaProg = b.fecha_programada || null;
  if (etapa.orden > 0 && nuevaProg && nuevaProg !== etapa.fecha_programada) { etapa.fecha_programada = nuevaProg; etapa.fecha_fija = true; }
  if (etapa.orden === 0 && nuevaProg) etapa.fecha_programada = nuevaProg;
  etapa.fecha_real = b.fecha_real || null;
  if (etapa.estado !== 'pendiente' && !etapa.fecha_real) etapa.fecha_real = etapa.fecha_programada;

  const recalculadas = calc.recalcular(data.etapas);
  const movidas = recalculadas.filter((e, i) => e.fecha_aviso !== antes[i] && e.id !== etapa.id).length;

  await db.tx(async (client) => {
    await guardarEtapas(client, id, recalculadas);
    if (etapa.orden === 0) await client.query('UPDATE obras SET fecha_cimentacion=$2 WHERE id=$1', [id, etapa.fecha_programada]);
    for (const p of productos) {
      const vendido = !!b[`venta_${p.id}`];
      const detalle = (b[`detalle_${p.id}`] || '').trim() || null;
      await client.query(
        `INSERT INTO ventas_etapa (etapa_id, linea_id, vendido, detalle) VALUES ($1,$2,$3,$4)
         ON CONFLICT (etapa_id, linea_id) DO UPDATE SET vendido = EXCLUDED.vendido, detalle = EXCLUDED.detalle`,
        [etapa.id, p.id, vendido, detalle]);
    }
  });
  notify.calendar('fechas_actualizadas', Number(id));
  const msg = movidas ? `Etapa guardada. Se recalcularon ${movidas} etapa(s) posteriores.` : 'Etapa guardada.';
  res.redirect(`/obras/${id}?msg=${encodeURIComponent(msg)}#etapa-${etapa.id}`);
}));

// agregar etapa al final (cubierta, acabados, otra placa...)
app.post('/obras/:id/etapas', ruta(async (req, res) => {
  const { id } = req.params; const b = req.body;
  const data = await cargarObra(id);
  if (!data) return noEncontrado(res);
  const orden = Math.max(...data.etapas.map(e => e.orden)) + 1;
  const nueva = { orden, nombre: b.nombre?.trim() || `Etapa ${orden}`, intervalo_dias: Number(b.intervalo_dias) || data.obra.intervalo_dias,
    dias_aviso: Number(b.dias_aviso) || data.obra.dias_aviso, fecha_programada: null, fecha_fija: false, fecha_real: null, estado: 'pendiente' };
  const recalculadas = calc.recalcular([...data.etapas, nueva]);
  const n = recalculadas.find(e => e.orden === orden);
  await db.tx(async (client) => {
    await client.query(`INSERT INTO etapas (obra_id, orden, nombre, intervalo_dias, dias_aviso, fecha_programada, fecha_fija, fecha_aviso) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, n.orden, n.nombre, n.intervalo_dias, n.dias_aviso, n.fecha_programada, false, n.fecha_aviso]);
    await client.query('UPDATE obras SET updated_at = NOW() WHERE id = $1', [id]);
  });
  notify.calendar('fechas_actualizadas', Number(id));
  res.redirect(`/obras/${id}?msg=${encodeURIComponent('Etapa agregada')}`);
}));

// eliminar etapa (solo pendientes y no la cimentación)
app.post('/obras/:id/etapas/:eid/eliminar', ruta(async (req, res) => {
  const { id, eid } = req.params;
  const e = (await db.query('SELECT * FROM etapas WHERE id=$1 AND obra_id=$2', [eid, id])).rows[0];
  if (!e || e.orden === 0 || e.estado !== 'pendiente') return res.redirect(`/obras/${id}?msg=${encodeURIComponent('Solo se pueden eliminar etapas pendientes.')}`);
  const eventId = e.google_event_id;
  await db.tx(async (client) => {
    await client.query('DELETE FROM etapas WHERE id=$1', [eid]);
    const rest = (await client.query('SELECT * FROM etapas WHERE obra_id=$1 ORDER BY orden', [id])).rows;
    rest.forEach((r, i) => r.orden = i);
    await guardarEtapas(client, id, calc.recalcular(rest));
    for (const r of rest) await client.query('UPDATE etapas SET orden=$2 WHERE id=$1', [r.id, r.orden]);
  });
  notify.calendar('fechas_actualizadas', Number(id), { evento_eliminado: eventId });
  res.redirect(`/obras/${id}?msg=${encodeURIComponent('Etapa eliminada')}`);
}));

// cerrar / reabrir obra
app.post('/obras/:id/cerrar', ruta(async (req, res) => {
  const { id } = req.params;
  await db.query(`UPDATE obras SET estado='cerrada', cerrada_at=NOW(), updated_at=NOW() WHERE id=$1`, [id]);
  notify.calendar('obra_cerrada', Number(id));
  notify.cierre(Number(id));
  res.redirect(`/obras/${id}?msg=${encodeURIComponent('Obra cerrada')}`);
}));
app.post('/obras/:id/reabrir', ruta(async (req, res) => {
  const { id } = req.params;
  await db.query(`UPDATE obras SET estado='activa', cerrada_at=NULL, updated_at=NOW() WHERE id=$1`, [id]);
  notify.calendar('fechas_actualizadas', Number(id));
  res.redirect(`/obras/${id}?msg=${encodeURIComponent('Obra reabierta')}`);
}));

// ---------- exportación a Excel ----------
const nombreArchivo = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '');
app.get('/obras/:id/export.xlsx', ruta(async (req, res) => {
  const data = await cargarObra(req.params.id);
  if (!data) return noEncontrado(res);
  const buffer = await excel.libroObra(data, await lineasProducto(true));
  enviarExcel(res, `FerreObras_obra_${data.obra.id}_${nombreArchivo(data.obra.cliente)}.xlsx`, buffer);
}));
// compatibilidad con enlaces antiguos
app.get('/obras/:id/export.csv', (req, res) => res.redirect(301, `/obras/${req.params.id}/export.xlsx`));

// ---------- panel de administración ----------
app.get('/admin', requireAdmin, ruta(async (req, res) => {
  const filtros = reportes.parsearFiltros(req.query);
  const informe = await reportes.construir(filtros);
  res.render('admin', { informe, filtros, opciones: reportes.OPCIONES, lineas: await lineasWhatsapp(), productos: await lineasProducto(true) });
}));
app.get('/admin/datos.json', requireAdmin, ruta(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await reportes.construir(reportes.parsearFiltros(req.query)));
}));
app.get('/admin/export.xlsx', requireAdmin, ruta(async (req, res) => {
  const informe = await reportes.construir(reportes.parsearFiltros(req.query));
  const buffer = await excel.libroAdmin(informe);
  enviarExcel(res, `FerreObras_informe_${informe.hoy}.xlsx`, buffer);
}));

// ---------- líneas de producto ----------
app.get('/lineas', ruta(async (req, res) => res.render('lineas', { productos: await lineasProducto(true) })));
app.post('/lineas', ruta(async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (nombre) await db.query(`INSERT INTO lineas_producto (nombre, orden) VALUES ($1, (SELECT COALESCE(MAX(orden),0)+1 FROM lineas_producto)) ON CONFLICT (nombre) DO UPDATE SET activa = TRUE`, [nombre]);
  res.redirect('/lineas?msg=' + encodeURIComponent('Línea guardada'));
}));
app.post('/lineas/:id/estado', ruta(async (req, res) => {
  await db.query('UPDATE lineas_producto SET activa = NOT activa WHERE id=$1', [req.params.id]);
  res.redirect('/lineas');
}));

// ---------- rutas de despacho ----------
// Dos secciones: el planificador (/rutas) y la gestión de rutas (/rutas/gestion).
// El planificador consulta y guarda por /rutas/api/* (JSON) para no recargar el mapa.
const api = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => { console.error(e); if (!res.headersSent) res.status(500).json({ error: 'No se pudo completar la operación. Intenta de nuevo.' }); });
const volverGestion = (res, msg) => res.redirect('/rutas/gestion?msg=' + encodeURIComponent(msg));
const formRuta = async (res, r, error) => res.status(error ? 400 : 200).render('ruta_form', { r, error, ...rutas.opcionesFormulario() });

app.get('/rutas', ruta(async (req, res) => {
  const lista = await rutas.todasLasRutas();
  const pedida = Number(req.query.ruta);
  res.render('rutas_planificador', { rutas: lista, pedida: lista.some(r => r.id === pedida) ? pedida : null, estados: rutas.ESTADOS, ...rutas.opcionesFormulario() });
}));
app.get('/rutas/gestion', ruta(async (req, res) => res.render('rutas_gestion', await rutas.resumenGestion())));
app.get('/rutas/nueva', ruta(async (req, res) => formRuta(res, null, null)));
app.post('/rutas', ruta(async (req, res) => {
  const d = rutas.datosRuta(req.body);
  if (!d.nombre || !d.paradas.length) return formRuta(res, d, 'La ruta necesita un nombre y al menos un municipio.');
  try { await rutas.crearRuta(d); } catch (e) { if (e.code === '23505') return formRuta(res, d, 'Ya existe una ruta con ese nombre.'); throw e; }
  volverGestion(res, `Ruta "${d.nombre}" creada`);
}));
app.get('/rutas/:id(\\d+)/editar', ruta(async (req, res) => {
  const r = await rutas.obtenerRuta(req.params.id);
  if (!r) return noEncontrado(res, 'Ruta');
  formRuta(res, r, null);
}));
app.post('/rutas/:id(\\d+)/editar', ruta(async (req, res) => {
  const d = { ...rutas.datosRuta(req.body), id: Number(req.params.id) };
  if (!(await rutas.obtenerRuta(d.id))) return noEncontrado(res, 'Ruta');
  if (!d.nombre || !d.paradas.length) return formRuta(res, d, 'La ruta necesita un nombre y al menos un municipio.');
  try { await rutas.actualizarRuta(d.id, d); } catch (e) { if (e.code === '23505') return formRuta(res, d, 'Ya existe otra ruta con ese nombre.'); throw e; }
  volverGestion(res, `Ruta "${d.nombre}" guardada`);
}));
app.post('/rutas/:id(\\d+)/estado', ruta(async (req, res) => { await rutas.cambiarEstadoRuta(req.params.id); volverGestion(res, 'Estado de la ruta actualizado'); }));
app.post('/rutas/:id(\\d+)/eliminar', ruta(async (req, res) => { await rutas.eliminarRuta(req.params.id); volverGestion(res, 'Ruta eliminada'); }));
app.get('/rutas/:id(\\d+)/export.xlsx', ruta(async (req, res) => {
  const datos = await rutas.datosPlanificador(req.params.id);
  if (!datos) return noEncontrado(res, 'Ruta');
  enviarExcel(res, `FerreObras_${nombreArchivo(datos.ruta.nombre)}_${datos.ruta.proximo_despacho || calc.hoyBogota()}.xlsx`, await excel.libroRuta(datos));
}));
app.post('/rutas/importar', express.raw({ type: 'application/octet-stream', limit: '15mb' }), api(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'Selecciona un archivo de Excel (.xlsx).' });
  let r;
  try { r = await rutas.importarLibro(req.body); } catch (e) { console.warn('[rutas] importación rechazada:', e.message); return res.status(400).json({ error: 'No se pudo leer el archivo. Verifica que sea un Excel .xlsx.' }); }
  if (!r.hojas && !r.rutas_creadas && !r.rutas_existentes) return res.status(400).json({ error: 'El archivo no tiene una hoja con columnas CLIENTE y MUNICIPIO ni un cronograma de rutas.' });
  res.json({ ...r, mensaje: `Importación lista: ${r.rutas_creadas} ruta(s) nuevas, ${r.clientes_creados} cliente(s) nuevos, ${r.clientes_actualizados} actualizado(s) y ${r.clientes_sin_cambios} sin cambios.` });
}));

app.get('/rutas/api/:id(\\d+)', api(async (req, res) => {
  const datos = await rutas.datosPlanificador(req.params.id);
  if (!datos) return res.status(404).json({ error: 'La ruta no existe o fue eliminada.' });
  res.setHeader('Cache-Control', 'no-store');
  res.json(datos);
}));
app.post('/rutas/api/:id(\\d+)/plan', api(async (req, res) => {
  const fila = await rutas.guardarPlan(Number(req.params.id), req.body || {}, req.session.usuario);
  if (!fila) return res.status(400).json({ error: 'Datos no válidos.' });
  res.json(fila);
}));
app.post('/rutas/api/:id(\\d+)/plan/masivo', api(async (req, res) => {
  await rutas.guardarPlanMasivo(Number(req.params.id), (req.body || {}).items, (req.body || {}).incluido, req.session.usuario);
  res.json({ ok: true });
}));
app.post('/rutas/api/:id(\\d+)/reiniciar', api(async (req, res) => { await rutas.reiniciarPlan(Number(req.params.id)); res.json({ ok: true }); }));
app.post('/rutas/api/:id(\\d+)/despacho', api(async (req, res) => { await rutas.fijarDespacho(Number(req.params.id), (req.body || {}).fecha); res.json({ ok: true }); }));
app.get('/rutas/api/clientes', api(async (req, res) => res.json(await rutas.buscarClientes(String(req.query.q || '')))));
app.post('/rutas/api/clientes', api(async (req, res) => {
  const c = await rutas.crearCliente(req.body || {});
  if (!c) return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
  res.json(rutas.fichaCliente(c));
}));
app.post('/rutas/api/clientes/:id(\\d+)', api(async (req, res) => {
  const c = await rutas.actualizarCliente(Number(req.params.id), req.body || {});
  if (!c) return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
  res.json(rutas.fichaCliente(c));
}));
app.post('/rutas/api/clientes/:id(\\d+)/eliminar', api(async (req, res) => { await rutas.eliminarCliente(Number(req.params.id)); res.json({ ok: true }); }));
app.post('/rutas/api/ubicacion', api(async (req, res) => {
  const b = req.body || {};
  if (!(await rutas.guardarUbicacion(b.tipo, b.id, b.lat, b.lng))) return res.status(400).json({ error: 'Ubicación no válida.' });
  res.json({ ok: true });
}));
app.get('/rutas/api/geocodificar', api(async (req, res) => {
  const r = await rutas.geocodificarDireccion(req.query.tipo === 'o' ? 'o' : 'c', req.query.id);
  res.status(r.error ? 422 : 200).json(r);
}));

// ---------- errores ----------
app.use((req, res) => res.status(404).render('mensaje', { titulo: 'Página no encontrada', mensaje: 'La dirección que abriste no existe.' }));
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(err);
  if (res.headersSent) return;
  res.status(500).render('mensaje', { titulo: 'Algo salió mal', mensaje: 'Ocurrió un error inesperado. Intenta de nuevo; si persiste, avisa al administrador.' });
});

const port = process.env.PORT || 3000;
// Las tablas del módulo de rutas se crean solas si no existen (el resto del esquema sigue en schema.sql)
rutas.asegurarEsquema()
  .catch((e) => console.error('[rutas] no se pudieron crear las tablas del módulo de rutas:', e.message))
  .finally(() => app.listen(port, () => console.log(`FerreObras escuchando en :${port}`)));
