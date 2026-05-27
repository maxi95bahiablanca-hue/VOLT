import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';

const ProfessionList = ({ professions, loading, error, onSelect, selected }) => {
  if (loading) return <ActivityIndicator size="small" color="#6200ee" style={styles.loader} />;
  if (error) return <Text style={styles.error}>{error}</Text>;

  return (
    <View style={styles.container}>
      {professions.map((item) => (
        <TouchableOpacity
          key={item.id}
          style={[styles.card, selected?.id === item.id && styles.cardSelected]}
          onPress={() => onSelect(item)}
        >
          <Text style={[styles.text, selected?.id === item.id && styles.textSelected]}>
            {item.name}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingHorizontal: 24,
    marginTop: 32,
    gap: 12,
  },
  card: {
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingVertical: 18,
    paddingHorizontal: 24,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardSelected: {
    borderColor: '#6200ee',
    backgroundColor: '#ede7f6',
  },
  text: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
    textAlign: 'center',
    letterSpacing: 1,
  },
  textSelected: {
    color: '#6200ee',
  },
  error: {
    fontSize: 14,
    color: '#b00020',
    marginTop: 24,
  },
  loader: {
    marginTop: 24,
  },
});

export default ProfessionList;
