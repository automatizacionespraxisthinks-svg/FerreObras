// Común a las vistas embebidas en Chatwoot (hoja de vida y agenda del cliente): peticiones a la API,
// avisos, normalización del celular y el handshake con Chatwoot (modo "puente").
// Se carga antes que hv.js / hv_agenda.js y deja todo en window.FerreHv.
window.FerreHv = (function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MENSAJE_SIN_CHATWOOT = '<p>Abre esta ficha desde <b>Chatwoot</b>, en la pestaña de la conversación.</p>';

  function avisar(msg, error) {
    const t = $('#hv-toast');
    if (!t) return;
    t.textContent = msg; t.classList.toggle('error', !!error); t.hidden = false;
    clearTimeout(avisar.t); avisar.t = setTimeout(() => { t.hidden = true; }, error ? 7000 : 3500);
  }
  function mostrarEstado(contenido, html, clase) {
    contenido.innerHTML = `<div class="hv-estado ${clase || ''}">${html}</div>`;
  }
  // Normaliza "+57 312…", "573123323123@c.us" -> 10 dígitos (igual que el servidor)
  function normalizarCelular(v) {
    let d = String(v == null ? '' : v).split('@')[0].replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('57')) d = d.slice(2);
    return /^\d{10}$/.test(d) ? d : null;
  }
  // Petición a la API con la cabecera que exige el servidor para modificar datos. Lanza Error con .sesion en 401.
  async function pedir(url, opts) {
    const o = opts || {};
    const r = await fetch(url, {
      method: o.body !== undefined ? 'POST' : 'GET', credentials: 'include',
      headers: Object.assign({ 'X-FerreObras': 'hv' }, o.body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : {}),
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    const tipo = r.headers.get('Content-Type') || '';
    const datos = tipo.includes('application/json') ? await r.json().catch(() => null) : await r.text();
    if (!r.ok) {
      const err = new Error((datos && datos.error) || 'No se pudo completar la operación. Intenta de nuevo.');
      err.sesion = r.status === 401; err.estado = r.status; err.datos = datos;
      throw err;
    }
    return datos;
  }

  // Handshake con Chatwoot (solo en la página puente): pide el contexto, verifica el origen del mensaje, crea la
  // sesión de agente (POST /hv/sesion) y avisa a la vista cada vez que cambia el contacto.
  // o = { origen, clave, contenido, alContacto({ celular, contactoId, contactoNombre, conversacionId, cambio }) }
  // Devuelve { estado, reconectar } (reconectar vuelve a crear la sesión con el último contexto recibido).
  function conectarChatwoot(o) {
    const estado = { celular: '', contactoId: '', contactoNombre: '', conversacionId: '', agente: '', sesionLista: false, ultimoContexto: null, recibido: false };
    async function crearSesion(ctx) {
      const agente = ctx.currentAgent || {};
      const r = await pedir('/hv/sesion', { body: { k: o.clave, agente: { email: agente.email, name: agente.name, id: agente.id } } });
      estado.agente = r.agente; estado.sesionLista = true;
    }
    async function reconectar() {
      if (!estado.ultimoContexto) throw new Error('Chatwoot no ha enviado el contexto de la conversación.');
      await crearSesion(estado.ultimoContexto);
    }
    async function aplicarContexto(ctx) {
      const contacto = ctx.contact || {}, atributos = contacto.custom_attributes || {};
      const celular = normalizarCelular(contacto.phone_number) || normalizarCelular(atributos.waha_whatsapp_jid);
      const cambio = celular !== estado.celular || String(contacto.id || '') !== estado.contactoId;
      estado.ultimoContexto = ctx;
      estado.contactoId = contacto.id ? String(contacto.id) : '';
      estado.contactoNombre = contacto.name || '';
      estado.conversacionId = ctx.conversation && ctx.conversation.id ? String(ctx.conversation.id) : '';
      if (!celular) {
        estado.celular = '';
        const bruto = contacto.phone_number || atributos.waha_whatsapp_jid;
        mostrarEstado(o.contenido, bruto
          ? `<p>El número del contacto (<b>${esc(bruto)}</b>) no es un celular de 10 dígitos. Corrígelo en la ficha del contacto.</p>`
          : '<p>Este contacto no tiene número de teléfono; agrégalo en la ficha del contacto.</p>', 'aviso');
        return;
      }
      estado.celular = celular;
      try {
        if (!estado.sesionLista) await crearSesion(ctx);
        await o.alContacto({ celular, contactoId: estado.contactoId, contactoNombre: estado.contactoNombre, conversacionId: estado.conversacionId, cambio });
      } catch (e) { mostrarEstado(o.contenido, `<p>${esc(e.message)}</p>`, 'error'); }
    }
    window.addEventListener('message', (ev) => {
      if (ev.origin !== o.origen) return; // mensajes de otro origen se ignoran
      let msg = ev.data;
      if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch (e) { return; } }
      if (!msg || msg.event !== 'appContext' || !msg.data) return;
      estado.recibido = true;
      aplicarContexto(msg.data);
    });
    if (window.parent === window) {
      mostrarEstado(o.contenido, MENSAJE_SIN_CHATWOOT, 'aviso');
      return { estado, reconectar };
    }
    window.parent.postMessage('chatwoot-dashboard-app:fetch-info', '*');
    // Si en unos segundos no llega un contexto válido de Chatwoot (no está embebido allí o el origen no coincide)
    setTimeout(() => { if (!estado.recibido) mostrarEstado(o.contenido, MENSAJE_SIN_CHATWOOT, 'aviso'); }, 4000);
    return { estado, reconectar };
  }

  return { $, $$, esc, avisar, mostrarEstado, normalizarCelular, pedir, conectarChatwoot };
})();
