import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, TextInput, ActivityIndicator, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import jobService from '../services/jobService';

const RatingScreen = ({ job, session, professional, onDone }) => {
  const [rating, setRating]   = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const clientId = job.client_id;
  const professionalId = job.professional_id;

  const handleSubmit = async () => {
    if (rating === 0) return;
    setLoading(true);
    try {
      await jobService.submitReview({
        jobId: job.id,
        clientId,
        professionalId,
        rating,
        comment: comment.trim(),
      });
      setSubmitted(true);
    } catch {
      // silently skip — rating is optional
      setSubmitted(true);
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={72} color="#4CAF50" />
          </View>
          <Text style={styles.successTitle}>¡Trabajo completado!</Text>
          <Text style={styles.successSub}>
            {rating > 0 ? 'Gracias por tu valoración.' : 'El pago fue procesado exitosamente.'}
          </Text>
          <TouchableOpacity style={styles.doneBtn} onPress={onDone}>
            <Text style={styles.doneBtnText}>Volver al inicio</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>

        <View style={styles.iconWrap}>
          <Ionicons name="star" size={40} color="#FFD600" />
        </View>

        <Text style={styles.title}>¿Cómo estuvo el trabajo?</Text>
        <Text style={styles.subtitle}>
          Tu opinión ayuda a otros clientes a elegir bien.
        </Text>

        {/* Estrellas */}
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map(i => (
            <TouchableOpacity key={i} onPress={() => setRating(i)} activeOpacity={0.7}>
              <Ionicons
                name={i <= rating ? 'star' : 'star-outline'}
                size={48}
                color={i <= rating ? '#FFD600' : '#333'}
              />
            </TouchableOpacity>
          ))}
        </View>

        {rating > 0 && (
          <Text style={styles.ratingLabel}>
            {rating === 1 ? 'Muy malo' : rating === 2 ? 'Malo' : rating === 3 ? 'Regular' : rating === 4 ? 'Bueno' : '¡Excelente!'}
          </Text>
        )}

        {/* Comentario */}
        <TextInput
          style={styles.commentInput}
          placeholder="Contanos más (opcional)..."
          placeholderTextColor="#444"
          value={comment}
          onChangeText={setComment}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
        />

        {/* Botones */}
        <TouchableOpacity
          style={[styles.submitBtn, rating === 0 && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={loading || rating === 0}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#0A0A0A" />
          ) : (
            <Text style={styles.submitBtnText}>Enviar valoración</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.skipBtn} onPress={onDone}>
          <Text style={styles.skipBtnText}>Omitir</Text>
        </TouchableOpacity>

      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  content: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32,
  },

  iconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#1A1A1A', borderWidth: 2, borderColor: '#FFD60040',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24, fontWeight: '900', color: '#F5F5F5',
    textAlign: 'center', marginBottom: 8,
  },
  subtitle: {
    fontSize: 14, color: '#666', textAlign: 'center',
    lineHeight: 20, marginBottom: 32,
  },

  starsRow: {
    flexDirection: 'row', gap: 8, marginBottom: 12,
  },
  ratingLabel: {
    fontSize: 16, fontWeight: '700', color: '#FFD600',
    marginBottom: 24,
  },

  commentInput: {
    width: '100%',
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
    color: '#F5F5F5', fontSize: 14, padding: 14,
    minHeight: 90, marginBottom: 24,
  },

  submitBtn: {
    width: '100%', backgroundColor: '#FFD600',
    borderRadius: 16, paddingVertical: 18,
    alignItems: 'center', marginBottom: 12,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },

  skipBtn: { paddingVertical: 12 },
  skipBtnText: { color: '#444', fontSize: 14 },

  // Success state
  successWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32,
  },
  successIcon: { marginBottom: 24 },
  successTitle: {
    fontSize: 28, fontWeight: '900', color: '#F5F5F5',
    textAlign: 'center', marginBottom: 12,
  },
  successSub: {
    fontSize: 15, color: '#666', textAlign: 'center',
    lineHeight: 22, marginBottom: 40,
  },
  doneBtn: {
    backgroundColor: '#FFD600', borderRadius: 16,
    paddingVertical: 18, paddingHorizontal: 48,
  },
  doneBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },
});

export default RatingScreen;
