/* eslint-disable react-hooks/refs */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, Text, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop } from 'react-native-svg';

import { renderCharacter } from './renderer';
import type { BuddyAccessory, BuddyAnimationState } from '@/lib/buddy/types';
import { isTransient, transientMs } from '@/lib/buddy/engine/stateMachine';

type Props = {
  speciesId: string;
  formId?: string;
  size?: number;
  state?: BuddyAnimationState;
  speaking?: boolean;
  onStateChange?: (state: BuddyAnimationState) => void;
  interactive?: boolean;
  /** Cosmetic-only overlay; never affects stats, permissions, or animations. */
  accessory?: BuddyAccessory;
};

type Palette = { fur: string; fur2: string; belly: string; ear: string; accent: string; eye: string };

const PALETTES: Record<string, Palette> = {
  fox: { fur: '#FFB067', fur2: '#E06A2B', belly: '#FFF4E7', ear: '#FFD0BE', accent: '#4E8BFF', eye: '#241B18' },
  raven: { fur: '#4B5563', fur2: '#1F2937', belly: '#9CA3AF', ear: '#6B7280', accent: '#7C3AED', eye: '#111827' },
  owl: { fur: '#A78B71', fur2: '#6B4F3A', belly: '#F3E4D4', ear: '#8B6A55', accent: '#60A5FA', eye: '#1F2937' },
  bear: { fur: '#B07A52', fur2: '#7A4E2D', belly: '#E7C9AA', ear: '#C9966B', accent: '#2563EB', eye: '#241B18' },
  wolf: { fur: '#94A3B8', fur2: '#475569', belly: '#E2E8F0', ear: '#CBD5E1', accent: '#6366F1', eye: '#0F172A' },
  deer: { fur: '#D4A373', fur2: '#A97142', belly: '#F7E7D3', ear: '#F2CDAA', accent: '#10B981', eye: '#2B2118' },
  labrador: { fur: '#F0C36A', fur2: '#D89B2C', belly: '#FFF1C9', ear: '#F5D489', accent: '#3B82F6', eye: '#2B2118' },
  dolphin: { fur: '#7DD3FC', fur2: '#0EA5E9', belly: '#E0F2FE', ear: '#BAE6FD', accent: '#F59E0B', eye: '#0F172A' },
  beaver: { fur: '#B08968', fur2: '#7F5539', belly: '#E6CCB2', ear: '#DDB892', accent: '#059669', eye: '#2B2118' },
  elephant: { fur: '#AEB8C4', fur2: '#7B8794', belly: '#D9E1E8', ear: '#C7D2DC', accent: '#8B5CF6', eye: '#1F2937' },
  lion: { fur: '#F2B94B', fur2: '#D97706', belly: '#FDE68A', ear: '#FCD34D', accent: '#DC2626', eye: '#2B2118' },
  'golden-retriever': { fur: '#F7C948', fur2: '#E0A82E', belly: '#FFF0B3', ear: '#FFD978', accent: '#2563EB', eye: '#2B2118' },
  cat: { fur: '#C4B5A5', fur2: '#8B7B6B', belly: '#F5EDE4', ear: '#E7D8C9', accent: '#EC4899', eye: '#1F2937' },
  panda: { fur: '#F5F5F4', fur2: '#D6D3D1', belly: '#FFFFFF', ear: '#292524', accent: '#22C55E', eye: '#111827' },
  cheetah: { fur: '#F4C430', fur2: '#D97706', belly: '#FFF3BF', ear: '#FDE68A', accent: '#EF4444', eye: '#2B2118' },
  parrot: { fur: '#34D399', fur2: '#059669', belly: '#FEF08A', ear: '#F87171', accent: '#3B82F6', eye: '#1F2937' },
};

function getPalette(speciesId: string): Palette { return PALETTES[speciesId] ?? PALETTES.fox; }

const ACCESSORY_GLYPH: Record<BuddyAccessory, string> = {
  none: '',
  bow: '❀',
  scarf: '≈',
  crown: '♛',
  star: '★',
};

export function BuddyAvatar({ speciesId, formId, size = 220, state = 'idle', speaking = false, onStateChange, interactive = true, accessory = 'none' }: Props) {
  const rendered = renderCharacter({ speciesId, formId, size, state, speaking, onStateChange, interactive });
  const avatar = rendered ?? (
    <GenericBuddyAvatar speciesId={speciesId} size={size} state={state} onStateChange={onStateChange} interactive={interactive} />
  );
  const glyph = ACCESSORY_GLYPH[accessory];

  return (
    <View style={{ width: size, height: size }}>
      {avatar}
      {glyph ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: size * 0.06,
            bottom: size * 0.08,
            width: size * 0.2,
            height: size * 0.2,
            borderRadius: size * 0.1,
            backgroundColor: 'rgba(20,20,19,0.72)',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: '#FFFFFF', fontSize: size * 0.11, lineHeight: size * 0.13 }}>{glyph}</Text>
        </View>
      ) : null}
    </View>
  );
}

function GenericBuddyAvatar({ speciesId, size = 220, state = 'idle', onStateChange, interactive = true }: Omit<Props, 'formId' | 'speaking'>) {
  const p = getPalette(speciesId);
  const [internal, setInternal] = useState<BuddyAnimationState>(state);
  const [blinkClosed, setBlinkClosed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;
  const bounce = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync controlled prop to local animation state
    setInternal(state);
  }, [state]);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((enabled) => { if (mounted) setReducedMotion(!!enabled); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled) => {
      if (mounted) setReducedMotion(!!enabled);
    });
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [anim, reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;
    let mounted = true;
    let t: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      t = setTimeout(() => {
        if (!mounted) return;
        setBlinkClosed(true);
        setTimeout(() => { if (mounted) setBlinkClosed(false); }, 120);
        schedule();
      }, 2600 + Math.random() * 1800);
    };
    schedule();
    return () => { mounted = false; if (t) clearTimeout(t); };
  }, [reducedMotion]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (isTransient(internal)) {
      if (!reducedMotion) {
        Animated.sequence([
          Animated.timing(bounce, { toValue: -8, duration: 140, useNativeDriver: true }),
          Animated.timing(bounce, { toValue: 0, duration: 180, useNativeDriver: true }),
        ]).start();
      }
      timer.current = setTimeout(() => { setInternal('idle'); onStateChange?.('idle'); }, transientMs(internal));
    }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [internal, bounce, onStateChange, reducedMotion]);

  // eslint-disable react-hooks/refs -- Animated interpolations are stable, created once from Animated.Value ref.
  const interp = useRef({
    breathe: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }),
    sway: anim.interpolate({ inputRange: [0, 1], outputRange: ['-1.5deg', '1.5deg'] }),
    floatY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }),
  }).current;
  const { breathe, sway, floatY } = interp;
  // eslint-enable react-hooks/refs
  const moodScale = internal === 'happy' || internal === 'celebrating' ? 1.02 : internal === 'sad' ? 0.98 : 1;
  const eyesClosed = internal === 'sleeping' || (blinkClosed && !reducedMotion);
  const transform = reducedMotion
    ? undefined
    : [
        { translateY: Animated.add(floatY, bounce) },
        { scale: Animated.multiply(breathe, moodScale) },
        { rotate: sway as any },
      ];

  const mouthPath = useMemo(() => {
    if (internal === 'happy' || internal === 'celebrating' || internal === 'playing') return 'M145 172c5 8 10 10 15 10s10-2 15-10';
    if (internal === 'sad' || internal === 'concerned') return 'M147 178c4-5 9-7 13-7s9 2 13 7';
    if (internal === 'angry') return 'M148 176h24';
    if (internal === 'speaking') return 'M152 170c2 6 5 8 8 8s6-2 8-8c-2-4-5-6-8-6s-6 2-8 6z';
    return 'M150 173c3 4 6 6 10 6s7-2 10-6';
  }, [internal]);

  const bodyShape = speciesId === 'dolphin'
    ? 'M160 112c48 0 78 28 70 68-7 34-34 54-70 54s-63-20-70-54c-8-40 22-68 70-68z'
    : speciesId === 'parrot'
    ? 'M160 88c34 0 58 24 58 56 0 38-22 72-58 72s-58-34-58-72c0-32 24-56 58-56z'
    : 'M160 94c40 0 70 28 70 66 0 35-25 64-70 64s-70-29-70-64c0-38 30-66 70-66z';

  const ear = (side: 'left' | 'right') => {
    const isLeft = side === 'left';
    const x = isLeft ? 108 : 212;
    const x3 = isLeft ? 122 : 198;
    if (speciesId === 'owl' || speciesId === 'raven' || speciesId === 'parrot') return null;
    if (speciesId === 'elephant') return <Path d={isLeft ? 'M96 112c-24 8-34 34-24 56 8 18 28 26 44 18l8-58z' : 'M224 112c24 8 34 34 24 56-8 18-28 26-44 18l-8-58z'} fill={p.fur2} opacity={0.95} />;
    if (speciesId === 'bear' || speciesId === 'panda') return <Circle cx={isLeft ? 118 : 202} cy={98} r={18} fill={p.fur2} />;
    if (['cat', 'fox', 'wolf', 'deer'].includes(speciesId)) {
      return <G><Path d={`M${x} 102l${isLeft ? 28 : -28}-36 ${isLeft ? 14 : -14} 46z`} fill={p.fur} /><Path d={`M${x + (isLeft ? 9 : -9)} 102l${isLeft ? 17 : -17}-20 ${isLeft ? 8 : -8} 26z`} fill={p.ear} /></G>;
    }
    return <Path d={`M${x3} 98c${isLeft ? -10 : 10}-18 ${isLeft ? 4 : -4}-36 ${isLeft ? 18 : -18}-30l${isLeft ? 8 : -8} 34z`} fill={p.fur2} />;
  };

  const trigger = (next: BuddyAnimationState) => { setInternal(next); onStateChange?.(next); };

  return (
    <Pressable testID="buddy-generic-avatar" disabled={!interactive} onPress={() => trigger('tapped')} onLongPress={() => trigger('long-pressed')} style={{ width: size, height: size }}>
      {/* eslint-disable react-hooks/refs -- stable Animated interpolation refs */}
      <Animated.View style={{ flex: 1, transform }}>
      {/* eslint-enable react-hooks/refs */}
        <Svg viewBox="0 0 320 320" width={size} height={size}>
          <Defs>
            <LinearGradient id={`fur-${speciesId}`} x1="90" y1="70" x2="250" y2="290" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={p.fur} /><Stop offset="1" stopColor={p.fur2} />
            </LinearGradient>
          </Defs>
          <Ellipse cx="160" cy="286" rx="74" ry="14" fill="rgba(20,20,19,0.10)" />
          {speciesId !== 'dolphin' ? <Path d="M222 220c35 2 61-16 66-41 3-15-4-27-16-32-14-6-29 2-33 15-3 10 1 18 8 22-10 12-28 18-48 11z" fill={`url(#fur-${speciesId})`} opacity={0.95} /> : null}
          <Path d="M112 176c0-29 22-50 48-50s48 21 48 50v47c0 27-21 46-48 46s-48-19-48-46v-47z" fill={p.fur2} />
          <Path d="M131 185c0-20 13-34 29-34s29 14 29 34v34c0 19-13 32-29 32s-29-13-29-32v-34z" fill={p.belly} />
          <Path d="M128 252c0-7 5-12 12-12s12 5 12 12v10c0 6-5 11-12 11s-12-5-12-11v-10z" fill={p.belly} />
          <Path d="M168 252c0-7 5-12 12-12s12 5 12 12v10c0 6-5 11-12 11s-12-5-12-11v-10z" fill={p.belly} />
          {ear('left')}
          {ear('right')}
          <Path d={bodyShape} fill={`url(#fur-${speciesId})`} />
          <Path d="M160 124c20 0 37 12 44 30-6 24-23 40-44 40s-38-16-44-40c7-18 24-30 44-30z" fill={p.belly} />
          {eyesClosed ? (
            <>
              <Path d="M126 138c4 4 8 4 20 0" stroke={p.eye} strokeWidth="3.5" strokeLinecap="round" />
              <Path d="M174 138c12 4 16 4 20 0" stroke={p.eye} strokeWidth="3.5" strokeLinecap="round" />
            </>
          ) : (
            <>
              <Ellipse cx="136" cy="138" rx="9" ry="11" fill={p.eye} />
              <Ellipse cx="184" cy="138" rx="9" ry="11" fill={p.eye} />
              <Circle cx="138" cy="135" r="3.2" fill="#FFFFFF" />
              <Circle cx="186" cy="135" r="3.2" fill="#FFFFFF" />
            </>
          )}
          <Path d="M160 152c5 0 10 3 10 7 0 5-5 9-10 9s-10-4-10-9c0-4 5-7 10-7z" fill="#3A2A25" />
          <Path d={mouthPath} stroke="#3A2A25" strokeWidth="3.5" strokeLinecap="round" fill={internal === 'speaking' ? '#7C2D12' : 'none'} />
          <Path d="M118 192c10 10 25 16 42 16s32-6 42-16l-6 20c-9 8-22 12-36 12s-27-4-36-12l-6-20z" fill={p.accent} opacity={0.95} />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}
