# Subir BOLT al App Store — solo, desde Windows

Reemplaza a `PEDRO.md`. **Pedro ya no está en el proyecto** (8-ago-2026): la app es
100% tuya, y esto es lo que hay que hacer para publicarla sin depender de nadie.

Verificado contra el sistema en vivo el **8-ago-2026**.

---

## Lo primero: NO necesitás una Mac

Es lo que frena a casi todo el mundo, y en este proyecto no aplica.

**Expo compila iOS en sus propias Mac, en la nube.** Vos corrés un comando desde
Windows y a los 20 minutos tenés el archivo listo para subir. Comprobado en este
proyecto: no existe la carpeta `ios/`, así que EAS la genera él mismo en el servidor.

Lo que **sí** necesitás:

| Qué | Cuánto | Para qué |
|---|---|---|
| **Apple Developer Program** | US$ 99 al año | Sin esto no se puede publicar, no hay vuelta |
| Un rato en App Store Connect | web, desde Windows | Cargar la ficha, las capturas y mandar a revisión |

⚠️ **Al inscribirte, Apple verifica tu identidad.** Según el caso puede pedir hacerlo
desde la **app "Apple Developer" en un iPhone o iPad**. Si te lo pide y no tenés,
pedile el teléfono prestado a alguien un rato: es sólo para ese paso, después todo
sigue por web.

---

## El orden

### 1. Inscribirte en Apple (lo único que tarda)

`developer.apple.com/programs/enroll` → **como persona física** (*Individual*), no como
empresa: la empresa exige un número D-U-N-S y semanas de trámite. Como persona física
aparece tu nombre como desarrollador; se puede cambiar a una empresa después.

Apple tarda entre unas horas y dos días en aprobar. **Empezá por acá**, que lo demás
son minutos.

### 2. Compilar la app

Desde esta carpeta, en Windows:

```bash
eas build --platform ios --profile production
```

La primera vez te va a preguntar por las credenciales de Apple: **decile que sí a todo
lo que ofrezca generar** (certificado de distribución y perfil de aprovisionamiento).
`eas.json` ya está en `credentialsSource: "remote"` para iOS justamente para eso: los
crea y los guarda Expo, no vos.

🔴 **Cuidado con una sola cosa:** si en algún momento pregunta por el **keystore de
Android**, decí que NO a generar uno nuevo. Ese es el de Play y si cambia, Google deja
de aceptar actualizaciones. (En un build de iOS no debería ni preguntarlo.)

Tarda unos 20 minutos. Te queda un archivo `.ipa` en tu cuenta de Expo.

### 3. Subirla a Apple

```bash
eas submit --platform ios --profile production
```

Te va a pedir tu Apple ID y la clave específica de aplicación. Sube solo.

### 4. Completar la ficha en App Store Connect

Todo por web. Los tres documentos que te dejé preparados:

- **`APPLE_REVIEW.md`** — las notas para el revisor, en inglés, para pegar tal cual. Y
  la cuenta con la que Apple va a entrar: `review@bolt.com.ar`. **Verificada hoy**:
  entra, tiene el mail confirmado y el perfil de profesional aprobado.
  🔴 **No borres ni cambies esa cuenta mientras esté en revisión**: si Apple no puede
  entrar, el rechazo es automático.
- **`APPLE_PRIVACY.md`** — el formulario de privacidad ya resuelto, campo por campo.
- Las capturas: hacen falta de **iPhone 6.7"** (1290×2796) y **6.5"**. Se pueden armar
  con las de Android reencuadradas, o con un iPhone prestado.

### 5. Mandarla a revisión

Apple tarda entre un día y tres. Si rechaza, contesta en el mismo hilo: casi siempre es
una charla, no una sentencia.

---

## Lo que no vas a poder hacer solo, y cómo salir

**Probar la app en un iPhone antes de mandarla.** Sin un iPhone a mano, la estarías
enviando sin verla correr. Dos salidas:

1. **TestFlight con alguien que tenga iPhone.** Después del paso 3, la app queda en
   TestFlight: invitás a alguien por mail, la instala y te cuenta. Es lo que yo haría.
2. Mandarla igual. Se puede, pero si hay algo roto lo vas a descubrir por un rechazo,
   y cada vuelta son días.

**El video de la ubicación en segundo plano** que pide Apple: el guion está en
`APPLE_REVIEW.md`. Se puede grabar **con el Android** mostrando la misma
funcionalidad; lo que Apple quiere entender es *para qué* la usás, no en qué teléfono.

**Sign in with Apple** necesita, además del código (ya está), que crees en tu cuenta de
Apple un *Services ID* y una clave `.p8`, y los cargues en Supabase → Authentication →
Providers → Apple. Es por web, desde Windows, y son 10 minutos. **Sin eso el botón de
Apple no funciona, y Apple prueba justamente eso.**

---

## Estado del código: no falta nada

Reverificado el 8-ago-2026 contra el sistema en vivo:

- ✅ Sign in with Apple implementado (falta sólo la parte de tu cuenta, arriba)
- ✅ Borrar la cuenta desde la app, con borrado real — la función responde en producción
- ✅ Las tres páginas legales abren (privacidad, términos, eliminar cuenta)
- ✅ Textos de permisos completos y específicos — es la causa n°1 de rechazo
- ✅ `eas.json` correcto para iOS
- ✅ Sin librerías de analítica ni publicidad → en el formulario de privacidad,
  "¿rastreás usuarios?" es **NO**
- ✅ La app no cobra nada, así que no hay que pelear con los pagos de Apple
- ✅ No hay ningún build de iOS todavía: el camino está limpio

---

## ⚠️ Antes del primer build: el nombre

Decidiste el 8-ago-2026 seguir con **BOLT**. Queda dicho para que no sorprenda:

- En Argentina **"BOLT" está concedida a terceros** en las clases 9, 35 y 42. La 35
  —poner en contacto clientes con prestadores— es exactamente lo que hace la app.
- **Apple revisa marcas al aprobar** (guideline 5.2.1) y existe una app de movilidad
  llamada Bolt, muy grande. Puede haber rechazo por el nombre.
- 🔴 **El identificador `com.bolt.app` no se puede cambiar nunca** después del primer
  envío. El nombre visible sí se cambia cuando quieras; el identificador no. Si más
  adelante hay que cambiar de nombre, eso sería **una app nueva**: sin reseñas y sin
  que los que ya la tienen reciban la actualización.

**El último momento para cambiarlo gratis es antes de correr el paso 2.**

---

Ver `APPLE_REVIEW.md`, `APPLE_PRIVACY.md` y, para el resto del proyecto, `CLAUDE.md`.
