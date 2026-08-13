/** La foto de cada oficio.
 *
 *  Las fotos son las mismas que usa la web y se sirven desde ahí
 *  (`bolt.com.ar/fotos/oficios/*.jpg`): NO van dentro del paquete de la app.
 *  Meterlas adentro sumaría más de un mega a cada actualización por aire, que
 *  se baja entero cada vez y lo paga el usuario en datos. Servidas por HTTP,
 *  las cachea el sistema y sólo se bajan la primera vez.
 *
 *  Los 17 oficios del catálogo (tabla `professions`) están cubiertos. Si mañana
 *  se agrega uno y no tiene foto, `fotoDeOficio` devuelve null y quien lo use
 *  cae al ícono de siempre — nunca a una imagen rota.
 */
// `/chip/` son los recortes cuadrados de 120 px: las 17 juntas pesan 57 kB.
// Las originales suman más de 1,5 MB — bajarlas enteras para dibujarlas de 34 px
// sería gastarle los datos al usuario para nada.
const BASE = 'https://bolt.com.ar/fotos/oficios/chip/';

// La clave es el nombre normalizado (sin acentos, en minúscula), así un cambio
// de mayúsculas o una tilde en la base no rompe el mapeo.
const ARCHIVOS = {
  'aire acondicionado':      'aire-acondicionado.jpg',
  'alarmas / camaras':       'alarmas.jpg',
  'albanil':                 'albanil.jpg',
  'calderas':                'calderas.jpg',
  'carpintero':              'carpintero.jpg',
  'cerrajero':               'cerrajero.jpg',
  'cortinas':                'cortinas.jpg',
  'durlock':                 'durlock.jpg',
  'electricista':            'electricista.jpg',
  'encomiendas / fletes':    'fletes.jpg',
  'gasista':                 'gasista.jpg',
  'heladeras y lavarropas':  'electrodomesticos.jpg',
  'herrero':                 'herrero.jpg',
  'jardinero':               'jardinero.jpg',
  'limpieza':                'limpieza.jpg',
  'pintor':                  'pintor.jpg',
  'plomero':                 'plomero.jpg',
};

const normalizar = (s) => (s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')   // saca las tildes
  .toLowerCase().trim();

export function fotoDeOficio(nombre) {
  const archivo = ARCHIVOS[normalizar(nombre)];
  return archivo ? BASE + archivo : null;
}

export default fotoDeOficio;
