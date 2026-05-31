# 🧪 Guía de pruebas del APK — GOVOLT

## ⚙️ ANTES de probar (hacer una sola vez)

### 1. Correr las migraciones en Supabase (OBLIGATORIO)
Sin esto, varias features nuevas tiran error (timeline, chat, reputación, emergencia).

1. Entrá a [Supabase → SQL Editor](https://supabase.com/dashboard/project/lyeqnvldemcltlbujlnc/sql)
2. Abrí el archivo `supabase/EJECUTAR_TODO_pendiente.sql`
3. Copiá **todo** el contenido, pegalo y dale **Run**
4. Debería decir "Success". (Es idempotente: si algo ya existía, no rompe.)

### 2. (Opcional, para push real) Deployar Edge Functions
Para probar notificaciones con la app cerrada. **No bloquea** el resto de las pruebas.
```
supabase functions deploy send-push
supabase functions deploy send-worker-notification
```
> Si no las deployás, el push no llega pero todo lo demás anda. El pago se puede probar con el botón "Simular pago".

---

## ✅ CHECKLIST de pruebas

### A. Demo Mode (lo más rápido para ver todo el flujo)
- [ ] Deslizar el panel inferior → tocar **"🧪 ▶ Iniciar demo completo"**
- [ ] Búsqueda animada (4 pasos)
- [ ] 2 cotizaciones, Carlos acepta solo
- [ ] Mapa con GPS de Carlos acercándose
- [ ] Estados: en camino → cerca → llegó → trabajando → a pagar
- [ ] **Timeline viva** se va llenando con eventos
- [ ] **Barra de progreso** (6 pasos) avanza
- [ ] **Barra de estado** ("última actualización hace X")
- [ ] Chat con mensajes automáticos de GOVOLT
- [ ] Pantalla de **calificación** al final + mensaje de comunidad

### B. Flujo real cliente (con cuenta normal)
- [ ] Buscar profesión → ver **WorkerCard** rediseñada (foto, badges, reputación)
- [ ] Solicitar → **SearchingOverlay** animado
- [ ] **QuoteSelection**: propuestas, comparar hasta 3, ver perfil
- [ ] **Resumen antes de contratar** (modal "Tu solicitud")
- [ ] Tracking: mapa, timeline, chat, barra de progreso
- [ ] **Emergencia** (botón rojo): busca el más cercano
- [ ] **Mis profesionales** (favoritos): aparece tras calificar

### C. Flujo real trabajador
- [ ] Activar disponibilidad → **aparece la divulgación de ubicación** (consentimiento) ✱nuevo
- [ ] Recibir trabajo → pantalla de alarma
- [ ] **"ACEPTAR AHORA"** (1 toque) funciona ✱nuevo
- [ ] O "Ver detalles" → formulario → aceptar
- [ ] Llegué / Iniciar / Cobrar
- [ ] Resumen del trabajo

### D. Seguridad (verificar que los fixes andan)
- [ ] Registrarse como trabajador con CUIT/CBU → se guardan (van a `professional_payout`)
- [ ] Panel admin (con tu email) → ve CUIT/CBU de los trabajadores
- [ ] Reseña: solo se puede dejar tras un trabajo **completado**
- [ ] La app **no pide permiso de micrófono** ✱nuevo (sacamos RECORD_AUDIO)

### E. Cosas a mirar
- [ ] El **Demo Mode no debe verse** en uso normal salvo que actives el banner
- [ ] Que no aparezcan los botones "Simular pago" salvo en Demo Mode
- [ ] Tamaños/layouts en tu pantalla (antes había desajustes)
- [ ] Que el mapa cargue (no negro)

---

## 🐛 Si algo falla
Anotá: **qué pantalla**, **qué hiciste**, **qué pasó vs qué esperabas**. Con eso lo arreglo rápido. Si es un crash, sirve el mensaje de error.
