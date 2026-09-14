// Agenda de contactos: directorio de ferreterías y clientes de obras con búsqueda, filtros, ordenamiento,
// creación y edición de ferreterías (misma API que el planificador) y exportación a Excel con los filtros aplicados.
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalizar = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();
  const datosEl = $('#datos-agenda');
  if (!datosEl) return;
  const datos = JSON.parse(datosEl.textContent);
  let contactos = datos.contactos;
  let orden = { clave: 'nombre', asc: true };
  let fichaKey = null;

  const tabla = $('#tabla'), buscar = $('#buscar'), fTipo = $('#f-tipo'), fMunicipio = $('#f-municipio'), fRuta = $('#f-ruta');
  const dialogo = $('#dialogo-cliente'), contenido = $('#dialogo-contenido');
  const ICONO = {
    tel: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M6.5 2.3l2 2.8c.3.5.3 1.1-.1 1.5L7.3 7.8c.8 1.9 2.4 3.6 4.4 4.5l1.2-1.1c.4-.4 1-.5 1.5-.1l2.8 2c.5.3.6 1 .3 1.5l-1 1.5c-.5.7-1.4 1.1-2.2.9C8.5 15.7 4.3 11.5 2.9 5.7c-.2-.8.1-1.7.8-2.2l1.5-1c.4-.4 1-.3 1.3-.2z"/></svg>',
    whatsapp: '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 0 0-6.9 12L2 18l4.1-1.1A8 8 0 1 0 10 2zm4.2 11.1c-.2.5-1 1-1.5 1-.4.1-.9.1-1.5-.1-2.6-1-4.3-3.6-4.4-3.8-.1-.2-1-1.4-1-2.6s.6-1.8.9-2.1c.2-.2.5-.3.6-.3h.5c.2 0 .4 0 .5.4l.7 1.6c.1.2.1.3 0 .5l-.6.7c-.1.1-.2.3-.1.5.2.3.7 1.1 1.4 1.7.9.8 1.7 1.1 2 1.2.2.1.4.1.5-.1l.7-.8c.2-.2.3-.2.5-.1l1.5.7c.2.1.4.2.4.3.1.1.1.6-.1 1.2z"/></svg>',
  };

  function avisar(msg, error) {
    $$('.toast').forEach(t => t.remove());
    const t = document.createElement('div');
    t.className = 'toast' + (error ? ' toast-error' : ''); t.setAttribute('role', 'status');
    t.innerHTML = `<span>${esc(msg)}</span><button type="button" class="toast-cerrar" aria-label="Cerrar">×</button>`;
    document.body.appendChild(t);
    $('.toast-cerrar', t).addEventListener('click', () => t.remove());
    setTimeout(() => { t.classList.add('oculto'); setTimeout(() => t.remove(), 400); }, 4000);
  }
  async function pedir(url, opts) {
    const o = opts || {};
    let r;
    try {
      r = await fetch(url, { method: o.body !== undefined ? 'POST' : 'GET', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
    } catch (e) { throw new Error('No hay conexión con el servidor. Revisa internet e intenta de nuevo.'); }
    if (r.redirected && /\/login/.test(r.url)) { window.location = '/login'; throw new Error('La sesión expiró.'); }
    let d = null; try { d = await r.json(); } catch (e) { /* sin cuerpo */ }
    if (!r.ok) throw new Error((d && d.error) || 'No se pudo completar la operación.');
    return d;
  }
  // Celulares colombianos dentro de un texto libre ("GLORIA 3134153102 · 315 893 7344")
  function celulares(t) {
    const s = String(t || '').replace(/(3\d{2})[ .](\d{3})[ .]?(\d{4})(?!\d)/g, '$1$2$3').replace(/(3\d{2})[ .](\d{7})(?!\d)/g, '$1$2');
    return [...new Set(s.match(/(?<!\d)3\d{9}(?!\d)/g) || [])];
  }
  const fmtTel = (t) => `${t.slice(0, 3)} ${t.slice(3, 6)} ${t.slice(6)}`;
  const clave = (s) => normalizar(s);

  // ---------- filtros (misma lógica que el servidor en filtrarAgenda) ----------
  function filtros() { return { q: buscar.value.trim(), tipo: fTipo.value, municipio: fMunicipio.value, ruta: fRuta.value }; }
  function filtrar(lista) {
    const f = filtros(), q = normalizar(f.q), digitos = f.q.replace(/\D/g, ''), km = clave(f.municipio);
    return lista.filter(c => (!f.tipo || c.tipo === f.tipo) && (!km || c.clave_municipio === km) && (!f.ruta || c.rutas.includes(f.ruta))
      && (!q || normalizar([c.nombre, c.razon_social, c.obra, c.direccion, c.sector, c.municipio, c.nit, c.tipologia, c.maestro].join(' ')).includes(q)
        || (digitos.length >= 3 && c.telefonos.replace(/\D/g, '').includes(digitos))));
  }
  function llenarMunicipios() {
    const actual = fMunicipio.value;
    const nombres = [...new Set(contactos.map(c => c.municipio).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    fMunicipio.innerHTML = '<option value="">Todos</option>' + nombres.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    fMunicipio.value = nombres.includes(actual) ? actual : '';
  }

  // ---------- tabla ----------
  const COLUMNAS = [
    { titulo: 'Contacto', clave: 'nombre', render: (c) => `<button type="button" class="enlace-fuerte agenda-nombre" data-abrir="${c.key}">${esc(c.nombre)}</button>${c.tipo === 'o' ? ' <span class="chip-tag">Obra</span>' : ''}${c.razon_social ? `<small>${esc(c.razon_social)}</small>` : ''}${c.obra ? `<small>${esc(c.obra)}</small>` : ''}` },
    { titulo: 'Municipio', clave: 'municipio', render: (c) => `${esc(c.municipio || '—')}${c.sector ? `<small>${esc(c.sector)}</small>` : ''}` },
    { titulo: 'Teléfonos', clave: 'telefonos', render: (c) => {
      const tels = celulares(c.telefonos);
      return `${esc(c.telefonos || '—')}${tels.length ? `<span class="tel-acciones">${tels.map(t => `<a class="btn chico" href="tel:+57${t}" title="Llamar al ${fmtTel(t)}">${ICONO.tel}${fmtTel(t)}</a><a class="btn chico whatsapp" href="https://wa.me/57${t}" target="_blank" rel="noopener" aria-label="WhatsApp ${fmtTel(t)}">${ICONO.whatsapp}</a>`).join('')}</span>` : ''}`;
    } },
    { titulo: 'Dirección', clave: 'direccion', render: (c) => esc(c.direccion || '—') },
    { titulo: 'NIT o cédula', clave: 'nit', render: (c) => esc(c.tipo === 'o' ? (c.maestro ? `Residente: ${c.maestro}` : '—') : (c.nit || '—')) },
    { titulo: 'Tipología', clave: 'tipologia', render: (c) => `${esc(c.tipo === 'o' ? (c.linea ? `Línea ${c.linea}` : '—') : (c.tipologia || '—'))}${c.volumen_compra ? `<small>${esc(c.volumen_compra)}</small>` : ''}` },
    { titulo: 'Rutas', clave: 'rutas_texto', render: (c) => (c.rutas.length ? c.rutas.map(r => `<span class="chip codigo">${esc(r)}</span>`).join(' ') : '<span class="muted">Sin ruta</span>') },
  ];
  function valorOrden(c, k) {
    if (k === 'rutas_texto') return c.rutas.join(', ').toLowerCase();
    if (k === 'nit') return (c.tipo === 'o' ? c.maestro : c.nit) || '';
    if (k === 'tipologia') return (c.tipo === 'o' ? c.linea : c.tipologia) || '';
    return String(c[k] || '').toLowerCase();
  }
  function render() {
    for (const c of contactos) c.rutas_texto = c.rutas.join(', ');
    const lista = filtrar(contactos).sort((a, b) => {
      const x = valorOrden(a, orden.clave), y = valorOrden(b, orden.clave);
      if (x === y) return a.nombre.localeCompare(b.nombre, 'es', { numeric: true, sensitivity: 'base' });
      if (!x) return 1; if (!y) return -1; // los vacíos siempre al final
      return x.localeCompare(y, 'es', { numeric: true, sensitivity: 'base' }) * (orden.asc ? 1 : -1);
    });
    $('#conteo').textContent = `${lista.length} de ${contactos.length} contactos`;
    const f = filtros(), p = new URLSearchParams();
    for (const k in f) if (f[k]) p.set(k, f[k]);
    $('#btn-exportar').href = '/agenda/export.xlsx' + (p.toString() ? '?' + p.toString() : '');
    if (!lista.length) { tabla.innerHTML = `<p class="vacio-tabla">${contactos.length ? 'Ningún contacto coincide con la búsqueda.' : 'Todavía no hay contactos. Crea el primero con <b>Nuevo contacto</b> o importa la agenda desde Gestión de rutas.'}</p>`; return; }
    const th = COLUMNAS.map(c => `<th class="ordenable ${orden.clave === c.clave ? 'activo' : ''}" data-clave="${c.clave}" aria-sort="${orden.clave === c.clave ? (orden.asc ? 'ascending' : 'descending') : 'none'}">${esc(c.titulo)}${orden.clave === c.clave ? (orden.asc ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const tr = lista.map(c => `<tr>${COLUMNAS.map(col => `<td data-etiqueta="${esc(col.titulo)}">${col.render(c)}</td>`).join('')}</tr>`).join('');
    tabla.innerHTML = `<table class="tabla tabla-agenda"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
  }
  tabla.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-clave]');
    if (th) { orden = { clave: th.dataset.clave, asc: orden.clave === th.dataset.clave ? !orden.asc : true }; render(); return; }
    const b = e.target.closest('[data-abrir]');
    if (!b) return;
    const c = contactos.find(x => x.key === b.dataset.abrir);
    if (!c) return;
    if (c.tipo === 'o') window.location = `/obras/${c.id}`; else abrirFormulario(c);
  });
  [buscar, fTipo, fMunicipio, fRuta].forEach(el => el.addEventListener('input', render));

  // ---------- crear, editar y eliminar ferreterías (misma API que el planificador) ----------
  function mostrarDialogo() {
    if (dialogo.open) return;
    if (typeof dialogo.showModal === 'function') dialogo.showModal(); else dialogo.setAttribute('open', '');
  }
  function abrirFormulario(c) {
    fichaKey = c ? c.key : null;
    const v = (k) => esc(c ? c[k] || '' : '');
    contenido.innerHTML = `
      <div class="ficha-cab">
        <span class="ficha-tipo">Ferretería</span>
        <h2 id="dialogo-titulo">${c ? 'Editar contacto' : 'Nuevo contacto'}</h2>
        <p class="sub">${c ? esc(c.nombre) : 'Queda en la agenda y aparece en las rutas que pasan por su municipio.'}</p>
        <button type="button" class="dialogo-cerrar" data-cerrar aria-label="Cerrar">×</button>
      </div>
      <form class="ficha-form" id="form-cliente" novalidate>
        <label class="ancho-total">Nombre <input name="nombre" required maxlength="160" value="${v('nombre')}"></label>
        <label>Municipio <input name="municipio" list="lista-municipios" required maxlength="160" value="${v('municipio')}" autocomplete="off"></label>
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
          <button type="submit" class="btn primario">${c ? 'Guardar cambios' : 'Crear contacto'}</button>
          <button type="button" class="btn" data-cerrar>Cancelar</button>
          ${c ? `<button type="button" class="btn link" data-eliminar="${c.id}">Eliminar contacto</button>` : ''}
        </div>
      </form>`;
    mostrarDialogo();
    $('input[name=nombre]', contenido).focus();
  }
  $('#btn-nuevo').addEventListener('click', () => abrirFormulario(null));
  contenido.addEventListener('submit', async (e) => {
    if (e.target.id !== 'form-cliente') return;
    e.preventDefault();
    const form = e.target, error = $('.error', form), boton = $('button[type=submit]', form);
    const body = Object.fromEntries(new FormData(form).entries());
    if (!body.nombre.trim() || !body.municipio.trim()) { error.textContent = 'El nombre y el municipio son obligatorios.'; error.hidden = false; return; }
    const c = contactos.find(x => x.key === fichaKey);
    boton.disabled = true;
    try {
      const guardado = await pedir(c ? `/rutas/api/clientes/${c.id}` : '/rutas/api/clientes', { body });
      guardado.rutas = datos.rutasPorMunicipio[guardado.clave_municipio] || [];
      if (c) Object.assign(c, guardado); else contactos.push(guardado);
      dialogo.close();
      llenarMunicipios(); render();
      avisar(c ? 'Contacto guardado' : `${guardado.nombre} se agregó a la agenda`);
    } catch (err) { error.textContent = err.message; error.hidden = false; boton.disabled = false; }
  });
  contenido.addEventListener('click', async (e) => {
    if (e.target.closest('[data-cerrar]')) return dialogo.close();
    const b = e.target.closest('[data-eliminar]');
    if (!b) return;
    const c = contactos.find(x => x.key === `c${b.dataset.eliminar}`);
    if (!c || !confirm(`¿Eliminar a ${c.nombre} de la agenda? Se quita de todas las rutas.`)) return;
    try {
      await pedir(`/rutas/api/clientes/${c.id}/eliminar`, { body: {} });
      contactos = contactos.filter(x => x !== c);
      dialogo.close(); llenarMunicipios(); render();
      avisar('Contacto eliminado');
    } catch (err) { avisar(err.message, true); }
  });
  dialogo.addEventListener('click', (e) => { if (e.target === dialogo) dialogo.close(); });
  dialogo.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dialogo.open) { e.preventDefault(); dialogo.close(); } });

  llenarMunicipios();
  render();
})();
