# VOLT — App móvil de servicios a domicilio

App React Native/Expo SDK 54 conectada a Supabase. Clientes buscan profesionales cercanos por profesión; profesionales reciben trabajos, los aceptan y cobran por Mercado Pago.

## Stack

- Expo ~54.0.33 (`newArchEnabled: false`)
- React 19.1.0 / React Native 0.81.5
- Supabase: `lyeqnvldemcltlbujlnc.supabase.co` (PostgreSQL + Auth + PostGIS + Realtime + Storage)
- Google OAuth + email/password via supabase.auth
- expo-location para GPS en foreground y background
- expo-notifications para push (solo en EAS build, stub en dev)
- expo-updates para OTA
- Mercado Pago via Edge Functions (create-payment + mp-webhook)

## Estructura de archivos

```
movil-master/
├── App.js                          # Raíz: auth → screens (estado global de jobs)
├── app.json                        # Config Expo (dark theme, splash, OTA, permisos)
├── eas.json                        # EAS Build (dev/preview/production)
├── .env                            # Variables locales (Supabase URL + anon key)
├── src/
│   ├── screens/
│   │   ├── LoginScreen.js          # Google OAuth + email/password (dark theme)
│   │   ├── HomeScreen.js           # Mapa + radar + búsqueda + DrawerMenu
│   │   ├── RegisterProfessionalScreen.js  # 3 pasos: datos, profesiones, docs
│   │   ├── JobRequestScreen.js     # Confirmar solicitud → crea quoteGroup
│   │   ├── QuoteSelectionScreen.js # Elegir presupuesto (countdown 45s)
│   │   ├── WorkerIncomingScreen.js # Trabajador acepta/rechaza (countdown 45s)
│   │   ├── JobTrackingScreen.js    # Mapa leaflet, estados, pago MP
│   │   ├── RatingScreen.js         # Calificación post-trabajo
│   │   ├── HistoryScreen.js        # Historial de trabajos (cliente/trabajador)
│   │   ├── ProfileScreen.js        # Perfil usuario
│   │   ├── WorkerDashboardScreen.js # Panel del trabajador (stats, ingresos)
│   │   ├── AdminScreen.js          # 4 tabs: pendientes/trabajadores/trabajos/ingresos
│   │   ├── HowItWorksScreen.js     # Cómo funciona (5 pasos estáticos)
│   │   └── PrivacyPolicyScreen.js  # Política de privacidad (10 secciones)
│   ├── components/
│   │   ├── DrawerMenu.js           # Menú lateral animado
│   │   ├── VoltMap.js              # Mapa con marcadores de trabajadores
│   │   └── ErrorBoundary.js        # React class error boundary
│   ├── services/
│   │   ├── jobService.js           # CRUD + suscripciones realtime de jobs
│   │   ├── professionalService.js  # CRUD profesionales + getNearbyWorkers
│   │   ├── professionService.js    # getProfessions (catálogo)
│   │   ├── locationService.js      # GPS foreground + background (TaskManager)
│   │   ├── notificationService.js  # Push (Expo push service, stub en __DEV__)
│   │   └── paymentService.js       # createPreference + openCheckout (WebBrowser)
│   └── supabase.js                 # Cliente Supabase (PKCE, AsyncStorage)
├── supabase/
│   ├── migrations/
│   │   ├── 000_schema.sql          # Tablas base + RLS + professions seed
│   │   ├── 001_worker_verification.sql  # Campos verificación + nearby_workers v2
│   │   └── 002_missing_columns.sql     # CBU, quote_group_id, pre/final_diagnosis,
│   │                                   # penalize_worker_rejection, bucket avatars,
│   │                                   # admin update policy — EJECUTAR ANTES DE PROBAR
│   └── functions/
│       ├── create-payment/index.ts # Crea preferencia MP (requiere MP_ACCESS_TOKEN)
│       └── mp-webhook/index.ts     # Webhook MP → marca job completed + registra pago
└── assets/                         # icon.png, splash-icon.png, etc.
```

## Variables de entorno

```
EXPO_PUBLIC_SUPABASE_URL=https://lyeqnvldemcltlbujlnc.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_4e50WLUuWTJ0u2DN6HPUNw_FeIdsV-0
```

En `.env` para desarrollo local. En `eas.json` para builds EAS.

## Setup para probar (orden obligatorio)

### 1. Ejecutar migración en Supabase SQL Editor
Abrir `supabase/migrations/002_missing_columns.sql` y ejecutarlo completo.
Esto agrega: CBU, quote_group_id, pre_diagnosis, final_diagnosis, bucket avatars, función penalize_worker_rejection, política admin.

### 2. Correr localmente
```bash
npm install
npx expo start
```

### 3. Build para dispositivo real
```bash
eas login
eas build --platform android --profile preview
```

## Flujo completo de la app

**Como cliente:**
1. Login (Google OAuth o email/password)
2. Buscá profesión en el buscador (mínimo 3 letras)
3. Tocás un trabajador en el mapa → aparece WorkerCard
4. "Solicitar" → JobRequestScreen (notas opcionales)
5. Se envían solicitudes a hasta 3 trabajadores simultáneos
6. QuoteSelectionScreen: countdown 45s, elegís quien respondió
7. JobTrackingScreen: mapa leaflet en tiempo real, seguís al trabajador
8. Cuando el trabajador carga el monto → botón pagar → MP checkout
9. RatingScreen: calificás al trabajador (opcional)

**Como trabajador:**
1. Registrarse en "Trabajar con VOLT" (3 pasos: datos, profesiones, docs)
2. Admin aprueba desde AdminScreen → verification_status = 'approved'
3. Activar radar en HomeScreen → visible para clientes
4. WorkerIncomingScreen: 45s para aceptar/rechazar cada trabajo
5. JobTrackingScreen: Llegué → Iniciar → cargar monto → cliente paga
6. El pago confirma vía webhook (MP_ACCESS_TOKEN en Edge Functions)

## Base de datos — tablas principales

| Tabla | Descripción |
|-------|-------------|
| `professions` | Catálogo de rubros (Electricista, Plomero, etc.) |
| `professionals` | Perfil del trabajador (cuit, cbu, verificación, ubicación) |
| `professional_professions` | Relación N:N profesional↔profesión con precio mínimo |
| `jobs` | Trabajos (status: pending→accepted→arrived→in_progress→awaiting_payment→completed) |
| `payments` | Pagos registrados por el webhook de MP |
| `reviews` | Calificaciones post-trabajo |
| `push_tokens` | Tokens de notificación push por usuario |

## Funciones RPC clave

- `nearby_workers(p_profession_id, p_lat, p_lng, p_limit)` → trabajadores aprobados cercanos con distancia, avatar_url, lat/lng
- `penalize_worker_rejection(p_professional_id)` → resta 0.05 al avg_rating

## Edge Functions (Supabase)

Requieren `MP_ACCESS_TOKEN` configurado en Supabase → Edge Functions → Secrets.

- `create-payment`: recibe `{jobId, amount, description, payerEmail}`, crea preferencia MP, retorna `checkoutUrl`
- `mp-webhook`: recibe notificación de MP, verifica pago, marca job `completed`, registra en `payments`

## Storage

- `worker-docs` (privado): selfie, DNI frente/dorso
- `avatars` (público): fotos de perfil — necesario que sea público para que `<Image>` funcione sin auth

## Publicar en Play Store

```bash
eas login
eas build --platform android --profile production
# Obtener google-service-account.json de Google Play Console
eas submit --platform android
```
