"""
ips_handler.py — Lambda para la tabla `ips`.

Rutas que atiende:
    POST   /ips          -> crear IPS
    GET    /ips          -> listar (con búsqueda opcional por nombre)
    GET    /ips/{id}     -> ver una
    PUT    /ips/{id}     -> editar (todos los campos, sin restricciones)

Acceso: cualquier usuario autenticado (doctor o admin) — un doctor necesita
poder registrar una IPS nueva al crear una solicitud desde su propio panel,
igual que con patient_handler.

Decisión de negocio (confirmada explícitamente): a diferencia de patient y
doctor_profile, una IPS SÍ se puede editar por completo después de creada
(nombre, dirección, teléfono, ciudad) — no tiene un campo de "identidad"
que deba quedar fijo, porque no hay equivalente a una cédula/documento
único para una institución en este modelo.

Nota de diseño: `nombre` no tiene una restricción UNIQUE a nivel de base de
datos (dos IPS reales podrían compartir nombre en distintas ciudades), así
que list_all()/search no asume que el nombre identifica de forma única a
una IPS — el buscador es solo un filtro de conveniencia para el
autocompletado del formulario de "Nueva solicitud", no una validación de
duplicados como sí ocurre en patient_handler.
"""

from db import query, query_one
from auth import get_auth_context, require_role, TokenError
from response import (
    ok, created, error, not_found, unauthorized, server_error,
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

        if not require_role(auth_payload, "admin", "doctor"):
            return unauthorized("Debes iniciar sesión para hacer esto.")

        ips_id = path_param(event, "id")

        if method == "POST":
            return create_ips(event)
        if method == "GET" and ips_id:
            return get_one(ips_id)
        if method == "GET":
            return list_all(event)
        if method == "PUT" and ips_id:
            return update_ips(ips_id, event)

        return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")
    except Exception as exc:
        return server_error(exc)


# ============================================================================
# POST /ips
# ============================================================================
def create_ips(event):
    body = parse_body(event)
    missing = require_fields(body, ["nombre"])
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    row = query_one(
        """
        INSERT INTO ips (nombre, direccion, telefono, ciudad)
        VALUES (%s, %s, %s, %s)
        RETURNING id, nombre, direccion, telefono, ciudad
        """,
        (
            body["nombre"].strip(),
            body.get("direccion"),
            body.get("telefono"),
            body.get("ciudad"),
        ),
    )
    return created(row)


# ============================================================================
# GET /ips?search=... — para el autocompletado del formulario de solicitud
# ============================================================================
def list_all(event):
    search = query_param(event, "search")
    if search:
        rows = query(
            """
            SELECT id, nombre, direccion, telefono, ciudad
            FROM ips
            WHERE nombre ILIKE %s OR ciudad ILIKE %s
            ORDER BY nombre
            LIMIT 20
            """,
            (f"%{search}%", f"%{search}%"),
        )
    else:
        rows = query(
            "SELECT id, nombre, direccion, telefono, ciudad FROM ips ORDER BY nombre LIMIT 100"
        )
    return ok({"data": rows})


# ============================================================================
# GET /ips/{id}
# ============================================================================
def get_one(ips_id):
    row = query_one(
        "SELECT id, nombre, direccion, telefono, ciudad FROM ips WHERE id = %s",
        (ips_id,),
    )
    if not row:
        return not_found("IPS")
    return ok(row)


# ============================================================================
# PUT /ips/{id} — edición completa, sin campos bloqueados
# ============================================================================
def update_ips(ips_id, event):
    body = parse_body(event)
    missing = require_fields(body, ["nombre"])
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    existing = query_one("SELECT id FROM ips WHERE id = %s", (ips_id,))
    if not existing:
        return not_found("IPS")

    query(
        "UPDATE ips SET nombre = %s, direccion = %s, telefono = %s, ciudad = %s WHERE id = %s",
        (body["nombre"].strip(), body.get("direccion"), body.get("telefono"), body.get("ciudad"), ips_id),
        fetch=False,
    )
    return ok({"id": ips_id, "updated": True})