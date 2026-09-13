"""
auth_login_handler.py — Lambda dedicada a la autenticación.

Ruta: POST /auth/login
No requiere token (es el punto de entrada).

Request body:
    { "username": "dr.martinez", "password": "doctor123" }

Response 200:
    {
      "token": "eyJhbGciOi...",
      "user": {
        "id": "uuid",
        "username": "dr.martinez",
        "role": "doctor",
        "display_name": "Dr. Andrés Martínez"
      }
    }

Response 401  -> credenciales incorrectas
Response 403  -> { "error": { "code": "ACCOUNT_INACTIVE", ... } } (cuenta desactivada)
Response 400  -> faltan username/password

Nota sobre verificación de contraseña (decisión confirmada explícitamente):
la comparación es en texto plano (`password != user["password"]`), a
propósito, NO con bcrypt — el costo de bcrypt.checkpw() por cada login
se consideró demasiado lento para lo que necesita esta app (login rápido).
doctor_handler.py guarda las contraseñas igual, en texto plano, por la
misma razón — ver su nota correspondiente.
"""

from db import query_one
from auth import issue_token
from response import ok, error, server_error, require_fields, parse_body, http_method


def lambda_handler(event, context):
    try:
        if http_method(event) == "OPTIONS":
            return ok({})

        body = parse_body(event)
        missing = require_fields(body, ["username", "password"])
        if missing:
            return error("Faltan campos obligatorios.", fields=missing)

        username = body["username"].strip().lower()
        password = body["password"]

        user = query_one(
            "SELECT id, username, password, role, is_active FROM app_user WHERE lower(username) = %s",
            (username,),
        )

        # Mismo mensaje genérico tanto si el usuario no existe como si la
        # contraseña no coincide — no revelar cuál de las dos falló.
        if not user or password != user["password"]:
            return error("Usuario o contraseña incorrectos.", status_code=401, code="INVALID_CREDENTIALS")

        if not user["is_active"]:
            return error(
                "Esta cuenta está desactivada. Contacta al administrador.",
                status_code=403,
                code="ACCOUNT_INACTIVE",
            )

        display_name = user["username"]
        if user["role"] == "doctor":
            profile = query_one("SELECT nombre FROM doctor_profile WHERE user_id = %s", (user["id"],))
            if profile:
                display_name = profile["nombre"]
        else:
            display_name = user["username"]

        token = issue_token(user["id"], user["username"], user["role"])

        return ok({
            "token": token,
            "user": {
                "id": user["id"],
                "username": user["username"],
                "role": user["role"],
                "display_name": display_name,
            },
        })
    except Exception as exc:
        return server_error(exc)