/* eslint-disable react-hooks/refs */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SvgXml } from 'react-native-svg';

import { applyExpression, parseCharacterSvg } from '@/lib/buddy/characters/core/parts';
import type { AppendagePivot, CharacterSvgParts } from '@/lib/buddy/characters/core/types';
import { wrapSvg } from '@/lib/buddy/characters/core/xml';
import { getCharacterLoader, getCharacterRig } from '@/lib/buddy/characters/rigs';
import { isTransient, transientMs, transition } from '@/lib/buddy/engine/stateMachine';
import type { BuddyAnimationState } from '@/lib/buddy/types';

type Props = {
  speciesId: string;
  formId?: string;
  size?: number;
  state?: BuddyAnimationState;
  speaking?: boolean;
  onStateChange?: (state: BuddyAnimationState) => void;
  interactive?: boolean;
};

const FALLBACK_BG = '#17181C';

function origin(pivot: AppendagePivot | undefined, size: number): string | undefined {
  if (!pivot) return undefined;
  return `${(pivot.x / 320) * size}px ${(pivot.y / 320) * size}px`;
}

function stateEnergy(state: BuddyAnimationState): number {
  if (['happy', 'celebrating', 'playing', 'jumping', 'walking', 'tapped', 'double-tapped', 'long-pressed'].includes(state)) {
    return 0.68;
  }
  if (['sad', 'concerned', 'thinking', 'sleeping'].includes(state)) return 1.35;
  return 1;
}

/** Shared asset-driven renderer used by all 15 non-Kiko Buddy rigs. */
export function RigCharacterAvatar({
  speciesId,
  formId,
  size = 280,
  state = 'idle',
  speaking = false,
  onStateChange,
  interactive = true,
}: Props) {
  const rig = getCharacterRig(speciesId);
  const [xml, setXml] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [local, setLocal] = useState<BuddyAnimationState>(state);
  const [blinkClosed, setBlinkClosed] = useState(false);
  const [talkOpen, setTalkOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [batterySaver, setBatterySaver] = useState(false);
  const [paused, setPaused] = useState(AppState.currentState !== 'active');

  const breath = useRef(new Animated.Value(0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const bounce = useRef(new Animated.Value(0)).current;
  const ear = useRef(new Animated.Value(0)).current;
  const walk = useRef(new Animated.Value(0)).current;
  const jump = useRef(new Animated.Value(0)).current;
  const headTilt = useRef(new Animated.Value(0)).current;
  const appendageValues = useMemo(
    () => (rig?.appendages ?? []).map(() => new Animated.Value(0)),
    [rig]
  );

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef(0);
  const lastLongPress = useRef(0);
  const pettingRef = useRef(false);
  const loops = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    if (!rig) return;
    void getCharacterLoader(speciesId)?.preload([rig.baseFormId]);
  }, [rig, speciesId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => setPaused(next !== 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => {
        if (mounted) setReducedMotion(!!value);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value) => setReducedMotion(!!value));
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let powerSub: { remove?: () => void } | null = null;
    (async () => {
      try {
        const Battery: any = await import('expo-battery');
        const low = await Battery.isLowPowerModeEnabledAsync();
        if (mounted) setBatterySaver(!!low);
        powerSub =
          Battery.addLowPowerModeListener?.(({ lowPowerMode }: { lowPowerMode: boolean }) =>
            setBatterySaver(!!lowPowerMode)
          ) ?? null;
      } catch {
        // expo-battery is optional at runtime.
      }
    })();
    return () => {
      mounted = false;
      powerSub?.remove?.();
    };
  }, []);

  useEffect(() => {
    if (!rig) return;
    const loader = getCharacterLoader(speciesId);
    if (!loader) return;
    let active = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset error banner on form switch
    setLoadError(null);
    loader
      .loadFormSvg(formId)
      .then(({ xml: loaded, fallback }) => {
        if (!active) return;
        if (__DEV__ && fallback) console.warn(`${rig.displayName} form missing, using base`, formId);
        setXml(loaded);
      })
      .catch((error) => {
        console.error(`${rig.displayName} SVG load failed`, { speciesId, formId, error });
        if (active) {
          setXml(null);
          setLoadError('Character artwork unavailable');
        }
      });
    return () => {
      active = false;
    };
  }, [formId, rig, speciesId]);

  // Controlled prop sync; the guard prevents render loops on unrelated updates.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync controlled animation state to local state
    setLocal((previous) => (previous === state ? previous : state));
  }, [state]);

  const setAnimState = useCallback(
    (next: BuddyAnimationState) => {
      setLocal((previous) => {
        const resolved = transition(previous, { type: 'SET', state: next });
        if (resolved !== previous) onStateChange?.(resolved);
        return resolved;
      });
    },
    [onStateChange]
  );

  const stopLoops = useCallback(() => {
    loops.current.forEach((loop) => loop.stop());
    loops.current = [];
  }, []);

  const animateAllowed = !paused && !reducedMotion && !batterySaver && local !== 'sleeping';
  const reduced = reducedMotion || batterySaver;

  useEffect(() => {
    stopLoops();
    if (!rig) return;
    const values = [breath, sway, ...appendageValues, ear, headTilt];
    values.forEach((value) => value.setValue(0));
    if (!animateAllowed) return;

    const energy = stateEnergy(local);
    const mk = (animation: Animated.CompositeAnimation) => {
      loops.current.push(animation);
      animation.start();
    };

    const breathDuration = local === 'working' || local === 'waiting' ? 1500 : 2400;
    mk(
      Animated.loop(
        Animated.sequence([
          Animated.timing(breath, { toValue: 1, duration: breathDuration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(breath, { toValue: 0, duration: breathDuration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      )
    );
    mk(
      Animated.loop(
        Animated.sequence([
          Animated.timing(sway, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(sway, { toValue: -1, duration: 2400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ])
      )
    );

    rig.appendages.forEach((appendage, index) => {
      const value = appendageValues[index];
      if (!value) return;
      const duration = Math.max(180, appendage.duration * energy);
      mk(
        Animated.loop(
          Animated.sequence([
            Animated.timing(value, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(value, { toValue: -1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ])
        )
      );
    });

    if (rig.motion.earTwitch > 0) {
      mk(
        Animated.loop(
          Animated.sequence([
            Animated.delay(3200),
            Animated.timing(ear, { toValue: 1, duration: 110, useNativeDriver: true }),
            Animated.timing(ear, { toValue: 0, duration: 170, useNativeDriver: true }),
          ])
        )
      );
    }
    mk(
      Animated.loop(
        Animated.sequence([
          Animated.delay(5000),
          Animated.timing(headTilt, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(headTilt, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      )
    );

    return stopLoops;
  }, [animateAllowed, appendageValues, breath, ear, headTilt, local, rig, stopLoops, sway]);

  // Natural blink timer respects background, reduced motion, battery saver and sleep.
  useEffect(() => {
    if (paused || reducedMotion || local === 'sleeping') return;
    let mounted = true;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      timeout = setTimeout(() => {
        if (!mounted) return;
        setBlinkClosed(true);
        setLocal((previous) => transition(previous, { type: 'BLINK' }));
        setTimeout(() => {
          if (!mounted) return;
          setBlinkClosed(false);
          setLocal((previous) => (previous === 'blink' ? 'idle' : previous));
        }, 170);
        schedule();
      }, 2600 + Math.random() * 2200);
    };
    schedule();
    return () => {
      mounted = false;
      if (timeout) clearTimeout(timeout);
    };
  }, [local, paused, reducedMotion]);

  // Talking mouth cadence; driven by the real speech start/stop callbacks in the screen.
  useEffect(() => {
    if (!speaking || reduced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset talking mouth when speech stops
      setTalkOpen(false);
      return;
    }
    const id = setInterval(() => setTalkOpen((value) => !value), 150);
    return () => clearInterval(id);
  }, [reduced, speaking]);

  useEffect(() => {
    if (!animateAllowed) {
      walk.setValue(0);
      return;
    }
    if (local === 'walking') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(walk, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(walk, { toValue: -1, duration: 280, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    walk.setValue(0);
    return undefined;
  }, [animateAllowed, local, walk]);

  useEffect(() => {
    if (!animateAllowed) {
      jump.setValue(0);
      return;
    }
    if (local === 'jumping') {
      Animated.sequence([
        Animated.timing(jump, { toValue: -22, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(jump, { toValue: 0, duration: 280, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]).start();
    } else {
      jump.setValue(0);
    }
  }, [animateAllowed, jump, local]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (isTransient(local)) {
      if (animateAllowed) {
        Animated.sequence([
          Animated.timing(bounce, { toValue: -8, duration: 140, useNativeDriver: true }),
          Animated.timing(bounce, { toValue: 0, duration: 180, useNativeDriver: true }),
        ]).start();
      }
      timer.current = setTimeout(() => setAnimState('idle'), transientMs(local));
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [animateAllowed, bounce, local, setAnimState]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gesture) =>
        interactive && !reducedMotion && !paused && (Math.abs(gesture.dx) > 10 || Math.abs(gesture.dy) > 10),
      onPanResponderMove: (_, gesture) => {
        if (Math.abs(gesture.dx) + Math.abs(gesture.dy) > 24 && !pettingRef.current) {
          pettingRef.current = true;
          setAnimState(rig?.interactions.pet ?? 'petting');
        }
      },
      onPanResponderRelease: () => {
        if (pettingRef.current) {
          pettingRef.current = false;
          setTimeout(() => setAnimState('idle'), 350);
        }
      },
      onPanResponderTerminate: () => {
        pettingRef.current = false;
      },
    })
  ).current;

  const parts = useMemo(() => {
    if (!xml || !rig) return null;
    const key = `rig:${rig.speciesId}:${formId ?? rig.baseFormId}:${xml.length}`;
    const loader = getCharacterLoader(speciesId);
    const cached = loader?.getCachedParsed<CharacterSvgParts>(key);
    if (cached) return cached;
    const parsed = parseCharacterSvg(xml, rig);
    loader?.setCachedParsed(key, parsed);
    return parsed;
  }, [formId, rig, speciesId, xml]);

  const headXml = useMemo(() => {
    if (!parts?.head) return null;
    const talkingOpen = speaking && talkOpen;
    // Alternate open/closed mouth layers while real speech is active. If the
    // screen sets state="speaking" without a speaking prop, keep the open mouth.
    const expressionState = local === 'speaking' && speaking && !talkOpen ? 'idle' : local;
    const withExpression = applyExpression(parts.head, {
      state: expressionState,
      speaking: talkingOpen,
      blink: blinkClosed,
      mapping: rig?.expressions,
    });
    return wrapSvg(withExpression, parts.defs);
  }, [blinkClosed, local, parts, rig?.expressions, speaking, talkOpen]);

  const bodyXml = useMemo(() => {
    if (!parts) return null;
    return wrapSvg(`${parts.shadow}${parts.body}`, parts.defs);
  }, [parts]);

  const earsXml = useMemo(() => (parts?.ears ? wrapSvg(parts.ears, parts.defs) : null), [parts]);
  const accessoryXml = useMemo(
    () => (parts?.accessory ? wrapSvg(parts.accessory, parts.defs) : null),
    [parts]
  );

  if (!rig) {
    return (
      <View style={[styles.fallback, { width: size, height: size }]}>
        <Text style={styles.fallbackTitle}>Unknown buddy</Text>
        <Text style={styles.fallbackCaption}>{speciesId}</Text>
      </View>
    );
  }

  if (loadError || !parts || !bodyXml || !headXml) {
    return (
      <View testID="buddy-rig-fallback" style={[styles.fallback, { width: size, height: size }]}>
        <Text style={styles.fallbackTitle}>{rig.displayName}</Text>
        <Text style={styles.fallbackCaption}>{loadError ?? 'Loading character…'}</Text>
        {__DEV__ ? <Text style={styles.fallbackDebug}>{formId ?? rig.baseFormId}</Text> : null}
      </View>
    );
  }

  const bodyScaleY = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1 + rig.motion.breath] });
  const bodyTranslateY = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -2 - rig.motion.hover * 0.2],
  });
  const hoverTranslate = local === 'sleeping' ? 0 : -rig.motion.hover;
  const swayRotate = sway.interpolate({
    inputRange: [-1, 1],
    outputRange: [`-${rig.motion.sway}deg`, `${rig.motion.sway}deg`],
  });
  const earRotate = ear.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', `-${rig.motion.earTwitch}deg`],
  });
  const walkBob = walk.interpolate({ inputRange: [-1, 1], outputRange: [2, -2] });
  const headRotate = headTilt.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', `${rig.motion.headTilt}deg`],
  });
  const moodScale =
    local === 'happy' || local === 'celebrating' ? 1.02 : local === 'sad' || local === 'concerned' ? 0.985 : 1;
  const bodyMotion = Animated.add(Animated.add(bodyTranslateY, bounce), Animated.add(jump, walkBob));
  const bodyOrigin = origin(rig.motion.bodyPivot, size);
  const headOrigin = origin(rig.motion.headPivot, size);
  const earOrigin = origin(rig.motion.earPivot, size);

  const onPress = () => {
    if (!interactive) return;
    if (Date.now() - lastLongPress.current < 450) return;
    const now = Date.now();
    if (now - lastTap.current < 320) {
      setAnimState(rig.interactions.doubleTap);
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    setAnimState(rig.interactions.tap);
  };

  const renderAppendage = (appendage: (typeof rig.appendages)[number], index: number) => {
    const layer = parts.appendages[appendage.id];
    if (!layer) return null;
    const value = appendageValues[index];
    const direction = appendage.phase ? -1 : 1;
    const rotate = value
      ? value.interpolate({
          inputRange: [-1, 1],
          outputRange: [`${-appendage.amplitude * direction}deg`, `${appendage.amplitude * direction}deg`],
        })
      : undefined;
    return (
      <Animated.View
        key={appendage.id}
        style={[
          StyleSheet.absoluteFill,
          { transform: rotate ? [{ rotate }] : [], transformOrigin: origin(appendage.pivot, size) },
        ]}
        pointerEvents="none"
      >
        <SvgXml xml={wrapSvg(layer, parts.defs)} width={size} height={size} />
      </Animated.View>
    );
  };

  const behind = rig.appendages.filter((appendage) => !appendage.front);
  const front = rig.appendages.filter((appendage) => appendage.front);

  return (
    <View {...pan.panHandlers} style={{ width: size, height: size }}>
      <Pressable
        testID="buddy-rig-pressable"
        accessibilityRole="imagebutton"
        accessibilityLabel={`${rig.displayName} buddy`}
        disabled={!interactive}
        onPress={onPress}
        onLongPress={() => {
          if (!interactive) return;
          lastLongPress.current = Date.now();
          setAnimState(rig.interactions.longPress);
        }}
        delayLongPress={350}
        style={{ width: size, height: size }}
      >
        <Animated.View
          style={{
            width: size,
            height: size,
            transform: [
              { translateY: Animated.add(bodyMotion, hoverTranslate) },
              { scale: moodScale },
            ],
          }}
        >
          {behind.map((appendage, index) => renderAppendage(appendage, index))}
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ scaleY: bodyScaleY }, { rotate: swayRotate }], transformOrigin: bodyOrigin },
            ]}
            pointerEvents="none"
          >
            <SvgXml xml={bodyXml} width={size} height={size} />
          </Animated.View>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { transform: [{ rotate: headRotate }], transformOrigin: headOrigin },
            ]}
            pointerEvents="none"
          >
            <SvgXml xml={headXml} width={size} height={size} />
          </Animated.View>
          {earsXml ? (
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                { transform: [{ rotate: earRotate }], transformOrigin: earOrigin },
              ]}
              pointerEvents="none"
            >
              <SvgXml xml={earsXml} width={size} height={size} />
            </Animated.View>
          ) : null}
          {front.map((appendage, index) => renderAppendage(appendage, behind.length + index))}
          {accessoryXml ? (
            <Animated.View style={StyleSheet.absoluteFill} pointerEvents="none">
              <SvgXml xml={accessoryXml} width={size} height={size} />
            </Animated.View>
          ) : null}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: FALLBACK_BG,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  fallbackTitle: { color: '#F4E7DD', fontWeight: '700', fontSize: 18 },
  fallbackCaption: { color: '#9A9891', fontSize: 12, marginTop: 4, textAlign: 'center' },
  fallbackDebug: { color: '#6B6A65', fontSize: 10, marginTop: 4 },
});
