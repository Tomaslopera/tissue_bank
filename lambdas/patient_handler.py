"""
patient_handler.py — Lambda para la tabla `patient`.

Rutas que atiende:
    POST   /patients          -> crear paciente
    GET    /patients          -> listar (con búsqueda opcional por identificación)
    GET    /patients/{id}     -> ver uno
    PUT    /patients/{id}     -> editar — NUNCA tipo_identificacion ni numero_identificacion

Acceso: cualquier usuario autenticado (doctor o admin), no solo admin —
un doctor necesita poder registrar pacientes nuevos al crear una solicitud
desde su propio panel.

Decisión de negocio (confirmada explícitamente): la identificación de un
paciente (tipo + número) queda fija una vez creado el registro. Si hubo un
error de tipeo al capturarla, la corrección se hace por otro medio (no por
este endpoint) — así se evita que alguien "reescriba" por accidente la
identidad de un paciente que ya tiene solicitudes asociadas.

Nota de diseño: aquí NO se hace "crear o reusar si ya existe" (eso vive en
request_handler, que es quien de verdad necesita esa lógica al montar una
solicitud completa). Este handler es el CRUD directo de la tabla.
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

        if not require_role(auth_payload, "admin", "doctor"):
            return unauthorized("Debes iniciar sesión para hacer esto.")

        patient_id = path_param(event, "id")

        if method == "POST":
            return create_patient(event)
        if method == "GET" and patient_id:
            return get_one(patient_id)
        if method == "GET":
            return list_all(event)
        if method == "PUT" and patient_id:
            return update_patient(patient_id, event)

        return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")
    except Exception as exc:
        return server_error(exc)


# ============================================================================
# POST /patients
# ============================================================================
def create_patient(event):
    body = parse_body(event)
    missing = require_fields(body, ["tipo_identificacion", "numero_identificacion", "nombre", "apellido", "sexo_biologico"])
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    if body["sexo_biologico"] not in ("M", "F"):
        return error("sexo_biologico debe ser 'M' o 'F'.", fields={"sexo_biologico": "Valor inválido"})

    existing = query_one(
        "SELECT id FROM patient WHERE tipo_identificacion = %s AND numero_identificacion = %s",
        (body["tipo_identificacion"], body["numero_identificacion"]),
    )
    if existing:
        return error(
            "Ya existe un paciente registrado con esa identificación.",
            status_code=409,
            code="PATIENT_ALREADY_EXISTS",
            fields={"numero_identificacion": "Ya está registrado"},
        )

    row = query_one(
        """
        INSERT INTO patient
            (tipo_identificacion, numero_identificacion, nombre, apellido, fecha_nacimiento, edad, nacionalidad, sexo_biologico)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        RETURNING id, tipo_identificacion, numero_identificacion, nombre, apellido, fecha_nacimiento, edad, nacionalidad, sexo_biologico
        """,
        (
            body["tipo_identificacion"],
            body["numero_identificacion"],
            body["nombre"].strip(),
            body["apellido"].strip(),
            body.get("fecha_nacimiento"),
            body.get("edad"),
            body.get("nacionalidad"),
            body["sexo_biologico"],
        ),
    )
    return created(row)


# ============================================================================
# GET /patients?search=... — busca por numero_identificacion o nombre/apellido
# ============================================================================
def list_all(event):
    search = query_param(event, "search")
    if search:
        rows = query(
            """
            SELECT id, tipo_identificacion, numero_identificacion, nombre, apellido, fecha_nacimiento, edad, nacionalidad, sexo_biologico
            FROM patient
            WHERE numero_identificacion ILIKE %s
               OR nombre ILIKE %s
               OR apellido ILIKE %s
            ORDER BY apellido, nombre
            LIMIT 20
            """,
            (f"%{search}%", f"%{search}%", f"%{search}%"),
        )
    else:
        rows = query(
            """
            SELECT id, tipo_identificacion, numero_identificacion, nombre, apellido, fecha_nacimiento, edad, nacionalidad, sexo_biologico
            FROM patient
            ORDER BY apellido, nombre
            LIMIT 100
            """
        )
    return ok({"data": rows})


# ============================================================================
# GET /patients/{id}
# ============================================================================
def get_one(patient_id):
    row = query_one(
        "SELECT id, tipo_identificacion, numero_identificacion, nombre, apellido, fecha_nacimiento, edad, nacionalidad, sexo_biologico "
        "FROM patient WHERE id = %s",
        (patient_id,),
    )
    if not row:
        return not_found("Paciente")
    return ok(row)


# ============================================================================
# PUT /patients/{id} — nombre/apellido/fecha_nacimiento/edad/nacionalidad.
# tipo_identificacion y numero_identificacion NUNCA se aceptan aquí, aunque
# vengan en el body — se ignoran silenciosamente por diseño (ver docstring).
# ============================================================================
def update_patient(patient_id, event):
    body = parse_body(event)
    missing = require_fields(body, ["nombre", "apellido"])
    if missing:
        return error("Faltan campos obligatorios.", fields=missing)

    if "sexo_biologico" in body and body["sexo_biologico"] not in ("M", "F"):
        return error("sexo_biologico debe ser 'M' o 'F'.", fields={"sexo_biologico": "Valor inválido"})

    existing = query_one("SELECT id, sexo_biologico FROM patient WHERE id = %s", (patient_id,))
    if not existing:
        return not_found("Paciente")

    query(
        """
        UPDATE patient
        SET nombre = %s, apellido = %s, fecha_nacimiento = %s, edad = %s, nacionalidad = %s, sexo_biologico = %s
        WHERE id = %s
        """,
        (
            body["nombre"].strip(),
            body["apellido"].strip(),
            body.get("fecha_nacimiento"),
            body.get("edad"),
            body.get("nacionalidad"),
            body.get("sexo_biologico", existing["sexo_biologico"]),
            patient_id,
        ),
        fetch=False,
    )
    return ok({"id": patient_id, "updated": True})