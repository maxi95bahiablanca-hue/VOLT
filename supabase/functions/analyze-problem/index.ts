import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// Modelo gratis y multimodal (ve fotos, entiende audio). Ver project_bolt_ia_y_flujos.
const MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

// Oficios de BOLT (espejo de src/config/oficios.js — mantener sincronizado).
const OFICIOS = `
reparacion (van al domicilio a arreglar algo, 1 dirección):
  1 Electricista, 2 Plomero, 3 Gasista, 7 Cerrajero, 8 Heladeras y lavarropas, 16 Aire acondicionado, 19 Herrero
obra (proyecto/servicio programado, 1 dirección, puede llevar días):
  4 Pintor, 5 Albañil, 6 Carpintero, 9 Jardinero, 10 Limpieza, 17 Alarmas / Cámaras, 18 Durlock
logistica (transporte, necesita ORIGEN y DESTINO):
  11 Encomiendas / Fletes`;

const SYSTEM = `Sos la plataforma BOLT (app de oficios a domicilio en Argentina). NO sos un personaje ni tenés nombre: hablás en primera persona plural ("nosotros", "te ayudamos", "lo resolvemos"), como la marca misma. Tono argentino, cálido, breve.

Tu trabajo: el cliente cuenta qué necesita (texto, audio o foto). Vos detectás el OFICIO y armás un cuestionario CORTO y ESPECÍFICO PARA ESE PROBLEMA, para que el profesional llegue sabiendo todo y cotice bien.

Oficios disponibles (con su id y tipo de flujo):${OFICIOS}

Cómo trabajás:
1. DEDUCÍ del mensaje todo lo que puedas y devolvelo en "ya_entendi" (lista corta de lo que captaste, ej: ["Plomero", "pérdida de caño", "en el baño"]). Si hay foto, usala.
2. Generá en "preguntas" SOLO lo que te falta para que el profesional cotice bien. Las preguntas DEPENDEN DEL PROBLEMA PUNTUAL, no del oficio en general: "poner un enchufe" pregunta cosas distintas a "saltó la térmica", aunque ambos sean Electricista. Pensá como un profesional experto de ESE oficio: ¿qué necesitarías saber para presupuestar sin ir a ciegas?
3. Cada pregunta lleva 2 a 4 "opciones" concretas para tocar. Poné "permite_texto": true si además conviene dejar escribir un detalle. (La app SIEMPRE agrega sola una opción "Otro / lo escribo", no hace falta que la incluyas.)
3.b PEDIR FOTOS. Una de las preguntas puede ser una FOTO, con "tipo": "foto" (las de siempre son "tipo": "opciones", que es el valor por defecto). Usala cuando VER el problema cambie de verdad el presupuesto, y explicá en la pregunta QUÉ tiene que entrar en la foto, en criollo:
   - Reparaciones: el detalle de lo roto ("una foto de la canilla que pierde, de cerca").
   - Trabajos que se cotizan por tamaño (pintura, durlock, herrería, albañilería, fletes): pedí la pieza o el ambiente LO MÁS ENTERO POSIBLE, parado desde la puerta, porque de ahí se saca la medida. Si son varias piezas, una foto de cada una.
   - "max_fotos": cuántas pedís (1 a 3; si son varias piezas o ambientes, 3). No pidas más de las que necesites: cada foto es tiempo del cliente.
   - Si con el texto o con la foto que ya mandó alcanza, NO pidas fotos.
   - Nunca pidas fotos de documentos, del DNI ni de nada personal.
   - La foto SIEMPRE es opcional para el cliente: la app le deja saltearla y no hay que insistir ni advertirle nada.
   - IMPORTANTE: aunque sea de tipo "foto", la pregunta lleva igual "opciones", con estas dos exactas: ["Te la mando ahora", "No puedo sacar fotos"]. Las apps viejas no saben abrir la cámara y muestran esas opciones como respuesta escrita; las nuevas las ignoran y abren la cámara. Sin esas dos opciones, al cliente le queda una pregunta que no puede contestar.
4. MÁXIMO 3 preguntas EN TOTAL (contando la de la foto). Si con lo que ya sabés alcanza, devolvé "preguntas": [] y "ready": true. No preguntes de más.
5. NO pidas la dirección: la app ya la tiene (asumilo). EXCEPCIÓN: en logística/flete preguntá origen y destino y si hay escaleras/ascensor.
6. NUNCA preguntes cuándo lo necesita (ni "ahora o agendar"): eso lo coordina después con el profesional. No es asunto tuyo.
7. "resumen": un texto corto y claro para el profesional con lo esencial del problema (sin las respuestas del cuestionario, esas las suma la app).
8. "reply": una frase cálida y breve para el cliente (ej: "¡Listo! Ya casi. Un par de cositas 👇" o, si no faltan preguntas, "Perfecto, te busco el profesional 👌").
9. Si el mensaje no tiene que ver con ningún oficio, dejá oficio/profession_id vacíos, preguntas: [], ready: false, y en "reply" pedile amablemente que cuente qué necesita resolver.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
    const ANON         = Deno.env.get('SUPABASE_ANON_KEY')!;
    const GEMINI       = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI) return json({ error: 'IA no configurada' }, 503);

    // Solo usuarios autenticados de la app (evita abuso de la cuota).
    const auth = req.headers.get('Authorization') ?? '';
    const anon = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return json({ error: 'No autorizado' }, 401);

    // Entrada: el mensaje nuevo (texto y/o foto y/o audio) + historial de la charla.
    const { message, imageBase64, imageMime, audioBase64, audioMime, history } = await req.json().catch(() => ({}));

    // Armar los turnos para Gemini (history es [{ role: 'user'|'model', text }])
    const contents: unknown[] = [];
    if (Array.isArray(history)) {
      for (const h of history) {
        if (!h?.text) continue;
        contents.push({ role: h.role === 'model' ? 'model' : 'user', parts: [{ text: String(h.text) }] });
      }
    }

    // Turno nuevo del cliente (texto + adjuntos)
    const parts: unknown[] = [];
    if (message) parts.push({ text: String(message) });
    if (imageBase64) parts.push({ inline_data: { mime_type: imageMime || 'image/jpeg', data: imageBase64 } });
    if (audioBase64) parts.push({ inline_data: { mime_type: audioMime || 'audio/mp4', data: audioBase64 } });
    if (parts.length === 0) return json({ error: 'mensaje vacío' }, 400);
    contents.push({ role: 'user', parts });

    const body = {
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents,
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            reply:         { type: 'string' },    // lo que le decimos al cliente
            ready:         { type: 'boolean' },    // true si NO faltan preguntas
            oficio:        { type: 'string' },
            profession_id: { type: 'integer' },
            tipo:          { type: 'string' },     // reparacion | obra | logistica
            urgencia:      { type: 'string' },     // alta | media | baja
            ya_entendi:    { type: 'array', items: { type: 'string' } },  // lo deducido
            preguntas: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id:            { type: 'string' },   // campo corto, ej "pierde_agua"
                  pregunta:      { type: 'string' },
                  tipo:          { type: 'string' },    // "opciones" (default) | "foto"
                  opciones:      { type: 'array', items: { type: 'string' } },
                  permite_texto: { type: 'boolean' },
                  max_fotos:     { type: 'integer' },   // solo si tipo = "foto" (1 a 3)
                },
                required: ['id', 'pregunta', 'opciones'],
              },
            },
            resumen:       { type: 'string' },     // resumen para el profesional
          },
          required: ['reply', 'ready'],
        },
      },
    };

    const r = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      // 5xx → la app cae al formulario clásico (fallback). La IA nunca bloquea.
      return json({ error: 'IA no disponible', detail }, 502);
    }

    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: 'IA sin respuesta' }, 502);

    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(text); }
    catch { return json({ error: 'IA formato inválido' }, 502); }

    return json({ ok: true, ...parsed });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
