# Notas de revisión para App Store Connect

Copiar y pegar en **App Store Connect → tu versión → App Review Information → Notes**.
Están en inglés porque el equipo de revisión de Apple trabaja en inglés; abajo está la
traducción para que sepas qué estás mandando.

---

## Cuenta de prueba (obligatoria)

Apple rechaza sin probar si no puede entrar. Creá una cuenta con email y contraseña
(la app las soporta, no hace falta Google ni Apple para probar) y cargala en
**Sign-In Information**:

```
Email:    review@bolt.com.ar
Password: (la que le pongas)
```

Esa cuenta tiene que existir de verdad en Supabase y estar confirmada. Para que el
revisor pueda ver la parte de profesional, aprobala a mano:

```sql
-- Reemplazá el email si usás otro
update professionals
   set verification_status = 'approved'
 where user_id = (select id from auth.users where email = 'review@bolt.com.ar');
```

---

## Notes (pegar tal cual)

```
BOLT connects customers with local home-service professionals (electricians, plumbers,
locksmiths, movers) in Bahía Blanca, Argentina. It works like a ride-hailing app, but
for trades.

HOW TO TEST
1. Sign in with the demo account provided above (email + password).
2. Allow location access ("While Using the App") to see nearby professionals on the map.
3. Search for a trade and request a job. Up to 3 nearby professionals receive the request
   and can send a quote.
4. The demo account is also registered as a professional: open the side menu ->
   "Trabajar con BOLT" -> turn on the radar to receive incoming job requests.

BACKGROUND LOCATION (UIBackgroundModes: location)
Background location is used ONLY by professionals, and ONLY while they are on their way
to a job they have already accepted. The customer sees the professional approaching on a
live map, exactly like a ride-hailing app. It is not used for advertising, analytics or
tracking, and it is never collected from customers.
- The professional turns the tracking on themselves (the "radar" switch) and can turn it
  off at any time.
- Tracking stops automatically when the job is marked as completed or cancelled.
- No location history is stored: only the professional's current position, overwritten on
  each update, and it is deleted when the account is deleted.

ACCOUNT DELETION (guideline 5.1.1(v))
Profile -> "Borrar mi cuenta" (bottom of the screen), with two confirmations. It performs
a real deletion: the account and all associated data (jobs, chat messages, ratings, push
tokens and professional profile) are permanently removed from our database. There is no
deactivation-only path.

SIGN IN WITH APPLE (guideline 4.8)
Available on the login screen, alongside Google and email/password. It requests only name
and email, and we do not require any additional personal data to create an account.

PAYMENTS
There are no in-app purchases and no digital content. The app is free. Customers pay the
professional directly for the physical service performed at their home, outside the app.
```

---

## Traducción (para vos, no se manda)

- **Qué es la app**: conecta clientes con profesionales de oficios en Bahía Blanca;
  funciona como una app de viajes pero para oficios.
- **Cómo probarla**: entrar con la cuenta demo, dar permiso de ubicación, buscar un oficio
  y pedir un trabajo; la misma cuenta sirve para ver el lado del trabajador prendiendo el
  radar.
- **Ubicación en background**: sólo la usan los trabajadores, sólo mientras van a un
  trabajo ya aceptado, la prenden ellos, se corta sola al terminar y no se guarda
  historial. Este es el punto que Apple mira con lupa.
- **Borrado de cuenta**: dónde está el botón y que borra de verdad.
- **Sign in with Apple**: que está disponible junto con Google.
- **Pagos**: no hay compras dentro de la app; se paga el servicio físico afuera.

---

## Video del caso de uso

Apple suele pedirlo cuando ve `UIBackgroundModes: location`. Grabá la pantalla del
teléfono (30-60 segundos alcanzan) mostrando, en este orden:

1. El trabajador prende el radar y se ve el aviso de que va a compartir ubicación.
2. Llega una solicitud de trabajo y la acepta.
3. La pantalla del cliente siguiendo al trabajador en el mapa mientras se mueve.
4. El trabajo se marca como terminado y el seguimiento se corta.

Subilo a un link accesible sin login (Drive con "cualquiera con el enlace") y pegá la URL
al final de las notas.
