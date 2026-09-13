"""
notify_handler.py — Lambda para envío de correo al doctor vía Resend.

Ruta: POST /matches/{id}/notify  (SOLO admin)

Envía un correo al doctor dueño de la solicitud notificándole que hay
un match disponible para revisar. No cambia ningún estado en la BD —
solo envía el correo. El cambio de status del match a 'enviado' lo
hace /matches/{id}/send como siempre.

Variable de entorno requerida:
    RESEND_API_KEY  →  la API key de Resend

Retorna:
    200 { "sent": true, "to": "email@doctor.com" }
    404 si el match no existe
    500 si Resend falla (con detalle del error)
"""

import os
import json
import html
import urllib.request
import urllib.error

from db import query_one
from auth import get_auth_context, require_role, TokenError
from response import ok, error, not_found, unauthorized, forbidden, server_error, path_param, http_method


RESEND_URL = "https://api.resend.com/emails"
FROM_EMAIL  = "onboarding@resend.dev"


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
            return forbidden("Solo un administrador puede enviar notificaciones.")

        match_id = path_param(event, "id")
        if not match_id:
            return error("Falta el ID del match.", status_code=400, code="MISSING_PARAM")

        if method == "POST":
            return send_notification(match_id)

        return error("Ruta o método no soportado.", status_code=404, code="NOT_FOUND")
    except Exception as exc:
        return server_error(exc)


def send_notification(match_id):
    # Obtener todo lo necesario en una sola query
    data = query_one(
        """
        SELECT
            dp.nombre           AS doctor_nombre,
            dp.email            AS doctor_email,
            p.nombre            AS patient_nombre,
            p.apellido          AS patient_apellido,
            r.tejido_solicitado,
            r.alto_requerido,
            r.ancho_requerido,
            r.fecha_estimada_cirugia,
            i.codigo_visible    AS implante_codigo,
            i.tipo_implante,
            i.alto              AS implante_alto,
            i.ancho             AS implante_ancho,
            m.compatibility_score,
            m.status            AS match_status
        FROM match m
        JOIN request r        ON r.id  = m.request_id
        JOIN patient p        ON p.id  = r.patient_id
        JOIN implant i        ON i.id  = m.implant_id
        JOIN doctor_profile dp ON dp.user_id = r.doctor_id
        WHERE m.id = %s
        """,
        (match_id,),
    )

    if not data:
        return not_found("Match")

    if not data.get("doctor_email"):
        return error(
            "El doctor no tiene correo registrado.",
            status_code=422,
            code="NO_EMAIL",
        )

    api_key = os.environ.get("RESEND_API_KEY", "")
    if not api_key:
        return error(
            "RESEND_API_KEY no configurada en las variables de entorno.",
            status_code=500,
            code="CONFIG_ERROR",
        )

    # Todo lo que viene de la BD (nombres, tejido, etc.) se escapa antes de
    # interpolarlo en el HTML del correo — son campos de texto libre que
    # cargan doctores/admin, no deben poder inyectar markup en el email.
    patient_full_raw = f"{data['patient_nombre']} {data['patient_apellido']}"
    patient_full  = html.escape(patient_full_raw)
    doctor_nombre = html.escape(data["doctor_nombre"])
    tejido        = html.escape(str(data["tejido_solicitado"]))
    implante_cod  = html.escape(str(data["implante_codigo"]))
    tipo_implante = html.escape(str(data["tipo_implante"]))
    score         = data["compatibility_score"]
    fecha_cirugia = str(data["fecha_estimada_cirugia"])

    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
      <div style="background:#1a3a2a;padding:24px 32px;border-radius:8px 8px 0 0">
        <h1 style="color:#ffffff;margin:0;font-size:20px">TissueBank</h1>
        <p style="color:#a3c4b0;margin:4px 0 0;font-size:13px">Sistema de gestión de tejidos</p>
      </div>

      <div style="background:#f9f9f7;padding:32px;border:1px solid #e5e5e0;border-top:none;border-radius:0 0 8px 8px">
        <p style="font-size:15px;margin-top:0">Estimado/a <strong>{doctor_nombre}</strong>,</p>

        <p style="font-size:15px">
          Se ha encontrado un implante compatible para su paciente
          <strong>{patient_full}</strong> y está listo para su revisión.
        </p>

        <div style="background:#ffffff;border:1px solid #ddd;border-radius:6px;padding:20px;margin:24px 0">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr>
              <td style="padding:8px 0;color:#666;width:45%">Paciente</td>
              <td style="padding:8px 0;font-weight:600">{patient_full}</td>
            </tr>
            <tr style="border-top:1px solid #f0f0f0">
              <td style="padding:8px 0;color:#666">Tejido solicitado</td>
              <td style="padding:8px 0;font-weight:600">{tejido}</td>
            </tr>
            <tr style="border-top:1px solid #f0f0f0">
              <td style="padding:8px 0;color:#666">Dimensiones requeridas</td>
              <td style="padding:8px 0;font-weight:600">{data['alto_requerido']} × {data['ancho_requerido']} mm</td>
            </tr>
            <tr style="border-top:1px solid #f0f0f0">
              <td style="padding:8px 0;color:#666">Implante sugerido</td>
              <td style="padding:8px 0;font-weight:600">{implante_cod} — {tipo_implante}</td>
            </tr>
            <tr style="border-top:1px solid #f0f0f0">
              <td style="padding:8px 0;color:#666">Dimensiones del implante</td>
              <td style="padding:8px 0;font-weight:600">{data['implante_alto']} × {data['implante_ancho']} mm</td>
            </tr>
            <tr style="border-top:1px solid #f0f0f0">
              <td style="padding:8px 0;color:#666">Compatibilidad</td>
              <td style="padding:8px 0;font-weight:600;color:#1a6e3c">{score}%</td>
            </tr>
            <tr style="border-top:1px solid #f0f0f0">
              <td style="padding:8px 0;color:#666">Fecha estimada de cirugía</td>
              <td style="padding:8px 0;font-weight:600">{fecha_cirugia}</td>
            </tr>
          </table>
        </div>

        <p style="font-size:14px;color:#555">
          Ingrese al sistema para revisar el match y registrar su aprobación o rechazo.
          El tejido tiene disponibilidad limitada — se recomienda responder a la brevedad.
        </p>

        <p style="font-size:13px;color:#999;margin-bottom:0;margin-top:32px;border-top:1px solid #eee;padding-top:16px">
          Este mensaje fue generado automáticamente por TissueBank. Por favor no responda a este correo.
        </p>
      </div>
    </div>
    """

    payload = {
        "from":    FROM_EMAIL,
        "to":      [data["doctor_email"]],
        "subject": f"TissueBank — Match disponible para {patient_full_raw}",
        "html":    html_body,
    }

    req = urllib.request.Request(
        RESEND_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type":  "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            res.read()
        return ok({"sent": True, "to": data["doctor_email"]})
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        return error(
            f"Resend rechazó el envío: {body}",
            status_code=502,
            code="EMAIL_ERROR",
        )
    except Exception as exc:
        return error(
            f"Error al conectar con Resend: {str(exc)}",
            status_code=502,
            code="EMAIL_ERROR",
        )