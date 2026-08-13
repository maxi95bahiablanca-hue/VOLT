/** Corre una promesa con tiempo máximo. Si se pasa, sigue de largo.
 *
 *  🔴 10-ago-2026 — Hernán y Esteban quedaron clavados en "Activando…" y no
 *  pudieron ponerse disponibles. La causa es de fondo: activarse encadena seis
 *  pasos (aviso, permiso, GPS, guardar ubicación, marcar disponible, prender el
 *  seguimiento) y **si cualquiera de ellos no vuelve nunca**, el `await` queda
 *  esperando, el `finally` no corre y el botón se queda así hasta que cierran
 *  la app. Perseguir cuál de los seis se colgó es al pedo: ninguno puede tener
 *  permiso de colgar la pantalla.
 *
 *  🔴 11-ago-2026 — el mismo molde apareció en la pantalla de aceptar un
 *  trabajo (WorkerIncomingScreen), que es la que decide si el profesional cobra
 *  o no cobra. Por eso el helper dejó de vivir dentro de HomeScreen y pasó acá:
 *  es la regla de la app, no un detalle de una pantalla. Vale para cualquier
 *  llamada de red que bloquee un botón.
 *
 *  Ojo: se traga el error igual que el vencimiento — las dos ramas devuelven
 *  `siFalla`. Si hace falta distinguir "salió bien" de "no volvió", pasar un
 *  centinela propio como `siFalla` y comparar por identidad. */
export const conTiempo = (promesa, ms, siFalla = null) =>
  Promise.race([
    Promise.resolve(promesa).catch(() => siFalla),
    new Promise((res) => setTimeout(() => res(siFalla), ms)),
  ]);

export default conTiempo;
