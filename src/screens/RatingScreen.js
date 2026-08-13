import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  SafeAreaView, TextInput, ActivityIndicator,
  ScrollView, Image, Platform, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import jobService from '../services/jobService';
import favoriteService from '../services/favoriteService';
import volt from '../utils/voltVoice';
import { chargesInApp } from '../config/monetization';

const RATING_LABELS = ['', 'Muy malo', 'Malo', 'Regular', 'Bueno', '¡Excelente!'];

const RatingScreen = ({ job, session, onDone }) => {
  const [rating, setRating]         = useState(0);
  const [comment, setComment]       = useState('');
  const [showComment, setShowComment] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [isFav, setIsFav]           = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const [submitted, setSubmitted]   = useState(false);

  const userId        = session?.user?.id;
  const profId        = job.professional_id;
  const prof          = job.professionals;
  const profName      = prof
    ? `${prof.first_name || ''} ${prof.last_name || ''}`.trim() || 'El profesional'
    : 'El profesional';
  const profFirstName = prof?.first_name || 'El profesional';

  // Duración total
  const totalMinutes = (() => {
    if (job.total_minutes_worked) return job.total_minutes_worked;
    if (job.work_started_at && job.completed_at) {
      return Math.round((new Date(job.completed_at) - new Date(job.work_started_at)) / 60000);
    }
    return null;
  })();
  const fmtDuration = (mins) => {
    if (!mins || mins <= 0) return null;
    if (mins < 60) return `${mins} min`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
  };

  // Costo total
  const visitAmt  = job.visit_amount  || 0;
  const workAmt   = job.work_amount   || 0;
  const matsAmt   = job.materials_cost || 0;
  const totalCost = (job.visit_paid ? 0 : visitAmt) + workAmt + matsAmt;

  const handleSubmit = async () => {
    // Antes salia mudo: el boton no hacia NADA y parecia roto (Maxi, 31-jul).
    if (rating === 0) {
      Alert.alert('Falta la puntuacion', 'Tocá las estrellas para puntuar a ' + profFirstName + ' y después enviás.');
      return;
    }
    setLoading(true);
    try {
      await jobService.submitReview({
        jobId:          job.id,
        clientId:       job.client_id,
        professionalId: profId,
        rating,
        comment:        comment.trim(),
      });
      setSubmitted(true);
    } catch {
      // 🔴 Antes acá también iba setSubmitted(true): si fallaba la red, la
      // reseña se perdía y el cliente veía la pantalla de éxito igual. Ahora se
      // avisa y el botón queda para reintentar.
      Alert.alert(
        'No se pudo enviar la calificación',
        'Puede ser la señal. Tu puntuación quedó acá: tocá "Enviar" de nuevo en un momento.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleFavorite = async () => {
    if (favLoading || !profId || !userId) return;
    setFavLoading(true);
    try {
      const nowFav = await favoriteService.toggle(userId, profId);
      setIsFav(nowFav);
    } catch {} finally { setFavLoading(false); }
  };

  // ── Pantalla de éxito post-envío ────────────────────────────────────────────
  if (submitted) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.successContent}>
          <View style={styles.successIconWrap}>
            <Ionicons name="checkmark-circle" size={72} color="#FFD600" />
          </View>
          <Text style={styles.successTitle}>¡Gracias por tu valoración!</Text>

          {rating === 5 && (
            <View style={styles.communityCard}>
              <Ionicons name="people" size={22} color="#FFD600" />
              <Text style={styles.communityText}>
                Excelente. Tendremos en cuenta tu valoración para destacar a {profFirstName} dentro de la comunidad.
              </Text>
            </View>
          )}

          <View style={styles.voltFarewell}>
            <Text style={styles.voltFarewellBadge}>⚡ BOLT</Text>
            <Text style={styles.voltFarewellText}>
              {prof
                ? volt.farewell(profFirstName)
                : volt.farewellGeneric}
            </Text>
          </View>

          <TouchableOpacity style={styles.doneBtn} onPress={onDone} activeOpacity={0.85}>
            <Text style={styles.doneBtnText}>Volver al inicio</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ── Pantalla principal ──────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* Badge de completado */}
        <View style={styles.completedBadge}>
          <Ionicons name="checkmark-circle" size={22} color="#FFD600" />
          <Text style={styles.completedBadgeText}>Trabajo completado</Text>
        </View>

        {/* Tarjeta del profesional */}
        <View style={styles.profCard}>
          <View style={styles.profPhotoWrap}>
            {prof?.avatar_url ? (
              <Image source={{ uri: prof.avatar_url }} style={styles.profPhoto} />
            ) : (
              <View style={styles.profPhotoPlaceholder}>
                <Text style={styles.profPhotoInitial}>
                  {(prof?.first_name?.[0] || 'P').toUpperCase()}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.profInfo}>
            <Text style={styles.profName}>{profName}</Text>
            <Text style={styles.profRole}>{job.professions?.name || 'Profesional'}</Text>
            <Text style={styles.profMessage}>
              "{profFirstName} indicó que el trabajo fue completado correctamente."
            </Text>
          </View>
        </View>

        {/* Stats: tiempo + costo */}
        {(fmtDuration(totalMinutes) || totalCost > 0) && (
          <View style={styles.statsRow}>
            {fmtDuration(totalMinutes) && (
              <View style={styles.statChip}>
                <Ionicons name="time-outline" size={18} color="#5C5C5C" />
                <View>
                  <Text style={styles.statChipVal}>{fmtDuration(totalMinutes)}</Text>
                  <Text style={styles.statChipLbl}>Duración</Text>
                </View>
              </View>
            )}
            {chargesInApp() && fmtDuration(totalMinutes) && totalCost > 0 && <View style={styles.statChipDiv} />}
            {chargesInApp() && totalCost > 0 && (
              <View style={styles.statChip}>
                <Ionicons name="card-outline" size={18} color="#5C5C5C" />
                <View>
                  <Text style={styles.statChipVal}>${totalCost.toLocaleString('es-AR')}</Text>
                  <Text style={styles.statChipLbl}>Total pagado</Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Calificación */}
        <View style={styles.ratingSection}>
          <Text style={styles.ratingTitle}>¿Cómo estuvo el trabajo?</Text>
          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map(i => (
              <TouchableOpacity key={i} onPress={() => setRating(i)} activeOpacity={0.7}>
                <Ionicons
                  name={i <= rating ? 'star' : 'star-outline'}
                  size={46}
                  color={i <= rating ? '#FFD600' : '#2a2a2a'}
                />
              </TouchableOpacity>
            ))}
          </View>

          {rating > 0 && rating < 5 && (
            <Text style={styles.ratingLabel}>{RATING_LABELS[rating]}</Text>
          )}

          {rating === 5 && (
            <View style={styles.communityCard}>
              <Ionicons name="people" size={20} color="#FFD600" />
              <Text style={styles.communityText}>
                Excelente. Tendremos en cuenta tu valoración para destacar a {profFirstName} dentro de la comunidad.
              </Text>
            </View>
          )}
        </View>

        {/* Comentario (opcional, toggle) */}
        {!showComment ? (
          <TouchableOpacity style={styles.commentToggle} onPress={() => setShowComment(true)} activeOpacity={0.8}>
            <Ionicons name="create-outline" size={16} color="#5C5C5C" />
            <Text style={styles.commentToggleText}>Escribir un comentario</Text>
          </TouchableOpacity>
        ) : (
          <TextInput
            style={styles.commentInput}
            placeholder="Contanos más sobre la experiencia..."
            placeholderTextColor="#444"
            value={comment}
            onChangeText={setComment}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            autoFocus
            maxLength={400}
          />
        )}

        {/* Botón principal */}
        <TouchableOpacity
          style={[styles.submitBtn, rating === 0 && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={loading || rating === 0}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#0D0D0D" />
          ) : (
            <>
              <Ionicons name="star" size={18} color="#0D0D0D" />
              <Text style={styles.submitBtnText}>
                {rating === 0 ? 'Seleccioná una calificación' : 'Enviar valoración'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Acciones secundarias */}
        <View style={styles.secondaryActions}>
          <TouchableOpacity
            style={[styles.actionBtn, isFav && styles.actionBtnFav]}
            onPress={handleFavorite}
            disabled={favLoading}
            activeOpacity={0.8}
          >
            {favLoading ? (
              <ActivityIndicator size="small" color="#E5484D" />
            ) : (
              <Ionicons name={isFav ? 'heart' : 'heart-outline'} size={18} color={isFav ? '#E5484D' : '#8A8A8A'} />
            )}
            <Text style={[styles.actionBtnText, isFav && { color: '#E5484D' }]}>
              {isFav ? 'Guardado en favoritos ✓' : '❤️ Guardar en favoritos'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionBtn} onPress={onDone} activeOpacity={0.8}>
            <Ionicons name="refresh-outline" size={18} color="#8A8A8A" />
            <Text style={styles.actionBtnText}>🔄 Contratar nuevamente</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.skipBtn} onPress={onDone} activeOpacity={0.7}>
          <Text style={styles.skipBtnText}>Omitir</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },

  // ── Layout ───────────────────────────────────────────────────────────────────
  content: {
    paddingHorizontal: 24,
    paddingTop: Platform.OS === 'android' ? 32 : 20,
    paddingBottom: 48,
    gap: 16,
    alignItems: 'stretch',
  },
  successContent: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 28, gap: 16,
  },

  // ── Badge completado ──────────────────────────────────────────────────────────
  completedBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: 'rgba(255,214,0,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,214,0,0.25)',
    borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16,
    alignSelf: 'center',
  },
  completedBadgeText: { fontSize: 16, fontWeight: '600', color: '#FFD600' },

  // ── Tarjeta del profesional ───────────────────────────────────────────────────
  profCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 16,
    backgroundColor: '#161616', borderRadius: 20,
    padding: 18,
  },
  profPhotoWrap: { position: 'relative' },
  profPhoto: {
    width: 72, height: 72, borderRadius: 999,
    borderWidth: 2.5, borderColor: '#FFD600',
  },
  profPhotoPlaceholder: {
    width: 72, height: 72, borderRadius: 999,
    backgroundColor: '#1A1A00',
    borderWidth: 2.5, borderColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  profPhotoInitial: { fontSize: 28, fontWeight: '700', color: '#FFD600' },
  profInfo: { flex: 1 },
  profName: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', marginBottom: 2 },
  profRole: { fontSize: 14, color: '#5C5C5C', marginBottom: 8 },
  profMessage: {
    fontSize: 14, color: '#8A8A8A', lineHeight: 19, fontStyle: 'italic',
  },

  // ── Stats ─────────────────────────────────────────────────────────────────────
  statsRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#161616', borderRadius: 20,
    padding: 14,
  },
  statChip: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  statChipDiv: { width: 1, height: 32, backgroundColor: '#222', marginHorizontal: 8 },
  statChipVal: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', marginBottom: 1 },
  statChipLbl: { fontSize: 12, color: '#5C5C5C', textTransform: 'uppercase', letterSpacing: 1.8 },

  // ── Rating ────────────────────────────────────────────────────────────────────
  ratingSection: {
    backgroundColor: '#161616', borderRadius: 20,
    padding: 20, alignItems: 'center', gap: 16,
  },
  ratingTitle: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  starsRow:    { flexDirection: 'row', gap: 10 },
  ratingLabel: { fontSize: 16, fontWeight: '700', color: '#FFD600' },

  // ── Community card (5 estrellas) ──────────────────────────────────────────────
  communityCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: 'rgba(255,214,0,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,214,0,0.2)',
    borderRadius: 20, padding: 14, width: '100%',
  },
  communityText: { flex: 1, fontSize: 14, color: '#FFFFFF', lineHeight: 19 },

  // ── Comentario ────────────────────────────────────────────────────────────────
  commentToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, paddingHorizontal: 16,
    borderRadius: 20, backgroundColor: '#161616',
  },
  commentToggleText: { fontSize: 16, color: '#5C5C5C', fontWeight: '600' },
  commentInput: {
    backgroundColor: '#161616', borderRadius: 20,
    color: '#FFFFFF', fontSize: 16, padding: 14,
    minHeight: 90,
  },

  // ── Botón principal ───────────────────────────────────────────────────────────
  submitBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#FFD600',
    borderRadius: 999, paddingVertical: 18,
  },
  submitBtnDisabled: { opacity: 0.35 },
  submitBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },

  // ── Acciones secundarias ──────────────────────────────────────────────────────
  secondaryActions: { gap: 10 },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#161616', borderRadius: 999,
    paddingVertical: 14, paddingHorizontal: 16,
  },
  actionBtnFav: { borderColor: 'rgba(229,72,77,0.3)', backgroundColor: 'rgba(229,72,77,0.06)' },
  actionBtnText: { fontSize: 16, color: '#8A8A8A', fontWeight: '600', flex: 1 },

  // ── Omitir ────────────────────────────────────────────────────────────────────
  skipBtn: { alignItems: 'center', paddingVertical: 10 },
  skipBtnText: { color: '#333', fontSize: 16 },

  // ── Success ───────────────────────────────────────────────────────────────────
  successIconWrap: { marginBottom: 8 },
  successTitle: { fontSize: 24, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  successSub: {
    fontSize: 16, color: '#5C5C5C', textAlign: 'center',
    lineHeight: 21, marginTop: 4,
  },
  voltFarewell: {
    backgroundColor: 'rgba(255,214,0,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,214,0,0.2)',
    borderRadius: 20, padding: 14, gap: 8, width: '100%', alignItems: 'center',
  },
  voltFarewellBadge: { fontSize: 12, fontWeight: '700', color: '#FFD600', letterSpacing: 1 },
  voltFarewellText: { fontSize: 14, color: '#8A8A8A', textAlign: 'center', lineHeight: 19 },

  doneBtn: {
    backgroundColor: '#FFD600', borderRadius: 999,
    paddingVertical: 18, paddingHorizontal: 48, marginTop: 8,
  },
  doneBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },
});

export default RatingScreen;
