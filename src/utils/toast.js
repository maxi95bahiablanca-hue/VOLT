import React from 'react';
import { View, Text } from 'react-native';
import Toast from 'react-native-toast-message';

const base = {
  width: '92%', minHeight: 56, borderRadius: 14,
  paddingHorizontal: 16, paddingVertical: 12,
  flexDirection: 'row', alignItems: 'center', gap: 12,
  elevation: 8,
  shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
};

export const toastConfig = {
  voltSuccess: ({ text1, text2 }) => (
    <View style={[base, { backgroundColor: '#0D1A0D', borderLeftWidth: 3, borderLeftColor: '#4CAF50' }]}>
      <Text style={{ fontSize: 20, color: '#4CAF50' }}>✓</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#4CAF50', fontWeight: '800', fontSize: 14 }}>{text1}</Text>
        {text2 ? <Text style={{ color: '#777', fontSize: 13, marginTop: 2 }}>{text2}</Text> : null}
      </View>
    </View>
  ),
  voltError: ({ text1, text2 }) => (
    <View style={[base, { backgroundColor: '#1A0D0D', borderLeftWidth: 3, borderLeftColor: '#ff4444' }]}>
      <Text style={{ fontSize: 20, color: '#ff4444' }}>✕</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#ff4444', fontWeight: '800', fontSize: 14 }}>{text1}</Text>
        {text2 ? <Text style={{ color: '#777', fontSize: 13, marginTop: 2 }}>{text2}</Text> : null}
      </View>
    </View>
  ),
  voltInfo: ({ text1, text2 }) => (
    <View style={[base, { backgroundColor: '#1A1A00', borderLeftWidth: 3, borderLeftColor: '#FFD600' }]}>
      <Text style={{ fontSize: 20 }}>⚡</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#FFD600', fontWeight: '800', fontSize: 14 }}>{text1}</Text>
        {text2 ? <Text style={{ color: '#777', fontSize: 13, marginTop: 2 }}>{text2}</Text> : null}
      </View>
    </View>
  ),
};

export const showSuccess = (text2, text1 = '¡Listo!') =>
  Toast.show({ type: 'voltSuccess', text1, text2, position: 'bottom', visibilityTime: 3000 });

export const showError = (text2, text1 = 'Error') =>
  Toast.show({ type: 'voltError', text1, text2, position: 'bottom', visibilityTime: 4000 });

export const showInfo = (text2, text1 = 'VOLT') =>
  Toast.show({ type: 'voltInfo', text1, text2, position: 'bottom', visibilityTime: 3000 });
