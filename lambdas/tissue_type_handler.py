"""
tissue_type_handler.py — Lambda para la tabla `tissue_type`.

Rutas que atiende:
    POST   /tissue-types          -> crear un tipo de implante nuevo
    GET    /tissue-types          -> listar el catálogo completo

Este catálogo reemplaza la lista fija de "Tipo de implante" que antes vivía
hardcodeada en el <select> del frontend (Cóndilo, Patela, Plato tibial...).
Ahora el admin puede agregar tipos nuevos desde el Panel Tejidos y quedan
disponibles para todos los usuarios en futuras cargas del formulario.

Acceso: GET es para cualquier usuario autenticado (el doctor no gestiona
inventario, pero no hay razón para bloquearle la lectura). POST (crear tipo
nuevo) es solo admin, misma decisión que implant_handler para la gestión de
inventario.

No hay PUT/DELETE: un tipo ya usado por implantes existentes no debería
renombrarse ni borrarse desde acá — si algún día hace falta, se agrega con
las validaciones de integridad correspondientes.
"""

from db import query, query_one
from auth import get_auth_context, require_role, TokenError
from response import (
    ok, created, error, unauthorized, forbidden, server_error,
    require_fields, parse_body, http_method,
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
            return forbidden("Solo un administrador puede agregar tipos de implante.")

        if method == "POST":
            return create_tissue_type(event)
        if method == "GET":
            return list_all()

        return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")
    except Exception as exc:
        return server_error(exc)


# ============================================================================
# POST /tissue-types
# ============================================================================
def create_tissue_type(event):
    body = parse_body(event)
    missing = require_fields(body, ["nombre"])
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    nombre = body["nombre"].strip()
    existing = query_one("SELECT id, nombre FROM tissue_type WHERE nombre ILIKE %s", (nombre,))
    if existing:
        return ok(existing)

    row = query_one(
        "INSERT INTO tissue_type (nombre) VALUES (%s) RETURNING id, nombre",
        (nombre,),
    )
    return created(row)


# ============================================================================
# GET /tissue-types
# ============================================================================
def list_all():
    rows = query("SELECT id, nombre FROM tissue_type ORDER BY nombre")
    return ok({"data": rows})
