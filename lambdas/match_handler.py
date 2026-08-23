"""
match_handler.py — Lambda para la tabla `match`.

Rutas que atiende:
    GET    /matches                        -> listar (filtro opcional: status)
    GET    /matches/{id}                   -> ver uno
    POST   /matches/{id}/send              -> enviar al doctor (detectado -> enviado)
    POST   /matches/{id}/cancel            -> cancelar envío (enviado -> detectado)
    POST   /matches/{id}/resend            -> reenviar (mismo status, solo repite la notificación)
    PUT    /matches/{id}/doctor-response   -> registrar aprobación/rechazo del doctor

Permisos (confirmados explícitamente, dos niveles distintos):
  - GET (listar/ver): cualquier usuario autenticado.
  - send / cancel / resend: SOLO admin — es gestión operativa del banco de
    tejidos (Panel Recomendaciones), no algo que el doctor haga.
  - doctor-response: el doctor DUEÑO de la solicitud asociada al match, O
    el admin registrándola en su nombre (ej. si la respuesta llegó por
    teléfono/correo y alguien del banco la transcribe).

Efecto importante en doctor-response con approved=true: se crea
automáticamente una fila en `assignment` con status='pendiente' — esto y
el UPDATE del match van en la MISMA transacción (si algo falla, ninguno
de los dos cambios queda a medias). Esta regla fue confirmada
explícitamente, igual que en donor/implant handlers con sus respectivas
reglas de transacción.

Nota: este handler NO crea filas de match nuevas — eso lo hace el motor
de matching (Lambda #12, todavía por construirse con el enfoque de botón
manual que se decidió). Este handler solo opera sobre matches que YA
existen.
"""

from db import query, query_one, transaction
from auth import get_auth_context, require_role, TokenError
from response import (
    ok, error, not_found, unauthorized, forbidden, server_error,
    require_fields, parse_body, path_param, query_param, http_method,
)

MATCH_COLUMNS = """
    id, request_id, implant_id, compatibility_score,
    compatibility_alto, compatibility_ancho, compatibility_profundidad, status,
    sent_at, decided_by, decided_at, rejection_reason
"""


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
        match_id = path_param(event, "id")

        if method == "GET" and match_id:
            return get_one(match_id, auth_payload)
        if method == "GET":
            return list_all(event, auth_payload)
        if method == "POST" and match_id and raw_path.endswith("/send"):
            return send_match(match_id, auth_payload)
        if method == "POST" and match_id and raw_path.endswith("/cancel"):
            return cancel_match(match_id, auth_payload)
        if method == "POST" and match_id and raw_path.endswith("/resend"):
            return resend_match(match_id, auth_payload)
        if method == "PUT" and match_id and raw_path.endswith("/doctor-response"):
            return doctor_response(match_id, event, auth_payload)

        return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")
    except Exception as exc:
        return server_error(exc)


# ============================================================================
# Helper: obtiene el doctor_id dueño de la solicitud asociada a un match
# ============================================================================
def _get_match_and_owner(match_id):
    return query_one(
        f"""
        SELECT m.id, m.request_id, m.implant_id, m.status, r.doctor_id
        FROM match m
        JOIN request r ON r.id = m.request_id
        WHERE m.id = %s
        """,
        (match_id,),
    )


# ============================================================================
# GET /matches?status=...
# ============================================================================
def list_all(event, auth_payload):
    status_filter = query_param(event, "status")
    if status_filter:
        rows = query(f"SELECT {MATCH_COLUMNS} FROM match WHERE status = %s ORDER BY id", (status_filter,))
    else:
        rows = query(f"SELECT {MATCH_COLUMNS} FROM match ORDER BY id LIMIT 200")
    return ok({"data": rows})


# ============================================================================
# GET /matches/{id}
# ============================================================================
def get_one(match_id, auth_payload):
    row = query_one(f"SELECT {MATCH_COLUMNS} FROM match WHERE id = %s", (match_id,))
    if not row:
        return not_found("Match")
    return ok(row)


# ============================================================================
# POST /matches/{id}/send — SOLO admin, detectado -> enviado
# ============================================================================
def send_match(match_id, auth_payload):
    if auth_payload["role"] != "admin":
        return forbidden("Solo un administrador puede enviar matches al doctor.")

    match = query_one("SELECT id, status FROM match WHERE id = %s", (match_id,))
    if not match:
        return not_found("Match")
    if match["status"] != "detectado":
        return error(
            f"Solo se puede enviar un match en estado 'detectado' (estado actual: {match['status']}).",
            status_code=409,
            code="INVALID_STATE",
        )

    query("UPDATE match SET status = 'enviado', sent_at = now() WHERE id = %s", (match_id,), fetch=False)
    return ok({"id": match_id, "status": "enviado"})


# ============================================================================
# POST /matches/{id}/cancel — SOLO admin, enviado -> detectado
# ============================================================================
def cancel_match(match_id, auth_payload):
    if auth_payload["role"] != "admin":
        return forbidden("Solo un administrador puede cancelar el envío de un match.")

    match = query_one("SELECT id, status FROM match WHERE id = %s", (match_id,))
    if not match:
        return not_found("Match")
    if match["status"] != "enviado":
        return error(
            f"Solo se puede cancelar un match en estado 'enviado' (estado actual: {match['status']}).",
            status_code=409,
            code="INVALID_STATE",
        )

    query("UPDATE match SET status = 'detectado', sent_at = NULL WHERE id = %s", (match_id,), fetch=False)
    return ok({"id": match_id, "status": "detectado"})


# ============================================================================
# POST /matches/{id}/resend — SOLO admin, no cambia status, pero SÍ
# actualiza sent_at (ahora que existe la columna) para reflejar el momento
# real del último reenvío — en producción esto dispararía de nuevo el correo.
# ============================================================================
def resend_match(match_id, auth_payload):
    if auth_payload["role"] != "admin":
        return forbidden("Solo un administrador puede reenviar un match.")

    match = query_one("SELECT id, status FROM match WHERE id = %s", (match_id,))
    if not match:
        return not_found("Match")
    if match["status"] != "enviado":
        return error(
            f"Solo se puede reenviar un match en estado 'enviado' (estado actual: {match['status']}).",
            status_code=409,
            code="INVALID_STATE",
        )

    query("UPDATE match SET sent_at = now() WHERE id = %s", (match_id,), fetch=False)
    return ok({"id": match_id, "status": "enviado", "resent": True})


# ============================================================================
# PUT /matches/{id}/doctor-response — doctor dueño O admin en su nombre.
# Registra quién decidió (decided_by) y cuándo (decided_at) — esto puede
# ser el doctor mismo o el admin actuando en su nombre, según quién haya
# hecho la llamada. rejection_reason es opcional (no se fuerza a dar un
# motivo, aunque se recomienda en la UI cuando approved=false).
# ============================================================================
def doctor_response(match_id, event, auth_payload):
    match = _get_match_and_owner(match_id)
    if not match:
        return not_found("Match")

    is_owner_doctor = auth_payload["role"] == "doctor" and match["doctor_id"] == auth_payload["sub"]
    is_admin = auth_payload["role"] == "admin"
    if not (is_owner_doctor or is_admin):
        return forbidden("Solo el doctor dueño de la solicitud, o un administrador en su nombre, puede registrar esta respuesta.")

    if match["status"] != "enviado":
        return error(
            f"Solo se puede registrar respuesta de un match en estado 'enviado' (estado actual: {match['status']}).",
            status_code=409,
            code="INVALID_STATE",
        )

    body = parse_body(event)
    missing = require_fields(body, ["approved"])
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    approved = bool(body["approved"])
    rejection_reason = body.get("rejection_reason") if not approved else None

    with transaction() as cur:
        if approved:
            cur.execute(
                "UPDATE match SET status = 'aprobado_doctor', decided_by = %s, decided_at = now() WHERE id = %s",
                (auth_payload["sub"], match_id),
            )
            cur.execute(
                "INSERT INTO assignment (match_id, status) VALUES (%s, 'pendiente') RETURNING id",
                (match_id,),
            )
            assignment_id = cur.fetchone()["id"]
        else:
            cur.execute(
                "UPDATE match SET status = 'rechazado_doctor', decided_by = %s, decided_at = now(), rejection_reason = %s WHERE id = %s",
                (auth_payload["sub"], rejection_reason, match_id),
            )
            assignment_id = None

    result = {"id": match_id, "status": "aprobado_doctor" if approved else "rechazado_doctor"}
    if assignment_id:
        result["assignment_id"] = assignment_id
    return ok(result)