// Avisa a n8n sin bloquear la respuesta al usuario. Si n8n no responde, se registra y se sigue.
async function post(url, payload) {
  if (!url) return;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
    if (!r.ok) console.error('[n8n]', url, r.status, await r.text().catch(() => ''));
  } catch (e) { console.error('[n8n] no respondió', url, e.message); }
}
// Envía y espera la respuesta de n8n (la agenda necesita el id del evento que n8n crea en Google Calendar).
// Devuelve { configurado, ok, datos | error }; nunca lanza.
async function postConRespuesta(url, payload, timeoutMs = 15000) {
  if (!url) return { configurado: false, ok: false, error: 'N8N_WEBHOOK_AGENDA no está definida' };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
    const texto = await r.text().catch(() => '');
    if (!r.ok) { console.error('[n8n]', url, r.status, texto); return { configurado: true, ok: false, error: `n8n respondió ${r.status}` }; }
    let datos = null;
    try { datos = texto ? JSON.parse(texto) : null; } catch (e) { /* respuesta sin JSON: se acepta sin datos */ }
    if (Array.isArray(datos)) datos = datos[0] || null; // n8n suele responder con una lista de un elemento
    return { configurado: true, ok: true, datos: datos && typeof datos === 'object' ? datos : {} };
  } catch (e) { console.error('[n8n] no respondió', url, e.message); return { configurado: true, ok: false, error: e.name === 'TimeoutError' ? 'n8n no respondió a tiempo' : e.message }; }
}
module.exports = {
  calendar: (evento, obra_id, extra = {}) => post(process.env.N8N_WEBHOOK_CALENDAR, { evento, obra_id, ...extra, ts: new Date().toISOString() }),
  cierre:   (obra_id, extra = {}) => post(process.env.N8N_WEBHOOK_CIERRE, { evento: 'obra_cerrada', obra_id, ...extra, ts: new Date().toISOString() }),
  agenda:   (evento, tarea) => postConRespuesta(process.env.N8N_WEBHOOK_AGENDA, { evento, tarea, ts: new Date().toISOString() }),
};
