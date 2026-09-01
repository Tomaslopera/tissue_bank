"""
match_engine_handler.py — Lambda #12 — Motor de matching.

Ruta: POST /matches/run  (SOLO admin)

Recorre todas las solicitudes activas sin assignment aprobado, busca
implantes compatibles y crea registros de match en estado 'detectado'.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALGORITMO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Filtros obligatorios (excluyen el par si no se cumplen):
  1. implant.estado = 'disponible'
  2. implant.tipo_implante "calza" con request.tejido_solicitado — comparación
     normalizada (sin tildes, sin distinción de mayúsculas, por palabras) para
     no depender de que el doctor haya tecleado el tejido exactamente igual
     al catálogo de implantes: "Fémur" hace match con "Femur", "Femur Distal",
     "FÉMUR DISTAL", etc. Ver _tissue_matches más abajo.
  3. implant.alto         >= request.alto_requerido         - 5  (rango máximo de déficit: 5 mm)
  4. implant.ancho        >= request.ancho_requerido        - 5  (ídem)
  5. implant.profundidad  >= request.profundidad_requerida  - 5  (ídem, AP/anteroposterior)
  6. Si request.sexo_importante: donor.sexo_biologico == patient.sexo_biologico
  7. No existe ya un match activo para (request_id, implant_id)

Nota sobre implant.profundidad: es una columna agregada después de que varios
implantes ya existían (migración 2026-08-26), así que puede venir NULL en
inventario viejo. Se trata igual que alto/ancho ya trataban un valor
faltante — ver _dim_score/el uso de `or 0` más abajo — para no tener que
distinguir un caso especial: un implante sin profundidad cargada
simplemente no calza con casi ninguna solicitud hasta que se edite y se le
cargue el dato.

Scoring — cada componente vale entre 0 y 100, ponderados así:

  compatibility_alto        →  25 %
  compatibility_ancho       →  25 %
  compatibility_profundidad →  25 %
  frescura del tejido       →  15 %   (días restantes / vida útil total × 100)
  bonus sexo coincide       →  10 %   (aplicable aunque sexo_importante = false)

  Score mínimo para crear match: 60
  Máximo candidatos creados por solicitud: 3 (los de mayor score)

Nota sobre la "edad":
  El schema de donor no almacena fecha de nacimiento del donante, por lo que
  la edad del tejido se modela como frescura: un tejido recién extraído
  (fecha_extraccion = hoy) obtiene 100 % en este componente; uno a punto de
  vencer obtiene 0 %.  Tejidos vencidos quedan en estado 'vencido' y ya son
  excluidos por el filtro de estado = 'disponible'.

Scoring de dimensión (función _dim_score):
  diff = implant_dim - request_dim
  diff >= 0 → implante más grande (ideal): score = max(70, 100 - diff × 2)
  diff <  0 → implante más pequeño (riesgo, dentro de rango):
              score = 100 + diff × 10
              diff -1 → 90 | -2 → 80 | -3 → 70 | -4 → 60 | -5 → 50

Retorna:
  { created, requests_processed, implants_evaluated }
"""

import unicodedata
from datetime import date
from db import query, transaction
from auth import get_auth_context, require_role, TokenError
from response import ok, error, unauthorized, forbidden, server_error, http_method

MIN_SCORE          = 60.0
MAX_PER_REQUEST    = 3


def _normalize_tissue(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode("ascii")
    return s.strip().lower()


def _tissue_matches(implant_tipo, request_tejido):
    """
    Compara tipo_implante (catálogo, ej. "Fémur") contra tejido_solicitado
    (texto libre que escribe el doctor, ej. "Femur Distal") sin exigir
    igualdad exacta: normaliza tildes/mayúsculas y hace match si el
    conjunto de palabras de uno es subconjunto del otro. Así "femur",
    "Femur Distal" y "FÉMUR" calzan todos con el implante "Fémur".
    """
    a_tokens = set(_normalize_tissue(implant_tipo).split())
    b_tokens = set(_normalize_tissue(request_tejido).split())
    if not a_tokens or not b_tokens:
        return False
    return a_tokens.issubset(b_tokens) or b_tokens.issubset(a_tokens)


def lambda_handler(event, context):
    try:
        if http_method(event) == "OPTIONS":
            return ok({})

        try:
            auth_payload = get_auth_context(event)
        except TokenError as exc:
            return unauthorized(str(exc))

        if auth_payload is None:
            return unauthorized("Debes iniciar sesión para hacer esto.")
        if not require_role(auth_payload, "admin"):
            return forbidden("Solo un administrador puede ejecutar el motor de matching.")

        if http_method(event) == "POST":
            return run_engine()

        return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")
    except Exception as exc:
        return server_error(exc)


def run_engine():
    today = date.today()

    # Solicitudes activas: sin assignment aprobado todavía
    requests = query(
        """
        SELECT
            r.id,
            r.tejido_solicitado,
            r.alto_requerido,
            r.ancho_requerido,
            r.profundidad_requerida,
            r.sexo_importante,
            p.sexo_biologico AS patient_sexo
        FROM request r
        JOIN patient p ON p.id = r.patient_id
        WHERE NOT EXISTS (
            SELECT 1
            FROM assignment a
            JOIN match m ON m.id = a.match_id
            WHERE m.request_id = r.id
              AND a.status = 'aprobada'
        )
        """
    )

    # Implantes disponibles con datos del donante
    implants = query(
        """
        SELECT
            i.id,
            i.tipo_implante,
            i.alto,
            i.ancho,
            i.profundidad,
            d.sexo_biologico  AS donor_sexo,
            d.fecha_extraccion,
            d.fecha_vencimiento
        FROM implant i
        JOIN donor d ON d.id = i.donor_id
        WHERE i.estado = 'disponible'
        """
    )

    # Pares ya activos — no se duplican
    existing = set()
    for m in query(
        """
        SELECT request_id, implant_id FROM match
        WHERE status NOT IN ('rechazado_doctor', 'rechazado_admin', 'invalidado')
        """
    ):
        existing.add((m["request_id"], m["implant_id"]))

    created            = 0
    implants_evaluated = 0

    for req in requests:
        candidates = []

        for imp in implants:
            implants_evaluated += 1

            # — Filtro 1: tipo de tejido (comparación normalizada, no exacta)
            if not _tissue_matches(imp["tipo_implante"], req["tejido_solicitado"]):
                continue

            # — Filtro 2: dimensiones dentro del rango de 5 mm
            alto_diff        = (imp["alto"]        or 0) - req["alto_requerido"]
            ancho_diff       = (imp["ancho"]       or 0) - req["ancho_requerido"]
            profundidad_diff = (imp["profundidad"] or 0) - req["profundidad_requerida"]
            if alto_diff < -5 or ancho_diff < -5 or profundidad_diff < -5:
                continue

            # — Filtro 3: sexo (solo cuando es clínicamente relevante)
            if req["sexo_importante"] and imp["donor_sexo"] != req["patient_sexo"]:
                continue

            # — Filtro 4: par sin match activo
            if (req["id"], imp["id"]) in existing:
                continue

            # — Scoring
            alto_score        = _dim_score(alto_diff)
            ancho_score       = _dim_score(ancho_diff)
            profundidad_score = _dim_score(profundidad_diff)
            fresh_score       = _freshness(imp["fecha_extraccion"], imp["fecha_vencimiento"], today)
            sex_bonus         = 10.0 if imp["donor_sexo"] == req["patient_sexo"] else 0.0

            overall = round(
                0.25 * alto_score +
                0.25 * ancho_score +
                0.25 * profundidad_score +
                0.15 * fresh_score +
                0.10 * sex_bonus,
                2,
            )

            if overall < MIN_SCORE:
                continue

            candidates.append({
                "implant_id":        imp["id"],
                "score":             overall,
                "alto_score":        round(alto_score, 2),
                "ancho_score":       round(ancho_score, 2),
                "profundidad_score": round(profundidad_score, 2),
            })

        # Tomar los 3 mejores candidatos para esta solicitud
        candidates.sort(key=lambda c: c["score"], reverse=True)

        for c in candidates[:MAX_PER_REQUEST]:
            try:
                with transaction() as cur:
                    cur.execute(
                        """
                        INSERT INTO match
                            (request_id, implant_id, compatibility_score,
                             compatibility_alto, compatibility_ancho, compatibility_profundidad, status)
                        VALUES (%s, %s, %s, %s, %s, %s, 'detectado')
                        """,
                        (
                            req["id"],
                            c["implant_id"],
                            c["score"],
                            c["alto_score"],
                            c["ancho_score"],
                            c["profundidad_score"],
                        ),
                    )
                created += 1
                existing.add((req["id"], c["implant_id"]))
            except Exception:
                # Conflicto de unique constraint (carrera entre ejecuciones): ignorar
                pass

    return ok({
        "created":            created,
        "requests_processed": len(requests),
        "implants_evaluated": implants_evaluated,
    })


def _dim_score(diff):
    """
    diff = implant_dim - request_dim

    Positivo (implante más grande que lo requerido):
      Ideal clínicamente — se puede recortar el exceso.
      Penalización leve: -2 pts por mm de exceso, mínimo 70.

    Negativo (implante más pequeño, dentro del rango de ±5 mm):
      Riesgo clínico mayor — penalización más fuerte: -10 pts por mm de déficit.
      diff -1 → 90 | -2 → 80 | -3 → 70 | -4 → 60 | -5 → 50
    """
    if diff >= 0:
        return max(70.0, 100.0 - diff * 2.0)
    return 100.0 + diff * 10.0


def _freshness(fecha_extraccion, fecha_vencimiento, today):
    """
    Frescura del tejido: porcentaje de vida útil restante.
    Tejido recién extraído = 100. Próximo a vencer = cercano a 0.
    """
    if not fecha_extraccion or not fecha_vencimiento:
        return 50.0
    total     = (fecha_vencimiento - fecha_extraccion).days
    remaining = (fecha_vencimiento - today).days
    if total <= 0:
        return 0.0
    return max(0.0, min(100.0, (remaining / total) * 100.0))