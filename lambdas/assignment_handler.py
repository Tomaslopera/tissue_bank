"""
assignment_handler.py  —  Lambda #10 para la tabla `assignment`.

Rutas que atiende:
    GET    /assignments                 -> listar (admin ve todas, doctor ve solo las suyas)
    GET    /assignments/{id}            -> ver una (mismo criterio de visibilidad)
    PUT    /assignments/{id}/approve    -> aprobar (admin O doctor dueño de la solicitud)
    PUT    /assignments/{id}/reject     -> rechazar (admin O doctor dueño de la solicitud)

Permisos (confirmados):
  - GET listar/ver: admin y doctor, con visibilidad distinta (doctor solo ve las
    asignaciones ligadas a sus propias solicitudes).
  - approve / reject: admin O el doctor dueño de la solicitud original.
    Es el mismo patrón de "doctor dueño o admin" ya establecido en
    match_handler / doctor-response.

Efecto de approve (transaccional — todo o nada):
    1. assignment.status      → 'aprobada'
    2. assignment.reviewed_by → usuario del token (doctor o admin, quien llamó)
    3. match.status           → 'aprobado_admin'
    4. implant.estado         → 'asignado'
    5. INSERT dispatch con (assignment_id, ips_id de la solicitud, status='por_etiquetar')

Efecto de reject (transaccional — todo o nada):
    1. assignment.status      → 'rechazada'
    2. assignment.reviewed_by → usuario del token
    3. match.status           → 'rechazado_admin'
    4. implant.estado         → 'disponible'   (libera el tejido para futuros matches)

Nota de diseño: reviewed_by se registra en ambos casos (approve y reject) porque
refleja quién tomó la decisión operativa, sea doctor o admin — útil para auditoría.
"""

from db import query, query_one, transaction
from auth import get_auth_context, require_role, TokenError
from response import (
    ok, error, not_found, unauthorized, forbidden, server_error,
    path_param, query_param, http_method,
)

ASSIGNMENT_COLUMNS = "id, match_id, reviewed_by, status"


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

        raw_path = event.get("rawPath") or event.get("path") or ""
        assignment_id = path_param(event, "id")

        if method == "GET" and assignment_id:
            return get_one(assignment_id, auth_payload)
        if method == "GET":
            return list_all(event, auth_payload)
        if method == "PUT" and assignment_id and raw_path.endswith("/approve"):
            return approve_assignment(assignment_id, auth_payload)
        if method == "PUT" and assignment_id and raw_path.endswith("/reject"):
            return reject_assignment(assignment_id, auth_payload)

        return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")
    except Exception as exc:
        return server_error(exc)


# ============================================================================
# Helper interno: obtiene la asignación con todo el contexto de cadena que
# necesitan approve, reject y get_one para verificar permisos y hacer los
# UPDATE en cascada. Un solo JOIN es más limpio que 3 query_one anidados.
# ============================================================================
def _get_assignment_with_context(assignment_id):
    return query_one(
        """
        SELECT
            a.id            AS id,
            a.match_id      AS match_id,
            a.reviewed_by   AS reviewed_by,
            a.status        AS status,
            m.implant_id    AS implant_id,
            r.doctor_id     AS doctor_id,
            r.ips_id        AS ips_id
        FROM assignment a
        JOIN match m ON m.id = a.match_id
        JOIN request r ON r.id = m.request_id
        WHERE a.id = %s
        """,
        (assignment_id,),
    )


# ============================================================================
# GET /assignments?status=...
# Admin ve todas; doctor ve solo las ligadas a sus propias solicitudes.
# El filtro ?status= es opcional y acepta los mismos valores que el CHECK
# constraint de la tabla: 'pendiente', 'aprobada', 'rechazada'.
# ============================================================================
def list_all(event, auth_payload):
    status_filter = query_param(event, "status")

    if auth_payload["role"] == "admin":
        if status_filter:
            rows = query(
                f"SELECT {ASSIGNMENT_COLUMNS} FROM assignment WHERE status = %s ORDER BY id LIMIT 200",
                (status_filter,),
            )
        else:
            rows = query(
                f"SELECT {ASSIGNMENT_COLUMNS} FROM assignment ORDER BY id LIMIT 200"
            )
    else:
        # Doctor: solo sus asignaciones (join hasta request para filtrar por doctor_id)
        if status_filter:
            rows = query(
                f"""
                SELECT a.id, a.match_id, a.reviewed_by, a.status
                FROM assignment a
                JOIN match m ON m.id = a.match_id
                JOIN request r ON r.id = m.request_id
                WHERE r.doctor_id = %s AND a.status = %s
                ORDER BY a.id
                LIMIT 200
                """,
                (auth_payload["sub"], status_filter),
            )
        else:
            rows = query(
                f"""
                SELECT a.id, a.match_id, a.reviewed_by, a.status
                FROM assignment a
                JOIN match m ON m.id = a.match_id
                JOIN request r ON r.id = m.request_id
                WHERE r.doctor_id = %s
                ORDER BY a.id
                LIMIT 200
                """,
                (auth_payload["sub"],),
            )

    return ok({"data": rows})


# ============================================================================
# GET /assignments/{id}
# ============================================================================
def get_one(assignment_id, auth_payload):
    row = _get_assignment_with_context(assignment_id)
    if not row:
        return not_found("Asignación")

    if auth_payload["role"] != "admin" and row["doctor_id"] != auth_payload["sub"]:
        return forbidden("No tienes permiso para ver esta asignación.")

    # Devolver solo los campos de la tabla assignment — los campos del JOIN
    # (implant_id, doctor_id, ips_id) son contexto interno de operación,
    # no datos públicos de esta entidad.
    return ok({
        "id":          row["id"],
        "match_id":    row["match_id"],
        "reviewed_by": row["reviewed_by"],
        "status":      row["status"],
    })


# ============================================================================
# PUT /assignments/{id}/approve
# Transaccional: assignment aprobada + match aprobado_admin + implant asignado
#                + INSERT dispatch con la IPS de la solicitud original.
# ============================================================================
def approve_assignment(assignment_id, auth_payload):
    assignment = _get_assignment_with_context(assignment_id)
    if not assignment:
        return not_found("Asignación")

    is_owner_doctor = (
        auth_payload["role"] == "doctor"
        and assignment["doctor_id"] == auth_payload["sub"]
    )
    is_admin = auth_payload["role"] == "admin"
    if not (is_owner_doctor or is_admin):
        return forbidden(
            "Solo el doctor dueño de la solicitud, o un administrador, puede aprobar esta asignación."
        )

    if assignment["status"] != "pendiente":
        return error(
            f"Solo se puede aprobar una asignación en estado 'pendiente' "
            f"(estado actual: '{assignment['status']}').",
            status_code=409,
            code="INVALID_STATE",
        )

    with transaction() as cur:
        cur.execute(
            "UPDATE assignment SET status = 'aprobada', reviewed_by = %s WHERE id = %s",
            (auth_payload["sub"], assignment_id),
        )
        cur.execute(
            "UPDATE match SET status = 'aprobado_admin' WHERE id = %s",
            (assignment["match_id"],),
        )
        cur.execute(
            "UPDATE implant SET estado = 'asignado' WHERE id = %s",
            (assignment["implant_id"],),
        )
        cur.execute(
            "INSERT INTO dispatch (assignment_id, ips_id, status) "
            "VALUES (%s, %s, 'por_etiquetar') RETURNING id",
            (assignment_id, assignment["ips_id"]),
        )
        dispatch_id = cur.fetchone()["id"]

    return ok({
        "id":          assignment_id,
        "status":      "aprobada",
        "dispatch_id": dispatch_id,
    })


# ============================================================================
# PUT /assignments/{id}/reject
# Transaccional: assignment rechazada + match rechazado_admin + implant disponible.
# ============================================================================
def reject_assignment(assignment_id, auth_payload):
    assignment = _get_assignment_with_context(assignment_id)
    if not assignment:
        return not_found("Asignación")

    is_owner_doctor = (
        auth_payload["role"] == "doctor"
        and assignment["doctor_id"] == auth_payload["sub"]
    )
    is_admin = auth_payload["role"] == "admin"
    if not (is_owner_doctor or is_admin):
        return forbidden(
            "Solo el doctor dueño de la solicitud, o un administrador, puede rechazar esta asignación."
        )

    if assignment["status"] != "pendiente":
        return error(
            f"Solo se puede rechazar una asignación en estado 'pendiente' "
            f"(estado actual: '{assignment['status']}').",
            status_code=409,
            code="INVALID_STATE",
        )

    with transaction() as cur:
        cur.execute(
            "UPDATE assignment SET status = 'rechazada', reviewed_by = %s WHERE id = %s",
            (auth_payload["sub"], assignment_id),
        )
        cur.execute(
            "UPDATE match SET status = 'rechazado_admin' WHERE id = %s",
            (assignment["match_id"],),
        )
        cur.execute(
            "UPDATE implant SET estado = 'disponible' WHERE id = %s",
            (assignment["implant_id"],),
        )

    return ok({"id": assignment_id, "status": "rechazada"})