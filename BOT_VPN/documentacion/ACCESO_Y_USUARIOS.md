---
title: "Acceso y usuarios de QUANTUM FX"
doc_type: "referencia"
status: "verificado"
summary: "Lista de usuarios y estados consultados en producción, con indicaciones seguras para administrar el acceso."
tags: [quantum-fx, acceso, usuarios, administracion]
last_updated: "2026-11-26"
---

# Acceso y usuarios de QUANTUM FX

Listado consultado desde la administración de producción el 2026-11-26. Solo se guardan nombres de usuario, roles y estados.

| Usuario | Rol | Estado |
| --- | --- | --- |
| `V8` | Administrador | Activo |
| `juan` | Usuario | Activo |
| `lucas.romero` | Usuario | Activo |
| `camila.torres` | Usuario | Activo |
| `martin.silva` | Usuario | Pendiente |
| `sofia.mendez` | Usuario | Pendiente |
| `nicolas.vega` | Usuario | Congelado |

## Contraseñas

Las contraseñas no se guardan en esta nota ni en otros archivos del repositorio. La contraseña inicial del administrador se gestiona con la variable sensible `BOT_VPN_ADMIN_PASSWORD` en las variables de entorno de Vercel. Para cambiarla, actualiza esa variable y despliega de nuevo; el servidor sincroniza el hash de la cuenta administradora al iniciar.

## Verificación

- El inicio de sesión de `V8` se probó en producción y devolvió el rol `ADMIN`.
- `/healthz` respondió `200` con persistencia saludable.

## Referencias relacionadas

- [[documentacion/00_INICIO_OBSIDIAN]]
- [[documentacion/90_HISTORIAL_DE_CAMBIOS]]
