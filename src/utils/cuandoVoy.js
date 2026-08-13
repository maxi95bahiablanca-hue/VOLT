import { Alert } from 'react-native';
import jobService from '../services/jobService';
import chatService from '../services/chatService';

/** Aceptar NO quiere decir "salgo ahora": el 90% de las veces se coordina para
 *  otro momento. Sin esta pregunta, jobs.scheduled_for queda vacío, el cliente
 *  ve "va en camino" cuando nadie salió, y el trabajo termina en la lista de
 *  trabados como "aceptó y no fue" (Maxi, 31-jul-2026).
 *
 *  🔴 8-ago-2026 — CUÁNDO se pregunta importa tanto como la pregunta.
 *  Estaba enganchada al "Aceptar" de WorkerIncomingScreen, que en un PRESUPUESTO
 *  todavía no es un trabajo: el cliente ni eligió. Si ahí tocaba "Voy ahora" se
 *  escribía `on_the_way_at` antes de que existiera el trabajo → cuando el
 *  cliente lo elegía, el profesional ya no veía el botón "Voy en camino" (la app
 *  lo daba por salido) y el cliente veía "está en camino" sin que nadie hubiera
 *  salido. Por eso vive acá: en trabajo directo se pregunta al aceptar, y en
 *  presupuesto recién cuando el cliente lo elige.
 */
export const preguntarCuandoVoy = (jobId) => {
  const guardar = async (campos, aviso) => {
    try {
      await jobService.setSchedule(jobId, campos);
      if (aviso) chatService.sendSystemMessage(jobId, aviso).catch(() => {});
    } catch (e) { /* que no frene nada: el vigilante lo va a levantar igual */ }
  };
  const enHoras = (h) => new Date(Date.now() + h * 3600000).toISOString();
  const enDiasALas = (dias, hora) => {
    const d = new Date();
    d.setDate(d.getDate() + dias);
    d.setHours(hora, 0, 0, 0);
    return d.toISOString();
  };

  // Segundo paso: sólo si no va hoy. Va aparte porque en Android Alert.alert
  // muestra COMO MUCHO 3 botones (positive/negative/neutral): el cuarto no se
  // dibuja. Encadenar dos alerts nativos es la única forma de dar las cuatro
  // opciones sin un modal propio — y un modal propio acá no sirve, porque la
  // pantalla se desmonta apenas acepta y se lo llevaría puesto.
  const preguntarQueDia = () => {
    Alert.alert(
      '¿Qué día vas?',
      'Después ajustan la hora exacta por el chat.',
      [
        { text: 'Mañana', onPress: () => guardar(
            { scheduled_for: enDiasALas(1, 10) }, 'Quedó en ir mañana. Coordinen la hora por acá 👇') },
        { text: 'Pasado mañana', onPress: () => guardar(
            { scheduled_for: enDiasALas(2, 10) }, 'Quedó en ir pasado mañana. Coordinen la hora por acá 👇') },
        // Sin fecha elegida: se agenda a 3 días para que el vigilante no lo dé
        // por trabado, y el aviso deja claro que el día se define en el chat.
        { text: 'Lo arreglo por chat', onPress: () => guardar(
            { scheduled_for: enDiasALas(3, 10) }, 'El profesional va a coordinar el día con vos por acá 👇') },
      ],
      { cancelable: false }
    );
  };

  // "Voy ahora" es exactamente el botón "Voy en camino" de la pantalla del
  // trabajo: tiene que pasar por la misma RPC. Escribir `on_the_way_at` a mano
  // (que es lo que hacía) abría la ventana de ubicación pero dejaba el viaje sin
  // contar y sin código nuevo para la puerta.
  const salirAhora = async () => {
    try {
      await jobService.salirAlDomicilio(jobId);
      chatService.sendSystemMessage(jobId, 'El profesional ya salió para tu domicilio 🚗').catch(() => {});
    } catch {
      await guardar({ on_the_way_at: new Date().toISOString() }, 'El profesional ya salió para tu domicilio 🚗');
    }
  };

  Alert.alert(
    '¿Cuándo vas?',
    'El cliente lo ve en su pantalla. Si vas ahora, decíselo; si es para más tarde, también.',
    [
      { text: 'Voy ahora', onPress: salirAhora },
      { text: 'Hoy más tarde', onPress: () => guardar(
          { scheduled_for: enHoras(4) }, 'Quedó en ir hoy más tarde. Coordinen la hora por acá 👇') },
      { text: 'Otro día…', onPress: preguntarQueDia },
    ],
    { cancelable: false }
  );
};
