# 🚀 GOVOLT — Build del APK (listo para ejecutar)

**Objetivo:** compilar el APK de prueba (preview) para testear la app de punta a punta.
**Cuándo:** 1/6/2026 en adelante (se resetea el límite de EAS gratis).

---

## ✅ Lo que YA dejé preparado (no tocar)
- `app.json`: nombre GOVOLT, paquete `com.govolt.app`, scheme `govolt://`
- **Removido `expo-notifications` del plugin** → evita el crash antes del splash (el `google-services.json` era del paquete viejo `com.pedroxillovich.volt`)
- `eas.json`: perfil **preview** = APK, con las env de Supabase ya cargadas

> ⚠️ Las push notifications NO funcionan en este build (a propósito). Es solo para PROBAR la app. Se activan después con un Firebase nuevo de `com.govolt.app`.

---

## ▶️ PASOS PARA MAÑANA (en orden)

### 1. Abrir PowerShell en la carpeta del proyecto
```powershell
cd "C:\Users\Windows 10\Desktop\VOLT\movil-master"
```

### 2. Verificar que estás logueada en EAS
```powershell
eas whoami
```
- Si dice tu usuario (`maxifraggettajesus`) → seguí.
- Si dice que no estás logueada:
```powershell
eas login
```

### 3. Lanzar el build (comando único — copiá y pegá tal cual)
```powershell
$env:NODE_TLS_REJECT_UNAUTHORIZED=0; eas build -p android --profile preview
```
> El `$env:NODE_TLS_REJECT_UNAUTHORIZED=0` es por el problema de certificado SSL de tu máquina. Sin eso, EAS falla con error de certificado.

### 4. Responder a las preguntas que aparezcan
- Si pregunta por **keystore / credenciales** → elegí **"Generate new keystore"** (que las maneje EAS).
- Espera ~10-20 min. Te da un **link** cuando termina.

### 5. Descargar e instalar
- Abrí el link → botón **Download** → se baja el `.apk`
- Pasalo al celular (o escaneá el QR que da EAS)
- Instalá (Android te pide permitir "orígenes desconocidos" → aceptá)

---

## 🧪 Después de instalar: probar con `PRUEBAS_APK.md`
Seguí esa checklist para testear todo el flujo (registro, login, mapa, pedido, pago, etc.).

---

## 🆘 Si algo falla
| Error | Solución |
|---|---|
| "Build limit reached" | El reseteo todavía no pasó. Esperá unas horas / al día siguiente. |
| Error de certificado SSL | Confirmá que pusiste `$env:NODE_TLS_REJECT_UNAUTHORIZED=0;` antes del comando. |
| "Not logged in" | `eas login` |
| La app crashea al abrir | Avisame — revisamos si quedó algo de notifications/maps. |

---

## ⏭️ Pendiente post-build (cuando el APK funcione)
1. Probar todo con `PRUEBAS_APK.md`
2. Crear Firebase nuevo para `com.govolt.app` → bajar `google-services.json` real → restaurar expo-notifications → push real
3. Deploy Edge Functions: `send-push`, `send-worker-notification`
4. Correr migración 019 (drop de `push_tokens` viejos)
5. Recién ahí: build **production** (AAB) para Play Store
