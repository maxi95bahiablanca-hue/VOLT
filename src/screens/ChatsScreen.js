import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  FlatList, ActivityIndicator, Image, RefreshControl, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import chatService, { ETIQUETA } from '../services/chatService';

/** La bandeja de chats.
 *
 *  Hasta hoy el chat vivía solamente adentro de cada trabajo: para leer un
 *  mensaje había que acordarse de cuál era y entrar. Si el trabajo terminaba,
 *  la conversación quedaba enterrada.
 *
 *  Un chat en BOLT nunca es suelto —siempre es el de un trabajo—, así que cada
 *  fila muestra de quién es, el último mensaje y el oficio, y abre el trabajo
 *  en el chat.
 */
const ChatsScreen = ({ session, professional, onOpenChat }) => {
  const userId = session?.user?.id;
  const [items, setItems]       = useState([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  const traer = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await chatService.getConversaciones(userId, professional?.id);
      setItems(data);
    } catch { /* la lista se queda como estaba, sin romper la pantalla */ }
    finally { setCargando(false); setRefrescando(false); }
  }, [userId, professional?.id]);

  useEffect(() => { traer(); }, [traer]);

  // Refresco liviano mientras la pantalla está abierta: los mensajes entran por
  // el canal en vivo dentro de cada chat, pero acá alcanza con mirar cada rato.
  useEffect(() => {
    const t = setInterval(traer, 15000);
    return () => clearInterval(t);
  }, [traer]);

  const cuando = (iso) => {
    const d = new Date(iso);
    const hoy = new Date();
    const mismoDia = d.toDateString() === hoy.toDateString();
    if (mismoDia) return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const ayer = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    if (d.toDateString() === ayer.toDateString()) return 'ayer';
    return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
  };

  const capitalizar = (s) => (s || '')
    .split(' ').filter(Boolean)
    .map(p => p[0].toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');

  const renderItem = ({ item }) => {
    const pro    = item.job.professionals;
    const soyPro = !!professional && !!pro;
    // El nombre que se muestra es el del OTRO: si soy el profesional, el chat es
    // con el cliente; si soy el cliente, con el profesional.
    const titulo = soyPro && pro
      ? capitalizar(`${pro.first_name || ''} ${pro.last_name || ''}`.trim())
      : capitalizar(`${pro?.first_name || ''} ${pro?.last_name || ''}`.trim()) || 'Tu pedido';
    const avatar = pro?.avatar_url;
    const iniciales = (titulo || '·').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
    const texto = item.ultimo.type && item.ultimo.type !== 'text'
      ? (ETIQUETA[item.ultimo.type] || 'Adjunto')
      : item.ultimo.content;

    return (
      <TouchableOpacity
        style={styles.fila}
        onPress={() => onOpenChat?.(item.job)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={`Chat de ${titulo}${item.sinLeer ? `, ${item.sinLeer} sin leer` : ''}`}
      >
        {avatar
          ? <Image source={{ uri: avatar }} style={styles.avatarImg} />
          : <View style={styles.avatar}><Text style={styles.avatarTxt}>{iniciales}</Text></View>}

        <View style={styles.medio}>
          <View style={styles.filaTop}>
            <Text style={styles.nombre} numberOfLines={1}>{titulo}</Text>
            <Text style={styles.hora}>{cuando(item.ultimo.created_at)}</Text>
          </View>
          <Text
            style={[styles.ultimo, item.sinLeer > 0 && styles.ultimoSinLeer]}
            numberOfLines={1}
          >
            {texto}
          </Text>
          <Text style={styles.oficio} numberOfLines={1}>
            {item.job.professions?.name || 'Trabajo'}
            {item.job.address ? ` · ${item.job.address}` : ''}
          </Text>
        </View>

        {item.sinLeer > 0 && (
          <View style={styles.globo}>
            <Text style={styles.globoTxt}>{item.sinLeer > 9 ? '9+' : item.sinLeer}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const sinLeerTotal = items.reduce((a, i) => a + i.sinLeer, 0);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>
            {sinLeerTotal > 0 ? `${sinLeerTotal} sin leer` : 'Al día'}
          </Text>
          <Text style={styles.titulo}>Chats</Text>
        </View>
      </View>

      {cargando ? (
        <View style={styles.centro}><ActivityIndicator color="#FFD600" /></View>
      ) : items.length === 0 ? (
        <View style={styles.centro}>
          <Ionicons name="chatbubble-ellipses-outline" size={44} color="#262626" />
          <Text style={styles.vacioTitulo}>Todavía no hay conversaciones</Text>
          <Text style={styles.vacioTexto}>
            El chat se abre solo con cada trabajo, y queda acá cuando termina.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.job.id}
          renderItem={renderItem}
          contentContainerStyle={styles.lista}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refrescando}
              onRefresh={() => { setRefrescando(true); traer(); }}
              tintColor="#FFD600"
            />
          }
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 32 : 8,
    paddingBottom: 16,
  },
  eyebrow: {
    fontSize: 12, letterSpacing: 1.8, textTransform: 'uppercase',
    color: '#5C5C5C', fontWeight: '600', marginBottom: 2,
  },
  titulo: { fontSize: 28, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.8 },

  lista: { paddingHorizontal: 16, paddingBottom: 24 },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#161616', borderRadius: 20,
    padding: 16, marginBottom: 10,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 999, backgroundColor: '#1E1E1E',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: 48, height: 48, borderRadius: 999, backgroundColor: '#1E1E1E' },
  avatarTxt: { fontSize: 16, fontWeight: '600', color: '#8A8A8A' },

  medio:   { flex: 1, minWidth: 0 },
  filaTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nombre:  { flex: 1, fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  hora:    { fontSize: 12, color: '#5C5C5C' },
  ultimo:  { fontSize: 14, color: '#8A8A8A', marginTop: 4 },
  ultimoSinLeer: { color: '#FFFFFF', fontWeight: '600' },
  oficio:  { fontSize: 12, color: '#5C5C5C', marginTop: 4 },

  globo: {
    minWidth: 22, height: 22, borderRadius: 999, backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  globoTxt: { fontSize: 12, fontWeight: '700', color: '#0D0D0D' },

  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  vacioTitulo: { fontSize: 18, fontWeight: '600', color: '#5C5C5C' },
  vacioTexto:  { fontSize: 14, color: '#3a3a3a', textAlign: 'center', lineHeight: 20 },
});

export default ChatsScreen;
