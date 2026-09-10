// Cálculo de fechas de etapas. Todo en fechas "YYYY-MM-DD" sin zona horaria.
function toISO(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function diffDays(a, b) { // b - a en días
  const [ay, am, ad] = a.split('-').map(Number), [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
function hoyBogota() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }); }

/**
 * Recalcula fecha_programada y fecha_aviso de todas las etapas.
 *  - La etapa 0 (cimentación) conserva su fecha y no tiene aviso.
 *  - Cada etapa siguiente = (fecha_real o fecha_programada de la anterior) + intervalo_dias,
 *    salvo que la asesora la haya fijado a mano (fecha_fija) o ya tenga fecha_real.
 *  - fecha_aviso = fecha (real o programada) - dias_aviso.
 */
function recalcular(etapas) {
  const list = [...etapas].sort((a, b) => a.orden - b.orden).map(e => ({ ...e,
    fecha_programada: toISO(e.fecha_programada), fecha_real: toISO(e.fecha_real), fecha_aviso: toISO(e.fecha_aviso) }));
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (i === 0) { e.fecha_aviso = null; continue; }
    const prev = list[i - 1];
    const base = prev.fecha_real || prev.fecha_programada;
    if (!e.fecha_real && !e.fecha_fija) e.fecha_programada = addDays(base, e.intervalo_dias);
    e.fecha_aviso = addDays(e.fecha_real || e.fecha_programada, -e.dias_aviso);
  }
  return list;
}

/** Etapas iniciales de una obra nueva: Cimentación + N placas. */
function etapasIniciales({ fecha_cimentacion, num_placas, intervalo_dias, dias_aviso }) {
  const etapas = [{ orden: 0, nombre: 'Cimentación', intervalo_dias: 0, dias_aviso, fecha_programada: toISO(fecha_cimentacion), fecha_fija: true }];
  for (let i = 1; i <= num_placas; i++) etapas.push({ orden: i, nombre: `Placa ${i}`, intervalo_dias, dias_aviso, fecha_programada: null, fecha_fija: false });
  return recalcular(etapas);
}
module.exports = { toISO, addDays, diffDays, hoyBogota, recalcular, etapasIniciales };
