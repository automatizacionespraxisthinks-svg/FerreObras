// Rutas de despacho de FerreAceros.
// Una ruta es una lista ordenada de municipios (paradas) que sale de una sede. Los clientes que se
// pueden contactar para una ruta se calculan por el municipio registrado: las ferreterías del
// directorio (clientes_ruta) y los clientes de obras en curso. La planificación guarda, por ruta,
// qué clientes se quitaron o agregaron y el resultado del contacto (estado, peso, observación).
const ExcelJS = require('exceljs');
const db = require('./db');
const calc = require('./calc');
const mun = require('./municipios');

const ESTADOS = [
  { id: 'por_contactar', nombre: 'Por contactar' },
  { id: 'no_contesta', nombre: 'No contesta' },
  { id: 'pendiente', nombre: 'Pendiente respuesta' },
  { id: 'no_necesita', nombre: 'No necesita' },
  { id: 'despacho', nombre: 'Despacho confirmado' },
];
const FRECUENCIAS = ['Todos los días', 'Día de por medio', 'Cada 8 días', 'Cada 15 días', 'Mensual', 'A demanda'];
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const COLORES = ['#092F77', '#3D6BD1', '#1F8A4C', '#B45309', '#C62828', '#5A3E85', '#2E8B8B', '#C05621'];
const CAMPOS_CLIENTE = ['nombre', 'municipio', 'direccion', 'sector', 'nit', 'razon_social', 'telefonos', 'tipologia', 'volumen_compra', 'notas'];

// ---------- esquema (idempotente; se ejecuta al arrancar) ----------
async function asegurarEsquema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS rutas (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      descripcion TEXT,
      paradas JSONB NOT NULL DEFAULT '[]',
      origen TEXT NOT NULL DEFAULT '',
      frecuencia TEXT,
      dias TEXT,
      color TEXT NOT NULL DEFAULT '#092F77',
      proximo_despacho DATE,
      notas TEXT,
      activa BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS rutas_nombre_uq ON rutas (lower(nombre));
    CREATE TABLE IF NOT EXISTS clientes_ruta (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL,
      municipio TEXT,
      direccion TEXT,
      sector TEXT,
      nit TEXT,
      razon_social TEXT,
      telefonos TEXT,
      tipologia TEXT,
      volumen_compra TEXT,
      notas TEXT,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS rutas_plan (
      id SERIAL PRIMARY KEY,
      ruta_id INT NOT NULL REFERENCES rutas(id) ON DELETE CASCADE,
      cliente_id INT REFERENCES clientes_ruta(id) ON DELETE CASCADE,
      obra_id INT REFERENCES obras(id) ON DELETE CASCADE,
      incluido BOOLEAN NOT NULL DEFAULT TRUE,
      estado TEXT NOT NULL DEFAULT 'por_contactar',
      peso NUMERIC,
      observacion TEXT,
      actualizado_por TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK ((cliente_id IS NULL) <> (obra_id IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS rutas_plan_cliente_uq ON rutas_plan (ruta_id, cliente_id) WHERE cliente_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS rutas_plan_obra_uq ON rutas_plan (ruta_id, obra_id) WHERE obra_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS rutas_ubicaciones (
      tipo CHAR(1) NOT NULL,
      ref_id INT NOT NULL,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tipo, ref_id)
    );
    CREATE TABLE IF NOT EXISTS rutas_geocache (
      clave TEXT PRIMARY KEY,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      descripcion TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`);
}

// ---------- utilidades ----------
const texto = (v, max = 300) => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s ? s.slice(0, max) : null; };
const nota = (v, max = 2000) => { const s = String(v == null ? '' : v).replace(/\r/g, '').trim(); return s ? s.slice(0, max) : null; };
const lista = (v) => (v == null ? [] : [].concat(v)).map(String);
const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'el', 'en']);
// "SONIA YANIRA NIÑO BORDA" -> "Sonia Yanira Niño Borda" (solo si viene todo en mayúsculas o minúsculas)
function tipoTitulo(s) {
  if (!s || (s !== s.toUpperCase() && s !== s.toLowerCase())) return s;
  return s.toLowerCase().replace(/\S+/g, (w, i) => (i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)));
}
// Celulares colombianos contenidos en un texto libre ("GLORIA 3134153102 · 315 893 7344")
function celulares(t) {
  const s = String(t || '').replace(/(3\d{2})[ .](\d{3})[ .]?(\d{4})(?!\d)/g, '$1$2$3').replace(/(3\d{2})[ .](\d{7})(?!\d)/g, '$1$2');
  return [...new Set(s.match(/(?<!\d)3\d{9}(?!\d)/g) || [])];
}
const ordenarNombre = (a, b) => a.nombre.localeCompare(b.nombre, 'es', { numeric: true, sensitivity: 'base' });

// ---------- rutas ----------
function normalizarRuta(r) {
  return { ...r, paradas: Array.isArray(r.paradas) ? r.paradas : [], proximo_despacho: calc.toISO(r.proximo_despacho), dias_lista: r.dias ? r.dias.split(',').map(d => d.trim()).filter(Boolean) : [] };
}
async function obtenerRuta(id) {
  if (!/^\d+$/.test(String(id))) return null;
  const r = (await db.query('SELECT * FROM rutas WHERE id = $1', [id])).rows[0];
  return r ? normalizarRuta(r) : null;
}
async function todasLasRutas() {
  return (await db.query('SELECT * FROM rutas')).rows.map(normalizarRuta).sort((a, b) => (b.activa - a.activa) || ordenarNombre(a, b));
}
// Datos de un formulario de ruta, ya validados
function datosRuta(b) {
  const vistas = new Set();
  const paradas = lista(b.paradas).map(p => mun.nombre(p)).filter(p => { const k = mun.clave(p); if (!k || vistas.has(k)) return false; vistas.add(k); return true; });
  return {
    nombre: texto(b.nombre, 80), descripcion: texto(b.descripcion, 200), paradas,
    origen: mun.sede(b.origen) ? b.origen : '', frecuencia: texto(b.frecuencia, 120),
    dias: DIAS.filter(d => lista(b.dias).includes(d)).join(', ') || null,
    color: COLORES.includes(b.color) ? b.color : COLORES[0],
    proximo_despacho: /^\d{4}-\d{2}-\d{2}$/.test(b.proximo_despacho || '') ? b.proximo_despacho : null,
    notas: nota(b.notas), activa: b.activa === 'on' || b.activa === true,
  };
}
async function crearRuta(d) {
  return (await db.query(
    `INSERT INTO rutas (nombre, descripcion, paradas, origen, frecuencia, dias, color, proximo_despacho, notas, activa) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [d.nombre, d.descripcion, JSON.stringify(d.paradas), d.origen, d.frecuencia, d.dias, d.color, d.proximo_despacho, d.notas, d.activa])).rows[0].id;
}
async function actualizarRuta(id, d) {
  await db.query(
    `UPDATE rutas SET nombre=$2, descripcion=$3, paradas=$4, origen=$5, frecuencia=$6, dias=$7, color=$8, proximo_despacho=$9, notas=$10, activa=$11, updated_at=NOW() WHERE id=$1`,
    [id, d.nombre, d.descripcion, JSON.stringify(d.paradas), d.origen, d.frecuencia, d.dias, d.color, d.proximo_despacho, d.notas, d.activa]);
}
const cambiarEstadoRuta = (id) => db.query('UPDATE rutas SET activa = NOT activa, updated_at = NOW() WHERE id = $1', [id]);
const eliminarRuta = (id) => db.query('DELETE FROM rutas WHERE id = $1', [id]);
const fijarDespacho = (id, fecha) => db.query('UPDATE rutas SET proximo_despacho = $2, updated_at = NOW() WHERE id = $1', [id, /^\d{4}-\d{2}-\d{2}$/.test(fecha || '') ? fecha : null]);

// ---------- universo de clientes (ferreterías + obras en curso) ----------
function fichaCliente(c, u) {
  const m = mun.buscar(c.municipio) || mun.detectar([c.direccion]);
  return {
    key: `c${c.id}`, tipo: 'c', id: c.id, nombre: c.nombre, municipio: m ? m.nombre : (c.municipio || ''), clave_municipio: m ? m.clave : mun.clave(c.municipio),
    direccion: c.direccion || '', sector: c.sector || '', telefonos: c.telefonos || '', nit: c.nit || '', razon_social: c.razon_social || '',
    tipologia: c.tipologia || '', volumen_compra: c.volumen_compra || '', notas: c.notas || '',
    lat: u ? u.lat : null, lng: u ? u.lng : null, ubicacion: u ? 'manual' : null,
  };
}
function fichaObra(o, u) {
  // manda el municipio de la obra (a donde va el despacho); la dirección del cliente es solo respaldo
  const m = mun.detectar([o.obra, o.direccion_obra]) || mun.detectar([o.direccion_cliente]);
  return {
    key: `o${o.id}`, tipo: 'o', id: o.id, nombre: o.cliente, municipio: m ? m.nombre : '', clave_municipio: m ? m.clave : '',
    obra: o.obra || '', direccion: o.direccion_obra || o.direccion_cliente || '', direccion_cliente: o.direccion_cliente || '',
    telefonos: o.celular || '', maestro: o.maestro || '', celular_maestro: o.celular_maestro || '', linea: o.linea || '', notas: o.notas || '',
    lat: u ? u.lat : null, lng: u ? u.lng : null, ubicacion: u ? 'manual' : null,
  };
}
async function cargarUniverso() {
  const [clientes, obras, ubicaciones] = (await Promise.all([
    db.query('SELECT * FROM clientes_ruta WHERE activo'),
    db.query(`SELECT id, cliente, celular, direccion_cliente, obra, direccion_obra, maestro, celular_maestro, linea, notas FROM obras WHERE estado = 'activa'`),
    db.query('SELECT tipo, ref_id, lat, lng FROM rutas_ubicaciones'),
  ])).map(r => r.rows);
  const pos = new Map(ubicaciones.map(u => [`${u.tipo}${u.ref_id}`, u]));
  return [...clientes.map(c => fichaCliente(c, pos.get(`c${c.id}`))), ...obras.map(o => fichaObra(o, pos.get(`o${o.id}`)))].sort(ordenarNombre);
}
// Clientes de una ruta: los de sus municipios más los agregados a mano, con el estado de la planificación
function clientesDeRuta(ruta, universo, plan) {
  const paradas = new Map(ruta.paradas.map((p, i) => [mun.clave(p), i]));
  const planPorKey = new Map(plan.map(p => [p.cliente_id ? `c${p.cliente_id}` : `o${p.obra_id}`, p]));
  const out = [];
  for (const c of universo) {
    const enRuta = paradas.has(c.clave_municipio);
    const p = planPorKey.get(c.key);
    if (!enRuta && !(p && p.incluido)) continue;
    out.push({
      ...c, en_ruta: enRuta, parada: enRuta ? paradas.get(c.clave_municipio) : null,
      incluido: p ? p.incluido : true, estado: p ? p.estado : 'por_contactar', peso: p && p.peso != null ? Number(p.peso) : null,
      observacion: p ? p.observacion || '' : '', actualizado_por: p ? p.actualizado_por : null, actualizado: p ? p.updated_at : null,
    });
  }
  return out;
}
// Los clientes sin ubicación propia se reparten alrededor del centro de su municipio (espiral estable por id)
function alrededor(centro, c) {
  const semilla = c.id * 2 + (c.tipo === 'o' ? 1 : 0);
  const angulo = semilla * 2.399963, radio = 0.0012 + ((semilla * 7919) % 97) / 97 * 0.0048;
  return { lat: centro.lat + radio * Math.sin(angulo), lng: centro.lng + radio * Math.cos(angulo) };
}

// ---------- geocodificación de apoyo (Nominatim / OpenStreetMap) ----------
// Solo para municipios fuera del catálogo y para buscar la dirección de un cliente a pedido.
// Respeta el límite de 1 consulta por segundo y guarda los resultados en rutas_geocache.
const BOYACA = '-74.75,7.10,-71.90,4.60';
let colaGeo = Promise.resolve(), ultimaGeo = 0;
function nominatim(q) {
  const tarea = colaGeo.then(async () => {
    const espera = ultimaGeo + 1100 - Date.now();
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
    try {
      const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({ q, format: 'jsonv2', limit: '5', countrycodes: 'co', viewbox: BOYACA, bounded: '1' });
      const r = await fetch(url, { headers: { 'User-Agent': 'FerreObras/1.1 (rutas de despacho FerreAceros)', 'Accept-Language': 'es' }, signal: AbortSignal.timeout(7000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { console.warn('[rutas] geocodificación no disponible:', e.message); return null; }
    finally { ultimaGeo = Date.now(); }
  });
  colaGeo = tarea.catch(() => {});
  return tarea;
}
async function ubicarMunicipios(nombres, maxConsultas = 3) {
  const res = new Map(), faltan = new Map();
  for (const n of nombres) {
    const k = mun.clave(n);
    if (!k || res.has(k) || faltan.has(k)) continue;
    const m = mun.buscar(n);
    if (m) res.set(k, { nombre: m.nombre, lat: m.lat, lng: m.lng }); else faltan.set(k, mun.nombre(n));
  }
  if (!faltan.size) return res;
  const cache = new Map((await db.query('SELECT * FROM rutas_geocache WHERE clave = ANY($1)', [[...faltan.keys()].map(k => 'm:' + k)])).rows.map(c => [c.clave.slice(2), c]));
  let consultas = 0;
  for (const [k, nombre] of faltan) {
    let c = cache.get(k);
    const reintentar = c && c.lat == null && Date.now() - new Date(c.created_at).getTime() > 7 * 864e5;
    if ((!c || reintentar) && consultas < maxConsultas) {
      consultas++;
      const r = await nominatim(`${nombre}, Boyacá, Colombia`);
      if (r) {
        // solo un lugar con ese mismo nombre ("San Luis" no debe caer en "San Luis de Gaceno")
        const x = r.find(y => mun.normalizar(y.name) === mun.normalizar(nombre));
        c = { lat: x ? Number(x.lat) : null, lng: x ? Number(x.lon) : null, descripcion: x ? x.display_name : null };
        await db.query(`INSERT INTO rutas_geocache (clave, lat, lng, descripcion) VALUES ($1,$2,$3,$4)
          ON CONFLICT (clave) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, descripcion = EXCLUDED.descripcion, created_at = NOW()`, ['m:' + k, c.lat, c.lng, c.descripcion]);
      }
    }
    if (c && c.lat != null) res.set(k, { nombre, lat: c.lat, lng: c.lng, aproximada: true, descripcion: c.descripcion });
  }
  return res;
}
// Busca la dirección de un cliente; solo acepta resultados cerca de su municipio
async function geocodificarDireccion(tipo, id) {
  const c = (await cargarUniverso()).find(x => x.tipo === tipo && x.id === Number(id));
  if (!c || !c.direccion) return { error: 'El cliente no tiene dirección registrada.' };
  const centro = (await ubicarMunicipios([c.municipio])).get(c.clave_municipio);
  const r = await nominatim(`${c.direccion}, ${c.municipio || ''}, Boyacá, Colombia`);
  if (r === null) return { error: 'El servicio de mapas no respondió. Intenta de nuevo en un momento.' };
  const x = r.find(y => !centro || (Math.abs(Number(y.lat) - centro.lat) < 0.08 && Math.abs(Number(y.lon) - centro.lng) < 0.08));
  if (!x) return { error: 'No se encontró la dirección en el mapa. Ubícala a mano con un clic.' };
  return { lat: Number(x.lat), lng: Number(x.lon), descripcion: x.display_name };
}
async function guardarUbicacion(tipo, id, lat, lng) {
  if (!['c', 'o'].includes(tipo) || !/^\d+$/.test(String(id))) return false;
  if (lat == null || lng == null) { await db.query('DELETE FROM rutas_ubicaciones WHERE tipo = $1 AND ref_id = $2', [tipo, id]); return true; }
  lat = Number(lat); lng = Number(lng);
  if (!(lat > -5 && lat < 14 && lng > -82 && lng < -66)) return false; // fuera de Colombia
  await db.query(`INSERT INTO rutas_ubicaciones (tipo, ref_id, lat, lng) VALUES ($1,$2,$3,$4)
    ON CONFLICT (tipo, ref_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = NOW()`, [tipo, id, lat, lng]);
  return true;
}

// ---------- planificador ----------
async function datosPlanificador(id) {
  const ruta = await obtenerRuta(id);
  if (!ruta) return null;
  const [universo, plan] = await Promise.all([cargarUniverso(), db.query('SELECT * FROM rutas_plan WHERE ruta_id = $1', [id]).then(r => r.rows)]);
  const clientes = clientesDeRuta(ruta, universo, plan);
  const ubic = await ubicarMunicipios([...ruta.paradas, ...clientes.map(c => c.municipio)]);
  const paradas = ruta.paradas.map((nombre, i) => {
    const u = ubic.get(mun.clave(nombre));
    return { orden: i + 1, nombre, clave: mun.clave(nombre), lat: u ? u.lat : null, lng: u ? u.lng : null, aproximada: !!(u && u.aproximada) };
  });
  for (const c of clientes) {
    if (c.lat != null) continue;
    const centro = ubic.get(c.clave_municipio);
    if (centro) { Object.assign(c, alrededor(centro, c)); c.ubicacion = 'municipio'; }
  }
  return { ruta, paradas, sede: mun.sede(ruta.origen), clientes, estados: ESTADOS };
}
const colPlan = (tipo) => (tipo === 'o' ? 'obra_id' : 'cliente_id');
async function guardarPlan(rutaId, b, usuario, client = db) {
  const tipo = b.tipo === 'o' ? 'o' : 'c', refId = Number(b.id);
  if (!Number.isInteger(refId) || refId <= 0) return null;
  const col = colPlan(tipo);
  const incluido = typeof b.incluido === 'boolean' ? b.incluido : null;
  const estado = ESTADOS.some(e => e.id === b.estado) ? b.estado : null;
  const conPeso = 'peso' in b, peso = b.peso === '' || b.peso == null ? null : Number(b.peso);
  if (conPeso && peso !== null && !(peso >= 0 && peso < 1e6)) return null;
  const conObs = 'observacion' in b, obs = nota(b.observacion, 500);
  return (await client.query(
    `INSERT INTO rutas_plan (ruta_id, ${col}, incluido, estado, peso, observacion, actualizado_por)
     VALUES ($1, $2, COALESCE($3, TRUE), COALESCE($4, 'por_contactar'), $5, $6, $7)
     ON CONFLICT (ruta_id, ${col}) WHERE ${col} IS NOT NULL DO UPDATE SET
       incluido = COALESCE($3, rutas_plan.incluido), estado = COALESCE($4, rutas_plan.estado),
       peso = CASE WHEN $8 THEN $5 ELSE rutas_plan.peso END, observacion = CASE WHEN $9 THEN $6 ELSE rutas_plan.observacion END,
       actualizado_por = $7, updated_at = NOW()
     RETURNING *`,
    [rutaId, refId, incluido, estado, conPeso ? peso : null, conObs ? obs : null, usuario, conPeso, conObs])).rows[0];
}
async function guardarPlanMasivo(rutaId, items, incluido, usuario) {
  await db.tx(async (client) => { for (const it of (Array.isArray(items) ? items : []).slice(0, 500)) await guardarPlan(rutaId, { tipo: it.tipo, id: it.id, incluido: !!incluido }, usuario, client); });
}
const reiniciarPlan = (rutaId) => db.query('DELETE FROM rutas_plan WHERE ruta_id = $1', [rutaId]);

// ---------- gestión: resumen de rutas y cobertura ----------
async function resumenGestion() {
  const [rutas, universo, plan] = await Promise.all([todasLasRutas(), cargarUniverso(), db.query('SELECT * FROM rutas_plan').then(r => r.rows)]);
  const cubiertos = new Set();
  for (const r of rutas) {
    const cs = clientesDeRuta(r, universo, plan.filter(p => p.ruta_id === r.id));
    r.ferreterias = cs.filter(c => c.tipo === 'c' && c.en_ruta).length;
    r.obras = cs.filter(c => c.tipo === 'o' && c.en_ruta).length;
    r.seleccionados = cs.filter(c => c.incluido).length;
    r.despachos = cs.filter(c => c.incluido && c.estado === 'despacho').length;
    r.paradas_info = r.paradas.map(p => ({ nombre: p, clientes: cs.filter(c => c.clave_municipio === mun.clave(p)).length, catalogo: !!mun.buscar(p) }));
    r.sede_nombre = (mun.sede(r.origen) || {}).nombre || '';
    if (r.activa) for (const p of r.paradas) cubiertos.add(mun.clave(p));
  }
  const sinRuta = new Map();
  for (const c of universo) {
    if (c.tipo !== 'c' || cubiertos.has(c.clave_municipio)) continue;
    const nombre = c.municipio || 'Sin municipio';
    sinRuta.set(nombre, (sinRuta.get(nombre) || 0) + 1);
  }
  return {
    rutas, totalFerreterias: universo.filter(c => c.tipo === 'c').length, totalObras: universo.filter(c => c.tipo === 'o').length,
    sinRuta: [...sinRuta.entries()].map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n),
  };
}

// ---------- clientes (ferreterías) ----------
function datosCliente(b) {
  const d = {};
  for (const k of CAMPOS_CLIENTE) d[k] = k === 'notas' ? nota(b[k]) : texto(b[k], k === 'direccion' || k === 'telefonos' ? 300 : 160);
  if (d.municipio) d.municipio = mun.nombre(d.municipio);
  return d;
}
async function crearCliente(b) {
  const d = datosCliente(b);
  if (!d.nombre) return null;
  return (await db.query(`INSERT INTO clientes_ruta (${CAMPOS_CLIENTE.join(', ')}) VALUES (${CAMPOS_CLIENTE.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING *`, CAMPOS_CLIENTE.map(k => d[k]))).rows[0];
}
async function actualizarCliente(id, b) {
  const d = datosCliente(b);
  if (!d.nombre) return null;
  return (await db.query(`UPDATE clientes_ruta SET ${CAMPOS_CLIENTE.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`, [id, ...CAMPOS_CLIENTE.map(k => d[k])])).rows[0] || null;
}
async function eliminarCliente(id) {
  await db.tx(async (client) => {
    await client.query('DELETE FROM clientes_ruta WHERE id = $1', [id]);
    await client.query(`DELETE FROM rutas_ubicaciones WHERE tipo = 'c' AND ref_id = $1`, [id]);
  });
}
async function buscarClientes(q, limite = 25) {
  const n = mun.normalizar(q);
  if (n.length < 2) return [];
  const digitos = String(q).replace(/\D/g, '');
  return (await cargarUniverso()).filter(c => mun.normalizar([c.nombre, c.municipio, c.razon_social, c.obra, c.direccion].join(' ')).includes(n) || (digitos.length >= 4 && c.telefonos.replace(/\D/g, '').includes(digitos))).slice(0, limite);
}

// ---------- importación de la agenda en Excel ----------
function textoCelda(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if ('result' in v) return textoCelda(v.result);
    if ('text' in v) return textoCelda(v.text);
    return '';
  }
  return String(v);
}
const celdasFila = (row) => { const out = []; row.eachCell({ includeEmpty: true }, (cell, col) => { out[col] = textoCelda(cell.value).replace(/\s*\n\s*/g, ' · ').replace(/\s+/g, ' ').trim(); }); return out; };

// Hoja tipo "CRONOGRAMA RUTAS": una fila con RUTA 1, RUTA 2… y debajo los municipios separados por guiones y la frecuencia.
// Las celdas combinadas repiten su valor en cada columna, por eso se exigen al menos dos nombres de ruta distintos.
function leerCronograma(ws) {
  const filas = []; ws.eachRow({ includeEmpty: true }, (row, n) => { filas[n] = celdasFila(row); });
  const rutas = [];
  filas.forEach((f, n) => {
    if (!f) return;
    const vistos = new Set(), cols = [];
    f.forEach((v, c) => { const k = String(v || '').toUpperCase().replace(/\s+/g, ' '); if (/^RUTA \d+$|^RUTA\d+$/.test(k) && !vistos.has(k)) { vistos.add(k); cols.push(c); } });
    if (cols.length < 2) return;
    for (const c of cols) {
      const paradas = String((filas[n + 1] || [])[c] || '').split(/\s*[-–,]\s*/).map(p => p.trim()).filter(p => p.length > 1);
      if (!paradas.length) continue;
      const frec = (filas[n + 2] || [])[c] || '';
      const frecN = mun.normalizar(frec);
      rutas.push({
        nombre: tipoTitulo(f[c].replace(/\s+/g, ' ')), paradas: paradas.map(p => mun.nombre(p)),
        frecuencia: frec ? frec.charAt(0).toUpperCase() + frec.slice(1).toLowerCase() : null,
        dias: DIAS.filter(d => new RegExp(`\\b${mun.normalizar(d)}\\b`).test(frecN)).join(', ') || null,
      });
    }
  });
  return rutas;
}
// Hojas tipo agenda: encabezado con CLIENTE/NOMBRES y MUNICIPIO/CIUDAD
const COLUMNAS = [
  ['nombre', /^(CLIENTE|CLIENTES|NOMBRE|NOMBRES)$/],
  ['municipio', /MUNICIPIO|CIUDAD/],
  ['direccion', /DIRECCION/, /CIUDAD/],
  ['sector', /SECTOR|BARRIO/],
  ['nit', /NIT|CEDULA/],
  ['razon_social', /RAZON SOCIAL/],
  ['telefonos', /TELEFONO|TELFONICO|CONTACTO|CELULAR/],
  ['tipologia', /TIPOLOGIA/],
  ['volumen_compra', /VOLUMEN/],
];
function leerAgenda(ws) {
  const filas = []; ws.eachRow({ includeEmpty: false }, (row, n) => { filas.push([n, celdasFila(row)]); });
  const cab = filas.slice(0, 20).find(([, f]) => { const h = f.map(v => mun.normalizar(v).toUpperCase()); return h.some(v => COLUMNAS[0][1].test(v)) && h.some(v => COLUMNAS[1][1].test(v)); });
  if (!cab) return null;
  const h = cab[1].map(v => mun.normalizar(v).toUpperCase());
  const mapa = {};
  for (const [campo, re, excluir] of COLUMNAS) {
    const col = h.findIndex((v, i) => v && re.test(v) && !(excluir && excluir.test(v)) && !Object.values(mapa).includes(i));
    if (col > 0) mapa[campo] = col;
  }
  const clientes = [];
  let ultimoMunicipio = '';
  for (const [n, f] of filas) {
    if (n <= cab[0]) continue;
    const nombre = f[mapa.nombre] || '';
    const municipio = (mapa.municipio && f[mapa.municipio]) || '';
    if (municipio) ultimoMunicipio = municipio;
    if (!nombre || /^RUTA\s*\d+$/i.test(nombre) || COLUMNAS[0][1].test(mun.normalizar(nombre).toUpperCase())) continue;
    const c = { nombre: tipoTitulo(nombre), municipio: mun.nombre(municipio || ultimoMunicipio) };
    for (const campo of ['direccion', 'sector', 'nit', 'razon_social', 'telefonos', 'tipologia', 'volumen_compra']) {
      const v = mapa[campo] ? f[mapa[campo]] : '';
      c[campo] = v ? (['direccion', 'sector', 'razon_social'].includes(campo) ? tipoTitulo(v) : v) : null;
    }
    clientes.push(c);
  }
  return { columnas: Object.keys(mapa).length, clientes };
}
async function importarLibro(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const rutasLeidas = [], agendas = [];
  wb.eachSheet(ws => { rutasLeidas.push(...leerCronograma(ws)); const a = leerAgenda(ws); if (a && a.clientes.length) agendas.push(a); });
  agendas.sort((a, b) => b.columnas - a.columnas); // primero la hoja más completa
  const res = { rutas_creadas: 0, rutas_existentes: 0, clientes_creados: 0, clientes_actualizados: 0, clientes_sin_cambios: 0, hojas: agendas.length };

  await db.tx(async (client) => {
    const existentes = new Map((await client.query('SELECT id, nombre, paradas FROM rutas')).rows.map(r => [r.nombre.toLowerCase(), r]));
    let i = existentes.size;
    for (const r of rutasLeidas) {
      const e = existentes.get(r.nombre.toLowerCase());
      if (e) {
        res.rutas_existentes++;
        if (!e.paradas || !e.paradas.length) await client.query('UPDATE rutas SET paradas = $2, updated_at = NOW() WHERE id = $1', [e.id, JSON.stringify(r.paradas)]);
        continue;
      }
      await client.query('INSERT INTO rutas (nombre, paradas, origen, frecuencia, dias, color) VALUES ($1,$2,$3,$4,$5,$6)',
        [r.nombre, JSON.stringify(r.paradas), mun.SEDES[0].clave, r.frecuencia, r.dias, COLORES[i++ % COLORES.length]]);
      existentes.set(r.nombre.toLowerCase(), r);
      res.rutas_creadas++;
    }

    const porTel = new Map(), porNombre = new Map();
    const indexar = (c) => {
      const km = mun.clave(c.municipio);
      for (const t of celulares(c.telefonos)) porTel.set(`${t}|${km}`, c);
      porNombre.set(`${mun.normalizar(c.nombre)}|${km}`, c);
    };
    (await client.query('SELECT * FROM clientes_ruta')).rows.forEach(indexar);
    for (const f of agendas.flatMap(a => a.clientes)) {
      const km = mun.clave(f.municipio);
      const previo = celulares(f.telefonos).map(t => porTel.get(`${t}|${km}`)).find(Boolean) || porNombre.get(`${mun.normalizar(f.nombre)}|${km}`);
      if (!previo) {
        const d = datosCliente(f);
        indexar((await client.query(`INSERT INTO clientes_ruta (${CAMPOS_CLIENTE.join(', ')}) VALUES (${CAMPOS_CLIENTE.map((_, j) => '$' + (j + 1)).join(', ')}) RETURNING *`, CAMPOS_CLIENTE.map(k => d[k]))).rows[0]);
        res.clientes_creados++;
        continue;
      }
      // Solo completa lo que falta: nunca pisa datos editados en la aplicación
      const cambios = {};
      for (const k of CAMPOS_CLIENTE) if (k !== 'telefonos' && !previo[k] && f[k]) cambios[k] = texto(f[k]);
      const nuevos = celulares(f.telefonos).filter(t => !celulares(previo.telefonos).includes(t));
      if (!previo.telefonos && f.telefonos) cambios.telefonos = texto(f.telefonos);
      else if (nuevos.length) cambios.telefonos = `${previo.telefonos} · ${nuevos.join(' · ')}`;
      const claves = Object.keys(cambios);
      if (!claves.length) { res.clientes_sin_cambios++; continue; }
      await client.query(`UPDATE clientes_ruta SET ${claves.map((k, j) => `${k} = $${j + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`, [previo.id, ...claves.map(k => cambios[k])]);
      Object.assign(previo, cambios); indexar(previo);
      res.clientes_actualizados++;
    }
  });
  return res;
}

function opcionesFormulario() {
  return { frecuencias: FRECUENCIAS, dias: DIAS, colores: COLORES, sedes: mun.SEDES, municipios: mun.MUNICIPIOS };
}

module.exports = {
  ESTADOS, asegurarEsquema, opcionesFormulario,
  obtenerRuta, todasLasRutas, datosRuta, crearRuta, actualizarRuta, cambiarEstadoRuta, eliminarRuta, fijarDespacho,
  datosPlanificador, guardarPlan, guardarPlanMasivo, reiniciarPlan, resumenGestion,
  crearCliente, actualizarCliente, eliminarCliente, buscarClientes, guardarUbicacion, geocodificarDireccion, fichaCliente,
  importarLibro, celulares,
};
