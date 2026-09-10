// Avisa a n8n sin bloquear la respuesta al usuario. Si n8n no responde, se registra y se sigue.
async function post(url, payload) {
  if (!url) return;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
    if (!r.ok) console.error('[n8n]', url, r.status, await r.text().catch(() => ''));
  } catch (e) { console.error('[n8n] no respondió', url, e.message); }
}
module.exports = {
  calendar: (evento, obra_id, extra = {}) => post(process.env.N8N_WEBHOOK_CALENDAR, { evento, obra_id, ...extra, ts: new Date().toISOString() }),
  cierre:   (obra_id, extra = {}) => post(process.env.N8N_WEBHOOK_CIERRE, { evento: 'obra_cerrada', obra_id, ...extra, ts: new Date().toISOString() }),
};
