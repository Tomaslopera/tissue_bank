# TissueBank — Sistema de Asignación Automatizada de Tejidos (SAAT)

## Contexto

TissueBank es una empresa colombiana dedicada a la distribución de tejidos ortopédicos donados a médicos cirujanos. El proceso anterior operaba completamente en papel, Excel y WhatsApp. Este proyecto digitaliza y automatiza ese flujo de principio a fin.

---

## Arquitectura

**Serverless en AWS + Supabase**

| Capa | Tecnología |
|---|---|
| Frontend | HTML / CSS / JavaScript estático |
| Backend | 13 AWS Lambda (Python 3.12) |
| API | AWS API Gateway (HTTP API) |
| Base de datos | PostgreSQL en Supabase |
| Notificaciones | Resend (correo electrónico) |
| Despliegue frontend | Netlify |

---

## Base de datos (Supabase / PostgreSQL)

9 tablas relacionales con integridad referencial completa:

- `app_user` — usuarios del sistema (admin y doctores)
- `doctor_profile` — perfil clínico del doctor (cédula, email, teléfono)
- `patient` — pacientes registrados
- `ips` — instituciones prestadoras de salud
- `donor` — donantes con fechas de extracción y vencimiento
- `implant` — tejidos individuales asociados a cada donante
- `request` — solicitudes médicas de tejido
- `match` — resultado del motor de matching
- `assignment` — aprobación de la asignación
- `dispatch` — gestión del despacho físico

---

## Lambdas construidas (13)

| # | Nombre | Responsabilidad |
|---|---|---|
| 1 | auth_login_handler | Autenticación JWT |
| 2 | doctor_handler | CRUD de doctores |
| 3 | patient_handler | CRUD de pacientes |
| 4 | ips_handler | CRUD de IPS |
| 5 | donor_handler | CRUD de donantes |
| 6 | implant_handler | CRUD de implantes |
| 7 | request_handler | CRUD de solicitudes médicas |
| 8 | request_status_handler | Estado derivado de la solicitud y pipeline |
| 9 | match_handler | Gestión de matches (enviar, cancelar, respuesta del doctor) |
| 10 | assignment_handler | Aprobación/rechazo de asignaciones |
| 11 | dispatch_handler | Etiquetado y entrega de despachos |
| 12 | match_engine_handler | Motor de matching automatizado |
| 13 | notify_handler | Envío de correo al doctor vía Resend |

---

## Roles de usuario

| Rol | Acceso |
|---|---|
| Admin | Todo el sistema — solicitudes, tejidos, matches, asignaciones, despachos |
| Doctor | Sus propias solicitudes, matches pendientes de su aprobación |

---

## Flujo completo del proceso

```
1. Doctor crea solicitud médica con tipo de tejido y dimensiones requeridas
2. Admin registra donante e implantes con dimensiones y estado
3. Admin ejecuta el motor de matching (POST /matches/run)
4. Motor evalúa compatibilidad: tipo de tejido, dimensiones ±5mm, sexo si aplica, frescura del tejido
5. Admin revisa matches detectados y envía notificación al doctor (correo real vía Resend)
6. Doctor aprueba o rechaza el match desde su panel
7. Admin aprueba la asignación → se crea el despacho automáticamente
8. Admin etiqueta el despacho → marca en camino → marca entregado
```

---

## Motor de matching

Algoritmo de scoring ponderado (score mínimo: 60/100):

| Factor | Peso |
|---|---|
| Compatibilidad alto (mm) | 35% |
| Compatibilidad ancho (mm) | 35% |
| Frescura del tejido (días restantes / vida útil) | 20% |
| Coincidencia de sexo donante-paciente | 10% |

**Filtros obligatorios:** tipo de tejido exacto, dimensiones dentro de ±5mm, sexo del donante cuando `sexo_importante = true`, implante en estado `disponible`, sin match activo previo para ese par.

Se generan máximo 3 candidatos por solicitud, ordenados por score descendente.

---

## Notificaciones

Al enviar un match al doctor (`POST /matches/{id}/notify`), se envía un correo real con:
- Nombre del paciente
- Tejido solicitado y dimensiones
- Código y tipo del implante sugerido
- Score de compatibilidad
- Fecha estimada de cirugía

Servicio: **Resend** (`onboarding@resend.dev`). Los correos de destino deben estar registrados como contactos en la cuenta de Resend.

---

## Estados del pipeline

**Match:** `detectado → enviado → aprobado_doctor / rechazado_doctor → aprobado_admin / rechazado_admin / invalidado`

**Assignment:** `pendiente → aprobada / rechazada`

**Dispatch:** `por_etiquetar → etiquetado → en_camino → entregado`

---

## Layer compartido

Todas las Lambdas comparten un Layer (`tissuebank-shared-layer`) con tres módulos:

- `db.py` — conexión a PostgreSQL con psycopg2, helpers `query`, `query_one`, `transaction`
- `auth.py` — generación y verificación de tokens JWT
- `response.py` — helpers de respuesta HTTP estandarizados

---

## API Gateway

HTTP API con CORS habilitado (`*`). Rutas organizadas por entidad, cada una integrada a su Lambda correspondiente. Contraseñas en texto plano (decisión de demo). Tokens JWT con expiración de 72 horas.