# BOLT — arranque para Pedro

App de servicios a domicilio (tipo Uber, pero de electricistas, plomeros, gasistas).
El cliente pide, el profesional más cercano recibe el aviso, acepta y va. Está **en
producción en Android** y falta **publicarla en el App Store** — ese es tu encargo.

Contacto: Maxi (maxi95.bahiablanca@gmail.com).

---

## 1. Estado real, sin maquillaje

| | |
|---|---|
| **Android** | Publicada en Google Play, canal **Prueba cerrada (Alpha)**, versión 11 (1.0.0) |
| **iOS** | **No existe todavía.** Nunca se generó el proyecto nativo. Es lo que hay que hacer |
| **Backend** | Supabase (Postgres + Auth + PostGIS + Realtime). Andando |
| **Web** | `bolt.com.ar` — GitHub Pages, repo aparte (`bolt-web`) |
| **Usuarios** | 6 profesionales cargados, ~12 testers. Arrancando |
| **Monetización** | **Apagada.** `MONETIZATION_MODE = 'free'` en `src/config/monetization.js`. La app no cobra nada: el cliente le paga directo al profesional |

Google Play está corriendo el plazo obligatorio de **14 días con 12 testers** (arrancó el
29-jul-2026, se cumple alrededor del **12-ago**). Recién ahí se puede pedir producción.

⚠️ **Mientras corre ese plazo, no subas versiones nuevas a Play sin avisarle a Maxi.**
Nada de lo que hagas en iOS lo afecta — son canales separados.

---

## 2. Stack

- **Expo SDK 54** / React Native 0.81.5 / React 19.1.0
- Proyecto **bare**: la carpeta `android/` está versionada y manda sobre `app.json`
- Supabase `lyeqnvldemcltlbujlnc.supabase.co` — auth con Google OAuth + email
- `expo-location` (ubicación en background), `expo-notifications` + `notifee`, `expo-updates` (OTA)
- Build y deploy con **EAS**

Estructura y flujos: ver `CLAUDE.md` en la raíz, que está bastante completo.

---

## 3. Accesos que necesitás

Pedíselos a Maxi, no están en el repo:

1. **Expo** — te tiene que invitar (ver sección 8). Sin esto no podés buildear.
2. **Supabase** — para ver la base y las Edge Functions.
3. **GitHub** — el repo `maxi95bahiablanca-hue/VOLT` es **público**, así que ya lo podés
   clonar. Para poder pushear, pasale tu usuario de GitHub (el mail no alcanza).
4. **Google Play Console** — sólo si vas a tocar Android.
5. **Apple Developer** — esa es tuya, ver sección 6.

### Lo que NO está en el repo (a propósito)

- `.env` → copiá `.env.example`. Las dos variables que necesita son públicas y están
  también en `eas.json`, así que las podés sacar de ahí.
- `credentials/bolt-upload.keystore` + `credentials.json` → la firma de **Android**.
  Para iOS **no hacen falta**.
- `google-service-account.json` → sólo para `eas submit` de Android.

---

## 4. Levantarlo local

```bash
git clone https://github.com/maxi95bahiablanca-hue/VOLT.git
cd VOLT
npm install
cp .env.example .env      # completá las 2 variables (están en eas.json)
npx expo start
```

Con Expo Go **no alcanza**: la app usa módulos nativos (notifee, ubicación en background).
Necesitás un development build:

```bash
eas build --platform ios --profile development   # corre en el simulador
```

---

## 5. Ver la app funcionando, ya

Lo más rápido, sin cuenta de Apple ni nada:

```bash
eas build --platform ios --profile preview
```

El perfil `preview` está configurado con `"simulator": true`, así que sale un `.app` que
arrastrás al simulador de iOS y listo.

Si preferís verla en Android antes de tocar nada, el último AAB de producción está en
EAS (`eas build:list`). Para instalarlo en un celular necesitás un APK, no un AAB:

```bash
eas build --platform android --profile preview
```

---

## 6. Publicar en el App Store — paso a paso

### 6.1 Antes de escribir una línea

1. **Apple Developer Program** — US$ 99/año, en developer.apple.com. La validación tarda
   entre unas horas y 2 días. **La app va a quedar a tu nombre**: está hablado con Maxi.
2. **Verificá que el bundle ID esté libre.** `app.json` dice `com.bolt.app`. Es genérico y
   puede estar tomado. Si lo está, cambialo (ej. `com.boltapp.ar`) — todavía no hay nada
   publicado en iOS, así que cambiarlo ahora no rompe nada.
3. **Mac con Xcode.** EAS buildea en la nube, pero para el `prebuild` y para depurar nativo
   lo vas a necesitar.

### 6.2 Generar el proyecto iOS

Nunca se generó. **Hacelo en tu Mac**, no en Windows (sin CocoaPods queda a medias):

```bash
npx expo prebuild --platform ios
```

⚠️ **Usá `--platform ios`, nunca `--clean` a secas.** Un prebuild sin plataforma regenera
también `android/`, y ahí hay cambios hechos a mano que se perderían — entre ellos
`android/app/src/main/res/values/styles.xml`, al que se le sacaron dos líneas para callar
un aviso de Google Play.

### 6.3 Buildear y subir

```bash
eas build --platform ios --profile production
eas submit --platform ios
```

EAS te genera los certificados y el provisioning profile solo — no hace falta que toques
nada en el portal de Apple. `eas submit` te va a pedir tu Apple ID y el App-Specific
Password.

### 6.4 Los tres motivos de rechazo — estado

Son las causas más comunes de rechazo y esta app pegaba en las tres. **Dos están
resueltas en el código** (29-jul-2026); la tercera es trámite tuyo:

1. ✅ **"Sign in with Apple" (guideline 4.8) — implementado.** `expo-apple-authentication`
   instalado, `ios.usesAppleSignIn: true` y el plugin en `app.json`, y el botón nativo en
   `src/screens/LoginScreen.js` (sólo aparece en iOS, vía `isAvailableAsync()`). Usa
   `supabase.auth.signInWithIdToken({ provider: 'apple' })` y guarda el nombre en el
   primer ingreso, que es la única vez que Apple lo manda.

   ⚠️ **Falta lo que sólo podés hacer vos, con tu cuenta de Apple:**
   - En **developer.apple.com** → Identifiers → tu App ID → habilitar **Sign In with Apple**;
     crear una **Services ID** y una **key** de Sign in with Apple.
   - En **Supabase** → Authentication → Providers → **Apple**: pegar Services ID, Team ID,
     Key ID y la clave `.p8`. **Sin esto el botón sale pero el login falla.**

2. ✅ **Borrar la cuenta desde la app (guideline 5.1.1(v)) — implementado.** Botón "Borrar
   mi cuenta" al final de `src/screens/ProfileScreen.js`, con doble confirmación. Llama a
   `authService.deleteAccount()` → RPC `borrar_mi_cuenta()`
   (`supabase/migrations/032_borrar_cuenta.sql`, **ya aplicada en producción**).
   Es un borrado real: se lleva trabajos, mensajes, calificaciones, push tokens, el perfil
   de profesional y la fila de `auth.users`. La función es `SECURITY DEFINER` y sólo puede
   borrar al usuario de la sesión que la llama (`auth.uid()`), nunca a otro.

3. 🟡 **Ubicación en background.** Apple la revisa con lupa. Los textos de permiso ya
   están escritos y son claros (`app.json` → `ios.infoPlist`). Falta grabar el video del
   caso de uso; las notas de revisión ya están redactadas en **`APPLE_REVIEW.md`** —
   copialas tal cual en App Store Connect.

Lo bueno: **no hay pagos dentro de la app** (`MONETIZATION_MODE = 'free'`), así que te
ahorrás toda la discusión de In-App Purchase.

### 6.5 Ficha de App Store Connect

Hay material reusable de Android: `PLAY_STORE_LISTING.txt` y `PLAY_STORE_KIT.md`.
Los screenshots hay que rehacerlos en tamaños de iPhone.

---

## 7. Trampas del proyecto (léelo, ahorra horas)

- **El `versionCode` de Android vive en `android/app/build.gradle`, no en `app.json`.**
  Es un proyecto bare: EAS ignora `android.package` y `versionCode` de `app.json`. Si
  cambiás sólo `app.json`, sale un build con el número viejo y Play lo rechaza por
  duplicado. **Cambiá los dos.** En iOS el equivalente es `ios.buildNumber`.

- **OTA está activo desde el v11.** `eas update --channel production` publica cambios de
  JS sin pasar por la tienda. Sirve para JS; **nada nativo** (permisos, manifest, plugins)
  se arregla por OTA.

- **`expo prebuild --clean` regenera `styles.xml`** y repone dos líneas que se sacaron a
  propósito. Ver 6.2.

- **La app decide si alguien es profesional mirando la tabla `professionals`**, no
  `prestador_leads`. Es la fuente de un bug grande que ya se corrigió; si ves código que
  registra gente, fijate que escriba en `professionals`.

- **El fallback `worker.min_price || 30000`** está en cuatro pantallas. Como ahora
  `min_price` se guarda en `0` y en JS `0` es falsy, muestra "$30.000" cuando la app es
  gratis. Lo correcto es `??`. Está anotado como pendiente.

---

## 8. Lo que Maxi tiene que hacer para darte acceso a Expo

El proyecto está en la cuenta **personal** `@maxifraggettajesus`, y las cuentas personales
de Expo **no admiten miembros**. Hay que convertirla en organización (es gratis y no
rompe nada: se mantienen el proyecto, el `projectId`, el canal de OTA y las credenciales):

1. Entrar a **expo.dev** → Account settings → **Convert to organization**.
2. Members → **Invite** → `Pedroxillovich@gmail.com` → rol **Developer** (o **Admin** si
   va a manejar credenciales).

Alternativa si no quiere convertirla: Pedro crea su propio proyecto de Expo para iOS y usa
su `projectId`. Funciona, pero quedan dos proyectos separados y el OTA de Android sigue en
el de Maxi. Es más prolijo convertir la cuenta.

**✅ El keystore de Android ya está en EAS** (29-jul-2026). Se subió
`credentials/bolt-upload.keystore` a la cuenta de Expo y quedó como credencial por defecto
de `ar.com.bolt.com` (SHA-1 `A9:1D:C8:58:2B:42:F6:7A:42:39:57:BF:60:28:A1:21:56:DE:6F:AC`,
el mismo que espera Google Play). Ya no hace falta tener el archivo en la máquina para
firmar.

⚠️ **`eas.json` sigue con `credentialsSource: "local"` en el perfil `production` de
Android, y así tiene que quedar por ahora.** Cambiarlo a `remote` sin necesidad no aporta
nada; lo peligroso sería lo contrario: borrar el keystore de EAS o dejar que EAS genere uno
nuevo. Si alguna vez EAS ofrece "generate new keystore" para Android, **decir que no**: con
un keystore distinto, Play deja de aceptar las actualizaciones de la app publicada.

---

## 9. Lo que está pendiente y conocido

Está todo en la memoria del proyecto de Maxi; el resumen:

| # | Qué | Dónde |
|---|-----|-------|
| 1 | "Desde $30.000" en una app que es gratis | `src/screens/ProfessionalsScreen.js:111` |
| 2 | `min_price \|\| 30000` con `min_price = 0` | Home, JobRequest, Professionals, WorkerDashboard |
| 3 | Restricción de orientación (aviso de Play, Android 16) | `AndroidManifest.xml` + `app.json` |
| 4 | El permiso de pantalla bloqueada no se pide de verdad (Android 14+) | `src/services/incomingCall.js` |

Los cuatro necesitan build nuevo, por eso esperan a que termine el plazo de Play.
