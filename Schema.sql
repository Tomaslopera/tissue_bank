-- ============================================================================
-- TissueBank — Script de creación para Supabase (proyecto: tissue_bank)
-- Generado a partir del DBML entregado por el usuario, con dos ajustes
-- acordados explícitamente:
--   1. app_user conserva `is_active` (no estaba en el DBML, pero es necesario
--      para el panel de gestión de doctores: desactivar sin borrar).
--   2. Todas las PK uuid usan DEFAULT gen_random_uuid() — el DBML no traía
--      default, así que Supabase/Postgres genera el id automáticamente al
--      insertar, sin que la Lambda tenga que generarlo antes.
--
-- Cómo usar: pega esto completo en Supabase → SQL Editor → New query → Run.
-- Se puede correr una sola vez sobre una base vacía. Si necesitas volver a
-- correrlo desde cero, hay un bloque DROP comentado al final.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- habilita gen_random_uuid()

-- ============================================================================
-- 1. app_user — cuentas de acceso (doctor / admin)
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
-- 2. doctor_profile — datos del doctor (PK = cédula, 1:1 con app_user)
-- ============================================================================
CREATE TABLE doctor_profile (
    id          VARCHAR(20) PRIMARY KEY,
    user_id     UUID NOT NULL UNIQUE REFERENCES app_user(id),
    nombre      VARCHAR(200) NOT NULL,
    telefono    BIGINT,   -- INTEGER se desborda con celulares colombianos (3xxxxxxxxx > 2.147.483.647)
    email       VARCHAR(160)
);

-- ============================================================================
-- 3. patient
-- ============================================================================
CREATE TABLE patient (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo_identificacion VARCHAR(20)  NOT NULL,
    nombre              VARCHAR(150) NOT NULL,
    apellido            VARCHAR(150) NOT NULL,
    fecha_nacimiento    DATE,
    edad                INTEGER,
    nacionalidad        VARCHAR(80)
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
-- ============================================================================
CREATE TABLE donor (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo_donante          VARCHAR(40) NOT NULL UNIQUE,
    fecha_extraccion        DATE        NOT NULL,
    fecha_procedimiento     DATE,
    fecha_segundo_cambio    DATE,
    fecha_vencimiento       DATE        NOT NULL
);

-- ============================================================================
-- 6. implant
-- ============================================================================
CREATE TABLE implant (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    donor_id            UUID NOT NULL REFERENCES donor(id),
    parte_cuerpo        VARCHAR(80) NOT NULL,
    tipo_implante       VARCHAR(80) NOT NULL,
    alto                INTEGER,
    ancho               INTEGER,
    estado              VARCHAR(30) NOT NULL DEFAULT 'disponible',
    notas_adicionales   TEXT,
    url_imagen          TEXT,
    CONSTRAINT chk_implant_estado CHECK (
        estado IN ('disponible', 'reservado', 'asignado', 'contraindicado', 'vencido', 'despachado')
    )
);

-- ============================================================================
-- 7. request
-- ============================================================================
CREATE TABLE request (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    doctor_id                   UUID NOT NULL REFERENCES app_user(id),
    patient_id                  UUID NOT NULL REFERENCES patient(id),
    ips_id                      UUID NOT NULL REFERENCES ips(id),
    tejido_solicitado           VARCHAR(80) NOT NULL,
    procedimiento_quirurgico    VARCHAR(160),
    alto_requerido              INTEGER NOT NULL,
    ancho_requerido             INTEGER NOT NULL,
    profundidad_requerida       INTEGER NOT NULL,
    fecha_estimada_cirugia      DATE NOT NULL,
    diagnostico                 TEXT
);

-- ============================================================================
-- 8. match
-- ============================================================================
CREATE TABLE match (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id                  UUID NOT NULL REFERENCES request(id),
    implant_id                  UUID NOT NULL REFERENCES implant(id),
    compatibility_score         NUMERIC(5,2) NOT NULL,
    compatibility_ancho         NUMERIC(5,2),
    compatibility_alto          NUMERIC(5,2),
    compatibility_profundidad   NUMERIC(5,2),
    status                      VARCHAR(30) NOT NULL DEFAULT 'detectado',
    CONSTRAINT chk_match_score CHECK (compatibility_score BETWEEN 0 AND 100),
    CONSTRAINT chk_match_status CHECK (
        status IN ('detectado', 'enviado', 'aprobado_doctor', 'rechazado_doctor',
                    'aprobado_admin', 'rechazado_admin', 'invalidado')
    )
);

-- Un mismo par (request, implant) no se duplica mientras el match anterior
-- siga vivo — permite que un implante tenga varios candidatos a la vez sin
-- generar ofertas duplicadas hacia la misma solicitud.
CREATE UNIQUE INDEX uq_match_active_pair
    ON match(request_id, implant_id)
    WHERE status NOT IN ('rechazado_doctor', 'rechazado_admin', 'invalidado');

-- ============================================================================
-- 9. assignment
-- ============================================================================
CREATE TABLE assignment (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reviewed_by     UUID REFERENCES app_user(id),
    match_id        UUID NOT NULL UNIQUE REFERENCES match(id),
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
-- Índices — aceleran los filtros que la aplicación usa todo el tiempo
-- (listar solicitudes de un doctor, inventario por estado, matches por
-- estado, etc.) Ninguno es obligatorio para que el schema funcione, pero
-- sin ellos cada pantalla del panel admin haría un full scan de la tabla.
-- ============================================================================
CREATE INDEX idx_doctor_profile_user ON doctor_profile(user_id);
CREATE INDEX idx_donor_vencimiento ON donor(fecha_vencimiento);
CREATE INDEX idx_implant_donor ON implant(donor_id);
CREATE INDEX idx_implant_estado ON implant(estado);
CREATE INDEX idx_request_doctor ON request(doctor_id);
CREATE INDEX idx_request_patient ON request(patient_id);
CREATE INDEX idx_request_ips ON request(ips_id);
CREATE INDEX idx_match_request ON match(request_id);
CREATE INDEX idx_match_implant ON match(implant_id);
CREATE INDEX idx_match_status ON match(status);
CREATE INDEX idx_assignment_status ON assignment(status);
CREATE INDEX idx_assignment_reviewed_by ON assignment(reviewed_by);
CREATE INDEX idx_dispatch_status ON dispatch(status);
CREATE INDEX idx_dispatch_ips ON dispatch(ips_id);

-- ============================================================================
-- Vista: estado derivado de una solicitud
-- ============================================================================
-- `request` no tiene columna de estado propia (así lo definiste). El estado
-- que ve la UI ("en fila", "match detectado", "asignada"...) se calcula
-- leyendo la fila más avanzada en match → assignment → dispatch para esa
-- solicitud. Esta vista hace ese cálculo en una sola consulta.
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
            WHEN 'aprobado_admin'   THEN 5
            WHEN 'aprobado_doctor'  THEN 4
            WHEN 'enviado'          THEN 3
            WHEN 'detectado'        THEN 2
            ELSE 1
        END DESC
    LIMIT 1
) m ON true
LEFT JOIN assignment a ON a.match_id = m.id
LEFT JOIN dispatch d ON d.assignment_id = a.id;

-- ============================================================================
-- Vista: pipeline completo por solicitud (para panel "Solicitudes" admin)
-- ============================================================================
CREATE OR REPLACE VIEW v_request_pipeline AS
SELECT
    r.id                    AS request_id,
    p.nombre                AS patient_nombre,
    p.apellido              AS patient_apellido,
    p.tipo_identificacion,
    r.tejido_solicitado,
    r.fecha_estimada_cirugia,
    ips.nombre              AS ips_nombre,
    dp.nombre               AS doctor_nombre,
    vs.status                AS request_status,
    m.id                     AS match_id,
    m.compatibility_score,
    m.status                 AS match_status,
    a.id                     AS assignment_id,
    a.status                 AS assignment_status,
    disp.id                  AS dispatch_id,
    disp.status               AS dispatch_status
FROM request r
JOIN patient p                ON p.id = r.patient_id
JOIN ips                      ON ips.id = r.ips_id
JOIN app_user u                ON u.id = r.doctor_id
LEFT JOIN doctor_profile dp    ON dp.user_id = u.id
JOIN v_request_status vs       ON vs.request_id = r.id
LEFT JOIN match m ON m.request_id = r.id
    AND m.status NOT IN ('rechazado_doctor', 'rechazado_admin', 'invalidado')
LEFT JOIN assignment a         ON a.match_id = m.id
LEFT JOIN dispatch disp        ON disp.assignment_id = a.id;

-- ============================================================================
-- Para volver a correr este script desde cero (borra TODO), descomenta y
-- ejecuta esto primero, luego corre el script completo de nuevo:
-- ============================================================================
-- DROP VIEW IF EXISTS v_request_pipeline;
-- DROP VIEW IF EXISTS v_request_status;
-- DROP TABLE IF EXISTS dispatch;
-- DROP TABLE IF EXISTS assignment;
-- DROP TABLE IF EXISTS match;
-- DROP TABLE IF EXISTS request;
-- DROP TABLE IF EXISTS implant;
-- DROP TABLE IF EXISTS donor;
-- DROP TABLE IF EXISTS ips;
-- DROP TABLE IF EXISTS patient;
-- DROP TABLE IF EXISTS doctor_profile;
-- DROP TABLE IF EXISTS app_user;