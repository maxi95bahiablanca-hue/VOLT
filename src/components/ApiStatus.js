import React from 'react';
import { Text, StyleSheet, ActivityIndicator } from 'react-native';

const ApiStatus = ({ message, loading, error }) => {
  if (loading) return <ActivityIndicator size="small" color="#6200ee" style={styles.loader} />;
  if (error) return <Text style={styles.error}>{error}</Text>;
  return <Text style={styles.message}>{message}</Text>;
};

const styles = StyleSheet.create({
  message: {
    fontSize: 18,
    color: '#6200ee',
    marginTop: 12,
    fontWeight: '500',
    letterSpacing: 1,
  },
  error: {
    fontSize: 16,
    color: '#b00020',
    marginTop: 12,
  },
  loader: {
    marginTop: 12,
  },
});

export default ApiStatus;
