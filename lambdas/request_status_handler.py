"""
request_status_handler.py — Lambda de SOLO LECTURA sobre las vistas
v_request_status y v_request_pipeline.

Rutas que atiende:
    GET   /requests/{id}/status   -> estado derivado de una sola solicitud
    GET   /requests/pipeline      -> pipeline completo (doctor ve solo lo
                                      suyo, admin ve todo — mismo criterio
                                      ya aplicado en request_handler)

Esta Lambda NO escribe nada en ninguna tabla — `request` no tiene columna
de estado propia (así se definió el modelo), así que el estado que ve la
UI ("en fila", "match detectado", "asignada"...) siempre se calcula
leyendo estas vistas, nunca actualizando una columna directamente.

Por qué es una Lambda separada de request_handler: es una responsabilidad
de lectura distinta (agregación entre 4 tablas vía las vistas) en vez de
CRUD directo de una tabla — separarla evita mezclar la lógica de "guardar
los datos de la solicitud" con la de "calcular en qué paso del proceso va".
"""

from db import query, query_one
from auth import get_auth_context, require_role, TokenError
from response import ok, error, not_found, unauthorized, forbidden, server_error, path_param, http_method


def lambda_handler(event, context):
    try:
        method = http_method(event)
        if method == "OPTIONS":
            return ok({})

        try:
            auth_payload = get_auth_context(event)
        except TokenError as exc:
            return unauthorized(str(exc))

        if auth_payload is None:
            return unauthorized("Debes iniciar sesión para hacer esto.")
        if not require_role(auth_payload, "admin", "doctor"):
            return forbidden("No tienes permiso para hacer esto.")

        if method != "GET":
            return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")

        raw_path = event.get("rawPath") or event.get("path") or ""
        request_id = path_param(event, "id")

        if request_id and raw_path.endswith("/status"):
            return get_status(request_id, auth_payload)
        if raw_path.endswith("/pipeline"):
            return get_pipeline(auth_payload)

        return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")
    except Exception as exc:
        return server_error(exc)


# ============================================================================
# GET /requests/{id}/status
# ============================================================================
def get_status(request_id, auth_payload):
    # Primero se verifica dueño/permiso contra la tabla real `request`
    # (no contra la vista), porque es la fuente de verdad de quién es el
    # doctor_id — mismo criterio de permisos que en request_handler.
    owner = query_one("SELECT doctor_id FROM request WHERE id = %s", (request_id,))
    if not owner:
        return not_found("Solicitud")

    if auth_payload["role"] != "admin" and owner["doctor_id"] != auth_payload["sub"]:
        return forbidden("No tienes permiso para ver esta solicitud.")

    row = query_one("SELECT request_id, status FROM v_request_status WHERE request_id = %s", (request_id,))
    if not row:
        return not_found("Solicitud")
    return ok(row)


# ============================================================================
# GET /requests/pipeline — doctor ve solo lo suyo, admin ve todo
# ============================================================================
def get_pipeline(auth_payload):
    if auth_payload["role"] == "admin":
        rows = query(
            """
            SELECT request_id, doctor_id, patient_nombre, patient_apellido, tipo_identificacion,
                   tejido_solicitado, fecha_estimada_cirugia, ips_nombre, doctor_nombre,
                   request_status, match_id, compatibility_score, match_status,
                   assignment_id, assignment_status, dispatch_id, dispatch_status
            FROM v_request_pipeline
            ORDER BY fecha_estimada_cirugia
            LIMIT 200
            """
        )
    else:
        rows = query(
            """
            SELECT request_id, doctor_id, patient_nombre, patient_apellido, tipo_identificacion,
                   tejido_solicitado, fecha_estimada_cirugia, ips_nombre, doctor_nombre,
                   request_status, match_id, compatibility_score, match_status,
                   assignment_id, assignment_status, dispatch_id, dispatch_status
            FROM v_request_pipeline
            WHERE doctor_id = %s
            ORDER BY fecha_estimada_cirugia
            LIMIT 200
            """,
            (auth_payload["sub"],),
        )
    return ok({"data": rows})