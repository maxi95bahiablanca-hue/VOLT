import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { toggleDemo, isDemoMode } from '../demo/demoMode';

const DemoToggle = ({ onToggle }) => {
  const [on, setOn] = useState(isDemoMode());

  const handlePress = () => {
    const next = toggleDemo();
    setOn(next);
    onToggle?.(next);
  };

  return (
    <TouchableOpacity style={[styles.wrap, on && styles.wrapOn]} onPress={handlePress} activeOpacity={0.8}>
      <View style={[styles.dot, on && styles.dotOn]} />
      <Text style={[styles.label, on && styles.labelOn]}>
        {on ? 'DEMO ON' : 'DEMO OFF'}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#161616', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  wrapOn: {
    backgroundColor: 'rgba(255,214,0,0.1)',
    borderColor: 'rgba(255,214,0,0.4)',
  },
  dot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: '#333' },
  dotOn: { backgroundColor: '#FFD600' },
  label:   { fontSize: 12, fontWeight: '600', color: '#444', letterSpacing: 0.8 },
  labelOn: { color: '#FFD600' },
});

export default DemoToggle;
