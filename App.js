/* ==========================================================================
   TissueBank — Funcionalidades
   Todo lo que se ve en pantalla se construye leyendo `API` (definida en
   data.js). Ningún panel tiene datos escritos a mano en el HTML — cada
   render*() limpia su contenedor y lo vuelve a construir desde el estado
   actual de la "base de datos" en memoria.
   ========================================================================== */

let currentUser = null;

// ==========================================================================
// Helpers de formato
// ==========================================================================
function setText(id, value){ const el = document.getElementById(id); if(el) el.textContent = value; }

function formatDate(dateStr){
  if(!dateStr) return '—';
  const d = new Date(dateStr.slice(0,10) + 'T00:00:00');
  if(isNaN(d)) return '—';
  return d.toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' });
}
function formatDateShort(dateStr){
  if(!dateStr) return '—';
  const d = new Date(dateStr.slice(0,10) + 'T00:00:00');
  if(isNaN(d)) return '—';
  return d.toLocaleDateString('es-CO', { day:'2-digit', month:'short' });
}
function daysUntil(dateStr){
  const target = new Date(dateStr + 'T00:00:00');
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.round((target - now) / 86400000);
}

const ESTADO_LABELS = {
  disponible: { label: 'Disponible', badge: 'badge-green' },
  reservado: { label: 'Reservado', badge: 'badge-purple' },
  asignado: { label: 'Asignado', badge: 'badge-blue' },
  contraindicado: { label: 'Contraindicado', badge: 'badge-red' },
  vencido: { label: 'Vencido', badge: 'badge-gray' },
  despachado: { label: 'Despachado', badge: 'badge-gray' },
};

// ==========================================================================
// Navegación entre paneles
// ==========================================================================
function showPanel(name, btn){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>{
    b.classList.remove('active');
    b.setAttribute('aria-current','false');
  });
  document.getElementById('panel-'+name).classList.add('active');
  btn.classList.add('active');
  btn.setAttribute('aria-current','true');
  const contentEl = document.querySelector('.content');
  if(contentEl) contentEl.scrollTo({top:0, behavior:'instant'});
}

// ==========================================================================
// Tabs internos de panel (Pendientes | Historial)
// ==========================================================================
function showTab(groupId, tabName, btn){
  const tabsContainer = document.getElementById(groupId);
  if(!tabsContainer) return;
  tabsContainer.querySelectorAll('.panel-tab').forEach(t=>t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('[id^="'+groupId+'-"]').forEach(pane=>{
    if(pane.classList.contains('tab-pane')) pane.classList.remove('active');
  });
  const target = document.getElementById(groupId+'-'+tabName);
  if(target) target.classList.add('active');
}

// ==========================================================================
// Match expandible (Recomendaciones)
// ==========================================================================
function toggleMatch(cardId){
  const card = document.getElementById(cardId);
  if(!card) return;
  card.classList.toggle('expanded');
}

// ==========================================================================
// Modales genéricos
// ==========================================================================
function openModal(id){
  const overlay = document.getElementById(id);
  if(!overlay) return;
  overlay.classList.add('open');
}
function closeModal(id){
  const overlay = document.getElementById(id);
  if(!overlay) return;
  overlay.classList.remove('open');
}

// ==========================================================================
// Autenticación — valida contra API.auth.login (data.js)
// ==========================================================================
function iniciarSesion(){
  const userInput = document.getElementById('login-user');
  const passInput = document.getElementById('login-pass');
  const errorBox = document.getElementById('login-error');

  const username = userInput.value.trim().toLowerCase();
  const password = passInput.value;
  const result = API.auth.login(username, password);

  if(!result || result.inactive){
    errorBox.innerHTML = '<i class="ti ti-alert-triangle" style="font-size:14px"></i> ' + (result?.inactive
      ? 'Esta cuenta está desactivada. Contacta al administrador.'
      : 'Usuario o contraseña incorrectos.');
    errorBox.classList.add('show');
    passInput.value = '';
    passInput.focus();
    return;
  }
  errorBox.classList.remove('show');
  entrarComo(result.user);
}

function entrarComo(user){
  currentUser = user;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').classList.add('open');

  document.getElementById('topbar-user-name').textContent = user.displayName;
  document.getElementById('topbar-user-avatar').textContent = user.initials;
  document.body.dataset.role = user.role;

  if(user.role === 'doctor'){
    showPanel('solicitantes', document.querySelector('.nav-btn[data-panel="solicitantes"]'));
  } else {
    showPanel('solicitudes-edison', document.querySelector('.nav-btn[data-panel="solicitudes-edison"]'));
  }
  refreshAll();
}

function cerrarSesion(){
  currentUser = null;
  document.getElementById('app-shell').classList.remove('open');
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-error').classList.remove('show');
  document.body.removeAttribute('data-role');
}

// ==========================================================================
// Panel Solicitantes (doctor) — "Mis solicitudes"
// ==========================================================================
function renderMisSolicitudes(){
  const tbody = document.getElementById('mis-solicitudes-body');
  const emptyMsg = document.getElementById('mis-solicitudes-empty');
  if(!tbody || !currentUser) return;

  const reqs = API.requests.listByDoctor(currentUser.id);
  tbody.innerHTML = '';
  if(emptyMsg) emptyMsg.style.display = reqs.length === 0 ? 'block' : 'none';

  reqs.forEach(r=>{
    const p = API.compose.patient(r.patient_id);
    const ips = API.compose.ips(r.ips_id);
    const statusInfo = API.requests.getStatusLabel(r.id);
    const tr = document.createElement('tr');
    tr.className = 'row-clickable';
    tr.onclick = ()=>abrirDetalleSolicitud(r.id);
    tr.innerHTML = `
      <td>${p ? p.nombre+' '+p.apellido : '—'}</td>
      <td>${p ? p.tipo_identificacion+' '+p.numero_identificacion : '—'}</td>
      <td>${r.tejido_solicitado} ${r.alto_requerido}×${r.ancho_requerido}×${r.profundidad_requerida}</td>
      <td>${ips ? ips.nombre : '—'}</td>
      <td>${formatDate(r.fecha_estimada_cirugia)}</td>
      <td><span class="badge ${statusInfo.badge}">${statusInfo.label}</span></td>
    `;
    tbody.appendChild(tr);
  });

  const statusOf = r => API.requests.getStatus(r.id);
  setText('sol-stat-activas', reqs.length);
  setText('sol-stat-en-fila', reqs.filter(r=>statusOf(r)==='en_fila').length);
  setText('sol-stat-match-pendiente', reqs.filter(r=>['match_detectado','match_enviado','por_asignar'].includes(statusOf(r))).length);
  setText('sol-stat-asignadas', reqs.filter(r=>['asignada','etiquetado','en_camino','entregada'].includes(statusOf(r))).length);
}

// ==========================================================================
// Panel Solicitudes (admin, solo lectura)
// ==========================================================================
function renderTodasSolicitudes(){
  const tbody = document.getElementById('todas-solicitudes-body');
  if(!tbody) return;

  const reqs = API.requests.list();
  tbody.innerHTML = '';
  reqs.forEach(r=>{
    const p = API.compose.patient(r.patient_id);
    const ips = API.compose.ips(r.ips_id);
    const doctorName = API.compose.doctorDisplayName(r.doctor_id);
    const statusInfo = API.requests.getStatusLabel(r.id);
    const tr = document.createElement('tr');
    tr.className = 'row-clickable';
    tr.onclick = ()=>abrirDetalleSolicitud(r.id);
    tr.innerHTML = `
      <td>${p ? p.nombre+' '+p.apellido : '—'}</td>
      <td>${p ? p.tipo_identificacion+' '+p.numero_identificacion : '—'}</td>
      <td>${r.tejido_solicitado} ${r.alto_requerido}×${r.ancho_requerido}×${r.profundidad_requerida}</td>
      <td>${ips ? ips.nombre : '—'}</td>
      <td>${formatDate(r.fecha_estimada_cirugia)}</td>
      <td>${doctorName}</td>
      <td><span class="badge ${statusInfo.badge}">${statusInfo.label}</span></td>
    `;
    tbody.appendChild(tr);
  });

  const statusOf = r => API.requests.getStatus(r.id);
  setText('adm-stat-total', reqs.length);
  setText('adm-stat-en-fila', reqs.filter(r=>statusOf(r)==='en_fila').length);
  setText('adm-stat-en-proceso', reqs.filter(r=>['match_detectado','match_enviado','por_asignar'].includes(statusOf(r))).length);
  setText('adm-stat-resueltas', reqs.filter(r=>['asignada','etiquetado','en_camino','entregada'].includes(statusOf(r))).length);
}

// ==========================================================================
// Panel Tejidos — inventario agrupado por donante
// ==========================================================================
function buildImplantTile(implant, donor, expiring){
  const estadoInfo = ESTADO_LABELS[implant.estado] || ESTADO_LABELS.disponible;
  const showPorVencer = expiring && implant.estado === 'disponible';
  const tile = document.createElement('div');
  tile.className = 'implant-tile' + (implant.estado === 'contraindicado' ? ' state-contraindicado' : '');
  tile.onclick = () => abrirDetalleImplante(implant.id);
  tile.innerHTML = `
    <div class="implant-tile-top">
      <div>
        <div class="implant-tile-name">${implant.tipo_implante}</div>
        <div class="implant-tile-part">${implant.parte_cuerpo}</div>
      </div>
      <span class="badge ${showPorVencer ? 'badge-amber' : estadoInfo.badge}">${showPorVencer ? 'Por vencer' : estadoInfo.label}</span>
    </div>
    <span class="implant-tile-dims">${(implant.alto && implant.ancho) ? implant.alto+' × '+implant.ancho+' mm' : 'No cuantificado'}</span>
  `;
  return tile;
}

function renderInventarioTejidos(){
  const container = document.getElementById('inventario-donor-groups');
  const emptyMsg = document.getElementById('inventario-vacio');
  if(!container) return;

  const donors = API.donors.list();
  const implants = API.implants.list();
  container.innerHTML = '';
  let totalTiles = 0, disponibles = 0, reservados = 0, donantesActivos = 0;

  donors.forEach(donor=>{
    const donorImplants = implants.filter(i=>i.donor_id===donor.id && i.estado!=='despachado');
    if(donorImplants.length===0) return;
    donantesActivos++;
    totalTiles += donorImplants.length;
    const expiring = daysUntil(donor.fecha_vencimiento) <= 7 && daysUntil(donor.fecha_vencimiento) >= 0;

    const groupDiv = document.createElement('div');
    groupDiv.className = 'donor-group';
    groupDiv.innerHTML = `
      <div class="donor-group-head">
        <div class="donor-group-id">
          <span class="code-badge">${donor.codigo_donante}</span>
          <span class="donor-group-title">${donorImplants.length} implante${donorImplants.length===1?'':'s'}</span>
        </div>
        <div class="donor-group-meta">
          <span class="donor-meta-item"><i class="ti ti-calendar-event"></i> Extraído ${formatDate(donor.fecha_extraccion)}</span>
          <span class="donor-meta-item ${expiring?'expiring':''}"><i class="ti ${expiring?'ti-alert-triangle':'ti-clock'}"></i> Vence ${formatDate(donor.fecha_vencimiento)}</span>
        </div>
      </div>
      <div class="donor-group-body"></div>
    `;
    const body = groupDiv.querySelector('.donor-group-body');
    donorImplants.forEach(implant=>{
      body.appendChild(buildImplantTile(implant, donor, expiring));
      if(implant.estado==='disponible') disponibles++;
      if(implant.estado==='reservado') reservados++;
    });
    container.appendChild(groupDiv);
  });

  if(emptyMsg) emptyMsg.style.display = totalTiles===0 ? 'block' : 'none';
  setText('tej-tab-count-inventario', totalTiles);
  setText('tej-stat-disponibles', disponibles);
  setText('tej-stat-reservados', reservados);
  setText('tej-stat-donantes', donantesActivos);
}

function renderPorVencerTejidos(){
  const container = document.getElementById('vencer-donor-groups');
  const emptyMsg = document.getElementById('vencer-vacio');
  if(!container) return;

  const donors = API.donors.list();
  const implants = API.implants.list();
  container.innerHTML = '';
  let count = 0;

  donors.forEach(donor=>{
    const days = daysUntil(donor.fecha_vencimiento);
    if(days > 7 || days < 0) return;
    const risky = implants.filter(i=>i.donor_id===donor.id && ['disponible','reservado'].includes(i.estado));
    if(risky.length===0) return;
    count += risky.length;

    const groupDiv = document.createElement('div');
    groupDiv.className = 'donor-group';
    groupDiv.innerHTML = `
      <div class="donor-group-head">
        <div class="donor-group-id">
          <span class="code-badge">${donor.codigo_donante}</span>
          <span class="donor-group-title">${risky.length} implante${risky.length===1?'':'s'} en riesgo</span>
        </div>
        <div class="donor-group-meta">
          <span class="donor-meta-item expiring"><i class="ti ti-alert-triangle"></i> Vence ${formatDate(donor.fecha_vencimiento)} · ${days} día${days===1?'':'s'} restantes</span>
        </div>
      </div>
      <div class="donor-group-body"></div>
    `;
    const body = groupDiv.querySelector('.donor-group-body');
    risky.forEach(implant=> body.appendChild(buildImplantTile(implant, donor, true)));
    container.appendChild(groupDiv);
  });

  if(emptyMsg) emptyMsg.style.display = count===0 ? 'block' : 'none';
  setText('tej-tab-count-vencer', count);
  setText('tej-stat-por-vencer', count);
}

function renderHistorialDonantes(){
  const tbody = document.getElementById('historial-donantes-body');
  if(!tbody) return;

  const donors = API.donors.list();
  const implants = API.implants.list();
  tbody.innerHTML = '';

  donors.forEach(donor=>{
    const donorImplants = implants.filter(i=>i.donor_id===donor.id);
    if(donorImplants.length===0) return;
    if(!donorImplants.every(i=>i.estado==='despachado')) return;

    donorImplants.forEach(implant=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="code-badge">${donor.codigo_donante}</span></td>
        <td>${implant.parte_cuerpo}</td>
        <td>${implant.tipo_implante}</td>
        <td>${implant.alto ?? '—'} × ${implant.ancho ?? '—'}</td>
        <td>${formatDate(donor.fecha_vencimiento)}</td>
        <td><span class="badge badge-blue">Despachado${implant.codigo_visible ? ' — '+implant.codigo_visible : ''}</span></td>
      `;
      tbody.appendChild(tr);
    });
  });
}

// ==========================================================================
// Panel Recomendaciones
// ==========================================================================
function buildCompatRow(label, requestVal, percent, implantVal){
  const pct = percent ?? 0;
  const barClass = pct>=85 ? 'high' : (pct>=70 ? 'mid' : 'low');
  const detail = (implantVal !== undefined && implantVal !== null)
    ? `${requestVal} → ${implantVal} mm`
    : `${Math.round(pct)}% compatible`;
  const ok = pct >= 70;
  return `<div class="compat-row">
    <span class="compat-label">${label}</span>
    <div class="compat-bar-wrap"><div class="compat-bar ${barClass}" style="width:${Math.min(100,pct)}%"></div></div>
    <span class="compat-detail" style="color:${ok?'var(--teal-deep)':'var(--rust-deep)'}">${detail}</span>
    <span class="compat-icon"><i class="ti ${ok?'ti-check':'ti-alert-triangle'}" style="color:${ok?'var(--teal)':'var(--rust)'}"></i></span>
  </div>`;
}

function buildMatchCardPendiente(m){
  const req = API.requests.getById(m.request_id);
  const patient = API.compose.patient(req.patient_id);
  const implant = API.compose.implant(m.implant_id);
  const doctorName = API.compose.doctorDisplayName(req.doctor_id);
  const scoreClass = m.compatibility_score>=85 ? '' : (m.compatibility_score>=70 ? 'mid' : 'low');

  const card = document.createElement('div');
  card.className = 'match-card-v2';
  card.id = 'mc-'+m.id;
  card.innerHTML = `
    <div class="match-v2-summary" onclick="toggleMatch('mc-${m.id}')">
      <div class="match-v2-left">
        <div class="match-v2-score ${scoreClass}"><span>${Math.round(m.compatibility_score)}%</span></div>
        <div>
          <div class="match-v2-title">${patient.nombre} ${patient.apellido} → ${implant.tipo_implante}${implant.codigo_visible ? ' ('+implant.codigo_visible+')' : ''}</div>
          <div class="match-v2-meta"><span>${doctorName} · Cirugía ${formatDateShort(req.fecha_estimada_cirugia)}</span></div>
        </div>
      </div>
      <div class="match-v2-right">
        <span class="badge badge-gray">Pendiente de enviar</span>
        <i class="ti ti-chevron-down match-v2-chevron"></i>
      </div>
    </div>
    <div class="match-v2-detail">
      <div class="compat-block" style="margin-top:0">
        <div class="compat-title">Compatibilidad dimensional</div>
        ${buildCompatRow('Alto', req.alto_requerido, m.compatibility_alto, implant.alto)}
        ${buildCompatRow('Ancho', req.ancho_requerido, m.compatibility_ancho, implant.ancho)}
        ${buildCompatRow('Profundidad', req.profundidad_requerida, m.compatibility_profundidad)}
        <div class="compat-summary">
          <span class="compat-summary-label">Compatibilidad general</span>
          <span class="badge badge-green badge-lg">${m.compatibility_score>=85?'Alta':'Media'} — ${Math.round(m.compatibility_score)}%</span>
        </div>
      </div>
      <div class="match-footer" style="border-top:none;margin-top:14px;padding-top:0">
        <span style="font-size:11px;color:var(--ink-faint)">Se notificará por correo al doctor solicitante</span>
        <button class="btn-send" onclick="event.stopPropagation(); enviarMatchUI('${m.id}')"><i class="ti ti-send" style="font-size:13px"></i> Enviar match al doctor</button>
      </div>
    </div>
  `;
  return card;
}

function renderMatchesPendientes(){
  const container = document.getElementById('matches-pendientes-list');
  const emptyMsg = document.getElementById('matches-pendientes-vacio');
  if(!container) return;

  const matches = API.matches.listByStatus(['detectado']);
  container.innerHTML = '';
  if(emptyMsg) emptyMsg.style.display = matches.length===0 ? 'block' : 'none';
  matches.forEach(m=> container.appendChild(buildMatchCardPendiente(m)));

  setText('reco-pendientes-count', matches.length);
  setText('reco-stat-por-enviar', matches.length);
  setText('reco-stat-detectados', API.matches.list().length);
}

function buildMatchCardEsperando(m){
  const req = API.requests.getById(m.request_id);
  const patient = API.compose.patient(req.patient_id);
  const implant = API.compose.implant(m.implant_id);
  const doctorName = API.compose.doctorDisplayName(req.doctor_id);
  const sentDate = m.sent_at ? new Date(m.sent_at) : null;
  const minutesAgo = sentDate ? Math.max(0, Math.round((Date.now()-sentDate.getTime())/60000)) : null;
  const tiempoTxt = minutesAgo===null ? '—' : (minutesAgo<60 ? `${minutesAgo} min` : `${Math.round(minutesAgo/60)} h`);

  const card = document.createElement('div');
  card.className = 'dispatch-card';
  card.innerHTML = `
    <div class="dispatch-card-head">
      <div class="dispatch-card-title">${patient.nombre} ${patient.apellido} → ${implant.tipo_implante}${implant.codigo_visible ? ' ('+implant.codigo_visible+')' : ''}</div>
      <span class="badge badge-blue">Esperando respuesta</span>
    </div>
    <div class="dispatch-timeline">
      <div class="dispatch-tl-step done"><div class="dispatch-tl-dot"></div><span class="dispatch-tl-label">Match detectado</span></div>
      <div class="dispatch-tl-step done"><div class="dispatch-tl-line"></div><div class="dispatch-tl-dot"></div><span class="dispatch-tl-label">Enviado</span></div>
      <div class="dispatch-tl-step current"><div class="dispatch-tl-line"></div><div class="dispatch-tl-dot"></div><span class="dispatch-tl-label">Doctor responde</span></div>
    </div>
    <div class="dispatch-card-body">
      <div class="etiq-grid" style="margin-bottom:14px">
        <div class="etiq-field"><div class="etiq-label">Compatibilidad</div><div class="etiq-value">${Math.round(m.compatibility_score)}%</div></div>
        <div class="etiq-field"><div class="etiq-label">Doctor</div><div class="etiq-value">${doctorName}</div></div>
        <div class="etiq-field"><div class="etiq-label">Cirugía</div><div class="etiq-value">${formatDate(req.fecha_estimada_cirugia)}</div></div>
        <div class="etiq-field"><div class="etiq-label">Enviado</div><div class="etiq-value">${sentDate ? sentDate.toLocaleString('es-CO',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'}</div></div>
        <div class="etiq-field"><div class="etiq-label">Tiempo esperando</div><div class="etiq-value">${tiempoTxt}</div></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn-outline" onclick="reenviarCorreoUI('${m.id}')"><i class="ti ti-mail-forward" style="font-size:13px"></i> Reenviar correo</button>
        <button class="btn-danger" onclick="cancelarEnvioUI('${m.id}')"><i class="ti ti-x" style="font-size:13px"></i> Cancelar envío</button>
      </div>
    </div>
  `;
  return card;
}

function renderMatchesEsperando(){
  const container = document.getElementById('matches-esperando-list');
  const emptyMsg = document.getElementById('reco-esperando-empty');
  if(!container) return;

  const matches = API.matches.listByStatus(['enviado']);
  container.innerHTML = '';
  if(emptyMsg) emptyMsg.style.display = matches.length===0 ? 'block' : 'none';
  matches.forEach(m=> container.appendChild(buildMatchCardEsperando(m)));

  setText('reco-esperando-count', matches.length);
  setText('reco-esperando-stat', matches.length);
}

function renderMatchesHistorial(){
  const tbody = document.getElementById('reco-historial-body');
  if(!tbody) return;

  const matches = API.matches.listByStatus(['aprobado_doctor','aprobado_admin','rechazado_doctor','rechazado_admin']);
  tbody.innerHTML = '';
  matches.forEach(m=>{
    const req = API.requests.getById(m.request_id);
    const patient = API.compose.patient(req.patient_id);
    const implant = API.compose.implant(m.implant_id);
    const aprobado = ['aprobado_doctor','aprobado_admin'].includes(m.status);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${patient.nombre} ${patient.apellido}</td>
      <td>${implant.tipo_implante}${implant.codigo_visible ? ' '+implant.codigo_visible : ''}</td>
      <td>${Math.round(m.compatibility_score)}%</td>
      <td><span class="badge ${aprobado?'badge-green':'badge-red'}">${aprobado?'Aprobado':'Rechazado'}</span></td>
      <td>${m.sent_at ? formatDate(m.sent_at) : '—'}</td>
    `;
    tbody.appendChild(tr);
  });

  setText('reco-stat-aprobados', matches.filter(m=>['aprobado_doctor','aprobado_admin'].includes(m.status)).length);
}

function enviarMatchUI(matchId){ API.matches.send(matchId); refreshAll(); }
function reenviarCorreoUI(matchId){ API.matches.resend(matchId); refreshAll(); }
function cancelarEnvioUI(matchId){ API.matches.cancelSend(matchId); refreshAll(); }

// ==========================================================================
// Panel Asignaciones
// ==========================================================================
function renderAsignacionesPendientes(){
  const container = document.getElementById('asig-pending');
  const doneMsg = document.getElementById('asig-done');
  if(!container) return;

  const pendientes = API.assignments.listByStatus('pendiente');
  container.innerHTML = '';
  if(doneMsg) doneMsg.style.display = pendientes.length===0 ? 'block' : 'none';

  pendientes.forEach(a=>{
    const m = API.matches.getById(a.match_id);
    const req = API.requests.getById(m.request_id);
    const patient = API.compose.patient(req.patient_id);
    const implant = API.compose.implant(m.implant_id);
    const ips = API.compose.ips(req.ips_id);
    const doctorName = API.compose.doctorDisplayName(req.doctor_id);

    const card = document.createElement('div');
    card.className = 'match-card';
    card.innerHTML = `
      <div class="match-top">
        <div class="match-info">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
            <div class="match-title" style="margin-bottom:0">${patient.nombre} ${patient.apellido} — ${req.procedimiento_quirurgico || req.tejido_solicitado}</div>
          </div>
          <div class="match-meta">${implant.tipo_implante}${implant.codigo_visible ? ' '+implant.codigo_visible : ''} ${implant.alto ?? '?'}×${implant.ancho ?? '?'} mm · Compatibilidad: ${Math.round(m.compatibility_score)}% · ${doctorName} aprobó</div>
          <div style="font-size:10.5px;color:var(--ink-faint);margin-top:4px">IPS: ${ips?ips.nombre:'—'} · Cirugía: ${formatDate(req.fecha_estimada_cirugia)} · Identificación: ${patient.tipo_identificacion} ${patient.numero_identificacion}</div>
        </div>
        <span class="badge badge-green" style="align-self:center;white-space:nowrap">Doctor aprobó</span>
      </div>
      <div class="match-footer">
        <span style="font-size:11.5px;color:var(--ink-faint)">Último paso antes de etiquetado</span>
        <div style="display:flex;gap:10px">
          <button class="btn-success" onclick="aprobarAsignacionUI('${a.id}')"><i class="ti ti-check" style="font-size:13px"></i> Aprobar y asignar</button>
          <button class="btn-danger" onclick="rechazarAsignacionUI('${a.id}')">Rechazar</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  setText('stat-pend', pendientes.length);
}

function renderAsignacionesHistorial(){
  const tbody = document.getElementById('hist-body');
  if(!tbody) return;

  const historial = API.assignments.list().filter(a=>a.status!=='pendiente');
  tbody.innerHTML = '';
  historial.forEach(a=>{
    const m = API.matches.getById(a.match_id);
    const req = API.requests.getById(m.request_id);
    const patient = API.compose.patient(req.patient_id);
    const implant = API.compose.implant(m.implant_id);
    const ips = API.compose.ips(req.ips_id);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${patient.nombre} ${patient.apellido}</td>
      <td>${implant.tipo_implante}${implant.codigo_visible ? ' '+implant.codigo_visible : ''}</td>
      <td>${ips?ips.nombre:'—'}</td>
      <td><span class="badge ${a.status==='aprobada'?'badge-green':'badge-red'}">${a.status==='aprobada'?'Aprobada':'Rechazada'}</span></td>
    `;
    tbody.appendChild(tr);
  });

  setText('asig-stat-aprobadas', historial.filter(a=>a.status==='aprobada').length);
  setText('asig-stat-rechazadas', historial.filter(a=>a.status==='rechazada').length);
  setText('asig-stat-total', API.assignments.list().length);
}

function aprobarAsignacionUI(assignmentId){ API.assignments.approve(assignmentId, currentUser.id); refreshAll(); }
function rechazarAsignacionUI(assignmentId){ API.assignments.reject(assignmentId, currentUser.id, ''); refreshAll(); }

// ==========================================================================
// Panel Etiquetado
// ==========================================================================
function renderDespachosPorEtiquetar(){
  const container = document.getElementById('etiq-pending-card');
  const doneMsg = document.getElementById('etiq-done');
  if(!container) return;

  const pendientes = API.dispatches.listByStatus('por_etiquetar');
  container.innerHTML = '';
  if(doneMsg) doneMsg.style.display = pendientes.length===0 ? 'block' : 'none';

  pendientes.forEach(d=>{
    const a = API.assignments.getById(d.assignment_id);
    const m = API.matches.getById(a.match_id);
    const req = API.requests.getById(m.request_id);
    const patient = API.compose.patient(req.patient_id);
    const implant = API.compose.implant(m.implant_id);
    const ips = API.compose.ips(d.ips_id);
    const donor = API.compose.donor(implant.donor_id);
    const doctorName = API.compose.doctorDisplayName(req.doctor_id);

    const codigoOrden = req.codigo_visible || '—';
    const donorSexo = donor ? donor.sexo_biologico : '—';
    const patientSexo = patient.sexo_biologico || '—';

    const card = document.createElement('div');
    card.className = 'dispatch-card';
    card.innerHTML = `
      <div class="dispatch-card-head">
        <div class="dispatch-card-title">${implant.tipo_implante}${implant.codigo_visible ? ' — '+implant.codigo_visible : ''} <span style="font-family:monospace;font-size:11px;background:var(--blue-faint);color:var(--blue-deep);padding:1px 7px;border-radius:4px;margin-left:6px">${codigoOrden}</span></div>
        <span class="badge badge-amber">Por etiquetar</span>
      </div>
      <div class="dispatch-timeline">
        <div class="dispatch-tl-step done"><div class="dispatch-tl-dot"></div><span class="dispatch-tl-label">Aprobado</span></div>
        <div class="dispatch-tl-step current"><div class="dispatch-tl-line"></div><div class="dispatch-tl-dot"></div><span class="dispatch-tl-label">Etiquetado</span></div>
        <div class="dispatch-tl-step"><div class="dispatch-tl-line"></div><div class="dispatch-tl-dot"></div><span class="dispatch-tl-label">En camino</span></div>
        <div class="dispatch-tl-step"><div class="dispatch-tl-line"></div><div class="dispatch-tl-dot"></div><span class="dispatch-tl-label">Entregado</span></div>
      </div>

      <!-- ETIQUETA GENERADA AUTOMÁTICAMENTE -->
      <div class="etiqueta-generada" id="etiqueta-${d.id}">
        <div class="etiqueta-header">
          <div class="etiqueta-brand">Tissue<span>Bank</span></div>
          <div class="etiqueta-codigo">${codigoOrden}</div>
        </div>
        <div class="etiqueta-body">
          <div class="etiqueta-row"><span class="etiqueta-lbl">Paciente</span><span class="etiqueta-val">${patient.nombre} ${patient.apellido}</span></div>
          <div class="etiqueta-row"><span class="etiqueta-lbl">Identificación</span><span class="etiqueta-val">${patient.tipo_identificacion} ${patient.numero_identificacion}</span></div>
          <div class="etiqueta-row"><span class="etiqueta-lbl">Sexo paciente</span><span class="etiqueta-val">${patientSexo === 'M' ? 'Masculino' : patientSexo === 'F' ? 'Femenino' : '—'}</span></div>
          <div class="etiqueta-row"><span class="etiqueta-lbl">Tejido</span><span class="etiqueta-val">${implant.tipo_implante} · ${implant.alto ?? '?'}×${implant.ancho ?? '?'} mm</span></div>
          <div class="etiqueta-row"><span class="etiqueta-lbl">Donante</span><span class="etiqueta-val">${donor ? donor.codigo_donante : '—'} · Sexo: ${donorSexo === 'M' ? 'M' : donorSexo === 'F' ? 'F' : '—'}</span></div>
          <div class="etiqueta-row etiqueta-ips"><span class="etiqueta-lbl">IPS destino</span><span class="etiqueta-val">${ips ? ips.nombre : '—'}${ips && ips.ciudad ? ', '+ips.ciudad : ''}</span></div>
          <div class="etiqueta-row"><span class="etiqueta-lbl">Médico</span><span class="etiqueta-val">${doctorName}</span></div>
          <div class="etiqueta-row"><span class="etiqueta-lbl">Cirugía estimada</span><span class="etiqueta-val">${formatDate(req.fecha_estimada_cirugia)}</span></div>
        </div>
        <div class="etiqueta-footer">Generado automáticamente por TissueBank · ${new Date().toLocaleDateString('es-CO')}</div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
        <button class="btn-outline" onclick="imprimirEtiqueta('${d.id}')"><i class="ti ti-printer" style="font-size:13px"></i> Imprimir etiqueta</button>
        <button class="btn-tag" onclick="etiquetarDespachoUI('${d.id}')"><i class="ti ti-truck-delivery" style="font-size:13px"></i> Marcar como en camino</button>
      </div>
    `;
    container.appendChild(card);
  });

  setText('etiq-pend', pendientes.length);
  setText('etiq-tab-count', pendientes.length);
}

function renderDespachosEnCamino(){
  const container = document.getElementById('etiq-camino-list');
  const emptyMsg = document.getElementById('etiq-camino-vacio');
  if(!container) return;

  const enCamino = API.dispatches.listByStatus('en_camino');
  container.innerHTML = '';
  if(emptyMsg) emptyMsg.style.display = enCamino.length===0 ? 'block' : 'none';

  enCamino.forEach(d=>{
    const a = API.assignments.getById(d.assignment_id);
    const m = API.matches.getById(a.match_id);
    const req = API.requests.getById(m.request_id);
    const patient = API.compose.patient(req.patient_id);
    const implant = API.compose.implant(m.implant_id);
    const ips = API.compose.ips(d.ips_id);

    const card = document.createElement('div');
    card.className = 'dispatch-card';
    card.innerHTML = `
      <div class="dispatch-card-head">
        <div class="dispatch-card-title">${implant.tipo_implante}${implant.codigo_visible ? ' — '+implant.codigo_visible : ''}</div>
        <span class="badge badge-blue">En camino</span>
      </div>
      <div class="dispatch-timeline">
        <div class="dispatch-tl-step done"><div class="dispatch-tl-dot"></div><span class="dispatch-tl-label">Aprobado</span></div>
        <div class="dispatch-tl-step done"><div class="dispatch-tl-line"></div><div class="dispatch-tl-dot"></div><span class="dispatch-tl-label">Etiquetado</span></div>
        <div class="dispatch-tl-step current"><div class="dispatch-tl-line"></div><div class="dispatch-tl-dot"></div><span class="dispatch-tl-label">En camino</span></div>
        <div class="dispatch-tl-step"><div class="dispatch-tl-line"></div><div class="dispatch-tl-dot"></div><span class="dispatch-tl-label">Entregado</span></div>
      </div>
      <div class="dispatch-card-body">
        <div class="etiq-grid">
          <div class="etiq-field"><div class="etiq-label">Paciente</div><div class="etiq-value">${patient.nombre} ${patient.apellido}</div></div>
          <div class="etiq-field"><div class="etiq-label">IPS de destino</div><div class="etiq-value">${ips?ips.nombre:'—'}</div></div>
          <div class="etiq-field"><div class="etiq-label">Cirugía</div><div class="etiq-value">${formatDate(req.fecha_estimada_cirugia)}</div></div>
        </div>
        <div style="margin-top:12px">
          <button class="btn-outline" onclick="entregarDespachoUI('${d.id}')"><i class="ti ti-check" style="font-size:13px"></i> Marcar como entregado</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });

  setText('etiq-tab-count-camino', enCamino.length);
  setText('etiq-stat-camino', enCamino.length);
}

function renderDespachosEntregados(){
  const tbody = document.getElementById('despacho-body');
  if(!tbody) return;

  const entregados = API.dispatches.listByStatus('entregado');
  tbody.innerHTML = '';
  entregados.forEach(d=>{
    const a = API.assignments.getById(d.assignment_id);
    const m = API.matches.getById(a.match_id);
    const req = API.requests.getById(m.request_id);
    const patient = API.compose.patient(req.patient_id);
    const implant = API.compose.implant(m.implant_id);
    const ips = API.compose.ips(d.ips_id);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span style="font-family:monospace;font-size:11px;background:var(--blue-faint);color:var(--blue-deep);padding:1px 7px;border-radius:4px">${req.codigo_visible || '—'}</span></td>
      <td>${implant.tipo_implante}${implant.codigo_visible ? ' '+implant.codigo_visible : ''}</td>
      <td>${patient.nombre} ${patient.apellido}</td>
      <td>${ips?ips.nombre:'—'}</td>
      <td>${formatDate(req.fecha_estimada_cirugia)}</td>
      <td><span class="badge badge-green">Entregado</span></td>
    `;
    tbody.appendChild(tr);
  });

  setText('etiq-stat-entregados', entregados.length);
  setText('etiq-stat-total', API.dispatches.list().length);
}

function etiquetarDespachoUI(dispatchId){ API.dispatches.label(dispatchId); refreshAll(); }
function entregarDespachoUI(dispatchId){ API.dispatches.deliver(dispatchId); refreshAll(); }

function imprimirEtiqueta(dispatchId){
  const etiquetaEl = document.getElementById('etiqueta-' + dispatchId);
  if(!etiquetaEl){ alert('No se encontró la etiqueta.'); return; }
  const printWin = window.open('', '_blank', 'width=400,height=600');
  printWin.document.write(`
    <!DOCTYPE html><html><head><meta charset="UTF-8"/>
    <title>Etiqueta TissueBank</title>
    <style>
      body{font-family:Arial,sans-serif;margin:0;padding:16px;background:#fff;color:#111}
      .etiqueta-generada{border:2px solid #1a3a6b;border-radius:10px;padding:14px;max-width:340px;margin:0 auto}
      .etiqueta-header{display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px solid #1a3a6b;padding-bottom:8px;margin-bottom:10px}
      .etiqueta-brand{font-size:18px;font-weight:700;color:#1a3a6b}.etiqueta-brand span{color:#1D9E75}
      .etiqueta-codigo{font-family:monospace;font-size:13px;background:#E6F1FB;color:#0C447C;padding:2px 8px;border-radius:4px}
      .etiqueta-row{display:flex;gap:8px;margin-bottom:6px;font-size:12px}
      .etiqueta-lbl{color:#888;width:110px;flex-shrink:0;font-size:11px}
      .etiqueta-val{font-weight:500;color:#111}
      .etiqueta-ips .etiqueta-val{font-weight:700;font-size:13px}
      .etiqueta-footer{margin-top:10px;padding-top:8px;border-top:1px solid #e0e0e0;font-size:10px;color:#aaa;text-align:center}
    </style></head><body>` + etiquetaEl.outerHTML + `</body></html>`);
  printWin.document.close();
  printWin.focus();
  setTimeout(()=>{ printWin.print(); printWin.close(); }, 300);
}

// ==========================================================================
// Panel Doctores (admin) — crear / editar / activar / desactivar cuentas
// ==========================================================================
function renderDoctoresAdmin(){
  const tbody = document.getElementById('doctores-body');
  if(!tbody) return;

  const doctores = API.users.listDoctors();
  tbody.innerHTML = '';
  doctores.forEach(d=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${d.nombre || '—'}</td>
      <td>${d.cedula || '—'}</td>
      <td>${d.username}</td>
      <td>${d.telefono || '—'}</td>
      <td>${d.email || '—'}</td>
      <td><span class="badge ${d.is_active ? 'badge-green' : 'badge-gray'}">${d.is_active ? 'Activo' : 'Desactivado'}</span></td>
      <td>
        <div style="display:flex;gap:6px">
          <button type="button" class="implant-action-btn" title="Editar" onclick="abrirEditarDoctorUI('${d.user_id}')"><i class="ti ti-pencil"></i></button>
          <button type="button" class="implant-action-btn ${d.is_active ? 'danger' : ''}" title="${d.is_active ? 'Desactivar' : 'Activar'}" onclick="toggleActivoDoctorUI('${d.user_id}', ${d.is_active})">
            <i class="ti ${d.is_active ? 'ti-user-off' : 'ti-user-check'}"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  setText('doc-stat-total', doctores.length);
  setText('doc-stat-activos', doctores.filter(d=>d.is_active).length);
  setText('doc-stat-inactivos', doctores.filter(d=>!d.is_active).length);
}

function prepararModalNuevoDoctor(){
  ['doc-cedula','doc-nombre','doc-telefono','doc-email','doc-username'].forEach(id=>{
    const el = document.getElementById(id);
    if(el){ el.value=''; el.classList.remove('invalid'); }
  });
  document.getElementById('doc-form-error').style.display = 'none';
}

function crearDoctorUI(){
  const requiredIds = ['doc-cedula','doc-nombre','doc-username'];
  let valid = true;
  requiredIds.forEach(id=>{
    const el = document.getElementById(id);
    const errorEl = document.getElementById(id+'-error');
    if(!el.value || !el.value.trim()){
      el.classList.add('invalid');
      if(errorEl) errorEl.classList.add('show');
      valid = false;
    } else {
      el.classList.remove('invalid');
      if(errorEl) errorEl.classList.remove('show');
    }
  });
  if(!valid) return;

  const result = API.users.create({
    cedula: document.getElementById('doc-cedula').value.trim(),
    nombre: document.getElementById('doc-nombre').value.trim(),
    telefono: Number(document.getElementById('doc-telefono').value) || null,
    email: document.getElementById('doc-email').value.trim(),
    username: document.getElementById('doc-username').value.trim(),
  });

  if(result.error === 'USERNAME_TAKEN'){
    const banner = document.getElementById('doc-form-error');
    document.getElementById('doc-form-error-msg').textContent = 'Ese usuario ya existe — elige otro.';
    banner.style.display = 'flex';
    document.getElementById('doc-username').classList.add('invalid');
    return;
  }

  closeModal('modal-nuevo-doctor');
  refreshAll();
  mostrarCredenciales(result.username, result.password);
}

function abrirEditarDoctorUI(userId){
  const doctores = API.users.listDoctors();
  const d = doctores.find(x=>x.user_id===userId);
  if(!d) return;
  document.getElementById('edit-doc-user-id').value = d.user_id;
  document.getElementById('edit-doc-cedula').value = d.cedula || '';
  document.getElementById('edit-doc-username').value = d.username;
  document.getElementById('edit-doc-nombre').value = d.nombre || '';
  document.getElementById('edit-doc-telefono').value = d.telefono || '';
  document.getElementById('edit-doc-email').value = d.email || '';
  openModal('modal-editar-doctor');
}

function guardarEdicionDoctorUI(){
  const userId = document.getElementById('edit-doc-user-id').value;
  const nombreEl = document.getElementById('edit-doc-nombre');
  if(!nombreEl.value.trim()){
    nombreEl.classList.add('invalid');
    document.getElementById('edit-doc-nombre-error').classList.add('show');
    return;
  }
  nombreEl.classList.remove('invalid');
  document.getElementById('edit-doc-nombre-error').classList.remove('show');

  API.users.updateProfile(userId, {
    nombre: nombreEl.value.trim(),
    telefono: Number(document.getElementById('edit-doc-telefono').value) || null,
    email: document.getElementById('edit-doc-email').value.trim(),
  });

  closeModal('modal-editar-doctor');
  refreshAll();
}

function toggleActivoDoctorUI(userId, currentlyActive){
  API.users.setActive(userId, !currentlyActive);
  refreshAll();
}

function resetPasswordUI(userId){
  const result = API.users.resetPassword(userId);
  if(!result) return;
  closeModal('modal-editar-doctor');
  mostrarCredenciales(result.username, result.password);
}

function mostrarCredenciales(username, password){
  document.getElementById('cred-username').value = username;
  document.getElementById('cred-password').value = password;
  openModal('modal-credenciales');
}

function copiarCredencial(inputId){
  const input = document.getElementById(inputId);
  input.select();
  navigator.clipboard?.writeText(input.value).catch(()=>{ /* clipboard no disponible, el texto ya queda seleccionado para copiar manual */ });
}

// ==========================================================================
// Panel Mi perfil (doctor_profile)
// ==========================================================================
function renderPerfilDoctor(){
  if(!currentUser || currentUser.role !== 'doctor') return;
  const profile = API.doctorProfile.getByUserId(currentUser.id);
  if(!profile) return;
  document.getElementById('perfil-id').value = profile.id;
  document.getElementById('perfil-nombre').value = profile.nombre;
  document.getElementById('perfil-telefono').value = profile.telefono || '';
  document.getElementById('perfil-email').value = profile.email || '';
}

function guardarPerfilDoctor(){
  const requiredIds = ['perfil-id','perfil-nombre'];
  let valid = true;
  requiredIds.forEach(id=>{
    const el = document.getElementById(id);
    if(!el.value || !el.value.trim()){ el.classList.add('invalid'); valid = false; }
    else el.classList.remove('invalid');
  });
  if(!valid) return;

  API.doctorProfile.update(currentUser.id, {
    nombre: document.getElementById('perfil-nombre').value.trim(),
    telefono: Number(document.getElementById('perfil-telefono').value) || null,
    email: document.getElementById('perfil-email').value.trim(),
  });

  const banner = document.getElementById('perfil-success-banner');
  if(banner){ banner.style.display='flex'; setTimeout(()=>{ banner.style.display='none'; }, 4000); }
}

// ==========================================================================
// Modal: Nueva solicitud — arranca vacío, lo llena quien hace la demo
// ==========================================================================
function prepararModalNuevaSolicitud(){
  ['sol-tipo-identificacion','sol-nombre','sol-apellido','sol-fecha-nac','sol-edad','sol-nacionalidad',
   'sol-ips-nombre','sol-ips-ciudad','sol-ips-direccion','sol-ips-telefono',
   'sol-tejido-tipo','sol-procedimiento','sol-fecha-cirugia','sol-alto','sol-ancho','sol-prof','sol-diagnostico'
  ].forEach(id=>{
    const el = document.getElementById(id);
    if(el){ el.value=''; el.classList.remove('invalid'); }
  });
  document.getElementById('sol-form-error').style.display = 'none';
  document.getElementById('sol-success-banner').style.display = 'none';
}

function validarSolicitud(){
  const requiredIds = ['sol-tipo-identificacion','sol-nombre','sol-apellido','sol-ips-nombre','sol-fecha-cirugia','sol-tejido-tipo','sol-alto','sol-ancho','sol-prof'];
  let valid = true;
  requiredIds.forEach(id=>{
    const el = document.getElementById(id);
    const errorEl = document.getElementById(id+'-error');
    if(!el.value || !el.value.trim()){
      el.classList.add('invalid');
      if(errorEl) errorEl.classList.add('show');
      valid = false;
    } else {
      el.classList.remove('invalid');
      if(errorEl) errorEl.classList.remove('show');
    }
  });
  return valid;
}

function enviarSolicitud(){
  if(!validarSolicitud()){
    const banner = document.getElementById('sol-form-error');
    banner.style.display = 'flex';
    banner.scrollIntoView({behavior:'smooth', block:'center'});
    return;
  }
  document.getElementById('sol-form-error').style.display = 'none';

  const ipsNombre = document.getElementById('sol-ips-nombre').value.trim();
  let ips = API.ips.findByName(ipsNombre);
  if(!ips){
    ips = API.ips.create({
      nombre: ipsNombre,
      direccion: document.getElementById('sol-ips-direccion').value.trim(),
      telefono: document.getElementById('sol-ips-telefono').value.trim(),
      ciudad: document.getElementById('sol-ips-ciudad').value.trim(),
    });
  }

  const sexoNoImportante = document.getElementById('sol-sexo-no-importante')?.checked || false;

  const patient = API.patients.create({
    tipo_identificacion: document.getElementById('sol-tipo-identificacion').value,
    nombre: document.getElementById('sol-nombre').value.trim(),
    apellido: document.getElementById('sol-apellido').value.trim(),
    fecha_nacimiento: document.getElementById('sol-fecha-nac').value || null,
    edad: Number(document.getElementById('sol-edad').value) || null,
    nacionalidad: document.getElementById('sol-nacionalidad').value.trim(),
    sexo_biologico: document.getElementById('sol-sexo-biologico')?.value || null,
  });

  API.requests.create({
    patient_id: patient.id,
    doctor_id: currentUser.id,
    ips_id: ips.id,
    tejido_solicitado: document.getElementById('sol-tejido-tipo').value.trim(),
    procedimiento_quirurgico: document.getElementById('sol-procedimiento').value.trim(),
    alto_requerido: Number(document.getElementById('sol-alto').value),
    ancho_requerido: Number(document.getElementById('sol-ancho').value),
    profundidad_requerida: Number(document.getElementById('sol-prof').value),
    fecha_estimada_cirugia: document.getElementById('sol-fecha-cirugia').value,
    diagnostico: document.getElementById('sol-diagnostico').value.trim(),
    sexo_importante: !sexoNoImportante,
  });

  const banner = document.getElementById('sol-success-banner');
  banner.style.display = 'flex';
  refreshAll();
  setTimeout(()=>{
    banner.style.display = 'none';
    closeModal('modal-nueva-solicitud');
  }, 1200);
}

// ==========================================================================
// Modal: Registrar donante e implantes — arranca vacío
// ==========================================================================
let implantesPendientes = [];

function prepararModalNuevoDonante(){
  implantesPendientes = [];
  renderImplantesLista();
  ['donante-codigo','donante-fecha-extraccion','donante-fecha-procedimiento','donante-fecha-segundo-cambio','donante-fecha-vencimiento'].forEach(id=>{
    const el = document.getElementById(id);
    if(el){ el.value=''; el.classList.remove('invalid'); }
  });
  document.getElementById('modal-donante-codigo-badge').textContent = '(sin código)';
  cancelarEdicionImplante();
}

function actualizarBadgeDonante(){
  const codigo = document.getElementById('donante-codigo').value || '(sin código)';
  const badge = document.getElementById('modal-donante-codigo-badge');
  if(badge) badge.textContent = codigo;
}

function renderImplantesLista(){
  const container = document.getElementById('implantes-lista');
  const emptyMsg = document.getElementById('implantes-lista-vacia');
  if(!container) return;
  container.innerHTML = '';
  if(implantesPendientes.length === 0){
    if(emptyMsg) emptyMsg.style.display = 'block';
    return;
  }
  if(emptyMsg) emptyMsg.style.display = 'none';

  implantesPendientes.forEach((implante, index)=>{
    const estadoInfo = ESTADO_LABELS[implante.estado] || ESTADO_LABELS.disponible;
    const card = document.createElement('div');
    card.className = 'implant-card';
    card.innerHTML = `
      <div class="implant-header">
        <div class="implant-title">Implante ${index + 1} — ${implante.tipo_implante || 'Sin tipo'}</div>
        <div class="implant-actions">
          <span class="badge ${estadoInfo.badge}">${estadoInfo.label}</span>
          <button type="button" class="implant-action-btn" title="Editar" onclick="editarImplante(${index})"><i class="ti ti-pencil"></i></button>
          <button type="button" class="implant-action-btn danger" title="Eliminar" onclick="eliminarImplante(${index})"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div class="implant-grid">
        <div>${implante.url_imagen ? `<img class="implant-thumb" src="${implante.url_imagen}" alt=""/>` : '<span class="implant-grid-label">Sin foto</span>'}</div>
        <div><span class="implant-grid-label">Parte del cuerpo</span>${implante.parte_cuerpo || '—'}</div>
        <div><span class="implant-grid-label">Dimensiones (mm)</span>${implante.alto || '?'} × ${implante.ancho || '?'}</div>
        <div><span class="implant-grid-label">Estado</span>${estadoInfo.label}</div>
      </div>
      ${implante.notas_adicionales ? `<div class="implant-notas-row"><strong>Notas:</strong> ${implante.notas_adicionales}</div>` : ''}
    `;
    container.appendChild(card);
  });
}

function limpiarFormularioImplante(){
  document.getElementById('implant-parte-cuerpo').value = '';
  document.getElementById('implant-tipo-implante').value = '';
  document.getElementById('implant-alto').value = '';
  document.getElementById('implant-ancho').value = '';
  document.getElementById('implant-estado').value = 'disponible';
  document.getElementById('implant-notas').value = '';
  document.getElementById('implant-url-imagen').value = '';
  document.getElementById('implant-foto-input').value = '';
  document.getElementById('implant-foto-preview').style.display = 'none';
  document.getElementById('implant-foto-preview').src = '';
  document.getElementById('implant-upload-icon').style.display = '';
  document.getElementById('implant-upload-text').style.display = '';
  ['implant-parte-cuerpo','implant-tipo-implante','implant-alto','implant-ancho'].forEach(id=>{
    document.getElementById(id).classList.remove('invalid');
    const err = document.getElementById(id+'-error');
    if(err) err.classList.remove('show');
  });
}

function validarFormularioImplante(){
  const requiredIds = ['implant-parte-cuerpo','implant-tipo-implante','implant-alto','implant-ancho'];
  let valid = true;
  requiredIds.forEach(id=>{
    const el = document.getElementById(id);
    const errorEl = document.getElementById(id+'-error');
    if(!el.value || !el.value.trim()){
      el.classList.add('invalid');
      if(errorEl) errorEl.classList.add('show');
      valid = false;
    } else {
      el.classList.remove('invalid');
      if(errorEl) errorEl.classList.remove('show');
    }
  });
  return valid;
}

function guardarImplanteEnLista(){
  if(!validarFormularioImplante()) return;

  const implante = {
    parte_cuerpo: document.getElementById('implant-parte-cuerpo').value,
    tipo_implante: document.getElementById('implant-tipo-implante').value,
    alto: Number(document.getElementById('implant-alto').value),
    ancho: Number(document.getElementById('implant-ancho').value),
    estado: document.getElementById('implant-estado').value,
    notas_adicionales: document.getElementById('implant-notas').value,
    url_imagen: document.getElementById('implant-url-imagen').value,
  };

  const editIndex = document.getElementById('implant-edit-index').value;
  if(editIndex !== ''){
    implantesPendientes[Number(editIndex)] = implante;
  } else {
    implantesPendientes.push(implante);
  }

  renderImplantesLista();
  cancelarEdicionImplante();
}

function editarImplante(index){
  const implante = implantesPendientes[index];
  if(!implante) return;

  document.getElementById('implant-parte-cuerpo').value = implante.parte_cuerpo;
  document.getElementById('implant-tipo-implante').value = implante.tipo_implante;
  document.getElementById('implant-alto').value = implante.alto;
  document.getElementById('implant-ancho').value = implante.ancho;
  document.getElementById('implant-estado').value = implante.estado;
  document.getElementById('implant-notas').value = implante.notas_adicionales || '';
  document.getElementById('implant-url-imagen').value = implante.url_imagen || '';

  const preview = document.getElementById('implant-foto-preview');
  if(implante.url_imagen){
    preview.src = implante.url_imagen;
    preview.style.display = 'block';
    document.getElementById('implant-upload-icon').style.display = 'none';
    document.getElementById('implant-upload-text').style.display = 'none';
  }

  document.getElementById('implant-edit-index').value = index;
  document.getElementById('implant-form-label').innerHTML = '<i class="ti ti-pencil" style="color:var(--navy)"></i> Editando implante ' + (index + 1);
  document.getElementById('implant-guardar-btn').innerHTML = '<i class="ti ti-check" style="font-size:13px"></i> Guardar cambios';
  document.getElementById('implant-cancelar-edicion-btn').style.display = '';
  document.querySelector('.new-implant-box').classList.add('editing');
  document.querySelector('.new-implant-box').scrollIntoView({behavior:'smooth', block:'nearest'});
}

function cancelarEdicionImplante(){
  limpiarFormularioImplante();
  document.getElementById('implant-edit-index').value = '';
  document.getElementById('implant-form-label').innerHTML = '<i class="ti ti-plus" style="color:var(--teal)"></i> Agregar nuevo implante';
  document.getElementById('implant-guardar-btn').innerHTML = '<i class="ti ti-plus" style="font-size:13px"></i> Agregar implante a esta lista';
  document.getElementById('implant-cancelar-edicion-btn').style.display = 'none';
  document.querySelector('.new-implant-box').classList.remove('editing');
}

function eliminarImplante(index){
  implantesPendientes.splice(index, 1);
  renderImplantesLista();
  cancelarEdicionImplante();
}

// En producción: al elegir el archivo, se pide al backend una URL pre-firmada
// de S3 (POST /uploads/presign), se sube el archivo directo a S3 con esa URL,
// y la URL definitiva resultante es lo que se guarda en implant.url_imagen.
// Aquí se simula con un object URL local del navegador, solo para previsualizar.
function previsualizarFotoImplante(input){
  const file = input.files[0];
  if(!file) return;
  const objectUrl = URL.createObjectURL(file);
  document.getElementById('implant-url-imagen').value = objectUrl;

  const preview = document.getElementById('implant-foto-preview');
  preview.src = objectUrl;
  preview.style.display = 'block';
  document.getElementById('implant-upload-icon').style.display = 'none';
  document.getElementById('implant-upload-text').style.display = 'none';

  const hint = document.getElementById('implant-foto-hint');
  if(hint) hint.textContent = 'Simulado en el navegador — en producción esto sube a un bucket S3 y guarda la URL real.';
}

function guardarDonanteEImplantes(){
  const requiredDonorIds = ['donante-codigo','donante-fecha-extraccion','donante-fecha-vencimiento'];
  let valid = true;
  requiredDonorIds.forEach(id=>{
    const el = document.getElementById(id);
    if(!el.value || !el.value.trim()){ el.classList.add('invalid'); valid = false; }
    else el.classList.remove('invalid');
  });
  if(!valid) return;

  const donor = API.donors.create({
    codigo_donante: document.getElementById('donante-codigo').value.trim(),
    fecha_extraccion: document.getElementById('donante-fecha-extraccion').value,
    fecha_procedimiento: document.getElementById('donante-fecha-procedimiento').value || null,
    fecha_segundo_cambio: document.getElementById('donante-fecha-segundo-cambio').value || null,
    fecha_vencimiento: document.getElementById('donante-fecha-vencimiento').value,
  });

  implantesPendientes.forEach(implante=> API.implants.create(donor.id, implante));

  closeModal('modal-nuevo-tejido');
  refreshAll();
}

// ==========================================================================
// Modales de detalle (Tejidos / Solicitantes) — leen directo de la API
// ==========================================================================
function abrirDetalleImplante(implantId){
  const implant = API.implants.getById(implantId);
  if(!implant) return;
  const donor = API.compose.donor(implant.donor_id);
  const estadoInfo = ESTADO_LABELS[implant.estado] || ESTADO_LABELS.disponible;
  const expiring = donor ? (daysUntil(donor.fecha_vencimiento) <= 7 && daysUntil(donor.fecha_vencimiento) >= 0) : false;

  setText('det-implante-titulo', implant.tipo_implante);
  setText('det-implante-donor-codigo', donor ? donor.codigo_donante : '—');
  setText('det-implante-donor-codigo-2', donor ? donor.codigo_donante : '—');
  setText('det-implante-parte', implant.parte_cuerpo);
  setText('det-implante-tipo', implant.tipo_implante);
  setText('det-implante-dims', (implant.alto && implant.ancho) ? `${implant.alto} × ${implant.ancho}` : 'No cuantificado');
  setText('det-implante-estado', estadoInfo.label + (expiring && implant.estado==='disponible' ? ' · por vencer' : ''));
  setText('det-implante-donor-extraccion', donor ? formatDate(donor.fecha_extraccion) : '—');
  setText('det-implante-donor-vencimiento', donor ? formatDate(donor.fecha_vencimiento) : '—');

  const notasWrap = document.getElementById('det-implante-notas-wrap');
  if(implant.notas_adicionales){ notasWrap.style.display='block'; setText('det-implante-notas', implant.notas_adicionales); }
  else notasWrap.style.display = 'none';

  const fotoWrap = document.getElementById('det-implante-foto-wrap');
  if(implant.url_imagen){ fotoWrap.style.display='block'; document.getElementById('det-implante-foto').src = implant.url_imagen; }
  else fotoWrap.style.display = 'none';

  openModal('modal-detalle-implante');
}

function abrirDetalleSolicitud(requestId){
  const req = API.requests.getById(requestId);
  if(!req) return;
  const patient = API.compose.patient(req.patient_id);
  const ips = API.compose.ips(req.ips_id);
  const doctorName = API.compose.doctorDisplayName(req.doctor_id);
  const statusInfo = API.requests.getStatusLabel(req.id);

  setText('det-sol-titulo', patient ? patient.nombre+' '+patient.apellido : 'Solicitud');
  setText('det-sol-codigo', req.codigo_visible || '');
  setText('det-sol-paciente', patient ? patient.nombre+' '+patient.apellido : '—');
  setText('det-sol-cedula', patient ? patient.tipo_identificacion+' '+patient.numero_identificacion : '—');
  setText('det-sol-ips', ips ? ips.nombre : '—');
  setText('det-sol-fecha', formatDate(req.fecha_estimada_cirugia));
  setText('det-sol-doctor', doctorName);
  setText('det-sol-procedimiento', req.procedimiento_quirurgico || '—');
  setText('det-sol-tejido', req.tejido_solicitado);
  setText('det-sol-dimensiones', `${req.alto_requerido}×${req.ancho_requerido}×${req.profundidad_requerida} mm`);
  setText('det-sol-diagnostico', req.diagnostico || 'Sin diagnóstico registrado.');

  const badge = document.getElementById('det-sol-estado-badge');
  badge.textContent = statusInfo.label;
  badge.className = 'badge badge-lg ' + statusInfo.badge;

  openModal('modal-detalle-solicitud');
}

// ==========================================================================
// Panel Solicitantes — Matches por aprobar (doctor)
// ==========================================================================
function buildMatchCardDoctor(m){
  const req     = API.requests.getById(m.request_id);
  const patient = API.compose.patient(req.patient_id);
  const implant = API.compose.implant(m.implant_id);
  const ips     = API.compose.ips(req.ips_id);
  const scoreClass = m.compatibility_score >= 85 ? '' : (m.compatibility_score >= 70 ? 'mid' : 'low');

  const card = document.createElement('div');
  card.className = 'match-card-v2';
  card.id = 'doctor-mc-' + m.id;
  card.innerHTML = `
    <div class="match-v2-summary" onclick="toggleMatch('doctor-mc-${m.id}')">
      <div class="match-v2-left">
        <div class="match-v2-score ${scoreClass}"><span>${Math.round(m.compatibility_score)}%</span></div>
        <div>
          <div class="match-v2-title">
            ${patient ? patient.nombre + ' ' + patient.apellido : '—'}
            → ${implant ? implant.tipo_implante : '—'}${implant && implant.codigo_visible ? ' (' + implant.codigo_visible + ')' : ''}
          </div>
          <div class="match-v2-meta">
            Cirugía: ${formatDate(req.fecha_estimada_cirugia)} · IPS: ${ips ? ips.nombre : '—'}
          </div>
        </div>
      </div>
      <div class="match-v2-right">
        <span class="badge badge-blue">Requiere tu decisión</span>
        <i class="ti ti-chevron-down match-v2-chevron"></i>
      </div>
    </div>
    <div class="match-v2-detail">
      <div class="compat-block" style="margin-top:0">
        <div class="compat-title">Compatibilidad dimensional</div>
        ${buildCompatRow('Alto',        req.alto_requerido,        m.compatibility_alto,         implant ? implant.alto  : null)}
        ${buildCompatRow('Ancho',       req.ancho_requerido,       m.compatibility_ancho,        implant ? implant.ancho : null)}
        ${buildCompatRow('Profundidad', req.profundidad_requerida, m.compatibility_profundidad)}
        <div class="compat-summary">
          <span class="compat-summary-label">Compatibilidad general</span>
          <span class="badge ${m.compatibility_score >= 85 ? 'badge-green' : 'badge-amber'} badge-lg">
            ${m.compatibility_score >= 85 ? 'Alta' : 'Media'} — ${Math.round(m.compatibility_score)}%
          </span>
        </div>
      </div>
      ${implant && implant.url_imagen ? `
        <div style="margin-top:12px">
          <div style="font-size:11px;color:var(--ink-faint);margin-bottom:6px;
                      text-transform:uppercase;letter-spacing:.04em">Fotografía del implante</div>
          <img src="${implant.url_imagen}" alt="Foto del implante"
               style="max-width:220px;border-radius:8px;border:0.5px solid var(--border-mid)"/>
        </div>` : `
        <div style="margin-top:10px;font-size:11px;color:var(--ink-faint)">
          <i class="ti ti-photo-off" style="font-size:13px;vertical-align:-1px"></i> Sin fotografía adjunta
        </div>`}
      <div class="match-footer" style="border-top:none;margin-top:16px;padding-top:0">
        <span style="font-size:11.5px;color:var(--ink-faint)">Tolerancia aplicada: ±5 mm por dimensión</span>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn-success"
                  onclick="event.stopPropagation(); aprobarMatchDoctorUI('${m.id}')">
            <i class="ti ti-check" style="font-size:13px"></i> Aceptar implante
          </button>
          <button class="btn-danger"
                  onclick="event.stopPropagation(); rechazarMatchDoctorUI('${m.id}')">
            <i class="ti ti-x" style="font-size:13px"></i> Rechazar
          </button>
        </div>
      </div>
    </div>
  `;
  return card;
}

function renderMatchesPorAprobarDoctor(){
  const container = document.getElementById('doctor-matches-list');
  const emptyMsg  = document.getElementById('doctor-matches-empty');
  const badge     = document.getElementById('doctor-matches-badge');
  if(!container || !currentUser) return;

  // Solo matches enviados que correspondan a solicitudes del doctor actual
  const misSolIds = API.requests.listByDoctor(currentUser.id).map(r => r.id);
  const mis = API.matches.listByStatus(['enviado']).filter(m => misSolIds.includes(m.request_id));

  container.innerHTML = '';
  const count = mis.length;
  if(emptyMsg) emptyMsg.style.display = count === 0 ? 'block' : 'none';
  if(badge){
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  }
  setText('sol-stat-match-pendiente', count);
  mis.forEach(m => container.appendChild(buildMatchCardDoctor(m)));
}

function aprobarMatchDoctorUI(matchId){
  API.matches.approveDoctor(matchId, currentUser.id);
  refreshAll();
}

function rechazarMatchDoctorUI(matchId){
  API.matches.rejectDoctor(matchId, currentUser.id, 'Rechazado por el médico');
  refreshAll();
}

// ==========================================================================
// Refresco maestro — se llama tras login y tras cualquier mutación
// ==========================================================================
function refreshAll(){
  if(!currentUser) return;
  renderMisSolicitudes();
  renderMatchesPorAprobarDoctor();
  renderTodasSolicitudes();
  renderInventarioTejidos();
  renderPorVencerTejidos();
  renderHistorialDonantes();
  renderMatchesPendientes();
  renderMatchesEsperando();
  renderMatchesHistorial();
  renderAsignacionesPendientes();
  renderAsignacionesHistorial();
  renderDespachosPorEtiquetar();
  renderDespachosEnCamino();
  renderDespachosEntregados();
  renderPerfilDoctor();
  renderDoctoresAdmin();
}

// ---- Reloj en la topbar -----------------------------------------------------
function actualizarReloj(){
  const el = document.getElementById('topbar-clock');
  if(!el) return;
  const now = new Date();
  const opts = { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' };
  el.textContent = now.toLocaleString('es-CO', opts);
}

// ==========================================================================
// Arranque
// ==========================================================================
document.addEventListener('DOMContentLoaded', ()=>{
  actualizarReloj();
  setInterval(actualizarReloj, 30000);
  setInterval(()=>{ if(currentUser) renderMatchesEsperando(); }, 30000);

  renderImplantesLista(); // muestra el mensaje de "vacío" desde el primer render

  document.querySelectorAll('.form-input').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      if(inp.classList.contains('invalid') && inp.value.trim()){
        inp.classList.remove('invalid');
        const err = document.getElementById(inp.id+'-error');
        if(err) err.classList.remove('show');
      }
    });
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay=>{
    overlay.addEventListener('click', (e)=>{
      if(e.target === overlay) closeModal(overlay.id);
    });
  });

  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      document.querySelectorAll('.modal-overlay.open').forEach(o=>closeModal(o.id));
    }
  });

  const loginForm = document.getElementById('login-form');
  if(loginForm){
    loginForm.addEventListener('submit', (e)=>{
      e.preventDefault();
      iniciarSesion();
    });
  }
});