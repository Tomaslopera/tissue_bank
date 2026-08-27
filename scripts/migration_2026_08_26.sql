-- ============================================================================
-- migration_2026_08_26.sql — Cambios de esquema para:
--   - Catálogo editable de "Tipo de implante" (tabla tissue_type)
--   - Tercera medida del implante (profundidad / AP), espejo de
--     profundidad_requerida en `request` y de compatibility_profundidad
--     en `match` (esa columna ya existía en match sin dato de origen).
--   - Nombres largos para tipo_implante y tejido_solicitado.
--
-- Correr una sola vez contra la BD existente (Supabase/RDS → SQL Editor).
-- Es idempotente donde fue posible (IF NOT EXISTS), pero de todas formas
-- hacer un backup/snapshot antes de correrlo en una base con datos reales.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS tissue_type (
    id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre  VARCHAR(200) NOT NULL UNIQUE
);

ALTER TABLE implant ADD COLUMN IF NOT EXISTS profundidad INTEGER;
ALTER TABLE implant ALTER COLUMN tipo_implante TYPE VARCHAR(300);

-- v_request_pipeline depende de request.tejido_solicitado (rule _RETURN),
-- así que Postgres bloquea el ALTER TYPE mientras la vista exista. Se
-- suelta acá y se recrea abajo con la misma definición de Schema.sql —
-- v_request_status no depende de esta columna, así que no hace falta
-- tocarla.
DROP VIEW IF EXISTS v_request_pipeline;

ALTER TABLE request ALTER COLUMN tejido_solicitado TYPE VARCHAR(300);

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

-- Semilla del catálogo con los tipos que ya estaban hardcodeados en el
-- formulario, para que el histórico de implantes existentes siga
-- coincidiendo con una opción del nuevo <select>.
INSERT INTO tissue_type (nombre) VALUES
    ('Cóndilo'), ('Patela'), ('Plato tibial'), ('Fémur'), ('Talo'),
    ('Menisco medial'), ('Menisco lateral'), ('Piel'), ('Hueso')
ON CONFLICT (nombre) DO NOTHING;

COMMIT;
