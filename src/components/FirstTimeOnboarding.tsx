import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { auth } from "../config/firebaseConfig";
import { Colors, Radius, Spacing, Shadows } from "../theme";

type IntroStep = {
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const INTRO_STEPS: IntroStep[] = [
  {
    title: "Set up the essentials",
    body: "Choose KG/LBS, rest timer defaults, auto-check sets, plate calculator preferences, and your first gym during setup.",
    icon: "options-outline",
  },
  {
    title: "Train from Home",
    body: "Home shows today’s split workout, active sessions, completed-today status, weekly stats, and training momentum.",
    icon: "home-outline",
  },
  {
    title: "Use templates and splits",
    body: "Create templates from All, organise them into folders, assign D1–D9, include rest days, and long-press folder templates to reorder.",
    icon: "calendar-outline",
  },
  {
    title: "Build your exercise library",
    body: "Use one unified library with All, Favorites, Recent, and Custom. Create custom exercises from the Custom tab only.",
    icon: "library-outline",
  },
  {
    title: "Log workouts fast",
    body: "Track sets, rest timers, notes, variants, working sets, exercise history, gym filters, and machine brand filters from the workout screen.",
    icon: "barbell-outline",
  },
  {
    title: "Review progress",
    body: "History is your workout log. Progress & Statistics contains summaries, range filters, and weekly or monthly trends.",
    icon: "trending-up-outline",
  },
  {
    title: "Keep data safe",
    body: "Use Sync & Backup in Settings to sync workouts, templates, folders, exercises, favorites, gyms, machine brands, and settings.",
    icon: "cloud-upload-outline",
  },
];

export default function FirstTimeOnboarding() {
  const [visible, setVisible] = useState(false);
  const [checking, setChecking] = useState(true);
  const uid = auth.currentUser?.uid;

  const storageKey = useMemo(
    () =>
      uid
        ? `@first_time_onboarding_seen_${uid}`
        : "@first_time_onboarding_seen_guest",
    [uid],
  );

  useEffect(() => {
    let mounted = true;

    const checkSeen = async () => {
      try {
        const seen = await AsyncStorage.getItem(storageKey);
        if (mounted && seen !== "true") setVisible(true);
      } catch (error) {
        console.log("Unable to check first-time onboarding state:", error);
      } finally {
        if (mounted) setChecking(false);
      }
    };

    checkSeen();

    return () => {
      mounted = false;
    };
  }, [storageKey]);

  const closeGuide = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVisible(false);
    try {
      await AsyncStorage.setItem(storageKey, "true");
    } catch (error) {
      console.log("Unable to save first-time onboarding state:", error);
    }
  };

  if (checking || !visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.heroIcon}>
                <Ionicons
                  name="shield-checkmark-outline"
                  size={26}
                  color={Colors.accent}
                />
              </View>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={closeGuide}
                activeOpacity={0.85}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            <Text style={styles.title}>Welcome to IronVault</Text>
            <Text style={styles.subtitle}>
              Set up your gym, follow your split, log workouts, review progress,
              and keep your IronVault data backed up.
            </Text>

            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
            >
              {INTRO_STEPS.map((step, index) => (
                <View key={step.title} style={styles.stepCard}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>{index + 1}</Text>
                  </View>
                  <View style={styles.stepIcon}>
                    <Ionicons
                      name={step.icon}
                      size={20}
                      color={Colors.accent}
                    />
                  </View>
                  <View style={styles.stepTextBlock}>
                    <Text style={styles.stepTitle}>{step.title}</Text>
                    <Text style={styles.stepBody}>{step.body}</Text>
                  </View>
                </View>
              ))}

              <View style={styles.manualHint}>
                <Ionicons name="book-outline" size={18} color={Colors.accent} />
                <Text style={styles.manualHintText}>
                  Need the full manual later? Open Settings → IronVault Guide.
                </Text>
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.primaryButton}
                onPress={closeGuide}
                activeOpacity={0.88}
              >
                <Text style={styles.primaryButtonText}>Get Started</Text>
                <Ionicons name="arrow-forward" size={18} color="#000" />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    justifyContent: "center",
  },
  safeArea: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  card: {
    maxHeight: "88%",
    backgroundColor: Colors.card,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
    ...Platform.select({
      ios: Shadows.card,
      android: { elevation: 10 },
    }),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 20,
    paddingHorizontal: 20,
    marginBottom: 14,
  },
  heroIcon: {
    width: 50,
    height: 50,
    borderRadius: Radius.xl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(50, 215, 75, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.32)",
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    color: Colors.text,
    fontSize: 28,
    lineHeight: 33,
    fontWeight: "900",
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
    paddingHorizontal: 20,
    marginBottom: 18,
  },
  body: {
    maxHeight: 430,
  },
  bodyContent: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  stepCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 12,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accent,
    marginRight: 10,
    marginTop: 1,
  },
  stepNumberText: {
    color: "#000",
    fontSize: 12,
    fontWeight: "900",
  },
  stepIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(50, 215, 75, 0.12)",
    marginRight: 12,
  },
  stepTextBlock: {
    flex: 1,
  },
  stepTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 4,
  },
  stepBody: {
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
  },
  manualHint: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.28)",
    padding: 14,
    marginTop: 4,
  },
  manualHintText: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "800",
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  primaryButton: {
    height: 54,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  primaryButtonText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "900",
  },
});
