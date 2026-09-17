// Cliente mínimo de la API de Chatwoot para la agenda del cliente: lista de etiquetas de la cuenta y etiquetas de
// una conversación. El token (CHATWOOT_API_TOKEN) solo vive en el servidor; el navegador nunca lo ve.
//
// Asignar o quitar una etiqueta aquí equivale a hacerlo en Chatwoot: Chatwoot dispara el webhook conversation_updated
// y el flujo "Crear Seguimiento Etiquetas" de n8n crea o elimina el seguimiento automático.
const leer = (n) => String(process.env[n] || '').replace(/\r|\n/g, '').trim().replace(/^(["'])(.*)\1$/, '$2');

const BASE = (leer('CHATWOOT_API_URL') || leer('CHATWOOT_ORIGIN') || 'https://ferreaceros.praxisia.org').replace(/\/+$/, '');
const CUENTA = /^\d+$/.test(leer('CHATWOOT_ACCOUNT_ID')) ? leer('CHATWOOT_ACCOUNT_ID') : '1';
const TOKEN = leer('CHATWOOT_API_TOKEN');
// Solo se ofrecen las etiquetas que empiezan por este prefijo (las de seguimiento). Vacío = todas las etiquetas.
const PREFIJO = process.env.CHATWOOT_ETIQUETAS_PREFIJO == null ? 'seg_' : leer('CHATWOOT_ETIQUETAS_PREFIJO');
const CACHE_MS = 5 * 60 * 1000;

const configurado = () => !!TOKEN;
if (!TOKEN) console.warn('[chatwoot] CHATWOOT_API_TOKEN no está definida: la agenda no podrá asignar etiquetas de seguimiento');

async function llamar(ruta, { method = 'GET', body } = {}) {
  if (!TOKEN) { const e = new Error('Falta configurar CHATWOOT_API_TOKEN en el servidor.'); e.sinConfigurar = true; throw e; }
  let r;
  try {
    r = await fetch(`${BASE}/api/v1/accounts/${CUENTA}${ruta}`, {
      method, headers: { api_access_token: TOKEN, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    console.error('[chatwoot] no respondió', ruta, e.message);
    throw new Error('Chatwoot no respondió. Intenta de nuevo en un momento.');
  }
  const texto = await r.text().catch(() => '');
  if (!r.ok) {
    console.error('[chatwoot]', method, ruta, r.status, texto.slice(0, 300));
    const e = new Error(r.status === 404 ? 'La conversación no existe en Chatwoot.' : r.status === 401 ? 'Chatwoot rechazó el token (CHATWOOT_API_TOKEN).' : `Chatwoot respondió con error ${r.status}.`);
    e.estado = r.status;
    throw e;
  }
  try { return texto ? JSON.parse(texto) : {}; } catch (e) { return {}; }
}

const esDeSeguimiento = (titulo) => !PREFIJO || String(titulo).startsWith(PREFIJO);

let cache = { hasta: 0, lista: null };
// Etiquetas de la cuenta que se pueden asignar desde la agenda: [{ nombre, descripcion, color }]
async function etiquetasDisponibles(forzar) {
  if (!forzar && cache.lista && cache.hasta > Date.now()) return cache.lista;
  const d = await llamar('/labels');
  const lista = (Array.isArray(d.payload) ? d.payload : Array.isArray(d) ? d : [])
    .filter(l => l && l.title && esDeSeguimiento(l.title))
    .map(l => ({ nombre: String(l.title), descripcion: String(l.description || ''), color: /^#[0-9a-f]{3,8}$/i.test(l.color || '') ? l.color : '' }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  cache = { hasta: Date.now() + CACHE_MS, lista };
  return lista;
}

// Datos de la conversación que necesita la agenda: etiquetas actuales y datos del contacto
async function conversacion(id) {
  const c = await llamar(`/conversations/${id}`);
  const sender = (c.meta && c.meta.sender) || {};
  return {
    id: c.id, etiquetas: Array.isArray(c.labels) ? c.labels.map(String) : [],
    telefono: sender.phone_number || '', jid: (sender.custom_attributes || {}).waha_whatsapp_jid || '',
  };
}

// Reemplaza la lista completa de etiquetas de la conversación (así funciona la API de Chatwoot)
async function fijarEtiquetas(id, etiquetas) {
  const d = await llamar(`/conversations/${id}/labels`, { method: 'POST', body: { labels: etiquetas } });
  return Array.isArray(d.payload) ? d.payload.map(String) : etiquetas;
}

module.exports = { configurado, etiquetasDisponibles, conversacion, fijarEtiquetas, esDeSeguimiento, PREFIJO };
