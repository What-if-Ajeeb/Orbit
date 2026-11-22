/* eslint-disable react-hooks/refs */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { getCachedParsed, loadKikoFormSvg, preloadKikoAssets, setCachedParsed } from '@/lib/buddy/characters/kiko/svgLoader';
import { parseKikoSvgParts, wrapSvg, type KikoSvgParts } from '@/lib/buddy/characters/kiko/svgParts';
import { isTransient, transientMs, transition } from '@/lib/buddy/engine/stateMachine';
import type { BuddyAnimationState } from '@/lib/buddy/types';

type Props = {
  formId?: string;
  size?: number;
  state?: BuddyAnimationState;
  speaking?: boolean;
  onStateChange?: (state: BuddyAnimationState) => void;
  interactive?: boolean;
};

function mouthFor(state: BuddyAnimationState, speaking: boolean): string {
  if (speaking || state === 'speaking') return 'M152 169c2 6 5 9 8 9s6-3 8-9c-2-4-5-6-8-6s-6 2-8 6z';
  if (['happy', 'celebrating', 'playing', 'petting'].includes(state)) return 'M145 172c5 8 10 10 15 10s10-2 15-10';
  if (['sad', 'concerned'].includes(state)) return 'M147 178c4-5 9-7 13-7s9 2 13 7';
  if (state === 'angry') return 'M148 176h24';
  return 'M150 173c3 4 6 6 10 6s7-2 10-6';
}

function applyStateToHead(headXml: string, state: BuddyAnimationState, speaking: boolean, blinkClosed: boolean): string {
  let out = headXml;
  const mouth = mouthFor(state, speaking);
  const mouthFill = speaking || state === 'speaking' ? '#7C2D12' : 'none';
  out = out.replace(/<path id="mouth"[^/]*\/>/, `<path id="mouth" d="${mouth}" stroke="#3A2A25" stroke-width="3.5" stroke-linecap="round" fill="${mouthFill}"/>`);
  if (blinkClosed || state === 'sleeping') {
    out = out.replace(/<g id="eyes-group">[\s\S]*?<\/g>/, `<g id="eyes-group"><path d="M126 138c4 4 8 4 20 0" stroke="#241B18" stroke-width="3.5" stroke-linecap="round"/><path d="M174 138c12 4 16 4 20 0" stroke="#241B18" stroke-width="3.5" stroke-linecap="round"/></g>`);
  } else if (['thinking', 'curious'].includes(state)) {
    out = out.replace(/<circle id="pupil-left"[^/]*\/>/, '<circle id="pupil-left" cx="140" cy="128" r="3.2" fill="#FFFFFF"/>');
    out = out.replace(/<circle id="pupil-right"[^/]*\/>/, '<circle id="pupil-right" cx="188" cy="128" r="3.2" fill="#FFFFFF"/>');
  }
  return out;
}

export function KikoAvatar({ formId = 'fox_base', size = 280, state = 'idle', speaking = false, onStateChange, interactive = true }: Props) {
  const [xml, setXml] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [local, setLocal] = useState<BuddyAnimationState>(state);
  const [blinkClosed, setBlinkClosed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [batterySaver, setBatterySaver] = useState(false);
  const [paused, setPaused] = useState(AppState.currentState !== 'active');

  const breath = useRef(new Animated.Value(0)).current;
  const bounce = useRef(new Animated.Value(0)).current;
  const tail = useRef(new Animated.Value(0)).current;
  const ear = useRef(new Animated.Value(0)).current;
  const walk = useRef(new Animated.Value(0)).current;
  const jump = useRef(new Animated.Value(0)).current;
  const headTilt = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef(0);
  const lastLongPress = useRef(0);
  const pettingRef = useRef(false);
  const loops = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => { void preloadKikoAssets(); }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setPaused(s !== 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { if (mounted) setReducedMotion(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => setReducedMotion(!!v));
    return () => { mounted = false; sub?.remove?.(); };
  }, []);

  useEffect(() => {
    let mounted = true;
    let powerSub: { remove?: () => void } | null = null;
    (async () => {
      try {
        const Battery: any = await import('expo-battery');
        const low = await Battery.isLowPowerModeEnabledAsync();
        if (mounted) setBatterySaver(!!low);
        powerSub = Battery.addLowPowerModeListener?.(({ lowPowerMode }: { lowPowerMode: boolean }) => setBatterySaver(!!lowPowerMode)) ?? null;
      } catch {
        // expo-battery may be unavailable in this environment; fail safe to no battery saver.
      }
    })();
    return () => { mounted = false; powerSub?.remove?.(); };
  }, []);

  useEffect(() => {
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadError(null);
    loadKikoFormSvg(formId)
      .then(({ xml: loaded }) => { if (active) setXml(loaded); })
      .catch((e) => { console.warn('Kiko SVG load failed', e); if (active) { setXml(null); setLoadError('Could not load Kiko asset.'); } });
    return () => { active = false; };
  }, [formId]);

  const setState = useCallback((next: BuddyAnimationState) => {
    setLocal((prev) => {
      const resolved = transition(prev, { type: 'SET', state: next });
      if (resolved !== prev) onStateChange?.(resolved);
      return resolved;
    });
  }, [onStateChange]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(state);
  }, [state]);

  const stopLoops = useCallback(() => { loops.current.forEach((l) => l.stop()); loops.current = []; }, []);
  const animateAllowed = !paused && !reducedMotion && !batterySaver;

  useEffect(() => {
    stopLoops();
    if (!animateAllowed) return;
    const mk = (anim: Animated.CompositeAnimation) => { loops.current.push(anim); anim.start(); };
    mk(Animated.loop(Animated.sequence([Animated.timing(breath, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }), Animated.timing(breath, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true })])));
    mk(Animated.loop(Animated.sequence([Animated.timing(tail, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }), Animated.timing(tail, { toValue: -1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true })])));
    mk(Animated.loop(Animated.sequence([Animated.delay(3200), Animated.timing(ear, { toValue: 1, duration: 120, useNativeDriver: true }), Animated.timing(ear, { toValue: 0, duration: 180, useNativeDriver: true })])));
    mk(Animated.loop(Animated.sequence([Animated.delay(5000), Animated.timing(headTilt, { toValue: 1, duration: 500, useNativeDriver: true }), Animated.timing(headTilt, { toValue: 0, duration: 500, useNativeDriver: true })])));
    return stopLoops;
  }, [animateAllowed, breath, ear, headTilt, stopLoops, tail]);

  useEffect(() => {
    let mounted = true; let t: ReturnType<typeof setTimeout>;
    if (paused || reducedMotion) return;
    const blink = () => { t = setTimeout(() => {
      if (!mounted) return;
      setBlinkClosed(true);
      setLocal((prev) => transition(prev, { type: 'BLINK' }));
      setTimeout(() => { if (mounted) { setBlinkClosed(false); setLocal((prev) => (prev === 'blink' ? 'idle' : prev)); } }, 180);
      blink();
    }, 2600 + Math.random() * 2200); };
    blink(); return () => { mounted = false; clearTimeout(t); };
  }, [paused, reducedMotion]);

  useEffect(() => {
    if (!animateAllowed) { walk.setValue(0); return; }
    if (local === 'walking') {
      const loop = Animated.loop(Animated.sequence([Animated.timing(walk, { toValue: 1, duration: 260, useNativeDriver: true }), Animated.timing(walk, { toValue: -1, duration: 260, useNativeDriver: true })]));
      loop.start(); return () => loop.stop();
    }
    walk.setValue(0);
  }, [local, walk, animateAllowed]);

  useEffect(() => {
    if (!animateAllowed) { jump.setValue(0); return; }
    if (local === 'jumping') {
      Animated.sequence([Animated.timing(jump, { toValue: -22, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }), Animated.timing(jump, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true })]).start();
    } else jump.setValue(0);
  }, [local, jump, animateAllowed]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (isTransient(local)) {
      if (animateAllowed) Animated.sequence([Animated.timing(bounce, { toValue: -8, duration: 140, useNativeDriver: true }), Animated.timing(bounce, { toValue: 0, duration: 180, useNativeDriver: true })]).start();
      timer.current = setTimeout(() => setState('idle'), transientMs(local));
    }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [local, bounce, setState, animateAllowed]);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => interactive && !reducedMotion && !paused && (Math.abs(g.dx) > 10 || Math.abs(g.dy) > 10),
    onPanResponderMove: (_, g) => { if (Math.abs(g.dx) + Math.abs(g.dy) > 22 && !pettingRef.current) { pettingRef.current = true; setState('petting'); } },
    onPanResponderRelease: () => { if (pettingRef.current) { pettingRef.current = false; setTimeout(() => setState('idle'), 350); } },
    onPanResponderTerminate: () => { pettingRef.current = false; },
  })).current;

  const parts = useMemo(() => {
    if (!xml) return null;
    const key = `parts:${formId ?? 'fox_base'}:${xml.length}`;
    const cached = getCachedParsed<KikoSvgParts>(key);
    if (cached) return cached;
    const parsed = parseKikoSvgParts(xml);
    setCachedParsed(key, parsed);
    return parsed;
  }, [xml, formId]);

  const headXml = useMemo(() => parts?.head ? wrapSvg(applyStateToHead(parts.head, local, speaking, blinkClosed), parts.defs) : null, [parts, local, speaking, blinkClosed]);
  const tailXml = useMemo(() => parts?.tail ? wrapSvg(parts.tail, parts.defs) : null, [parts]);
  const bodyXml = useMemo(() => parts ? wrapSvg(`${parts.shadow}${parts.body}`, parts.defs) : null, [parts]);
  const earsXml = useMemo(() => parts?.ears ? wrapSvg(parts.ears, parts.defs) : null, [parts]);
  const accessoryXml = useMemo(() => parts?.accessory ? wrapSvg(parts.accessory, parts.defs) : null, [parts]);

  const bodyScaleY = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const bodyTranslateY = breath.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });
  const tailRotate = tail.interpolate({ inputRange: [-1, 1], outputRange: ['-10deg', '10deg'] });
  const earRotate = ear.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-8deg'] });
  const walkBob = walk.interpolate({ inputRange: [-1, 1], outputRange: [2, -2] });
  const headRot = headTilt.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '2deg'] });
  const moodScale = local === 'happy' || local === 'celebrating' ? 1.02 : local === 'sad' ? 0.98 : 1;

  const onPress = () => {
    if (!interactive) return;
    if (Date.now() - lastLongPress.current < 450) return; // prevent long-press release tap
    const now = Date.now();
    if (now - lastTap.current < 320) { setState('double-tapped'); lastTap.current = 0; return; }
    lastTap.current = now;
    setState('tapped');
  };

  if (loadError || !parts || !bodyXml) {
    return <View style={[styles.fallback, { width: size, height: size }]}><Text style={styles.fallbackText}>Kiko</Text><Text style={styles.fallbackSub}>{loadError ? 'Asset fallback' : 'Loading...'}</Text></View>;
  }

  return (
    <View {...pan.panHandlers} style={{ width: size, height: size }}>
      <Pressable
        testID="kiko-pressable"
        disabled={!interactive}
        onPress={onPress}
        onLongPress={() => { if (!interactive) return; lastLongPress.current = Date.now(); setState('long-pressed'); }}
        delayLongPress={350}
        style={{ width: size, height: size }}
      >
        <Animated.View style={{ width: size, height: size, transform: [{ translateY: Animated.add(Animated.add(bodyTranslateY, bounce), Animated.add(jump, walkBob)) }, { scale: moodScale }] }}>
          <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scaleY: bodyScaleY }] }]}><SvgXml xml={bodyXml} width={size} height={size} /></Animated.View>
          {tailXml ? <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: tailRotate }] }]}><SvgXml xml={tailXml} width={size} height={size} /></Animated.View> : null}
          {headXml ? <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: headRot }] }]}><SvgXml xml={headXml} width={size} height={size} /></Animated.View> : null}
          {earsXml ? <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate: earRotate }] }]}><SvgXml xml={earsXml} width={size} height={size} /></Animated.View> : null}
          {accessoryXml ? <Animated.View style={StyleSheet.absoluteFill}><SvgXml xml={accessoryXml} width={size} height={size} /></Animated.View> : null}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', borderRadius: 999, backgroundColor: '#F4E7DD' },
  fallbackText: { color: '#B5502F', fontWeight: '700', fontSize: 20 },
  fallbackSub: { color: '#6B6A65', fontSize: 12, marginTop: 4 },
});
