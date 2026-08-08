# Privacidad de la app — el formulario de App Store Connect, ya resuelto

**App Store Connect → tu app → App Privacy → Get Started.** Apple **no deja publicar**
sin completarlo, y si lo que declarás no coincide con lo que hace la app, rechazan
la versión (guideline 5.1.2).

Esto salió de leer el código, no de suponer. Auditado el **8-ago-2026**.

---

## La primera pregunta: "¿recolectás datos?"

Respuesta: **Yes, we collect data from this app.**

## La pregunta que más se equivoca la gente: rastreo

> *"Do you or your third-party partners use data for tracking purposes?"*

Respuesta: **NO.**

Motivo, verificado en `package.json`: **no hay una sola librería de analítica ni de
publicidad** — ni Facebook SDK, ni Firebase Analytics, ni Sentry, ni AppsFlyer, ni nada
por el estilo. Las 27 dependencias son de Expo y Supabase. Los datos se usan **sólo
para que la app funcione**, nunca para perfilar ni para vender.

🔴 Si algún día se agrega cualquier SDK de analítica o de publicidad, **esta respuesta
cambia** y hay que declarar `App Tracking Transparency`. No agregar ninguno sin revisar
esto.

---

## Qué marcar, categoría por categoría

Para cada dato Apple pide tres cosas: **para qué se usa**, si está **ligado a la
identidad** del usuario y si se usa para **rastrearlo**. En todos los casos de abajo:
**Tracking = NO**.

### Contact Info

| Dato | Marcar | Purpose | Linked to user |
|---|---|---|---|
| **Email Address** | Sí | App Functionality | **Yes** |
| **Name** | Sí | App Functionality | **Yes** |
| **Phone Number** | Sí | App Functionality | **Yes** |

Por qué: la cuenta se crea con mail (o Google / Apple), y el nombre y el teléfono son
lo que ve el profesional para poder llegar y comunicarse.

### Location

| Dato | Marcar | Purpose | Linked to user |
|---|---|---|---|
| **Precise Location** | Sí | App Functionality | **Yes** |

Por qué: el cliente necesita profesionales cerca y que sepan a dónde ir; el
profesional comparte su ubicación **mientras va en camino a un trabajo aceptado**,
como una app de viajes. No se marca *Coarse Location* porque se usa la precisa.

### User Content

| Dato | Marcar | Purpose | Linked to user |
|---|---|---|---|
| **Photos or Videos** | Sí | App Functionality | **Yes** |
| **Audio Data** | Sí | App Functionality | **Yes** |
| **Other User Content** | Sí | App Functionality | **Yes** |

Por qué: fotos del problema a resolver, documentación del profesional (DNI y selfie de
verificación), audios del chat y los mensajes entre cliente y profesional.

### Identifiers

| Dato | Marcar | Purpose | Linked to user |
|---|---|---|---|
| **User ID** | Sí | App Functionality | **Yes** |

Por qué: el identificador de la cuenta en Supabase, y el token de notificaciones
guardado en `push_tokens` para poder avisar de un trabajo.
**NO se marca Device ID**: no se usa el identificador publicitario del teléfono.

### Lo que NO se marca

- **Financial Info** — la app **no cobra** (`MONETIZATION_MODE = 'free'`); el pago se
  arregla entre las partes, fuera de la app.
- **Health & Fitness**, **Sensitive Info**, **Browsing History**, **Search History**,
  **Contacts**, **Purchases**, **Diagnostics**, **Usage Data**.

---

## Lo demás de esa pantalla

- **Privacy Policy URL**: `https://bolt.com.ar/privacy.html` (verificada online).
- **Account Deletion**: Apple pregunta si se puede borrar la cuenta **desde la app**.
  Respuesta **sí** — está en Perfil → Borrar mi cuenta, y borra de verdad los datos
  (función `borrar_mi_cuenta()`, ya viva en producción). La página de respaldo es
  `https://bolt.com.ar/eliminar-cuenta.html`.

---

## ⚠️ Lo que hay que mantener cierto

Esto no es un trámite que se llena y se olvida: **es una declaración**. Si mañana la
app empieza a cobrar, a sumar analítica o a pedir otro dato, hay que volver acá y
actualizarlo antes de mandar la versión.

Ver `APPLE_REVIEW.md` (las notas para el revisor y la cuenta de prueba) y `PEDRO.md`.
