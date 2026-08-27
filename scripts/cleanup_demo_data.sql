-- ============================================================================
-- cleanup_demo_data.sql — Limpieza de datos operativos de TissueBank.
--
-- Uso: correr manualmente contra la BD (RDS/Supabase) desde la consola SQL,
-- NO desde una Lambda. No hay rollback automático — hacer un backup/snapshot
-- antes de correr esto en una base con datos reales.
--
-- Qué borra: todo el flujo operativo (solicitudes, matches, asignaciones,
-- despachos, donantes, implantes, pacientes, IPS). Se borra en orden de
-- dependencia (hijos antes que padres) para no depender de ON DELETE CASCADE.
--
-- Qué NO borra por defecto: app_user y doctor_profile (cuentas de acceso) y
-- tissue_type (catálogo de tipos de implante) — borrarlas te deja sin poder
-- iniciar sesión o te obliga a recrear el catálogo desde cero. Si de verdad
-- quieres borrar también cuentas y/o catálogo, descomenta esas líneas al
-- final.
-- ============================================================================

BEGIN;

TRUNCATE TABLE
    dispatch,
    assignment,
    match,
    request,
    implant,
    donor,
    patient,
    ips
RESTART IDENTITY CASCADE;

-- Descomentar SOLO si además quieres vaciar el catálogo de tipos de implante:
-- TRUNCATE TABLE tissue_type RESTART IDENTITY CASCADE;

-- Descomentar SOLO si además quieres borrar todas las cuentas de doctor
-- (esto NO borra la cuenta admin si vive fuera de doctor_profile/app_user
-- con otro mecanismo — revisar antes de correr en producción):
-- DELETE FROM doctor_profile;
-- DELETE FROM app_user WHERE role = 'doctor';

COMMIT;
