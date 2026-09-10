// Informes del panel de administración.
// Carga los datos, aplica los filtros y arma indicadores, tablas y series para las gráficas.
// Lo usan /admin (primer render), /admin/datos.json (actualización en vivo) y la exportación
// a Excel, de modo que la pantalla y el archivo muestran exactamente lo mismo.
const db = require('./db');
const calc = require('./calc');

const ESTADO_ETAPA = { pendiente: 'Pendiente', vendida: 'Vendida', sin_venta: 'Sin venta' };
const ESTADO_OBRA = { activa: 'Activa', cerrada: 'Cerrada' };
const CODIGOS = ['R+R', 'R', 'E', 'F'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const OPCIONES = {
  metricas: [
    { id: 'obras', nombre: 'Obras' },
    { id: 'etapas', nombre: 'Etapas' },
    { id: 'vendidas', nombre: 'Etapas vendidas' },
    { id: 'sin_venta', nombre: 'Etapas sin venta' },
    { id: 'pendientes', nombre: 'Etapas pendientes' },
    { id: 'conversion', nombre: 'Conversión (% vendidas)' },
    { id: 'ventas', nombre: 'Ventas por producto (checks)' },
  ],
  dimensiones: [
    { id: 'linea', nombre: 'Línea WhatsApp' },
    { id: 'mes', nombre: 'Mes' },
    { id: 'etapa', nombre: 'Etapa' },
    { id: 'municipio', nombre: 'Obra / municipio' },
    { id: 'cliente', nombre: 'Cliente' },
    { id: 'producto', nombre: 'Línea de producto' },
    { id: 'codigo', nombre: 'Código de precio' },
    { id: 'estado_obra', nombre: 'Estado de la obra' },
    { id: 'estado_etapa', nombre: 'Estado de la etapa' },
  ],
  campos_fecha: [
    { id: 'etapa', nombre: 'Fecha de la etapa (real o programada)' },
    { id: 'aviso', nombre: 'Fecha de aviso' },
    { id: 'creacion', nombre: 'Fecha de creación de la obra' },
  ],
};
const meta = (lista, id) => lista.find(x => x.id === id) || null;

function etiquetaMes(clave) {
  const m = /^(\d{4})-(\d{2})$/.exec(clave || '');
  return m ? `${MESES[Number(m[2]) - 1]} ${m[1]}` : (clave || '—');
}
const mesDe = (iso) => (iso ? iso.slice(0, 7) : null);
const fmt = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };

// ---------- filtros ----------
function parsearFiltros(q = {}) {
  const lista = (v) => (v == null || v === '') ? [] : (Array.isArray(v) ? v : String(v).split(',')).map(s => String(s).trim()).filter(Boolean);
  const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null);
  const uno = (v, permitidos, def) => (permitidos.includes(v) ? v : def);
  const dims = OPCIONES.dimensiones.map(d => d.id);
  const top = Number(q.top);
  return {
    desde: iso(q.desde),
    hasta: iso(q.hasta),
    campo_fecha: uno(q.campo_fecha, OPCIONES.campos_fecha.map(c => c.id), 'etapa'),
    lineas: lista(q.linea),
    estado_obra: uno(q.estado_obra, ['activa', 'cerrada'], ''),
    estado_etapa: uno(q.estado_etapa, ['pendiente', 'vendida', 'sin_venta'], ''),
    productos: lista(q.producto),
    metrica: uno(q.metrica, OPCIONES.metricas.map(m => m.id), 'etapas'),
    agrupar: uno(q.agrupar, dims, 'linea'),
    segmentar: uno(q.segmentar, dims, ''),
    top: Number.isFinite(top) && top >= 3 && top <= 50 ? top : 12,
  };
}
// Convierte los filtros a query string (para el enlace de exportación y para la URL de la página)
function filtrosAQuery(f) {
  const p = new URLSearchParams();
  if (f.desde) p.set('desde', f.desde);
  if (f.hasta) p.set('hasta', f.hasta);
  if (f.campo_fecha !== 'etapa') p.set('campo_fecha', f.campo_fecha);
  if (f.lineas.length) p.set('linea', f.lineas.join(','));
  if (f.estado_obra) p.set('estado_obra', f.estado_obra);
  if (f.estado_etapa) p.set('estado_etapa', f.estado_etapa);
  if (f.productos.length) p.set('producto', f.productos.join(','));
  if (f.metrica !== 'etapas') p.set('metrica', f.metrica);
  if (f.agrupar !== 'linea') p.set('agrupar', f.agrupar);
  if (f.segmentar) p.set('segmentar', f.segmentar);
  if (f.top !== 12) p.set('top', String(f.top));
  return p.toString();
}
// Descripción legible de los filtros (para la pantalla y la hoja "Resumen" del Excel)
function describirFiltros(f) {
  const partes = [];
  if (f.desde || f.hasta) {
    const campo = meta(OPCIONES.campos_fecha, f.campo_fecha).nombre;
    partes.push(['Periodo', `${f.desde ? 'desde ' + fmt(f.desde) : ''}${f.desde && f.hasta ? ' ' : ''}${f.hasta ? 'hasta ' + fmt(f.hasta) : ''} · ${campo}`]);
  }
  if (f.lineas.length) partes.push(['Línea WhatsApp', f.lineas.join(', ')]);
  if (f.estado_obra) partes.push(['Estado de la obra', ESTADO_OBRA[f.estado_obra]]);
  if (f.estado_etapa) partes.push(['Estado de la etapa', ESTADO_ETAPA[f.estado_etapa]]);
  if (f.productos.length) partes.push(['Línea de producto', f.productos.join(', ')]);
  partes.push(['Gráfica configurada', `${meta(OPCIONES.metricas, f.metrica).nombre} por ${meta(OPCIONES.dimensiones, f.agrupar).nombre}${f.segmentar ? ', segmentado por ' + meta(OPCIONES.dimensiones, f.segmentar).nombre : ''}`]);
  return partes;
}

// ---------- datos ----------
async function cargarDatos() {
  const [obras, etapas, ventas, productos, lineas] = (await Promise.all([
    db.query('SELECT * FROM obras ORDER BY id'),
    db.query('SELECT * FROM etapas ORDER BY obra_id, orden'),
    db.query('SELECT v.*, p.nombre AS producto FROM ventas_etapa v JOIN lineas_producto p ON p.id = v.linea_id'),
    db.query('SELECT id, nombre, orden, activa FROM lineas_producto ORDER BY orden, id'),
    db.query('SELECT numero, correo, activa FROM lineas_whatsapp ORDER BY numero'),
  ])).map(r => r.rows);

  const ventasPorEtapa = {};
  for (const v of ventas) (ventasPorEtapa[v.etapa_id] = ventasPorEtapa[v.etapa_id] || []).push(v);
  const obrasMap = new Map(obras.map(o => [o.id, o]));

  // Una fila por etapa, con los datos de su obra. Es la unidad base de todos los cálculos.
  const filas = [];
  for (const e of etapas) {
    const o = obrasMap.get(e.obra_id);
    if (!o) continue;
    const fecha_programada = calc.toISO(e.fecha_programada), fecha_real = calc.toISO(e.fecha_real), fecha_aviso = calc.toISO(e.fecha_aviso);
    filas.push({
      etapa_id: e.id, obra_id: o.id, cliente: o.cliente, celular: o.celular, municipio: o.obra || '—', linea: o.linea, estado_obra: o.estado,
      orden: e.orden, etapa: e.nombre, estado_etapa: e.estado, fecha: fecha_real || fecha_programada, fecha_programada, fecha_real, fecha_aviso,
      fecha_fija: !!e.fecha_fija, intervalo_dias: e.intervalo_dias, dias_aviso: e.dias_aviso, notas: e.notas || '',
      creacion: calc.toISOBogota(o.created_at), precios: o.precios || {},
      ventas: (ventasPorEtapa[e.id] || []).map(v => ({ id: v.id, producto: v.producto, vendido: !!v.vendido, detalle: v.detalle || '' })),
    });
  }
  return { obras, obrasMap, filas, productos, lineas };
}

const fechaDe = (f, campo) => (campo === 'aviso' ? f.fecha_aviso : campo === 'creacion' ? f.creacion : f.fecha);

function aplicarFiltros(filas, f) {
  return filas.filter(x => {
    if (f.lineas.length && !f.lineas.includes(x.linea)) return false;
    if (f.estado_obra && x.estado_obra !== f.estado_obra) return false;
    if (f.estado_etapa && x.estado_etapa !== f.estado_etapa) return false;
    if (f.desde || f.hasta) {
      const d = fechaDe(x, f.campo_fecha);
      if (!d) return false;
      if (f.desde && d < f.desde) return false;
      if (f.hasta && d > f.hasta) return false;
    }
    if (f.productos.length && !x.ventas.some(v => v.vendido && f.productos.includes(v.producto))) return false;
    return true;
  });
}

// ---------- tabla dinámica (métrica × agrupar × segmentar) ----------
function pivot(filas, filtros, productos, metrica, agrupar, segmentar, opts = {}) {
  const campoMes = opts.campoMes || filtros.campo_fecha;
  const necesitaProducto = ['producto', 'codigo'].includes(agrupar) || ['producto', 'codigo'].includes(segmentar);
  const nuevoAcum = () => ({ obras: new Set(), etapas: new Set(), vendidas: new Set(), sin_venta: new Set(), pendientes: new Set(), ventas: new Set() });
  const celdas = new Map();
  const ordenEtapa = new Map();
  const valorDim = (c, dim) => {
    switch (dim) {
      case 'linea': return c.linea;
      case 'mes': return mesDe(fechaDe(c, campoMes)) || 'Sin fecha';
      case 'etapa': return c.etapa;
      case 'municipio': return c.municipio;
      case 'cliente': return c.cliente;
      case 'producto': return c.producto;
      case 'codigo': return c.codigo;
      case 'estado_obra': return ESTADO_OBRA[c.estado_obra] || c.estado_obra;
      case 'estado_etapa': return ESTADO_ETAPA[c.estado_etapa] || c.estado_etapa;
      default: return 'Total';
    }
  };
  for (const f of filas) {
    let contribs;
    if (metrica === 'ventas') {
      contribs = f.ventas.filter(v => v.vendido && (!filtros.productos.length || filtros.productos.includes(v.producto)))
        .map(v => ({ ...f, producto: v.producto, codigo: f.precios[v.producto] || 'Sin código', venta_id: v.id }));
    } else if (necesitaProducto) {
      contribs = productos.map(p => ({ ...f, producto: p.nombre, codigo: f.precios[p.nombre] || 'Sin código' }));
    } else contribs = [f];
    for (const c of contribs) {
      const g = valorDim(c, agrupar), s = segmentar ? valorDim(c, segmentar) : 'Total';
      if (agrupar === 'etapa') ordenEtapa.set(g, Math.min(ordenEtapa.has(g) ? ordenEtapa.get(g) : 999, c.orden));
      if (!celdas.has(g)) celdas.set(g, new Map());
      const fila = celdas.get(g);
      if (!fila.has(s)) fila.set(s, nuevoAcum());
      const a = fila.get(s);
      a.obras.add(c.obra_id); a.etapas.add(c.etapa_id);
      if (c.estado_etapa === 'vendida') a.vendidas.add(c.etapa_id);
      else if (c.estado_etapa === 'sin_venta') a.sin_venta.add(c.etapa_id);
      else a.pendientes.add(c.etapa_id);
      if (c.venta_id) a.ventas.add(c.venta_id);
    }
  }
  const valor = (a) => {
    if (!a) return 0;
    if (metrica === 'conversion') { const t = a.vendidas.size + a.sin_venta.size; return t ? Math.round((a.vendidas.size / t) * 1000) / 10 : 0; }
    return a[metrica].size;
  };
  const peso = (g) => { let t = 0; for (const a of celdas.get(g).values()) t += metrica === 'conversion' ? a.vendidas.size + a.sin_venta.size : a[metrica].size; return t; };
  const ordenFijo = (dim) => {
    if (dim === 'producto') return productos.map(p => p.nombre);
    if (dim === 'codigo') return [...CODIGOS, 'Sin código'];
    if (dim === 'estado_obra') return Object.values(ESTADO_OBRA);
    if (dim === 'estado_etapa') return Object.values(ESTADO_ETAPA);
    return null;
  };
  const ordenar = (claves, dim, limitar) => {
    const fijo = ordenFijo(dim);
    if (fijo) return claves.sort((x, y) => (fijo.indexOf(x) === -1 ? 99 : fijo.indexOf(x)) - (fijo.indexOf(y) === -1 ? 99 : fijo.indexOf(y)));
    if (dim === 'mes' || dim === 'linea') return claves.sort();
    if (dim === 'etapa') return claves.sort((x, y) => (ordenEtapa.get(x) || 0) - (ordenEtapa.get(y) || 0));
    claves.sort((x, y) => peso(y) - peso(x));
    return limitar ? claves.slice(0, filtros.top) : claves;
  };
  const grupos = ordenar([...celdas.keys()], agrupar, true);
  const segSet = new Set();
  for (const g of grupos) for (const s of celdas.get(g).keys()) segSet.add(s);
  const segmentos = segmentar ? ordenar([...segSet], segmentar, false).slice(0, 10) : ['Total'];
  const series = segmentos.map(s => ({ nombre: s, datos: grupos.map(g => valor(celdas.get(g).get(s))) }));
  return {
    metrica: meta(OPCIONES.metricas, metrica), agrupar: meta(OPCIONES.dimensiones, agrupar), segmentar: segmentar ? meta(OPCIONES.dimensiones, segmentar) : null,
    claves: grupos, etiquetas: grupos.map(g => (agrupar === 'mes' ? etiquetaMes(g) : g)), series, unidad: metrica === 'conversion' ? '%' : '',
  };
}

// ---------- indicadores y tablas ----------
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

function resumenObra(o, etapasObra, hoy) {
  const reales = etapasObra.filter(e => e.orden > 0);
  const vendidas = etapasObra.filter(e => e.estado_etapa === 'vendida').length;
  const sinVenta = etapasObra.filter(e => e.estado_etapa === 'sin_venta').length;
  const pendientes = etapasObra.filter(e => e.estado_etapa === 'pendiente').length;
  const proxima = reales.find(e => e.estado_etapa === 'pendiente') || null;
  const ventas = etapasObra.reduce((n, e) => n + e.ventas.filter(v => v.vendido).length, 0);
  const dias = proxima && proxima.fecha_aviso ? calc.diffDays(hoy, proxima.fecha_aviso) : null;
  const creada = calc.toISOBogota(o.created_at), cerrada = calc.toISOBogota(o.cerrada_at);
  return {
    id: o.id, cliente: o.cliente, celular: o.celular, direccion_cliente: o.direccion_cliente || '', obra: o.obra, direccion_obra: o.direccion_obra || '',
    maestro: o.maestro || '', celular_maestro: o.celular_maestro || '', linea: o.linea, estado: o.estado, estado_nombre: ESTADO_OBRA[o.estado] || o.estado,
    fecha_cimentacion: calc.toISO(o.fecha_cimentacion), num_placas: o.num_placas, intervalo_dias: o.intervalo_dias, dias_aviso: o.dias_aviso,
    precios: o.precios || {}, notas: o.notas || '', creada_por: o.creada_por || '',
    creada, cerrada, actualizada: calc.toISOBogota(o.updated_at),
    duracion_dias: cerrada && creada ? calc.diffDays(creada, cerrada) : null,
    total_etapas: reales.length, hechas: reales.filter(e => e.estado_etapa !== 'pendiente').length, vendidas, sin_venta: sinVenta, pendientes,
    conversion: pct(vendidas, vendidas + sinVenta), ventas,
    proxima: proxima ? proxima.etapa : '', proxima_fecha: proxima ? proxima.fecha : '', proxima_aviso: proxima ? proxima.fecha_aviso : '', dias_para_aviso: dias,
  };
}

async function construir(filtros) {
  const { obrasMap, filas: todas, productos, lineas } = await cargarDatos();
  const hoy = calc.hoyBogota();
  const filas = aplicarFiltros(todas, filtros);
  const productosNombres = productos.map(p => p.nombre);

  // obras presentes tras el filtro; su resumen usa TODAS sus etapas para no distorsionar el avance
  const etapasPorObra = new Map();
  for (const f of todas) { if (!etapasPorObra.has(f.obra_id)) etapasPorObra.set(f.obra_id, []); etapasPorObra.get(f.obra_id).push(f); }
  const idsObras = [...new Set(filas.map(f => f.obra_id))];
  const obras = idsObras.map(id => resumenObra(obrasMap.get(id), etapasPorObra.get(id) || [], hoy))
    .sort((a, b) => (a.dias_para_aviso ?? 9999) - (b.dias_para_aviso ?? 9999));

  // KPIs
  const vendidas = filas.filter(f => f.estado_etapa === 'vendida').length;
  const sinVenta = filas.filter(f => f.estado_etapa === 'sin_venta').length;
  const pendientes = filas.filter(f => f.estado_etapa === 'pendiente');
  const avisos = pendientes.filter(f => f.fecha_aviso).map(f => ({ ...f, dias: calc.diffDays(hoy, f.fecha_aviso) }));
  const ventasTotal = filas.reduce((n, f) => n + f.ventas.filter(v => v.vendido).length, 0);
  const cerradas = obras.filter(o => o.estado === 'cerrada');
  const hace30 = calc.addDays(hoy, -30);
  const kpis = {
    obras: obras.length, activas: obras.length - cerradas.length, cerradas: cerradas.length,
    clientes: new Set(obras.map(o => `${o.cliente}|${o.celular}`)).size,
    obras_nuevas_30d: obras.filter(o => o.creada && o.creada >= hace30).length,
    cerradas_30d: cerradas.filter(o => o.cerrada && o.cerrada >= hace30).length,
    etapas: filas.length, vendidas, sin_venta: sinVenta, pendientes: pendientes.length,
    conversion: pct(vendidas, vendidas + sinVenta), ventas: ventasTotal,
    ventas_por_etapa_vendida: vendidas ? Math.round((ventasTotal / vendidas) * 10) / 10 : 0,
    avisos_vencidos: avisos.filter(a => a.dias < 0).length, avisos_hoy: avisos.filter(a => a.dias === 0).length,
    avisos_7d: avisos.filter(a => a.dias >= 0 && a.dias <= 7).length, avisos_30d: avisos.filter(a => a.dias >= 0 && a.dias <= 30).length,
    etapas_por_obra: obras.length ? Math.round((obras.reduce((n, o) => n + o.total_etapas, 0) / obras.length) * 10) / 10 : 0,
    intervalo_promedio: filas.length ? Math.round(filas.filter(f => f.orden > 0).reduce((n, f) => n + f.intervalo_dias, 0) / Math.max(1, filas.filter(f => f.orden > 0).length)) : 0,
    duracion_promedio: cerradas.length ? Math.round(cerradas.reduce((n, o) => n + (o.duracion_dias || 0), 0) / cerradas.length) : null,
  };

  // Alertas: avisos vencidos, de hoy y de los próximos 7 días
  const alertas = avisos.filter(a => a.dias <= 7).sort((a, b) => a.dias - b.dias).map(a => ({
    obra_id: a.obra_id, cliente: a.cliente, celular: a.celular, obra: a.municipio, linea: a.linea, etapa: a.etapa,
    fecha: a.fecha, fecha_aviso: a.fecha_aviso, dias: a.dias, estado: a.dias < 0 ? 'vencido' : a.dias === 0 ? 'hoy' : 'pronto',
  }));

  // Avisos por semana (vencidos + próximas 8 semanas)
  const semanas = ['Vencidos', 'Esta semana', ...Array.from({ length: 7 }, (_, i) => `+${i + 1} sem`)];
  const avisosSemana = semanas.map(() => 0);
  for (const a of avisos) {
    if (a.dias < 0) avisosSemana[0]++;
    else { const w = Math.floor(a.dias / 7); if (w <= 7) avisosSemana[w + 1]++; }
  }

  // Tablas resumen
  const porLinea = [...new Set([...lineas.map(l => l.numero), ...filas.map(f => f.linea)])].sort().map(num => {
    const fs = filas.filter(f => f.linea === num); const os = obras.filter(o => o.linea === num);
    const v = fs.filter(f => f.estado_etapa === 'vendida').length, s = fs.filter(f => f.estado_etapa === 'sin_venta').length;
    return { linea: num, correo: (lineas.find(l => l.numero === num) || {}).correo || '', obras: os.length, activas: os.filter(o => o.estado === 'activa').length,
      cerradas: os.filter(o => o.estado === 'cerrada').length, etapas: fs.length, vendidas: v, sin_venta: s, pendientes: fs.length - v - s,
      conversion: pct(v, v + s), ventas: fs.reduce((n, f) => n + f.ventas.filter(x => x.vendido).length, 0),
      avisos_vencidos: avisos.filter(a => a.linea === num && a.dias < 0).length, avisos_7d: avisos.filter(a => a.linea === num && a.dias >= 0 && a.dias <= 7).length };
  }).filter(r => r.obras || r.etapas || lineas.some(l => l.numero === r.linea && l.activa));

  const porProducto = productosNombres.map(nombre => {
    const ventasP = []; for (const f of filas) for (const v of f.ventas) if (v.vendido && v.producto === nombre) ventasP.push(f);
    const codigos = {}; for (const o of obras) { const c = o.precios[nombre] || 'Sin código'; codigos[c] = (codigos[c] || 0) + 1; }
    return { producto: nombre, activa: (productos.find(p => p.nombre === nombre) || {}).activa !== false, ventas: ventasP.length,
      obras_con_venta: new Set(ventasP.map(f => f.obra_id)).size, participacion: pct(ventasP.length, vendidas), codigos };
  });

  const nombresEtapa = new Map();
  for (const f of filas) nombresEtapa.set(f.etapa, Math.min(nombresEtapa.has(f.etapa) ? nombresEtapa.get(f.etapa) : 999, f.orden));
  const porEtapa = [...nombresEtapa.keys()].sort((a, b) => nombresEtapa.get(a) - nombresEtapa.get(b)).map(nombre => {
    const fs = filas.filter(f => f.etapa === nombre);
    const v = fs.filter(f => f.estado_etapa === 'vendida').length, s = fs.filter(f => f.estado_etapa === 'sin_venta').length;
    return { etapa: nombre, etapas: fs.length, vendidas: v, sin_venta: s, pendientes: fs.length - v - s, conversion: pct(v, v + s),
      ventas: fs.reduce((n, f) => n + f.ventas.filter(x => x.vendido).length, 0) };
  });

  const mesesSet = new Set([...obras.map(o => mesDe(o.creada)), ...filas.map(f => mesDe(f.fecha))].filter(Boolean));
  const porMes = [...mesesSet].sort().map(mes => {
    const fs = filas.filter(f => mesDe(f.fecha) === mes);
    const v = fs.filter(f => f.estado_etapa === 'vendida').length, s = fs.filter(f => f.estado_etapa === 'sin_venta').length;
    return { mes, etiqueta: etiquetaMes(mes), obras_creadas: obras.filter(o => mesDe(o.creada) === mes).length,
      obras_cerradas: obras.filter(o => mesDe(o.cerrada) === mes).length, etapas: fs.length, vendidas: v, sin_venta: s, pendientes: fs.length - v - s,
      conversion: pct(v, v + s), ventas: fs.reduce((n, f) => n + f.ventas.filter(x => x.vendido).length, 0) };
  });

  const clientesMap = new Map();
  for (const o of obras) {
    const k = `${o.cliente}|${o.celular}`;
    if (!clientesMap.has(k)) clientesMap.set(k, { cliente: o.cliente, celular: o.celular, lineas: new Set(), obras: 0, activas: 0, vendidas: 0, sin_venta: 0, ventas: 0, ultima: '' });
    const c = clientesMap.get(k);
    c.obras++; if (o.estado === 'activa') c.activas++; c.vendidas += o.vendidas; c.sin_venta += o.sin_venta; c.ventas += o.ventas; c.lineas.add(o.linea);
    if (o.actualizada && o.actualizada > c.ultima) c.ultima = o.actualizada;
  }
  const topClientes = [...clientesMap.values()].map(c => ({ ...c, lineas: [...c.lineas].join(', '), conversion: pct(c.vendidas, c.vendidas + c.sin_venta) }))
    .sort((a, b) => b.vendidas - a.vendidas || b.ventas - a.ventas || b.obras - a.obras).slice(0, filtros.top);

  // Detalle plano (para el Excel)
  const etapas = filas.map(f => ({
    obra_id: f.obra_id, cliente: f.cliente, celular: f.celular, obra: f.municipio, linea: f.linea, estado_obra: ESTADO_OBRA[f.estado_obra] || f.estado_obra,
    orden: f.orden, etapa: f.etapa, estado: ESTADO_ETAPA[f.estado_etapa] || f.estado_etapa, fecha_programada: f.fecha_programada, fecha_aviso: f.fecha_aviso,
    fecha_real: f.fecha_real, intervalo_dias: f.intervalo_dias, dias_aviso: f.dias_aviso, fecha_fija: f.fecha_fija,
    productos: f.ventas.filter(v => v.vendido).map(v => v.producto).join(', '), notas: f.notas,
  }));
  const ventas = [];
  for (const f of filas) for (const v of f.ventas) if (v.vendido) ventas.push({
    obra_id: f.obra_id, cliente: f.cliente, obra: f.municipio, linea: f.linea, etapa: f.etapa, fecha: f.fecha, producto: v.producto,
    codigo: f.precios[v.producto] || '', detalle: v.detalle,
  });

  const piv = (m, a, s, o) => pivot(filas, filtros, productos, m, a, s, o);
  return {
    generado: new Date().toISOString(), hoy, filtros, query: filtrosAQuery(filtros), descripcion_filtros: describirFiltros(filtros),
    kpis,
    graficas: {
      configurada: piv(filtros.metrica, filtros.agrupar, filtros.segmentar),
      etapasPorLinea: piv('etapas', 'linea', 'estado_etapa'),
      ventasPorProducto: piv('ventas', 'producto', ''),
      conversionPorEtapa: piv('etapas', 'etapa', 'estado_etapa'),
      obrasPorMes: piv('obras', 'mes', 'estado_obra', { campoMes: 'creacion' }),
      codigosPorProducto: piv('obras', 'producto', 'codigo'),
      avisosPorSemana: { etiquetas: semanas, series: [{ nombre: 'Avisos pendientes', datos: avisosSemana }], unidad: '' },
    },
    tablas: { alertas, porLinea, porProducto, porEtapa, porMes, topClientes, obras, etapas, ventas },
    catalogos: { productos: productosNombres, lineas: lineas.map(l => l.numero), codigos: [...CODIGOS, 'Sin código'] },
  };
}

module.exports = { OPCIONES, parsearFiltros, filtrosAQuery, describirFiltros, construir, ESTADO_ETAPA, ESTADO_OBRA, etiquetaMes };
