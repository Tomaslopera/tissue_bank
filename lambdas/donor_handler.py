"""
donor_handler.py — Lambda para la tabla `donor`.

Rutas que atiende:
    POST   /donors          -> crear donante
    GET    /donors          -> listar (con búsqueda opcional por codigo_donante)
    GET    /donors/{id}     -> ver uno
    PUT    /donors/{id}     -> editar (todos los campos)

Acceso: GET (listar/ver) es para cualquier usuario autenticado — un doctor
necesita poder ver el detalle del donante asociado al implante que le
llega en su tarjeta de match (Panel Solicitantes). Crear/editar (POST/PUT)
sigue siendo SOLO admin (confirmado explícitamente) — los donantes y su
inventario son gestión operativa del banco de tejidos; un doctor nunca
necesita crear ni editar un donante desde su panel.

Nota sobre fechas: fecha_extraccion y fecha_vencimiento son NOT NULL en la
tabla (fecha_procedimiento y fecha_segundo_cambio son opcionales) — la
fecha_vencimiento es la que gobierna, en implant_handler y en el resto del
sistema, si un implante de este donante sigue vigente o no.
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
        if method != "GET" and not require_role(auth_payload, "admin"):
            return forbidden("Solo un administrador puede gestionar donantes.")

        donor_id = path_param(event, "id")

        if method == "POST":
            return create_donor(event)
        if method == "GET" and donor_id:
            return get_one(donor_id)
        if method == "GET":
            return list_all(event)
        if method == "PUT" and donor_id:
            return update_donor(donor_id, event)

        return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")
    except Exception as exc:
        return server_error(exc)


# ============================================================================
# POST /donors
# ============================================================================
def create_donor(event):
    body = parse_body(event)
    missing = require_fields(body, ["codigo_donante", "fecha_extraccion", "fecha_vencimiento", "sexo_biologico"])
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    if body["sexo_biologico"] not in ("M", "F"):
        return error("sexo_biologico debe ser 'M' o 'F'.", fields={"sexo_biologico": "Valor inválido"})

    existing = query_one("SELECT id FROM donor WHERE codigo_donante = %s", (body["codigo_donante"],))
    if existing:
        return error(
            "Ya existe un donante registrado con ese código.",
            status_code=409,
            code="DONOR_CODE_TAKEN",
            fields={"codigo_donante": "Ya está registrado"},
        )

    row = query_one(
        """
        INSERT INTO donor (codigo_donante, fecha_extraccion, fecha_procedimiento, fecha_segundo_cambio, fecha_vencimiento, sexo_biologico)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id, codigo_donante, fecha_extraccion, fecha_procedimiento, fecha_segundo_cambio, fecha_vencimiento, sexo_biologico
        """,
        (
            body["codigo_donante"].strip(),
            body["fecha_extraccion"],
            body.get("fecha_procedimiento"),
            body.get("fecha_segundo_cambio"),
            body["fecha_vencimiento"],
            body["sexo_biologico"],
        ),
    )
    return created(row)


# ============================================================================
# GET /donors?search=... — busca por código de donante
# ============================================================================
def list_all(event):
    search = query_param(event, "search")
    if search:
        rows = query(
            """
            SELECT id, codigo_donante, fecha_extraccion, fecha_procedimiento, fecha_segundo_cambio, fecha_vencimiento, sexo_biologico
            FROM donor
            WHERE codigo_donante ILIKE %s
            ORDER BY fecha_extraccion DESC
            LIMIT 20
            """,
            (f"%{search}%",),
        )
    else:
        rows = query(
            """
            SELECT id, codigo_donante, fecha_extraccion, fecha_procedimiento, fecha_segundo_cambio, fecha_vencimiento, sexo_biologico
            FROM donor
            ORDER BY fecha_extraccion DESC
            LIMIT 100
            """
        )
    return ok({"data": rows})


# ============================================================================
# GET /donors/{id}
# ============================================================================
def get_one(donor_id):
    row = query_one(
        "SELECT id, codigo_donante, fecha_extraccion, fecha_procedimiento, fecha_segundo_cambio, fecha_vencimiento, sexo_biologico "
        "FROM donor WHERE id = %s",
        (donor_id,),
    )
    if not row:
        return not_found("Donante")
    return ok(row)


# ============================================================================
# PUT /donors/{id} — edición completa (incluye codigo_donante, con la misma
# validación de duplicado que en creación, por si se corrige un error de tipeo)
# ============================================================================
def update_donor(donor_id, event):
    body = parse_body(event)
    missing = require_fields(body, ["codigo_donante", "fecha_extraccion", "fecha_vencimiento", "sexo_biologico"])
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    if body["sexo_biologico"] not in ("M", "F"):
        return error("sexo_biologico debe ser 'M' o 'F'.", fields={"sexo_biologico": "Valor inválido"})

    existing = query_one("SELECT id FROM donor WHERE id = %s", (donor_id,))
    if not existing:
        return not_found("Donante")

    duplicate = query_one(
        "SELECT id FROM donor WHERE codigo_donante = %s AND id != %s",
        (body["codigo_donante"], donor_id),
    )
    if duplicate:
        return error(
            "Ese código de donante ya está en uso por otro registro.",
            status_code=409,
            code="DONOR_CODE_TAKEN",
            fields={"codigo_donante": "Ya está registrado"},
        )

    query(
        """
        UPDATE donor
        SET codigo_donante = %s, fecha_extraccion = %s, fecha_procedimiento = %s,
            fecha_segundo_cambio = %s, fecha_vencimiento = %s, sexo_biologico = %s
        WHERE id = %s
        """,
        (
            body["codigo_donante"].strip(),
            body["fecha_extraccion"],
            body.get("fecha_procedimiento"),
            body.get("fecha_segundo_cambio"),
            body["fecha_vencimiento"],
            body["sexo_biologico"],
            donor_id,
        ),
        fetch=False,
    )
    return ok({"id": donor_id, "updated": True})