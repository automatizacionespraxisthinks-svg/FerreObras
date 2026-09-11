// Catálogo de municipios de Boyacá (cabecera municipal) y sedes de FerreAceros.
// Coordenadas tomadas de OpenStreetMap (Nominatim). Permite ubicar paradas y clientes sin
// depender de un servicio externo y reconocer un municipio aunque venga escrito sin tildes,
// en mayúsculas o con variantes ("VILLA DE LEIVA", "santa rosa ").
const SEDES = [
  { clave: 'duitama', nombre: 'Sede Duitama', direccion: 'Calle 22 N° 40-08, Av. Camilo Torres, Duitama', lat: 5.81382, lng: -73.01821 },
  { clave: 'sogamoso', nombre: 'Sede Sogamoso', direccion: 'Km 0 vía Sogamoso – Tibasosa, Río Chiquito', lat: 5.70983, lng: -72.95764 },
  { clave: 'planta', nombre: 'Planta de Figuración', direccion: 'Ciudadela Industrial, Calle 3 N° 3A-45, Duitama', lat: 5.79301, lng: -73.06355 },
];

// [nombre, lat, lng]
const DATOS = [
  ['Almeida', 4.97116, -73.37882],
  ['Aquitania', 5.51758, -72.88315],
  ['Arcabuco', 5.75430, -73.43641],
  ['Belén', 5.98945, -72.91331],
  ['Berbeo', 5.22614, -73.12650],
  ['Betéitiva', 5.92237, -72.85903],
  ['Boavita', 6.33216, -72.60951],
  ['Boyacá', 5.45452, -73.36154],
  ['Briceño', 5.69087, -73.92345],
  ['Buenavista', 5.51165, -73.94311],
  ['Busbanzá', 5.83078, -72.88389],
  ['Caldas', 5.55459, -73.86546],
  ['Campohermoso', 5.03154, -73.10445],
  ['Cerinza', 5.95588, -72.94789],
  ['Chinavita', 5.20624, -73.33496],
  ['Chiquinquirá', 5.62349, -73.82095],
  ['Chíquiza', 5.60533, -73.48492],
  ['Chiscas', 6.55351, -72.50039],
  ['Chita', 6.18720, -72.47294],
  ['Chitaraque', 6.02798, -73.44693],
  ['Chivatá', 5.55734, -73.28304],
  ['Chivor', 4.88867, -73.36948],
  ['Ciénega', 5.40975, -73.29548],
  ['Cómbita', 5.63369, -73.32435],
  ['Coper', 5.47580, -74.04522],
  ['Corrales', 5.82984, -72.84390],
  ['Covarachía', 6.50095, -72.73829],
  ['Cubará', 7.00201, -72.10892],
  ['Cucaita', 5.54312, -73.45478],
  ['Cuítiva', 5.58028, -72.96616],
  ['Duitama', 5.82770, -73.03389],
  ['El Cocuy', 6.40767, -72.44575],
  ['El Espino', 6.48256, -72.49520],
  ['Firavitoba', 5.66919, -72.99339],
  ['Floresta', 5.85983, -72.91882],
  ['Gachantivá', 5.75161, -73.54828],
  ['Gámeza', 5.80195, -72.80497],
  ['Garagoa', 5.08222, -73.36431],
  ['Guacamayas', 6.45991, -72.50116],
  ['Guateque', 5.00629, -73.47313],
  ['Guayatá', 4.96478, -73.49073],
  ['Güicán', 6.46168, -72.41199],
  ['Iza', 5.61230, -72.97948],
  ['Jenesano', 5.38543, -73.36443],
  ['Jericó', 6.14642, -72.57041],
  ['La Capilla', 5.09579, -73.44469],
  ['La Uvita', 6.31805, -72.56033],
  ['La Victoria', 5.52354, -74.23465],
  ['Labranzagrande', 5.56291, -72.57799],
  ['Macanal', 4.97230, -73.32002],
  ['Maripí', 5.55080, -74.00404],
  ['Miraflores', 5.19547, -73.14396],
  ['Mongua', 5.75532, -72.79826],
  ['Monguí', 5.72220, -72.84944],
  ['Moniquirá', 5.87631, -73.57321],
  ['Motavita', 5.57634, -73.36740],
  ['Muzo', 5.53213, -74.10278],
  ['Nobsa', 5.77056, -72.93975],
  ['Nuevo Colón', 5.35497, -73.45722],
  ['Oicatá', 5.59443, -73.30815],
  ['Otanche', 5.66000, -74.18166],
  ['Pachavita', 5.14054, -73.39815],
  ['Páez', 5.10201, -73.05218],
  ['Paipa', 5.78127, -73.11765],
  ['Pajarito', 5.29321, -72.70277],
  ['Panqueba', 6.44267, -72.45903],
  ['Pauna', 5.65737, -73.97894],
  ['Paya', 5.62498, -72.42344],
  ['Paz de Río', 5.98529, -72.74910],
  ['Pesca', 5.55828, -73.05148],
  ['Pisba', 5.71984, -72.48587],
  ['Puerto Boyacá', 5.97564, -74.58828],
  ['Quípama', 5.52297, -74.18125],
  ['Ramiriquí', 5.40051, -73.33588],
  ['Ráquira', 5.53801, -73.63222],
  ['Rondón', 5.35821, -73.20828],
  ['Saboyá', 5.69753, -73.76568],
  ['Sáchica', 5.57777, -73.53993],
  ['Samacá', 5.49179, -73.48529],
  ['San Eduardo', 5.22352, -73.07717],
  ['San José de Pare', 6.01762, -73.54785],
  ['San Luis de Gaceno', 4.82063, -73.16787],
  ['San Mateo', 6.40176, -72.55598],
  ['San Miguel de Sema', 5.51899, -73.72300],
  ['San Pablo de Borbur', 5.65169, -74.06970],
  ['Santa María', 4.86138, -73.26188],
  ['Santa Rosa de Viterbo', 5.87448, -72.98236],
  ['Santa Sofía', 5.71359, -73.60315],
  ['Santana', 6.05749, -73.48216],
  ['Sativanorte', 6.13192, -72.70760],
  ['Sativasur', 6.09354, -72.71269],
  ['Siachoque', 5.51307, -73.24489],
  ['Soatá', 6.33519, -72.68036],
  ['Socha', 5.99749, -72.69115],
  ['Socotá', 6.04124, -72.63659],
  ['Sogamoso', 5.71483, -72.92793],
  ['Somondoco', 4.98596, -73.43262],
  ['Sora', 5.56685, -73.44992],
  ['Soracá', 5.50113, -73.33287],
  ['Sotaquirá', 5.76545, -73.24782],
  ['Susacón', 6.23108, -72.69039],
  ['Sutamarchán', 5.62048, -73.62044],
  ['Sutatenza', 5.02311, -73.45082],
  ['Tasco', 5.90998, -72.78124],
  ['Tenza', 5.07673, -73.41979],
  ['Tibaná', 5.31799, -73.39661],
  ['Tibasosa', 5.74559, -73.00355],
  ['Tinjacá', 5.57957, -73.64674],
  ['Tipacoque', 6.42122, -72.69139],
  ['Toca', 5.56511, -73.18468],
  ['Togüí', 5.93776, -73.51308],
  ['Tópaga', 5.76889, -72.83204],
  ['Tota', 5.56105, -72.98589],
  ['Tunja', 5.53243, -73.36160],
  ['Tununguá', 5.73002, -73.93299],
  ['Turmequé', 5.32409, -73.49058],
  ['Tuta', 5.69022, -73.22772],
  ['Tutazá', 6.07399, -72.86242],
  ['Úmbita', 5.22123, -73.45704],
  ['Ventaquemada', 5.36662, -73.52164],
  ['Villa de Leyva', 5.63382, -73.52397],
  ['Viracachá', 5.43502, -73.29617],
  ['Zetaquira', 5.28189, -73.16782]
];

// Variantes frecuentes en las agendas
const ALIAS = {
  'Villa de Leyva': ['villa de leiva', 'villa leyva', 'villa leiva'],
  'Santa Rosa de Viterbo': ['santa rosa'],
  'Güicán': ['guican de la sierra'],
  'Paz de Río': ['paz del rio'],
  'El Cocuy': ['cocuy'],
  'La Uvita': ['uvita'],
  'Sativanorte': ['sativa norte'],
  'Sativasur': ['sativa sur'],
  'Chíquiza': ['san pedro de iguaque'],
};
// Nombres que también son barrios, calles o palabras comunes: en direcciones libres no se detectan
const AMBIGUOS = new Set(['boyaca', 'floresta', 'caldas', 'buenavista', 'miraflores', 'la victoria', 'santa maria', 'belen', 'la capilla', 'el espino', 'santana', 'paya', 'pesca', 'tota', 'iza', 'santa rosa', 'toca', 'chita', 'coper']);

const normalizar = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').trim();

const MUNICIPIOS = DATOS.map(([nombre, lat, lng]) => ({ nombre, clave: normalizar(nombre), lat, lng }));
const porVariante = new Map();
for (const m of MUNICIPIOS) {
  porVariante.set(m.clave, m);
  for (const a of ALIAS[m.nombre] || []) porVariante.set(normalizar(a), m);
}
const variantes = [...porVariante.entries()].filter(([v]) => !AMBIGUOS.has(v));

const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'el']);
const tipoTitulo = (s) => s.toLowerCase().replace(/\S+/g, (w, i) => (i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)));

/** Municipio del catálogo que corresponde exactamente al texto (o a una variante conocida). */
function buscar(texto) { return porVariante.get(normalizar(texto)) || null; }
/** Clave para comparar municipios: la del catálogo si existe, si no el texto normalizado. */
function clave(texto) { const m = buscar(texto); return m ? m.clave : normalizar(texto); }
/** Nombre para mostrar: el del catálogo (con tildes) o el texto limpio en tipo título. */
function nombre(texto) {
  const m = buscar(texto);
  if (m) return m.nombre;
  const limpio = String(texto == null ? '' : texto).replace(/\s+/g, ' ').trim();
  return limpio && (limpio === limpio.toUpperCase() || limpio === limpio.toLowerCase()) ? tipoTitulo(limpio) : limpio;
}
/**
 * Municipio mencionado en textos libres (por ejemplo "Obra o municipio" y direcciones).
 * Primero busca coincidencias exactas en cualquier texto; después, nombres completos dentro
 * del texto, prefiriendo el que aparece más al final ("Barrio Santa Inés, Tunja").
 */
function detectar(textos) {
  const lista = textos.map(normalizar).filter(Boolean);
  for (const t of lista) { const m = porVariante.get(t); if (m) return m; }
  for (const t of lista) {
    const envuelto = ` ${t} `;
    let mejor = null, fin = -1;
    for (const [v, m] of variantes) {
      const i = envuelto.lastIndexOf(` ${v} `);
      if (i >= 0 && (i + v.length > fin || (i + v.length === fin && v.length > mejor.v.length))) { mejor = { m, v }; fin = i + v.length; }
    }
    if (mejor) return mejor.m;
  }
  return null;
}
const sede = (c) => SEDES.find(s => s.clave === c) || null;

module.exports = { SEDES, MUNICIPIOS, normalizar, buscar, clave, nombre, detectar, sede };
