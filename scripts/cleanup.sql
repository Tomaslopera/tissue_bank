-- ============================================================================
-- cleanup_full_except_admin_martinez.sql
--
-- Borra TODO el dato operativo de TissueBank (despachos, asignaciones,
-- matches, solicitudes, implantes, donantes, pacientes, IPS) y TODAS las
-- cuentas de doctor excepto 'dr.martinez', dejando 'admin' y 'dr.martinez'
-- intactos para poder seguir usando la app de inmediato.
--
-- NO borra:
--   - tissue_type (catálogo de tipos de implante) — se conserva a propósito
--   - app_user / doctor_profile de 'admin' y 'dr.martinez'
--
-- Uso: correr manualmente en Supabase → SQL Editor. Es irreversible — no
-- hay backup automático. Si quieres un respaldo antes, exporta las tablas
-- o toma un snapshot de la BD antes de correr esto.
-- ============================================================================

BEGIN;

-- 1. Flujo operativo, en orden de dependencia (hijos antes que padres)
DELETE FROM dispatch;
DELETE FROM assignment;
DELETE FROM match;
DELETE FROM request;
DELETE FROM implant;
DELETE FROM donor;
DELETE FROM patient;
DELETE FROM ips;

-- 2. Cuentas de doctor, excepto dr.martinez (admin nunca tiene doctor_profile)
DELETE FROM doctor_profile
WHERE user_id IN (
    SELECT id FROM app_user
    WHERE role = 'doctor' AND username <> 'dr.martinez'
);

DELETE FROM app_user
WHERE role = 'doctor' AND username <> 'dr.martinez';

-- tissue_type: se conserva a propósito, no se toca.

COMMIT;

-- Verificación rápida después de correr (opcional):
-- SELECT username, role FROM app_user ORDER BY role, username;
-- SELECT count(*) FROM request; SELECT count(*) FROM donor; SELECT count(*) FROM implant;
