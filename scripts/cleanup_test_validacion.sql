-- ============================================================================
-- cleanup_test_validacion.sql — Borra únicamente los registros de prueba
-- creados durante la validación end-to-end del 2026-08-26 (todos con
-- prefijo TEST-). No toca ningún dato real.
-- ============================================================================

BEGIN;

DELETE FROM request     WHERE codigo_visible = 'TEST-SOL-VAL';
DELETE FROM ips         WHERE nombre = 'TEST-IPS-Validacion';
DELETE FROM patient     WHERE numero_identificacion = 'TEST-VAL-999';
DELETE FROM implant     WHERE codigo_visible = 'TEST-IMP-VAL';
DELETE FROM donor       WHERE codigo_donante = 'TEST-DONANTE-VAL';
DELETE FROM tissue_type WHERE nombre = 'TEST-Tipo-Validacion';

COMMIT;
