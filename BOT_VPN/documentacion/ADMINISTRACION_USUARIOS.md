---
title: "Administración de usuarios"
doc_type: "guia"
status: "verificado"
summary: "Uso del panel administrativo, fichas de usuarios y datos de práctica precargados."
tags: [quantum-fx, administracion, usuarios, datos-de-practica]
last_updated: "2026-11-27"
---

# Administración de usuarios

La pestaña **Usuarios** está disponible para cuentas con rol `ADMIN`. Reúne el estado de las cuentas y la actividad asociada en el almacén local de Node/SQLite o en el almacén Neon del modo alojado.

## Qué muestra

- Resumen de usuarios activos, sesiones vigentes, bots activos o pausados y bots con errores.
- Búsqueda por nombre, usuario o correo; filtros por estado y rol.
- Ficha individual con identidades, bots, cuentas y movimientos financieros recientes.
- La ficha se despliega animada debajo de la tarjeta del usuario seleccionado.
- Aviso visual cuando aparece una nueva solicitud de registro pendiente. El panel consulta cada 30 segundos mientras está abierto.
- Acciones existentes para aprobar, congelar/reactivar o eliminar cuentas, respetando la protección de administradores.

## Datos precargados

El sistema inicializa registros de práctica una sola vez por almacén. El administrador recibe varias identidades, bots, cuentas y movimientos; dos usuarios activos de muestra tienen perfiles de distinta dimensión, mientras otras cuentas ilustran estados pendiente y congelado. La información sintética usa correos `example.com`, etiquetas `SIMULATED` y nombres de práctica. No contiene credenciales de acceso conocidas.

Las cifras y operaciones son simuladas. Las importaciones CSV pertenecen a la sección **Bot** y producen análisis históricos; no son ejecución en un broker. La pantalla de estado de red tampoco demuestra que exista un túnel VPN conectado.

## Uso local

1. Inicia el servidor Node con `npm start` desde `BOT_VPN/`.
2. Entra con una cuenta que tenga rol `ADMIN`.
3. Abre **Usuarios**, busca o filtra una cuenta y selecciona **Ver ficha**.
4. Para probar el alta, registra una cuenta nueva y apruébala desde la lista. Hasta la aprobación no puede iniciar sesión.

La vista **Bot** separa las unidades guardadas de la prueba histórica con CSV. Los bots guardados se abren desde esa lista y llevan a su ficha del panel principal.

Las ventanas de creación y detalle se pueden cerrar con su botón, haciendo clic fuera del contenido o presionando `Esc`. Las confirmaciones se cancelan al cerrarse de esas formas.

## Referencias

- [[documentacion/00_INICIO_OBSIDIAN]]
- [[documentacion/ACCESO_Y_USUARIOS]]
- [[documentacion/02_ESTADO_TECNICO_Y_SALUD]]
- [[documentacion/90_HISTORIAL_DE_CAMBIOS]]
