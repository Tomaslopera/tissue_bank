"""
request_handler.py — Lambda para la tabla `request`.

Rutas que atiende:
    POST   /requests          -> crear solicitud (doctor_id sale del token, nunca del body)
    GET    /requests          -> listar — doctor ve SOLO las suyas, admin ve todas
    GET    /requests/{id}     -> ver una — doctor solo si es dueño, admin cualquiera
    PUT    /requests/{id}     -> editar — SOLO el doctor dueño (admin no puede editar, solo ver)

Acceso: doctor y admin, ambos autenticados — pero con visibilidad y
permisos de escritura distintos según el rol (confirmado explícitamente):
  - Un doctor solo ve/edita SUS PROPIAS solicitudes.
  - Un admin ve TODAS las solicitudes, pero no puede editar ninguna
    (edición es responsabilidad exclusiva del doctor dueño).

Nota de seguridad importante: `doctor_id` en una solicitud nueva SIEMPRE
se toma del token JWT (auth_payload["sub"]), nunca de lo que venga en el
body — así un doctor nunca puede crear una solicitud "a nombre de" otro
doctor, aunque lo intente mandar explícitamente en el JSON.

Nota de diseño: este handler NO dispara ninguna búsqueda de matching (esa
lógica se construye aparte, más adelante, como una acción manual con su
propio botón/endpoint — ver conversación).
"""

from db import query, query_one
from auth import get_auth_context, require_role, TokenError
from response import (
    ok, created, error, not_found, unauthorized, forbidden, server_error,
    require_fields, parse_body, path_param, query_param, http_method,
)


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

        request_id = path_param(event, "id")

        if method == "POST":
            return create_request(event, auth_payload)
        if method == "GET" and request_id:
            return get_one(request_id, auth_payload)
        if method == "GET":
            return list_all(event, auth_payload)
        if method == "PUT" and request_id:
            return update_request(request_id, event, auth_payload)

        return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")
    except Exception as exc:
        return server_error(exc)


# ============================================================================
# POST /requests — doctor_id sale del token, NUNCA del body
# ============================================================================
def create_request(event, auth_payload):
    body = parse_body(event)
    missing = require_fields(
        body,
        [
            "codigo_visible", "patient_id", "ips_id", "tejido_solicitado",
            "alto_requerido", "ancho_requerido", "profundidad_requerida",
            "fecha_estimada_cirugia",
        ],
    )
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    patient = query_one("SELECT id FROM patient WHERE id = %s", (body["patient_id"],))
    if not patient:
        return error("El paciente indicado no existe.", status_code=404, code="NOT_FOUND", fields={"patient_id": "Paciente no encontrado"})

    ips = query_one("SELECT id FROM ips WHERE id = %s", (body["ips_id"],))
    if not ips:
        return error("La IPS indicada no existe.", status_code=404, code="NOT_FOUND", fields={"ips_id": "IPS no encontrada"})

    existing_code = query_one("SELECT id FROM request WHERE codigo_visible = %s", (body["codigo_visible"],))
    if existing_code:
        return error(
            "Ya existe una solicitud registrada con ese código.",
            status_code=409,
            code="REQUEST_CODE_TAKEN",
            fields={"codigo_visible": "Ya está registrado"},
        )

    row = query_one(
        """
        INSERT INTO request
            (codigo_visible, doctor_id, patient_id, ips_id, tejido_solicitado, procedimiento_quirurgico,
             alto_requerido, ancho_requerido, profundidad_requerida, fecha_estimada_cirugia, diagnostico, sexo_importante)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id, codigo_visible, doctor_id, patient_id, ips_id, tejido_solicitado, procedimiento_quirurgico,
                  alto_requerido, ancho_requerido, profundidad_requerida, fecha_estimada_cirugia, diagnostico, sexo_importante
        """,
        (
            body["codigo_visible"].strip(),
            auth_payload["sub"],  # <- del token, nunca de body["doctor_id"]
            body["patient_id"],
            body["ips_id"],
            body["tejido_solicitado"].strip(),
            body.get("procedimiento_quirurgico"),
            body["alto_requerido"],
            body["ancho_requerido"],
            body["profundidad_requerida"],
            body["fecha_estimada_cirugia"],
            body.get("diagnostico"),
            bool(body.get("sexo_importante", False)),
        ),
    )
    return created(row)


# ============================================================================
# GET /requests — doctor ve solo lo suyo, admin ve todo
# ============================================================================
def list_all(event, auth_payload):
    if auth_payload["role"] == "admin":
        rows = query(
            """
            SELECT id, codigo_visible, doctor_id, patient_id, ips_id, tejido_solicitado, procedimiento_quirurgico,
                   alto_requerido, ancho_requerido, profundidad_requerida, fecha_estimada_cirugia, diagnostico, sexo_importante
            FROM request
            ORDER BY fecha_estimada_cirugia
            LIMIT 200
            """
        )
    else:
        rows = query(
            """
            SELECT id, codigo_visible, doctor_id, patient_id, ips_id, tejido_solicitado, procedimiento_quirurgico,
                   alto_requerido, ancho_requerido, profundidad_requerida, fecha_estimada_cirugia, diagnostico, sexo_importante
            FROM request
            WHERE doctor_id = %s
            ORDER BY fecha_estimada_cirugia
            LIMIT 200
            """,
            (auth_payload["sub"],),
        )
    return ok({"data": rows})


# ============================================================================
# GET /requests/{id} — doctor solo si es dueño, admin cualquiera
# ============================================================================
def get_one(request_id, auth_payload):
    row = query_one(
        """
        SELECT id, codigo_visible, doctor_id, patient_id, ips_id, tejido_solicitado, procedimiento_quirurgico,
               alto_requerido, ancho_requerido, profundidad_requerida, fecha_estimada_cirugia, diagnostico, sexo_importante
        FROM request WHERE id = %s
        """,
        (request_id,),
    )
    if not row:
        return not_found("Solicitud")

    if auth_payload["role"] != "admin" and row["doctor_id"] != auth_payload["sub"]:
        return forbidden("No tienes permiso para ver esta solicitud.")

    return ok(row)


# ============================================================================
# PUT /requests/{id} — SOLO el doctor dueño (admin no puede editar, ni el
# propio dueño puede reasignarla a otro doctor: doctor_id no es editable).
# codigo_visible TAMPOCO es editable aquí (mismo criterio que la
# identificación de patient) — si hubo un error de tipeo al capturarlo,
# se corrige por otro medio, no por este endpoint.
# ============================================================================
def update_request(request_id, event, auth_payload):
    existing = query_one("SELECT doctor_id FROM request WHERE id = %s", (request_id,))
    if not existing:
        return not_found("Solicitud")

    if auth_payload["role"] != "doctor" or existing["doctor_id"] != auth_payload["sub"]:
        return forbidden("Solo el doctor que creó esta solicitud puede editarla.")

    body = parse_body(event)
    missing = require_fields(
        body,
        [
            "patient_id", "ips_id", "tejido_solicitado",
            "alto_requerido", "ancho_requerido", "profundidad_requerida",
            "fecha_estimada_cirugia",
        ],
    )
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    patient = query_one("SELECT id FROM patient WHERE id = %s", (body["patient_id"],))
    if not patient:
        return error("El paciente indicado no existe.", status_code=404, code="NOT_FOUND", fields={"patient_id": "Paciente no encontrado"})

    ips = query_one("SELECT id FROM ips WHERE id = %s", (body["ips_id"],))
    if not ips:
        return error("La IPS indicada no existe.", status_code=404, code="NOT_FOUND", fields={"ips_id": "IPS no encontrada"})

    query(
        """
        UPDATE request
        SET patient_id = %s, ips_id = %s, tejido_solicitado = %s, procedimiento_quirurgico = %s,
            alto_requerido = %s, ancho_requerido = %s, profundidad_requerida = %s,
            fecha_estimada_cirugia = %s, diagnostico = %s, sexo_importante = %s
        WHERE id = %s
        """,
        (
            body["patient_id"],
            body["ips_id"],
            body["tejido_solicitado"].strip(),
            body.get("procedimiento_quirurgico"),
            body["alto_requerido"],
            body["ancho_requerido"],
            body["profundidad_requerida"],
            body["fecha_estimada_cirugia"],
            body.get("diagnostico"),
            bool(body.get("sexo_importante", False)),
            request_id,
        ),
        fetch=False,
    )
    return ok({"id": request_id, "updated": True})