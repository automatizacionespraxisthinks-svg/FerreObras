// Exportación a Excel (.xlsx) con estructura y estilo de FerreAceros.
// Dos libros: el de una obra (ficha, etapas, matriz de ventas, detalle) y el del panel
// de administración (resumen con filtros e indicadores, obras, etapas, ventas, por línea,
// por producto, por etapa, por mes, alertas y la gráfica configurada).
const ExcelJS = require('exceljs');
const calc = require('./calc');

const C = {
  azul: 'FF092F77', azulClaro: 'FFE8EDF7', amarillo: 'FFFFE600', amarilloSuave: 'FFFFF8B8',
  blanco: 'FFFFFFFF', gris: 'FFF4F5F8', grisTexto: 'FF6B7280', borde: 'FFD5DAE5',
  verde: 'FFDDF2E4', verdeTexto: 'FF1F6B3A', rojo: 'FFFBE3E1', rojoTexto: 'FF9B2318', naranja: 'FFFFF0C2', naranjaTexto: 'FF7A5A00',
};
const FUENTE = 'Calibri';
const bordeFino = { style: 'thin', color: { argb: C.borde } };
const BORDES = { top: bordeFino, left: bordeFino, bottom: bordeFino, right: bordeFino };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const fecha = (iso) => { if (!iso) return null; const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
// Marcas de tiempo: se escriben con la hora de Bogotá (Excel no maneja zonas horarias)
const fechaHora = (d) => {
  if (!d) return null;
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(d));
  const p = {}; for (const x of partes) p[x.type] = x.value;
  return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)));
};

// ---------- bloques reutilizables ----------
function titulo(ws, texto, subtitulo, ancho) {
  ws.mergeCells(1, 1, 1, ancho);
  const t = ws.getCell(1, 1);
  t.value = texto; t.font = { name: FUENTE, size: 18, bold: true, color: { argb: C.blanco } };
  t.fill = fill(C.azul); t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(1).height = 34;
  ws.mergeCells(2, 1, 2, ancho);
  const s = ws.getCell(2, 1);
  s.value = subtitulo; s.font = { name: FUENTE, size: 11, bold: true, color: { argb: C.azul } };
  s.fill = fill(C.amarillo); s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  ws.getRow(2).height = 20;
  return 4; // siguiente fila libre
}
function seccion(ws, fila, texto, ancho) {
  ws.mergeCells(fila, 1, fila, ancho);
  const c = ws.getCell(fila, 1);
  c.value = texto.toUpperCase(); c.font = { name: FUENTE, size: 11, bold: true, color: { argb: C.azul } };
  c.border = { bottom: { style: 'medium', color: { argb: C.amarillo } } };
  ws.getRow(fila).height = 22;
  return fila + 1;
}
// Pares etiqueta/valor en dos columnas (etiqueta en col, valor en col+1)
function ficha(ws, fila, col, pares) {
  for (const [k, v, opciones] of pares) {
    const a = ws.getCell(fila, col), b = ws.getCell(fila, col + 1);
    a.value = k; a.font = { name: FUENTE, size: 10, bold: true, color: { argb: C.grisTexto } }; a.fill = fill(C.gris); a.border = BORDES;
    a.alignment = { vertical: 'middle' };
    b.value = v == null || v === '' ? '—' : v; b.font = { name: FUENTE, size: 10 }; b.border = BORDES; b.alignment = { vertical: 'middle', wrapText: true };
    if (v instanceof Date) b.numFmt = (opciones && opciones.hora) ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy';
    if (opciones && opciones.numFmt) b.numFmt = opciones.numFmt;
    fila++;
  }
  return fila;
}
/**
 * Tabla con encabezado azul, cebra, bordes, formatos y filtro automático.
 * columnas: [{ titulo, clave, ancho, tipo: 'texto'|'num'|'pct'|'fecha'|'fechahora'|'bool', align }]
 * opciones: { colorEstado: (fila) => 'verde'|'rojo'|'naranja'|null, sinFiltro }
 */
function tabla(ws, fila, columnas, datos, opciones = {}) {
  const inicio = fila;
  columnas.forEach((c, i) => {
    const cell = ws.getCell(fila, i + 1);
    cell.value = c.titulo; cell.font = { name: FUENTE, size: 10, bold: true, color: { argb: C.blanco } };
    cell.fill = fill(C.azul); cell.border = BORDES; cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    const col = ws.getColumn(i + 1);
    if (c.ancho && (!col.width || col.width < c.ancho)) col.width = c.ancho;
  });
  ws.getRow(fila).height = 24;
  fila++;
  if (!datos.length) {
    ws.mergeCells(fila, 1, fila, columnas.length);
    const c = ws.getCell(fila, 1); c.value = 'Sin datos para los filtros aplicados'; c.font = { name: FUENTE, size: 10, italic: true, color: { argb: C.grisTexto } };
    c.alignment = { horizontal: 'center' }; c.border = BORDES;
    return fila + 2;
  }
  datos.forEach((d, idx) => {
    const tono = opciones.colorEstado ? opciones.colorEstado(d) : null;
    columnas.forEach((c, i) => {
      const cell = ws.getCell(fila, i + 1);
      let v = d[c.clave];
      if (c.tipo === 'fecha') v = fecha(v);
      else if (c.tipo === 'fechahora') v = fechaHora(v);
      else if (c.tipo === 'bool') v = v ? 'Sí' : 'No';
      else if (c.tipo === 'pct') v = typeof v === 'number' ? v / 100 : null;
      else if (c.tipo === 'num') v = typeof v === 'number' ? v : (v == null || v === '' ? null : Number(v));
      cell.value = v == null || v === '' ? (c.tipo === 'texto' ? '' : null) : v;
      cell.font = { name: FUENTE, size: 10 };
      cell.border = BORDES;
      cell.alignment = { vertical: 'middle', horizontal: c.align || (['num', 'pct', 'fecha', 'fechahora', 'bool'].includes(c.tipo) ? 'center' : 'left'), wrapText: !!c.wrap };
      if (c.tipo === 'fecha') cell.numFmt = 'dd/mm/yyyy';
      if (c.tipo === 'fechahora') cell.numFmt = 'dd/mm/yyyy hh:mm';
      if (c.tipo === 'pct') cell.numFmt = '0.0%';
      if (c.tipo === 'num') cell.numFmt = c.decimales ? '#,##0.0' : '#,##0';
      if (idx % 2 === 1) cell.fill = fill(C.gris);
      if (tono && (c.clave === opciones.columnaEstado || !opciones.columnaEstado)) {
        const mapa = { verde: [C.verde, C.verdeTexto], rojo: [C.rojo, C.rojoTexto], naranja: [C.naranja, C.naranjaTexto], azul: [C.azulClaro, C.azul] }[tono];
        if (mapa) { cell.fill = fill(mapa[0]); cell.font = { name: FUENTE, size: 10, bold: true, color: { argb: mapa[1] } }; }
      }
    });
    fila++;
  });
  if (!opciones.sinFiltro) ws.autoFilter = { from: { row: inicio, column: 1 }, to: { row: fila - 1, column: columnas.length } };
  return fila + 1;
}
function hoja(wb, nombre, color) {
  const ws = wb.addWorksheet(nombre, { views: [{ showGridLines: false }], properties: { tabColor: { argb: color || C.azul } } });
  ws.getColumn(1).width = 4;
  return ws;
}
function congelar(ws, filaEncabezado) { ws.views = [{ state: 'frozen', ySplit: filaEncabezado, showGridLines: false }]; }
function nuevoLibro() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FerreObras · FerreAceros'; wb.created = new Date(); wb.modified = new Date();
  return wb;
}
const tonoEtapa = (estado) => ({ Vendida: 'verde', vendida: 'verde', 'Sin venta': 'rojo', sin_venta: 'rojo', Pendiente: 'naranja', pendiente: 'naranja' }[estado] || null);
const nombreEstado = { pendiente: 'Pendiente', vendida: 'Vendida', sin_venta: 'Sin venta', activa: 'Activa', cerrada: 'Cerrada' };

// ============================================================
// Libro de UNA obra
// ============================================================
async function libroObra({ obra, etapas, ventas }, productos) {
  const wb = nuevoLibro();
  const hoy = calc.hoyBogota();
  const reales = etapas.filter(e => e.orden > 0);
  const vendidas = etapas.filter(e => e.estado === 'vendida').length, sinVenta = etapas.filter(e => e.estado === 'sin_venta').length;
  const pendientes = etapas.filter(e => e.estado === 'pendiente').length;
  const proxima = reales.find(e => e.estado === 'pendiente');
  const checks = Object.values(ventas).filter(v => v.vendido).length;

  // ---- Resumen ----
  let ws = hoja(wb, 'Resumen', C.azul);
  const ANCHO = 6;
  let f = titulo(ws, `Obra · ${obra.cliente}`, `${obra.obra}${obra.direccion_obra ? ' · ' + obra.direccion_obra : ''} · Línea ${obra.linea} · Estado: ${nombreEstado[obra.estado] || obra.estado}`, ANCHO);
  ws.getColumn(2).width = 24; ws.getColumn(3).width = 30; ws.getColumn(4).width = 4; ws.getColumn(5).width = 24; ws.getColumn(6).width = 30;
  f = seccion(ws, f, 'Datos del cliente y de la obra', ANCHO);
  const izq = ficha(ws, f, 2, [
    ['Cliente', obra.cliente], ['Celular', obra.celular], ['Dirección del cliente', obra.direccion_cliente],
    ['Línea WhatsApp', obra.linea], ['Registrada por', obra.creada_por], ['Creada', fechaHora(obra.created_at), { hora: true }],
  ]);
  const der = ficha(ws, f, 5, [
    ['Obra / municipio', obra.obra], ['Dirección de la obra', obra.direccion_obra], ['Maestro', obra.maestro], ['Celular del maestro', obra.celular_maestro],
    ['Estado', nombreEstado[obra.estado] || obra.estado], ['Cerrada', fechaHora(obra.cerrada_at), { hora: true }],
  ]);
  f = Math.max(izq, der) + 1;
  f = seccion(ws, f, 'Programación e indicadores', ANCHO);
  const a = ficha(ws, f, 2, [
    ['Fecha de cimentación', fecha(calc.toISO(obra.fecha_cimentacion))], ['Placas iniciales', obra.num_placas],
    ['Intervalo entre etapas (días)', obra.intervalo_dias], ['Días de aviso', obra.dias_aviso], ['Última actualización', fechaHora(obra.updated_at), { hora: true }],
  ]);
  const b = ficha(ws, f, 5, [
    ['Etapas (sin cimentación)', reales.length], ['Etapas vendidas', vendidas], ['Etapas sin venta', sinVenta], ['Etapas pendientes', pendientes],
    ['Conversión (vendidas / decididas)', (vendidas + sinVenta) ? vendidas / (vendidas + sinVenta) : 0, { numFmt: '0.0%' }],
    ['Productos vendidos (checks)', checks],
    ['Próxima etapa', proxima ? `${proxima.nombre} · ${fmtFecha(proxima.fecha_programada)} (aviso ${fmtFecha(proxima.fecha_aviso)}${proxima.fecha_aviso ? ', ' + textoDias(calc.diffDays(hoy, proxima.fecha_aviso)) : ''})` : 'Sin etapas pendientes'],
  ]);
  f = Math.max(a, b) + 1;
  f = seccion(ws, f, 'Códigos de precio por línea de producto', ANCHO);
  const precios = obra.precios || {};
  const mitad = Math.ceil(productos.length / 2);
  const c1 = ficha(ws, f, 2, productos.slice(0, mitad).map(p => [p.nombre, precios[p.nombre] || '—']));
  const c2 = ficha(ws, f, 5, productos.slice(mitad).map(p => [p.nombre, precios[p.nombre] || '—']));
  f = Math.max(c1, c2) + 1;
  if (obra.notas) { f = seccion(ws, f, 'Notas', ANCHO); ws.mergeCells(f, 2, f, ANCHO); const n = ws.getCell(f, 2); n.value = obra.notas; n.alignment = { wrapText: true, vertical: 'top' }; n.font = { name: FUENTE, size: 10 }; ws.getRow(f).height = 48; }

  // ---- Etapas ----
  ws = hoja(wb, 'Etapas', C.azul);
  f = titulo(ws, 'Etapas y avisos', `${obra.cliente} · ${obra.obra}`, 11);
  ws.getColumn(1).width = 6;
  f = tabla(ws, f, [
    { titulo: 'N°', clave: 'orden', tipo: 'num', ancho: 6 }, { titulo: 'Etapa', clave: 'nombre', tipo: 'texto', ancho: 22 },
    { titulo: 'Fecha programada', clave: 'fecha_programada', tipo: 'fecha', ancho: 16 }, { titulo: 'Fecha de aviso', clave: 'fecha_aviso', tipo: 'fecha', ancho: 16 },
    { titulo: 'Fecha real', clave: 'fecha_real', tipo: 'fecha', ancho: 14 }, { titulo: 'Estado', clave: 'estado_nombre', tipo: 'texto', ancho: 13, align: 'center' },
    { titulo: 'Días para el aviso', clave: 'dias', tipo: 'num', ancho: 14 }, { titulo: 'Intervalo (días)', clave: 'intervalo_dias', tipo: 'num', ancho: 12 },
    { titulo: 'Días de aviso', clave: 'dias_aviso', tipo: 'num', ancho: 12 }, { titulo: 'Fecha fijada a mano', clave: 'fecha_fija', tipo: 'bool', ancho: 14 },
    { titulo: 'Notas', clave: 'notas', tipo: 'texto', ancho: 40, wrap: true },
  ], etapas.map(e => ({ ...e, estado_nombre: nombreEstado[e.estado] || e.estado, dias: e.estado === 'pendiente' && e.fecha_aviso ? calc.diffDays(hoy, e.fecha_aviso) : null })),
  { colorEstado: (e) => tonoEtapa(e.estado), columnaEstado: 'estado_nombre' });
  congelar(ws, 4);

  // ---- Ventas (matriz etapa × producto) ----
  ws = hoja(wb, 'Ventas por etapa', C.amarillo);
  const cols = [{ titulo: 'Etapa', clave: 'nombre', tipo: 'texto', ancho: 22 }, { titulo: 'Fecha', clave: 'fecha', tipo: 'fecha', ancho: 13 }, { titulo: 'Estado', clave: 'estado_nombre', tipo: 'texto', ancho: 12, align: 'center' },
    ...productos.map(p => ({ titulo: `${p.nombre}${precios[p.nombre] ? ' (' + precios[p.nombre] + ')' : ''}`, clave: `p_${p.id}`, tipo: 'texto', ancho: 18, align: 'center', wrap: true })),
    { titulo: 'Total líneas', clave: 'total', tipo: 'num', ancho: 10 }];
  f = titulo(ws, 'Qué compró el cliente en cada etapa', 'X = compró · el texto es el detalle registrado por la asesora · entre paréntesis el código de precio', cols.length);
  ws.getColumn(1).width = 22;
  const filasVentas = etapas.map(e => {
    const r = { nombre: e.nombre, fecha: e.fecha_real || e.fecha_programada, estado_nombre: nombreEstado[e.estado] || e.estado, total: 0 };
    for (const p of productos) { const v = ventas[`${e.id}:${p.id}`]; r[`p_${p.id}`] = v && v.vendido ? (v.detalle ? `X · ${v.detalle}` : 'X') : ''; if (v && v.vendido) r.total++; }
    return r;
  });
  const inicioMatriz = f;
  f = tabla(ws, f, cols, filasVentas, { colorEstado: (e) => tonoEtapa(e.estado_nombre), columnaEstado: 'estado_nombre' });
  // resalta en verde las celdas con compra
  for (let r = inicioMatriz + 1; r < inicioMatriz + 1 + filasVentas.length; r++) {
    for (let c = 4; c < 4 + productos.length; c++) { const cell = ws.getCell(r, c); if (cell.value) { cell.fill = fill(C.verde); cell.font = { name: FUENTE, size: 10, bold: true, color: { argb: C.verdeTexto } }; } }
  }
  // totales por producto
  const tot = ws.getRow(f - 1); // fila en blanco tras la tabla -> la usamos como totales
  ws.getCell(f - 1, 1).value = 'Veces vendido'; ws.getCell(f - 1, 1).font = { name: FUENTE, size: 10, bold: true, color: { argb: C.azul } };
  productos.forEach((p, i) => { const c = ws.getCell(f - 1, 4 + i); c.value = filasVentas.filter(r => r[`p_${p.id}`]).length; c.font = { name: FUENTE, size: 10, bold: true, color: { argb: C.azul } }; c.alignment = { horizontal: 'center' }; c.fill = fill(C.amarilloSuave); c.border = BORDES; });
  tot.height = 20;
  congelar(ws, 4);

  // ---- Detalle plano ----
  ws = hoja(wb, 'Detalle de ventas', C.grisTexto);
  f = titulo(ws, 'Detalle de ventas (una fila por producto y etapa)', 'Útil para filtrar y tablas dinámicas', 7);
  ws.getColumn(1).width = 22;
  const detalle = [];
  for (const e of etapas) for (const p of productos) { const v = ventas[`${e.id}:${p.id}`]; if (v && v.vendido) detalle.push({ etapa: e.nombre, fecha: e.fecha_real || e.fecha_programada, estado: nombreEstado[e.estado] || e.estado, producto: p.nombre, codigo: precios[p.nombre] || '', detalle: v.detalle || '', notas: e.notas || '' }); }
  tabla(ws, f, [
    { titulo: 'Etapa', clave: 'etapa', tipo: 'texto', ancho: 22 }, { titulo: 'Fecha', clave: 'fecha', tipo: 'fecha', ancho: 13 }, { titulo: 'Estado', clave: 'estado', tipo: 'texto', ancho: 12, align: 'center' },
    { titulo: 'Producto', clave: 'producto', tipo: 'texto', ancho: 18 }, { titulo: 'Código de precio', clave: 'codigo', tipo: 'texto', ancho: 12, align: 'center' },
    { titulo: 'Detalle', clave: 'detalle', tipo: 'texto', ancho: 40, wrap: true }, { titulo: 'Notas de la etapa', clave: 'notas', tipo: 'texto', ancho: 36, wrap: true },
  ], detalle);
  congelar(ws, 4);

  return wb.xlsx.writeBuffer();
}
function fmtFecha(iso) { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; }
function textoDias(d) { return d < 0 ? `venció hace ${-d} d` : d === 0 ? 'hoy' : `en ${d} d`; }

// ============================================================
// Libro del panel de administración
// ============================================================
async function libroAdmin(informe) {
  const wb = nuevoLibro();
  const { kpis, tablas, graficas, catalogos } = informe;
  const generado = new Date(informe.generado);

  // ---- Resumen ----
  let ws = hoja(wb, 'Resumen', C.azul);
  const ANCHO = 8;
  ws.getColumn(2).width = 34; ws.getColumn(3).width = 18; ws.getColumn(4).width = 4; ws.getColumn(5).width = 34; ws.getColumn(6).width = 18; ws.getColumn(7).width = 4; ws.getColumn(8).width = 18;
  let f = titulo(ws, 'FerreObras · Informe del panel de administración', `Generado el ${generado.toLocaleString('es-CO', { timeZone: 'America/Bogota' })} · Datos a ${fmtFecha(informe.hoy)}`, ANCHO);
  f = seccion(ws, f, 'Filtros aplicados', ANCHO);
  f = ficha(ws, f, 2, informe.descripcion_filtros.length ? informe.descripcion_filtros : [['Filtros', 'Sin filtros: todos los datos']]) + 1;

  f = seccion(ws, f, 'Indicadores', ANCHO);
  const a1 = ficha(ws, f, 2, [
    ['Obras', kpis.obras], ['Obras activas', kpis.activas], ['Obras cerradas', kpis.cerradas], ['Clientes distintos', kpis.clientes],
    ['Obras nuevas (últimos 30 días)', kpis.obras_nuevas_30d], ['Obras cerradas (últimos 30 días)', kpis.cerradas_30d],
    ['Etapas por obra (promedio)', kpis.etapas_por_obra], ['Intervalo promedio entre etapas (días)', kpis.intervalo_promedio],
    ['Duración promedio de obras cerradas (días)', kpis.duracion_promedio],
  ]);
  const a2 = ficha(ws, f, 5, [
    ['Etapas', kpis.etapas], ['Etapas vendidas', kpis.vendidas], ['Etapas sin venta', kpis.sin_venta], ['Etapas pendientes', kpis.pendientes],
    ['Conversión (vendidas / decididas)', kpis.conversion / 100, { numFmt: '0.0%' }], ['Productos vendidos (checks)', kpis.ventas],
    ['Productos por etapa vendida', kpis.ventas_por_etapa_vendida, { numFmt: '0.0' }],
    ['Avisos vencidos', kpis.avisos_vencidos], ['Avisos de hoy', kpis.avisos_hoy], ['Avisos en 7 días', kpis.avisos_7d], ['Avisos en 30 días', kpis.avisos_30d],
  ]);
  f = Math.max(a1, a2) + 1;
  ws.getCell(f - 1, 2).value = 'Conversión = etapas vendidas / (vendidas + sin venta). Las pendientes no cuentan.';
  ws.getCell(f - 1, 2).font = { name: FUENTE, size: 9, italic: true, color: { argb: C.grisTexto } };

  // ---- Por línea WhatsApp ----
  ws = hoja(wb, 'Por línea', C.azul);
  f = titulo(ws, 'Desempeño por línea de WhatsApp', 'Cada asesora / línea con sus obras, etapas y conversión', 13);
  ws.getColumn(1).width = 10;
  tabla(ws, f, [
    { titulo: 'Línea', clave: 'linea', tipo: 'texto', ancho: 10, align: 'center' }, { titulo: 'Correo', clave: 'correo', tipo: 'texto', ancho: 30 },
    { titulo: 'Obras', clave: 'obras', tipo: 'num', ancho: 9 }, { titulo: 'Activas', clave: 'activas', tipo: 'num', ancho: 9 }, { titulo: 'Cerradas', clave: 'cerradas', tipo: 'num', ancho: 9 },
    { titulo: 'Etapas', clave: 'etapas', tipo: 'num', ancho: 9 }, { titulo: 'Vendidas', clave: 'vendidas', tipo: 'num', ancho: 9 }, { titulo: 'Sin venta', clave: 'sin_venta', tipo: 'num', ancho: 9 },
    { titulo: 'Pendientes', clave: 'pendientes', tipo: 'num', ancho: 10 }, { titulo: 'Conversión', clave: 'conversion', tipo: 'pct', ancho: 11 },
    { titulo: 'Checks de producto', clave: 'ventas', tipo: 'num', ancho: 12 }, { titulo: 'Avisos vencidos', clave: 'avisos_vencidos', tipo: 'num', ancho: 11 }, { titulo: 'Avisos 7 días', clave: 'avisos_7d', tipo: 'num', ancho: 11 },
  ], tablas.porLinea);
  congelar(ws, 4);

  // ---- Por etapa ----
  ws = hoja(wb, 'Por etapa', C.azul);
  f = titulo(ws, 'Conversión por etapa', 'En qué etapa se vende más y en cuál se pierde el cliente', 7);
  ws.getColumn(1).width = 22;
  tabla(ws, f, [
    { titulo: 'Etapa', clave: 'etapa', tipo: 'texto', ancho: 22 }, { titulo: 'Etapas', clave: 'etapas', tipo: 'num', ancho: 10 }, { titulo: 'Vendidas', clave: 'vendidas', tipo: 'num', ancho: 10 },
    { titulo: 'Sin venta', clave: 'sin_venta', tipo: 'num', ancho: 10 }, { titulo: 'Pendientes', clave: 'pendientes', tipo: 'num', ancho: 10 },
    { titulo: 'Conversión', clave: 'conversion', tipo: 'pct', ancho: 11 }, { titulo: 'Checks de producto', clave: 'ventas', tipo: 'num', ancho: 12 },
  ], tablas.porEtapa);
  congelar(ws, 4);

  // ---- Por producto ----
  ws = hoja(wb, 'Por producto', C.amarillo);
  const codigos = catalogos.codigos;
  f = titulo(ws, 'Ventas por línea de producto', 'Participación = checks del producto / etapas vendidas. Las columnas de código cuentan obras con ese código', 6 + codigos.length);
  ws.getColumn(1).width = 20;
  tabla(ws, f, [
    { titulo: 'Producto', clave: 'producto', tipo: 'texto', ancho: 20 }, { titulo: 'Activa', clave: 'activa', tipo: 'bool', ancho: 8 },
    { titulo: 'Checks (veces vendido)', clave: 'ventas', tipo: 'num', ancho: 14 }, { titulo: 'Obras con venta', clave: 'obras_con_venta', tipo: 'num', ancho: 12 },
    { titulo: 'Participación', clave: 'participacion', tipo: 'pct', ancho: 12 },
    ...codigos.map(c => ({ titulo: `Código ${c}`, clave: `c_${c}`, tipo: 'num', ancho: 11 })),
  ], tablas.porProducto.map(p => { const r = { ...p }; for (const c of codigos) r[`c_${c}`] = p.codigos[c] || 0; return r; }));
  congelar(ws, 4);

  // ---- Por mes ----
  ws = hoja(wb, 'Por mes', C.azul);
  f = titulo(ws, 'Evolución mensual', 'Obras creadas y cerradas por mes de creación/cierre; etapas por la fecha real o programada de la etapa', 9);
  ws.getColumn(1).width = 12;
  tabla(ws, f, [
    { titulo: 'Mes', clave: 'etiqueta', tipo: 'texto', ancho: 12, align: 'center' }, { titulo: 'Obras creadas', clave: 'obras_creadas', tipo: 'num', ancho: 12 }, { titulo: 'Obras cerradas', clave: 'obras_cerradas', tipo: 'num', ancho: 12 },
    { titulo: 'Etapas', clave: 'etapas', tipo: 'num', ancho: 10 }, { titulo: 'Vendidas', clave: 'vendidas', tipo: 'num', ancho: 10 }, { titulo: 'Sin venta', clave: 'sin_venta', tipo: 'num', ancho: 10 },
    { titulo: 'Pendientes', clave: 'pendientes', tipo: 'num', ancho: 10 }, { titulo: 'Conversión', clave: 'conversion', tipo: 'pct', ancho: 11 }, { titulo: 'Checks de producto', clave: 'ventas', tipo: 'num', ancho: 12 },
  ], tablas.porMes);
  congelar(ws, 4);

  // ---- Clientes ----
  ws = hoja(wb, 'Clientes', C.azul);
  f = titulo(ws, 'Clientes con más etapas vendidas', `Top ${informe.filtros.top}`, 9);
  ws.getColumn(1).width = 28;
  tabla(ws, f, [
    { titulo: 'Cliente', clave: 'cliente', tipo: 'texto', ancho: 28 }, { titulo: 'Celular', clave: 'celular', tipo: 'texto', ancho: 14 }, { titulo: 'Líneas', clave: 'lineas', tipo: 'texto', ancho: 14, align: 'center' },
    { titulo: 'Obras', clave: 'obras', tipo: 'num', ancho: 8 }, { titulo: 'Activas', clave: 'activas', tipo: 'num', ancho: 8 }, { titulo: 'Etapas vendidas', clave: 'vendidas', tipo: 'num', ancho: 12 },
    { titulo: 'Sin venta', clave: 'sin_venta', tipo: 'num', ancho: 10 }, { titulo: 'Conversión', clave: 'conversion', tipo: 'pct', ancho: 11 }, { titulo: 'Última actualización', clave: 'ultima', tipo: 'fecha', ancho: 14 },
  ], tablas.topClientes);
  congelar(ws, 4);

  // ---- Alertas ----
  ws = hoja(wb, 'Alertas', C.rojoTexto);
  f = titulo(ws, 'Avisos vencidos y próximos (7 días)', 'Etapas pendientes cuya fecha de aviso ya pasó o está por llegar', 9);
  ws.getColumn(1).width = 8;
  tabla(ws, f, [
    { titulo: 'Obra ID', clave: 'obra_id', tipo: 'num', ancho: 8 }, { titulo: 'Cliente', clave: 'cliente', tipo: 'texto', ancho: 26 }, { titulo: 'Celular', clave: 'celular', tipo: 'texto', ancho: 14 },
    { titulo: 'Obra', clave: 'obra', tipo: 'texto', ancho: 20 }, { titulo: 'Línea', clave: 'linea', tipo: 'texto', ancho: 8, align: 'center' }, { titulo: 'Etapa', clave: 'etapa', tipo: 'texto', ancho: 18 },
    { titulo: 'Fecha etapa', clave: 'fecha', tipo: 'fecha', ancho: 13 }, { titulo: 'Fecha aviso', clave: 'fecha_aviso', tipo: 'fecha', ancho: 13 }, { titulo: 'Días', clave: 'dias', tipo: 'num', ancho: 8 },
  ], tablas.alertas, { colorEstado: (a) => (a.dias < 0 ? 'rojo' : 'naranja'), columnaEstado: 'dias' });
  congelar(ws, 4);

  // ---- Obras ----
  ws = hoja(wb, 'Obras', C.azul);
  const productosCols = catalogos.productos.map(p => ({ titulo: `Código ${p}`, clave: `cod_${p}`, tipo: 'texto', ancho: 10, align: 'center' }));
  const colsObras = [
    { titulo: 'ID', clave: 'id', tipo: 'num', ancho: 6 }, { titulo: 'Cliente', clave: 'cliente', tipo: 'texto', ancho: 26 }, { titulo: 'Celular', clave: 'celular', tipo: 'texto', ancho: 13 },
    { titulo: 'Dirección cliente', clave: 'direccion_cliente', tipo: 'texto', ancho: 24 }, { titulo: 'Obra / municipio', clave: 'obra', tipo: 'texto', ancho: 20 }, { titulo: 'Dirección obra', clave: 'direccion_obra', tipo: 'texto', ancho: 24 },
    { titulo: 'Maestro', clave: 'maestro', tipo: 'texto', ancho: 18 }, { titulo: 'Cel. maestro', clave: 'celular_maestro', tipo: 'texto', ancho: 13 }, { titulo: 'Línea', clave: 'linea', tipo: 'texto', ancho: 8, align: 'center' },
    { titulo: 'Estado', clave: 'estado_nombre', tipo: 'texto', ancho: 10, align: 'center' }, { titulo: 'Cimentación', clave: 'fecha_cimentacion', tipo: 'fecha', ancho: 12 },
    { titulo: 'Placas iniciales', clave: 'num_placas', tipo: 'num', ancho: 9 }, { titulo: 'Intervalo (d)', clave: 'intervalo_dias', tipo: 'num', ancho: 9 }, { titulo: 'Días aviso', clave: 'dias_aviso', tipo: 'num', ancho: 9 },
    { titulo: 'Etapas', clave: 'total_etapas', tipo: 'num', ancho: 8 }, { titulo: 'Hechas', clave: 'hechas', tipo: 'num', ancho: 8 }, { titulo: 'Vendidas', clave: 'vendidas', tipo: 'num', ancho: 9 },
    { titulo: 'Sin venta', clave: 'sin_venta', tipo: 'num', ancho: 9 }, { titulo: 'Pendientes', clave: 'pendientes', tipo: 'num', ancho: 10 }, { titulo: 'Conversión', clave: 'conversion', tipo: 'pct', ancho: 10 },
    { titulo: 'Checks', clave: 'ventas', tipo: 'num', ancho: 8 }, { titulo: 'Próxima etapa', clave: 'proxima', tipo: 'texto', ancho: 16 }, { titulo: 'Fecha próxima', clave: 'proxima_fecha', tipo: 'fecha', ancho: 12 },
    { titulo: 'Aviso próximo', clave: 'proxima_aviso', tipo: 'fecha', ancho: 12 }, { titulo: 'Días para aviso', clave: 'dias_para_aviso', tipo: 'num', ancho: 10 },
    ...productosCols,
    { titulo: 'Creada', clave: 'creada', tipo: 'fecha', ancho: 12 }, { titulo: 'Cerrada', clave: 'cerrada', tipo: 'fecha', ancho: 12 }, { titulo: 'Duración (d)', clave: 'duracion_dias', tipo: 'num', ancho: 10 },
    { titulo: 'Actualizada', clave: 'actualizada', tipo: 'fecha', ancho: 12 }, { titulo: 'Registrada por', clave: 'creada_por', tipo: 'texto', ancho: 12 }, { titulo: 'Notas', clave: 'notas', tipo: 'texto', ancho: 40, wrap: true },
  ];
  f = titulo(ws, 'Obras', 'Una fila por obra con su avance, próxima etapa y códigos de precio', colsObras.length);
  ws.getColumn(1).width = 6;
  tabla(ws, f, colsObras, tablas.obras.map(o => { const r = { ...o }; for (const p of catalogos.productos) r[`cod_${p}`] = o.precios[p] || ''; return r; }),
    { colorEstado: (o) => (o.estado === 'activa' ? 'azul' : null), columnaEstado: 'estado_nombre' });
  congelar(ws, 4);

  // ---- Etapas ----
  ws = hoja(wb, 'Etapas', C.azul);
  f = titulo(ws, 'Etapas', 'Todas las etapas de las obras filtradas, con sus fechas y los productos vendidos', 17);
  ws.getColumn(1).width = 8;
  tabla(ws, f, [
    { titulo: 'Obra ID', clave: 'obra_id', tipo: 'num', ancho: 8 }, { titulo: 'Cliente', clave: 'cliente', tipo: 'texto', ancho: 26 }, { titulo: 'Celular', clave: 'celular', tipo: 'texto', ancho: 13 },
    { titulo: 'Obra', clave: 'obra', tipo: 'texto', ancho: 18 }, { titulo: 'Línea', clave: 'linea', tipo: 'texto', ancho: 8, align: 'center' }, { titulo: 'Estado obra', clave: 'estado_obra', tipo: 'texto', ancho: 10, align: 'center' },
    { titulo: 'N°', clave: 'orden', tipo: 'num', ancho: 5 }, { titulo: 'Etapa', clave: 'etapa', tipo: 'texto', ancho: 18 }, { titulo: 'Estado', clave: 'estado', tipo: 'texto', ancho: 11, align: 'center' },
    { titulo: 'Programada', clave: 'fecha_programada', tipo: 'fecha', ancho: 12 }, { titulo: 'Aviso', clave: 'fecha_aviso', tipo: 'fecha', ancho: 12 }, { titulo: 'Real', clave: 'fecha_real', tipo: 'fecha', ancho: 12 },
    { titulo: 'Intervalo (d)', clave: 'intervalo_dias', tipo: 'num', ancho: 9 }, { titulo: 'Días aviso', clave: 'dias_aviso', tipo: 'num', ancho: 9 }, { titulo: 'Fijada', clave: 'fecha_fija', tipo: 'bool', ancho: 8 },
    { titulo: 'Productos vendidos', clave: 'productos', tipo: 'texto', ancho: 34, wrap: true }, { titulo: 'Notas', clave: 'notas', tipo: 'texto', ancho: 36, wrap: true },
  ], tablas.etapas, { colorEstado: (e) => tonoEtapa(e.estado), columnaEstado: 'estado' });
  congelar(ws, 4);

  // ---- Ventas ----
  ws = hoja(wb, 'Ventas', C.amarillo);
  f = titulo(ws, 'Ventas por producto', 'Una fila por producto vendido en cada etapa (checks), con el código de precio y el detalle', 9);
  ws.getColumn(1).width = 8;
  tabla(ws, f, [
    { titulo: 'Obra ID', clave: 'obra_id', tipo: 'num', ancho: 8 }, { titulo: 'Cliente', clave: 'cliente', tipo: 'texto', ancho: 26 }, { titulo: 'Obra', clave: 'obra', tipo: 'texto', ancho: 18 },
    { titulo: 'Línea', clave: 'linea', tipo: 'texto', ancho: 8, align: 'center' }, { titulo: 'Etapa', clave: 'etapa', tipo: 'texto', ancho: 18 }, { titulo: 'Fecha', clave: 'fecha', tipo: 'fecha', ancho: 12 },
    { titulo: 'Producto', clave: 'producto', tipo: 'texto', ancho: 18 }, { titulo: 'Código', clave: 'codigo', tipo: 'texto', ancho: 9, align: 'center' }, { titulo: 'Detalle', clave: 'detalle', tipo: 'texto', ancho: 40, wrap: true },
  ], tablas.ventas);
  congelar(ws, 4);

  // ---- Gráfica configurada ----
  ws = hoja(wb, 'Gráfica configurada', C.grisTexto);
  const g = graficas.configurada;
  const colsG = [{ titulo: g.agrupar.nombre, clave: 'etiqueta', tipo: 'texto', ancho: 26 }, ...g.series.map((s, i) => ({ titulo: s.nombre, clave: `s${i}`, tipo: g.unidad === '%' ? 'pct' : 'num', ancho: 14 }))];
  if (g.series.length > 1 && g.unidad !== '%') colsG.push({ titulo: 'Total', clave: 'total', tipo: 'num', ancho: 12 });
  f = titulo(ws, `${g.metrica.nombre} por ${g.agrupar.nombre}${g.segmentar ? ' · segmentado por ' + g.segmentar.nombre : ''}`, 'Datos de la gráfica configurada en el panel (mismos filtros)', colsG.length);
  ws.getColumn(1).width = 26;
  tabla(ws, f, colsG, g.etiquetas.map((et, i) => { const r = { etiqueta: et, total: 0 }; g.series.forEach((s, j) => { r[`s${j}`] = s.datos[i]; r.total += s.datos[i]; }); return r; }));
  congelar(ws, 4);

  return wb.xlsx.writeBuffer();
}

// ============================================================
// Libro de la planificación de UNA ruta (reemplaza la hoja de llamadas por ruta)
// ============================================================
async function libroRuta({ ruta, paradas, sede, clientes, estados }) {
  const wb = nuevoLibro();
  const nombreEstadoRuta = Object.fromEntries(estados.map(e => [e.id, e.nombre]));
  const tonoContacto = (id) => ({ despacho: 'verde', no_necesita: 'rojo', no_contesta: 'naranja', pendiente: 'naranja' }[id] || null);
  const orden = (c) => (c.parada != null ? c.parada : 999);
  const filas = (lista) => lista.slice().sort((a, b) => orden(a) - orden(b) || a.nombre.localeCompare(b.nombre, 'es')).map(c => ({
    parada: c.parada != null ? `${c.parada + 1}. ${paradas[c.parada].nombre}` : `Fuera de ruta · ${c.municipio || '—'}`,
    nombre: c.nombre, tipo: c.tipo === 'o' ? `Obra${c.obra ? ' · ' + c.obra : ''}` : 'Ferretería', telefonos: c.telefonos, direccion: c.direccion, sector: c.sector || '',
    estado: nombreEstadoRuta[c.estado] || c.estado, estado_id: c.estado, peso: c.peso, observacion: c.observacion,
  }));
  const incluidos = clientes.filter(c => c.incluido), quitados = clientes.filter(c => !c.incluido);
  const kg = (lista) => lista.reduce((n, c) => n + (c.peso ? c.peso : 0), 0);
  const pesoTotal = kg(incluidos), peso = kg(incluidos.filter(c => c.estado === 'despacho'));
  const cols = [
    { titulo: 'Parada', clave: 'parada', tipo: 'texto', ancho: 22 }, { titulo: 'Cliente', clave: 'nombre', tipo: 'texto', ancho: 30 },
    { titulo: 'Tipo', clave: 'tipo', tipo: 'texto', ancho: 16 }, { titulo: 'Teléfonos', clave: 'telefonos', tipo: 'texto', ancho: 26, wrap: true },
    { titulo: 'Dirección', clave: 'direccion', tipo: 'texto', ancho: 26, wrap: true }, { titulo: 'Sector', clave: 'sector', tipo: 'texto', ancho: 16, wrap: true },
    { titulo: 'Estado', clave: 'estado', tipo: 'texto', ancho: 18, align: 'center' }, { titulo: 'Peso (kg)', clave: 'peso', tipo: 'num', ancho: 10, decimales: true },
    { titulo: 'Observación', clave: 'observacion', tipo: 'texto', ancho: 36, wrap: true },
  ];
  const sub = [ruta.proximo_despacho ? `Despacho ${fmtFecha(ruta.proximo_despacho)}` : 'Sin fecha de despacho', sede ? `Sale de ${sede.nombre}` : '', ruta.frecuencia, ruta.dias].filter(Boolean).join(' · ');

  let ws = hoja(wb, 'Planificación', C.azul);
  let f = titulo(ws, `${ruta.nombre} · ${paradas.map(p => p.nombre).join(' – ')}`, sub, cols.length);
  ws.getColumn(1).width = 22;
  f = seccion(ws, f, 'Resumen', cols.length);
  const conteo = (id) => incluidos.filter(c => c.estado === id).length;
  const a = ficha(ws, f, 2, [['Clientes seleccionados', incluidos.length], ['Ferreterías', incluidos.filter(c => c.tipo === 'c').length], ['Clientes de obras', incluidos.filter(c => c.tipo === 'o').length], ['Peso total en la ruta (kg)', pesoTotal, { numFmt: '#,##0.0' }], ['Peso confirmado (kg)', peso, { numFmt: '#,##0.0' }]]);
  const b = ficha(ws, f, 5, estados.map(e => [e.nombre, conteo(e.id)]));
  f = Math.max(a, b) + 1;
  f = seccion(ws, f, 'Clientes de la ruta', cols.length);
  const inicio = f;
  f = tabla(ws, f, cols, filas(incluidos), { colorEstado: (r) => tonoContacto(r.estado_id), columnaEstado: 'estado' });
  ws.views = [{ state: 'frozen', ySplit: inicio, showGridLines: false }];

  ws = hoja(wb, 'No incluidos', C.grisTexto);
  f = titulo(ws, 'Clientes quitados de la ruta', `${ruta.nombre} · clientes de los municipios de la ruta que no se van a contactar`, cols.length);
  ws.getColumn(1).width = 22;
  tabla(ws, f, cols, filas(quitados));
  congelar(ws, 4);

  return wb.xlsx.writeBuffer();
}

// ============================================================
// Libro de la AGENDA de contactos (ferreterías y clientes de obras)
// ============================================================
async function libroAgenda(contactos, descripcionFiltro) {
  const wb = nuevoLibro();
  const prep = (c) => ({ ...c, rutas_texto: (c.rutas || []).join(', ') });
  const ferreterias = contactos.filter(c => c.tipo === 'c').map(prep), obras = contactos.filter(c => c.tipo === 'o').map(prep);
  const sub = (n) => `${n} contacto${n === 1 ? '' : 's'}${descripcionFiltro ? ' · ' + descripcionFiltro : ''} · exportado el ${fmtFecha(calc.hoyBogota())}`;
  const colsF = [
    { titulo: 'Cliente', clave: 'nombre', tipo: 'texto', ancho: 30 }, { titulo: 'Municipio', clave: 'municipio', tipo: 'texto', ancho: 18 },
    { titulo: 'Teléfonos', clave: 'telefonos', tipo: 'texto', ancho: 26, wrap: true }, { titulo: 'Dirección', clave: 'direccion', tipo: 'texto', ancho: 28, wrap: true },
    { titulo: 'Sector', clave: 'sector', tipo: 'texto', ancho: 16 }, { titulo: 'NIT o cédula', clave: 'nit', tipo: 'texto', ancho: 14 },
    { titulo: 'Razón social', clave: 'razon_social', tipo: 'texto', ancho: 24 }, { titulo: 'Tipología', clave: 'tipologia', tipo: 'texto', ancho: 16 },
    { titulo: 'Volumen de compra', clave: 'volumen_compra', tipo: 'texto', ancho: 16 }, { titulo: 'Rutas', clave: 'rutas_texto', tipo: 'texto', ancho: 20, wrap: true },
    { titulo: 'Notas', clave: 'notas', tipo: 'texto', ancho: 30, wrap: true },
  ];
  const colsO = [
    { titulo: 'Cliente', clave: 'nombre', tipo: 'texto', ancho: 30 }, { titulo: 'Obra', clave: 'obra', tipo: 'texto', ancho: 22 },
    { titulo: 'Municipio', clave: 'municipio', tipo: 'texto', ancho: 18 }, { titulo: 'Teléfonos', clave: 'telefonos', tipo: 'texto', ancho: 18 },
    { titulo: 'Dirección de la obra', clave: 'direccion', tipo: 'texto', ancho: 28, wrap: true }, { titulo: 'Maestro', clave: 'maestro', tipo: 'texto', ancho: 20 },
    { titulo: 'Celular maestro', clave: 'celular_maestro', tipo: 'texto', ancho: 16 }, { titulo: 'Línea WhatsApp', clave: 'linea', tipo: 'texto', ancho: 14, align: 'center' },
    { titulo: 'Rutas', clave: 'rutas_texto', tipo: 'texto', ancho: 20, wrap: true }, { titulo: 'Notas', clave: 'notas', tipo: 'texto', ancho: 30, wrap: true },
  ];
  let ws = hoja(wb, 'Ferreterías', C.azul);
  let f = titulo(ws, 'Agenda de contactos · Ferreterías', sub(ferreterias.length), colsF.length);
  tabla(ws, f, colsF, ferreterias); congelar(ws, 4);
  ws = hoja(wb, 'Clientes de obras', C.verdeTexto);
  f = titulo(ws, 'Agenda de contactos · Clientes de obras en curso', sub(obras.length), colsO.length);
  tabla(ws, f, colsO, obras); congelar(ws, 4);
  return wb.xlsx.writeBuffer();
}

module.exports = { libroObra, libroAdmin, libroRuta, libroAgenda };
