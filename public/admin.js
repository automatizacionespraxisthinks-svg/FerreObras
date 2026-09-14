// Panel de administración: filtros en vivo, gráficas (Chart.js) y tablas.
// Toda la lógica de negocio vive en el servidor (src/reportes.js); aquí solo se pinta.
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const form = $('#filtros');
  const datosIniciales = $('#datos-inicial');
  if (!form || !datosIniciales) return;
  let informe = JSON.parse(datosIniciales.textContent);
  const graficas = {};
  let ordenObras = { clave: 'dias_para_aviso', asc: true };
  let temporizador = null, peticionActual = 0;

  // ---------- utilidades ----------
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, dec) => (v == null || v === '' ? '—' : Number(v).toLocaleString('es-CO', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }));
  const pct = (v) => (v == null ? '—' : num(v, 1) + '%');
  const fecha = (iso) => { if (!iso) return '—'; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
  const dias = (d) => (d == null ? '—' : d < 0 ? `hace ${-d} d` : d === 0 ? 'hoy' : `en ${d} d`);
  const claseDias = (d) => (d == null ? '' : d < 0 ? 'vencido' : d === 0 ? 'hoy' : d <= 3 ? 'pronto' : '');
  const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const PALETA = ['#092F77', '#FFD600', '#3D6BD1', '#F2A900', '#7C93D8', '#B89B00', '#B7C6F0', '#8A8F99', '#5A3E85', '#2E8B8B', '#C05621', '#4A6FA5'];
  const COLOR_FIJO = { Vendida: '#1F8A4C', 'Sin venta': '#9AA0AA', Pendiente: '#F2B705', Activa: '#092F77', Cerrada: '#9AA0AA', Total: '#092F77', 'Avisos pendientes': '#092F77', 'Sin código': '#C7CBD4', 'R+R': '#092F77', R: '#3D6BD1', E: '#F2A900', F: '#FFD600' };
  const color = (nombre, i) => COLOR_FIJO[nombre] || PALETA[i % PALETA.length];

  if (window.Chart) {
    Chart.defaults.font.family = 'Poppins, "Segoe UI", system-ui, sans-serif';
    Chart.defaults.font.size = 12;
    Chart.defaults.color = '#4B5563';
  }

  // ---------- filtros ----------
  function queryDesdeFormulario() {
    const p = new URLSearchParams();
    const multi = {};
    const porDefecto = { campo_fecha: 'etapa', metrica: 'etapas', agrupar: 'linea', top: '12' };
    for (const [k, v] of new FormData(form)) {
      if (v === '' || v == null || porDefecto[k] === v) continue;
      if (k === 'linea' || k === 'producto') (multi[k] = multi[k] || []).push(v);
      else p.set(k, v);
    }
    for (const k in multi) p.set(k, multi[k].join(','));
    return p.toString();
  }
  function setCargando(on, error) {
    const el = $('#estado-carga');
    if (!el) return;
    el.textContent = error ? 'No se pudieron cargar los datos. Revisa la conexión e intenta de nuevo.' : (on ? 'Actualizando…' : '');
    el.classList.toggle('error', !!error);
    document.body.classList.toggle('cargando', !!on);
  }
  async function actualizar() {
    const q = queryDesdeFormulario();
    const id = ++peticionActual;
    setCargando(true);
    try {
      const r = await fetch('/admin/datos.json' + (q ? '?' + q : ''), { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const datos = await r.json();
      if (id !== peticionActual) return; // llegó una petición más nueva
      informe = datos;
      if (window.history && window.history.replaceState) window.history.replaceState(null, '', '/admin' + (q ? '?' + q : ''));
      render();
      setCargando(false);
    } catch (e) {
      console.error(e);
      setCargando(false, true);
    }
  }
  function programarActualizacion() { clearTimeout(temporizador); temporizador = setTimeout(actualizar, 250); }
  form.addEventListener('input', programarActualizacion);
  form.addEventListener('change', programarActualizacion);
  form.addEventListener('submit', (e) => { e.preventDefault(); actualizar(); });
  $('#limpiar-filtros').addEventListener('click', () => {
    form.reset();
    $$('input[type=checkbox]', form).forEach(c => { c.checked = false; });
    $$('input[type=date]', form).forEach(c => { c.value = ''; });
    $$('select', form).forEach(s => { s.value = s.name === 'metrica' ? 'etapas' : s.name === 'agrupar' ? 'linea' : s.name === 'campo_fecha' ? 'etapa' : ''; });
    $('input[name=top]', form).value = 12;
    actualizar();
  });

  // ---------- gráficas ----------
  function grafica(id, datos, opts) {
    opts = opts || {};
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const contenedor = canvas.parentElement, vacio = $('.grafica-vacia', contenedor);
    const sinDatos = !datos || !datos.etiquetas.length || !datos.series.some(s => s.datos.some(v => v));
    if (vacio) vacio.hidden = !sinDatos;
    canvas.style.visibility = sinDatos ? 'hidden' : 'visible';
    if (!window.Chart) { if (vacio) { vacio.hidden = false; vacio.textContent = 'No se pudo cargar la librería de gráficas (Chart.js). Verifica la conexión a internet.'; } return; }
    if (sinDatos) { if (graficas[id]) { graficas[id].destroy(); delete graficas[id]; } return; }
    const horizontal = !!opts.horizontal;
    const porcentaje = datos.unidad === '%';
    const apilado = datos.series.length > 1 && !porcentaje && !opts.agrupado;
    const datasets = datos.series.map((s, i) => ({ label: s.nombre, data: s.datos, backgroundColor: color(s.nombre, i), borderRadius: apilado ? 0 : 3, borderWidth: apilado ? 1 : 0, borderColor: '#fff', maxBarThickness: 44 }));
    const ejeValor = { stacked: apilado, beginAtZero: true, grid: { color: '#EEF0F5' }, ticks: { precision: 0, callback: (v) => v + (porcentaje ? '%' : '') } };
    if (porcentaje) ejeValor.max = 100;
    const ejeCat = { stacked: apilado, grid: { display: false }, ticks: { autoSkip: false, maxRotation: horizontal ? 0 : 45, callback: function (v) { const t = this.getLabelForValue(v); return t.length > 18 ? t.slice(0, 17) + '…' : t; } } };
    const config = {
      type: 'bar',
      data: { labels: datos.etiquetas, datasets },
      options: {
        indexAxis: horizontal ? 'y' : 'x', responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: datos.series.length > 1, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, padding: 14 } },
          tooltip: {
            backgroundColor: '#092F77', titleFont: { weight: '600' }, padding: 10, cornerRadius: 6,
            callbacks: {
              title: (items) => (items.length ? datos.etiquetas[items[0].dataIndex] : ''),
              label: (c) => ` ${c.dataset.label}: ${num(c.parsed[horizontal ? 'x' : 'y'], porcentaje ? 1 : 0)}${porcentaje ? '%' : ''}`,
              footer: (items) => (apilado && items.length > 1 ? 'Total: ' + num(items.reduce((n, it) => n + (it.parsed[horizontal ? 'x' : 'y'] || 0), 0)) : ''),
            },
          },
        },
        scales: horizontal ? { x: ejeValor, y: ejeCat } : { x: ejeCat, y: ejeValor },
      },
    };
    if (graficas[id]) { graficas[id].data = config.data; graficas[id].options = config.options; graficas[id].update(); }
    else graficas[id] = new Chart(canvas, config);
  }

  function renderGraficas() {
    const g = informe.graficas, c = g.configurada;
    $('#titulo-configurada').textContent = `${c.metrica.nombre} por ${c.agrupar.nombre}${c.segmentar ? ' · segmentado por ' + c.segmentar.nombre : ''}`;
    const nota = { obras: 'Obras distintas que tienen al menos una etapa en el grupo.', etapas: 'Número de etapas (incluye la inicial).', conversion: 'Vendidas / (vendidas + sin venta). Las pendientes no cuentan.', ventas: 'Cada check de producto marcado como vendido cuenta 1.' }[c.metrica.id] || 'Etapas distintas en el grupo.';
    $('#ayuda-configurada').textContent = nota + (['cliente', 'municipio'].includes(c.agrupar.id) ? ` Se muestran los ${informe.filtros.top} con mayor valor.` : '');
    const muchos = c.etiquetas.length > 8 || c.etiquetas.some(e => String(e).length > 14);
    grafica('g-configurada', c, { horizontal: muchos && c.agrupar.id !== 'mes' });
    grafica('g-lineas', g.etapasPorLinea);
    grafica('g-etapas', g.conversionPorEtapa, { agrupado: true });
    grafica('g-productos', g.ventasPorProducto, { horizontal: true });
    grafica('g-meses', g.obrasPorMes);
    grafica('g-codigos', g.codigosPorProducto);
    grafica('g-semanas', g.avisosPorSemana);
  }

  // ---------- KPIs ----------
  function renderKpis() {
    const k = informe.kpis;
    $$('[data-kpi]').forEach(el => {
      const clave = el.dataset.kpi, v = k[clave];
      el.textContent = clave === 'conversion' ? num(v, 1) : (clave === 'etapas_por_obra' ? num(v, 1) : num(v));
    });
    $('.kpi.rojo').classList.toggle('alerta', k.avisos_vencidos > 0);
  }

  // ---------- ayuda de columnas (icono ⓘ en los encabezados) ----------
  // Cada texto explica qué mide la columna y cómo se relaciona con la tabla general de trazabilidad de obras.
  const INFO_COMUN = {
    etapas: 'Total de etapas dentro de los filtros (inicial, etapa 1, etapa 2, cubierta…), sin importar su estado. Cada obra aporta sus etapas.',
    vendidas: 'Etapas en las que el cliente compró: se marcaron como vendidas con al menos un producto. Coincide con la columna Vendidas de la trazabilidad de obras.',
    sin_venta: 'Etapas ya decididas en las que no hubo venta: el cliente compró en otro lugar o no necesitó material.',
    pendientes: 'Etapas todavía por decidir: aún no se marcan como vendidas ni sin venta. Son las que generan avisos.',
    conversion: 'Vendidas ÷ (vendidas + sin venta), en porcentaje. Las pendientes no cuentan. Es la proporción de etapas decididas que terminaron en venta.',
    ventas: 'Checks: número de productos marcados como vendidos, sumando todas las etapas. Una etapa vendida puede tener varios checks (uno por línea de producto).',
  };
  const INFO = {
    alertas: {
      cliente: 'Cliente de la obra y su celular. Al hacer clic en la fila se abre la obra.',
      obra: 'Nombre o municipio de la obra, tal como se registró al crearla.',
      linea: 'Línea de WhatsApp (asesora) que registró la obra y recibe el aviso en su calendario.',
      etapa: 'Etapa de construcción a la que corresponde el aviso (etapa 1, cubierta, acabados, etc.).',
      fecha: 'Fecha programada de la etapa (o la real, si ya se registró). Es la fecha estimada en que el cliente necesita el material.',
      fecha_aviso: 'Fecha en que se debe contactar al cliente: fecha de la etapa menos los días de aviso configurados. El chip muestra cuántos días faltan o hace cuántos se venció.',
    },
    lineas: {
      linea: 'Línea de WhatsApp de la asesora y el correo donde recibe los eventos de Google Calendar.',
      obras: 'Obras registradas por esta línea que cumplen los filtros; debajo, cuántas siguen activas (en seguimiento).',
      ...INFO_COMUN,
      avisos_vencidos: 'Avisos vencidos: ya pasó la fecha de aviso y la etapa sigue pendiente. También los avisos que vencen en los próximos 7 días.',
    },
    etapas: {
      etapa: 'Nombre de la etapa. Agrupa las etapas con el mismo nombre en todas las obras del informe para ver en cuál se gana o se pierde al cliente.',
      ...INFO_COMUN,
      etapas: 'Cuántas obras tienen una etapa con este nombre dentro de los filtros.',
    },
    productos: {
      producto: 'Línea de producto (columna del historial de ventas de cada obra). Las inactivas ya no se ofrecen, pero conservan su historial.',
      ventas: 'Veces que este producto se marcó como vendido en alguna etapa (un check por etapa).',
      obras_con_venta: 'Obras distintas en las que se vendió este producto al menos una vez.',
      participacion: 'Checks del producto ÷ etapas vendidas. Indica en qué porcentaje de las etapas vendidas entró este producto.',
      codigos: 'Cuántas obras del informe tienen cada código de precio (R+R, R, E, F) asignado para este producto.',
    },
    clientes: {
      cliente: 'Cliente (nombre y celular) y la línea que lo atiende. Suma todas sus obras, aunque estén cerradas.',
      obras: 'Obras registradas a nombre del cliente y cuántas siguen activas.',
      vendidas: 'Etapas vendidas sumando todas las obras del cliente.',
      sin_venta: 'Etapas sin venta sumando todas las obras del cliente.',
      conversion: INFO_COMUN.conversion,
      ventas: 'Productos marcados como vendidos en todas las etapas del cliente.',
      ultima: 'Fecha de la última modificación en alguna de las obras del cliente.',
    },
    meses: {
      etiqueta: 'Mes calendario. Las etapas se ubican por su fecha (real o programada); las obras, por su fecha de creación o cierre.',
      obras_creadas: 'Obras registradas en la aplicación durante ese mes.',
      obras_cerradas: 'Obras que se cerraron durante ese mes (terminaron o se cerraron a mano).',
      ...INFO_COMUN,
      etapas: 'Etapas cuya fecha (real o programada) cae en ese mes.',
    },
    obras: {
      cliente: 'Nombre y celular del cliente. Clic en la fila para abrir la obra.',
      obra: 'Nombre o municipio de la obra y la dirección donde se despacha.',
      linea: 'Línea de WhatsApp que atiende la obra.',
      estado: 'Activa: en seguimiento y genera avisos. Cerrada: terminó o se cerró a mano; ya no genera avisos.',
      hechas: 'Etapas ya decididas (vendidas o sin venta) sobre el total de etapas de la obra. Refleja qué tan avanzada va la construcción.',
      vendidas: 'Etapas de esta obra en las que se vendió.',
      sin_venta: 'Etapas de esta obra que se marcaron sin venta.',
      conversion: 'Vendidas ÷ (vendidas + sin venta) de esta obra, en porcentaje.',
      ventas: 'Productos marcados como vendidos en todas las etapas de esta obra.',
      proxima_fecha: 'Siguiente etapa pendiente de la obra y su fecha programada.',
      dias_para_aviso: 'Fecha del próximo aviso (siguiente etapa menos los días de aviso) y cuántos días faltan o hace cuántos venció.',
      creada: 'Fecha en que se registró la obra en la aplicación.',
      actualizada: 'Fecha de la última modificación de la obra (etapas, ventas o datos).',
    },
  };
  const iconoInfo = (titulo, texto) => `<button type="button" class="th-info" data-titulo="${esc(titulo)}" data-info="${esc(texto)}" aria-label="Qué significa ${esc(titulo)}"><svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10 1.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM9 5.5h2v2H9v-2zm0 3.5h2v6H9V9z"/></svg></button>`;
  // Un único globo flotante (position: fixed) para que no lo recorte el scroll de las tablas
  const tip = document.createElement('div');
  tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  document.body.appendChild(tip);
  let tipActual = null;
  function mostrarTip(el) {
    if (tipActual && tipActual !== el) tipActual.classList.remove('activo');
    tipActual = el; el.classList.add('activo');
    tip.innerHTML = `<b>${esc(el.dataset.titulo)}</b>${esc(el.dataset.info)}`;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), ancho = tip.offsetWidth, alto = tip.offsetHeight;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - ancho / 2, window.innerWidth - ancho - 8));
    const abajo = r.bottom + 8 + alto <= window.innerHeight;
    tip.classList.toggle('arriba', !abajo);
    tip.style.top = `${abajo ? r.bottom + 8 : r.top - 8 - alto}px`;
    tip.style.left = `${left}px`;
    tip.style.setProperty('--flecha', `${r.left + r.width / 2 - left}px`);
  }
  function ocultarTip() { if (tipActual) tipActual.classList.remove('activo'); tipActual = null; tip.hidden = true; }
  document.addEventListener('mouseover', (e) => { const b = e.target.closest('.th-info'); if (b && b !== tipActual) mostrarTip(b); });
  document.addEventListener('mouseout', (e) => { const b = e.target.closest('.th-info'); if (b && b === tipActual && !b.contains(e.relatedTarget) && document.activeElement !== b) ocultarTip(); });
  document.addEventListener('focusin', (e) => { const b = e.target.closest('.th-info'); if (b) mostrarTip(b); });
  document.addEventListener('focusout', (e) => { const b = e.target.closest('.th-info'); if (b && b === tipActual) ocultarTip(); });
  // El clic (o toque) muestra la ayuda sin ordenar la tabla; un clic fuera la cierra
  document.addEventListener('click', (e) => { const b = e.target.closest('.th-info'); if (b) { e.stopPropagation(); mostrarTip(b); } else if (tipActual) ocultarTip(); }, true);
  document.addEventListener('scroll', ocultarTip, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ocultarTip(); });

  // ---------- tablas ----------
  function tabla(contenedor, columnas, filas, opts) {
    opts = opts || {};
    const el = typeof contenedor === 'string' ? $(contenedor) : contenedor;
    if (!el) return;
    if (!filas.length) { el.innerHTML = `<p class="vacio-tabla">${esc(opts.vacio || 'Sin datos para los filtros aplicados.')}</p>`; return; }
    const info = opts.info || {};
    // El icono ⓘ va pegado a la última palabra del título para que no quede solo en otra línea cuando el encabezado se parte
    const titulo = (c) => {
      const flecha = opts.ordenable && opts.orden && opts.orden.clave === c.clave ? (opts.orden.asc ? ' ▲' : ' ▼') : '';
      if (!info[c.clave]) return esc(c.titulo) + flecha;
      const palabras = c.titulo.split(' '), ultima = palabras.pop();
      return `${palabras.length ? esc(palabras.join(' ')) + ' ' : ''}<span class="th-fin">${esc(ultima)}${flecha}${iconoInfo(c.titulo, info[c.clave])}</span>`;
    };
    const th = columnas.map(c => `<th class="${c.num ? 'num' : ''} ${opts.ordenable ? 'ordenable' : ''}" ${opts.ordenable ? `data-clave="${esc(c.clave)}"` : ''}>${titulo(c)}</th>`).join('');
    const tr = filas.map(f => `<tr class="${opts.claseFila ? opts.claseFila(f) : ''}" ${opts.href ? `data-href="${esc(opts.href(f))}"` : ''}>${columnas.map(c => `<td class="${c.num ? 'num' : ''}" data-etiqueta="${esc(c.titulo)}">${c.render ? c.render(f) : esc(f[c.clave])}</td>`).join('')}</tr>`).join('');
    el.innerHTML = `<table class="tabla compacta"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
    if (opts.href) $$('tr[data-href]', el).forEach(r => { r.classList.add('fila'); r.addEventListener('click', (ev) => { if (ev.target.closest('a')) return; window.location = r.dataset.href; }); });
    if (opts.ordenable) $$('th.ordenable', el).forEach(h => h.addEventListener('click', () => opts.alOrdenar(h.dataset.clave)));
  }
  const enlaceObra = (f) => `<a href="/obras/${f.obra_id || f.id}" class="enlace-fuerte">${esc(f.cliente)}</a>`;
  const chipDias = (d) => `<span class="chip ${claseDias(d)}">${esc(dias(d))}</span>`;
  const chipEstado = (e) => `<span class="chip ${{ Vendida: 'ok', 'Sin venta': 'gris', Pendiente: 'pronto', Activa: 'ok', Cerrada: 'gris' }[e] || ''}">${esc(e)}</span>`;

  function renderTablas() {
    const t = informe.tablas, k = informe.kpis;
    tabla('#t-alertas', [
      { titulo: 'Cliente', clave: 'cliente', render: (f) => `${enlaceObra(f)}<small>${esc(f.celular)}</small>` },
      { titulo: 'Obra', clave: 'obra' }, { titulo: 'Línea', clave: 'linea' }, { titulo: 'Etapa', clave: 'etapa' },
      { titulo: 'Fecha etapa', clave: 'fecha', render: (f) => esc(fecha(f.fecha)) },
      { titulo: 'Aviso', clave: 'fecha_aviso', render: (f) => `${esc(fecha(f.fecha_aviso))} ${chipDias(f.dias)}` },
    ], t.alertas, { vacio: 'No hay avisos vencidos ni próximos en 7 días.', href: (f) => `/obras/${f.obra_id}`, claseFila: (f) => f.estado, info: INFO.alertas });

    tabla('#t-lineas', [
      { titulo: 'Línea', clave: 'linea', render: (f) => `<b>${esc(f.linea)}</b><small>${esc(f.correo)}</small>` },
      { titulo: 'Obras', clave: 'obras', num: true, render: (f) => `${num(f.obras)}<small>${num(f.activas)} activas</small>` },
      { titulo: 'Etapas', clave: 'etapas', num: true }, { titulo: 'Vendidas', clave: 'vendidas', num: true }, { titulo: 'Sin venta', clave: 'sin_venta', num: true },
      { titulo: 'Pendientes', clave: 'pendientes', num: true }, { titulo: 'Conversión', clave: 'conversion', num: true, render: (f) => `<b>${pct(f.conversion)}</b>` },
      { titulo: 'Checks', clave: 'ventas', num: true },
      { titulo: 'Avisos', clave: 'avisos_vencidos', num: true, render: (f) => `${f.avisos_vencidos ? `<span class="chip vencido">${num(f.avisos_vencidos)} vencidos</span>` : ''} ${f.avisos_7d ? `<span class="chip pronto">${num(f.avisos_7d)} en 7 d</span>` : ''}${!f.avisos_vencidos && !f.avisos_7d ? '—' : ''}` },
    ], t.porLinea, { info: INFO.lineas });

    tabla('#t-etapas', [
      { titulo: 'Etapa', clave: 'etapa' }, { titulo: 'Etapas', clave: 'etapas', num: true }, { titulo: 'Vendidas', clave: 'vendidas', num: true },
      { titulo: 'Sin venta', clave: 'sin_venta', num: true }, { titulo: 'Pendientes', clave: 'pendientes', num: true },
      { titulo: 'Conversión', clave: 'conversion', num: true, render: (f) => `<span class="medida"><span class="barra-mini"><div style="width:${Math.min(100, f.conversion)}%"></div></span><b>${pct(f.conversion)}</b></span>` },
    ], t.porEtapa, { info: INFO.etapas });

    const codigos = informe.catalogos.codigos;
    tabla('#t-productos', [
      { titulo: 'Producto', clave: 'producto', render: (f) => `${esc(f.producto)}${f.activa ? '' : ' <span class="chip gris">inactiva</span>'}` },
      { titulo: 'Checks', clave: 'ventas', num: true }, { titulo: 'Obras con venta', clave: 'obras_con_venta', num: true },
      { titulo: 'Participación', clave: 'participacion', num: true, render: (f) => `<span class="medida"><span class="barra-mini"><div style="width:${Math.min(100, f.participacion)}%"></div></span><b>${pct(f.participacion)}</b></span>` },
      { titulo: 'Códigos', clave: 'codigos', render: (f) => codigos.filter(c => f.codigos[c]).map(c => `<span class="chip codigo">${esc(c)} <b>${num(f.codigos[c])}</b></span>`).join(' ') || '—' },
    ], t.porProducto, { info: INFO.productos });

    tabla('#t-clientes', [
      { titulo: 'Cliente', clave: 'cliente', render: (f) => `<b>${esc(f.cliente)}</b><small>${esc(f.celular)} · línea ${esc(f.lineas)}</small>` },
      { titulo: 'Obras', clave: 'obras', num: true, render: (f) => `${num(f.obras)}<small>${num(f.activas)} activas</small>` },
      { titulo: 'Vendidas', clave: 'vendidas', num: true }, { titulo: 'Sin venta', clave: 'sin_venta', num: true },
      { titulo: 'Conversión', clave: 'conversion', num: true, render: (f) => pct(f.conversion) }, { titulo: 'Checks', clave: 'ventas', num: true },
      { titulo: 'Última act.', clave: 'ultima', render: (f) => esc(fecha(f.ultima)) },
    ], t.topClientes, { info: INFO.clientes });

    tabla('#t-meses', [
      { titulo: 'Mes', clave: 'etiqueta' }, { titulo: 'Obras creadas', clave: 'obras_creadas', num: true }, { titulo: 'Cerradas', clave: 'obras_cerradas', num: true },
      { titulo: 'Etapas', clave: 'etapas', num: true }, { titulo: 'Vendidas', clave: 'vendidas', num: true }, { titulo: 'Sin venta', clave: 'sin_venta', num: true },
      { titulo: 'Conversión', clave: 'conversion', num: true, render: (f) => pct(f.conversion) }, { titulo: 'Checks', clave: 'ventas', num: true },
    ], t.porMes, { info: INFO.meses });

    renderObras();
    const total = k.obras;
    $('#resumen-filtros').innerHTML = informe.descripcion_filtros.map(([a, b]) => `<span><b>${esc(a)}:</b> ${esc(b)}</span>`).join(' · ') + ` · <span>${num(total)} obra${total === 1 ? '' : 's'} y ${num(k.etapas)} etapa${k.etapas === 1 ? '' : 's'} en el informe</span>`;
  }

  function renderObras() {
    const q = normalizar($('#buscar-obras-admin').value.trim());
    let filas = informe.tablas.obras.filter(o => !q || normalizar([o.cliente, o.obra, o.celular, o.linea, o.maestro, o.direccion_obra].join(' ')).includes(q));
    const { clave, asc } = ordenObras;
    filas = filas.slice().sort((a, b) => {
      let x = a[clave], y = b[clave];
      if (x == null) x = asc ? Infinity : -Infinity; if (y == null) y = asc ? Infinity : -Infinity;
      if (typeof x === 'string') x = x.toLowerCase(); if (typeof y === 'string') y = y.toLowerCase();
      return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
    });
    $('#conteo-obras-admin').textContent = `${filas.length} de ${informe.tablas.obras.length} obras`;
    tabla('#t-obras', [
      { titulo: 'Cliente', clave: 'cliente', render: (f) => `${enlaceObra(f)}<small>${esc(f.celular)}</small>` },
      { titulo: 'Obra', clave: 'obra', render: (f) => `${esc(f.obra)}<small>${esc(f.direccion_obra || '')}</small>` },
      { titulo: 'Línea', clave: 'linea' },
      { titulo: 'Estado', clave: 'estado', render: (f) => chipEstado(f.estado_nombre) },
      { titulo: 'Avance', clave: 'hechas', num: true, render: (f) => `<div class="avance"><div class="avance-barra" style="width:${f.total_etapas ? Math.round(f.hechas / f.total_etapas * 100) : 0}%"></div></div><small>${num(f.hechas)} de ${num(f.total_etapas)}</small>` },
      { titulo: 'Vendidas', clave: 'vendidas', num: true }, { titulo: 'Sin venta', clave: 'sin_venta', num: true },
      { titulo: 'Conversión', clave: 'conversion', num: true, render: (f) => pct(f.conversion) },
      { titulo: 'Checks', clave: 'ventas', num: true },
      { titulo: 'Próxima etapa', clave: 'proxima_fecha', render: (f) => (f.proxima ? `${esc(f.proxima)}<small>${esc(fecha(f.proxima_fecha))}</small>` : '<span class="muted">—</span>') },
      { titulo: 'Aviso', clave: 'dias_para_aviso', render: (f) => (f.proxima_aviso ? `${chipDias(f.dias_para_aviso)}<small>${esc(fecha(f.proxima_aviso))}</small>` : '—') },
      { titulo: 'Creada', clave: 'creada', render: (f) => esc(fecha(f.creada)) },
      { titulo: 'Actualizada', clave: 'actualizada', render: (f) => esc(fecha(f.actualizada)) },
    ], filas, { info: INFO.obras, href: (f) => `/obras/${f.id}`, ordenable: true, orden: ordenObras, alOrdenar: (c) => { ordenObras = { clave: c, asc: ordenObras.clave === c ? !ordenObras.asc : true }; renderObras(); }, claseFila: (f) => claseDias(f.estado === 'activa' ? f.dias_para_aviso : null) });
  }
  $('#buscar-obras-admin').addEventListener('input', renderObras);

  function render() {
    ocultarTip();
    renderKpis();
    renderGraficas();
    renderTablas();
    $('#btn-export').href = '/admin/export.xlsx' + (informe.query ? '?' + informe.query : '');
  }
  render();
})();
