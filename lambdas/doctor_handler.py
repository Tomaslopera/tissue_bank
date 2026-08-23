"""
doctor_handler.py — Lambda para el panel "Doctores" del admin.

Une dos tablas (app_user + doctor_profile) porque en la UI un "doctor" es
un solo concepto, aunque en la BD viva repartido en dos filas: app_user
(cuenta de acceso) y doctor_profile (datos de contacto, PK = cédula).

Rutas exactas que debe configurar API Gateway para este handler:
    POST   /doctors                        -> crear cuenta + perfil
    GET    /doctors                        -> listar todos los doctores
    GET    /doctors/{id}                   -> ver un doctor (id = user_id)
    PUT    /doctors/{id}                   -> editar nombre/teléfono/email
    PATCH  /doctors/{id}/status             -> activar / desactivar
    POST   /doctors/{id}/reset-password     -> generar contraseña nueva

Todas las rutas de este handler requieren rol admin — un doctor nunca debe
poder crear ni editar cuentas de otros doctores. La validación de rol se
hace leyendo el JWT (Authorization: Bearer <token>), NO confiando en nada
que venga en el body.

Formato de respuesta al crear/resetear contraseña: la contraseña en texto
plano se devuelve UNA sola vez, en el body de la respuesta HTTP — nunca se
persiste en texto plano (se guarda su hash bcrypt) ni se vuelve a exponer
en ningún GET posterior.
"""

import secrets
import string

from db import query, query_one, transaction
from auth import hash_password, get_auth_context, require_role, TokenError
from response import (
    ok, created, error, not_found, unauthorized, forbidden, server_error,
    require_fields, parse_body, path_param, http_method,
)


PASSWORD_ALPHABET = "".join(c for c in (string.ascii_letters + string.digits) if c not in "0O1lI")


def generate_temp_password(length=10):
    return "".join(secrets.choice(PASSWORD_ALPHABET) for _ in range(length))


def lambda_handler(event, context):
    try:
        method = http_method(event)
        if method == "OPTIONS":
            return ok({})

        # --- Autenticación + autorización: todo este handler es solo-admin ---
        try:
            auth_payload = get_auth_context(event)
        except TokenError as exc:
            return unauthorized(str(exc))

        if auth_payload is None:
            return unauthorized("Debes iniciar sesión para hacer esto.")
        if not require_role(auth_payload, "admin"):
            return forbidden("Solo un administrador puede gestionar cuentas de doctores.")

        raw_path = event.get("rawPath") or event.get("path") or ""
        doctor_user_id = path_param(event, "id")

        if method == "POST" and raw_path.endswith("/reset-password"):
            return reset_password(doctor_user_id)
        if method == "PATCH" and raw_path.endswith("/status"):
            return set_status(doctor_user_id, event)
        if method == "POST":
            return create_doctor(event)
        if method == "GET" and doctor_user_id:
            return get_one(doctor_user_id)
        if method == "GET":
            return list_all()
        if method == "PUT" and doctor_user_id:
            return update_profile(doctor_user_id, event)

        return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")
    except Exception as exc:
        return server_error(exc)


# ============================================================================
# POST /doctors — crea app_user + doctor_profile en una sola transacción
# ============================================================================
def create_doctor(event):
    body = parse_body(event)
    missing = require_fields(body, ["cedula", "nombre", "username"])
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    username = body["username"].strip().lower()

    existing_username = query_one("SELECT id FROM app_user WHERE lower(username) = %s", (username,))
    if existing_username:
        return error(
            "Ese usuario ya existe — elige otro.",
            status_code=409,
            code="USERNAME_TAKEN",
            fields={"username": "Ya está en uso"},
        )

    existing_cedula = query_one("SELECT id FROM doctor_profile WHERE id = %s", (body["cedula"],))
    if existing_cedula:
        return error(
            "Ya existe un doctor registrado con esa cédula.",
            status_code=409,
            code="CEDULA_TAKEN",
            fields={"cedula": "Ya está registrada"},
        )

    temp_password = generate_temp_password()
    password_hash = hash_password(temp_password)

    with transaction() as cur:
        cur.execute(
            "INSERT INTO app_user (username, password, role, is_active) "
            "VALUES (%s, %s, 'doctor', true) RETURNING id",
            (username, password_hash),
        )
        new_user_id = cur.fetchone()["id"]

        cur.execute(
            "INSERT INTO doctor_profile (id, user_id, nombre, telefono, email) "
            "VALUES (%s, %s, %s, %s, %s)",
            (
                body["cedula"],
                new_user_id,
                body["nombre"].strip(),
                body.get("telefono"),
                body.get("email"),
            ),
        )

    return created({
        "user_id": new_user_id,
        "username": username,
        "password": temp_password,
    })


# ============================================================================
# GET /doctors — listado con perfil ya unido
# ============================================================================
def list_all():
    rows = query("""
        SELECT
            u.id AS user_id,
            u.username,
            u.is_active,
            dp.id AS cedula,
            dp.nombre,
            dp.telefono,
            dp.email
        FROM app_user u
        LEFT JOIN doctor_profile dp ON dp.user_id = u.id
        WHERE u.role = 'doctor'
        ORDER BY dp.nombre NULLS LAST
    """)
    return ok({"data": rows})


# ============================================================================
# GET /doctors/{id}
# ============================================================================
def get_one(user_id):
    row = query_one("""
        SELECT
            u.id AS user_id, u.username, u.is_active,
            dp.id AS cedula, dp.nombre, dp.telefono, dp.email
        FROM app_user u
        LEFT JOIN doctor_profile dp ON dp.user_id = u.id
        WHERE u.id = %s AND u.role = 'doctor'
    """, (user_id,))
    if not row:
        return not_found("Doctor")
    return ok(row)


# ============================================================================
# PUT /doctors/{id} — solo nombre/telefono/email (cédula y username fijos)
# ============================================================================
def update_profile(user_id, event):
    body = parse_body(event)
    missing = require_fields(body, ["nombre"])
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    existing = query_one("SELECT id FROM doctor_profile WHERE user_id = %s", (user_id,))
    if not existing:
        return not_found("Doctor")

    query(
        "UPDATE doctor_profile SET nombre = %s, telefono = %s, email = %s WHERE user_id = %s",
        (body["nombre"].strip(), body.get("telefono"), body.get("email"), user_id),
        fetch=False,
    )
    return ok({"user_id": user_id, "updated": True})


# ============================================================================
# PATCH /doctors/{id}/status — activar / desactivar
# ============================================================================
def set_status(user_id, event):
    body = parse_body(event)
    if "is_active" not in body:
        return error("Falta el campo is_active (true/false).", fields={"is_active": "Este campo es obligatorio"})

    existing = query_one("SELECT id FROM app_user WHERE id = %s AND role = 'doctor'", (user_id,))
    if not existing:
        return not_found("Doctor")

    query("UPDATE app_user SET is_active = %s WHERE id = %s", (bool(body["is_active"]), user_id), fetch=False)
    return ok({"user_id": user_id, "is_active": bool(body["is_active"])})


# ============================================================================
# POST /doctors/{id}/reset-password
# ============================================================================
def reset_password(user_id):
    existing = query_one("SELECT username FROM app_user WHERE id = %s AND role = 'doctor'", (user_id,))
    if not existing:
        return not_found("Doctor")

    temp_password = generate_temp_password()
    password_hash = hash_password(temp_password)
    query("UPDATE app_user SET password = %s WHERE id = %s", (password_hash, user_id), fetch=False)

    return ok({
        "user_id": user_id,
        "username": existing["username"],
        "password": temp_password,
    })