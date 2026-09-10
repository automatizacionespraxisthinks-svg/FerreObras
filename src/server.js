const express = require('express');
const path = require('path');
const cookieSession = require('cookie-session');
const db = require('./db');
const calc = require('./calc');
const notify = require('./notify');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, '..', 'public')));
app.use(cookieSession({ name: 'ferreobras', secret: process.env.SESSION_SECRET || 'cambiar', maxAge: 12 * 60 * 60 * 1000, sameSite: 'lax' }));

// ---------- helpers ----------
const fmt = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
app.locals.fmt = fmt;
app.locals.hoy = calc.hoyBogota;
app.locals.diffDays = calc.diffDays;

async function lineasWhatsapp() { return (await db.query('SELECT numero, correo FROM lineas_whatsapp WHERE activa ORDER BY numero')).rows; }
async function lineasProducto(todas = false) {
  return (await db.query(`SELECT id, nombre, orden, activa FROM lineas_producto ${todas ? '' : 'WHERE activa'} ORDER BY orden, id`)).rows;
}
async function cargarObra(id) {
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

// ---------- auth ----------
function requireLogin(req, res, next) { if (req.session && req.session.linea) return next(); res.redirect('/login'); }
app.get('/login', async (req, res) => res.render('login', { lineas: await lineasWhatsapp(), error: null }));
app.post('/login', async (req, res) => {
  const { linea, clave } = req.body;
  const esperada = process.env[`PASS_${linea}`];
  if (esperada && clave === esperada) { req.session.linea = linea; return res.redirect('/'); }
  res.render('login', { lineas: await lineasWhatsapp(), error: 'Línea o clave incorrecta.' });
});
app.post('/logout', (req, res) => { req.session = null; res.redirect('/login'); });
app.use(requireLogin);
app.use((req, res, next) => { res.locals.linea = req.session.linea; next(); });

// ---------- lista de obras ----------
app.get('/', async (req, res) => {
  const ver = req.query.ver === 'cerradas' ? 'cerradas' : 'activas';
  const rows = (await db.query(`
    SELECT o.*,
      (SELECT json_build_object('nombre', e.nombre, 'fecha_programada', e.fecha_programada, 'fecha_aviso', e.fecha_aviso)
         FROM etapas e WHERE e.obra_id = o.id AND e.estado = 'pendiente' AND e.orden > 0 ORDER BY e.orden LIMIT 1) AS proxima,
      (SELECT COUNT(*) FROM etapas e WHERE e.obra_id = o.id AND e.orden > 0) AS total_etapas,
      (SELECT COUNT(*) FROM etapas e WHERE e.obra_id = o.id AND e.orden > 0 AND e.estado <> 'pendiente') AS etapas_hechas
    FROM obras o WHERE o.estado = $1 ORDER BY o.updated_at DESC`, [ver === 'cerradas' ? 'cerrada' : 'activa'])).rows;
  const hoy = calc.hoyBogota();
  for (const o of rows) {
    if (o.proxima) {
      o.proxima.fecha_programada = calc.toISO(o.proxima.fecha_programada);
      o.proxima.fecha_aviso = calc.toISO(o.proxima.fecha_aviso);
      o.dias_para_aviso = o.proxima.fecha_aviso ? calc.diffDays(hoy, o.proxima.fecha_aviso) : null;
    }
  }
  // más urgentes primero
  rows.sort((a, b) => (a.dias_para_aviso ?? 9999) - (b.dias_para_aviso ?? 9999));
  res.render('index', { obras: rows, ver });
});

// ---------- nueva obra ----------
app.get('/obras/nueva', async (req, res) => {
  res.render('obra_form', { obra: null, lineas: await lineasWhatsapp(), productos: await lineasProducto(), error: null });
});
app.post('/obras', async (req, res) => {
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
       datos.fecha_cimentacion, datos.num_placas, datos.intervalo_dias, datos.dias_aviso, JSON.stringify(precios), datos.notas, req.session.linea]);
    const id = r.rows[0].id;
    for (const e of calc.etapasIniciales(datos)) {
      await client.query(
        `INSERT INTO etapas (obra_id, orden, nombre, intervalo_dias, dias_aviso, fecha_programada, fecha_fija, fecha_aviso) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, e.orden, e.nombre, e.intervalo_dias, e.dias_aviso, e.fecha_programada, e.fecha_fija, e.fecha_aviso]);
    }
    return id;
  });
  notify.calendar('obra_creada', obraId);
  res.redirect(`/obras/${obraId}`);
});

// ---------- detalle ----------
app.get('/obras/:id', async (req, res) => {
  const data = await cargarObra(req.params.id);
  if (!data) return res.status(404).send('Obra no encontrada');
  res.render('obra', { ...data, productos: await lineasProducto(), lineas: await lineasWhatsapp(), msg: req.query.msg || null });
});

// editar cabecera
app.get('/obras/:id/editar', async (req, res) => {
  const data = await cargarObra(req.params.id);
  if (!data) return res.status(404).send('Obra no encontrada');
  res.render('obra_form', { obra: { ...data.obra, fecha_cimentacion: calc.toISO(data.obra.fecha_cimentacion) }, lineas: await lineasWhatsapp(), productos: await lineasProducto(), error: null });
});
app.post('/obras/:id/editar', async (req, res) => {
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
});

// guardar una etapa (fecha, nombre, estado, ventas) y recalcular las siguientes
app.post('/obras/:id/etapas/:eid', async (req, res) => {
  const { id, eid } = req.params; const b = req.body;
  const data = await cargarObra(id);
  if (!data) return res.status(404).send('Obra no encontrada');
  const productos = await lineasProducto();
  const etapa = data.etapas.find(e => String(e.id) === String(eid));
  if (!etapa) return res.status(404).send('Etapa no encontrada');

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
  res.redirect(`/obras/${id}?msg=${encodeURIComponent(msg)}`);
});

// agregar etapa al final (cubierta, acabados, otra placa...)
app.post('/obras/:id/etapas', async (req, res) => {
  const { id } = req.params; const b = req.body;
  const data = await cargarObra(id);
  if (!data) return res.status(404).send('Obra no encontrada');
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
});

// eliminar etapa (solo pendientes y no la cimentación)
app.post('/obras/:id/etapas/:eid/eliminar', async (req, res) => {
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
});

// cerrar / reabrir obra
app.post('/obras/:id/cerrar', async (req, res) => {
  const { id } = req.params;
  await db.query(`UPDATE obras SET estado='cerrada', cerrada_at=NOW(), updated_at=NOW() WHERE id=$1`, [id]);
  notify.calendar('obra_cerrada', Number(id));
  notify.cierre(Number(id));
  res.redirect(`/obras/${id}?msg=${encodeURIComponent('Obra cerrada')}`);
});
app.post('/obras/:id/reabrir', async (req, res) => {
  const { id } = req.params;
  await db.query(`UPDATE obras SET estado='activa', cerrada_at=NULL, updated_at=NOW() WHERE id=$1`, [id]);
  notify.calendar('fechas_actualizadas', Number(id));
  res.redirect(`/obras/${id}?msg=${encodeURIComponent('Obra reabierta')}`);
});

// exportar historial (CSV compatible con Excel)
app.get('/obras/:id/export.csv', async (req, res) => {
  const data = await cargarObra(req.params.id);
  if (!data) return res.status(404).send('Obra no encontrada');
  const productos = await lineasProducto(true);
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [];
  lines.push(['Cliente', data.obra.cliente, 'Celular', data.obra.celular].map(esc).join(';'));
  lines.push(['Obra', data.obra.obra, 'Dirección obra', data.obra.direccion_obra].map(esc).join(';'));
  lines.push(['Maestro', data.obra.maestro, 'Celular maestro', data.obra.celular_maestro].map(esc).join(';'));
  lines.push(['Precios', ...productos.map(p => `${p.nombre}: ${data.obra.precios?.[p.nombre] || ''}`)].map(esc).join(';'));
  lines.push('');
  lines.push(['Etapa', 'Programada', 'Aviso', 'Real', 'Estado', ...productos.map(p => p.nombre), 'Notas'].map(esc).join(';'));
  for (const e of data.etapas) {
    lines.push([e.nombre, fmt(e.fecha_programada), fmt(e.fecha_aviso), fmt(e.fecha_real), e.estado,
      ...productos.map(p => { const v = data.ventas[`${e.id}:${p.id}`]; return v?.vendido ? (v.detalle ? `X - ${v.detalle}` : 'X') : ''; }), e.notas].map(esc).join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="obra_${data.obra.id}_${data.obra.cliente.replace(/[^\w]+/g, '_')}.csv"`);
  res.send('\ufeff' + lines.join('\r\n'));
});

// ---------- líneas de producto ----------
app.get('/lineas', async (req, res) => res.render('lineas', { productos: await lineasProducto(true), msg: req.query.msg || null }));
app.post('/lineas', async (req, res) => {
  const nombre = (req.body.nombre || '').trim();
  if (nombre) await db.query(`INSERT INTO lineas_producto (nombre, orden) VALUES ($1, (SELECT COALESCE(MAX(orden),0)+1 FROM lineas_producto)) ON CONFLICT (nombre) DO UPDATE SET activa = TRUE`, [nombre]);
  res.redirect('/lineas?msg=' + encodeURIComponent('Línea guardada'));
});
app.post('/lineas/:id/estado', async (req, res) => {
  await db.query('UPDATE lineas_producto SET activa = NOT activa WHERE id=$1', [req.params.id]);
  res.redirect('/lineas');
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`FerreObras escuchando en :${port}`));
