// Comportamiento común de todas las páginas (sin dependencias).
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  // Menú en pantallas pequeñas
  const btnMenu = $('.menu-btn'), nav = $('#nav-principal');
  if (btnMenu && nav) {
    btnMenu.addEventListener('click', () => {
      const abierto = nav.classList.toggle('abierto');
      btnMenu.setAttribute('aria-expanded', String(abierto));
      btnMenu.setAttribute('aria-label', abierto ? 'Cerrar menú' : 'Abrir menú');
      document.body.classList.toggle('menu-abierto', abierto);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('abierto')) btnMenu.click(); });
  }

  // Aviso (toast): se cierra solo y limpia el parámetro msg de la URL
  const toast = $('.toast');
  if (toast) {
    const cerrar = () => { toast.classList.add('oculto'); setTimeout(() => toast.remove(), 300); };
    $('.toast-cerrar', toast).addEventListener('click', cerrar);
    setTimeout(cerrar, 6000);
    if (window.history && window.history.replaceState) {
      const url = new URL(window.location.href);
      if (url.searchParams.has('msg')) { url.searchParams.delete('msg'); window.history.replaceState(null, '', url.pathname + (url.search || '') + url.hash); }
    }
  }

  // Confirmaciones (formularios y botones con data-confirmar)
  $$('form[data-confirmar]').forEach(f => f.addEventListener('submit', (e) => { if (!confirm(f.dataset.confirmar)) e.preventDefault(); }));
  $$('button[data-confirmar]').forEach(b => b.addEventListener('click', (e) => { if (!confirm(b.dataset.confirmar)) e.preventDefault(); }));

  // Filas de la lista clicables (sin interferir con enlaces o botones)
  $$('tr.fila[data-href]').forEach(tr => {
    tr.addEventListener('click', (ev) => { if (ev.target.closest('a, button, input, select, label')) return; window.location = tr.dataset.href; });
    tr.tabIndex = 0;
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') window.location = tr.dataset.href; });
  });

  // Búsqueda instantánea en la lista de obras
  const buscador = $('#buscar-obras'), tablaObras = $('#tabla-obras');
  if (buscador && tablaObras) {
    const filas = $$('tbody tr', tablaObras), conteo = $('#conteo-obras'), vacio = $('#sin-resultados');
    const normalizar = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    buscador.addEventListener('input', () => {
      const q = normalizar(buscador.value.trim());
      let visibles = 0;
      filas.forEach(tr => { const ok = !q || normalizar(tr.dataset.buscar || '').includes(q); tr.hidden = !ok; if (ok) visibles++; });
      if (conteo) conteo.textContent = `${visibles} obra${visibles === 1 ? '' : 's'}`;
      if (vacio) vacio.hidden = visibles > 0;
    });
  }

  // Detalle de obra: al marcar "Vendida" o "Sin venta" sin fecha real, sugiere la programada;
  // al marcar un producto, resalta la fila y enfoca el detalle.
  $$('form.etapa').forEach(f => {
    const estado = $('select.estado', f), real = $('input[name=fecha_real]', f), prog = $('input[name=fecha_programada]', f);
    if (estado && real && prog) estado.addEventListener('change', () => { if (estado.value !== 'pendiente' && !real.value) real.value = prog.value; });
    $$('.venta', f).forEach(v => {
      const check = $('input[type=checkbox]', v), detalle = $('input.detalle', v);
      if (!check) return;
      check.addEventListener('change', () => { v.classList.toggle('marcada', check.checked); if (check.checked && detalle) detalle.focus(); });
    });
    // marca el formulario como modificado para que no pase desapercibido el botón Guardar
    f.addEventListener('input', () => f.classList.add('modificada'), { once: true });
  });

  // Línea de tiempo: desplazamiento suave y resaltado de la etapa
  $$('.linea-tiempo .nodo').forEach(a => a.addEventListener('click', (e) => {
    const destino = $(a.getAttribute('href'));
    if (!destino) return;
    e.preventDefault();
    destino.scrollIntoView({ behavior: 'smooth', block: 'start' });
    destino.classList.add('resaltada'); setTimeout(() => destino.classList.remove('resaltada'), 1600);
  }));
  if (location.hash && location.hash.startsWith('#etapa-')) { const d = $(location.hash); if (d) { d.classList.add('resaltada'); setTimeout(() => d.classList.remove('resaltada'), 1600); } }
})();
