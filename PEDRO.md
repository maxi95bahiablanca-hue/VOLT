# BOLT — arranque para Pedro

App de servicios a domicilio (tipo Uber, pero de electricistas, plomeros, gasistas).
El cliente pide, el profesional más cercano recibe el aviso, acepta y va. Está **en
producción en Android** y falta **publicarla en el App Store** — ese es tu encargo.

Contacto: Maxi (maxi95.bahiablanca@gmail.com).

---

## 0. Empezá por acá — qué está listo y qué falta (30-jul-2026)

**Del lado del código ya está todo lo que Apple exige.** No tenés que programar nada
para poder enviar la app: lo que queda son trámites tuyos y una cosa de Maxi.

| | Qué | Quién |
|---|---|---|
| ✅ | Sign in with Apple implementado (botón nativo, sólo iOS) | hecho |
| ✅ | Borrar la cuenta desde la app, con borrado real | hecho |
| ✅ | Notas de revisión escritas → `APPLE_REVIEW.md` | hecho |
| ✅ | **Cuenta demo para el revisor**, probada: `review@bolt.com.ar` / `BoltReview2026!` | hecho |
| ✅ | `eas.json` y `app.json` preparados para iOS (`buildNumber`, `usesAppleSignIn`, permisos) | hecho |
| ✅ | Textos de permisos, incluido el de micrófono | hecho |
| ⏳ | **Convertir la cuenta de Expo en organización e invitarte** — sin esto no podés buildear | **Maxi** (ver punto 8) |
| ⏳ | Apple Developer Program (US$ 99/año) y una Mac con Xcode | **vos** |
| ⏳ | Habilitar el provider **Apple** en Supabase con tus claves (ver 6.4) | **vos** |
| ⏳ | Generar el proyecto iOS (`npx expo prebuild --platform ios`) | **vos** |
| ⏳ | Grabar el video de la ubicación en segundo plano (guion en `APPLE_REVIEW.md`) | **vos** |
| ⏳ | Pasarle a Maxi tu **usuario de GitHub** (el mail no alcanza para agregarte) | **vos** |
| ✅ | **Privacidad de la app**: el formulario de App Store Connect, resuelto → `APPLE_PRIVACY.md` | hecho |

**El orden que yo seguiría:** cuenta de Apple → que Maxi te sume a Expo → prebuild en la
Mac → habilitar Apple en Supabase → build y subida → completar la ficha con
`APPLE_REVIEW.md`, `APPLE_PRIVACY.md` y el video.

### Revisado de nuevo el 8-ago-2026, contra el sistema en vivo

No es lo que decía la nota vieja: se volvió a comprobar una por una.

- ✅ **La cuenta del revisor sigue entrando** (`review@bolt.com.ar`), con el mail
  confirmado, **profesional aprobado** y oficio *Electricista*, y el radar apagado —
  que es lo que queremos: lo prende él y ve el permiso de ubicación en contexto.
  🔴 Si Apple no puede entrar, el rechazo es automático: **no la toques**.
- ✅ **La función de borrar la cuenta existe y responde** en producción.
- ✅ **Las tres páginas legales están online** (`privacy.html`, `terms.html`,
  `eliminar-cuenta.html`): Apple exige la de privacidad y verifica que abra.
- ✅ **Los textos de permisos están completos y son específicos** (ubicación en uso y
  siempre, cámara, fotos, micrófono). Es la causa número uno de rechazo y acá está bien:
  cada uno explica *para qué*, no dice "necesitamos tu ubicación".
- ✅ **`eas.json` correcto para iOS**: `credentialsSource: "remote"` sólo en el bloque
  de iOS (EAS genera los certificados), y `"local"` únicamente en Android, que es donde
  está el keystore que no se puede perder.
- ✅ **No hay ninguna librería de analítica ni de publicidad** — por eso en el formulario
  de privacidad la respuesta a *"¿usás los datos para rastrear?"* es **NO**.
- ⏳ En `eas.json` no hay bloque `submit.production.ios`. No es un problema:
  `eas submit -p ios` pide los datos (Apple ID, App Store Connect App ID, Team ID) la
  primera vez. Si querés dejarlo fijo, se completa después del primer envío.

### ⚠️ Antes de subir: el nombre

Maxi decidió el **8-ago-2026 seguir adelante con "BOLT"**, sabiendo el riesgo. Queda
dicho acá para que nadie se sorprenda después:

- En Argentina **"BOLT" está concedida a terceros** en las clases 9, 35 y 42 (ver la
  búsqueda del INPI). La 35 —poner en contacto clientes con prestadores— es exactamente
  lo que hace la app.
- **Apple revisa marcas al aprobar** (guideline 5.2.1), y existe una app de movilidad
  llamada Bolt, muy grande. Puede haber rechazo por el nombre.
- 🔴 **El Bundle ID `com.bolt.app` no se puede cambiar nunca** una vez subido el primer
  build. Si más adelante hay que cambiar de nombre, el nombre visible se cambia en un
  rato, pero el identificador no: sería **una app nueva**, sin reseñas y sin que los
  usuarios instalados reciban la actualización.

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

   ⚠️ **Falta lo que sólo podés hacer vos, con tu cuenta de Apple.** Es media hora, pero
   si te salteás un paso el botón aparece y el login falla con un error críptico.
   El orden exacto:

   **En developer.apple.com:**
   1. **Certificates, Identifiers & Profiles → Identifiers → App IDs.** Buscá el App ID
      de la app (`com.bolt.app`; si tuviste que cambiar el bundle, el que hayas usado).
      Si no existe todavía, lo crea EAS solo en el primer build — podés hacer el build
      primero y volver acá.
   2. Editalo → tildá **Sign In with Apple** → Save.
   3. **Identifiers → + → Services IDs.** Creá uno nuevo, por ejemplo `com.bolt.app.signin`
      (NO puede ser igual al bundle). Descripción: "BOLT Sign in with Apple".
   4. Editá ese Services ID → tildá **Sign In with Apple** → **Configure**:
      - Primary App ID: el del paso 1.
      - **Return URLs**: `https://lyeqnvldemcltlbujlnc.supabase.co/auth/v1/callback`
   5. **Keys → +**. Nombre "BOLT Sign in with Apple", tildá **Sign In with Apple**,
      Configure → elegí el Primary App ID → Continue → Register.
      **Descargá el archivo `.p8` — se descarga UNA sola vez.** Anotá el **Key ID**.
   6. Anotá tu **Team ID** (arriba a la derecha, o en Membership).

   **En Supabase** (pedile el acceso a Maxi) → Authentication → Providers → **Apple**:
   - **Enable** en sí.
   - *Client IDs*: poné **los dos** separados por coma — el **bundle** (`com.bolt.app`,
     que es el que manda la app nativa) y el **Services ID** del paso 3. Si ponés sólo
     uno, el login falla en uno de los dos caminos.
   - *Secret Key (for OAuth)*: el contenido del `.p8`, junto con Team ID y Key ID.
   - Guardá y probá desde un iPhone real: el simulador no siempre tiene sesión de Apple.

   💡 El código de la app usa `supabase.auth.signInWithIdToken({ provider: 'apple' })`,
   o sea el camino nativo. Por eso el **bundle** tiene que estar sí o sí en Client IDs.

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
