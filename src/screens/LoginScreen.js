import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  ActivityIndicator, Platform, TextInput, KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { makeRedirectUri } from 'expo-auth-session';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../supabase';

const LoginScreen = () => {
  const [mode, setMode]       = useState('landing'); // 'landing' | 'email'
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [success, setSuccess] = useState(null);

  // ─── Google OAuth ────────────────────────────────────────
  const signInWithGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      const redirectTo = Linking.createURL('login-callback');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success') {
        const urlObj = new URL(result.url);
        const code = urlObj.searchParams.get('code');
        if (code) {
          const { error: exchErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exchErr) throw exchErr;
          return;
        }
        const fragment = new URLSearchParams(urlObj.hash.replace('#', ''));
        const accessToken  = fragment.get('access_token');
        const refreshToken = fragment.get('refresh_token');
        if (accessToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          return;
        }
        throw new Error('No se recibieron credenciales de Google');
      }
    } catch {
      setError('No se pudo iniciar sesión con Google. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  // ─── Email / Password ────────────────────────────────────
  const handleEmailAuth = async () => {
    if (!email.trim() || !password) { setError('Completá email y contraseña.'); return; }
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return; }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        setSuccess('¡Cuenta creada! Revisá tu email para confirmar tu registro antes de ingresar.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (err) {
      const msg = err.message || '';
      if (msg.includes('Invalid login credentials')) setError('Email o contraseña incorrectos.');
      else if (msg.includes('Email not confirmed')) setError('Debés confirmar tu email antes de ingresar. Revisá tu bandeja de entrada.');
      else if (msg.includes('User already registered')) setError('Ya existe una cuenta con ese email. Iniciá sesión.');
      else setError(msg || 'Error al autenticar. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  // ─── LANDING ─────────────────────────────────────────────
  if (mode === 'landing') {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

            {/* Logo */}
            <View style={styles.logoWrap}>
              <View style={styles.logoBadge}>
                <Ionicons name="flash" size={32} color="#0A0A0A" />
              </View>
              <Text style={styles.logoText}>BOLT</Text>
              <Text style={styles.logoTagline}>Profesionales a domicilio,{'\n'}cuando los necesitás</Text>
            </View>

            {/* Features */}
            <View style={styles.features}>
              {[
                { icon: 'search',           text: 'Encontrá al profesional más cercano' },
                { icon: 'people',           text: 'Hasta 3 presupuestos en tiempo real' },
                { icon: 'shield-checkmark', text: 'Pagás solo cuando el trabajo está listo' },
              ].map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <View style={styles.featureIcon}>
                    <Ionicons name={f.icon} size={16} color="#FFD600" />
                  </View>
                  <Text style={styles.featureText}>{f.text}</Text>
                </View>
              ))}
            </View>

            {/* Botón Google */}
            <TouchableOpacity
              style={[styles.googleBtn, loading && { opacity: 0.7 }]}
              onPress={signInWithGoogle}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#1a1a1a" />
              ) : (
                <>
                  <View style={styles.googleIcon}>
                    <Text style={styles.googleG}>G</Text>
                  </View>
                  <Text style={styles.googleBtnText}>Continuar con Google</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Botón email */}
            <TouchableOpacity
              style={styles.emailBtn}
              onPress={() => { setMode('email'); setError(null); }}
              activeOpacity={0.8}
            >
              <Ionicons name="mail-outline" size={18} color="#888" />
              <Text style={styles.emailBtnText}>Continuar con email</Text>
            </TouchableOpacity>

            {error && (
              <View style={styles.errorWrap}>
                <Ionicons name="alert-circle-outline" size={16} color="#ff4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Text style={styles.terms}>
              Al continuar aceptás los Términos de servicio{'\n'}y la{' '}
              <Text
                style={styles.termsLink}
                onPress={() => WebBrowser.openBrowserAsync('https://maxi95bahiablanca-hue.github.io/BOLT/privacy.html')}
              >
                Política de privacidad
              </Text>
              {' '}de BOLT
            </Text>

          </ScrollView>
        </KeyboardAvoidingView>
        <Text style={styles.version}>BOLT v1.0</Text>
      </SafeAreaView>
    );
  }

  // ─── EMAIL FORM ───────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

          {/* Back */}
          <TouchableOpacity style={styles.backBtn} onPress={() => { setMode('landing'); setError(null); setSuccess(null); }}>
            <Ionicons name="arrow-back" size={22} color="#888" />
            <Text style={styles.backBtnText}>Volver</Text>
          </TouchableOpacity>

          {/* Logo pequeño */}
          <View style={styles.logoSmall}>
            <View style={styles.logoBadgeSmall}>
              <Ionicons name="flash" size={18} color="#0A0A0A" />
            </View>
            <Text style={styles.logoTextSmall}>BOLT</Text>
          </View>

          <Text style={styles.emailFormTitle}>
            {isSignUp ? 'Crear cuenta' : 'Iniciar sesión'}
          </Text>

          {/* Campo email */}
          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="tu@email.com"
            placeholderTextColor="#444"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {/* Campo contraseña */}
          <Text style={styles.fieldLabel}>Contraseña</Text>
          <View style={styles.pwdWrap}>
            <TextInput
              style={styles.pwdInput}
              placeholder={isSignUp ? 'Mínimo 6 caracteres' : 'Tu contraseña'}
              placeholderTextColor="#444"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPwd}
              autoCapitalize="none"
            />
            <TouchableOpacity onPress={() => setShowPwd(v => !v)} style={styles.pwdEye}>
              <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={20} color="#555" />
            </TouchableOpacity>
          </View>

          {error && (
            <View style={styles.errorWrap}>
              <Ionicons name="alert-circle-outline" size={16} color="#ff4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {success && (
            <View style={styles.successWrap}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#4CAF50" />
              <Text style={styles.successText}>{success}</Text>
            </View>
          )}

          {/* Botón principal */}
          <TouchableOpacity
            style={[styles.submitBtn, loading && { opacity: 0.7 }]}
            onPress={handleEmailAuth}
            disabled={loading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color="#0A0A0A" />
              : <Text style={styles.submitBtnText}>{isSignUp ? 'Crear cuenta' : 'Ingresar'}</Text>}
          </TouchableOpacity>

          {/* Toggle signup/login */}
          <TouchableOpacity
            style={styles.toggleBtn}
            onPress={() => { setIsSignUp(v => !v); setError(null); setSuccess(null); }}
          >
            <Text style={styles.toggleBtnText}>
              {isSignUp
                ? '¿Ya tenés cuenta? Iniciá sesión'
                : '¿No tenés cuenta? Registrate'}
            </Text>
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  content: {
    flexGrow: 1, paddingHorizontal: 28,
    justifyContent: 'center', paddingVertical: 40,
  },

  logoWrap: { alignItems: 'center', marginBottom: 44 },
  logoBadge: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#FFD600', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 16, elevation: 10,
  },
  logoText: {
    fontSize: 44, fontWeight: '900', color: '#F5F5F5',
    letterSpacing: 10, marginBottom: 10,
  },
  logoTagline: {
    fontSize: 14, color: '#555', textAlign: 'center', lineHeight: 22,
  },

  features: { marginBottom: 36, gap: 14 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  featureIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: '#141400',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#2a2a10',
  },
  featureText: { fontSize: 14, color: '#888', flex: 1, lineHeight: 20 },

  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, backgroundColor: '#F5F5F5',
    borderRadius: 16, paddingVertical: 18, marginBottom: 10,
  },
  googleIcon: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  googleG: { fontSize: 14, fontWeight: '900', color: '#4285F4' },
  googleBtnText: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },

  emailBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10,
    borderWidth: 1, borderColor: '#222',
    borderRadius: 16, paddingVertical: 16, marginBottom: 16,
  },
  emailBtnText: { fontSize: 15, fontWeight: '600', color: '#888' },

  terms: {
    fontSize: 11, color: '#333', textAlign: 'center', lineHeight: 17, marginTop: 8,
  },
  termsLink: { color: '#FFD600', textDecorationLine: 'underline' },

  version: {
    textAlign: 'center', fontSize: 11, color: '#1a1a1a', paddingBottom: 12,
  },

  // Email form
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 32,
  },
  backBtnText: { color: '#555', fontSize: 14 },

  logoSmall: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 28,
  },
  logoBadgeSmall: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  logoTextSmall: {
    fontSize: 24, fontWeight: '900', color: '#F5F5F5', letterSpacing: 5,
  },

  emailFormTitle: {
    fontSize: 26, fontWeight: '900', color: '#F5F5F5', marginBottom: 28,
  },

  fieldLabel: {
    fontSize: 12, fontWeight: '700', color: '#555',
    textTransform: 'uppercase', letterSpacing: 0.5,
    marginBottom: 8, marginTop: 16,
  },
  input: {
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
    color: '#F5F5F5', fontSize: 16, padding: 14,
  },
  pwdWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', borderRadius: 14,
    borderWidth: 1, borderColor: '#1E1E1E',
  },
  pwdInput: { flex: 1, color: '#F5F5F5', fontSize: 16, padding: 14 },
  pwdEye: { paddingHorizontal: 14 },

  errorWrap: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(255,68,68,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,68,68,0.25)',
    borderRadius: 10, padding: 12, marginTop: 12,
  },
  errorText: { color: '#ff4444', fontSize: 13, flex: 1, lineHeight: 18 },

  successWrap: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(76,175,80,0.08)',
    borderWidth: 1, borderColor: 'rgba(76,175,80,0.25)',
    borderRadius: 10, padding: 12, marginTop: 12,
  },
  successText: { color: '#4CAF50', fontSize: 13, flex: 1, lineHeight: 18 },

  submitBtn: {
    backgroundColor: '#FFD600', borderRadius: 16,
    paddingVertical: 18, alignItems: 'center', marginTop: 24,
  },
  submitBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },

  toggleBtn: { paddingVertical: 16, alignItems: 'center' },
  toggleBtnText: { color: '#555', fontSize: 14 },
});

export default LoginScreen;
