// Módulo de rutas: búsqueda e importación en la gestión, editor de municipios del formulario de ruta
// y el planificador (chips de clientes + mapa con Leaflet/OpenStreetMap y recorrido por carretera con OSRM).
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const clave = (s) => normalizar(s).replace(/[^a-z0-9]+/g, ' ').trim();
  const num = (v) => Number(v).toLocaleString('es-CO', { maximumFractionDigits: 1 });
  const ICONO = {
    tel: '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M6.5 2.3l2 2.8c.3.5.3 1.1-.1 1.5L7.3 7.8c.8 1.9 2.4 3.6 4.4 4.5l1.2-1.1c.4-.4 1-.5 1.5-.1l2.8 2c.5.3.6 1 .3 1.5l-1 1.5c-.5.7-1.4 1.1-2.2.9C8.5 15.7 4.3 11.5 2.9 5.7c-.2-.8.1-1.7.8-2.2l1.5-1c.4-.4 1-.3 1.3-.2z"/></svg>',
    whatsapp: '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 0 0-6.9 12L2 18l4.1-1.1A8 8 0 1 0 10 2zm4.2 11.1c-.2.5-1 1-1.5 1-.4.1-.9.1-1.5-.1-2.6-1-4.3-3.6-4.4-3.8-.1-.2-1-1.4-1-2.6s.6-1.8.9-2.1c.2-.2.5-.3.6-.3h.5c.2 0 .4 0 .5.4l.7 1.6c.1.2.1.3 0 .5l-.6.7c-.1.1-.2.3-.1.5.2.3.7 1.1 1.4 1.7.9.8 1.7 1.1 2 1.2.2.1.4.1.5-.1l.7-.8c.2-.2.3-.2.5-.1l1.5.7c.2.1.4.2.4.3.1.1.1.6-.1 1.2z"/></svg>',
    sede: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M10 2l8 4v12h-3v-7H5v7H2V6l8-4zm-3 10h6v2H7v-2zm0 3h6v2H7v-2z"/></svg>',
    pin: '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M10 1.5a6 6 0 0 0-6 6c0 4.5 6 11 6 11s6-6.5 6-11a6 6 0 0 0-6-6zm0 8.2a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4z"/></svg>',
    arriba: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10 5l6 6-1.4 1.4L10 7.8l-4.6 4.6L4 11z"/></svg>',
    abajo: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10 15l-6-6 1.4-1.4 4.6 4.6 4.6-4.6L16 9z"/></svg>',
  };

  async function pedir(url, opts) {
    const o = opts || {};
    let r;
    try {
      r = await fetch(url, {
        method: o.method || (o.body !== undefined || o.raw ? 'POST' : 'GET'), credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': o.raw ? 'application/octet-stream' : 'application/json' },
        body: o.raw || (o.body !== undefined ? JSON.stringify(o.body) : undefined),
      });
    } catch (e) { throw new Error('No hay conexión con el servidor. Revisa internet e intenta de nuevo.'); }
    if (r.redirected && /\/login/.test(r.url)) { window.location = '/login'; throw new Error('La sesión expiró.'); }
    let datos = null;
    try { datos = await r.json(); } catch (e) { /* respuesta sin JSON */ }
    if (!r.ok || datos == null) throw new Error((datos && datos.error) || 'No se pudo completar la operación. Intenta de nuevo.');
    return datos;
  }

  // Aviso flotante con el mismo estilo de los mensajes del servidor
  function avisar(msg, error) {
    $$('.toast.dinamico').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast dinamico' + (error ? ' toast-error' : '');
    t.setAttribute('role', error ? 'alert' : 'status');
    t.innerHTML = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="${error ? 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-1 4h2v5H9V6zm0 6h2v2H9v-2z' : 'M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-1 11.4L5.6 10 7 8.6l2 2 4-4L14.4 8 9 13.4z'}"/></svg><span>${esc(msg)}</span><button type="button" class="toast-cerrar" aria-label="Cerrar">×</button>`;
    document.body.appendChild(t);
    const cerrar = () => { t.classList.add('oculto'); setTimeout(() => t.remove(), 300); };
    $('.toast-cerrar', t).addEventListener('click', cerrar);
    setTimeout(cerrar, error ? 8000 : 4000);
  }

  // Celulares colombianos dentro de un texto libre
  function celulares(t) {
    const s = String(t || '').replace(/(3\d{2})[ .](\d{3})[ .]?(\d{4})(?!\d)/g, '$1$2$3').replace(/(3\d{2})[ .](\d{7})(?!\d)/g, '$1$2');
    return [...new Set(s.match(/(^|\D)3\d{9}(?!\d)/g) || [])].map(x => x.replace(/\D/g, ''));
  }
  const fmtTel = (t) => `${t.slice(0, 3)} ${t.slice(3, 6)} ${t.slice(6)}`;

  // ============================================================
  // Gestión de rutas: búsqueda e importación
  // ============================================================
  const buscarRutas = $('#buscar-rutas');
  if (buscarRutas) {
    const filas = $$('#tabla-rutas tbody tr'), conteo = $('#conteo-rutas'), vacio = $('#sin-rutas');
    buscarRutas.addEventListener('input', () => {
      const q = normalizar(buscarRutas.value.trim());
      let visibles = 0;
      filas.forEach(tr => { const ok = !q || normalizar(tr.dataset.buscar).includes(q); tr.hidden = !ok; if (ok) visibles++; });
      conteo.textContent = `${visibles} ruta${visibles === 1 ? '' : 's'}`;
      vacio.hidden = visibles > 0;
    });
  }
  const formImportar = $('#form-importar'), btnImportar = $('#btn-importar');
  if (formImportar) {
    const sincronizar = () => btnImportar && btnImportar.setAttribute('aria-expanded', String(!formImportar.hidden));
    sincronizar();
    if (btnImportar) btnImportar.addEventListener('click', () => { formImportar.hidden = !formImportar.hidden; sincronizar(); if (!formImportar.hidden) $('input[type=file]', formImportar).focus(); });
    formImportar.addEventListener('submit', async (e) => {
      e.preventDefault();
      const archivo = $('input[type=file]', formImportar).files[0], estado = $('#estado-importar'), boton = $('button[type=submit]', formImportar);
      if (!archivo) return;
      boton.disabled = true; estado.classList.remove('error'); estado.textContent = 'Importando, puede tardar unos segundos…';
      try {
        const r = await pedir('/rutas/importar', { raw: await archivo.arrayBuffer() });
        window.location = '/rutas/gestion?msg=' + encodeURIComponent(r.mensaje);
      } catch (err) { estado.textContent = err.message; estado.classList.add('error'); boton.disabled = false; }
    });
  }

  // ============================================================
  // Formulario de ruta: municipios en orden
  // ============================================================
  const formRuta = $('#form-ruta');
  if (formRuta) {
    const ol = $('#paradas-orden'), entrada = $('#parada-nueva'), vacio = $('#paradas-vacio');
    const catalogo = new Map(JSON.parse(($('#municipios-catalogo') || {}).textContent || '[]').map(n => [clave(n), n]));
    let arrastrado = null;
    const mejorar = (li) => {
      const nombre = $('input', li).value;
      li.draggable = true;
      li.innerHTML = `<span class="parada-num"></span><span class="parada-nombre">${esc(nombre)}</span>${catalogo.has(clave(nombre)) ? '' : '<span class="chip gris" title="Se ubicará en el mapa buscándolo por nombre">fuera del catálogo</span>'}
        <span class="parada-botones"><button type="button" class="btn-icono" data-mover="-1" aria-label="Subir ${esc(nombre)}">${ICONO.arriba}</button><button type="button" class="btn-icono" data-mover="1" aria-label="Bajar ${esc(nombre)}">${ICONO.abajo}</button><button type="button" class="btn-icono quitar" data-quitar aria-label="Quitar ${esc(nombre)}">×</button></span>
        <input type="hidden" name="paradas" value="${esc(nombre)}">`;
    };
    const pintar = () => {
      const items = $$('li', ol);
      items.forEach((li, i) => { $('.parada-num', li).textContent = i + 1; $('[data-mover="-1"]', li).disabled = i === 0; $('[data-mover="1"]', li).disabled = i === items.length - 1; });
      vacio.hidden = items.length > 0;
    };
    const agregar = () => {
      const partes = entrada.value.split(/\s*[-–,;]\s*/).map(s => s.trim()).filter(Boolean);
      for (const p of partes) {
        const nombre = catalogo.get(clave(p)) || p;
        const existente = $$('li', ol).find(li => clave($('input', li).value) === clave(nombre));
        if (existente) { existente.classList.add('resaltada'); setTimeout(() => existente.classList.remove('resaltada'), 1400); continue; }
        const li = document.createElement('li');
        li.className = 'parada-item';
        li.innerHTML = `<input type="hidden" name="paradas" value="${esc(nombre)}">`;
        mejorar(li); ol.appendChild(li);
      }
      entrada.value = ''; entrada.focus(); pintar();
    };
    $$('li', ol).forEach(mejorar); pintar();
    $('#parada-agregar').addEventListener('click', agregar);
    entrada.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregar(); } });
    ol.addEventListener('click', (e) => {
      const li = e.target.closest('li'); if (!li) return;
      const mover = e.target.closest('[data-mover]');
      if (mover) { const hacia = Number(mover.dataset.mover); if (hacia < 0 && li.previousElementSibling) ol.insertBefore(li, li.previousElementSibling); if (hacia > 0 && li.nextElementSibling) ol.insertBefore(li.nextElementSibling, li); pintar(); const b = $(`[data-mover="${hacia}"]`, li); (b.disabled ? $(`[data-mover="${-hacia}"]`, li) : b).focus(); }
      if (e.target.closest('[data-quitar]')) { li.remove(); pintar(); entrada.focus(); }
    });
    ol.addEventListener('dragstart', (e) => { arrastrado = e.target.closest('li'); if (!arrastrado) return; arrastrado.classList.add('arrastrando'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); });
    ol.addEventListener('dragend', () => { if (arrastrado) arrastrado.classList.remove('arrastrando'); arrastrado = null; pintar(); });
    ol.addEventListener('dragover', (e) => {
      if (!arrastrado) return;
      e.preventDefault();
      const destino = e.target.closest('li');
      if (!destino || destino === arrastrado) return;
      const caja = destino.getBoundingClientRect();
      ol.insertBefore(arrastrado, e.clientY - caja.top > caja.height / 2 ? destino.nextSibling : destino);
    });
    formRuta.addEventListener('submit', (e) => {
      if (entrada.value.trim()) agregar();
      if (!$$('li', ol).length) { e.preventDefault(); vacio.hidden = false; vacio.classList.add('error'); entrada.focus(); }
    });
  }

  // ============================================================
  // Planificador
  // ============================================================
  if ($('#planificador')) iniciarPlanificador();

  function iniciarPlanificador() {
    const inicial = JSON.parse($('#datos-rutas').textContent);
    const plan = $('#planificador'), sel = $('#sel-ruta'), fechaDespacho = $('#fecha-despacho'), grupos = $('#grupos');
    const filtroTexto = $('#filtro-clientes'), filtroEstado = $('#filtro-estado');
    const dialogo = $('#dialogo-cliente'), contenido = $('#dialogo-contenido');
    const COLOR_ESTADO = { por_contactar: '#8A93A6', no_contesta: '#E67E22', pendiente: '#E6B800', no_necesita: '#C62828', despacho: '#1F8A4C' };
    let datos = null, peticion = 0, fichaKey = null, modoUbicar = null;

    const clientePorKey = (k) => (datos ? datos.clientes.find(c => c.key === k) : null);
    const estadoNombre = (id) => ((datos.estados.find(e => e.id === id) || {}).nombre || id);
    const seleccionadosEn = (i) => datos.clientes.filter(c => c.incluido && c.parada === i).length;
    const quien = (u) => (!u ? '' : u === 'admin' || /^\D/.test(u) ? 'administrador' : 'línea ' + u);
    const cuando = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' }) : '');

    // ---------- mapa ----------
    let mapa = null, capaRecorrido = null, capaParadas = null, capaClientes = null;
    const marcadores = new Map(), cacheRecorridos = new Map();
    if (window.L) {
      mapa = L.map('mapa-ruta', { zoomControl: false }).setView([5.7, -73.1], 9);
      mapa.createPane('recorrido').style.zIndex = 390;
      L.control.zoom({ position: 'bottomright', zoomInTitle: 'Acercar', zoomOutTitle: 'Alejar' }).addTo(mapa);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · recorrido <a href="https://project-osrm.org" target="_blank" rel="noopener">OSRM</a>' }).addTo(mapa);
      capaRecorrido = L.layerGroup().addTo(mapa); capaParadas = L.layerGroup().addTo(mapa); capaClientes = L.layerGroup().addTo(mapa);
      mapa.on('click', (e) => { if (modoUbicar) { const c = modoUbicar; terminarUbicar(); guardarUbicacion(c, e.latlng.lat, e.latlng.lng); } });
      // El contenedor cambia de tamaño con el grid (y al pasar a una columna): Leaflet debe recalcular
      if (window.ResizeObserver) {
        let encuadrado = false;
        new ResizeObserver(() => {
          mapa.invalidateSize({ pan: false });
          if (!encuadrado && datos && $('#mapa-ruta').clientWidth > 0) { encuadrado = true; ajustarVista(); }
        }).observe($('#mapa-ruta'));
      }
    } else {
      $('#mapa-error').hidden = false; $('#mapa-panel').hidden = true;
    }

    const estiloMarcador = (c, resaltado) => ({
      radius: resaltado ? 11 : 7, fillColor: COLOR_ESTADO[c.estado] || '#8A93A6', fillOpacity: 1,
      color: resaltado ? '#FFE600' : (c.ubicacion === 'manual' ? '#092F77' : '#FFFFFF'), weight: resaltado ? 4 : (c.ubicacion === 'manual' ? 2.5 : 2),
    });
    function pintarLeyenda() {
      if (!mapa) return;
      $('#mapa-leyenda').innerHTML = `<div class="fila">${datos.estados.map(e => `<span><span class="punto-estado" style="--estado:${COLOR_ESTADO[e.id]}"></span>${esc(e.nombre)}</span>`).join('')}</div>
        <div class="fila"><span><span class="leyenda-punto manual"></span>Ubicación fijada</span><span><span class="leyenda-punto"></span>Aproximada (centro del municipio)</span></div>`;
    }
    function pintarParadas() {
      capaParadas.clearLayers();
      if (datos.sede) {
        L.marker([datos.sede.lat, datos.sede.lng], { icon: L.divIcon({ className: '', html: `<span class="marcador-sede">${ICONO.sede}</span>`, iconSize: [36, 36], iconAnchor: [18, 18] }), zIndexOffset: 1000, keyboard: false })
          .bindTooltip(`<b>${esc(datos.sede.nombre)}</b><br>${esc(datos.sede.direccion)}`, { direction: 'top', offset: [0, -18] }).addTo(capaParadas);
      }
      datos.paradas.forEach((p, i) => {
        if (p.lat == null) return;
        const n = seleccionadosEn(i);
        L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<span class="marcador-parada ${n ? '' : 'inactiva'}" style="--ruta:${esc(datos.ruta.color)}">${p.orden}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }), zIndexOffset: 500, title: `${p.orden}. ${p.nombre}` })
          .bindTooltip(`<b>${p.orden}. ${esc(p.nombre)}</b><br>${n} cliente${n === 1 ? '' : 's'} seleccionado${n === 1 ? '' : 's'}${p.aproximada ? '<br><i>Ubicación aproximada</i>' : ''}`, { direction: 'top', offset: [0, -16] })
          .on('click', () => enfocarParada(i, false)).addTo(capaParadas);
      });
    }
    function pintarClientesMapa() {
      if (!mapa) return;
      capaClientes.clearLayers(); marcadores.clear();
      for (const c of datos.clientes) {
        if (!c.incluido || c.lat == null) continue;
        const m = L.circleMarker([c.lat, c.lng], estiloMarcador(c, c.key === fichaKey))
          .bindTooltip(`<b>${esc(c.nombre)}</b><br>${esc(estadoNombre(c.estado))}${c.ubicacion === 'municipio' ? '<br><i>Ubicación aproximada</i>' : ''}`, { direction: 'top', offset: [0, -8] })
          .on('click', () => { if (!modoUbicar) abrirFicha(c.key); });
        m.addTo(capaClientes); marcadores.set(c.key, m);
      }
      pintarParadas();
    }
    function resaltarMarcador(key, centrar) {
      if (!mapa) return;
      marcadores.forEach((m, k) => { const c = clientePorKey(k); if (c) m.setStyle(estiloMarcador(c, k === key)); });
      const m = marcadores.get(key);
      if (m) { m.bringToFront(); if (centrar && !mapa.getBounds().pad(-0.15).contains(m.getLatLng())) mapa.panTo(m.getLatLng()); }
    }
    function ajustarVista() {
      if (!mapa) return;
      const pts = [];
      if (datos.sede) pts.push([datos.sede.lat, datos.sede.lng]);
      datos.paradas.forEach(p => { if (p.lat != null) pts.push([p.lat, p.lng]); });
      datos.clientes.forEach(c => { if (c.incluido && c.lat != null) pts.push([c.lat, c.lng]); });
      if (pts.length) mapa.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [30, 90], paddingBottomRight: [30, 60], maxZoom: 14 });
    }

    // Recorrido por carretera: sede → municipios en orden → (sede)
    let temporizadorRecorrido = null, peticionRecorrido = 0;
    const programarRecorrido = (inmediato) => { clearTimeout(temporizadorRecorrido); temporizadorRecorrido = setTimeout(trazarRecorrido, inmediato ? 0 : 500); };
    function puntosRecorrido() {
      const solo = $('#solo-con-clientes').checked, regreso = $('#regreso-sede').checked;
      const pts = [];
      if (datos.sede) pts.push(datos.sede);
      datos.paradas.forEach((p, i) => { if (p.lat != null && (!solo || seleccionadosEn(i) > 0)) pts.push(p); });
      const paradas = pts.length - (datos.sede ? 1 : 0);
      if (datos.sede && regreso && paradas) pts.push(datos.sede);
      return { pts, paradas };
    }
    const duracion = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} h ${m} min` : `${m} min`; };
    async function trazarRecorrido() {
      if (!mapa || !datos) return;
      const { pts, paradas } = puntosRecorrido(), n = ++peticionRecorrido, info = $('#mapa-recorrido');
      actualizarGoogleMaps(pts);
      if (pts.length < 2) {
        capaRecorrido.clearLayers();
        info.innerHTML = datos.paradas.some(p => p.lat != null) ? 'Selecciona clientes para trazar el recorrido.' : 'Los municipios de esta ruta no están ubicados en el mapa.';
        return;
      }
      const coords = pts.map(p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
      let recorrido = cacheRecorridos.get(coords);
      if (!recorrido) {
        info.textContent = 'Calculando recorrido…';
        try {
          const r = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
          const j = await r.json();
          if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error(j.code || 'sin ruta');
          recorrido = { linea: j.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]), km: j.routes[0].distance / 1000, min: j.routes[0].duration / 60 };
          cacheRecorridos.set(coords, recorrido);
        } catch (e) { recorrido = null; }
      }
      if (n !== peticionRecorrido) return;
      capaRecorrido.clearLayers();
      const color = datos.ruta.color, detalle = `${paradas} municipio${paradas === 1 ? '' : 's'}${datos.sede ? ' desde ' + datos.sede.nombre : ''}`;
      if (recorrido) {
        L.polyline(recorrido.linea, { pane: 'recorrido', color: '#FFFFFF', weight: 9, opacity: 0.95, interactive: false }).addTo(capaRecorrido);
        L.polyline(recorrido.linea, { pane: 'recorrido', color, weight: 5, opacity: 0.95, interactive: false }).addTo(capaRecorrido);
        info.innerHTML = `<b>${num(recorrido.km)} km</b> · <b>${duracion(recorrido.min)}</b><small>${esc(detalle)}</small>`;
      } else {
        L.polyline(pts.map(p => [p.lat, p.lng]), { pane: 'recorrido', color, weight: 3, dashArray: '8 8', opacity: 0.85, interactive: false }).addTo(capaRecorrido);
        info.innerHTML = `<b>Recorrido aproximado</b><small>No se pudo calcular por carretera; se muestran líneas rectas.</small>`;
      }
    }
    function actualizarGoogleMaps(pts) {
      const a = $('#abrir-gmaps');
      if (pts.length < 2) { a.hidden = true; return; }
      const ll = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
      const intermedios = pts.slice(1, -1);
      a.href = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${ll(pts[0])}&destination=${ll(pts[pts.length - 1])}${intermedios.length ? '&waypoints=' + encodeURIComponent(intermedios.slice(0, 9).map(ll).join('|')) : ''}`;
      a.title = intermedios.length > 9 ? 'Google Maps acepta hasta 9 paradas intermedias: se abren las primeras 9.' : 'Abre el recorrido en Google Maps para navegar';
      a.hidden = false;
    }
    $('#solo-con-clientes').addEventListener('change', () => programarRecorrido(true));
    $('#regreso-sede').addEventListener('change', () => programarRecorrido(true));

    // ---------- carga de la ruta ----------
    async function cargar(id, opciones) {
      const o = opciones || {}, n = ++peticion;
      plan.classList.add('cargando'); grupos.setAttribute('aria-busy', 'true');
      try {
        const d = await pedir('/rutas/api/' + id);
        if (n !== peticion) return;
        datos = d;
        try { localStorage.setItem('ferreobras.ruta', String(id)); } catch (e) { /* sin almacenamiento */ }
        if (window.history && history.replaceState) history.replaceState(null, '', '/rutas?ruta=' + id);
        pintarInfo(); pintarResumen(); pintarGrupos(); pintarLeyenda();
        if (mapa) { pintarClientesMapa(); programarRecorrido(true); if (!o.mantenerVista) ajustarVista(); }
        if (o.abrir) abrirFicha(o.abrir);
      } catch (e) {
        if (n !== peticion) return;
        grupos.innerHTML = `<p class="vacio-tabla">${esc(e.message)}</p>`;
        avisar(e.message, true);
      } finally {
        if (n === peticion) { plan.classList.remove('cargando'); grupos.removeAttribute('aria-busy'); }
      }
    }
    function refrescar() { pintarResumen(); pintarGrupos(); if (mapa) { pintarClientesMapa(); programarRecorrido(); } }

    function pintarInfo() {
      const r = datos.ruta;
      fechaDespacho.value = r.proximo_despacho || '';
      $('#ruta-info').innerHTML = [
        `<span class="dato"><span class="ruta-color" style="background:${esc(r.color)}"></span><b>${esc(r.nombre)}</b>${r.activa ? '' : ' <span class="chip">Inactiva</span>'}</span>`,
        `<span class="dato">${ICONO.sede}${datos.sede ? 'Sale de ' + esc(datos.sede.nombre) : 'Sin sede de salida'}</span>`,
        r.frecuencia || r.dias ? `<span class="dato">${esc([r.frecuencia, r.dias].filter(Boolean).join(' · '))}</span>` : '',
        `<span class="dato">${ICONO.pin}${datos.paradas.length} municipio${datos.paradas.length === 1 ? '' : 's'}</span>`,
        `<a class="enlace-fuerte" href="/rutas/${r.id}/editar">Editar ruta</a>`,
      ].join('');
      $('#btn-exportar').href = `/rutas/${r.id}/export.xlsx`;
    }
    function pintarResumen() {
      const inc = datos.clientes.filter(c => c.incluido), fe = filtroEstado.value;
      const peso = inc.filter(c => c.estado === 'despacho').reduce((n, c) => n + (c.peso || 0), 0);
      $('#plan-resumen').innerHTML = `<span class="chip-kpi"><b>${inc.length}</b> de ${datos.clientes.length} seleccionado${inc.length === 1 ? '' : 's'}</span>` +
        datos.estados.map(e => {
          const n = inc.filter(c => c.estado === e.id).length;
          if (!n && fe !== e.id && e.id !== 'despacho') return '';
          return `<button type="button" class="chip-kpi chip-estado ${fe === e.id ? 'activo' : ''}" data-estado="${e.id}" aria-pressed="${fe === e.id}" title="Filtrar por ${esc(e.nombre.toLowerCase())}"><span class="punto-estado" style="--estado:${COLOR_ESTADO[e.id]}"></span><b>${n}</b> ${esc(e.nombre.toLowerCase())}</button>`;
        }).join('') +
        (peso ? `<span class="chip-kpi ok"><b>${num(peso)}</b> kg confirmados</span>` : '');
    }
    function chip(c) {
      const accion = c.incluido ? 'quitar' : 'agregar';
      return `<span class="chip-cliente ${c.incluido ? '' : 'excluido'} ${c.key === fichaKey ? 'resaltado' : ''}" data-key="${c.key}" style="--estado:${COLOR_ESTADO[c.estado]}">` +
        `<button type="button" class="chip-cliente-abrir" data-abrir title="${esc(`${c.nombre} · ${estadoNombre(c.estado)}${c.telefonos ? ' · ' + c.telefonos : ''}`)}"><span class="punto-estado"></span>${c.tipo === 'o' ? '<span class="chip-tag">Obra</span>' : ''}<span class="chip-cliente-nombre">${esc(c.nombre)}</span>${c.estado === 'despacho' && c.peso ? `<span class="chip-peso">${num(c.peso)} kg</span>` : ''}</button>` +
        `<button type="button" class="chip-cliente-accion" data-${accion} aria-label="${c.incluido ? 'Quitar' : 'Agregar'} ${esc(c.nombre)} ${c.incluido ? 'de' : 'a'} la ruta" title="${c.incluido ? 'Quitar de la ruta' : 'Agregar a la ruta'}">${c.incluido ? '×' : '+'}</button></span>`;
    }
    function pintarGrupos() {
      const foco = document.activeElement && grupos.contains(document.activeElement) ? document.activeElement.closest('[data-key]') : null;
      const focoKey = foco && foco.dataset.key, focoAbrir = foco && document.activeElement.hasAttribute('data-abrir');
      const q = normalizar(filtroTexto.value.trim()), digitos = filtroTexto.value.replace(/\D/g, ''), fe = filtroEstado.value;
      const coincide = (c) => (!q || normalizar(`${c.nombre} ${c.razon_social || ''} ${c.obra || ''} ${c.direccion} ${c.sector || ''}`).includes(q) || (digitos.length >= 3 && c.telefonos.replace(/\D/g, '').includes(digitos))) && (!fe || c.estado === fe);
      if (!datos.clientes.length) {
        grupos.innerHTML = '<p class="vacio-tabla">No hay clientes registrados en los municipios de esta ruta. Crea uno con <b>Nuevo cliente</b> o importa la agenda desde <a href="/rutas/gestion">Gestión de rutas</a>.</p>';
        return;
      }
      const secciones = datos.paradas.map((p, i) => ({ i, titulo: p.nombre, num: p.orden, parada: p, clientes: datos.clientes.filter(c => c.parada === i) }));
      const fuera = datos.clientes.filter(c => c.parada == null);
      if (fuera.length) secciones.push({ i: null, titulo: 'Agregados de otros municipios', num: '+', clientes: fuera, fuera: true });
      const html = secciones.map(s => {
        const lista = s.clientes.filter(coincide);
        if ((q || fe) && !lista.length) return '';
        const inc = lista.filter(c => c.incluido), exc = lista.filter(c => !c.incluido), totalInc = s.clientes.filter(c => c.incluido).length;
        return `<section class="parada-grupo ${s.fuera ? 'fuera' : ''} ${s.clientes.length ? '' : 'vacia'}" ${s.i != null ? `data-parada="${s.i}"` : ''}>
          <header class="parada-cab">
            <button type="button" class="parada-num" ${s.i != null && s.parada.lat != null ? `data-enfocar="${s.i}" title="Ver ${esc(s.titulo)} en el mapa"` : 'tabindex="-1"'}>${s.num}</button>
            <h3>${esc(s.titulo)}${s.fuera ? '' : ` <span class="parada-meta">${s.clientes.length ? `${totalInc} de ${s.clientes.length}` : 'sin clientes registrados'}</span>`}</h3>
            ${s.clientes.length > 1 && !s.fuera && !q && !fe ? `<button type="button" class="btn chico link-suave" data-masivo="${totalInc ? '0' : '1'}">${totalInc ? 'Quitar todos' : 'Agregar todos'}</button>` : ''}
          </header>
          ${inc.length ? `<div class="chips-clientes">${inc.map(chip).join('')}</div>` : ''}
          ${exc.length ? `<div class="chips-clientes disponibles"><span class="disponibles-titulo">No incluidos</span>${exc.map(chip).join('')}</div>` : ''}
          ${s.parada && s.parada.lat == null ? '<p class="parada-aviso">Este municipio no se encontró en el mapa; sus clientes se pueden ubicar a mano desde la ficha.</p>' : ''}
        </section>`;
      }).join('');
      grupos.innerHTML = html || '<p class="vacio-tabla">Ningún cliente coincide con el filtro.</p>';
      if (focoKey) {
        const destino = $(`[data-key="${focoKey}"] ${focoAbrir ? '[data-abrir]' : '.chip-cliente-accion'}`, grupos) || $(`[data-key="${focoKey}"] [data-abrir]`, grupos);
        if (destino) destino.focus();
      }
    }
    function enfocarParada(i, mover) {
      const s = $(`.parada-grupo[data-parada="${i}"]`, grupos), p = datos.paradas[i];
      if (mover !== false && mapa && p && p.lat != null) mapa.flyTo([p.lat, p.lng], Math.max(mapa.getZoom(), 14), { duration: 0.6 });
      if (s && mover === false) { s.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      if (s) { s.classList.add('resaltada'); setTimeout(() => s.classList.remove('resaltada'), 1600); }
    }

    // ---------- selección de clientes ----------
    async function cambiarIncluido(c, incluido) {
      const antes = c.incluido;
      c.incluido = incluido; refrescar();
      try {
        await pedir(`/rutas/api/${datos.ruta.id}/plan`, { body: { tipo: c.tipo, id: c.id, incluido } });
        if (!incluido && c.parada == null) { datos.clientes = datos.clientes.filter(x => x !== c); refrescar(); if (fichaKey === c.key) dialogo.close(); }
      } catch (e) { c.incluido = antes; refrescar(); avisar(e.message, true); }
    }
    async function cambiarGrupo(i, incluido) {
      const lista = datos.clientes.filter(c => c.parada === i && c.incluido !== incluido);
      if (!lista.length) return;
      lista.forEach(c => { c.incluido = incluido; }); refrescar();
      try { await pedir(`/rutas/api/${datos.ruta.id}/plan/masivo`, { body: { incluido, items: lista.map(c => ({ tipo: c.tipo, id: c.id })) } }); }
      catch (e) { lista.forEach(c => { c.incluido = !incluido; }); refrescar(); avisar(e.message, true); }
    }
    grupos.addEventListener('click', (e) => {
      const envoltura = e.target.closest('[data-key]'), c = envoltura && clientePorKey(envoltura.dataset.key);
      if (c && e.target.closest('[data-quitar]')) return cambiarIncluido(c, false);
      if (c && e.target.closest('[data-agregar]')) return cambiarIncluido(c, true);
      if (c && e.target.closest('[data-abrir]')) { abrirFicha(c.key); resaltarMarcador(c.key, true); return; }
      const enfocar = e.target.closest('[data-enfocar]');
      if (enfocar) return enfocarParada(Number(enfocar.dataset.enfocar));
      const masivo = e.target.closest('[data-masivo]');
      if (masivo) return cambiarGrupo(Number(masivo.closest('.parada-grupo').dataset.parada), masivo.dataset.masivo === '1');
    });
    grupos.addEventListener('mouseover', (e) => { const k = e.target.closest('[data-key]'); if (k && !fichaKey) resaltarMarcador(k.dataset.key); });
    grupos.addEventListener('mouseleave', () => { if (!fichaKey) resaltarMarcador(null); });

    // ---------- filtros, fecha y reinicio ----------
    filtroTexto.addEventListener('input', pintarGrupos);
    filtroEstado.addEventListener('change', () => { pintarResumen(); pintarGrupos(); });
    $('#plan-resumen').addEventListener('click', (e) => {
      const b = e.target.closest('[data-estado]'); if (!b) return;
      filtroEstado.value = filtroEstado.value === b.dataset.estado ? '' : b.dataset.estado;
      pintarResumen(); pintarGrupos();
    });
    fechaDespacho.addEventListener('change', async () => {
      try { await pedir(`/rutas/api/${datos.ruta.id}/despacho`, { body: { fecha: fechaDespacho.value } }); datos.ruta.proximo_despacho = fechaDespacho.value || null; avisar(fechaDespacho.value ? 'Fecha de despacho guardada' : 'Fecha de despacho borrada'); }
      catch (e) { avisar(e.message, true); }
    });
    $('#btn-reiniciar').addEventListener('click', async () => {
      if (!datos || !confirm(`¿Reiniciar la planificación de ${datos.ruta.nombre}? Se vuelven a incluir todos los clientes de sus municipios y se borran estados, pesos y observaciones.`)) return;
      try { await pedir(`/rutas/api/${datos.ruta.id}/reiniciar`, { body: {} }); filtroEstado.value = ''; await cargar(datos.ruta.id, { mantenerVista: true }); avisar('Planificación reiniciada'); }
      catch (e) { avisar(e.message, true); }
    });
    sel.addEventListener('change', () => { if (dialogo.open) dialogo.close(); terminarUbicar(); filtroTexto.value = ''; filtroEstado.value = ''; cargar(sel.value); });

    // ---------- agregar clientes de otros municipios ----------
    const entradaAgregar = $('#buscar-agregar'), sugerencias = $('#sugerencias');
    let temporizadorBusqueda = null, busqueda = 0, resultados = new Map();
    const cerrarSugerencias = () => { sugerencias.hidden = true; entradaAgregar.setAttribute('aria-expanded', 'false'); };
    entradaAgregar.addEventListener('input', () => { clearTimeout(temporizadorBusqueda); temporizadorBusqueda = setTimeout(buscarParaAgregar, 250); });
    entradaAgregar.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !sugerencias.hidden) { e.preventDefault(); const b = $('button:not(:disabled)', sugerencias); if (b) b.focus(); }
      if (e.key === 'Escape') cerrarSugerencias();
    });
    sugerencias.addEventListener('keydown', (e) => {
      const botones = $$('button:not(:disabled)', sugerencias), i = botones.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' && i < botones.length - 1) { e.preventDefault(); botones[i + 1].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? botones[i - 1] : entradaAgregar).focus(); }
      if (e.key === 'Escape') { cerrarSugerencias(); entradaAgregar.focus(); }
    });
    async function buscarParaAgregar() {
      const q = entradaAgregar.value.trim(), n = ++busqueda;
      if (q.length < 2 || !datos) return cerrarSugerencias();
      try {
        const lista = await pedir('/rutas/api/clientes?q=' + encodeURIComponent(q));
        if (n !== busqueda) return;
        resultados = new Map(lista.map(c => [c.key, c]));
        sugerencias.innerHTML = lista.length ? lista.map(c => {
          const ya = clientePorKey(c.key), dentro = ya && ya.incluido;
          return `<li role="option" aria-disabled="${!!dentro}"><button type="button" data-sugerencia="${c.key}" ${dentro ? 'disabled' : ''}><b>${esc(c.nombre)}</b>${c.tipo === 'o' ? ' <span class="chip-tag">Obra</span>' : ''}<small>${esc(c.municipio || 'Sin municipio')}${c.telefonos ? ' · ' + esc(c.telefonos) : ''}${dentro ? ' · ya está en la ruta' : ''}</small></button></li>`;
        }).join('') : '<li class="sugerencia-vacia">Sin resultados. Puedes registrarlo con “Nuevo cliente”.</li>';
        sugerencias.hidden = false; entradaAgregar.setAttribute('aria-expanded', 'true');
      } catch (e) { avisar(e.message, true); }
    }
    sugerencias.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-sugerencia]'); if (!b) return;
      const c = resultados.get(b.dataset.sugerencia);
      cerrarSugerencias(); entradaAgregar.value = '';
      const existente = clientePorKey(c.key);
      if (existente) { await cambiarIncluido(existente, true); avisar(`${c.nombre} quedó incluido en la ruta`); return; }
      try { await pedir(`/rutas/api/${datos.ruta.id}/plan`, { body: { tipo: c.tipo, id: c.id, incluido: true } }); await cargar(datos.ruta.id, { mantenerVista: true }); avisar(`${c.nombre} se agregó a la ruta`); }
      catch (err) { avisar(err.message, true); }
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.agregar-busqueda')) cerrarSugerencias(); });
    $('#btn-nuevo-cliente').addEventListener('click', () => { if (datos) abrirFormulario(null); });

    // ---------- ficha del cliente ----------
    const dato = (etiqueta, valor) => (valor ? `<dt>${etiqueta}</dt><dd>${esc(valor)}</dd>` : '');
    function abrirFicha(key) {
      const c = clientePorKey(key);
      if (!c) return;
      fichaKey = key;
      const tels = celulares(c.telefonos);
      const ubicacion = c.ubicacion === 'manual' ? 'Fijada en el mapa' : c.ubicacion === 'municipio' ? `Aproximada (centro de ${c.municipio})` : 'Sin ubicación en el mapa';
      contenido.innerHTML = `
        <div class="ficha-cab" style="--estado:${COLOR_ESTADO[c.estado]}">
          <span class="ficha-tipo ${c.tipo === 'o' ? 'obra' : ''}">${c.tipo === 'o' ? 'Cliente de obra' : 'Ferretería'}</span>
          <h2 id="dialogo-titulo">${esc(c.nombre)}</h2>
          <p class="sub">${esc(c.municipio || 'Sin municipio')} · ${c.en_ruta ? `parada ${c.parada + 1} de ${esc(datos.ruta.nombre)}` : 'agregado fuera de la ruta'}${c.incluido ? '' : ' · <b>no incluido</b>'}</p>
          <button type="button" class="dialogo-cerrar" data-cerrar aria-label="Cerrar ficha">×</button>
        </div>
        <div class="ficha-cuerpo">
          ${tels.length ? `<div class="ficha-contacto">${tels.map(t => `<a class="btn chico" href="tel:+57${t}">${ICONO.tel}${fmtTel(t)}</a><a class="btn chico whatsapp" href="https://wa.me/57${t}" target="_blank" rel="noopener" aria-label="WhatsApp ${fmtTel(t)}">${ICONO.whatsapp}WhatsApp</a>`).join('')}</div>` : ''}
          <dl class="ficha-datos">
            ${dato('Teléfonos', c.telefonos || 'Sin teléfono')}
            ${c.tipo === 'o' ? dato('Obra', c.obra) : ''}
            ${dato('Dirección', c.direccion)}${dato('Sector', c.sector)}
            ${c.tipo === 'o' ? dato('Dirección del cliente', c.direccion_cliente !== c.direccion ? c.direccion_cliente : '') + dato('Maestro', [c.maestro, c.celular_maestro].filter(Boolean).join(' · ')) + dato('Línea WhatsApp', c.linea) : ''}
            ${dato('NIT o cédula', c.nit)}${dato('Razón social', c.razon_social)}${dato('Tipología', c.tipologia)}${dato('Volumen de compra', c.volumen_compra)}
            ${dato('Notas', c.notas)}${dato('Ubicación', ubicacion)}
          </dl>
          <form class="ficha-plan" id="ficha-plan" style="--estado:${COLOR_ESTADO[c.estado]}">
            <h3 class="tarjeta-titulo">Contacto para este despacho</h3>
            <div class="ficha-plan-campos">
              <label>Resultado <select name="estado">${datos.estados.map(e => `<option value="${e.id}" ${c.estado === e.id ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select></label>
              <label class="campo-peso" ${c.estado === 'despacho' ? '' : 'hidden'}>Peso (kg) <input type="number" name="peso" min="0" step="0.1" inputmode="decimal" value="${c.peso != null ? c.peso : ''}"></label>
              <label class="ancho-total">Observación <input name="observacion" maxlength="500" value="${esc(c.observacion)}" placeholder="Ej. llamar después de las 2 p. m."></label>
            </div>
            <p class="ficha-guardado" aria-live="polite">${c.actualizado_por ? `Actualizado por ${esc(quien(c.actualizado_por))} · ${esc(cuando(c.actualizado))}` : ''}</p>
          </form>
          <div class="ficha-acciones">
            <button type="button" class="btn ${c.incluido ? 'peligro' : 'primario'}" data-ficha="incluir">${c.incluido ? 'Quitar de la ruta' : 'Agregar a la ruta'}</button>
            <button type="button" class="btn" data-ficha="ubicar">${ICONO.pin}Ubicar en el mapa</button>
            ${c.direccion ? '<button type="button" class="btn" data-ficha="direccion">Buscar dirección</button>' : ''}
            ${c.tipo === 'c' ? '<button type="button" class="btn" data-ficha="editar">Editar datos</button>' : `<a class="btn" href="/obras/${c.id}">Ver obra</a>`}
            ${c.ubicacion === 'manual' ? '<button type="button" class="btn link" data-ficha="aproximada">Volver a ubicación aproximada</button>' : ''}
          </div>
        </div>`;
      mostrarDialogo();
      $$('.chip-cliente.resaltado', grupos).forEach(x => x.classList.remove('resaltado'));
      const ch = $(`[data-key="${key}"]`, grupos); if (ch) ch.classList.add('resaltado');
      resaltarMarcador(key);
    }
    function mostrarDialogo() {
      if (dialogo.open) return;
      if (typeof dialogo.showModal === 'function') dialogo.showModal(); else dialogo.setAttribute('open', '');
    }
    async function guardarCampo(c, campo, valor) {
      const aviso = $('.ficha-guardado', contenido);
      if (aviso) aviso.textContent = 'Guardando…';
      try {
        const fila = await pedir(`/rutas/api/${datos.ruta.id}/plan`, { body: { tipo: c.tipo, id: c.id, [campo]: valor } });
        Object.assign(c, { estado: fila.estado, incluido: fila.incluido, peso: fila.peso != null ? Number(fila.peso) : null, observacion: fila.observacion || '', actualizado_por: fila.actualizado_por, actualizado: fila.updated_at });
        if (aviso && aviso.isConnected) aviso.textContent = `Guardado · ${quien(c.actualizado_por)} · ${cuando(c.actualizado)}`;
        refrescar();
      } catch (e) { if (aviso && aviso.isConnected) aviso.textContent = e.message; else avisar(e.message, true); }
    }
    contenido.addEventListener('change', (e) => {
      const form = e.target.closest('#ficha-plan'), c = clientePorKey(fichaKey);
      if (!form || !c || !e.target.name) return;
      if (e.target.name === 'estado') {
        $('.campo-peso', form).hidden = e.target.value !== 'despacho';
        form.style.setProperty('--estado', COLOR_ESTADO[e.target.value]);
        if (e.target.value === 'despacho') $('input[name=peso]', form).focus();
      }
      guardarCampo(c, e.target.name, e.target.value);
    });
    contenido.addEventListener('submit', (e) => { if (e.target.id === 'ficha-plan') e.preventDefault(); });
    contenido.addEventListener('click', async (e) => {
      if (e.target.closest('[data-cerrar]')) return dialogo.close();
      const b = e.target.closest('[data-ficha]'); if (!b) return;
      const c = clientePorKey(fichaKey), accion = b.dataset.ficha;
      if (accion === 'cancelar') return c ? abrirFicha(c.key) : dialogo.close();
      if (accion === 'eliminar') return eliminarCliente(Number(b.dataset.id));
      if (!c) return;
      if (accion === 'incluir') { await cambiarIncluido(c, !c.incluido); if (clientePorKey(c.key)) abrirFicha(c.key); }
      if (accion === 'ubicar') iniciarUbicar(c);
      if (accion === 'direccion') buscarDireccion(c, b);
      if (accion === 'editar') abrirFormulario(c);
      if (accion === 'aproximada') guardarUbicacion(c, null, null);
    });
    dialogo.addEventListener('click', (e) => { if (e.target === dialogo) dialogo.close(); });
    // Escape cierra la ficha también donde el navegador no lo hace solo (sin showModal)
    dialogo.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dialogo.open) { e.preventDefault(); dialogo.close(); } });
    dialogo.addEventListener('close', () => {
      // guarda lo que quedó escrito sin salir del campo
      const form = $('#ficha-plan', contenido), c = clientePorKey(fichaKey);
      if (form && c) {
        const obs = $('input[name=observacion]', form).value.trim(), peso = $('input[name=peso]', form).value;
        if (obs !== (c.observacion || '')) guardarCampo(c, 'observacion', obs);
        if (!$('.campo-peso', form).hidden && String(peso) !== String(c.peso != null ? c.peso : '')) guardarCampo(c, 'peso', peso);
      }
      fichaKey = null;
      $$('.chip-cliente.resaltado', grupos).forEach(x => x.classList.remove('resaltado'));
      resaltarMarcador(null);
    });

    // ---------- crear, editar y eliminar ferreterías ----------
    function abrirFormulario(c) {
      fichaKey = c ? c.key : null;
      const v = (k) => esc(c ? c[k] || '' : '');
      const municipio = c ? c.municipio : (datos.paradas[0] ? datos.paradas[0].nombre : '');
      contenido.innerHTML = `
        <div class="ficha-cab">
          <span class="ficha-tipo">Ferretería</span>
          <h2 id="dialogo-titulo">${c ? 'Editar cliente' : 'Nuevo cliente'}</h2>
          <p class="sub">${c ? esc(c.nombre) : 'Si su municipio está en la ruta aparece en ella; si no, se agrega a esta planificación.'}</p>
          <button type="button" class="dialogo-cerrar" data-cerrar aria-label="Cerrar">×</button>
        </div>
        <form class="ficha-form" id="form-cliente" novalidate>
          <label class="ancho-total">Nombre <input name="nombre" required maxlength="160" value="${v('nombre')}"></label>
          <label>Municipio <input name="municipio" list="lista-municipios" required maxlength="160" value="${esc(municipio)}" autocomplete="off"></label>
          <label>Sector o barrio <input name="sector" maxlength="160" value="${v('sector')}"></label>
          <label class="ancho-total">Dirección <input name="direccion" maxlength="300" value="${v('direccion')}"></label>
          <label class="ancho-total">Teléfonos <input name="telefonos" maxlength="300" value="${v('telefonos')}" placeholder="3001234567 · Gloria 3134153102"></label>
          <label>NIT o cédula <input name="nit" maxlength="160" value="${v('nit')}"></label>
          <label>Razón social <input name="razon_social" maxlength="160" value="${v('razon_social')}"></label>
          <label>Tipología <input name="tipologia" maxlength="160" value="${v('tipologia')}" placeholder="Cliente frecuente"></label>
          <label>Volumen de compra <input name="volumen_compra" maxlength="160" value="${v('volumen_compra')}"></label>
          <label class="ancho-total">Notas <textarea name="notas" rows="2">${v('notas')}</textarea></label>
          <p class="error" role="alert" hidden></p>
          <div class="ficha-acciones">
            <button type="submit" class="btn primario">${c ? 'Guardar cambios' : 'Crear cliente'}</button>
            <button type="button" class="btn" data-ficha="cancelar">Cancelar</button>
            ${c ? `<button type="button" class="btn link" data-ficha="eliminar" data-id="${c.id}">Eliminar cliente</button>` : ''}
          </div>
        </form>`;
      mostrarDialogo();
      $('input[name=nombre]', contenido).focus();
    }
    contenido.addEventListener('submit', async (e) => {
      if (e.target.id !== 'form-cliente') return;
      e.preventDefault();
      const form = e.target, error = $('.error', form), boton = $('button[type=submit]', form);
      const body = Object.fromEntries(new FormData(form).entries());
      if (!body.nombre.trim() || !body.municipio.trim()) { error.textContent = 'El nombre y el municipio son obligatorios.'; error.hidden = false; return; }
      const c = clientePorKey(fichaKey);
      boton.disabled = true;
      try {
        const guardado = await pedir(c ? `/rutas/api/clientes/${c.id}` : '/rutas/api/clientes', { body });
        const enRuta = datos.paradas.some(p => clave(p.nombre) === clave(guardado.municipio));
        if (!c && !enRuta) await pedir(`/rutas/api/${datos.ruta.id}/plan`, { body: { tipo: 'c', id: guardado.id, incluido: true } });
        dialogo.close();
        await cargar(datos.ruta.id, { mantenerVista: true, abrir: c || enRuta || !c ? guardado.key : null });
        avisar(c ? 'Datos del cliente guardados' : `${guardado.nombre} se creó${enRuta ? '' : ' y se agregó a esta ruta'}`);
      } catch (err) { error.textContent = err.message; error.hidden = false; boton.disabled = false; }
    });
    async function eliminarCliente(id) {
      const c = clientePorKey(`c${id}`);
      if (!c || !confirm(`¿Eliminar a ${c.nombre} del directorio de clientes? Se quita de todas las rutas.`)) return;
      try { await pedir(`/rutas/api/clientes/${id}/eliminar`, { body: {} }); dialogo.close(); await cargar(datos.ruta.id, { mantenerVista: true }); avisar('Cliente eliminado'); }
      catch (e) { avisar(e.message, true); }
    }

    // ---------- ubicación en el mapa ----------
    function iniciarUbicar(c) {
      if (!mapa) return avisar('El mapa no está disponible en este momento.', true);
      dialogo.close();
      modoUbicar = c;
      $('#mapa-modo-texto').textContent = `Haz clic en el mapa donde queda ${c.nombre}`;
      $('#mapa-modo').hidden = false;
      $('#mapa-ruta').classList.add('ubicando');
      const m = marcadores.get(c.key);
      if (m) mapa.flyTo(m.getLatLng(), Math.max(mapa.getZoom(), 16), { duration: 0.6 });
      $('.plan-mapa').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    function terminarUbicar() {
      modoUbicar = null;
      $('#mapa-modo').hidden = true;
      $('#mapa-ruta').classList.remove('ubicando');
    }
    $('#mapa-modo-cancelar').addEventListener('click', terminarUbicar);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modoUbicar) terminarUbicar(); });
    async function guardarUbicacion(c, lat, lng) {
      try {
        await pedir('/rutas/api/ubicacion', { body: { tipo: c.tipo, id: c.id, lat, lng } });
        if (lat == null) { dialogo.close(); await cargar(datos.ruta.id, { mantenerVista: true }); avisar('Se usará la ubicación aproximada del municipio'); return; }
        Object.assign(c, { lat, lng, ubicacion: 'manual' });
        if (!c.incluido) await cambiarIncluido(c, true); else pintarClientesMapa();
        resaltarMarcador(c.key);
        avisar(`Ubicación de ${c.nombre} guardada`);
      } catch (e) { avisar(e.message, true); }
    }
    async function buscarDireccion(c, boton) {
      boton.disabled = true; boton.textContent = 'Buscando…';
      try {
        const r = await pedir(`/rutas/api/geocodificar?tipo=${c.tipo}&id=${c.id}`);
        dialogo.close();
        if (!mapa) return;
        const temporal = L.marker([r.lat, r.lng], { icon: L.divIcon({ className: '', html: '<span class="marcador-propuesto"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: 2000 }).addTo(mapa);
        const caja = document.createElement('div');
        caja.innerHTML = `<b>${esc(c.nombre)}</b><small class="popup-texto">${esc(r.descripcion)}</small><div class="popup-acciones"><button type="button" class="btn chico primario" data-si>Guardar aquí</button><button type="button" class="btn chico" data-no>Descartar</button></div>`;
        $('[data-si]', caja).addEventListener('click', () => { mapa.removeLayer(temporal); guardarUbicacion(c, r.lat, r.lng); });
        $('[data-no]', caja).addEventListener('click', () => mapa.removeLayer(temporal));
        temporal.bindPopup(caja, { closeButton: false, autoClose: false, closeOnClick: false, offset: [0, -8] }).openPopup();
        mapa.flyTo([r.lat, r.lng], 16, { duration: 0.6 });
        $('.plan-mapa').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) { boton.disabled = false; boton.textContent = 'Buscar dirección'; avisar(e.message, true); }
    }

    // ---------- inicio ----------
    let guardada = null;
    try { guardada = localStorage.getItem('ferreobras.ruta'); } catch (e) { /* sin almacenamiento */ }
    const opciones = $$('option', sel).map(o => o.value);
    const primera = inicial.pedida ? String(inicial.pedida) : (opciones.includes(guardada) ? guardada : opciones[0]);
    sel.value = primera;
    cargar(primera);
  }
})();
