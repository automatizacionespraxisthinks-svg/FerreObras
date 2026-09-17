// Hoja de vida del cliente.
//  - Modo "puente" (/hv, dentro de Chatwoot): el handshake con Chatwoot lo hace hv_comun.js; aquí se carga la hoja
//    del contacto por fetch cada vez que cambia.
//  - Modo "directo" (/hv/:celular): la hoja ya viene en la página; aquí solo se manejan Editar, Cancelar y Guardar.
// Ficha y formulario se intercambian pidiendo el fragmento HTML al servidor, sin recargar la página.
(function () {
  const HV = window.FerreHv;
  if (!HV) return;
  const { $, esc, avisar, pedir } = HV;
  const raiz = $('#hv'), contenido = $('#hv-contenido');
  if (!raiz || !contenido) return;
  const MODO = raiz.dataset.modo;
  const mostrarEstado = (html, clase) => HV.mostrarEstado(contenido, html, clase);

  // Estado actual: celular del cliente y datos del contacto de Chatwoot (si hay)
  const estado = { celular: raiz.dataset.celular || '', contactoId: '', contactoNombre: '' };
  let chat = null; // conexión con Chatwoot (modo puente)

  const consulta = (extra) => {
    const p = new URLSearchParams(Object.assign({ fragmento: '1' }, extra || {}));
    if (estado.contactoId) p.set('contacto_id', estado.contactoId);
    if (estado.contactoNombre) p.set('contacto_nombre', estado.contactoNombre);
    return p.toString();
  };

  // Carga ficha o formulario del celular actual
  let peticion = 0;
  async function cargar(extra, reintento) {
    const n = ++peticion;
    const hoja = $('.hv-hoja', contenido);
    if (hoja) hoja.classList.add('cargando');
    try {
      const html = await pedir(`/hv/${estado.celular}?${consulta(extra)}`);
      if (n !== peticion) return false;
      contenido.innerHTML = html;
      const primero = $('#hv-form input:not([readonly]), #hv-form select, #hv-form textarea', contenido);
      if (primero && extra && extra.editar) primero.focus();
      return true;
    } catch (e) {
      if (n !== peticion) return false;
      if (e.sesion && MODO === 'puente' && !reintento && chat) { await chat.reconectar(); return cargar(extra, true); }
      if (e.sesion && MODO !== 'puente') { window.location = '/login'; return false; }
      if (hoja) { hoja.classList.remove('cargando'); avisar(e.message, true); } else mostrarEstado(`<p>${esc(e.message)}</p>`, 'error');
      return false;
    }
  }

  // ---------- Editar, Cancelar, Guardar ----------
  // Bloques repetibles (obras): numeración y botón Quitar deshabilitado cuando se llega al mínimo
  function renumerar(grupo) {
    const items = grupo.querySelectorAll('[data-items] > [data-item]');
    const min = Number(grupo.dataset.minimo || 0), max = Number(grupo.dataset.maximo || 30);
    items.forEach((it, i) => {
      $('[data-numero]', it).textContent = `${grupo.dataset.etiqueta} ${i + 1}`;
      $('[data-hv=quitar-item]', it).hidden = items.length <= min;
    });
    $('[data-hv=agregar-item]', grupo).hidden = items.length >= max;
    const vacio = $('[data-items-vacio]', grupo);
    if (vacio) vacio.hidden = items.length > 0;
  }
  function agregarItem(grupo) {
    const lista = $('[data-items]', grupo), plantilla = $('template[data-plantilla]', grupo);
    lista.appendChild(plantilla.content.cloneNode(true));
    renumerar(grupo);
    const nuevo = lista.lastElementChild;
    nuevo.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    const primero = $('input, select, textarea', nuevo);
    if (primero) primero.focus();
  }
  // Códigos de precio de una obra: filas { producto, codigo, notas } (se ignoran las filas vacías)
  const filasPrecio = (it) => Array.from(it.querySelectorAll('[data-precio]'))
    .map(f => ({ fila: f, producto: $('[data-producto]', f).value.trim(), codigo: $('[data-codigo]', f).value, notas: ($('[data-notas]', f) || { value: '' }).value.trim() }))
    .filter(f => f.producto || f.codigo || f.notas);
  const itemVacio = (it) => Array.from(it.querySelectorAll('[data-campo]')).every(el => !String(el.value).trim()) && !filasPrecio(it).length;
  function actualizarPrecios(bloque) {
    const n = bloque.querySelectorAll('[data-precio]').length;
    $('[data-precios-vacio]', bloque).hidden = n > 0;
    $('[data-hv=agregar-precio]', bloque).hidden = n >= Number(bloque.dataset.maximo || 20);
  }
  function agregarPrecio(bloque) {
    const plantilla = document.getElementById('hv-plantilla-precio');
    if (!plantilla) return;
    $('[data-precios-lista]', bloque).appendChild(plantilla.content.cloneNode(true));
    actualizarPrecios(bloque);
    const filas = bloque.querySelectorAll('[data-precio]');
    $('[data-producto]', filas[filas.length - 1]).focus();
  }

  contenido.addEventListener('click', (e) => {
    const b = e.target.closest('[data-hv]');
    if (!b) return;
    if (b.dataset.hv === 'editar') cargar({ editar: '1' });
    if (b.dataset.hv === 'cancelar') cargar();
    if (b.dataset.hv === 'agregar-item') agregarItem(b.closest('[data-repetible]'));
    if (b.dataset.hv === 'agregar-precio') agregarPrecio(b.closest('[data-precios]'));
    if (b.dataset.hv === 'quitar-precio') {
      const bloque = b.closest('[data-precios]'), fila = b.closest('[data-precio]');
      const siguiente = fila.nextElementSibling || fila.previousElementSibling;
      fila.remove(); actualizarPrecios(bloque);
      (siguiente ? $('[data-producto]', siguiente) : $('[data-hv=agregar-precio]', bloque)).focus();
    }
    if (b.dataset.hv === 'quitar-item') {
      const it = b.closest('[data-item]'), grupo = b.closest('[data-repetible]');
      if (!itemVacio(it) && !confirm(`¿Quitar esta ${grupo.dataset.etiqueta.toLowerCase()}? Se borra al guardar.`)) return;
      it.remove(); renumerar(grupo);
    }
  });
  // Al cargar un formulario (página completa o fragmento) se ajustan numeración y botones
  const prepararFormulario = () => document.querySelectorAll('#hv-form [data-repetible]').forEach(renumerar);
  prepararFormulario();
  new MutationObserver(prepararFormulario).observe(contenido, { childList: true });
  contenido.addEventListener('submit', async (e) => {
    if (e.target.id !== 'hv-form') return;
    e.preventDefault();
    const form = e.target, error = $('.error', form), boton = $('button[type=submit]', form);
    // Campos obligatorios: los bloques repetibles totalmente vacíos no se revisan (el servidor los ignora),
    // salvo que no haya ningún bloque con datos y la sección exija un mínimo.
    const grupos = Array.from(form.querySelectorAll('[data-repetible]'));
    const revisar = Array.from(form.elements).filter(el => {
      if (!el.required || el.readOnly) return false;
      const it = el.closest('[data-item]');
      if (!it) return true;
      const grupo = it.closest('[data-repetible]'), items = Array.from(grupo.querySelectorAll('[data-items] > [data-item]'));
      const conDatos = items.filter(x => !itemVacio(x));
      return !itemVacio(it) || (!conDatos.length && Number(grupo.dataset.minimo || 0) > 0 && it === items[0]);
    });
    const faltante = revisar.find(el => !String(el.value).trim());
    if (faltante) {
      error.textContent = 'Completa los campos marcados con *.'; error.hidden = false; faltante.focus();
      return;
    }
    // Cada código de precio necesita tipo de producto y código
    for (const it of form.querySelectorAll('[data-item]')) {
      const incompleta = filasPrecio(it).find(f => !f.producto || !f.codigo);
      if (incompleta) {
        error.textContent = incompleta.producto ? `Elige el código de precio de "${incompleta.producto}".` : 'Escribe el tipo de producto de cada código de precio.';
        error.hidden = false; $(incompleta.producto ? '[data-codigo]' : '[data-producto]', incompleta.fila).focus();
        return;
      }
    }
    const body = {};
    for (const el of form.elements) if (el.name) body[el.name] = el.value;
    for (const grupo of grupos) {
      body[grupo.dataset.repetible] = Array.from(grupo.querySelectorAll('[data-items] > [data-item]')).filter(it => !itemVacio(it)).map(it => {
        const item = { id: it.dataset.id || '' };
        it.querySelectorAll('[data-campo]').forEach(el => { item[el.dataset.campo] = el.value; });
        it.querySelectorAll('[data-precios]').forEach(bloque => { item[bloque.dataset.precios] = filasPrecio(bloque).map(f => ({ producto: f.producto, codigo: f.codigo, notas: f.notas })); });
        return item;
      });
    }
    boton.disabled = true; error.hidden = true;
    try {
      const existia = $('.hv-hoja', contenido).dataset.existe === '1';
      await pedir(`/hv/${estado.celular}?${consulta({ fragmento: '0' })}`, { body });
      await cargar();
      avisar(existia ? 'Hoja de vida actualizada' : 'Hoja de vida creada');
    } catch (err) {
      if (err.sesion && MODO === 'puente' && chat) {
        try { await chat.reconectar(); boton.disabled = false; form.requestSubmit(); return; } catch (e2) { err.message = e2.message; }
      }
      error.textContent = err.message; error.hidden = false; boton.disabled = false;
    }
  });

  // ---------- conexión con Chatwoot (solo en /hv) ----------
  if (MODO !== 'puente') return;
  chat = HV.conectarChatwoot({
    origen: raiz.dataset.chatwootOrigin, clave: raiz.dataset.clave, contenido,
    alContacto: async ({ celular, contactoId, contactoNombre, cambio }) => {
      estado.contactoId = contactoId; estado.contactoNombre = contactoNombre;
      if (!cambio && $('.hv-hoja', contenido)) return; // mismo contacto: no se recarga lo que se está editando
      estado.celular = celular;
      await cargar();
    },
  });
})();
