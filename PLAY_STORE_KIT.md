# 📦 Kit de publicación Play Store — VOLT

Todo pre-armado para copiar/pegar en la consola de Google Play.

---

## 1. Ficha de la tienda (Store listing)

**Nombre de la app** (máx. 30 caracteres)
```
VOLT — Oficios al instante
```

**Descripción corta** (máx. 80 caracteres)
```
Electricistas, plomeros y gasistas verificados, cerca tuyo y en tiempo real.
```

**Descripción completa** (máx. 4000 caracteres)
```
VOLT conecta a quienes necesitan un oficio con profesionales verificados y disponibles cerca tuyo, al instante.

¿Se te cortó la luz? ¿Una pérdida de agua? ¿Una fuga de gas? Pedí el oficio que necesitás y VOLT busca al profesional disponible más cercano. Seguilo en tiempo real en el mapa, mirá cuánto falta para que llegue y pagá seguro desde la app.

━━━━━━━━━━━━━━━━━━━━
PARA CLIENTES
━━━━━━━━━━━━━━━━━━━━
• Profesionales verificados con identidad y antecedentes
• Seguimiento en tiempo real en el mapa
• Precio claro antes de empezar el trabajo
• Pago 100% digital y seguro (Mercado Pago)
• Código de identidad de 4 dígitos para tu seguridad
• Modo emergencia para urgencias
• Historial y profesionales favoritos

━━━━━━━━━━━━━━━━━━━━
PARA PROFESIONALES
━━━━━━━━━━━━━━━━━━━━
• Recibí trabajos cerca tuyo
• Cobrás seguro por la app
• A mayor reputación, menor comisión
• Construí tu perfil y tu cartera de clientes
• Vos decidís cuándo estás disponible

━━━━━━━━━━━━━━━━━━━━
SEGURIDAD ANTE TODO
━━━━━━━━━━━━━━━━━━━━
Todos los profesionales pasan verificación de identidad. Cada uno tiene un código que debés pedirle antes de abrir la puerta. Las calificaciones son reales: solo se pueden dejar después de un trabajo completado.

VOLT — el profesional que necesitás, al instante.
```

**Categoría:** Estilo de vida (o Productividad / Casa y hogar)
**Etiquetas/tags:** oficios, electricista, plomero, gasista, hogar, servicios

---

## 2. Data Safety (Seguridad de los datos) — formulario obligatorio

> Respuestas basadas en lo que REALMENTE recopila la app (auditado en el código).

**¿La app recopila o comparte datos del usuario?** → SÍ

| Tipo de dato | Recopila | Comparte | Por qué |
|---|---|---|---|
| **Ubicación precisa** | Sí | Sí | Conectar con profesionales cercanos y seguimiento en tiempo real durante un trabajo |
| **Nombre** | Sí | Sí | Identificación entre cliente y profesional |
| **Email** | Sí | No | Cuenta y comunicación |
| **Teléfono** | Sí | Sí | Coordinación del trabajo |
| **Info financiera (CUIT/CBU)** | Sí | No | Pago a profesionales (solo trabajadores) |
| **Fotos** | Sí | No | Verificación de identidad (documentos) y foto de perfil |
| **ID de dispositivo / push token** | Sí | No | Notificaciones del estado del trabajo |

**Prácticas de seguridad:**
- ✅ Los datos se cifran en tránsito (TLS)
- ✅ El usuario puede pedir la eliminación de sus datos
- ✅ Hay forma de solicitar baja (email de soporte)

**¿Por qué se recopila cada dato?** → Funcionalidad de la app + Gestión de cuenta (NO para publicidad ni para terceros).

---

## 3. Permiso de ubicación en segundo plano (declaración especial)

Google audita esto. Cuando te pregunten:

**¿Por qué necesitás ACCESS_BACKGROUND_LOCATION?**
```
VOLT usa la ubicación en segundo plano ÚNICAMENTE para profesionales que activaron su disponibilidad, para que los clientes puedan ver el recorrido del profesional en tiempo real durante un trabajo en curso, incluso si la app está minimizada. No se rastrea la ubicación cuando el profesional está fuera de servicio. La app muestra una divulgación clara y pide consentimiento explícito antes de solicitar el permiso.
```
> Tip: Google suele pedir un video corto mostrando: (1) la pantalla de divulgación, (2) el toggle de disponibilidad, (3) el cliente viendo al profesional en el mapa.

---

## 4. Content rating (clasificación)
- Cuestionario: responder que NO hay violencia, contenido sexual, drogas, etc.
- Resultado esperado: apta para todo público / PEGI 3.

---

## 5. Assets gráficos (lo que hay que subir)

| Asset | Tamaño | Estado |
|---|---|---|
| Ícono de la app | 512×512 PNG | ✅ ya tenés (`assets/icon.png`) |
| Gráfico de portada (feature) | 1024×500 PNG | ⬜ falta — se hace fácil |
| Capturas teléfono | mín. 2, hasta 8 (1080×1920) | ⬜ sacar de la app andando |
| Capturas (opcional) | tablet | no aplica |

**Capturas sugeridas (sacar del APK cuando pruebes):**
1. El mapa con profesionales cerca
2. La WorkerCard con reputación
3. El seguimiento en tiempo real (timeline + mapa)
4. La pantalla de pago seguro
5. El modo emergencia

---

## 6. Otros campos
- **Email de contacto:** soporte@volt.app (definir mail real)
- **Política de privacidad (URL):** subir `web/privacy.html` y poner el link
- **Público objetivo:** mayores de 18 (maneja pagos y datos sensibles)

---

## ⏱️ Recordá el cuello de botella
Cuenta nueva personal → **test cerrado con 12 testers × 14 días** antes de producción.
Empezá ese test apenas tengas el AAB y la cuenta verificada.
