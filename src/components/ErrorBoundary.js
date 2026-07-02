import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[BOLT] ErrorBoundary caught:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <Ionicons name="alert-circle" size={56} color="#ff4444" />
          </View>
          <Text style={styles.title}>Algo salió mal</Text>
          <Text style={styles.subtitle}>
            La app encontró un error inesperado. Tocá el botón para reiniciar.
          </Text>
          {this.state.error && (
            <Text style={styles.errorDetail} numberOfLines={10}>
              {this.state.error.toString()}
            </Text>
          )}
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => this.setState({ hasError: false, error: null })}
            activeOpacity={0.85}
          >
            <Ionicons name="refresh" size={18} color="#0A0A0A" />
            <Text style={styles.retryBtnText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A0A0A' },
  content: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: 'rgba(255,68,68,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,68,68,0.3)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24, fontWeight: '900', color: '#F5F5F5',
    textAlign: 'center', marginBottom: 12,
  },
  subtitle: {
    fontSize: 14, color: '#666', textAlign: 'center',
    lineHeight: 22, marginBottom: 24,
  },
  errorDetail: {
    fontSize: 11, color: '#444', fontFamily: 'monospace',
    backgroundColor: '#111', borderRadius: 8, padding: 12,
    marginBottom: 24, width: '100%',
  },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFD600', borderRadius: 16,
    paddingVertical: 16, paddingHorizontal: 32,
  },
  retryBtnText: { color: '#0A0A0A', fontSize: 16, fontWeight: '900' },
});

export default ErrorBoundary;
