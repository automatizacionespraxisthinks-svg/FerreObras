// Filas de la lista clicables
document.querySelectorAll('tr.fila[data-href]').forEach(tr => {
  tr.addEventListener('click', (ev) => { if (ev.target.tagName !== 'A') window.location = tr.dataset.href; });
});
// Al marcar "Vendida" o "Sin venta" sin fecha real, sugiere la fecha programada
document.querySelectorAll('form.etapa').forEach(f => {
  const estado = f.querySelector('select.estado'), real = f.querySelector('input[name=fecha_real]'), prog = f.querySelector('input[name=fecha_programada]');
  if (!estado || !real) return;
  estado.addEventListener('change', () => { if (estado.value !== 'pendiente' && !real.value) real.value = prog.value; });
});
