"""
dispatch_handler.py  —  Lambda #11 para la tabla `dispatch`.

Rutas que atiende:
    GET    /dispatches              -> listar todos (SOLO admin)
    GET    /dispatches/{id}         -> ver uno (SOLO admin)
    PUT    /dispatches/{id}/label   -> por_etiquetar → etiquetado
    PUT    /dispatches/{id}/deliver -> avanza un paso hacia la entrega:
                                       etiquetado → en_camino
                                       en_camino  → entregado

Permisos (confirmados): SOLO admin en todas las rutas.
Los doctores no tienen visibilidad sobre la etapa de despacho — el tracking
físico del envío es operativa interna del banco de tejidos.

Flujo de estados de dispatch:
    por_etiquetar → etiquetado → en_camino → entregado

    /label   cubre el primer paso (etiquetar el paquete físico).
    /deliver cubre los dos pasos siguientes con el mismo endpoint,
             avanzando un estado a la vez desde donde esté el despacho:
               - Si está en 'etiquetado'  → pasa a 'en_camino'
               - Si está en 'en_camino'   → pasa a 'entregado'
             Llamar /deliver cuando el despacho ya está en 'entregado'
             devuelve 409 INVALID_STATE.

Efecto adicional al llegar a 'entregado' (transaccional):
    implant.estado → 'despachado'
    Cierra el ciclo de vida del tejido: de disponible → reservado/asignado
    → despachado, sin posibilidad de reutilizarse para otro match.

Nota de diseño: este handler NO crea filas de dispatch — eso lo hace
assignment_handler/approve en la misma transacción de aprobación. Este
handler solo avanza el estado de despachos que ya existen.
"""

from db import query, query_one, transaction
from auth import get_auth_context, require_role, TokenError
from response import (
    ok, error, not_found, unauthorized, forbidden, server_error,
    path_param, query_param, http_method,
)

DISPATCH_COLUMNS = "id, assignment_id, ips_id, status"

# Mapa de transiciones válidas para /deliver — explícito en vez de calcular
# "estado + 1" para que los estados intermedios queden documentados en código
# y cualquier cambio al flujo sea un cambio visible aquí.
_DELIVER_NEXT = {
    "etiquetado": "en_camino",
    "en_camino":  "entregado",
}


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
            return forbidden("Solo un administrador puede gestionar despachos.")

        raw_path = event.get("rawPath") or event.get("path") or ""
        dispatch_id = path_param(event, "id")

        if method == "GET" and dispatch_id:
            return get_one(dispatch_id)
        if method == "GET":
            return list_all(event)
        if method == "PUT" and dispatch_id and raw_path.endswith("/label"):
            return label_dispatch(dispatch_id)
        if method == "PUT" and dispatch_id and raw_path.endswith("/deliver"):
            return deliver_dispatch(dispatch_id)

        return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")
    except Exception as exc:
        return server_error(exc)


# ============================================================================
# GET /dispatches?status=...
# Filtro opcional por status — útil para la vista "pendientes de etiquetar"
# o "en camino" del panel admin sin traer los 200 registros completos.
# ============================================================================
def list_all(event):
    status_filter = query_param(event, "status")
    if status_filter:
        rows = query(
            f"SELECT {DISPATCH_COLUMNS} FROM dispatch WHERE status = %s ORDER BY id LIMIT 200",
            (status_filter,),
        )
    else:
        rows = query(
            f"SELECT {DISPATCH_COLUMNS} FROM dispatch ORDER BY id LIMIT 200"
        )
    return ok({"data": rows})


# ============================================================================
# GET /dispatches/{id}
# ============================================================================
def get_one(dispatch_id):
    row = query_one(
        f"SELECT {DISPATCH_COLUMNS} FROM dispatch WHERE id = %s",
        (dispatch_id,),
    )
    if not row:
        return not_found("Despacho")
    return ok(row)


# ============================================================================
# PUT /dispatches/{id}/label — por_etiquetar → etiquetado
# Sin efectos en cadena: solo actualiza el estado del despacho.
# ============================================================================
def label_dispatch(dispatch_id):
    dispatch = query_one("SELECT id, status FROM dispatch WHERE id = %s", (dispatch_id,))
    if not dispatch:
        return not_found("Despacho")

    if dispatch["status"] != "por_etiquetar":
        return error(
            f"Solo se puede etiquetar un despacho en estado 'por_etiquetar' "
            f"(estado actual: '{dispatch['status']}').",
            status_code=409,
            code="INVALID_STATE",
        )

    query("UPDATE dispatch SET status = 'etiquetado' WHERE id = %s", (dispatch_id,), fetch=False)
    return ok({"id": dispatch_id, "status": "etiquetado"})


# ============================================================================
# PUT /dispatches/{id}/deliver — avanza un paso: etiquetado → en_camino
#                                                  en_camino  → entregado
#
# Al llegar a 'entregado': transacción que también marca el implante como
# 'despachado' — se hace el JOIN hasta match para obtener el implant_id
# sin necesitar que el caller lo mande en el body.
# ============================================================================
def deliver_dispatch(dispatch_id):
    # JOIN en cadena: dispatch → assignment → match, para obtener implant_id
    # en una sola consulta. Solo se usa si next_status == 'entregado', pero
    # hacerlo siempre evita una segunda query cuando sí hace falta.
    dispatch = query_one(
        """
        SELECT
            d.id        AS id,
            d.status    AS status,
            m.implant_id AS implant_id
        FROM dispatch d
        JOIN assignment a ON a.id = d.assignment_id
        JOIN match m      ON m.id = a.match_id
        WHERE d.id = %s
        """,
        (dispatch_id,),
    )
    if not dispatch:
        return not_found("Despacho")

    next_status = _DELIVER_NEXT.get(dispatch["status"])
    if not next_status:
        # Estado fuera del mapa: ya está en 'entregado' (flujo terminado)
        # o en 'por_etiquetar' (aún no etiquetado — debe pasar por /label primero).
        if dispatch["status"] == "entregado":
            return error(
                "Este despacho ya fue entregado — no hay más pasos posibles.",
                status_code=409,
                code="INVALID_STATE",
            )
        return error(
            f"El despacho debe estar etiquetado antes de poder avanzar "
            f"(estado actual: '{dispatch['status']}'). Usa /label primero.",
            status_code=409,
            code="INVALID_STATE",
        )

    if next_status == "entregado":
        # Transacción: dispatch entregado + implant despachado
        with transaction() as cur:
            cur.execute(
                "UPDATE dispatch SET status = 'entregado' WHERE id = %s",
                (dispatch_id,),
            )
            cur.execute(
                "UPDATE implant SET estado = 'despachado' WHERE id = %s",
                (dispatch["implant_id"],),
            )
    else:
        # Transición intermedia (etiquetado → en_camino): solo dispatch
        query(
            "UPDATE dispatch SET status = %s WHERE id = %s",
            (next_status, dispatch_id),
            fetch=False,
        )

    return ok({"id": dispatch_id, "status": next_status})