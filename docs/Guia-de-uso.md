# Guía de uso de los paneles de TissueBank

[Volver al README](../README.md)

Esta guía sigue el flujo que aparece en la interfaz. Hay dos roles: **doctor**, que crea solicitudes y responde a las propuestas de tejido, y **administrador**, que gestiona cuentas, inventario, recomendaciones, asignaciones y despachos. Los datos se consultan y guardan mediante la API configurada en `Data.js`.

## Antes de empezar

1. Abre `Index.html` con un servidor estático, por ejemplo **Live Server** en VS Code.
2. En **Iniciar sesión**, escribe el usuario y la contraseña de tu rol y pulsa **Entrar**. La pantalla muestra credenciales de demostración para doctor y administrador.
3. Usa el menú lateral para cambiar de panel. El botón **ⓘ** junto al título de cada panel muestra una explicación breve dentro de la aplicación.

> La interfaz local está conectada al API Gateway configurado en `Data.js`. Crear solicitudes, doctores o implantes desde ella puede modificar los datos del entorno al que apunta esa API.

## Recorrido del doctor

### Solicitantes: crear y seguir una solicitud

1. Entra en **Solicitantes** y pulsa **Nueva solicitud**.
2. Completa los datos obligatorios del paciente: tipo y número de identificación, nombre, apellido y sexo biológico. Si el sexo del donante no debe restringir el match, marca **No es importante — aceptar donante de cualquier sexo**.
3. Indica el nombre de la IPS y el tejido solicitado. Agrega la fecha estimada de cirugía y las tres dimensiones requeridas en milímetros: altura, ancho transversal y AP (anteroposterior). Puedes completar también los campos opcionales.
4. Pulsa **Enviar solicitud**. Si falta un dato obligatorio, el formulario lo señalará.
5. Consulta **Mis solicitudes → Activas** para seguir el estado y **Historial** para ver las solicitudes anteriores. Pulsa una fila para abrir su detalle.

### Solicitantes: responder a un match

1. Cuando el administrador envíe una recomendación, abre **Solicitantes → Match por aprobar**.
2. Despliega la tarjeta del match y revisa el implante propuesto, sus dimensiones, el porcentaje de compatibilidad y los datos del donante.
3. Pulsa **Aceptar implante** o **Rechazar**. Al rechazar, puedes indicar un motivo. Si aceptas, el caso pasa a la aprobación final del administrador en **Asignaciones**.

### Mi perfil

1. Abre **Mi perfil** para revisar cédula, nombre, teléfono y correo.
2. Actualiza los datos necesarios y pulsa **Guardar cambios**.

## Recorrido del administrador

### Doctores: dar acceso

1. Abre **Doctores** y pulsa **Nuevo doctor**.
2. Ingresa cédula, nombre y usuario; completa teléfono y correo cuando corresponda. Pulsa **Crear cuenta**.
3. Copia el usuario y la contraseña temporal que aparecen después de crear la cuenta: la contraseña se muestra una sola vez.
4. En la tabla de doctores, usa **Editar** para actualizar el perfil o restablecer la contraseña. Usa el control **Activar/Desactivar** para cambiar el acceso sin borrar el historial.

### Solicitudes: revisar la demanda

1. Entra en **Solicitudes** para ver los casos de todos los doctores.
2. Revisa las pestañas **Activas** e **Historial**, los estados y el doctor de cada caso. Pulsa una fila para ver su detalle. Este panel es de consulta.

### Tejidos: registrar inventario

1. Abre **Tejidos** y pulsa **Registrar donante / implante**.
2. Escribe el código del donante, la fecha de extracción y su sexo biológico. El vencimiento se calcula automáticamente a 14 días desde la extracción y aplica a todos sus implantes.
3. En **Implantes de este donante**, completa código, parte del cuerpo, tipo y las tres dimensiones en milímetros. Pulsa **Agregar implante a esta lista**. Repite el paso para cada implante; puedes editarlo o quitarlo de la lista antes de guardar.
4. Pulsa **Guardar donante e implantes**. Revisa **Inventario disponible**, **Por vencer** e **Historial de donantes** para consultar el resultado. Desde las tarjetas del inventario puedes abrir el detalle y editar datos del donante o implante, o agregar otro implante al donante.

### Recomendaciones: encontrar y enviar matches

1. Abre **Recomendaciones** y pulsa **Ejecutar motor de matching** para buscar implantes compatibles con las solicitudes activas.
2. En **Por enviar**, despliega cada propuesta y revisa la compatibilidad y los datos del donante. Pulsa **Enviar match al doctor** cuando corresponda.
3. En **Esperando doctor**, sigue las propuestas enviadas. Puedes usar **Reenviar correo** o **Cancelar envío**.
4. Consulta **Historial** para ver las respuestas y los matches ya tramitados.

### Asignaciones: dar aprobación final

1. Abre **Asignaciones**. La sección **Pendientes — doctor ya confirmó** muestra las propuestas aceptadas por el doctor.
2. Revisa paciente, implante, compatibilidad, IPS y fecha de cirugía. Pulsa **Aprobar y asignar** para crear el despacho, o **Rechazar**.
3. Consulta **Historial de asignaciones** para ver las decisiones registradas.

### Etiquetado: preparar y cerrar el despacho

1. En **Etiquetado → Por etiquetar**, revisa la etiqueta generada con paciente, tejido, donante, IPS y médico.
2. Pulsa **Imprimir etiqueta** si necesitas una copia física. Luego pulsa **Marcar como en camino**; la interfaz registra el etiquetado y mueve el despacho a la pestaña **En camino**.
3. En **En camino**, pulsa **Marcar como entregado** cuando la IPS reciba el tejido.
4. Usa **Entregados** para consultar los despachos finalizados.

## Orden habitual de un caso

**Doctor:** Solicitantes (nueva solicitud) → Solicitantes (aceptar o rechazar match).  
**Administrador:** Tejidos → Solicitudes → Recomendaciones → Asignaciones → Etiquetado.

Si no hay casos en una pestaña, verifica que se haya completado el paso anterior del flujo y que estés usando el rol correspondiente.
