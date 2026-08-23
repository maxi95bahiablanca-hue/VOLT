import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  ActivityIndicator, Platform, TextInput, KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { makeRedirectUri } from 'expo-auth-session';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../supabase';

const LoginScreen = () => {
  // 🔴 11-ago-2026 — La app es edge-to-edge: en Android el SafeAreaView de
  //    react-native no reserva nada y la barra de gestos se come el último
  //    botón del formulario. El alto real lo da el inset, nunca un número fijo.
  //    Sólo en Android: en iOS el SafeAreaView ya reservó ese espacio y sumarlo
  //    de nuevo correría todo hacia arriba sin motivo.
  const insets = useSafeAreaInsets();
  const padAbajo = 40 + (Platform.OS === 'android' ? insets.bottom : 0);
  const [mode, setMode]       = useState('landing'); // 'landing' | 'email'
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [success, setSuccess] = useState(null);
  const [appleDisponible, setAppleDisponible] = useState(false);
  const pwdRef = useRef(null);

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

  // ─── Sign in with Apple ──────────────────────────────────
  // Apple lo exige en iOS cuando la app ofrece login con Google (guideline 4.8).
  // El botón sólo se muestra si el dispositivo lo soporta (iOS 13+).
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AppleAuthentication.isAvailableAsync()
      .then(setAppleDisponible)
      .catch(() => setAppleDisponible(false));
  }, []);

  const signInWithApple = async () => {
    setLoading(true);
    setError(null);
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('Apple no devolvió el token');

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (error) throw error;

      // Apple manda el nombre UNA sola vez, en el primer ingreso. Si no lo
      // guardamos ahora, se pierde para siempre.
      const nombre = [credential.fullName?.givenName, credential.fullName?.familyName]
        .filter(Boolean).join(' ').trim();
      if (nombre) {
        await supabase.auth.updateUser({ data: { full_name: nombre } }).catch(() => {});
      }
    } catch (e) {
      // Cancelar no es un error que haya que mostrarle a nadie
      if (e?.code !== 'ERR_REQUEST_CANCELED' && e?.code !== 'ERR_CANCELED') {
        setError('No se pudo iniciar sesión con Apple. Intentá de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ─── Email / Password ────────────────────────────────────
  const handleEmailAuth = async () => {
    // 🔴 11-ago-2026 — La tecla "Ir" del teclado es una segunda puerta a esta
    //    función, y esa puerta NO tiene el `disabled={loading}` que sí tiene el
    //    botón amarillo. Sin este candado, dos toques seguidos en "Ir" mandan
    //    dos altas: la segunda vuelve con "Ya existe una cuenta con ese email"
    //    y la persona cree que falló cuando en realidad ya se registró.
    if (loading) return;
    if (!email.trim() || !password) { setError('Completá email y contraseña.'); return; }
    if (password.length < 6) { setError('La contraseña debe tener al menos 6 caracteres.'); return; }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        // 🔴 ACÁ SE LE MENTÍA AL QUE SE REGISTRABA. Decía siempre "revisá tu
        //    email para confirmar tu registro antes de ingresar", pero el
        //    proyecto tiene `mailer_autoconfirm` PRENDIDO: no hay ningún mail
        //    que confirmar y la cuenta ya queda usable. O sea que la persona se
        //    registraba bien, leía que tenía que esperar un correo, cerraba la
        //    app y se quedaba esperando algo que nunca iba a llegar.
        //
        //    La respuesta la da la propia llamada: si vino sesión, ya está
        //    adentro (el listener de App.js lo lleva solo). Si no vino, ahí sí
        //    hay un mail que confirmar. Escrito así sirve igual el día que se
        //    prenda la confirmación, sin volver a tocar esto.
        setSuccess(data?.session
          ? '¡Listo! Ya estás adentro.'
          : 'Te mandamos un correo para confirmar la cuenta. Abrilo y volvé.');
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

  // ─── Olvidé mi contraseña ────────────────────────────────
  //
  // 🔴 Esto no existía en la app, y es la única salida del que se registró con
  //    mail y se la olvidó: no puede entrar, así que tampoco puede usar
  //    "cambiar mi contraseña" del perfil. Quedaba afuera de su cuenta para
  //    siempre, sin nada que tocar. La web sí lo tenía.
  //
  // El enlace del mail lleva a bolt.com.ar/pedir, que ya sabe recibir el
  // PASSWORD_RECOVERY y pedir la nueva ahí mismo. Se hace así y no con un deep
  // link a la app a propósito: el que se la olvidó puede estar abriendo el mail
  // en la computadora, y una pantalla web anda en cualquier lado.
  const olvideLaClave = async () => {
    const mail = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
      setError('Escribí tu email arriba y volvé a tocar acá.');
      return;
    }
    setLoading(true); setError(null); setSuccess(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(mail, {
        redirectTo: 'https://bolt.com.ar/pedir/',
      });
      if (error) throw error;
      setSuccess('Si ese correo tiene cuenta, te llega un mail con un enlace. Abrilo, poné la contraseña nueva y volvé acá con esa.');
    } catch (e) {
      // El límite de correos por hora es del servidor, no culpa de la persona:
      // decirle "error" a secas la deja probando una y otra vez.
      setError(/rate|limit|seconds/i.test(String(e?.message))
        ? 'Ya se pidieron varios correos hace poco. Esperá unos minutos y probá de nuevo.'
        : 'No se pudo enviar el correo. Probá de nuevo en un momento.');
    } finally {
      setLoading(false);
    }
  };

  // ─── LANDING ─────────────────────────────────────────────
  if (mode === 'landing') {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: padAbajo }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >

            {/* Logo */}
            <View style={styles.logoWrap}>
              <View style={styles.logoBadge}>
                <Ionicons name="flash" size={32} color="#0D0D0D" />
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

            {/* Botón Apple (solo iOS) */}
            {appleDisponible && (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                cornerRadius={14}
                style={styles.appleBtn}
                onPress={signInWithApple}
              />
            )}

            {/* Botón email */}
            <TouchableOpacity
              style={styles.emailBtn}
              onPress={() => { setMode('email'); setError(null); }}
              activeOpacity={0.8}
            >
              <Ionicons name="mail-outline" size={18} color="#8A8A8A" />
              <Text style={styles.emailBtnText}>Continuar con email</Text>
            </TouchableOpacity>

            {error && (
              <View style={styles.errorWrap}>
                <Ionicons name="alert-circle-outline" size={16} color="#E5484D" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Text style={styles.terms}>
              Al continuar aceptás los Términos de servicio{'\n'}y la{' '}
              <Text
                style={styles.termsLink}
                onPress={() => WebBrowser.openBrowserAsync('https://bolt.com.ar/privacy.html')}
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
      {/* 🔴 11-ago-2026 — Acá el revisor de Play tocaba "Contraseña" y el teclado
          le tapaba el campo y el botón "Ingresar", sin manera de scrollear:
          con behavior=undefined el KeyboardAvoidingView en Android no hacía NADA
          (la ventana ya no se achica sola por edge-to-edge) y el contenido medía
          exacto el alto de pantalla. Con 'height' la vista se encoge lo que mide
          el teclado y el ScrollView por fin tiene a dónde correrse. Es el mismo
          patrón de RegisterProfessionalScreen. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: padAbajo }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >

          {/* Back */}
          <TouchableOpacity style={styles.backBtn} onPress={() => { setMode('landing'); setError(null); setSuccess(null); }}>
            <Ionicons name="arrow-back" size={22} color="#8A8A8A" />
            <Text style={styles.backBtnText}>Volver</Text>
          </TouchableOpacity>

          {/* Logo pequeño */}
          <View style={styles.logoSmall}>
            <View style={styles.logoBadgeSmall}>
              <Ionicons name="flash" size={18} color="#0D0D0D" />
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
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => pwdRef.current?.focus()}
          />

          {/* Campo contraseña */}
          <Text style={styles.fieldLabel}>Contraseña</Text>
          <View style={styles.pwdWrap}>
            {/* 🔴 11-ago-2026 — La tecla "Ir" del teclado también entra: si en
                algún teléfono el botón amarillo igual queda tapado, esta es la
                salida que no depende de ver nada en pantalla. */}
            <TextInput
              ref={pwdRef}
              style={styles.pwdInput}
              placeholder={isSignUp ? 'Mínimo 6 caracteres' : 'Tu contraseña'}
              placeholderTextColor="#444"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPwd}
              autoCapitalize="none"
              returnKeyType="go"
              onSubmitEditing={handleEmailAuth}
            />
            <TouchableOpacity onPress={() => setShowPwd(v => !v)} style={styles.pwdEye}>
              <Ionicons name={showPwd ? 'eye-off-outline' : 'eye-outline'} size={20} color="#5C5C5C" />
            </TouchableOpacity>
          </View>

          {error && (
            <View style={styles.errorWrap}>
              <Ionicons name="alert-circle-outline" size={16} color="#E5484D" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {success && (
            <View style={styles.successWrap}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#FFD600" />
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
              ? <ActivityIndicator color="#0D0D0D" />
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

          {/* La salida del que se la olvidó. Sólo al iniciar sesión: en el
              registro no tiene sentido y sería un botón más para equivocarse. */}
          {!isSignUp && (
            <TouchableOpacity
              style={styles.olvideBtn}
              onPress={olvideLaClave}
              disabled={loading}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.olvideBtnText}>Olvidé mi contraseña</Text>
            </TouchableOpacity>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
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
    fontSize: 44, fontWeight: '700', color: '#FFFFFF',
    letterSpacing: 10, marginBottom: 10,
  },
  logoTagline: {
    fontSize: 16, color: '#5C5C5C', textAlign: 'center', lineHeight: 22,
  },

  features: { marginBottom: 36, gap: 14 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  featureIcon: {
    width: 34, height: 34, borderRadius: 20,
    backgroundColor: '#141400',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#2a2a10',
  },
  featureText: { fontSize: 16, color: '#8A8A8A', flex: 1, lineHeight: 20 },

  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 12, backgroundColor: '#FFFFFF',
    borderRadius: 999, paddingVertical: 18, marginBottom: 10,
  },
  // La altura la fija Apple: su botón nativo no acepta padding propio
  appleBtn: { height: 56, marginBottom: 10 },
  googleIcon: {
    width: 24, height: 24, borderRadius: 20,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  googleG: { fontSize: 16, fontWeight: '700', color: '#4285F4' },
  googleBtnText: { fontSize: 16, fontWeight: '700', color: '#1a1a1a' },

  emailBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10,
    borderRadius: 999, paddingVertical: 16, marginBottom: 16,
  },
  emailBtnText: { fontSize: 16, fontWeight: '600', color: '#8A8A8A' },

  terms: {
    fontSize: 12, color: '#5C5C5C', textAlign: 'center', lineHeight: 18, marginTop: 8,
  },
  termsLink: { color: '#FFD600', textDecorationLine: 'underline' },

  version: {
    textAlign: 'center', fontSize: 12, color: '#333', paddingBottom: 12,
  },

  // Email form
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 32,
  },
  backBtnText: { color: '#5C5C5C', fontSize: 16 },

  logoSmall: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 28,
  },
  logoBadgeSmall: {
    width: 36, height: 36, borderRadius: 999,
    backgroundColor: '#FFD600',
    alignItems: 'center', justifyContent: 'center',
  },
  logoTextSmall: {
    fontSize: 24, fontWeight: '700', color: '#FFFFFF', letterSpacing: 3,
  },

  emailFormTitle: {
    fontSize: 26, fontWeight: '700', color: '#FFFFFF', marginBottom: 28,
  },

  fieldLabel: {
    fontSize: 12, fontWeight: '600', color: '#5C5C5C',
    textTransform: 'uppercase', letterSpacing: 1.8,
    marginBottom: 8, marginTop: 16,
  },
  input: {
    backgroundColor: '#161616', borderRadius: 20,
    color: '#FFFFFF', fontSize: 16, padding: 14,
  },
  pwdWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#161616', borderRadius: 20,
    },
  pwdInput: { flex: 1, color: '#FFFFFF', fontSize: 16, padding: 14 },
  pwdEye: { paddingHorizontal: 14 },

  errorWrap: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(229,72,77,0.08)',
    borderWidth: 1, borderColor: 'rgba(229,72,77,0.25)',
    borderRadius: 20, padding: 12, marginTop: 12,
  },
  errorText: { color: '#E5484D', fontSize: 14, flex: 1, lineHeight: 18 },

  successWrap: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(255,214,0,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,214,0,0.25)',
    borderRadius: 20, padding: 12, marginTop: 12,
  },
  successText: { color: '#FFD600', fontSize: 14, flex: 1, lineHeight: 18 },

  submitBtn: {
    backgroundColor: '#FFD600', borderRadius: 999,
    paddingVertical: 18, alignItems: 'center', marginTop: 24,
  },
  submitBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '600' },

  toggleBtn: { paddingVertical: 16, alignItems: 'center' },
  toggleBtnText: { color: '#5C5C5C', fontSize: 16 },
  olvideBtn: { paddingVertical: 6, alignItems: 'center' },
  olvideBtnText: { color: '#8A8A8A', fontSize: 14, textDecorationLine: 'underline' },
});

export default LoginScreen;
