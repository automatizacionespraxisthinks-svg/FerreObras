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
  const estado = { celular: raiz.dataset.celular || '', contactoId: '', contactoNombre: '', datos: null, editando: null };
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
    const pendientes = d.tareas.filter(x => x.estado === 'pendiente'), hechas = d.tareas.filter(x => x.estado === 'hecha');
    const v = (k, def) => esc(t ? t[k] : def);
    const hoy = d.hoy;
    contenido.innerHTML = `
      <div class="hv-hoja ag" data-celular="${esc(d.celular)}">
        <header class="hv-cab">
          <div class="hv-cab-texto">
            <p class="hv-sobre">Agenda del cliente</p>
            <h1>${esc(d.cliente || 'Cliente')}</h1>
            <p class="hv-cel">${fmtCel(d.celular)} · ${pendientes.length} tarea${pendientes.length === 1 ? '' : 's'} pendiente${pendientes.length === 1 ? '' : 's'}</p>
          </div>
        </header>

        <form class="ag-form ${t ? 'editando' : ''}" id="ag-form" novalidate>
          <h2 class="ag-form-titulo">${t ? `Editar tarea` : 'Nueva tarea'}</h2>
          <div class="ag-campos">
            <label>Prioridad <span class="obligatorio" title="Campo obligatorio">*</span>
              <select name="prioridad" required>
                ${d.prioridades.map(p => `<option value="${p.id}" ${Number(t ? t.prioridad : 2) === p.id ? 'selected' : ''}>${p.id} · ${esc(p.nombre)} — ${esc(p.ayuda)}</option>`).join('')}
              </select>
            </label>
            <label>Responsable <span class="obligatorio" title="Campo obligatorio">*</span>
              <select name="responsable" required>
                ${d.lineas.map(l => `<option value="${esc(l)}" ${(t ? t.responsable : d.lineas[0]) === l ? 'selected' : ''}>Línea ${esc(l)}</option>`).join('')}
              </select>
            </label>
            <label class="hv-ancho">Tarea <span class="obligatorio" title="Campo obligatorio">*</span>
              <input name="tarea" required maxlength="200" value="${v('tarea', '')}" placeholder="Llamar al cliente para ofrecerle cemento" autocomplete="off">
            </label>
            <label>Fecha <span class="obligatorio" title="Campo obligatorio">*</span>
              <input type="date" name="fecha" required value="${v('fecha', hoy)}" min="${t ? '' : hoy}">
            </label>
            <label>Hora <input type="time" name="hora" value="${v('hora', '')}"><small>Sin hora queda como evento de todo el día</small></label>
            <label class="hv-ancho">Notas <textarea name="notas" rows="2" maxlength="2000" placeholder="Opcional">${v('notas', '')}</textarea></label>
          </div>
          <p class="error" role="alert" hidden></p>
          <div class="ag-form-acciones">
            <button type="submit" class="btn primario">${t ? 'Guardar cambios' : 'Programar tarea'}</button>
            ${t ? '<button type="button" class="btn" data-ag="cancelar">Cancelar</button>' : ''}
            <small class="ag-form-nota">${ICONO.cal} Se programa también en Google Calendar e invita a la línea responsable.</small>
          </div>
        </form>

        <div class="ag-division" role="separator" aria-label="Eventos de este cliente">
          <span class="ag-division-texto">Eventos de este cliente</span>
          <span class="hv-conteo">${d.tareas.length + d.avisos.length}</span>
        </div>

        <section class="ag-lista" aria-label="Tareas pendientes">
          ${pendientes.length ? pendientes.map(tarjeta).join('') : `<p class="hv-vacio ag-vacio">No hay tareas pendientes para este cliente.${d.tareas.length || d.avisos.length ? '' : ' Programa la primera con el formulario de arriba.'}</p>`}
        </section>

        ${d.avisos.length ? `
        <section class="ag-lista ag-avisos" aria-label="Avisos de obras">
          <h2 class="ag-subtitulo">Avisos de obras en curso <small>Etapas programadas en Obras; también están en el calendario</small></h2>
          ${d.avisos.map(a => `
            <article class="ag-tarea aviso ${claseDias(a.dias)}">
              <div class="ag-fecha"><b>${esc(fechaLarga(a.fecha_aviso))}</b><span class="chip ${claseDias(a.dias)}">${esc(textoDias(a.dias))}</span></div>
              <div class="ag-cuerpo">
                <div class="ag-cab"><span class="chip-tag">Obra</span><span class="chip codigo">Línea ${esc(a.linea)}</span>${a.en_calendario ? `<span class="ag-cal ok">${ICONO.ok} En el calendario</span>` : ''}</div>
                <p class="ag-texto">Aviso de <b>${esc(a.etapa)}</b> · ${esc(a.obra)} <small>Etapa programada para el ${esc(fechaLarga(a.fecha))}</small></p>
                <div class="ag-acciones"><a class="btn chico" href="/obras/${a.obra_id}" target="_blank" rel="noopener">Ver obra</a></div>
              </div>
            </article>`).join('')}
        </section>` : ''}

        ${hechas.length ? `
        <details class="ag-hechas">
          <summary>Tareas realizadas <span class="hv-conteo gris">${hechas.length}</span></summary>
          <section class="ag-lista">${hechas.slice().reverse().map(tarjeta).join('')}</section>
        </details>` : ''}
      </div>`;
    if (t) { $('input[name=tarea]', contenido).focus(); contenido.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }
  function tarjeta(t) {
    const d = estado.datos;
    const p = d.prioridades.find(x => x.id === t.prioridad) || {};
    const pendiente = t.estado === 'pendiente';
    const calendario = t.calendario_estado === 'sincronizada'
      ? (t.google_link ? `<a class="ag-cal ok" href="${esc(t.google_link)}" target="_blank" rel="noopener" title="Abrir en Google Calendar">${ICONO.ok} En Google Calendar</a>` : `<span class="ag-cal ok">${ICONO.ok} En Google Calendar</span>`)
      : `<span class="ag-cal pendiente" title="${esc(t.calendario_estado === 'sin_configurar' ? 'El calendario no está configurado en el servidor' : (t.calendario_error || ''))}">${ICONO.alerta} Sin copia en el calendario</span> <button type="button" class="btn chico link-suave" data-ag="sincronizar">Reintentar</button>`;
    return `
      <article class="ag-tarea p${t.prioridad} ${pendiente ? claseDias(t.dias) : 'hecha'} ${estado.editando && estado.editando.id === t.id ? 'editando' : ''}" data-id="${t.id}">
        <div class="ag-fecha"><b>${esc(fechaLarga(t.fecha))}</b><span class="ag-hora">${t.hora ? esc(hora12(t.hora)) : 'todo el día'}</span>${pendiente ? `<span class="chip ${claseDias(t.dias)}">${esc(textoDias(t.dias))}</span>` : ''}</div>
        <div class="ag-cuerpo">
          <div class="ag-cab"><span class="ag-prio" title="${esc(p.ayuda || '')}">P${t.prioridad} · ${esc(p.nombre || '')}</span><span class="chip codigo">Línea ${esc(t.responsable)}</span>${calendario}</div>
          <p class="ag-texto">${esc(t.tarea)}</p>
          ${t.notas ? `<p class="ag-notas">${esc(t.notas)}</p>` : ''}
          <div class="ag-acciones">
            <button type="button" class="btn chico ${pendiente ? 'primario' : ''}" data-ag="estado" data-estado="${pendiente ? 'hecha' : 'pendiente'}">${pendiente ? '✓ Marcar hecha' : 'Volver a pendiente'}</button>
            ${pendiente ? '<button type="button" class="btn chico" data-ag="editar">Editar</button>' : ''}
            <button type="button" class="btn chico link" data-ag="eliminar">Eliminar</button>
          </div>
          <small class="ag-traza">${t.actualizado_por && t.actualizado_por !== t.creado_por ? `Actualizada por ${esc(quien(t.actualizado_por))} · ${esc(cuando(t.updated_at))}` : `Creada por ${esc(quien(t.creado_por))} · ${esc(cuando(t.created_at))}`}</small>
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
  if (MODO !== 'puente') { cargar(); return; }
  chat = HV.conectarChatwoot({
    origen: raiz.dataset.chatwootOrigin, clave: raiz.dataset.clave, contenido,
    alContacto: async ({ celular, contactoId, contactoNombre, cambio }) => {
      estado.contactoId = contactoId; estado.contactoNombre = contactoNombre;
      if (!cambio && estado.datos) return; // mismo contacto: no se pierde lo que se está escribiendo
      estado.celular = celular; estado.datos = null;
      await cargar();
    },
  });
})();
