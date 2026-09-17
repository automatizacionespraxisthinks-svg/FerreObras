// Agenda del cliente (/hv/agenda): formulario para programar una tarea (arriba) y los eventos del cliente (abajo).
//  - Modo "puente" (dentro de Chatwoot): hv_comun.js hace el handshake y aquí se carga la agenda del contacto.
//  - Modo "directo" (/hv/agenda/:celular): se carga de una vez.
// Todo se pinta en el navegador a partir de la API JSON (/hv/agenda/api/:celular).
(function () {
  const HV = window.FerreHv;
  if (!HV) return;
  const { $, $$, esc, avisar, pedir } = HV;
  const raiz = $('#hv'), contenido = $('#hv-contenido');
  if (!raiz || !contenido || raiz.dataset.vista !== 'agenda') return;
  const MODO = raiz.dataset.modo;
  const mostrarEstado = (html, clase) => HV.mostrarEstado(contenido, html, clase);
  const params = new URLSearchParams(location.search);
  const etqInicial = () => ({ estado: 'inactivo', error: '', disponibles: [], asignadas: [], guardando: false, pendiente: false, abierto: false, nota: '', notaError: false });
  const estado = {
    celular: raiz.dataset.celular || '', contactoId: '', contactoNombre: '', datos: null, editando: null,
    // conversación de Chatwoot (llega en el contexto; en la vista directa se puede pasar ?conversacion=ID)
    conversacionId: /^\d+$/.test(params.get('conversacion') || '') ? params.get('conversacion') : '',
    etq: etqInicial(),
  };
  let chat = null;
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const ICONO = {
    cal: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6 2h2v2h4V2h2v2h3v14H3V4h3V2zM5 8v8h10V8H5zm2 2h2v2H7v-2zm4 0h2v2h-2v-2z"/></svg>',
    ok: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 13.4L4.6 10 6 8.6l2 2 5-5L14.4 7 8 13.4z"/></svg>',
    alerta: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10 2l9 16H1L10 2zm-1 6v5h2V8H9zm0 6v2h2v-2H9z"/></svg>',
  };

  const fmtCel = (c) => String(c || '').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1 $2 $3');
  const fechaLarga = (iso) => { const [y, m, d] = iso.split('-').map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); return `${DIAS[dt.getUTCDay()]} ${d} ${MESES[m - 1]}${y !== new Date().getFullYear() ? ' ' + y : ''}`; };
  const hora12 = (h) => { if (!h) return ''; const [H, M] = h.split(':').map(Number); return `${H % 12 || 12}:${String(M).padStart(2, '0')} ${H < 12 ? 'a. m.' : 'p. m.'}`; };
  const textoDias = (d) => (d < 0 ? `hace ${-d} d` : d === 0 ? 'hoy' : d === 1 ? 'mañana' : `en ${d} d`);
  const claseDias = (d) => (d < 0 ? 'vencido' : d === 0 ? 'hoy' : d <= 3 ? 'pronto' : '');
  const quien = (u) => (!u ? '' : /^\d{3,6}$/.test(u) ? 'línea ' + u : u === 'admin' ? 'administrador' : u);
  const cuando = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  const consulta = () => { const p = new URLSearchParams(); if (estado.contactoId) p.set('contacto_id', estado.contactoId); if (estado.contactoNombre) p.set('contacto_nombre', estado.contactoNombre); const s = p.toString(); return s ? '?' + s : ''; };
  const api = (ruta) => `/hv/agenda/api/${estado.celular}${ruta || ''}${consulta()}`;

  // Petición con reintento de sesión (la cookie de /hv dura 12 h; dentro de Chatwoot se vuelve a crear sola)
  async function llamar(url, opts, reintento) {
    try { return await pedir(url, opts); } catch (e) {
      if (e.sesion && MODO === 'puente' && chat && !reintento) { await chat.reconectar(); return llamar(url, opts, true); }
      if (e.sesion && MODO !== 'puente') { window.location = '/login'; }
      throw e;
    }
  }

  // ---------- carga ----------
  let peticion = 0;
  async function cargar() {
    const n = ++peticion;
    const hoja = $('.hv-hoja', contenido);
    if (hoja) hoja.classList.add('cargando');
    try {
      const d = await llamar(api());
      if (n !== peticion) return;
      estado.datos = d; estado.editando = null;
      render();
    } catch (e) {
      if (n !== peticion) return;
      if (hoja) { hoja.classList.remove('cargando'); avisar(e.message, true); } else mostrarEstado(`<p>${esc(e.message)}</p>`, 'error');
    }
  }

  // ---------- pintado ----------
  function render() {
    const d = estado.datos, t = estado.editando;
    const pendientes = d.tareas.filter(x => x.estado === 'pendiente');
    const v = (k, def) => esc(t ? t[k] : def);
    const hoy = d.hoy;
    contenido.innerHTML = `
      <div class="hv-hoja ag" data-celular="${esc(d.celular)}">
        <header class="hv-cab ag-cab-pagina">
          <div class="hv-cab-texto">
            <p class="hv-sobre">Agenda del cliente</p>
            <h1>${esc(d.cliente || 'Cliente')} <span class="hv-cel">${fmtCel(d.celular)} · <span id="ag-pendientes">${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'}</span></span></h1>
          </div>
        </header>

        <form class="ag-form ${t ? 'editando' : ''}" id="ag-form" novalidate>
          <div class="ag-form-cab">
            <h2 class="ag-form-titulo">${t ? 'Editar tarea' : 'Nueva tarea'}</h2>
            <small class="ag-form-nota" title="Se programa también en Google Calendar e invita a la línea responsable">${ICONO.cal} También en Google Calendar</small>
          </div>
          <div class="ag-campos">
            <label class="ag-tarea-campo">Tarea <span class="obligatorio" title="Campo obligatorio">*</span>
              <input name="tarea" required maxlength="200" value="${v('tarea', '')}" placeholder="Llamar al cliente para ofrecerle cemento" autocomplete="off">
            </label>
            <label>Prioridad <span class="obligatorio" title="Campo obligatorio">*</span>
              <select name="prioridad" required>
                ${d.prioridades.map(p => `<option value="${p.id}" title="${esc(p.ayuda)}" ${Number(t ? t.prioridad : 2) === p.id ? 'selected' : ''}>${p.id} · ${esc(p.nombre)}</option>`).join('')}
              </select>
            </label>
            <label>Responsable <span class="obligatorio" title="Campo obligatorio">*</span>
              <select name="responsable" required>
                ${d.lineas.map(l => `<option value="${esc(l)}" ${(t ? t.responsable : d.lineas[0]) === l ? 'selected' : ''}>Línea ${esc(l)}</option>`).join('')}
              </select>
            </label>
            <label>Fecha <span class="obligatorio" title="Campo obligatorio">*</span>
              <input type="date" name="fecha" required value="${v('fecha', hoy)}" min="${t ? '' : hoy}">
            </label>
            <label title="Sin hora queda como evento de todo el día">Hora <span class="ag-opcional">opcional</span>
              <input type="time" name="hora" value="${v('hora', '')}">
            </label>
          </div>
          <div class="ag-form-pie">
            <label class="ag-notas-campo">Notas <span class="ag-opcional">opcional</span>
              <textarea name="notas" rows="1" maxlength="2000" placeholder="Detalles para la línea responsable">${v('notas', '')}</textarea>
            </label>
            <div class="ag-form-acciones">
              ${t ? '<button type="button" class="btn" data-ag="cancelar">Cancelar</button>' : ''}
              <button type="submit" class="btn primario">${t ? 'Guardar' : 'Programar tarea'}</button>
            </div>
          </div>
          <p class="error" role="alert" hidden></p>
        </form>

        <section class="ag-etq" id="ag-etq" aria-label="Seguimientos automáticos por etiquetas"></section>

        <div id="ag-eventos"></div>
      </div>`;
    renderEtiquetas();
    renderEventos();
    if (t) { $('input[name=tarea]', contenido).focus(); contenido.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }
  // Lista de eventos (se puede volver a pintar sola, sin tocar el formulario)
  function renderEventos() {
    const cont = $('#ag-eventos', contenido);
    if (!cont) return;
    const d = estado.datos;
    const pendientes = d.tareas.filter(x => x.estado === 'pendiente'), hechas = d.tareas.filter(x => x.estado === 'hecha');
    const cab = $('#ag-pendientes', contenido);
    if (cab) cab.textContent = `${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'}`;
    cont.innerHTML = `
        <div class="ag-division" role="separator" aria-label="Eventos de este cliente">
          <span class="ag-division-texto">Eventos de este cliente</span>
          <span class="hv-conteo">${d.tareas.length + d.avisos.length + d.seguimientos.length}</span>
        </div>

        <section class="ag-lista" aria-label="Tareas pendientes">
          ${pendientes.length ? pendientes.map(tarjeta).join('') : `<p class="hv-vacio ag-vacio">No hay tareas pendientes para este cliente.${d.tareas.length || d.avisos.length || d.seguimientos.length ? '' : ' Programa la primera con el formulario de arriba.'}</p>`}
        </section>

        ${d.seguimientos.length ? `
        <section class="ag-lista ag-seguimientos" aria-label="Seguimientos automáticos">
          <h2 class="ag-subtitulo">Seguimientos automáticos <small>Programados por etiquetas de la conversación; el cliente recibe el mensaje por WhatsApp y el evento está en el calendario. Se quitan al retirar la etiqueta.</small></h2>
          ${d.seguimientos.map(s => {
            const p = d.prioridades.find(x => x.id === s.prioridad) || {};
            const cd = s.dias == null ? '' : claseDias(s.dias);
            return `
            <article class="ag-tarea seguimiento p${s.prioridad} ${cd}">
              <div class="ag-fecha">
                <b>${s.fecha ? esc(fechaLarga(s.fecha)) : 'Sin fecha'}</b>${s.fecha ? `<span class="ag-hora">${s.hora ? esc(hora12(s.hora)) : 'todo el día'}</span><span class="chip ${cd}">${esc(textoDias(s.dias))}</span>` : ''}
                <div class="ag-etiquetas"><span class="ag-prio" title="${esc(p.ayuda || '')}">${s.prioridad} · ${esc(p.nombre || '')}</span>${s.linea ? `<span class="chip codigo">Línea ${esc(s.linea)}</span>` : ''}<span class="chip-tag auto" title="Seguimiento automático por etiqueta">Auto</span></div>
              </div>
              <div class="ag-cuerpo">
                <p class="ag-texto">Seguimiento ${esc(s.tipo.charAt(0).toLowerCase() + s.tipo.slice(1))}</p>
                <p class="ag-notas">Etiqueta <code>${esc(s.label)}</code> · envío ${s.envios} de ${s.max_sends}${s.max_sends > 1 ? ` · cada ${s.interval_days} día${s.interval_days === 1 ? '' : 's'}` : ''}${s.ultimo_envio ? ` · último el ${esc(fechaLarga(s.ultimo_envio))}` : ''}</p>
                <small class="ag-traza">Se gestiona con la etiqueta: para cancelarlo, quítala en «Seguimientos automáticos» (arriba) o en Chatwoot.</small>
              </div>
              <div class="ag-lado">${s.en_calendario ? `<span class="ag-cal ok">${ICONO.ok} En Google Calendar</span>` : ''}</div>
            </article>`;
          }).join('')}
        </section>` : ''}

        ${d.avisos.length ? `
        <section class="ag-lista ag-avisos" aria-label="Avisos de obras">
          <h2 class="ag-subtitulo">Avisos de obras en curso <small>Etapas programadas en Obras; también están en el calendario</small></h2>
          ${d.avisos.map(a => `
            <article class="ag-tarea aviso ${claseDias(a.dias)}">
              <div class="ag-fecha">
                <b>${esc(fechaLarga(a.fecha_aviso))}</b><span class="chip ${claseDias(a.dias)}">${esc(textoDias(a.dias))}</span>
                <div class="ag-etiquetas"><span class="chip-tag">Obra</span><span class="chip codigo">Línea ${esc(a.linea)}</span></div>
              </div>
              <div class="ag-cuerpo">
                <p class="ag-texto">Aviso de <b>${esc(a.etapa)}</b> · ${esc(a.obra)} <small>Etapa programada para el ${esc(fechaLarga(a.fecha))}</small></p>
              </div>
              <div class="ag-lado">
                ${a.en_calendario ? `<span class="ag-cal ok">${ICONO.ok} En el calendario</span>` : ''}
                <div class="ag-acciones"><a class="btn chico" href="/obras/${a.obra_id}" target="_blank" rel="noopener">Ver obra</a></div>
              </div>
            </article>`).join('')}
        </section>` : ''}

        ${hechas.length ? `
        <details class="ag-hechas">
          <summary>Tareas realizadas <span class="hv-conteo gris">${hechas.length}</span></summary>
          <section class="ag-lista">${hechas.slice().reverse().map(tarjeta).join('')}</section>
        </details>` : ''}`;
  }
  // ---------- seguimientos automáticos: etiquetas de la conversación en Chatwoot ----------
  const COLOR_ETQ = '#7B1FA2';
  const urlEtiquetas = (recargar) => `/hv/agenda/api/${estado.celular}/etiquetas?conversacion=${encodeURIComponent(estado.conversacionId)}${recargar ? '&recargar=1' : ''}`;
  function pintarNota(texto, error) {
    estado.etq.nota = texto; estado.etq.notaError = !!error;
    const el = $('.ag-etq-estado', contenido);
    if (el) { el.textContent = texto || 'Etiquetas de esta conversación en Chatwoot'; el.classList.toggle('error', !!error); }
  }
  function renderEtiquetas() {
    const cont = $('#ag-etq', contenido);
    if (!cont) return;
    const e = estado.etq;
    const aviso = (html, clase) => `<p class="ag-etq-aviso ${clase || ''}">${html}</p>`;
    let cuerpo;
    if (!estado.conversacionId) cuerpo = aviso('Abre la agenda desde una conversación de Chatwoot para asignar seguimientos automáticos.');
    else if (e.estado === 'cargando' || e.estado === 'inactivo') cuerpo = aviso('Cargando las etiquetas de Chatwoot…');
    else if (e.estado === 'sin_config') cuerpo = aviso('Falta configurar el acceso a Chatwoot en el servidor (<code>CHATWOOT_API_TOKEN</code>).');
    else if (e.estado === 'error') cuerpo = aviso(`${esc(e.error)} <button type="button" class="btn chico link-suave" data-etq="recargar">Reintentar</button>`, 'error');
    else if (!e.disponibles.length) cuerpo = aviso('No hay etiquetas de seguimiento creadas en Chatwoot.');
    else {
      const elegidas = e.disponibles.filter(x => e.asignadas.includes(x.nombre));
      const punto = (x) => `<span class="ag-etq-punto" style="--c:${esc(x.color || COLOR_ETQ)}"></span>`;
      cuerpo = `
        <div class="ag-multi ${e.abierto ? 'abierto' : ''}">
          <div class="ag-multi-campo" data-etq="alternar">
            <div class="ag-multi-chips">
              ${elegidas.length ? elegidas.map(x => `<span class="ag-etq-chip" title="${esc(x.descripcion || x.nombre)}">${punto(x)}${esc(x.nombre)}<button type="button" data-etq-quitar="${esc(x.nombre)}" aria-label="Quitar el seguimiento ${esc(x.nombre)}" title="Quitar">×</button></span>`).join('')
                : '<span class="ag-multi-vacio">Ningún seguimiento asignado · elige uno o varios</span>'}
            </div>
            <button type="button" class="ag-multi-toggle" data-etq="alternar" aria-haspopup="listbox" aria-expanded="${e.abierto}" aria-controls="ag-etq-lista" title="Elegir seguimientos">
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M10 13.5L4.5 8l1.4-1.4 4.1 4.1 4.1-4.1L15.5 8z"/></svg>
            </button>
          </div>
          <div class="ag-multi-lista" id="ag-etq-lista" role="listbox" aria-multiselectable="true" aria-label="Etiquetas de seguimiento" ${e.abierto ? '' : 'hidden'}>
            ${e.disponibles.map(x => {
              const marcada = e.asignadas.includes(x.nombre);
              return `<label class="ag-multi-op ${marcada ? 'marcada' : ''}" role="option" aria-selected="${marcada}"><input type="checkbox" value="${esc(x.nombre)}" ${marcada ? 'checked' : ''}>${punto(x)}<span class="ag-multi-texto"><b>${esc(x.nombre)}</b>${x.descripcion ? `<small>${esc(x.descripcion)}</small>` : ''}</span></label>`;
            }).join('')}
          </div>
        </div>`;
    }
    // conserva el foco del teclado al volver a pintar
    const activo = document.activeElement && cont.contains(document.activeElement) ? document.activeElement : null;
    const foco = activo ? (activo.matches('input') ? { valor: activo.value } : activo.classList.contains('ag-multi-toggle') ? { toggle: true } : null) : null;
    cont.innerHTML = `
      <div class="ag-form-cab">
        <h2 class="ag-form-titulo">Seguimientos automáticos</h2>
        <small class="ag-form-nota ag-etq-estado ${e.notaError ? 'error' : ''}" aria-live="polite">${esc(e.nota || 'Etiquetas de esta conversación en Chatwoot')}</small>
      </div>
      ${cuerpo}`;
    if (foco) {
      const el = foco.toggle ? $('.ag-multi-toggle', cont) : Array.from(cont.querySelectorAll('#ag-etq-lista input')).find(i => i.value === foco.valor);
      if (el) el.focus();
    }
  }
  let peticionEtq = 0;
  async function cargarEtiquetas(recargar) {
    const e = estado.etq, n = ++peticionEtq;
    if (!estado.conversacionId || !estado.celular) { renderEtiquetas(); return; }
    e.estado = 'cargando'; renderEtiquetas();
    try {
      const r = await llamar(urlEtiquetas(recargar));
      if (n !== peticionEtq) return;
      if (!r.configurado) e.estado = 'sin_config';
      else Object.assign(e, { estado: 'listo', disponibles: r.disponibles, asignadas: r.asignadas });
    } catch (err) {
      if (n !== peticionEtq) return;
      e.estado = err.datos && err.datos.sin_configurar ? 'sin_config' : 'error';
      e.error = err.message;
    }
    renderEtiquetas();
  }
  // Los cambios se aplican solos (con una pequeña espera por si se marcan varias seguidas) y en orden
  let temporizadorEtq = null;
  function programarGuardado() {
    clearTimeout(temporizadorEtq);
    pintarNota('Aplicando…');
    temporizadorEtq = setTimeout(guardarEtiquetas, 600);
  }
  async function guardarEtiquetas() {
    const e = estado.etq;
    if (e.guardando) { e.pendiente = true; return; }
    e.guardando = true; e.pendiente = false;
    const conversacion = estado.conversacionId;
    let fallo = false;
    try {
      const r = await llamar(urlEtiquetas(), { body: { conversacion, etiquetas: [...e.asignadas] } });
      if (conversacion !== estado.conversacionId) return;
      if (!e.pendiente) e.asignadas = r.asignadas;
      pintarNota('Aplicado en la conversación · el seguimiento se programa en unos segundos');
      refrescarEventos();
    } catch (err) {
      fallo = true;
      e.pendiente = false;
      avisar(err.message, true);
      await cargarEtiquetas(); // vuelve a mostrar lo que realmente tiene la conversación
      pintarNota(err.message, true);
    } finally {
      e.guardando = false;
      if (e.pendiente) guardarEtiquetas(); else if (!fallo && e.estado === 'listo') renderEtiquetas();
    }
  }
  // n8n crea o quita el seguimiento unos segundos después del cambio de etiqueta: se refresca la lista de eventos
  let temporizadoresEventos = [];
  function refrescarEventos() {
    temporizadoresEventos.forEach(clearTimeout);
    temporizadoresEventos = [3000, 9000].map(ms => setTimeout(async () => {
      try {
        const d = await llamar(api());
        if (!estado.datos || d.celular !== estado.datos.celular) return;
        Object.assign(estado.datos, { tareas: d.tareas, avisos: d.avisos, seguimientos: d.seguimientos });
        renderEventos();
      } catch (e) { /* se verá al recargar */ }
    }, ms));
  }
  function alternarLista(abrir) {
    const e = estado.etq;
    e.abierto = abrir == null ? !e.abierto : abrir;
    const multi = $('.ag-multi', contenido), lista = $('#ag-etq-lista', contenido), boton = $('.ag-multi-toggle', contenido);
    if (!multi || !lista) return;
    multi.classList.toggle('abierto', e.abierto);
    lista.hidden = !e.abierto;
    if (boton) boton.setAttribute('aria-expanded', String(e.abierto));
    if (e.abierto) { const primero = $('input', lista); if (primero) primero.focus(); }
  }
  contenido.addEventListener('click', (ev) => {
    const quitar = ev.target.closest('[data-etq-quitar]');
    if (quitar) {
      estado.etq.asignadas = estado.etq.asignadas.filter(l => l !== quitar.dataset.etqQuitar);
      renderEtiquetas(); programarGuardado();
      return;
    }
    const b = ev.target.closest('[data-etq]');
    if (!b) return;
    if (b.dataset.etq === 'alternar') alternarLista();
    if (b.dataset.etq === 'recargar') cargarEtiquetas(true);
  });
  contenido.addEventListener('change', (ev) => {
    const input = ev.target.closest('#ag-etq-lista input[type=checkbox]');
    if (!input) return;
    const e = estado.etq;
    e.asignadas = input.checked ? [...new Set([...e.asignadas, input.value])] : e.asignadas.filter(l => l !== input.value);
    renderEtiquetas(); programarGuardado();
  });
  document.addEventListener('click', (ev) => {
    // el pintado reemplaza el elemento pulsado: si ya no está en la página, el clic fue dentro del selector
    if (estado.etq.abierto && ev.target.isConnected && !ev.target.closest('.ag-multi')) alternarLista(false);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && estado.etq.abierto) { alternarLista(false); const b = $('.ag-multi-toggle', contenido); if (b) b.focus(); }
  });

  function tarjeta(t) {
    const d = estado.datos;
    const p = d.prioridades.find(x => x.id === t.prioridad) || {};
    const pendiente = t.estado === 'pendiente';
    const calendario = t.calendario_estado === 'sincronizada'
      ? (t.google_link ? `<a class="ag-cal ok" href="${esc(t.google_link)}" target="_blank" rel="noopener" title="Abrir en Google Calendar">${ICONO.ok} En Google Calendar</a>` : `<span class="ag-cal ok">${ICONO.ok} En Google Calendar</span>`)
      : `<span class="ag-cal pendiente" title="${esc(t.calendario_estado === 'sin_configurar' ? 'El calendario no está configurado en el servidor' : (t.calendario_error || ''))}">${ICONO.alerta} Sin copia en el calendario</span> <button type="button" class="btn chico link-suave" data-ag="sincronizar">Reintentar</button>`;
    return `
      <article class="ag-tarea p${t.prioridad} ${pendiente ? claseDias(t.dias) : 'hecha'} ${estado.editando && estado.editando.id === t.id ? 'editando' : ''}" data-id="${t.id}">
        <div class="ag-fecha">
          <b>${esc(fechaLarga(t.fecha))}</b>
          <span class="ag-hora">${t.hora ? esc(hora12(t.hora)) : 'todo el día'}</span>
          ${pendiente ? `<span class="chip ${claseDias(t.dias)}">${esc(textoDias(t.dias))}</span>` : ''}
          <div class="ag-etiquetas"><span class="ag-prio" title="${esc(p.ayuda || '')}">${t.prioridad} · ${esc(p.nombre || '')}</span><span class="chip codigo">Línea ${esc(t.responsable)}</span></div>
        </div>
        <div class="ag-cuerpo">
          <p class="ag-texto">${esc(t.tarea)}</p>
          ${t.notas ? `<p class="ag-notas">${esc(t.notas)}</p>` : ''}
          <small class="ag-traza">${t.actualizado_por && t.actualizado_por !== t.creado_por ? `Actualizada por ${esc(quien(t.actualizado_por))} · ${esc(cuando(t.updated_at))}` : `Creada por ${esc(quien(t.creado_por))} · ${esc(cuando(t.created_at))}`}</small>
        </div>
        <div class="ag-lado">
          <div class="ag-cal-fila">${calendario}</div>
          <div class="ag-acciones">
            <button type="button" class="btn chico ${pendiente ? 'primario' : ''}" data-ag="estado" data-estado="${pendiente ? 'hecha' : 'pendiente'}">${pendiente ? '✓ Marcar hecha' : 'Volver a pendiente'}</button>
            ${pendiente ? '<button type="button" class="btn chico" data-ag="editar">Editar</button>' : ''}
            <button type="button" class="btn chico link" data-ag="eliminar">Eliminar</button>
          </div>
        </div>
      </article>`;
  }
  function reemplazar(tarea) {
    const i = estado.datos.tareas.findIndex(x => x.id === tarea.id);
    if (i >= 0) estado.datos.tareas[i] = tarea; else estado.datos.tareas.push(tarea);
    estado.datos.tareas.sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.hora || '~').localeCompare(String(b.hora || '~')) || a.prioridad - b.prioridad || a.id - b.id);
  }
  const avisoCalendario = (tarea, hecho) => {
    if (tarea.calendario_estado === 'sincronizada') avisar(`${hecho} · copiada en Google Calendar`);
    else avisar(`${hecho}, pero no se pudo enviar al calendario${tarea.calendario_estado === 'sin_configurar' ? ' (no está configurado)' : ''}. Puedes reintentar desde la tarea.`, true);
  };

  // ---------- acciones ----------
  contenido.addEventListener('submit', async (e) => {
    if (e.target.id !== 'ag-form') return;
    e.preventDefault();
    const form = e.target, error = $('.error', form), boton = $('button[type=submit]', form);
    const faltante = Array.from(form.elements).find(el => el.required && !String(el.value).trim());
    if (faltante) { error.textContent = 'Completa los campos marcados con *.'; error.hidden = false; faltante.focus(); return; }
    const body = {}; for (const el of form.elements) if (el.name) body[el.name] = el.value;
    boton.disabled = true; error.hidden = true;
    try {
      const t = estado.editando;
      const r = await llamar(api(t ? `/${t.id}` : ''), { body });
      reemplazar(r.tarea); estado.editando = null; render();
      avisoCalendario(r.tarea, t ? 'Tarea actualizada' : 'Tarea programada');
    } catch (err) { error.textContent = err.message; error.hidden = false; boton.disabled = false; }
  });
  contenido.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ag]');
    if (!b) return;
    const accion = b.dataset.ag;
    if (accion === 'cancelar') { estado.editando = null; render(); return; }
    const art = b.closest('[data-id]'), t = art && estado.datos.tareas.find(x => x.id === Number(art.dataset.id));
    if (!t) return;
    if (accion === 'editar') { estado.editando = t; render(); return; }
    b.disabled = true;
    try {
      if (accion === 'estado') {
        const r = await llamar(api(`/${t.id}/estado`), { body: { estado: b.dataset.estado } });
        reemplazar(r.tarea); render();
        avisar(b.dataset.estado === 'hecha' ? 'Tarea marcada como hecha' : 'Tarea de nuevo pendiente');
      } else if (accion === 'sincronizar') {
        const r = await llamar(api(`/${t.id}/sincronizar`), { body: {} });
        reemplazar(r.tarea); render();
        if (r.ok) avisar('Tarea programada en Google Calendar'); else avisar(r.error, true);
      } else if (accion === 'eliminar') {
        if (!confirm(`¿Eliminar la tarea "${t.tarea}"? También se quita del calendario.`)) { b.disabled = false; return; }
        await llamar(api(`/${t.id}/eliminar`), { body: {} });
        estado.datos.tareas = estado.datos.tareas.filter(x => x.id !== t.id);
        if (estado.editando && estado.editando.id === t.id) estado.editando = null;
        render(); avisar('Tarea eliminada');
      }
    } catch (err) { b.disabled = false; avisar(err.message, true); }
  });

  // ---------- inicio ----------
  if (MODO !== 'puente') { cargar().then(() => cargarEtiquetas()); return; }
  chat = HV.conectarChatwoot({
    origen: raiz.dataset.chatwootOrigin, clave: raiz.dataset.clave, contenido,
    alContacto: async ({ celular, contactoId, contactoNombre, conversacionId, cambio }) => {
      const otraConversacion = (conversacionId || '') !== estado.conversacionId;
      estado.contactoId = contactoId; estado.contactoNombre = contactoNombre; estado.conversacionId = conversacionId || '';
      if (!cambio && estado.datos) { // mismo contacto: no se pierde lo que se está escribiendo
        if (otraConversacion) { estado.etq = etqInicial(); cargarEtiquetas(); }
        return;
      }
      estado.celular = celular; estado.datos = null; estado.etq = etqInicial();
      await cargar();
      cargarEtiquetas();
    },
  });
})();
