import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

/** Ambient color blobs that give the frosted surfaces something to refract. */
export function GlassBackdrop() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.blob, styles.topRight]} />
      <View style={[styles.blob, styles.bottomLeft]} />
      <View style={[styles.blob, styles.midLeft]} />
    </View>
  );
}

const styles = StyleSheet.create({
  blob: {
    position: 'absolute',
    borderRadius: 999,
  },
  topRight: {
    top: -180,
    right: -120,
    width: 340,
    height: 340,
    backgroundColor: colors.accentSoft,
  },
  bottomLeft: {
    bottom: -200,
    left: -140,
    width: 320,
    height: 320,
    backgroundColor: 'rgba(62, 224, 161, 0.07)',
  },
  midLeft: {
    top: '32%',
    left: -190,
    width: 280,
    height: 280,
    backgroundColor: 'rgba(109, 139, 255, 0.06)',
  },
});
