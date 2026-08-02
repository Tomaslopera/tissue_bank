/* ==========================================================================
   TissueBank — data.js
   Capa de datos en memoria que simula el backend (API Gateway + Lambda + RDS).

   Cómo está organizado:
   - `DB` contiene una tabla por cada tabla de schema.sql, con exactamente
     las mismas columnas. Es el "estado actual de la base de datos" mientras
     no exista el backend real.
   - `API` es la única puerta de entrada para leer o escribir esas tablas.
     Cada función de `API` tiene el mismo nombre/forma que tendrá su
     equivalente real en api-contracts.md — cuando se conecte el backend,
     el cuerpo de estas funciones cambia de "leer/escribir el array" a
     "hacer fetch() al endpoint real", pero quien las llama (app.js) no
     tiene que cambiar.
   - Los getters siempre devuelven copias (clone()), nunca el objeto
     original — así nadie puede mutar el "DB" sin pasar por una función de
     escritura, igual que pasaría contra una API real.
   - Dos campos existen SOLO para que la demo se vea completa y no están en
     schema.sql todavía (marcados con "DEMO:" en su comentario): el número
     de identificación del paciente (ver OBSERVACIÓN 1 de schema.sql) y los
     códigos legibles tipo "SOL-2025-00041" / "TEJ-002" (ver OBSERVACIÓN 5).
     El día que se resuelvan esas observaciones en la BD real, estos dos
     campos pasan de ser cosméticos a ser columnas reales.
   - Los formularios de "agregar nuevo" (Nueva solicitud, Registrar donante)
     arrancan vacíos a propósito — es la persona que hace la demo quien
     llena esos datos en vivo. Lo que sí viene precargado es todo lo que ya
     "existía" antes de abrir la demo: solicitudes previas, inventario,
     matches, asignaciones y despachos ya en curso.
   ========================================================================== */

(function(){

function uuid(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function clone(x){ return x === undefined ? x : JSON.parse(JSON.stringify(x)); }
function findOrNull(arr, id){ const f = arr.find(x=>x.id===id); return f ? clone(f) : null; }

// Fechas relativas a "hoy" (no fijas a un calendario). Así la demo siempre
// se ve coherente sin importar en qué fecha real se presente: el donante
// "por vencer" siempre está a pocos días de vencer, los ya despachados
// siempre quedan en el pasado, etc.
function iso(offsetDays){
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0,10);
}
function isoDateTime(offsetDays){
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
}

// Genera una contraseña temporal legible (evita caracteres ambiguos como
// 0/O, 1/l/I) para que el admin pueda dictarla o copiarla sin confusiones.
// En un backend real esto viviría en la Lambda de creación de usuario, no
// en el cliente — aquí vive en data.js porque data.js está haciendo de
// "backend simulado".
function generatePassword(){
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let pass = '';
  for(let i=0; i<10; i++){
    pass += chars[Math.floor(Math.random()*chars.length)];
  }
  return pass;
}

// ==========================================================================
// DB — estado actual, una tabla por cada tabla de schema.sql
// ==========================================================================
const DB = {

  // ---- app_user: Id (uuid), Username, Password (hash), Role ----
  app_user: [
    { id: 'usr-doctor-martinez', username: 'dr.martinez', password: 'doctor123', role: 'doctor', is_active: true },
    { id: 'usr-doctor-garcia',   username: 'dr.garcia',    password: 'doctor123', role: 'doctor', is_active: true },
    { id: 'usr-doctor-lopez',    username: 'dra.lopez',    password: 'doctor123', role: 'doctor', is_active: true },
    { id: 'usr-admin-edison',    username: 'admin',        password: 'admin123',  role: 'admin',  is_active: true },
  ],

  // ---- doctor_profile: Id (cédula), user_id, Nombre, Telefono, Email ----
  doctor_profile: [
    { id: '71234509', user_id: 'usr-doctor-martinez', nombre: 'Dr. Andrés Martínez', telefono: 3104567890, email: 'a.martinez@tissuebank.co' },
    { id: '80112233', user_id: 'usr-doctor-garcia',   nombre: 'Dr. Camilo García',   telefono: 3117654321, email: 'c.garcia@tissuebank.co' },
    { id: '43987654', user_id: 'usr-doctor-lopez',    nombre: 'Dra. Valentina López', telefono: 3001122334, email: 'v.lopez@tissuebank.co' },
  ],

  // ---- ips: Id, Nombre, Dirección, Telefono, Ciudad ----
  ips: [
    { id: 'ips-americas',  nombre: 'Clínica Las Américas', direccion: 'Cra 43A #34-95', telefono: '6044448899', ciudad: 'Medellín' },
    { id: 'ips-uribe',     nombre: 'HPT Uribe',             direccion: 'Cl 78B #69-240', telefono: '6044412233', ciudad: 'Medellín' },
    { id: 'ips-ces',       nombre: 'Clínica CES',            direccion: 'Cl 10A #22-04', telefono: '6045111234', ciudad: 'Medellín' },
    { id: 'ips-medellin',  nombre: 'Clínica Medellín',       direccion: 'Cra 65 #14-25', telefono: '6044456789', ciudad: 'Medellín' },
    { id: 'ips-soma',      nombre: 'Clínica Soma',           direccion: 'Cl 30 #82-56',  telefono: '6045223344', ciudad: 'Medellín' },
    { id: 'ips-huv-cali',  nombre: 'HUV Cali',               direccion: 'Cl 5 #36-08',   telefono: '6026201234', ciudad: 'Cali' },
  ],

  // ---- patient: Id, tipo_identificacion, Nombre, Apellido, fecha_nacimiento, Edad, Nacionalidad ----
  // numero_identificacion es DEMO (ver nota arriba y OBSERVACIÓN 1 de schema.sql)
  patient: [
    { id: 'pac-carlos',   tipo_identificacion: 'CC', numero_identificacion: '1037642891', nombre: 'Carlos Andrés', apellido: 'Martínez López', fecha_nacimiento: '1985-03-22', edad: 40, nacionalidad: 'Colombiana', sexo_biologico: 'M' },
    { id: 'pac-ana',      tipo_identificacion: 'CC', numero_identificacion: '43821675',   nombre: 'Ana',           apellido: 'Gómez Ruiz',      fecha_nacimiento: '1978-11-02', edad: 47, nacionalidad: 'Colombiana', sexo_biologico: 'F' },
    { id: 'pac-luis',     tipo_identificacion: 'CC', numero_identificacion: '71234509',   nombre: 'Luis',          apellido: 'Pérez Castro',    fecha_nacimiento: '1990-06-15', edad: 35, nacionalidad: 'Colombiana', sexo_biologico: 'M' },
    { id: 'pac-sofia',    tipo_identificacion: 'CC', numero_identificacion: '52198430',   nombre: 'Sofía',         apellido: 'Ramírez',          fecha_nacimiento: '1995-01-30', edad: 30, nacionalidad: 'Colombiana', sexo_biologico: 'F' },
    { id: 'pac-sandra',   tipo_identificacion: 'CC', numero_identificacion: '52001234',   nombre: 'Sandra',        apellido: 'Vélez',            fecha_nacimiento: '1982-09-12', edad: 43, nacionalidad: 'Colombiana', sexo_biologico: 'F' },
    { id: 'pac-maria',    tipo_identificacion: 'CC', numero_identificacion: '43001122',   nombre: 'María',         apellido: 'Ruiz',             fecha_nacimiento: '1975-04-05', edad: 50, nacionalidad: 'Colombiana', sexo_biologico: 'F' },
    { id: 'pac-jorge',    tipo_identificacion: 'CC', numero_identificacion: '79887766',   nombre: 'Jorge',         apellido: 'Castro',           fecha_nacimiento: '1988-08-20', edad: 37, nacionalidad: 'Colombiana', sexo_biologico: 'M' },
    { id: 'pac-patricia', tipo_identificacion: 'CC', numero_identificacion: '31556677',   nombre: 'Patricia',      apellido: 'Gil',              fecha_nacimiento: '1992-12-01', edad: 33, nacionalidad: 'Colombiana', sexo_biologico: 'F' },
  ],

  // ---- donor: Id, codigo_donante, fecha_extraccion, fecha_procedimiento, fecha_segundo_cambio, fecha_vencimiento ----
  donor: [
    { id: 'don-r3-26290', codigo_donante: 'R3 INML 26.290', sexo_biologico: 'M', fecha_extraccion: iso(-10), fecha_procedimiento: iso(-8), fecha_segundo_cambio: iso(-3), fecha_vencimiento: iso(20) },
    { id: 'don-26964',    codigo_donante: '26.964',          sexo_biologico: 'F', fecha_extraccion: iso(-12), fecha_procedimiento: iso(-11), fecha_segundo_cambio: iso(-6), fecha_vencimiento: iso(5) },
    { id: 'don-2025-018', codigo_donante: 'DON-2025-018',    sexo_biologico: 'M', fecha_extraccion: iso(-20), fecha_procedimiento: iso(-19), fecha_segundo_cambio: iso(-15), fecha_vencimiento: iso(-3) },
    { id: 'don-2025-011', codigo_donante: 'DON-2025-011',    sexo_biologico: 'F', fecha_extraccion: iso(-35), fecha_procedimiento: iso(-34), fecha_segundo_cambio: iso(-31), fecha_vencimiento: iso(-20) },
    { id: 'don-2025-004', codigo_donante: 'DON-2025-004',    sexo_biologico: 'M', fecha_extraccion: iso(-50), fecha_procedimiento: iso(-49), fecha_segundo_cambio: iso(-46), fecha_vencimiento: iso(-35) },
    { id: 'don-2025-006', codigo_donante: 'DON-2025-006',    sexo_biologico: 'F', fecha_extraccion: iso(-40), fecha_procedimiento: iso(-39), fecha_segundo_cambio: iso(-36), fecha_vencimiento: iso(-25) },
    { id: 'don-2025-001', codigo_donante: 'DON-2025-001',    sexo_biologico: 'M', fecha_extraccion: iso(-15), fecha_procedimiento: iso(-14), fecha_segundo_cambio: iso(-11), fecha_vencimiento: iso(25) },
    { id: 'don-2025-003', codigo_donante: 'DON-2025-003',    sexo_biologico: 'F', fecha_extraccion: iso(-14), fecha_procedimiento: iso(-13), fecha_segundo_cambio: iso(-10), fecha_vencimiento: iso(26) },
    { id: 'don-2025-009', codigo_donante: 'DON-2025-009',    sexo_biologico: 'M', fecha_extraccion: iso(-45), fecha_procedimiento: iso(-44), fecha_segundo_cambio: iso(-41), fecha_vencimiento: iso(10) },
  ],

  // ---- implant: Id, donor_id, parte_cuerpo, tipo_implante, Alto, Ancho, Estado, Notas_adicionales, Url_imagen ----
  // codigo_visible es DEMO (ver nota arriba y OBSERVACIÓN 5 de schema.sql)
  implant: [
    { id: 'imp-r3-1', codigo_visible: null, donor_id: 'don-r3-26290', parte_cuerpo: 'Rodilla derecha', tipo_implante: 'Patela',       alto: 41, ancho: 32, estado: 'disponible', notas_adicionales: '', url_imagen: '' },
    { id: 'imp-r3-2', codigo_visible: null, donor_id: 'don-r3-26290', parte_cuerpo: 'Rodilla derecha', tipo_implante: 'Plato tibial', alto: 70, ancho: 42, estado: 'disponible', notas_adicionales: '', url_imagen: '' },
    { id: 'imp-r3-3', codigo_visible: null, donor_id: 'don-r3-26290', parte_cuerpo: 'Rodilla derecha', tipo_implante: 'Cóndilo',      alto: 33, ancho: 60, estado: 'disponible', notas_adicionales: '', url_imagen: '' },

    { id: 'imp-964-1', codigo_visible: null, donor_id: 'don-26964', parte_cuerpo: 'Rodilla derecha',  tipo_implante: 'Patela',       alto: 46, ancho: 33, estado: 'disponible',     notas_adicionales: '', url_imagen: '' },
    { id: 'imp-964-2', codigo_visible: null, donor_id: 'don-26964', parte_cuerpo: 'Rodilla derecha',  tipo_implante: 'Plato tibial', alto: 78, ancho: 47, estado: 'disponible',     notas_adicionales: '', url_imagen: '' },
    { id: 'imp-964-3', codigo_visible: null, donor_id: 'don-26964', parte_cuerpo: 'Rodilla izquierda', tipo_implante: 'Patela',      alto: null, ancho: null, estado: 'contraindicado', notas_adicionales: 'No se pudo cuantificar por calidad insuficiente del tejido.', url_imagen: '' },
    { id: 'imp-964-4', codigo_visible: null, donor_id: 'don-26964', parte_cuerpo: 'Rodilla izquierda', tipo_implante: 'Fémur',       alto: 31, ancho: 65, estado: 'reservado',      notas_adicionales: '', url_imagen: '' },

    { id: 'imp-tej-001', codigo_visible: 'TEJ-001', donor_id: 'don-2025-001', parte_cuerpo: 'Espalda',        tipo_implante: 'Piel',  alto: 83, ancho: 58,  estado: 'disponible', notas_adicionales: '', url_imagen: '' },
    { id: 'imp-tej-002', codigo_visible: 'TEJ-002', donor_id: 'don-2025-018', parte_cuerpo: 'Espalda',        tipo_implante: 'Piel',  alto: 79, ancho: 61,  estado: 'asignado',   notas_adicionales: '', url_imagen: '' },
    { id: 'imp-tej-003', codigo_visible: 'TEJ-003', donor_id: 'don-2025-003', parte_cuerpo: 'Cadera derecha', tipo_implante: 'Hueso', alto: 118, ancho: 42, estado: 'disponible', notas_adicionales: '', url_imagen: '' },
    { id: 'imp-tej-004', codigo_visible: 'TEJ-004', donor_id: 'don-2025-011', parte_cuerpo: 'Cadera derecha', tipo_implante: 'Hueso', alto: 60, ancho: 40,  estado: 'despachado', notas_adicionales: '', url_imagen: '' },
    { id: 'imp-tej-005', codigo_visible: 'TEJ-005', donor_id: 'don-2025-004', parte_cuerpo: 'Espalda',        tipo_implante: 'Piel',  alto: 85, ancho: 55,  estado: 'despachado', notas_adicionales: '', url_imagen: '' },
    { id: 'imp-tej-006', codigo_visible: 'TEJ-006', donor_id: 'don-2025-006', parte_cuerpo: 'Cadera izquierda', tipo_implante: 'Hueso', alto: 65, ancho: 38, estado: 'despachado', notas_adicionales: '', url_imagen: '' },
    { id: 'imp-tej-009', codigo_visible: 'TEJ-009', donor_id: 'don-2025-009', parte_cuerpo: 'Espalda',        tipo_implante: 'Piel',  alto: 60, ancho: 45,  estado: 'disponible', notas_adicionales: '', url_imagen: '' },
  ],

  // ---- request: Id, patient_id, doctor_id, ips_id, Tejido_solicitado, Procedimiento_quirurgico,
  //      Alto_requerido, Ancho_requerido, Profundidad_requerida, Fecha_estimada_cirugia, Diagnostico ----
  // codigo_visible es DEMO (ver nota arriba y OBSERVACIÓN 5 de schema.sql)
  request: [
    // sexo_importante: true = el match debe respetar el sexo del donante; false = indiferente
    { id: 'req-carlos',   codigo_visible: 'SOL-2025-00041', patient_id: 'pac-carlos',   doctor_id: 'usr-doctor-garcia',    ips_id: 'ips-americas', tejido_solicitado: 'Piel',  procedimiento_quirurgico: 'Injerto cutáneo', alto_requerido: 80,  ancho_requerido: 60, profundidad_requerida: 3,  fecha_estimada_cirugia: iso(14), sexo_importante: true, diagnostico: 'Trauma cutáneo extenso en región dorsal, requiere cobertura con injerto de piel.' },
    { id: 'req-ana',      codigo_visible: 'SOL-2025-00038', patient_id: 'pac-ana',      doctor_id: 'usr-doctor-lopez',     ips_id: 'ips-uribe',    tejido_solicitado: 'Hueso', procedimiento_quirurgico: 'Injerto óseo',     alto_requerido: 120, ancho_requerido: 40, profundidad_requerida: 10, fecha_estimada_cirugia: iso(18), sexo_importante: true, diagnostico: 'Pérdida ósea en cadera derecha post-fractura, requiere injerto estructural.' },
    { id: 'req-luis',     codigo_visible: 'SOL-2025-00033', patient_id: 'pac-luis',     doctor_id: 'usr-doctor-martinez', ips_id: 'ips-ces',      tejido_solicitado: 'Piel',  procedimiento_quirurgico: 'Injerto cutáneo', alto_requerido: 50,  ancho_requerido: 50, profundidad_requerida: 2,  fecha_estimada_cirugia: iso(2), sexo_importante: true, diagnostico: 'Quemadura de segundo grado en región dorsal.' },
    { id: 'req-sofia',    codigo_visible: 'SOL-2025-00030', patient_id: 'pac-sofia',    doctor_id: 'usr-doctor-garcia',    ips_id: 'ips-medellin', tejido_solicitado: 'Piel',  procedimiento_quirurgico: 'Injerto cutáneo', alto_requerido: 70,  ancho_requerido: 55, profundidad_requerida: 3,  fecha_estimada_cirugia: iso(25), sexo_importante: true, diagnostico: 'Cobertura de defecto cutáneo post-resección de lesión.' },
    { id: 'req-sandra',   codigo_visible: 'SOL-2025-00019', patient_id: 'pac-sandra',   doctor_id: 'usr-doctor-martinez', ips_id: 'ips-soma',     tejido_solicitado: 'Hueso', procedimiento_quirurgico: 'Injerto óseo',     alto_requerido: 60,  ancho_requerido: 40, profundidad_requerida: 8,  fecha_estimada_cirugia: iso(1), sexo_importante: true, diagnostico: 'Pseudoartrosis de cadera, requiere injerto óseo estructural.' },
    { id: 'req-maria',    codigo_visible: 'SOL-2025-00028', patient_id: 'pac-maria',    doctor_id: 'usr-doctor-garcia',    ips_id: 'ips-huv-cali', tejido_solicitado: 'Piel',  procedimiento_quirurgico: 'Injerto cutáneo', alto_requerido: 85,  ancho_requerido: 55, profundidad_requerida: 3,  fecha_estimada_cirugia: iso(-3), sexo_importante: true, diagnostico: 'Úlcera crónica en miembro inferior, requiere cobertura cutánea.' },
    { id: 'req-jorge',    codigo_visible: 'SOL-2025-00021', patient_id: 'pac-jorge',    doctor_id: 'usr-doctor-lopez',     ips_id: 'ips-medellin', tejido_solicitado: 'Hueso', procedimiento_quirurgico: 'Injerto óseo',     alto_requerido: 65,  ancho_requerido: 38, profundidad_requerida: 8,  fecha_estimada_cirugia: iso(-2), sexo_importante: true, diagnostico: 'Defecto óseo en cadera izquierda post-trauma.' },
    { id: 'req-patricia', codigo_visible: 'SOL-2025-00015', patient_id: 'pac-patricia', doctor_id: 'usr-doctor-garcia',    ips_id: 'ips-medellin', tejido_solicitado: 'Piel',  procedimiento_quirurgico: 'Injerto cutáneo', alto_requerido: 60,  ancho_requerido: 45, profundidad_requerida: 2,  fecha_estimada_cirugia: iso(-10), sexo_importante: true, diagnostico: 'Cobertura de defecto cutáneo post-traumático.' },
  ],

  // ---- match: Id, request_id, implant_id, compatibility_score/ancho/alto/profundidad, Status ----
  match: [
    { id: 'match-carlos',   request_id: 'req-carlos',   implant_id: 'imp-tej-001', compatibility_score: 87, compatibility_alto: 91.5, compatibility_ancho: 88,  compatibility_profundidad: 100, status: 'detectado', sent_at: null },
    { id: 'match-ana',      request_id: 'req-ana',      implant_id: 'imp-tej-003', compatibility_score: 93, compatibility_alto: 95,   compatibility_ancho: 95,  compatibility_profundidad: 90,  status: 'detectado', sent_at: null },
    { id: 'match-luis',     request_id: 'req-luis',     implant_id: 'imp-tej-002', compatibility_score: 93, compatibility_alto: 94,   compatibility_ancho: 92,  compatibility_profundidad: 100, status: 'aprobado_doctor', sent_at: isoDateTime(-4) },
    { id: 'match-sandra',   request_id: 'req-sandra',   implant_id: 'imp-tej-004', compatibility_score: 90, compatibility_alto: 92,   compatibility_ancho: 90,  compatibility_profundidad: 88,  status: 'aprobado_admin', sent_at: isoDateTime(-18) },
    { id: 'match-maria',    request_id: 'req-maria',    implant_id: 'imp-tej-005', compatibility_score: 91, compatibility_alto: 93,   compatibility_ancho: 91,  compatibility_profundidad: 89,  status: 'aprobado_admin', sent_at: isoDateTime(-9) },
    { id: 'match-jorge',    request_id: 'req-jorge',    implant_id: 'imp-tej-006', compatibility_score: 88, compatibility_alto: 90,   compatibility_ancho: 87,  compatibility_profundidad: 86,  status: 'aprobado_admin', sent_at: isoDateTime(-6) },
    { id: 'match-patricia', request_id: 'req-patricia', implant_id: 'imp-tej-009', compatibility_score: 76, compatibility_alto: 80,   compatibility_ancho: 74,  compatibility_profundidad: 70,  status: 'rechazado_doctor', sent_at: isoDateTime(-12) },
    // Match enviado al Dr. Martínez — aparece en "Match por aprobar" en su panel
    { id: 'match-sandra-new', request_id: 'req-sandra', implant_id: 'imp-r3-3', compatibility_score: 88, compatibility_alto: 92, compatibility_ancho: 85, compatibility_profundidad: 88, status: 'enviado', sent_at: isoDateTime(-1) },
  ],
  // req-sofia no tiene match todavía (en_fila, esperando que el motor de matching encuentre candidato).

  // ---- assignment: Id, match_id, Status, reviewed_by ----
  assignment: [
    { id: 'asig-luis',   match_id: 'match-luis',   status: 'pendiente', reviewed_by: null },
    { id: 'asig-sandra', match_id: 'match-sandra', status: 'aprobada',  reviewed_by: 'usr-admin-edison' },
    { id: 'asig-maria',  match_id: 'match-maria',  status: 'aprobada',  reviewed_by: 'usr-admin-edison' },
    { id: 'asig-jorge',  match_id: 'match-jorge',  status: 'aprobada',  reviewed_by: 'usr-admin-edison' },
  ],

  // ---- dispatch: Id, assignment_id, ips_id, Status ----
  dispatch: [
    { id: 'disp-sandra', assignment_id: 'asig-sandra', ips_id: 'ips-soma',     status: 'en_camino' },
    { id: 'disp-maria',  assignment_id: 'asig-maria',  ips_id: 'ips-huv-cali', status: 'entregado' },
    { id: 'disp-jorge',  assignment_id: 'asig-jorge',  ips_id: 'ips-medellin', status: 'entregado' },
  ],
  // asig-luis todavía no tiene dispatch — se crea automáticamente cuando se
  // aprueba esa asignación en vivo durante la demo (API.assignments.approve).
};

// ==========================================================================
// Estado derivado de una solicitud — misma lógica que la vista
// v_request_status de schema.sql, portada a JS porque aquí no hay SQL.
// ==========================================================================
function getRequestStatus(requestId){
  const m = DB.match.filter(x=>x.request_id===requestId && !['rechazado_doctor','rechazado_admin','invalidado'].includes(x.status))
                     .sort((a,b)=>{
                        const rank = { aprobado_admin:5, aprobado_doctor:4, enviado:3, detectado:2 };
                        return (rank[b.status]||1) - (rank[a.status]||1);
                     })[0];
  if(!m) return 'en_fila';
  const a = DB.assignment.find(x=>x.match_id===m.id);
  const d = a ? DB.dispatch.find(x=>x.assignment_id===a.id) : null;
  if(d){
    if(d.status==='entregado') return 'entregada';
    if(d.status==='en_camino') return 'en_camino';
    if(d.status==='etiquetado') return 'etiquetado';
    if(d.status==='por_etiquetar') return 'asignada';
  }
  if(a && a.status==='pendiente') return 'por_asignar';
  if(m.status==='aprobado_doctor') return 'por_asignar';
  if(m.status==='enviado') return 'match_enviado';
  if(m.status==='detectado') return 'match_detectado';
  return 'en_fila';
}

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
// API — puerta de entrada única para leer y escribir. Mismas formas que
// tendrán las llamadas reales (ver api-contracts.md); cuando exista el
// backend, cada cuerpo pasa de tocar `DB` a hacer fetch().
// ==========================================================================
const API = {

  auth: {
    login(username, password){
      const user = DB.app_user.find(u=>u.username===username && u.password===password);
      if(!user) return null;
      if(!user.is_active) return { inactive: true };
      let displayName = username;
      let initials = username.slice(0,2).toUpperCase();
      if(user.role==='doctor'){
        const profile = DB.doctor_profile.find(p=>p.user_id===user.id);
        if(profile){
          displayName = profile.nombre;
          initials = profile.nombre.replace('Dr.','').replace('Dra.','').trim().split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
        }
      } else {
        displayName = 'Edison Ríos';
        initials = 'ER';
      }
      return { user: { id: user.id, username: user.username, role: user.role, displayName, initials } };
    },
  },

  // ==========================================================================
  // users — gestión de cuentas de doctor (panel del admin)
  // ==========================================================================
  users: {
    // Lista los doctores con su perfil ya unido (para pintar la tabla en un
    // solo recorrido, sin que app.js tenga que hacer el join).
    listDoctors(){
      return DB.app_user
        .filter(u=>u.role==='doctor')
        .map(u=>{
          const profile = DB.doctor_profile.find(p=>p.user_id===u.id);
          return clone({
            user_id: u.id,
            username: u.username,
            is_active: u.is_active,
            cedula: profile ? profile.id : null,
            nombre: profile ? profile.nombre : null,
            telefono: profile ? profile.telefono : null,
            email: profile ? profile.email : null,
          });
        });
    },

    usernameTaken(username){
      return DB.app_user.some(u=>u.username.toLowerCase()===username.toLowerCase());
    },

    // Crea la cuenta (app_user) y el perfil (doctor_profile) en un solo paso,
    // igual que haría la Lambda real en una transacción. Devuelve la
    // contraseña generada — es la ÚNICA vez que estará disponible en texto
    // plano; el "backend" (aquí, este array) solo guarda el hash en un
    // sistema real.
    create(data){
      if(this.usernameTaken(data.username)){
        return { error: 'USERNAME_TAKEN' };
      }
      const password = generatePassword();
      const userId = uuid();
      DB.app_user.push({ id: userId, username: data.username, password, role: 'doctor', is_active: true });
      DB.doctor_profile.push({
        id: data.cedula,
        user_id: userId,
        nombre: data.nombre,
        telefono: data.telefono || null,
        email: data.email || null,
      });
      return { user_id: userId, username: data.username, password };
    },

    updateProfile(userId, fields){
      const profile = DB.doctor_profile.find(p=>p.user_id===userId);
      if(!profile) return null;
      Object.assign(profile, fields);
      return clone(profile);
    },

    setActive(userId, active){
      const user = DB.app_user.find(u=>u.id===userId);
      if(!user) return null;
      user.is_active = active;
      return clone(user);
    },

    // Genera una contraseña nueva y la devuelve una sola vez (mismo criterio
    // que create): quien llama esta función es responsable de mostrarla al
    // admin una única vez y no guardarla en ningún otro lado.
    resetPassword(userId){
      const user = DB.app_user.find(u=>u.id===userId);
      if(!user) return null;
      const password = generatePassword();
      user.password = password;
      return { user_id: userId, username: user.username, password };
    },
  },

  doctorProfile: {
    getByUserId(userId){
      return clone(DB.doctor_profile.find(p=>p.user_id===userId)) || null;
    },
    update(userId, fields){
      const profile = DB.doctor_profile.find(p=>p.user_id===userId);
      if(!profile) return null;
      Object.assign(profile, fields);
      return clone(profile);
    },
  },

  ips: {
    list(){ return clone(DB.ips); },
    findByName(nombre){
      const f = DB.ips.find(i=>i.nombre.trim().toLowerCase() === nombre.trim().toLowerCase());
      return f ? clone(f) : null;
    },
    create(data){
      const record = { id: uuid(), nombre: data.nombre, direccion: data.direccion||'', telefono: data.telefono||'', ciudad: data.ciudad||'' };
      DB.ips.push(record);
      return clone(record);
    },
  },

  patients: {
    create(data){
      const record = {
        id: uuid(),
        tipo_identificacion: data.tipo_identificacion,
        numero_identificacion: data.numero_identificacion || '',
        nombre: data.nombre,
        apellido: data.apellido,
        fecha_nacimiento: data.fecha_nacimiento || null,
        edad: data.edad || null,
        nacionalidad: data.nacionalidad || '',
      };
      DB.patient.push(record);
      return clone(record);
    },
  },

  donors: {
    list(){ return clone(DB.donor); },
    getById(id){ return findOrNull(DB.donor, id); },
    create(data){
      const record = {
        id: uuid(),
        codigo_donante: data.codigo_donante,
        fecha_extraccion: data.fecha_extraccion,
        fecha_procedimiento: data.fecha_procedimiento || null,
        fecha_segundo_cambio: data.fecha_segundo_cambio || null,
        fecha_vencimiento: data.fecha_vencimiento,
      };
      DB.donor.push(record);
      return clone(record);
    },
  },

  implants: {
    list(){ return clone(DB.implant); },
    listByDonor(donorId){ return clone(DB.implant.filter(i=>i.donor_id===donorId)); },
    getById(id){ return findOrNull(DB.implant, id); },
    create(donorId, data){
      const record = {
        id: uuid(),
        codigo_visible: null,
        donor_id: donorId,
        parte_cuerpo: data.parte_cuerpo,
        tipo_implante: data.tipo_implante,
        alto: data.alto ?? null,
        ancho: data.ancho ?? null,
        estado: data.estado || 'disponible',
        notas_adicionales: data.notas_adicionales || '',
        url_imagen: data.url_imagen || '',
      };
      DB.implant.push(record);
      return clone(record);
    },
    update(id, fields){
      const implant = DB.implant.find(i=>i.id===id);
      if(!implant) return null;
      Object.assign(implant, fields);
      return clone(implant);
    },
    remove(id){
      const idx = DB.implant.findIndex(i=>i.id===id);
      if(idx===-1) return false;
      DB.implant.splice(idx,1);
      return true;
    },
  },

  requests: {
    list(){ return clone(DB.request); },
    listByDoctor(doctorId){ return clone(DB.request.filter(r=>r.doctor_id===doctorId)); },
    getById(id){ return findOrNull(DB.request, id); },
    getStatus(id){ return getRequestStatus(id); },
    getStatusLabel(id){ return STATUS_LABELS[getRequestStatus(id)] || STATUS_LABELS.en_fila; },
    create(data){
      const record = {
        id: uuid(),
        codigo_visible: null, // se asignaría en el servidor; en demo lo dejamos sin código vistoso
        patient_id: data.patient_id,
        doctor_id: data.doctor_id,
        ips_id: data.ips_id,
        tejido_solicitado: data.tejido_solicitado,
        procedimiento_quirurgico: data.procedimiento_quirurgico || '',
        alto_requerido: data.alto_requerido,
        ancho_requerido: data.ancho_requerido,
        profundidad_requerida: data.profundidad_requerida,
        fecha_estimada_cirugia: data.fecha_estimada_cirugia,
        diagnostico: data.diagnostico || '',
      };
      DB.request.push(record);
      return clone(record);
    },
  },

  matches: {
    list(){ return clone(DB.match); },
    listByStatus(statuses){ return clone(DB.match.filter(m=>statuses.includes(m.status))); },
    getById(id){ return findOrNull(DB.match, id); },
    send(matchId){
      const m = DB.match.find(x=>x.id===matchId);
      if(!m) return null;
      m.status = 'enviado';
      m.sent_at = new Date().toISOString();
      return clone(m);
    },
    cancelSend(matchId){
      const m = DB.match.find(x=>x.id===matchId);
      if(!m) return null;
      m.status = 'detectado';
      m.sent_at = null;
      return clone(m);
    },
    resend(matchId){
      const m = DB.match.find(x=>x.id===matchId);
      if(!m) return null;
      m.sent_at = new Date().toISOString();
      return clone(m);
    },
    approveDoctor(matchId, doctorUserId){
      const m = DB.match.find(x=>x.id===matchId);
      if(!m) return null;
      m.status = 'aprobado_doctor';
      m.decided_by = doctorUserId;
      m.decided_at = new Date().toISOString();
      // Crear asignación pendiente para que Isabel la apruebe
      const already = DB.assignment.find(a=>a.match_id===matchId);
      if(!already){
        DB.assignment.push({ id: 'asig-' + matchId, match_id: matchId, status: 'pendiente', reviewed_by: null });
      }
      return clone(m);
    },
    rejectDoctor(matchId, doctorUserId, reason){
      const m = DB.match.find(x=>x.id===matchId);
      if(!m) return null;
      m.status = 'rechazado_doctor';
      m.decided_by = doctorUserId;
      m.decided_at = new Date().toISOString();
      m.rejection_reason = reason || '';
      // Liberar el implante para otras solicitudes
      const implant = DB.implant.find(i=>i.id===m.implant_id);
      if(implant && implant.estado === 'reservado') implant.estado = 'disponible';
      return clone(m);
    },
  },

  assignments: {
    list(){ return clone(DB.assignment); },
    listByStatus(status){ return clone(DB.assignment.filter(a=>a.status===status)); },
    getById(id){ return findOrNull(DB.assignment, id); },
    approve(assignmentId, reviewerUserId){
      const a = DB.assignment.find(x=>x.id===assignmentId);
      if(!a) return null;
      a.status = 'aprobada';
      a.reviewed_by = reviewerUserId;

      const m = DB.match.find(x=>x.id===a.match_id);
      if(m){
        m.status = 'aprobado_admin';
        const req = DB.request.find(r=>r.id===m.request_id);
        const implant = DB.implant.find(i=>i.id===m.implant_id);
        if(implant) implant.estado = 'asignado';
        const dispatch = {
          id: uuid(),
          assignment_id: a.id,
          ips_id: req ? req.ips_id : null,
          status: 'por_etiquetar',
        };
        DB.dispatch.push(dispatch);
      }
      return clone(a);
    },
    reject(assignmentId, reviewerUserId, reason){
      const a = DB.assignment.find(x=>x.id===assignmentId);
      if(!a) return null;
      a.status = 'rechazada';
      a.reviewed_by = reviewerUserId;
      const m = DB.match.find(x=>x.id===a.match_id);
      if(m){
        m.status = 'rechazado_admin';
        const implant = DB.implant.find(i=>i.id===m.implant_id);
        if(implant) implant.estado = 'disponible';
      }
      return clone(a);
    },
  },

  dispatches: {
    list(){ return clone(DB.dispatch); },
    listByStatus(status){ return clone(DB.dispatch.filter(d=>d.status===status)); },
    getById(id){ return findOrNull(DB.dispatch, id); },
    label(dispatchId){
      const d = DB.dispatch.find(x=>x.id===dispatchId);
      if(!d) return null;
      d.status = 'en_camino';
      return clone(d);
    },
    deliver(dispatchId){
      const d = DB.dispatch.find(x=>x.id===dispatchId);
      if(!d) return null;
      d.status = 'entregado';
      return clone(d);
    },
  },

  compose: {
    patient(id){ return findOrNull(DB.patient, id); },
    ips(id){ return findOrNull(DB.ips, id); },
    donor(id){ return findOrNull(DB.donor, id); },
    implant(id){ return findOrNull(DB.implant, id); },
    doctorDisplayName(userId){
      const profile = DB.doctor_profile.find(p=>p.user_id===userId);
      return profile ? profile.nombre : '—';
    },
  },
};

window.DB = DB;
window.API = API;

})();