/* ==========================================================================
   TissueBank — data.js
   Cliente real de la API (antes: simulación en memoria).

   Mismo contrato público que la versión anterior (API.* con los mismos
   nombres/parámetros) pero cada función ahora hace fetch() contra el
   backend real. app.js consume estas funciones con `await` — ver el
   comentario en app.js sobre la conversión a async.

   Asunciones hechas por falta de contrato exacto de payloads (ajustar aquí
   si el backend real difiere):
   - Login: 401/400 = credenciales inválidas (null); 403 = cuenta
     desactivada ({inactive:true}). Si el backend usa otro código, ajustar
     en auth.login().
   - POST /doctors y POST /doctors/{id}/reset-password devuelven la
     contraseña temporal en texto plano en el campo `password` del body
     de respuesta (necesario para mostrarla una sola vez en el modal de
     credenciales).
   - Username duplicado en POST /doctors → se asume HTTP 409.
   - PUT /matches/{id}/doctor-response recibe { status, decided_by,
     rejection_reason } usando el mismo vocabulario de `status` definido
     en schema.sql (aprobado_doctor / rechazado_doctor).
   - Las rutas sin filtro por servidor (listar solicitudes de un doctor,
     implantes de un donante, matches/asignaciones/despachos por estado,
     buscar IPS por nombre) se resuelven trayendo la lista completa desde
     la API y filtrando en el cliente, porque no hay query params
     documentados para eso. Si el backend agrega esos filtros, esto se
     puede optimizar para no traer todo cada vez.
   - PUT de recursos que en el contrato viejo eran "actualizaciones
     parciales" (perfil de doctor, implante) primero hace GET del recurso
     y mergea los campos antes del PUT, para no pisar columnas que la
     UI no envía.
   ========================================================================== */

(function(){

const API_BASE = 'https://dml5behlp3.execute-api.us-east-1.amazonaws.com';
const TOKEN_KEY = 'tissuebank_token';
const USER_KEY = 'tissuebank_user';

function getToken(){ return localStorage.getItem(TOKEN_KEY); }
function setToken(token){ localStorage.setItem(TOKEN_KEY, token); }
function clearToken(){ localStorage.removeItem(TOKEN_KEY); }

// El usuario normalizado se guarda junto al token para poder restaurar la
// sesión en un refresh de la página sin tener que volver a pedir login —
// no hay endpoint "whoami" en la API para reconstruirlo de otra forma.
function getStoredUser(){
  try{
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){
    return null;
  }
}
function setStoredUser(user){ localStorage.setItem(USER_KEY, JSON.stringify(user)); }
function clearStoredUser(){ localStorage.removeItem(USER_KEY); }

// ==========================================================================
// Helper interno de fetch — agrega el token, maneja 401 y parsea JSON.
// ==========================================================================

// Límite de peticiones simultáneas al backend. Cada panel dispara muchas
// llamadas en paralelo (una por fila, por cada dato relacionado), y
// refreshAll() dispara todos los paneles a la vez — sin este límite se
// pueden mandar decenas/cientos de peticiones al mismo tiempo, lo que
// satura Lambdas/conexiones a la BD y causa fallas intermitentes que no
// tienen que ver con los datos en sí. Las que exceden el límite esperan
// en cola en vez de dispararse todas de una. Ajustar este número según lo
// que el backend realmente aguante (ideal: que el backend tenga su propio
// pool de conexiones y esto deje de ser necesario).
const MAX_CONCURRENT_REQUESTS = 6;
let activeRequests = 0;
const requestQueue = [];

function acquireSlot(){
  return new Promise(resolve=>{
    const tryAcquire = ()=>{
      if(activeRequests < MAX_CONCURRENT_REQUESTS){
        activeRequests++;
        resolve();
      } else {
        requestQueue.push(tryAcquire);
      }
    };
    tryAcquire();
  });
}

function releaseSlot(){
  activeRequests--;
  const next = requestQueue.shift();
  if(next) next();
}

async function request(method, path, body){
  await acquireSlot();
  try{
    return await doRequest(method, path, body);
  } finally {
    releaseSlot();
  }
}

async function doRequest(method, path, body){
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if(token) headers['Authorization'] = 'Bearer ' + token;

  let res;
  try{
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }catch(networkErr){
    throw new Error('No se pudo conectar con el servidor.');
  }

  if(res.status === 401){
    clearToken();
    if(typeof window.cerrarSesion === 'function') window.cerrarSesion();
    else window.location.reload();
    const err = new Error('Sesión expirada o no autorizada.');
    err.status = 401;
    throw err;
  }

  if(!res.ok){
    let message = 'Error ' + res.status;
    let payload = null;
    try{
      payload = await res.json();
      // El backend responde errores como { error: { code, message } }
      // (confirmado en /auth/login), pero se toleran también las formas
      // planas { message } / { error: "texto" } por si otras rutas difieren.
      if(payload.error && typeof payload.error === 'object') message = payload.error.message || payload.error.code || message;
      else message = payload.message || payload.error || message;
    }catch(e){ /* respuesta sin JSON */ }
    const err = new Error(message);
    err.status = res.status;
    err.payload = payload;
    throw err;
  }

  if(res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function get(path){ return request('GET', path); }
function post(path, body){ return request('POST', path, body); }
function put(path, body){ return request('PUT', path, body); }
function patch(path, body){ return request('PATCH', path, body); }

// Los GET de un solo recurso deben devolver null cuando no existe (mismo
// comportamiento que el findOrNull() de la versión anterior), en vez de
// propagar un error 404.
async function getOrNull(path){
  try{
    return await get(path);
  }catch(e){
    if(e.status === 404) return null;
    throw e;
  }
}

function unwrapList(payload){
  if(Array.isArray(payload)) return payload;
  if(payload && Array.isArray(payload.data)) return payload.data;
  // Formas alternativas vistas en APIs sobre AWS (p.ej. Lambda devolviendo
  // el resultado crudo de un scan/query de DynamoDB, que usa "Items" con
  // mayúscula, o wrappers tipo { items } / { results }).
  if(payload && Array.isArray(payload.Items)) return payload.Items;
  if(payload && Array.isArray(payload.items)) return payload.items;
  if(payload && Array.isArray(payload.results)) return payload.results;
  // Si llega hasta aquí, la respuesta no tiene ninguna forma reconocida —
  // antes esto devolvía [] en silencio (por eso una tabla vacía no mostraba
  // ningún error). Ahora se avisa en consola con la forma real recibida
  // para poder ajustar esta función al contrato real del backend.
  console.warn('unwrapList: no reconozco la forma de esta respuesta de lista, revisa el payload real:', payload);
  return [];
}

// ==========================================================================
// Estado derivado de una solicitud — mismas etiquetas que antes vivían en
// data.js. Se mantienen aquí para que API.requests.getStatusLabel() siga
// funcionando; app.js tiene su propia copia para no re-consultar el estado
// dos veces por fila en las tablas (ver comentario junto a STATUS_LABELS
// en app.js).
// ==========================================================================
const STATUS_LABELS = {
  en_fila:          { label: 'En fila',          badge: 'badge-gray'   },
  match_detectado:  { label: 'Match detectado',  badge: 'badge-purple' },
  match_enviado:    { label: 'Match enviado',    badge: 'badge-blue'   },
  por_asignar:      { label: 'Por asignar',      badge: 'badge-blue'   },
  asignada:         { label: 'Asignada',         badge: 'badge-amber'  },
  etiquetado:       { label: 'Etiquetado',       badge: 'badge-blue'   },
  en_camino:        { label: 'En camino',        badge: 'badge-blue'   },
  entregada:        { label: 'Entregada',        badge: 'badge-green'  },
};

// ==========================================================================
// Normalización de forma de usuario / doctor — el backend puede nombrar
// los campos ligeramente distinto a como los espera la UI; estas funciones
// centralizan esa traducción.
// ==========================================================================
function computeInitials(name){
  return name.replace('Dr.','').replace('Dra.','').trim().split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
}

function normalizeUser(u){
  const role = u.role;
  const rawName = u.display_name || u.displayName || u.nombre || null;
  let displayName, initials;
  if(role === 'admin'){
    displayName = rawName || 'Edison Ríos';
    initials = u.initials || 'ER';
  } else {
    displayName = rawName || u.username;
    initials = u.initials || computeInitials(displayName);
  }
  return { id: u.id, username: u.username, role, displayName, initials };
}

function normalizeDoctor(d){
  return {
    user_id: d.user_id || d.id,
    username: d.username,
    is_active: d.is_active !== undefined ? d.is_active : true,
    cedula: d.cedula ?? null,
    nombre: d.nombre ?? null,
    telefono: d.telefono ?? null,
    email: d.email ?? null,
  };
}

async function updateDoctor(userId, fields){
  const current = await get('/doctors/' + userId);
  const merged = Object.assign({}, current, fields);
  return put('/doctors/' + userId, merged);
}

// ==========================================================================
// API — misma forma pública que la versión simulada.
// ==========================================================================
const API = {

  auth: {
    async login(username, password){
      let res;
      try{
        res = await fetch(API_BASE + '/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
      }catch(networkErr){
        throw new Error('No se pudo conectar con el servidor.');
      }

      if(res.status === 401 || res.status === 400) return null;
      if(res.status === 403) return { inactive: true };
      if(!res.ok) throw new Error('Error al iniciar sesión (' + res.status + ').');

      const body = await res.json();
      if(body.user && body.user.is_active === false) return { inactive: true };

      const user = normalizeUser(body.user);
      setToken(body.token);
      setStoredUser(user);
      return { user };
    },
    logout(){ clearToken(); clearStoredUser(); },
    // Restaura la sesión guardada tras un refresh de la página — no valida
    // el token contra el servidor (no hay endpoint para eso); si el token
    // ya expiró, la primera llamada real a la API devolverá 401 y el
    // helper de request() ya se encarga de cerrar la sesión en ese caso.
    restoreSession(){
      const token = getToken();
      const user = getStoredUser();
      if(!token || !user) return null;
      return { user };
    },
  },

  // ==========================================================================
  // users — gestión de cuentas de doctor (panel del admin)
  // ==========================================================================
  users: {
    async listDoctors(){
      const payload = await get('/doctors');
      return unwrapList(payload).map(normalizeDoctor);
    },

    async create(data){
      try{
        const body = await post('/doctors', {
          cedula: data.cedula,
          nombre: data.nombre,
          telefono: data.telefono || null,
          email: data.email || null,
          username: data.username,
        });
        return { user_id: body.user_id || body.id, username: body.username, password: body.password };
      }catch(e){
        if(e.status === 409) return { error: 'USERNAME_TAKEN' };
        throw e;
      }
    },

    async updateProfile(userId, fields){
      return updateDoctor(userId, fields);
    },

    async setActive(userId, active){
      return patch('/doctors/' + userId + '/status', { is_active: active });
    },

    async resetPassword(userId){
      const body = await post('/doctors/' + userId + '/reset-password');
      if(!body) return null;
      return { user_id: userId, username: body.username, password: body.password };
    },
  },

  doctorProfile: {
    async getByUserId(userId){
      const raw = await getOrNull('/doctors/' + userId);
      if(!raw) return null;
      return {
        id: raw.cedula ?? raw.id,
        user_id: raw.user_id ?? raw.id,
        nombre: raw.nombre,
        telefono: raw.telefono,
        email: raw.email,
      };
    },
    async update(userId, fields){
      return updateDoctor(userId, fields);
    },
  },

  ips: {
    async list(){ return unwrapList(await get('/ips')); },
    async findByName(nombre){
      const all = await this.list();
      const target = nombre.trim().toLowerCase();
      return all.find(i => i.nombre.trim().toLowerCase() === target) || null;
    },
    async create(data){
      return post('/ips', {
        nombre: data.nombre,
        direccion: data.direccion || '',
        telefono: data.telefono || '',
        ciudad: data.ciudad || '',
      });
    },
  },

  patients: {
    // Busca un paciente ya registrado por número de identificación antes de
    // crear uno nuevo — evita el conflicto "Ya existe un paciente registrado
    // con esa identificación" en POST /patients cuando el paciente ya existe.
    async findByIdentification(numeroIdentificacion){
      const payload = await get('/patients?search=' + encodeURIComponent(numeroIdentificacion));
      const list = unwrapList(payload);
      return list.find(p => p.numero_identificacion === numeroIdentificacion) || list[0] || null;
    },
    async create(data){
      return post('/patients', {
        tipo_identificacion: data.tipo_identificacion,
        numero_identificacion: data.numero_identificacion || '',
        nombre: data.nombre,
        apellido: data.apellido,
        fecha_nacimiento: data.fecha_nacimiento || null,
        edad: data.edad || null,
        nacionalidad: data.nacionalidad || '',
        sexo_biologico: data.sexo_biologico || null,
      });
    },
  },

  donors: {
    async list(){ return unwrapList(await get('/donors')); },
    async getById(id){ return getOrNull('/donors/' + id); },
    async create(data){
      return post('/donors', {
        codigo_donante: data.codigo_donante,
        fecha_extraccion: data.fecha_extraccion,
        fecha_procedimiento: data.fecha_procedimiento || null,
        fecha_segundo_cambio: data.fecha_segundo_cambio || null,
        fecha_vencimiento: data.fecha_vencimiento,
        sexo_biologico: data.sexo_biologico || null,
      });
    },
    async update(id, fields){
      const current = await get('/donors/' + id);
      return put('/donors/' + id, Object.assign({}, current, fields));
    },
  },

  implants: {
    async list(){ return unwrapList(await get('/implants')); },
    async listByDonor(donorId){
      const all = await this.list();
      return all.filter(i => i.donor_id === donorId);
    },
    async getById(id){ return getOrNull('/implants/' + id); },
    async create(donorId, data){
      return post('/implants', {
        donor_id: donorId,
        codigo_visible: data.codigo_visible,
        parte_cuerpo: data.parte_cuerpo,
        tipo_implante: data.tipo_implante,
        alto: data.alto ?? null,
        ancho: data.ancho ?? null,
        profundidad: data.profundidad ?? null,
        estado: data.estado || 'disponible',
        notas_adicionales: data.notas_adicionales || '',
        url_imagen: data.url_imagen || '',
      });
    },
    async update(id, fields){
      const current = await get('/implants/' + id);
      return put('/implants/' + id, Object.assign({}, current, fields));
    },
    async remove(id){
      // La lista de rutas provista no incluye DELETE /implants/{id}.
      // No hay endpoint real al que llamar todavía — se deja explícito
      // en vez de adivinar una ruta que podría no existir.
      throw new Error('Eliminar implantes no está soportado por la API actual (falta DELETE /implants/{id}).');
    },
  },

  // ==========================================================================
  // tissueTypes — catálogo de "Tipo de implante" (antes lista fija en el
  // HTML). Permite agregar tipos nuevos desde el Panel Tejidos; quedan
  // guardados en el backend y disponibles para todos.
  // ==========================================================================
  tissueTypes: {
    async list(){ return unwrapList(await get('/tissue-types')); },
    async create(nombre){ return post('/tissue-types', { nombre }); },
  },

  requests: {
    async list(){ return unwrapList(await get('/requests')); },
    async listByDoctor(doctorId){
      const all = await this.list();
      // Si el backend ya filtra GET /requests por el JWT del doctor, es
      // posible que cada registro no traiga doctor_id (es implícito: son
      // suyas). En ese caso no descartar la fila — solo filtrar cuando el
      // campo sí viene y no coincide.
      return all.filter(r => !r.doctor_id || r.doctor_id === doctorId);
    },
    async getById(id){ return getOrNull('/requests/' + id); },
    async getStatus(id){
      const body = await get('/requests/' + id + '/status');
      return typeof body === 'string' ? body : body.status;
    },
    async getStatusLabel(id){
      const status = await this.getStatus(id);
      return STATUS_LABELS[status] || STATUS_LABELS.en_fila;
    },
    async create(data){
      // doctor_id NO va en el body — el backend lo toma del JWT.
      return post('/requests', {
        codigo_visible: data.codigo_visible,
        patient_id: data.patient_id,
        ips_id: data.ips_id,
        tejido_solicitado: data.tejido_solicitado,
        procedimiento_quirurgico: data.procedimiento_quirurgico || '',
        alto_requerido: data.alto_requerido,
        ancho_requerido: data.ancho_requerido,
        profundidad_requerida: data.profundidad_requerida,
        fecha_estimada_cirugia: data.fecha_estimada_cirugia,
        diagnostico: data.diagnostico || '',
        sexo_importante: data.sexo_importante,
      });
    },
  },

  matches: {
    async list(){ return unwrapList(await get('/matches')); },
    async listByStatus(statuses){
      const list = Array.isArray(statuses) ? statuses : [statuses];
      // Con un solo estado, usar el query param: el backend filtra
      // server-side, y para un doctor devuelve automáticamente solo los
      // matches de sus propias solicitudes (confirmado). Con varios
      // estados a la vez (ej. el historial) no hay endpoint compuesto
      // documentado, así que se trae todo y se filtra en el cliente.
      if(list.length === 1){
        return unwrapList(await get('/matches?status=' + encodeURIComponent(list[0])));
      }
      const all = await this.list();
      return all.filter(m => list.includes(m.status));
    },
    async getById(id){ return getOrNull('/matches/' + id); },
    async send(matchId){ return post('/matches/' + matchId + '/send'); },
    async cancelSend(matchId){ return post('/matches/' + matchId + '/cancel'); },
    async resend(matchId){ return post('/matches/' + matchId + '/resend'); },
    async approveDoctor(matchId){
      return put('/matches/' + matchId + '/doctor-response', { approved: true });
    },
    async rejectDoctor(matchId, reason){
      const body = { approved: false };
      if(reason) body.rejection_reason = reason;
      return put('/matches/' + matchId + '/doctor-response', body);
    },
    // Dispara el motor de matching en el backend, que busca implantes
    // compatibles para las solicitudes en fila y crea los `match` nuevos.
    // Forma de la respuesta no documentada — se toleran varios alias, incluido
    // el wrapper { data: {...} } que se ve en otras rutas (ver unwrapList).
    // Si ninguno calza, created/processed quedan en 0 solo para el mensaje
    // en pantalla — el refresco del panel NO depende de acertar este campo
    // (ver ejecutarMotorMatchingUI en app.js), porque adivinar mal el nombre
    // no debe dejar la pantalla desactualizada.
    async run(){
      const res = await post('/matches/run');
      const body = (res && typeof res === 'object' && res.data && typeof res.data === 'object') ? res.data : res;
      const created = body?.created ?? body?.matches_created ?? body?.created_count
        ?? (Array.isArray(body?.matches) ? body.matches.length : undefined)
        ?? (Array.isArray(body) ? body.length : undefined)
        ?? 0;
      const processed = body?.processed ?? body?.requests_processed ?? body?.processed_count ?? 0;
      return { created, processed, raw: res };
    },
  },

  assignments: {
    async list(){ return unwrapList(await get('/assignments')); },
    async listByStatus(status){
      const all = await this.list();
      return all.filter(a => a.status === status);
    },
    async getById(id){ return getOrNull('/assignments/' + id); },
    async approve(assignmentId, reviewerUserId){
      return put('/assignments/' + assignmentId + '/approve', { reviewed_by: reviewerUserId });
    },
    async reject(assignmentId, reviewerUserId, reason){
      return put('/assignments/' + assignmentId + '/reject', { reviewed_by: reviewerUserId, reason: reason || '' });
    },
  },

  dispatches: {
    async list(){ return unwrapList(await get('/dispatches')); },
    async listByStatus(status){
      const all = await this.list();
      return all.filter(d => d.status === status);
    },
    async getById(id){ return getOrNull('/dispatches/' + id); },
    async label(dispatchId){ return put('/dispatches/' + dispatchId + '/label'); },
    async deliver(dispatchId){ return put('/dispatches/' + dispatchId + '/deliver'); },
  },

  compose: {
    async patient(id){ return id ? getOrNull('/patients/' + id) : null; },
    async ips(id){ return id ? getOrNull('/ips/' + id) : null; },
    async donor(id){ return id ? getOrNull('/donors/' + id) : null; },
    async implant(id){ return id ? getOrNull('/implants/' + id) : null; },
    async doctorDisplayName(userId){
      const profile = await API.doctorProfile.getByUserId(userId);
      return profile ? profile.nombre : '—';
    },
  },
};

window.API = API;

})();
