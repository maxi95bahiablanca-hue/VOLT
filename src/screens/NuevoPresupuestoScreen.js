import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView,
  ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView, Linking, Clipboard, Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { showSuccess, showError } from '../utils/toast';
import presupuestoService, {
  linkPresupuesto, nombreEmpresa, mensajePresupuesto, linkWhatsAppPresupuesto,
} from '../services/presupuestoService';
import professionService from '../services/professionService';

// ─────────────────────────────────────────────────────────────────────────────
// LA PANTALLA. Hacer un presupuesto tiene que llevar menos de un minuto.
//
// Por eso arriba de todo hay exactamente DOS campos —qué trabajo y cuánto— y
// nada más. El cliente es opcional. El detalle (ítems, notas, validez) vive
// detrás de "Agregar detalle" y no navega a ningún lado: si para presupuestar
// hay que llenar un formulario, el profesional lo sigue haciendo por WhatsApp
// y BOLT no se entera del trabajo.
//
// Y NUNCA se pide crear el cliente antes. Recién DESPUÉS de que el presupuesto
// existe y ya salió, se pregunta si lo guarda. El historial se arma solo.
// ─────────────────────────────────────────────────────────────────────────────

const soloDigitos = (s) => String(s ?? '').replace(/\D/g, '');

// Material o mano de obra. Es la primera pregunta que se hace cualquiera
// frente a un presupuesto de oficio ("¿cuánto es el material y cuánto es tu
// trabajo?"), y sin la respuesta el número parece caro. Clasificar es
// opcional, pero cada ítem arranca en `material`: en un desglose de oficio es
// lo más frecuente, así el caso común no cuesta ni un toque.
const TIPOS = [
  { key: 'material', label: 'Material',     color: '#7EA6FF' },
  { key: 'obra',     label: 'Mano de obra', color: '#FFD600' },
];
const tipoDe    = (it) => (it?.tipo === 'obra' ? 'obra' : 'material');
const colorTipo = (t)  => (t === 'obra' ? '#FFD600' : '#7EA6FF');

// Formato de miles mientras escribe: 180000 → "180.000". Sin esto nadie sabe
// si puso ciento ochenta mil o un millón ochocientos.
const formatMiles = (s) => {
  const d = soloDigitos(s).slice(0, 12);
  return d ? Number(d).toLocaleString('es-AR') : '';
};

const NuevoPresupuestoScreen = ({ professional, onClose, onCreado }) => {
  // Lo obligatorio
  const [descripcion, setDescripcion] = useState('');
  const [totalTxt, setTotalTxt]       = useState('');
  const [totalManual, setTotalManual] = useState(false);

  // Para quién (opcional)
  const [nombre, setNombre]     = useState('');
  const [tel, setTel]           = useState('');
  const [clienteId, setClienteId] = useState(null);
  const [clientes, setClientes] = useState([]);
  // Lo que hay en el portapapeles, si parece un teléfono. Se mira una sola vez
  // al abrir: el flujo real es copiar el número en WhatsApp y venir para acá.
  const [telPegable, setTelPegable] = useState('');

  // El detalle (opcional, plegado)
  const [abierto, setAbierto] = useState(false);
  const [items, setItems]     = useState([]);
  const [notas, setNotas]     = useState('');
  const [validez, setValidez] = useState('');

  // Qué oficio le pidieron. Opcional y adentro del detalle, para no romper la
  // regla del minuto: es lo que después arma los chips de la ficha del cliente
  // ("a esta señora le hiciste electricidad en marzo y plomería en agosto").
  const [oficios, setOficios]         = useState([]);
  const [profesionId, setProfesionId] = useState(null);

  const [saving, setSaving] = useState(false);

  // Después de crear
  const [creado, setCreado] = useState(null);
  const [clienteEnLibreta, setClienteEnLibreta] = useState(false);
  const [guardandoCliente, setGuardandoCliente] = useState(false);

  const empresa = nombreEmpresa(professional);
  const total   = Number(soloDigitos(totalTxt)) || 0;
  const valido  = descripcion.trim().length > 0 && total > 0;

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const cs = await presupuestoService.listarClientes(professional.id);
        if (vivo) setClientes(cs);
      } catch { /* la libreta es una comodidad: si falla, se escribe a mano */ }
    })();
    return () => { vivo = false; };
  }, [professional?.id]);

  // ¿Vino de copiar un número en WhatsApp? Se mira una sola vez, al abrir.
  // Sólo se ofrece si parece un teléfono argentino (8 a 13 dígitos y nada raro):
  // no queremos sugerir pegar cualquier cosa que haya quedado copiada.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const txt = (await Clipboard.getString()) || '';
        const d = txt.replace(/\D/g, '');
        const pareceTel = /^[\d\s()+-]{8,20}$/.test(txt.trim()) && d.length >= 8 && d.length <= 13;
        if (vivo && pareceTel) setTelPegable(txt.trim());
      } catch { /* sin portapapeles se escribe a mano, como siempre */ }
    })();
    return () => { vivo = false; };
  }, []);

  // Primero los oficios que el profesional eligió al registrarse; si no tiene
  // ninguno cargado, el catálogo entero (nunca lo dejamos sin poder elegir).
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        let lista = await professionService.getForProfessional(professional.id);
        if (!lista?.length) lista = await professionService.getProfessions();
        if (vivo) setOficios(lista ?? []);
      } catch { /* el oficio es opcional: si no carga, el presupuesto sale igual */ }
    })();
    return () => { vivo = false; };
  }, [professional?.id]);

  // Si carga ítems, el total se calcula solo. Pero se puede pisar a mano y
  // desde ese momento manda lo que escribió el profesional: él sabe qué cobra.
  const sumaItems = useMemo(
    () => items.reduce((acc, i) => acc + (Number(i.cantidad) || 0) * (Number(soloDigitos(i.precio)) || 0), 0),
    [items],
  );

  // Los dos subtotales, en vivo mientras carga. Es lo que le confirma que está
  // cargando bien sin tener que sumar de cabeza.
  const desglose = useMemo(() => {
    let material = 0, obra = 0;
    items.forEach((i) => {
      const monto = (Number(i.cantidad) || 0) * (Number(soloDigitos(i.precio)) || 0);
      if (!monto) return;
      if (tipoDe(i) === 'obra') obra += monto;
      else                      material += monto;
    });
    return { material, obra };
  }, [items]);

  useEffect(() => {
    if (totalManual) return;
    if (!items.length) return;
    setTotalTxt(sumaItems ? formatMiles(String(sumaItems)) : '');
  }, [sumaItems, items.length, totalManual]);

  const setItem = (idx, campo, valor) =>
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, [campo]: valor } : it)));

  const addItem = () => { setAbierto(true); setItems(prev => [...prev, { descripcion: '', cantidad: '1', precio: '', tipo: 'material' }]); };
  const delItem = (idx) => setItems(prev => prev.filter((_, i) => i !== idx));

  const usarCliente = (c) => {
    setNombre(c.nombre || '');
    setTel(c.telefono || '');
    setClienteId(c.id);
  };

  // ─── Crear ────────────────────────────────────────────────────────────────
  const crear = async (enviarAhora) => {
    if (!valido) {
      showError('Escribí qué trabajo es y cuánto sale. Con eso alcanza.', 'Falta lo mínimo');
      return;
    }
    setSaving(true);
    try {
      const row = await presupuestoService.crear({
        professionalId: professional.id,
        clienteId,
        clienteNombre:  nombre,
        clienteTel:     tel,
        descripcion,
        total,
        notas,
        validezDias:    validez,
        profesionId,
      });

      const conItems = items.filter(i => (i.descripcion || '').trim());
      if (conItems.length) {
        await presupuestoService.agregarItems(
          row.id,
          conItems.map(i => ({
            descripcion:     i.descripcion,
            cantidad:        Number(i.cantidad) || 1,
            precio_unitario: Number(soloDigitos(i.precio)) || 0,
            tipo:            tipoDe(i),
          })),
        );
      }

      // enviarAhora: true = WhatsApp · 'compartir' = el compartir de Android
      if (enviarAhora) {
        try { await presupuestoService.marcarEnviado(row.id); row.estado = 'enviado'; } catch { /* el envío no puede tapar al presupuesto ya creado */ }
        if (enviarAhora === 'compartir') compartir(row);
        else                             abrirWhatsApp(row);
      }

      // ¿Ya lo tiene en la libreta? Se pregunta ACÁ, con el presupuesto hecho.
      let yaEsta = !!clienteId;
      if (!yaEsta && tel.trim()) {
        try { yaEsta = !!(await presupuestoService.buscarClientePorTel(professional.id, tel)); } catch { /* si falla, se ofrece guardar igual */ }
      }
      setClienteEnLibreta(yaEsta);

      setCreado(row);
      onCreado?.(row);
    } catch (e) {
      showError('No se pudo crear el presupuesto. Probá de nuevo en un momento.');
    } finally {
      setSaving(false);
    }
  };

  const textoDe = (row) => mensajePresupuesto({
    numero: row.numero, empresa, descripcion: row.descripcion, total: row.total, token: row.token,
  });

  const abrirWhatsApp = (row) => {
    Linking.openURL(linkWhatsAppPresupuesto(row.cliente_tel || tel, textoDe(row)))
      .catch(() => showError('No pudimos abrir WhatsApp. Copiá el link y mandalo a mano.'));
  };

  // El compartir nativo de Android: mail, Telegram, guardarlo, lo que tenga.
  // Es del core de React Native, no hace falta instalar nada.
  const compartir = (row) => {
    Share.share({ message: textoDe(row) })
      .catch(() => showError('No pudimos abrir el menú de compartir. Copiá el link y mandalo a mano.'));
  };

  const copiarLink = (row) => {
    Clipboard.setString(linkPresupuesto(row.token));
    showSuccess('Link copiado. Pegalo donde quieras mandarlo.');
  };

  const guardarEnLibreta = async () => {
    setGuardandoCliente(true);
    try {
      await presupuestoService.guardarCliente({
        professionalId: professional.id,
        nombre,
        telefono: tel,
      });
      setClienteEnLibreta(true);
      showSuccess(`${nombre.trim().split(' ')[0]} quedó en tus clientes.`);
    } catch {
      showError('No se pudo guardar el cliente. Probá desde "Clientes".');
    } finally {
      setGuardandoCliente(false);
    }
  };

  // ─── PANTALLA DE ÉXITO ────────────────────────────────────────────────────
  if (creado) {
    const primerNombre = (nombre || '').trim().split(' ')[0];
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="arrow-back" size={24} color="#F5F5F5" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Presupuesto N°{creado.numero}</Text>
          <View style={{ width: 24 }} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.okIconWrap}>
            <Ionicons name="checkmark" size={38} color="#0A0A0A" />
          </View>
          <Text style={styles.okTitle}>Presupuesto N°{creado.numero} listo</Text>
          <Text style={styles.okSub}>
            ${Number(creado.total).toLocaleString('es-AR')}
            {nombre.trim() ? ` · para ${nombre.trim()}` : ''}
          </Text>

          <TouchableOpacity style={styles.waBtn} onPress={() => abrirWhatsApp(creado)} activeOpacity={0.85}>
            <Ionicons name="logo-whatsapp" size={20} color="#0A0A0A" />
            <Text style={styles.waBtnText}>
              {creado.estado === 'borrador' ? 'Enviar por WhatsApp' : 'Volver a enviar por WhatsApp'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ghostBtn} onPress={() => copiarLink(creado)} activeOpacity={0.8}>
            <Ionicons name="link-outline" size={17} color="#FFD600" />
            <Text style={styles.ghostBtnText}>Copiar link</Text>
          </TouchableOpacity>

          {/* Recién ahora se le pregunta por el cliente. Nunca antes. */}
          {!!primerNombre && !clienteEnLibreta && (
            <View style={styles.askCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.askTitle}>¿Guardar a {primerNombre} en tus clientes?</Text>
                <Text style={styles.askSub}>Para la próxima ya lo tenés cargado.</Text>
              </View>
              <TouchableOpacity
                style={styles.askBtn}
                onPress={guardarEnLibreta}
                disabled={guardandoCliente}
                activeOpacity={0.85}
              >
                {guardandoCliente
                  ? <ActivityIndicator color="#0A0A0A" size="small" />
                  : <Text style={styles.askBtnText}>Guardar</Text>}
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity style={styles.primaryBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Listo</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ─── FORMULARIO ───────────────────────────────────────────────────────────
  const ultimos = clientes.slice(0, 5);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose}>
          <Ionicons name="arrow-back" size={24} color="#F5F5F5" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Nuevo presupuesto</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {/* ── Lo único obligatorio ── */}
          <Text style={styles.bigLabel}>¿Qué trabajo es?</Text>
          <TextInput
            style={styles.bigInput}
            value={descripcion}
            onChangeText={setDescripcion}
            placeholder="Cambio de termotanque 80L, incluye materiales"
            placeholderTextColor="#444"
            multiline
            autoFocus
            textAlignVertical="top"
          />

          <Text style={styles.bigLabel}>¿Cuánto sale?</Text>
          {/* Si borra el total entero vuelve a mandar la suma de los ítems: no
              lo dejamos atrapado en un total vacío que tocó una vez. */}
          <View style={styles.montoWrap}>
            <Text style={styles.montoSigno}>$</Text>
            <TextInput
              style={styles.montoInput}
              value={totalTxt}
              onChangeText={(t) => { setTotalManual(soloDigitos(t).length > 0); setTotalTxt(formatMiles(t)); }}
              placeholder="180.000"
              placeholderTextColor="#333"
              keyboardType="number-pad"
            />
          </View>

          {/* ── Para quién: todo opcional ── */}
          <View style={styles.sep} />
          <Text style={styles.sectionTitle}>Para quién <Text style={styles.opcional}>· opcional</Text></Text>

          {ultimos.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
              keyboardShouldPersistTaps="handled"
            >
              {ultimos.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.chip, clienteId === c.id && styles.chipOn]}
                  onPress={() => usarCliente(c)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="person" size={12} color={clienteId === c.id ? '#0A0A0A' : '#888'} />
                  <Text style={[styles.chipText, clienteId === c.id && styles.chipTextOn]} numberOfLines={1}>
                    {c.nombre}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <TextInput
            style={styles.input}
            value={nombre}
            onChangeText={(t) => { setNombre(t); setClienteId(null); }}
            placeholder="Nombre"
            placeholderTextColor="#444"
          />
          <TextInput
            style={styles.input}
            value={tel}
            onChangeText={(t) => { setTel(t); setClienteId(null); }}
            placeholder="WhatsApp (para mandárselo directo)"
            placeholderTextColor="#444"
            keyboardType="phone-pad"
          />

          {/* Maxi (5-ago): "tenemos que hacer algo para que no sea tan incómodo
              pasar el teléfono de memoria desde wp a la app". Tenía razón: nadie
              se acuerda un número de 10 dígitos mientras cambia de app. Si en el
              portapapeles hay algo que parece un teléfono, se ofrece pegarlo de
              un toque. En WhatsApp se mantiene apretado el número y "Copiar". */}
          {!!telPegable && telPegable !== tel && (
            <TouchableOpacity style={styles.pegarBtn} onPress={() => { setTel(telPegable); setClienteId(null); }} activeOpacity={0.8}>
              <Ionicons name="clipboard-outline" size={15} color="#FFD600" />
              <Text style={styles.pegarBtnText}>Pegar {telPegable}</Text>
            </TouchableOpacity>
          )}

          {/* ── El detalle, plegado ── */}
          <TouchableOpacity style={styles.masBtn} onPress={() => setAbierto(v => !v)} activeOpacity={0.8}>
            <Ionicons name={abierto ? 'chevron-up' : 'add-circle-outline'} size={18} color="#FFD600" />
            <Text style={styles.masBtnText}>{abierto ? 'Ocultar detalle' : 'Agregar detalle'}</Text>
          </TouchableOpacity>

          {abierto && (
            <View style={styles.detalleBox}>
              {oficios.length > 0 && (
                <>
                  <Text style={styles.label}>¿Qué oficio te pidieron? <Text style={styles.opcional}>· opcional</Text></Text>
                  <View style={styles.oficiosWrap}>
                    {oficios.map(o => {
                      const on = profesionId === o.id;
                      return (
                        <TouchableOpacity
                          key={o.id}
                          style={[styles.chip, on && styles.chipOn]}
                          onPress={() => setProfesionId(on ? null : o.id)}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{o.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              <Text style={styles.label}>Ítems</Text>
              {items.map((it, idx) => (
                <View key={idx} style={[styles.itemCard, { borderLeftColor: colorTipo(tipoDe(it)) }]}>
                  {/* Qué es. Dos toques como mucho, y de un vistazo se ve cuál
                      es cuál por el color (la barrita de la izquierda también). */}
                  <View style={styles.tipoRow}>
                    {TIPOS.map(t => {
                      const on = tipoDe(it) === t.key;
                      return (
                        <TouchableOpacity
                          key={t.key}
                          style={[styles.tipoChip, on && { backgroundColor: t.color, borderColor: t.color }]}
                          onPress={() => setItem(idx, 'tipo', t.key)}
                          activeOpacity={0.8}
                        >
                          <Text style={[styles.tipoChipText, on && styles.tipoChipTextOn]}>{t.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <View style={styles.itemTop}>
                    <TextInput
                      style={[styles.itemInput, { flex: 1 }]}
                      value={it.descripcion}
                      onChangeText={(t) => setItem(idx, 'descripcion', t)}
                      placeholder="Termotanque 80L"
                      placeholderTextColor="#444"
                    />
                    <TouchableOpacity onPress={() => delItem(idx)} style={styles.itemDel}>
                      <Ionicons name="close" size={16} color="#666" />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.itemBottom}>
                    <TextInput
                      style={[styles.itemInput, { width: 66, textAlign: 'center' }]}
                      value={String(it.cantidad)}
                      onChangeText={(t) => setItem(idx, 'cantidad', soloDigitos(t).slice(0, 4))}
                      placeholder="1"
                      placeholderTextColor="#444"
                      keyboardType="number-pad"
                    />
                    <Text style={styles.itemX}>×</Text>
                    <TextInput
                      style={[styles.itemInput, { flex: 1 }]}
                      value={it.precio}
                      onChangeText={(t) => setItem(idx, 'precio', formatMiles(t))}
                      placeholder="$ precio por unidad"
                      placeholderTextColor="#444"
                      keyboardType="number-pad"
                    />
                  </View>
                </View>
              ))}

              <TouchableOpacity style={styles.addItemBtn} onPress={addItem} activeOpacity={0.8}>
                <Ionicons name="add" size={16} color="#FFD600" />
                <Text style={styles.addItemText}>Ítem</Text>
              </TouchableOpacity>

              {sumaItems > 0 && (
                <>
                  {/* Nunca "Mano de obra $0": si no cargó nada de eso, no se
                      nombra. Un cero se lee como "no me cobra el trabajo". */}
                  <Text style={styles.desglose}>
                    {desglose.material > 0 && (
                      <Text style={styles.desgloseMat}>Materiales ${desglose.material.toLocaleString('es-AR')}</Text>
                    )}
                    {desglose.material > 0 && desglose.obra > 0 ? <Text style={styles.desgloseSep}>{'  ·  '}</Text> : null}
                    {desglose.obra > 0 && (
                      <Text style={styles.desgloseObra}>Mano de obra ${desglose.obra.toLocaleString('es-AR')}</Text>
                    )}
                  </Text>
                  <Text style={styles.sumaHint}>
                    Los ítems suman ${sumaItems.toLocaleString('es-AR')}
                    {totalManual && sumaItems !== total ? ' — el total lo pusiste vos y manda el tuyo.' : ''}
                  </Text>
                </>
              )}

              <Text style={styles.label}>Notas</Text>
              <TextInput
                style={[styles.input, { height: 84 }]}
                value={notas}
                onChangeText={setNotas}
                placeholder="Garantía de 6 meses. No incluye rotura de pared."
                placeholderTextColor="#444"
                multiline
                textAlignVertical="top"
              />

              <Text style={styles.label}>Validez (días)</Text>
              <TextInput
                style={[styles.input, { width: 110 }]}
                value={validez}
                onChangeText={(t) => setValidez(soloDigitos(t).slice(0, 3))}
                placeholder="15"
                placeholderTextColor="#444"
                keyboardType="number-pad"
              />
            </View>
          )}

          {/* ── Salir ── */}
          <TouchableOpacity
            style={[styles.waBtn, (!valido || saving) && styles.btnOff]}
            onPress={() => crear(true)}
            disabled={!valido || saving}
            activeOpacity={0.85}
          >
            {saving
              ? <ActivityIndicator color="#0A0A0A" />
              : (
                <>
                  <Ionicons name="logo-whatsapp" size={20} color="#0A0A0A" />
                  <Text style={styles.waBtnText}>Crear y enviar por WhatsApp</Text>
                </>
              )}
          </TouchableOpacity>

          {/* 🔴 Maxi (5-ago): "se lo quise pasar a un número y tuve que ir a wp,
              copiar el número y pegar en la app... meta wp tiene escondido la
              info y números y nadie se mete a copiar."
              Tenía razón en el diagnóstico y el arreglo no es copiar mejor: es
              NO pedir el número. Sin teléfono, el link abre la lista de chats de
              WhatsApp y se elige ahí — el mismo chat donde ya estaba hablando.
              Eso ya funcionaba; lo que faltaba era decirlo. */}
          {!tel.trim() && (
            <Text style={styles.sinTelHint}>
              No hace falta el número: WhatsApp te va a dejar elegir el chat.
            </Text>
          )}

          {/* Para el que lo quiere mandar por otro lado: mail, Telegram, o
              guardárselo. Usa el compartir de Android, sin ninguna librería. */}
          <TouchableOpacity
            style={styles.compartirBtn}
            onPress={() => crear('compartir')}
            disabled={!valido || saving}
            activeOpacity={0.8}
          >
            <Ionicons name="share-social-outline" size={17} color="#ccc" />
            <Text style={styles.compartirBtnText}>Compartir por otro lado</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.soloGuardar}
            onPress={() => crear(false)}
            disabled={!valido || saving}
            activeOpacity={0.7}
          >
            <Text style={[styles.soloGuardarText, (!valido || saving) && { color: '#444' }]}>Sólo guardar</Text>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#F5F5F5' },

  content: { padding: 16, paddingBottom: 60 },

  bigLabel: { color: '#F5F5F5', fontSize: 15, fontWeight: '800', marginBottom: 8, marginTop: 6 },
  bigInput: {
    backgroundColor: '#0A0A0A', borderRadius: 14, borderWidth: 1, borderColor: '#2a2a2a',
    color: '#fff', fontSize: 16, padding: 14, minHeight: 92, marginBottom: 10, lineHeight: 22,
  },

  montoWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0A0A0A', borderRadius: 14, borderWidth: 1, borderColor: '#2a2a2a',
    paddingHorizontal: 14, marginBottom: 6,
  },
  montoSigno: { color: '#FFD600', fontSize: 26, fontWeight: '900', marginRight: 6 },
  montoInput: { flex: 1, color: '#fff', fontSize: 26, fontWeight: '900', paddingVertical: 12 },

  sep: { height: 1, backgroundColor: '#1a1a1a', marginVertical: 18 },
  sectionTitle: { color: '#F5F5F5', fontSize: 14, fontWeight: '800', marginBottom: 10 },
  opcional: { color: '#666', fontSize: 12, fontWeight: '600' },

  chipsRow: { gap: 8, paddingBottom: 12, paddingRight: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#1E1E1E',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, maxWidth: 170,
  },
  chipOn: { backgroundColor: '#FFD600', borderColor: '#FFD600' },
  oficiosWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chipText: { color: '#ccc', fontSize: 12.5, fontWeight: '700' },
  chipTextOn: { color: '#0A0A0A' },

  label: { color: '#ccc', fontSize: 12.5, fontWeight: '700', marginBottom: 6, marginTop: 4 },
  input: {
    backgroundColor: '#0A0A0A', borderRadius: 12, borderWidth: 1, borderColor: '#2a2a2a',
    color: '#fff', fontSize: 15, padding: 14, marginBottom: 14,
  },

  masBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, marginBottom: 4 },
  masBtnText: { color: '#FFD600', fontSize: 14, fontWeight: '800' },

  detalleBox: {
    backgroundColor: '#111', borderRadius: 16, borderWidth: 1, borderColor: '#1E1E1E',
    padding: 14, marginBottom: 10,
  },
  // La barrita de la izquierda se pinta del color del tipo: en una lista de 6
  // ítems se ve de un vistazo cuánto es material y cuánto es trabajo.
  itemCard: { backgroundColor: '#0D0D0D', borderRadius: 12, borderWidth: 1, borderColor: '#1a1a1a',
              borderLeftWidth: 3, borderLeftColor: '#7EA6FF', padding: 10, marginBottom: 8 },
  tipoRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  tipoChip: {
    borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 14,
    paddingHorizontal: 11, paddingVertical: 5,
  },
  tipoChipText:   { color: '#777', fontSize: 11.5, fontWeight: '800' },
  tipoChipTextOn: { color: '#0A0A0A' },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  itemInput: {
    backgroundColor: '#0A0A0A', borderRadius: 10, borderWidth: 1, borderColor: '#2a2a2a',
    color: '#fff', fontSize: 14, paddingHorizontal: 10, paddingVertical: 10,
  },
  itemDel: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#161616' },
  itemX: { color: '#666', fontSize: 14, fontWeight: '800' },

  addItemBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 12, paddingVertical: 11, marginBottom: 8,
  },
  addItemText: { color: '#FFD600', fontSize: 13.5, fontWeight: '800' },
  sumaHint: { color: '#888', fontSize: 12, marginBottom: 10, lineHeight: 17 },
  desglose:     { fontSize: 13, marginBottom: 4, lineHeight: 19 },
  desgloseMat:  { color: '#7EA6FF', fontWeight: '800' },
  desgloseObra: { color: '#FFD600', fontWeight: '800' },
  desgloseSep:  { color: '#555', fontWeight: '800' },

  waBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    backgroundColor: '#25D366', borderRadius: 16, paddingVertical: 18, marginTop: 12,
  },
  waBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },
  btnOff: { opacity: 0.35 },

  soloGuardar: { alignItems: 'center', paddingVertical: 16 },
  soloGuardarText: { color: '#FFD600', fontSize: 14, fontWeight: '700' },

  // Sacarle presión al campo del teléfono: sin número también se manda.
  sinTelHint: { color: '#777', fontSize: 12.5, lineHeight: 17, textAlign: 'center',
                marginTop: 9, paddingHorizontal: 10 },
  // Pegar el número copiado desde WhatsApp, de un toque.
  pegarBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start',
              backgroundColor: '#151500', borderWidth: 1, borderColor: '#FFD60040',
              borderRadius: 20, paddingVertical: 7, paddingHorizontal: 12, marginTop: -6, marginBottom: 12 },
  pegarBtnText: { color: '#FFD600', fontSize: 12.5, fontWeight: '800' },
  // Compartir por fuera de WhatsApp.
  compartirBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  backgroundColor: '#111', borderWidth: 1, borderColor: '#1E1E1E',
                  borderRadius: 14, paddingVertical: 14, marginTop: 10 },
  compartirBtnText: { color: '#ccc', fontSize: 14, fontWeight: '800' },

  primaryBtn: { backgroundColor: '#FFD600', borderRadius: 16, paddingVertical: 18, alignItems: 'center', marginTop: 12 },
  primaryBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },

  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    borderWidth: 1, borderColor: '#2a2a2a', borderRadius: 16, paddingVertical: 15, marginTop: 10,
  },
  ghostBtnText: { color: '#FFD600', fontSize: 14.5, fontWeight: '800' },

  okIconWrap: {
    alignSelf: 'center', width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#FFD600', alignItems: 'center', justifyContent: 'center',
    marginTop: 24, marginBottom: 16,
  },
  okTitle: { color: '#F5F5F5', fontSize: 21, fontWeight: '900', textAlign: 'center' },
  okSub:   { color: '#999', fontSize: 14.5, textAlign: 'center', marginTop: 8, marginBottom: 22 },

  askCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#111', borderRadius: 16, borderWidth: 1, borderColor: '#1E1E1E',
    padding: 14, marginTop: 20,
  },
  askTitle: { color: '#F5F5F5', fontSize: 14, fontWeight: '800' },
  askSub:   { color: '#666', fontSize: 12, marginTop: 3 },
  askBtn: { backgroundColor: '#FFD600', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 11, minWidth: 84, alignItems: 'center' },
  askBtnText: { color: '#0A0A0A', fontSize: 13.5, fontWeight: '900' },
});

export default NuevoPresupuestoScreen;
