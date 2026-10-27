# Pendientes y mejoras del proyecto BOT_VPN

**Actualizado:** 2026-10-25
**Estado general:** aplicación local en modo `SIMULATED`. No está conectada a Rithmic ni a otro broker y no está lista para operar con dinero real.

Este documento resume el trabajo pendiente de forma práctica. No reemplaza el [plan detallado de implementación](./IMPLEMENTATION_PLAN.md) ni las instrucciones para ejecutar el sistema en el [README](./README.md).

## Estado actual resumido

- **Arranque y configuración:** Node.js sirve el panel en `127.0.0.1:3008`; FastAPI es un servidor independiente en `127.0.0.1:8000`. Sus APIs tienen diferencias y no deben tratarse como equivalentes.
- **Autenticación y validación:** ambas APIs tienen sesiones temporales y validaciones de entrada. La autenticación actual está pensada para desarrollo local, no para producción.
- **Persistencia:** ambos procesos comparten SQLite, migraciones, auditoría básica y registro de operaciones simuladas. Hay control de conflicto de escritura y utilidades de backup/restore.
- **Riesgo:** el motor local tiene límites de demostración, deduplicación de señales identificadas y controles de emergencia. Estos controles no han sido validados frente a un broker.
- **Modos:** `SIMULATED` está implementado; `PAPER` sigue deshabilitado y responde `501`; `LIVE` no está implementado.
- **Salud:** ambos procesos exponen `GET /healthz` para comprobar SQLite. Este endpoint no verifica el broker ni precios de mercado reales.
- **Arranque FastAPI en Windows:** `run_fastapi.ps1` crea `.venv`, instala las dependencias faltantes y usa ese intérprete para iniciar el gateway; `run_fastapi.bat` permite arrancarlo desde el Explorador.
- **Validación conocida:** la suite ejecutada más recientemente pasó 1 prueba de Node y 19 de Python. Debe repetirse tras cada cambio; no equivale a certificación de producción o de broker.
- **Rithmic:** su documentación pública anuncia opciones de prueba, pero faltan el kit oficial y la confirmación de acceso, permisos y condiciones aplicables a este proyecto y a la cuenta asociada a Lucid.

## Prioridad 0 — Mantener la operación segura

1. **No activar operaciones en vivo.**
   - Mantener el modo `LIVE` ausente y `PAPER` deshabilitado hasta que el adaptador y sus controles estén implementados y probados.
   - No enviar órdenes reales durante desarrollo ni usar credenciales de producción en las pruebas.
   - Mantener claramente etiquetados los precios, posiciones, balances, estado de conectividad y cierres simulados.

2. **Confirmar autorización de Rithmic/Lucid antes de integrar.**
   - Preguntar a Lucid si la cuenta permite conexiones de software propio por Rithmic API.
   - Solicitar a Rithmic el kit de desarrollo y la documentación oficial para el entorno de prueba autorizado.
   - Confirmar por escrito el sistema de prueba, permisos, instrumentos, límites, requisitos de conformance y condiciones de uso.
   - No asumir que una cuenta de Level 2 o una cuenta de evaluación incluye acceso de API.

3. **Respetar las reglas de red del proveedor.**
   - Documentar los destinos y rutas permitidos.
   - No rotar IPs, ocultar identidades ni crear VPN/túneles para eludir detección, controles o restricciones.
   - Usar VPN únicamente si el broker y el operador la autorizan expresamente.

## Prioridad 1 — Terminar la validación de riesgo y modo paper

Bloqueada en parte por el acceso autorizado al entorno de prueba de Rithmic.

- Probar en sandbox los flujos de conexión, desconexión, recuperación, rechazo, cancelación, fills y estados de órdenes.
- Implementar un adaptador aislado detrás de una interfaz común; no mezclar su lógica con el motor `SIMULATED`.
- Definir estados explícitos para órdenes pendientes, aceptadas, rechazadas, parcialmente ejecutadas, ejecutadas y canceladas.
- Hacer que los reintentos sean idempotentes también entre procesos y reinicios; la protección actual con `signal_id` no constituye una garantía distribuida entre varios workers.
- Asegurar que kill switch y cierre informen una confirmación únicamente cuando el sandbox la devuelva; una solicitud enviada no equivale a una posición cerrada.
- Probar límites de cuenta y globales, pérdidas, exposición, órdenes repetidas, datos atrasados y recuperación después de reiniciar el proceso.
- Mantener `PAPER` deshabilitado hasta que las pruebas de aceptación del adaptador pasen en el entorno oficial.

**Criterio de aceptación:** pruebas automatizadas contra simulador/mocks para fallos y contratos del adaptador, más pruebas autorizadas contra sandbox; sin operaciones de producción ni falsos estados de éxito.

## Prioridad 2 — Endurecer la seguridad para un uso compartido o productivo

La protección actual sirve como base local; antes de exponer o desplegar los servicios falta:

- implementar roles y permisos efectivos por acción (RBAC); actualmente el rol guardado no equivale a autorización granular;
- adoptar almacenamiento seguro de secretos, rotación y separación por entorno; no persistir contraseñas o tokens en archivos, snapshots, respuestas ni logs;
- revisar sesiones, CSRF, XSS, seguridad de cookies y límites de login; definir controles adecuados al tipo de despliegue;
- añadir TLS y controles de acceso de red si los servicios dejan de ser exclusivamente locales;
- evaluar limitación de tasa adecuada y, si hay varias instancias, coordinada entre procesos;
- realizar revisión de seguridad independiente y corregir los hallazgos antes de cualquier despliegue;
- verificar que auditoría y logs no registren credenciales, tokens, datos sensibles o respuestas completas del broker.

**Criterio de aceptación:** pruebas de autorización por rol, sesiones y revocación, entradas malformadas, fuga de secretos y configuración de despliegue; ninguna ruta sensible accesible de forma anónima.

## Prioridad 3 — Infraestructura y observabilidad

Ya existe un `GET /healthz` básico en cada servidor que verifica SQLite. Falta:

- crear Docker Compose solo para los servicios que realmente se desplieguen y documentar variables, volúmenes, puertos y apagado;
- configurar health checks de contenedor usando `/healthz`, manteniendo los servicios enlazados a localhost en desarrollo;
- probar el arranque reproducible de ambos servicios desde Windows en una instalación limpia;
- añadir logs estructurados con niveles y contexto útil, sin secretos ni contenido sensible;
- definir métricas y alertas para disponibilidad, errores, latencia, base de datos y fallos del adaptador cuando exista;
- distinguir en cada comprobación la salud del proceso, persistencia, datos de mercado y broker; no marcar componentes externos como saludables si no se comprobaron;
- documentar backup, restauración y una prueba periódica de recuperación;
- probar apagado ordenado, reinicio, base de datos bloqueada y caída/recuperación de dependencias.

**Criterio de aceptación:** arranque reproducible en Windows y en el entorno de despliegue elegido; health checks que fallen correctamente; recuperación comprobada y documentación actualizada.

## Prioridad 4 — Unificar la experiencia del panel

Node y FastAPI siguen siendo servidores independientes con rutas y modelos distintos. Para evitar información contradictoria:

- elegir y documentar cuál servidor será la fuente principal para el panel;
- definir contratos API compartidos para bots, cuentas, riesgos, auditoría, órdenes y estados;
- mantener compatibilidad o retirar rutas duplicadas de forma gradual, con pruebas que detecten diferencias;
- mostrar de forma visible `SIMULATED`, `PAPER` o el estado no disponible; nunca representar datos simulados como reales;
- mostrar errores, antigüedad de datos, desconexiones y órdenes pendientes;
- distinguir una acción solicitada de una acción confirmada por el simulador o el broker;
- revisar que los controles de emergencia expliquen si son simulados o confirmados.

**Criterio de aceptación:** el panel y el gateway presentan el mismo estado persistido y el mismo modo; errores y estados no confirmados no aparecen como éxito.

## Prioridad 5 — Persistencia, auditoría y operación

- Añadir consulta y filtros para `audit_events` y `operations`, con política de retención documentada.
- Probar conflictos de escritura cuando Node y FastAPI modifican datos a la vez y definir una UX de recarga/reintento.
- Revisar la idempotencia de operaciones para concurrencia y recuperación después de reiniciar.
- Documentar límites de SQLite y medir la concurrencia requerida antes de decidir si se necesita otro motor de base de datos.
- Verificar backups y restauraciones con datos de prueba, y conservar la base original durante la recuperación.
- Probar las versiones mínimas declaradas (Node.js `22.13+` y Python `3.10+`); la suite reciente no certifica todas esas versiones.

## Orden recomendado

1. Obtener confirmación de acceso y reglas de Rithmic/Lucid; mientras tanto, mantener simulación únicamente.
2. Completar pruebas locales de persistencia, salud, seguridad y arranque en las versiones mínimas.
3. Añadir infraestructura reproducible y observabilidad sin abrir los servicios a Internet.
4. Unificar contratos y estados que consume el panel.
5. Implementar el adaptador solo con documentación y sandbox autorizados.
6. Validar riesgo, fallos, recuperación e idempotencia en sandbox.
7. Revisar seguridad y criterios operativos antes de considerar cualquier uso fuera de desarrollo.

El último paso **no habilita automáticamente el trading en vivo**. Cualquier consideración de producción requiere autorización del broker, pruebas documentadas, revisión de seguridad y una decisión explícita posterior.
