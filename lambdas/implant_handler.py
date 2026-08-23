"""
implant_handler.py — Lambda para la tabla `implant`.

Rutas que atiende:
    POST   /implants          -> crear implante
    GET    /implants          -> listar (filtros opcionales: donor_id, estado)
    GET    /implants/{id}     -> ver uno
    PUT    /implants/{id}     -> editar

Acceso: SOLO admin — misma decisión que donor_handler, porque el
inventario de implantes vive en el mismo Panel Tejidos que solo ve el
admin en el frontend original.

Este handler es un CRUD puro — NO incluye ninguna lógica de matching. La
búsqueda de compatibilidad entre solicitudes e implantes es una pieza de
negocio que todavía está por definirse (cómo comparar tejido_solicitado
contra tipo_implante, umbral de score, etc.) y se va a construir aparte,
como su propia Lambda con su propio endpoint, una vez esas reglas queden
confirmadas.
"""

from db import query, query_one
from auth import get_auth_context, require_role, TokenError
from response import (
    ok, created, error, not_found, unauthorized, forbidden, server_error,
    require_fields, parse_body, path_param, query_param, http_method,
)

VALID_ESTADOS = ("disponible", "reservado", "asignado", "contraindicado", "vencido", "despachado")


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
        if not require_role(auth_payload, "admin"):
            return forbidden("Solo un administrador puede gestionar el inventario de implantes.")

        implant_id = path_param(event, "id")

        if method == "POST":
            return create_implant(event)
        if method == "GET" and implant_id:
            return get_one(implant_id)
        if method == "GET":
            return list_all(event)
        if method == "PUT" and implant_id:
            return update_implant(implant_id, event)

        return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")
    except Exception as exc:
        return server_error(exc)


# ============================================================================
# POST /implants
# ============================================================================
def create_implant(event):
    body = parse_body(event)
    missing = require_fields(body, ["codigo_visible", "donor_id", "parte_cuerpo", "tipo_implante"])
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    estado = body.get("estado", "disponible")
    if estado not in VALID_ESTADOS:
        return error(
            f"estado debe ser uno de: {', '.join(VALID_ESTADOS)}.",
            fields={"estado": "Valor inválido"},
        )

    donor = query_one("SELECT id FROM donor WHERE id = %s", (body["donor_id"],))
    if not donor:
        return error(
            "El donante indicado no existe.",
            status_code=404,
            code="NOT_FOUND",
            fields={"donor_id": "Donante no encontrado"},
        )

    existing_code = query_one("SELECT id FROM implant WHERE codigo_visible = %s", (body["codigo_visible"],))
    if existing_code:
        return error(
            "Ya existe un implante registrado con ese código.",
            status_code=409,
            code="IMPLANT_CODE_TAKEN",
            fields={"codigo_visible": "Ya está registrado"},
        )

    row = query_one(
        """
        INSERT INTO implant
            (codigo_visible, donor_id, parte_cuerpo, tipo_implante, alto, ancho, estado, notas_adicionales, url_imagen)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id, codigo_visible, donor_id, parte_cuerpo, tipo_implante, alto, ancho, estado, notas_adicionales, url_imagen
        """,
        (
            body["codigo_visible"].strip(),
            body["donor_id"],
            body["parte_cuerpo"].strip(),
            body["tipo_implante"].strip(),
            body.get("alto"),
            body.get("ancho"),
            estado,
            body.get("notas_adicionales"),
            body.get("url_imagen"),
        ),
    )
    return created(row)


# ============================================================================
# GET /implants?donor_id=...&estado=...
# ============================================================================
def list_all(event):
    donor_id = query_param(event, "donor_id")
    estado = query_param(event, "estado")
    search = query_param(event, "search")

    sql = """
        SELECT id, codigo_visible, donor_id, parte_cuerpo, tipo_implante, alto, ancho, estado, notas_adicionales, url_imagen
        FROM implant
        WHERE 1=1
    """
    params = []
    if donor_id:
        sql += " AND donor_id = %s"
        params.append(donor_id)
    if estado:
        sql += " AND estado = %s"
        params.append(estado)
    if search:
        sql += " AND codigo_visible ILIKE %s"
        params.append(f"%{search}%")
    sql += " ORDER BY tipo_implante LIMIT 200"

    rows = query(sql, tuple(params))
    return ok({"data": rows})


# ============================================================================
# GET /implants/{id}
# ============================================================================
def get_one(implant_id):
    row = query_one(
        "SELECT id, codigo_visible, donor_id, parte_cuerpo, tipo_implante, alto, ancho, estado, notas_adicionales, url_imagen "
        "FROM implant WHERE id = %s",
        (implant_id,),
    )
    if not row:
        return not_found("Implante")
    return ok(row)


# ============================================================================
# PUT /implants/{id}
# ============================================================================
def update_implant(implant_id, event):
    body = parse_body(event)
    missing = require_fields(body, ["codigo_visible", "parte_cuerpo", "tipo_implante"])
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    estado = body.get("estado", "disponible")
    if estado not in VALID_ESTADOS:
        return error(
            f"estado debe ser uno de: {', '.join(VALID_ESTADOS)}.",
            fields={"estado": "Valor inválido"},
        )

    existing = query_one("SELECT id FROM implant WHERE id = %s", (implant_id,))
    if not existing:
        return not_found("Implante")

    duplicate = query_one(
        "SELECT id FROM implant WHERE codigo_visible = %s AND id != %s",
        (body["codigo_visible"], implant_id),
    )
    if duplicate:
        return error(
            "Ese código de implante ya está en uso por otro registro.",
            status_code=409,
            code="IMPLANT_CODE_TAKEN",
            fields={"codigo_visible": "Ya está registrado"},
        )

    query(
        """
        UPDATE implant
        SET codigo_visible = %s, parte_cuerpo = %s, tipo_implante = %s, alto = %s, ancho = %s,
            estado = %s, notas_adicionales = %s, url_imagen = %s
        WHERE id = %s
        """,
        (
            body["codigo_visible"].strip(),
            body["parte_cuerpo"].strip(),
            body["tipo_implante"].strip(),
            body.get("alto"),
            body.get("ancho"),
            estado,
            body.get("notas_adicionales"),
            body.get("url_imagen"),
            implant_id,
        ),
        fetch=False,
    )
    return ok({"id": implant_id, "updated": True})