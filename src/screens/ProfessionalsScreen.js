import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Linking,
  StyleSheet,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import locationService from '../services/locationService';
import professionalService from '../services/professionalService';

const formatDistance = (meters) => {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
};

const formatPrice = (price) =>
  price != null ? price.toLocaleString('es-AR') : '—';

const contactWhatsApp = (worker, profession) => {
  const name  = `${worker.first_name} ${worker.last_name}`;
  const dist  = formatDistance(worker.distance_meters);
  const price = formatPrice(worker.min_price);
  const msg   = encodeURIComponent(
    `Hola ${worker.first_name}! Te encontré en VOLT buscando un/a *${profession.name}*.\n\n` +
    `¿Estás disponible? Estás a ${dist} de mí.\n` +
    `Vi que tu precio mínimo es $${price}.`
  );
  const phone = worker.phone ? worker.phone.replace(/\D/g, '') : null;
  const url   = phone
    ? `https://api.whatsapp.com/send?phone=549${phone}&text=${msg}`
    : `https://api.whatsapp.com/send?text=${msg}`;
  Linking.openURL(url);
};

const ProfessionalsScreen = ({ profession, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [workers, setWorkers] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchNearby = async () => {
      try {
        const granted = await locationService.requestPermission();
        if (!granted) {
          setError('Necesitamos tu ubicación para encontrar profesionales cercanos.');
          return;
        }

        const pos = await locationService.getCurrentLocation();
        const nearby = await professionalService.getNearbyWorkers(
          profession.id,
          pos.coords.latitude,
          pos.coords.longitude
        );
        setWorkers(nearby);
      } catch {
        setError('No se pudieron cargar los profesionales. Verificá tu conexión.');
      } finally {
        setLoading(false);
      }
    };

    fetchNearby();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backText}>← Volver</Text>
      </TouchableOpacity>

      <View style={styles.header}>
        <Text style={styles.professionName}>{profession.name}</Text>
        <Text style={styles.subtitle}>Los 3 más cercanos a vos</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#6200ee" />
          <Text style={styles.loadingText}>Buscando profesionales...</Text>
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="location-outline" size={48} color="#cccccc" />
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : workers.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={48} color="#cccccc" />
          <Text style={styles.emptyText}>
            No hay profesionales disponibles cerca en este momento.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {workers.map((worker, index) => (
            <View key={worker.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.cardRank}>
                  <Text style={styles.cardRankText}>{index + 1}</Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardName}>
                    {worker.first_name} {worker.last_name}
                  </Text>
                  <Text style={styles.cardPrice}>
                    Desde ${formatPrice(worker.min_price)}
                  </Text>
                </View>
                <View style={styles.cardDistanceBox}>
                  <Ionicons name="location-sharp" size={14} color="#6200ee" />
                  <Text style={styles.cardDistanceText}>
                    {formatDistance(worker.distance_meters)}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.waButton}
                onPress={() => contactWhatsApp(worker, profession)}
                activeOpacity={0.7}
              >
                <Ionicons name="logo-whatsapp" size={18} color="#ffffff" />
                <Text style={styles.waButtonText}>Contactar</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },

  backButton: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
    alignSelf: 'flex-start',
  },
  backText: { fontSize: 16, color: '#6200ee', fontWeight: '600' },

  header: {
    paddingHorizontal: 24,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  professionName: {
    fontSize: 26,
    fontWeight: '900',
    color: '#1a1a1a',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  subtitle: { fontSize: 14, color: '#888888', fontWeight: '500' },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 16,
  },
  loadingText: { fontSize: 14, color: '#888888', marginTop: 12 },
  emptyText: {
    fontSize: 15,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 22,
  },

  list: { paddingHorizontal: 24, paddingTop: 20, gap: 12 },

  card: {
    backgroundColor: '#fafafa',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#eeeeee',
    padding: 16,
    gap: 12,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },

  cardRank: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#6200ee',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardRankText: { color: '#ffffff', fontWeight: '800', fontSize: 16 },

  cardInfo: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  cardPrice: { fontSize: 13, color: '#666666', marginTop: 2, fontWeight: '500' },

  cardDistanceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#f3eeff',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  cardDistanceText: { fontSize: 13, color: '#6200ee', fontWeight: '700' },

  waButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#25d366',
    borderRadius: 10,
    paddingVertical: 10,
  },
  waButtonText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
});

export default ProfessionalsScreen;
