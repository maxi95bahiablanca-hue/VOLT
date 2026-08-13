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
            <Ionicons name="alert-circle" size={56} color="#E5484D" />
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
            <Ionicons name="refresh" size={18} color="#0D0D0D" />
            <Text style={styles.retryBtnText}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  content: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 96, height: 96, borderRadius: 999,
    backgroundColor: 'rgba(229,72,77,0.1)',
    borderWidth: 1, borderColor: 'rgba(229,72,77,0.3)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24, fontWeight: '700', color: '#FFFFFF',
    textAlign: 'center', marginBottom: 12,
  },
  subtitle: {
    fontSize: 16, color: '#5C5C5C', textAlign: 'center',
    lineHeight: 22, marginBottom: 24,
  },
  errorDetail: {
    fontSize: 12, color: '#444', fontFamily: 'monospace',
    backgroundColor: '#161616', borderRadius: 20, padding: 12,
    marginBottom: 24, width: '100%',
  },
  retryBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FFD600', borderRadius: 999,
    paddingVertical: 16, paddingHorizontal: 32,
  },
  retryBtnText: { color: '#0D0D0D', fontSize: 16, fontWeight: '700' },
});

export default ErrorBoundary;
