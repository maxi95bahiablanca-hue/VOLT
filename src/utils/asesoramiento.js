/* GEMELO de bolt-web/asesoramiento/datos.js — si cambia una ficha alla, cambia aca.
   Va duplicado y no por red porque se consulta parado frente al problema,
   que es justo donde puede no haber senal. */

/* ══════════════════════════════════════════════════════════════════════════
   EL CONTENIDO DEL ASESORAMIENTO

   Va aparte de la página a propósito: agregar un problema nuevo es sumar un
   objeto acá, sin tocar el diseño ni el buscador.

   Cada ficha tiene:
     oficio    — para el filtro y el color del chip
     titulo    — el problema, dicho como lo diría el cliente
     resumen   — una línea; es lo que se ve en la tarjeta y lo que busca el buscador
     sintomas  — cómo darse cuenta
     causas    — por qué pasa
     hacer     — lo que puede hacer uno mismo, sin riesgo
     ojo       — 🔴 cuándo NO tocar y llamar a alguien
     costo     — orden de magnitud del arreglo (sin precios, que envejecen mal)
     marcas    — lo que se consigue en Bahía Blanca, para saber qué pedir

   🔴 REGLA DE CONTENIDO: nada de instrucciones para meter mano en gas,
   electricidad de la acometida o estructura. Esta página sirve para
   ENTENDER el problema y saber a quién llamar, no para reemplazar al
   profesional. Donde hay riesgo, se dice.
   ══════════════════════════════════════════════════════════════════════════ */

const FICHAS = [

  /* ── PINTURA ─────────────────────────────────────────────────────────── */
  {
    oficio: 'Pintor', foto: 'pintor',
    titulo: 'La pintura se ampolla o se descascara',
    resumen: 'Burbujas, escamas y pintura que se levanta sola de la pared.',
    sintomas: 'Ampollas que al pincharlas dejan el revoque a la vista, o capas que se desprenden en escamas grandes.',
    causas: 'Casi siempre humedad atrás de la pintura: una filtración, un caño perdiendo o humedad de cimiento. También pasa cuando se pintó sobre una pared sucia, con polvo, o sobre cal vieja sin fijador.',
    hacer: 'Rascar toda la parte floja hasta llegar a lo firme y esperar a que la pared esté seca de verdad. Recién ahí fijador al agua, enduido si quedó desparejo, y dos manos de látex.',
    ojo: 'Si la mancha vuelve al mes, el problema no es la pintura: hay agua entrando. Pintar de nuevo es tirar la plata hasta que se corte la filtración.',
    costo: 'Bajo si es una pared; alto si hay que resolver la humedad primero.',
    marcas: 'Fijador y látex: Alba, Sinteplast, Tersuave. Para humedad de cimiento, membrana o hidrolaca del tipo Sika o Weber.'
  },
  {
    oficio: 'Pintor', foto: 'pintor-sin-gente-1',
    titulo: 'Cuánta pintura necesito',
    resumen: 'La cuenta rápida para no comprar de más ni quedarte a mitad de camino.',
    sintomas: '',
    causas: '',
    hacer: 'Metros de pared = (largo de cada pared × altura), sumadas todas, menos puertas y ventanas. Después: dividí los metros por 6,5 y multiplicá por las manos que vayas a dar. Para dos manos es lo mismo que multiplicar los metros por 0,3.',
    ojo: 'El tarro dice que rinde 10 o 12 m² por litro. Ese número sale del laboratorio: película fina, rodillo nuevo y pared sellada. En una casa de verdad el rodillo carga de más, la pared tiene textura, la primera mano chupa y siempre queda pintura en la bandeja y en el fondo del tarro. El rendimiento de obra es la mitad del que dice el envase, y ese es el que hay que usar para ir a comprar. Si además cambiás de un color fuerte a uno claro, calculá tres manos.',
    costo: 'Un dormitorio de 3×3 con 2,60 de alto tiene unos 28 m² de pared: 9 litros para las dos manos, o 12 si también va el techo. Un balde de 20 L te alcanza para las paredes y el techo juntos, con algo de sobra.',
    marcas: 'El látex económico rinde menos todavía y termina saliendo igual o más caro. Y si querés el número fino en vez de la cuenta de bolsillo, la calculadora de materiales de BOLT te lo da con las medidas de tu ambiente.'
  },
  {
    oficio: 'Pintor', foto: 'pintor-sin-gente-2',
    titulo: 'Manchas de humedad que vuelven a aparecer',
    resumen: 'Pintás, y a las semanas el cerco amarronado está de nuevo.',
    sintomas: 'Mancha con borde marcado, más oscura en el contorno. A veces con olor a encierro.',
    causas: 'Filtración de techo o de un caño, o humedad que sube del cimiento (esa hace un manchón parejo hasta un metro del piso).',
    hacer: 'Ubicar de dónde viene antes de pintar. Si es de arriba, se seca cuando deja de llover; si sube del piso, la mancha está siempre igual, llueva o no.',
    ojo: 'El "sellador de manchas" tapa la marca pero no el agua. Sirve como último paso, nunca como solución.',
    costo: 'Depende de la causa: una teja corrida es barato, capilaridad de cimiento es obra.',
    marcas: 'Para tapar la mancha una vez seco: fijador al aceite o sellador tipo Alba Fijasello. Para cortar humedad ascendente hay inyecciones de silicona.'
  },

  /* ── ELECTRICIDAD ────────────────────────────────────────────────────── */
  {
    oficio: 'Electricista', foto: 'electricista',
    titulo: 'Salta la térmica cada vez que prendo algo',
    resumen: 'La llave del tablero se baja sola y hay que subirla a cada rato.',
    sintomas: 'Se corta todo (o media casa) al prender el termotanque, el microondas o la plancha.',
    causas: 'Suele ser sobrecarga: más consumo del que aguanta esa línea. Si salta con un aparato en particular, el problema es el aparato o su enchufe. Si salta sin nada prendido, hay un contacto a tierra en la instalación.',
    hacer: 'Fijate si es siempre con el mismo aparato: desenchufalo y probá un día así. Eso sólo ya le dice al electricista dónde mirar.',
    ojo: '🔴 Si la térmica no sube o sube y salta al toque, no insistas: eso es un cortocircuito y forzarla calienta el cable adentro de la pared. Cortá la llave general y llamá.',
    costo: 'Bajo si es un enchufe o un aparato; medio si hay que tirar una línea nueva.',
    marcas: 'Térmicas y disyuntores: Schneider, Siemens, Genrod, Sica. El disyuntor diferencial NO es opcional: es lo que evita que una pérdida te electrocute.'
  },
  {
    oficio: 'Electricista', foto: 'electricista-2',
    titulo: 'Las luces titilan o bajan cuando arranca la heladera',
    resumen: 'Parpadeo al arrancar motores, o luces que quedan opacas.',
    sintomas: 'Un tirón de luz cada vez que arranca la heladera, el lavarropas o la bomba.',
    causas: 'Caída de tensión: cable de sección chica para lo que se consume, o un empalme flojo que hace resistencia. También puede ser tensión baja de la calle.',
    hacer: 'Anotá a qué hora pasa y con qué aparato. Si le pasa a todo el barrio a la misma hora, es de la red.',
    ojo: '🔴 Un empalme flojo calienta. Si sentís olor a plástico caliente o ves una ficha tostada, cortá esa línea y llamá el mismo día: así empiezan la mayoría de los incendios eléctricos.',
    costo: 'Bajo si es un empalme; alto si hay que recablear.',
    marcas: 'Cable normalizado con sello IRAM. En cable no conviene ahorrar: la sección la define el consumo, no el precio.'
  },
  {
    oficio: 'Electricista', foto: 'electricista',
    titulo: 'Quiero poner un aire y no sé si la instalación aguanta',
    resumen: 'Lo que hay que mirar antes de comprar el equipo.',
    sintomas: '',
    causas: '',
    hacer: 'Un split de 3000 frigorías pide su propia línea desde el tablero, con su térmica. No se cuelga de un enchufe que ya tiene otras cosas. Preguntale al electricista qué sección de cable hay hasta ahí antes de comprar.',
    ojo: '🔴 Enchufar un split en una zapatilla o en una línea de iluminación es la forma más rápida de quemar la instalación.',
    costo: 'Medio: la línea nueva suele costar una fracción del equipo, y evita el problema para siempre.',
    marcas: 'Térmica dedicada según el equipo. Si la casa no tiene disyuntor, es el momento de ponerlo.'
  },

  /* ── PLOMERÍA ────────────────────────────────────────────────────────── */
  {
    oficio: 'Plomero', foto: 'plomero',
    titulo: 'Se tapó el baño y el agua no baja',
    resumen: 'Qué probar antes de llamar, y cuándo no seguir intentando.',
    sintomas: 'El agua sube y baja lento, o vuelve por la rejilla de la ducha.',
    causas: 'Papel y pelos en el sifón cuando es sólo el inodoro. Si se tapa el inodoro Y la rejilla al mismo tiempo, la obstrucción está más abajo, en la cañería principal.',
    hacer: 'Sopapa de goma con agua cubriendo la campana, movimientos firmes y seguidos. Si destapa, tiralé un balde de agua caliente (no hirviendo) para arrastrar el resto.',
    ojo: '🔴 No uses soda cáustica antes de que vaya el plomero: si no destapa, queda un caño lleno de agua con soda que le puede saltar a la cara al trabajar. Avisale siempre si tiraste algo.',
    costo: 'Bajo si es el sifón; medio si hay que abrir una cámara.',
    marcas: 'Sopapa buena y, si se repite seguido, conviene revisar la pendiente del caño: una tapa recurrente en el mismo lugar es un problema de instalación, no de uso.'
  },
  {
    oficio: 'Plomero', foto: 'plomero-2',
    titulo: 'Gotea la canilla y no para',
    resumen: 'Ese "toc… toc…" que además se paga en la factura.',
    sintomas: 'Goteo con la canilla cerrada, o hay que apretarla cada vez más fuerte.',
    causas: 'En las canillas de rosca, el cuerito gastado. En las monocomando, el cartucho cerámico.',
    hacer: 'Cerrá la llave de paso, sacá el volante y fijate qué tiene adentro. Un cuerito cuesta monedas y se cambia con una pinza. El cartucho hay que llevarlo a la casa de repuestos para que te den el mismo.',
    ojo: 'Si al cerrar la llave de paso el goteo sigue, la pérdida es otra: no es la canilla.',
    costo: 'Muy bajo. Una canilla que gotea desperdicia decenas de litros por día.',
    marcas: 'Repuestos: FV, Hidromet, Peirano. Con el modelo del grifo o una foto alcanza para que te den el cartucho correcto.'
  },
  {
    oficio: 'Plomero', foto: 'plomero-3',
    titulo: 'Poca presión en la ducha',
    resumen: 'Sale un hilo de agua, y peor cuando alguien abre otra canilla.',
    sintomas: 'Presión baja sólo en caliente, o en toda la casa, o sólo arriba.',
    causas: 'Si es sólo en caliente: sarro en el termotanque o en la salida. Si es en todo: filtro de la bomba, tanque bajo, o cañería vieja de hierro con incrustación.',
    hacer: 'Probá desenroscar el aireador de la punta de la canilla y limpiarlo: en la mitad de los casos está tapado de sarro y se arregla ahí.',
    ojo: 'Si la presión cayó de golpe y hay ruido de agua corriendo, puede haber una pérdida oculta. Mirá el medidor con todo cerrado: si sigue girando, hay fuga.',
    costo: 'Bajo si es el aireador; alto si hay que renovar cañería.',
    marcas: 'Si la casa es vieja y tiene caño galvanizado, el recambio a termofusión resuelve el problema de raíz.'
  },

  /* ── GAS ─────────────────────────────────────────────────────────────── */
  {
    oficio: 'Gasista', foto: 'gasista',
    titulo: 'Huelo a gas',
    resumen: 'Lo único que hay que hacer, en orden, y sin dudar.',
    sintomas: 'Olor característico, aunque sea leve, adentro de la casa.',
    causas: '',
    hacer: '1) No toques ningún interruptor, ni prendas ni apagues luces, ni uses el teléfono adentro. 2) Abrí puertas y ventanas. 3) Cerrá la llave de paso general del gas si podés llegar sin riesgo. 4) Salí y recién afuera llamá al gasista matriculado o a la emergencia de la distribuidora.',
    ojo: '🔴 Una chispa de una llave de luz alcanza. Esto no es un arreglo para probar uno mismo, y no espera a mañana.',
    costo: 'La revisión es barata comparada con lo que está en juego.',
    marcas: 'Sólo gasista MATRICULADO. Pedile la matrícula: en gas no es un formalismo, es lo que dice que puede hacer el trabajo.'
  },
  {
    oficio: 'Gasista', foto: 'gasista',
    titulo: 'El calefón se apaga solo o no calienta',
    resumen: 'Agua tibia, llama que se corta, o hay que reencenderlo todo el tiempo.',
    sintomas: 'Prende y se apaga a los segundos, o el agua sale tibia con la llave al máximo.',
    causas: 'Termocupla gastada (la pieza que corta el gas si se apaga el piloto), sarro en el serpentín, o salida de gases obstruida.',
    hacer: 'Fijate si el piloto se mantiene con la perilla apretada y se apaga al soltarla: eso apunta a la termocupla, que es una pieza barata.',
    ojo: '🔴 Si el ambiente donde está el calefón no ventila bien o ves hollín negro alrededor de la salida, no lo uses hasta que lo revisen: eso es monóxido, no se huele y mata dormido.',
    costo: 'Bajo la termocupla; medio la limpieza de serpentín.',
    marcas: 'Repuestos según marca del equipo (Orbis, Escorial, Rheem). La revisión anual del tiraje es lo más barato que se puede hacer por la seguridad de la casa.'
  },

  /* ── AIRE ACONDICIONADO ──────────────────────────────────────────────── */
  {
    oficio: 'Aire acondicionado', foto: 'aire-acondicionado',
    titulo: 'El split no enfría como antes',
    resumen: 'Anda, tira aire, pero el ambiente no baja.',
    sintomas: 'Enfría poco, tarda mucho, o la unidad de afuera trabaja sin parar.',
    causas: 'Filtros sucios (lo más común), falta de gas por una pérdida, o el condensador de afuera tapado de tierra y pelusa.',
    hacer: 'Sacá los filtros de la unidad de adentro, lavalos con agua y detergente suave, secalos bien y volvelos a poner. Se hace cada 15 días en temporada y cambia muchísimo.',
    ojo: 'Si le cargaron gas hace poco y ya no enfría, no hace falta "recargar": el gas no se consume. Si falta, hay una pérdida, y cargar de nuevo sin encontrarla es tirar plata dos veces.',
    costo: 'Cero limpiar filtros. Medio la carga con detección de pérdida.',
    marcas: 'Servicio anual antes del verano. Los equipos inverter consumen bastante menos, pero mal instalados rinden igual de mal que cualquiera.'
  },
  {
    oficio: 'Aire acondicionado', foto: 'aire-acondicionado-2',
    titulo: 'Gotea agua adentro de casa',
    resumen: 'La unidad de adentro chorrea por la pared.',
    sintomas: 'Agua cayendo del split, o mancha de humedad justo abajo.',
    causas: 'La manguera de desagote tapada o mal pendiente. También pasa con el equipo mal nivelado.',
    hacer: 'Apagalo para que no siga mojando la pared. La manguera se destapa soplándola o con aire, pero conviene que lo haga el técnico para no meter la suciedad hacia adentro.',
    ojo: 'Si el agua cae del lado del enchufe o de una llave de luz, cortá esa línea desde el tablero antes de tocar nada.',
    costo: 'Bajo.',
    marcas: 'En una instalación bien hecha el desagote tiene pendiente continua hacia afuera: si gotea al año de instalado, casi siempre es eso.'
  },

  /* ── ALBAÑILERÍA Y DURLOCK ───────────────────────────────────────────── */
  {
    oficio: 'Albañil', foto: 'albanil',
    titulo: 'Se abrió una grieta en la pared',
    resumen: 'Cuáles son de revoque y cuáles hay que mirar en serio.',
    sintomas: 'Fisuras finas como telaraña, o una grieta marcada que sigue una diagonal.',
    causas: 'Las finas y superficiales suelen ser del revoque, por secado o dilatación. Las diagonales que arrancan en una esquina de ventana o puerta, o las que atraviesan la pared de lado a lado, hablan de movimiento de la estructura.',
    hacer: 'Marcá los extremos con lápiz y la fecha. Si en un mes creció, eso es un dato que vale oro para el que la vaya a ver.',
    ojo: '🔴 Grieta que se ve de los dos lados de la pared, que corta un dintel o que abre más de un par de milímetros: no la tapes, hacela ver. Taparla sólo esconde el problema.',
    costo: 'Bajo si es revoque; alto si es estructural.',
    marcas: 'Para fisuras de revoque: enduido plástico y malla. Para juntas que trabajan, sellador elástico tipo Sika, no enduido común.'
  },
  {
    oficio: 'Durlock', foto: 'durlock',
    titulo: 'Se ven las juntas de las placas',
    resumen: 'Esas líneas que aparecen con el tiempo y arruinan la pared.',
    sintomas: 'Líneas rectas marcadas donde se unen las placas, o tornillos que se dibujan.',
    causas: 'Junta tomada sin cinta, masilla puesta de una sola vez muy gruesa, o estructura con perfiles muy separados que flexa.',
    hacer: 'Se corrige: se abre la junta, se toma con cinta de papel y masilla en tres manos finas, lijando entre una y otra.',
    ojo: 'Si la pared se mueve al apoyarse, el problema son los perfiles, no la masilla. Tapar arriba de eso vuelve a marcarse.',
    costo: 'Bajo.',
    marcas: 'Masilla lista tipo Durlock o Knauf, cinta de papel (no la plástica). En cielorraso conviene junta con malla.'
  },

  /* ── CERRAJERÍA ──────────────────────────────────────────────────────── */
  {
    oficio: 'Cerrajero', foto: 'cerrajero',
    titulo: 'La llave gira pero no abre',
    resumen: 'Antes de forzarla, esto.',
    sintomas: 'La llave entra y gira en falso, o cuesta cada vez más.',
    causas: 'Pasador desgastado, cerradura desalineada por el peso de la puerta, o la puerta hinchada por humedad.',
    hacer: 'Probá levantando un poco la puerta del picaporte mientras girás: si así abre, es alineación y se corrige moviendo la chapa del marco.',
    ojo: '🔴 No le pongas aceite ni WD-40 al bombín: junta tierra y termina de trabarlo. Va grafito en polvo, que es lo que usan los cerrajeros.',
    costo: 'Bajo alinear; medio cambiar la cerradura.',
    marcas: 'Cerraduras: Trabex, Kallay, Prive. Si la puerta da a la calle, mirá que sea de doble paleta o con cilindro de seguridad.'
  },

  /* ── CARPINTERÍA ─────────────────────────────────────────────────────── */
  {
    oficio: 'Carpintero', foto: 'carpintero',
    titulo: 'La puerta roza o no cierra',
    resumen: 'Empeora en verano o cuando llueve.',
    sintomas: 'Raspa contra el marco, o hay que empujarla fuerte para cerrar.',
    causas: 'La madera absorbe humedad y se hincha. También bisagras flojas o un tornillo que se pasó de rosca.',
    hacer: 'Mirá primero las bisagras: si un tornillo gira en falso, se saca, se le mete un taco de madera con cola y se vuelve a atornillar. Muchas veces con eso alcanza.',
    ojo: 'Si cepillás la puerta en pleno verano, en invierno te queda con luz. Conviene ajustar bisagras primero y cepillar sólo si sigue rozando con tiempo seco.',
    costo: 'Muy bajo.',
    marcas: 'Después de cepillar hay que sellar el canto: madera sin terminar chupa humedad y vuelve a hincharse.'
  },

  /* ── HELADERAS Y LAVARROPAS ──────────────────────────────────────────── */
  {
    oficio: 'Heladeras y lavarropas', foto: 'electrodomesticos',
    titulo: 'La heladera no enfría pero el motor anda',
    resumen: 'Se escucha andar, y adentro está tibia.',
    sintomas: 'El freezer enfría y la parte de abajo no, o al revés. Escarcha gruesa en el fondo.',
    causas: 'Escarcha que bloquea el paso de aire, burlete vencido que deja entrar aire tibio, o falta de gas.',
    hacer: 'Desenchufala 8 horas con las puertas abiertas y un trapo abajo. Si después enfría bien, el problema era la escarcha y hay que revisar el sistema de deshielo. Probá el burlete con un billete: si sale sin resistencia, está vencido.',
    ojo: 'No aceleres el deshielo con secador de pelo ni con cuchillo: se pincha el circuito y ahí sí se termina la heladera.',
    costo: 'Bajo el burlete; medio el deshielo; alto la carga de gas.',
    marcas: 'El burlete se consigue por modelo. Antes de cambiar la heladera, hacela ver: muchas veces es una pieza de poco valor.'
  },
  {
    oficio: 'Heladeras y lavarropas', foto: 'electrodomesticos-2',
    titulo: 'El lavarropas no centrifuga',
    resumen: 'Termina el ciclo y la ropa sale chorreando.',
    sintomas: 'No arranca el centrifugado, o intenta y se corta.',
    causas: 'Filtro de desagote tapado (lo más común), carga desbalanceada, o carbones del motor gastados.',
    hacer: 'Buscá la tapita del filtro abajo al frente, poné un trapo y una fuente, y limpialo. Salen monedas, pelusa y clips. También probá repartir la ropa a mano y repetir el centrifugado.',
    ojo: 'Si hace ruido fuerte y se mueve mucho, fijate que no le hayan quedado puestas las trabas de transporte de cuando lo mudaron.',
    costo: 'Cero el filtro; medio los carbones.',
    marcas: 'Limpiar el filtro cada dos meses evita la mitad de las visitas técnicas.'
  }
];

export { FICHAS };
export default FICHAS;
