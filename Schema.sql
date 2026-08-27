-- ============================================================================
-- TissueBank — Schema v2
-- Actualizado con todos los campos requeridos por las 13 Lambdas construidas.
--
-- Cambios respecto al schema original:
--   patient   → + numero_identificacion, + sexo_biologico
--   donor     → + sexo_biologico
--   implant   → + codigo_visible
--   request   → + codigo_visible, + sexo_importante
--   match     → + sent_at, + decided_by, + decided_at, + rejection_reason
--
-- Cómo usar: pega esto completo en Supabase → SQL Editor → Run.
-- Para volver a correr desde cero, descomenta el bloque DROP al final.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. app_user
-- ============================================================================
CREATE TABLE app_user (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username    VARCHAR(50) NOT NULL UNIQUE,
    password    TEXT        NOT NULL,
    role        VARCHAR(20) NOT NULL,
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    CONSTRAINT chk_app_user_role CHECK (role IN ('doctor', 'admin'))
);

-- ============================================================================
-- 2. doctor_profile
-- ============================================================================
CREATE TABLE doctor_profile (
    id          VARCHAR(20)  PRIMARY KEY,
    user_id     UUID NOT NULL UNIQUE REFERENCES app_user(id),
    nombre      VARCHAR(200) NOT NULL,
    telefono    BIGINT,
    email       VARCHAR(160)
);

-- ============================================================================
-- 3. patient
--    + numero_identificacion: número de cédula/pasaporte
--    + sexo_biologico: requerido por el motor de matching cuando
--      request.sexo_importante = true
-- ============================================================================
CREATE TABLE patient (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_identificacion     VARCHAR(20)  NOT NULL,
    numero_identificacion   VARCHAR(20)  NOT NULL,
    nombre                  VARCHAR(150) NOT NULL,
    apellido                VARCHAR(150) NOT NULL,
    fecha_nacimiento        DATE,
    edad                    INTEGER,
    nacionalidad            VARCHAR(80),
    sexo_biologico          VARCHAR(1),
    CONSTRAINT chk_patient_sexo CHECK (sexo_biologico IN ('M', 'F')),
    CONSTRAINT uq_patient_identificacion
        UNIQUE (tipo_identificacion, numero_identificacion)
);

-- ============================================================================
-- 4. ips
-- ============================================================================
CREATE TABLE ips (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      VARCHAR(160) NOT NULL,
    direccion   TEXT,
    telefono    VARCHAR(30),
    ciudad      VARCHAR(100)
);

-- ============================================================================
-- 5. donor
--    + sexo_biologico: el motor filtra por esto cuando sexo_importante = true
-- ============================================================================
CREATE TABLE donor (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_donante          VARCHAR(40) NOT NULL UNIQUE,
    fecha_extraccion        DATE        NOT NULL,
    fecha_procedimiento     DATE,
    fecha_segundo_cambio    DATE,
    fecha_vencimiento       DATE        NOT NULL,
    sexo_biologico          VARCHAR(1)  NOT NULL,
    CONSTRAINT chk_donor_sexo CHECK (sexo_biologico IN ('M', 'F'))
);

-- ============================================================================
-- 5b. tissue_type
--    Catálogo de "Tipo de implante" (antes una lista fija en el HTML:
--    Cóndilo, Patela, Plato tibial, ... + "Otro"). Se saca a tabla para que
--    el admin pueda agregar tipos nuevos desde el Panel Tejidos y queden
--    disponibles para todos, en vez de estar hardcodeados en el frontend.
-- ============================================================================
CREATE TABLE tissue_type (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre  VARCHAR(200) NOT NULL UNIQUE
);

-- ============================================================================
-- 6. implant
--    + codigo_visible: código legible del implante (ej. TEJ-2026-001). Es el
--      identificador que debe distinguir cada unidad en el Panel Tejidos —
--      tipo_implante/parte_cuerpo se repiten entre implantes (ej. varias
--      "Patela"), pero codigo_visible es único por implante.
--    + profundidad: tercera medida del implante (AP / anteroposterior),
--      espejo de profundidad_requerida en `request` — necesaria para que el
--      motor de matching pueda calcular compatibility_profundidad (ver
--      tabla `match`, columna ya existente pero sin dato de origen hasta
--      ahora).
--    + tipo_implante ampliado a VARCHAR(300): el nombre que se le pone al
--      tipo de implante es el dato visible/diferenciador y debe admitir
--      nombres largos y descriptivos, no solo una palabra corta.
-- ============================================================================
CREATE TABLE implant (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_visible      VARCHAR(40)  NOT NULL UNIQUE,
    donor_id            UUID NOT NULL REFERENCES donor(id),
    parte_cuerpo        VARCHAR(80)  NOT NULL,
    tipo_implante       VARCHAR(300) NOT NULL,
    alto                INTEGER,
    ancho               INTEGER,
    profundidad         INTEGER,
    estado              VARCHAR(30)  NOT NULL DEFAULT 'disponible',
    notas_adicionales   TEXT,
    url_imagen          TEXT,
    CONSTRAINT chk_implant_estado CHECK (
        estado IN ('disponible', 'reservado', 'asignado',
                   'contraindicado', 'vencido', 'despachado')
    )
);

-- ============================================================================
-- 7. request
--    + codigo_visible: código de orden SOL-YYYY-NNN que atraviesa toda la
--      cadena (match, assignment, dispatch) para trazabilidad completa.
--    + sexo_importante: cuando true, el motor solo considera implantes cuyo
--      donante tenga el mismo sexo biológico que el paciente.
-- ============================================================================
CREATE TABLE request (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_visible              VARCHAR(40) UNIQUE,
    doctor_id                   UUID NOT NULL REFERENCES app_user(id),
    patient_id                  UUID NOT NULL REFERENCES patient(id),
    ips_id                      UUID NOT NULL REFERENCES ips(id),
    tejido_solicitado           VARCHAR(300) NOT NULL,
    procedimiento_quirurgico    VARCHAR(160),
    alto_requerido              INTEGER NOT NULL,
    ancho_requerido             INTEGER NOT NULL,
    profundidad_requerida       INTEGER NOT NULL,
    fecha_estimada_cirugia      DATE    NOT NULL,
    diagnostico                 TEXT,
    sexo_importante             BOOLEAN NOT NULL DEFAULT false
);

-- ============================================================================
-- 8. match
--    + sent_at:         momento en que el admin envió el match al doctor
--    + decided_by:      quién aprobó o rechazó (doctor o admin)
--    + decided_at:      momento de la decisión
--    + rejection_reason: motivo de rechazo (cuando aplica)
-- ============================================================================
CREATE TABLE match (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id                  UUID NOT NULL REFERENCES request(id),
    implant_id                  UUID NOT NULL REFERENCES implant(id),
    compatibility_score         NUMERIC(5,2) NOT NULL,
    compatibility_alto          NUMERIC(5,2),
    compatibility_ancho         NUMERIC(5,2),
    compatibility_profundidad   NUMERIC(5,2),
    status                      VARCHAR(30) NOT NULL DEFAULT 'detectado',
    sent_at                     TIMESTAMPTZ,
    decided_by                  UUID REFERENCES app_user(id),
    decided_at                  TIMESTAMPTZ,
    rejection_reason            TEXT,
    CONSTRAINT chk_match_score  CHECK (compatibility_score BETWEEN 0 AND 100),
    CONSTRAINT chk_match_status CHECK (
        status IN ('detectado', 'enviado', 'aprobado_doctor', 'rechazado_doctor',
                   'aprobado_admin', 'rechazado_admin', 'invalidado')
    )
);

-- Par (request, implant) no se duplica mientras el match esté activo.
-- Permite re-crear el par si el match anterior fue rechazado o invalidado.
CREATE UNIQUE INDEX uq_match_active_pair
    ON match(request_id, implant_id)
    WHERE status NOT IN ('rechazado_doctor', 'rechazado_admin', 'invalidado');

-- ============================================================================
-- 9. assignment
-- ============================================================================
CREATE TABLE assignment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id        UUID NOT NULL UNIQUE REFERENCES match(id),
    reviewed_by     UUID REFERENCES app_user(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    CONSTRAINT chk_assignment_status CHECK (status IN ('pendiente', 'aprobada', 'rechazada'))
);

-- ============================================================================
-- 10. dispatch
-- ============================================================================
CREATE TABLE dispatch (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id   UUID NOT NULL UNIQUE REFERENCES assignment(id),
    ips_id          UUID NOT NULL REFERENCES ips(id),
    status          VARCHAR(20) NOT NULL DEFAULT 'por_etiquetar',
    CONSTRAINT chk_dispatch_status CHECK (
        status IN ('por_etiquetar', 'etiquetado', 'en_camino', 'entregado')
    )
);

-- ============================================================================
-- Índices
-- ============================================================================
CREATE INDEX idx_doctor_profile_user      ON doctor_profile(user_id);
CREATE INDEX idx_donor_vencimiento        ON donor(fecha_vencimiento);
CREATE INDEX idx_donor_sexo               ON donor(sexo_biologico);
CREATE INDEX idx_implant_donor            ON implant(donor_id);
CREATE INDEX idx_implant_estado           ON implant(estado);
CREATE INDEX idx_implant_tipo             ON implant(tipo_implante);
CREATE INDEX idx_implant_codigo           ON implant(codigo_visible);
CREATE INDEX idx_patient_num_id           ON patient(numero_identificacion);
CREATE INDEX idx_request_doctor           ON request(doctor_id);
CREATE INDEX idx_request_patient          ON request(patient_id);
CREATE INDEX idx_request_ips              ON request(ips_id);
CREATE INDEX idx_request_codigo           ON request(codigo_visible);
CREATE INDEX idx_match_request            ON match(request_id);
CREATE INDEX idx_match_implant            ON match(implant_id);
CREATE INDEX idx_match_status             ON match(status);
CREATE INDEX idx_match_sent_at            ON match(sent_at);
CREATE INDEX idx_match_decided_by         ON match(decided_by);
CREATE INDEX idx_assignment_status        ON assignment(status);
CREATE INDEX idx_assignment_reviewed_by   ON assignment(reviewed_by);
CREATE INDEX idx_dispatch_status          ON dispatch(status);
CREATE INDEX idx_dispatch_ips             ON dispatch(ips_id);

-- ============================================================================
-- Vista: estado derivado de una solicitud
-- ============================================================================
CREATE OR REPLACE VIEW v_request_status AS
SELECT
    r.id AS request_id,
    CASE
        WHEN d.status = 'entregado'        THEN 'entregada'
        WHEN d.status = 'en_camino'        THEN 'en_camino'
        WHEN d.status = 'etiquetado'       THEN 'etiquetado'
        WHEN d.status = 'por_etiquetar'    THEN 'asignada'
        WHEN a.status = 'pendiente'        THEN 'por_asignar'
        WHEN m.status = 'aprobado_doctor'  THEN 'por_asignar'
        WHEN m.status = 'enviado'          THEN 'match_enviado'
        WHEN m.status = 'detectado'        THEN 'match_detectado'
        ELSE 'en_fila'
    END AS status
FROM request r
LEFT JOIN LATERAL (
    SELECT * FROM match m
    WHERE m.request_id = r.id
      AND m.status NOT IN ('rechazado_doctor', 'rechazado_admin', 'invalidado')
    ORDER BY
        CASE m.status
            WHEN 'aprobado_admin'  THEN 5
            WHEN 'aprobado_doctor' THEN 4
            WHEN 'enviado'         THEN 3
            WHEN 'detectado'       THEN 2
            ELSE 1
        END DESC
    LIMIT 1
) m ON true
LEFT JOIN assignment a ON a.match_id = m.id
LEFT JOIN dispatch   d ON d.assignment_id = a.id;

-- ============================================================================
-- Vista: pipeline completo por solicitud (panel admin)
-- ============================================================================
CREATE OR REPLACE VIEW v_request_pipeline AS
SELECT
    r.id                     AS request_id,
    r.codigo_visible         AS codigo_orden,
    p.nombre                 AS patient_nombre,
    p.apellido               AS patient_apellido,
    p.tipo_identificacion,
    p.numero_identificacion,
    r.tejido_solicitado,
    r.fecha_estimada_cirugia,
    r.sexo_importante,
    ips.nombre               AS ips_nombre,
    dp.nombre                AS doctor_nombre,
    dp.email                 AS doctor_email,
    vs.status                AS request_status,
    m.id                     AS match_id,
    m.compatibility_score,
    m.status                 AS match_status,
    m.sent_at,
    m.decided_at,
    a.id                     AS assignment_id,
    a.status                 AS assignment_status,
    disp.id                  AS dispatch_id,
    disp.status              AS dispatch_status
FROM request r
JOIN patient p              ON p.id   = r.patient_id
JOIN ips                    ON ips.id = r.ips_id
JOIN app_user u             ON u.id   = r.doctor_id
LEFT JOIN doctor_profile dp ON dp.user_id = u.id
JOIN v_request_status vs    ON vs.request_id = r.id
LEFT JOIN match m ON m.request_id = r.id
    AND m.status NOT IN ('rechazado_doctor', 'rechazado_admin', 'invalidado')
LEFT JOIN assignment a      ON a.match_id      = m.id
LEFT JOIN dispatch disp     ON disp.assignment_id = a.id;

-- ============================================================================
-- DROP para volver a correr desde cero (descomenta y ejecuta primero):
-- ============================================================================
-- DROP VIEW  IF EXISTS v_request_pipeline;
-- DROP VIEW  IF EXISTS v_request_status;
-- DROP TABLE IF EXISTS dispatch;
-- DROP TABLE IF EXISTS assignment;
-- DROP TABLE IF EXISTS match;
-- DROP TABLE IF EXISTS request;
-- DROP TABLE IF EXISTS implant;
-- DROP TABLE IF EXISTS tissue_type;
-- DROP TABLE IF EXISTS donor;
-- DROP TABLE IF EXISTS ips;
-- DROP TABLE IF EXISTS patient;
-- DROP TABLE IF EXISTS doctor_profile;
-- DROP TABLE IF EXISTS app_user;