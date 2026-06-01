import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc, setDoc } from "firebase/firestore";

import CustomAlert from "../components/CustomAlert";
import { auth, db } from "../config/firebaseConfig";
import { DEFAULT_PLATES_KG, DEFAULT_PLATES_LBS } from "../constants/data";
import { genId } from "../utils/helpers";
import {
  syncConfigToCloud,
  syncFoldersToCloud,
  syncGymsToCloud,
  syncSettingsToCloud,
} from "../utils/firebaseSync";
import { Colors } from "../theme";

type SetupAlert = {
  visible: boolean;
  title: string;
  message: string;
};

const DEFAULT_MACHINE_BRANDS = [
  "Precor",
  "Hammer Strength",
  "Technogym",
  "Life Fitness",
];

const clampCycleLength = (value: any) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.max(2, Math.min(9, Math.round(parsed)));
};

const startOfLocalDay = (value: number) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export default function InitialSetupScreen({ route }: any) {
  const [username, setUsername] = useState("");
  const [metric, setMetric] = useState<"KG" | "LBS">("KG");
  const [rest, setRest] = useState("90");
  const [timerEnabled, setTimerEnabled] = useState(true);
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(false);
  const [plateCalcEnabled, setPlateCalcEnabled] = useState(true);
  const [platesKg, setPlatesKg] = useState<number[]>(DEFAULT_PLATES_KG);
  const [platesLbs, setPlatesLbs] = useState<number[]>(DEFAULT_PLATES_LBS);

  const [primaryGym, setPrimaryGym] = useState("");
  const [gymDefaultBrand, setGymDefaultBrand] = useState<string | null>(null);
  const [customBrands, setCustomBrands] = useState<string[]>([]);
  const [brandInput, setBrandInput] = useState("");

  const [createSplit, setCreateSplit] = useState(false);
  const [splitName, setSplitName] = useState("Current Split");
  const [cycleLength, setCycleLength] = useState(7);

  const [loading, setLoading] = useState(false);
  const [alertConfig, setAlertConfig] = useState<SetupAlert>({
    visible: false,
    title: "",
    message: "",
  });

  const allMachineBrands = useMemo(
    () =>
      Array.from(new Set([...DEFAULT_MACHINE_BRANDS, ...customBrands])).sort(
        (a, b) => a.localeCompare(b),
      ),
    [customBrands],
  );

  const selectedPlates = metric === "KG" ? platesKg : platesLbs;

  const showAlert = (title: string, message: string) => {
    setAlertConfig({ visible: true, title, message });
  };

  const togglePlate = (plate: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (metric === "KG") {
      setPlatesKg((prev) =>
        prev.includes(plate)
          ? prev.filter((item) => item !== plate)
          : [...prev, plate].sort((a, b) => b - a),
      );
    } else {
      setPlatesLbs((prev) =>
        prev.includes(plate)
          ? prev.filter((item) => item !== plate)
          : [...prev, plate].sort((a, b) => b - a),
      );
    }
  };

  const handleAddBrand = () => {
    const trimmed = brandInput.trim();
    if (!trimmed) return;

    const exists = allMachineBrands.some(
      (brand) => brand.toLowerCase() === trimmed.toLowerCase(),
    );
    if (exists) {
      setBrandInput("");
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCustomBrands((prev) => [...prev, trimmed]);
    setGymDefaultBrand(trimmed);
    setBrandInput("");
  };

  const handleRemoveBrand = (brand: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCustomBrands((prev) => prev.filter((item) => item !== brand));
    if (gymDefaultBrand === brand) setGymDefaultBrand(null);
  };

  const handleFinish = async () => {
    const trimmedUsername = username.trim();
    const trimmedGym = primaryGym.trim();
    const trimmedSplitName = splitName.trim() || "Current Split";
    const parsedRest = Math.max(15, Math.round(Number(rest || 0)));

    if (!trimmedUsername) {
      showAlert("Required", "Please choose a username to continue.");
      return;
    }

    if (!trimmedGym) {
      showAlert(
        "Gym Required",
        "Add at least one gym before continuing. IronVault uses gyms for workout start checks, history filters, and machine brand defaults.",
      );
      return;
    }

    if (timerEnabled && (!Number.isFinite(parsedRest) || parsedRest <= 0)) {
      showAlert("Invalid Rest Time", "Choose a valid default rest time.");
      return;
    }

    setLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("No user found.");
      const uid = user.uid;

      const usernameRef = doc(db, "usernames", trimmedUsername.toLowerCase());
      const usernameSnap = await getDoc(usernameRef);

      if (usernameSnap.exists()) {
        showAlert("Taken", "This username is already in use.");
        setLoading(false);
        return;
      }

      await setDoc(usernameRef, {
        uid,
        display_name: trimmedUsername,
      });

      const now = Date.now();
      const newGym = {
        id: genId("gym-"),
        name: trimmedGym,
        variants: [],
        defaultMachineBrand: gymDefaultBrand || null,
        createdAt: now,
        updatedAt: now,
      };

      const setupFolders = createSplit
        ? [
            {
              id: genId("fldr-"),
              name: trimmedSplitName,
              templateIds: [],
              cycleLength: clampCycleLength(cycleLength),
              days: Array.from(
                { length: clampCycleLength(cycleLength) },
                (_, index) => ({
                  dayNumber: index + 1,
                  type: "rest" as const,
                  templateId: null,
                }),
              ),
              startDate: startOfLocalDay(now),
              createdAt: now,
              updatedAt: now,
            },
          ]
        : [];

      await AsyncStorage.multiSet([
        [`@user_username_${uid}`, trimmedUsername],
        [`@user_metric_${uid}`, metric],
        [`@rest_time_${uid}`, String(parsedRest)],
        [`@rest_timer_enabled_${uid}`, String(timerEnabled)],
        [`@auto_check_enabled_${uid}`, String(autoCheckEnabled)],
        [`@plate_calc_enabled_${uid}`, String(plateCalcEnabled)],
        [`@plates_kg_${uid}`, JSON.stringify(platesKg)],
        [`@plates_lbs_${uid}`, JSON.stringify(platesLbs)],
        [`@user_gyms_${uid}`, JSON.stringify([newGym])],
        [`@last_used_gym_${uid}`, newGym.id],
        [`@global_variants_${uid}`, JSON.stringify(customBrands)],
        [`@workout_folders_${uid}`, JSON.stringify(setupFolders)],
        [
          `@active_split_folder_${uid}`,
          createSplit && setupFolders[0] ? setupFolders[0].id : "",
        ],
        [`@setup_complete_${uid}`, "true"],
      ]);

      if (!createSplit) {
        await AsyncStorage.removeItem(`@active_split_folder_${uid}`);
      }

      await syncSettingsToCloud({
        username: trimmedUsername,
        metric,
        restTime: String(parsedRest),
        timerEnabled,
        autoCheckEnabled,
        plateCalcEnabled,
        platesKg,
        platesLbs,
        activeSplitFolderId:
          createSplit && setupFolders[0] ? setupFolders[0].id : null,
      });
      await syncGymsToCloud([newGym]);
      await syncConfigToCloud("global_variants" as any, customBrands);
      await syncFoldersToCloud(setupFolders);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      route.params?.onFinish?.();
    } catch (error) {
      console.error("Initial setup failed:", error);
      showAlert("Error", "Could not complete setup. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={localStyles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={[{ text: "OK" }]}
        onClose={() => setAlertConfig((prev) => ({ ...prev, visible: false }))}
      />

      <SafeAreaView edges={["top"]} style={localStyles.header}>
        <Text style={localStyles.eyebrow}>IronVault Setup</Text>
        <Text style={localStyles.title}>Build your training base.</Text>
        <Text style={localStyles.subtitle}>
          Choose your training defaults, add your gym, and optionally create a split shell before entering the app.
        </Text>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={localStyles.content}
      >
        <SetupCard
          icon="person-outline"
          title="Profile"
          subtitle="Used for the Home greeting."
        >
          <TextInput
            placeholder="Username"
            placeholderTextColor={Colors.textMuted}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            editable={!loading}
            style={localStyles.input}
          />
        </SetupCard>

        <SetupCard
          icon="barbell-outline"
          title="Training Defaults"
          subtitle="These can be changed later from Settings."
        >
          <Text style={localStyles.fieldLabel}>Weight Unit</Text>
          <SegmentedToggle
            options={["KG", "LBS"]}
            value={metric}
            onChange={(value) => setMetric(value as "KG" | "LBS")}
          />

          <Text style={localStyles.fieldLabel}>Rest Timer</Text>
          <SegmentedToggle
            options={["ON", "OFF"]}
            value={timerEnabled ? "ON" : "OFF"}
            onChange={(value) => setTimerEnabled(value === "ON")}
          />

          {timerEnabled && (
            <View style={localStyles.inlineInputRow}>
              <Text style={localStyles.inlineInputLabel}>Default rest</Text>
              <TextInput
                style={localStyles.smallInput}
                keyboardType="number-pad"
                value={rest}
                onChangeText={setRest}
                editable={!loading}
              />
              <Text style={localStyles.inlineInputUnit}>seconds</Text>
            </View>
          )}

          <Text style={localStyles.fieldLabel}>Auto Check Sets</Text>
          <SegmentedToggle
            options={["ON", "OFF"]}
            value={autoCheckEnabled ? "ON" : "OFF"}
            onChange={(value) => setAutoCheckEnabled(value === "ON")}
          />

          <Text style={localStyles.fieldLabel}>Plate Calculator</Text>
          <SegmentedToggle
            options={["ON", "OFF"]}
            value={plateCalcEnabled ? "ON" : "OFF"}
            onChange={(value) => setPlateCalcEnabled(value === "ON")}
          />
        </SetupCard>

        {plateCalcEnabled && (
          <SetupCard
            icon="disc-outline"
            title="Available Plates"
            subtitle={`Select the ${metric} plates you normally have access to.`}
          >
            <View style={localStyles.plateWrap}>
              {(metric === "KG" ? DEFAULT_PLATES_KG : DEFAULT_PLATES_LBS).map(
                (plate) => {
                  const active = selectedPlates.includes(plate);
                  return (
                    <TouchableOpacity
                      key={`${metric}-${plate}`}
                      style={[localStyles.plateChip, active && localStyles.plateChipActive]}
                      onPress={() => togglePlate(plate)}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={[localStyles.plateText, active && localStyles.plateTextActive]}
                      >
                        {plate}
                      </Text>
                    </TouchableOpacity>
                  );
                },
              )}
            </View>
          </SetupCard>
        )}

        <SetupCard
          icon="location-outline"
          title="Gym"
          subtitle="Required. Gyms power workout start checks, history filters, and machine brand defaults."
        >
          <TextInput
            placeholder="e.g. ActiveSG Jurong, Home Gym"
            placeholderTextColor={Colors.textMuted}
            value={primaryGym}
            onChangeText={setPrimaryGym}
            editable={!loading}
            style={localStyles.input}
          />

          <Text style={localStyles.fieldLabel}>Default Machine Brand</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <TouchableOpacity
              style={[localStyles.brandChip, !gymDefaultBrand && localStyles.brandChipActive]}
              onPress={() => setGymDefaultBrand(null)}
            >
              <Text
                style={[localStyles.brandText, !gymDefaultBrand && localStyles.brandTextActive]}
              >
                None
              </Text>
            </TouchableOpacity>
            {allMachineBrands.map((brand) => {
              const active = gymDefaultBrand === brand;
              return (
                <TouchableOpacity
                  key={brand}
                  style={[localStyles.brandChip, active && localStyles.brandChipActive]}
                  onPress={() => setGymDefaultBrand(brand)}
                >
                  <Text style={[localStyles.brandText, active && localStyles.brandTextActive]}>
                    {brand}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View style={localStyles.addBrandRow}>
            <TextInput
              placeholder="Add custom machine brand..."
              placeholderTextColor={Colors.textMuted}
              value={brandInput}
              onChangeText={setBrandInput}
              onSubmitEditing={handleAddBrand}
              style={[localStyles.input, { flex: 1, marginBottom: 0 }]}
              editable={!loading}
            />
            <TouchableOpacity style={localStyles.addBrandButton} onPress={handleAddBrand}>
              <Ionicons name="add" size={20} color={Colors.background} />
            </TouchableOpacity>
          </View>

          {customBrands.length > 0 && (
            <View style={localStyles.customBrandWrap}>
              {customBrands.map((brand) => (
                <View key={brand} style={localStyles.customBrandChip}>
                  <Text style={localStyles.customBrandText}>{brand}</Text>
                  <TouchableOpacity onPress={() => handleRemoveBrand(brand)}>
                    <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </SetupCard>

        <SetupCard
          icon="calendar-outline"
          title="Training Split"
          subtitle="Optional. Create a split shell now, then assign templates/rest days later."
        >
          <SegmentedToggle
            options={["CREATE", "SKIP"]}
            value={createSplit ? "CREATE" : "SKIP"}
            onChange={(value) => setCreateSplit(value === "CREATE")}
          />

          {createSplit && (
            <>
              <TextInput
                placeholder="Split name"
                placeholderTextColor={Colors.textMuted}
                value={splitName}
                onChangeText={setSplitName}
                editable={!loading}
                style={[localStyles.input, { marginTop: 14 }]}
              />

              <View style={localStyles.cycleRow}>
                <Text style={localStyles.inlineInputLabel}>Cycle length</Text>
                <TouchableOpacity
                  style={localStyles.stepButton}
                  onPress={() => setCycleLength((prev) => Math.max(2, prev - 1))}
                >
                  <Ionicons name="remove" size={18} color={Colors.text} />
                </TouchableOpacity>
                <Text style={localStyles.cycleValue}>{cycleLength}</Text>
                <TouchableOpacity
                  style={localStyles.stepButton}
                  onPress={() => setCycleLength((prev) => Math.min(9, prev + 1))}
                >
                  <Ionicons name="add" size={18} color={Colors.text} />
                </TouchableOpacity>
                <Text style={localStyles.inlineInputUnit}>days</Text>
              </View>

              <Text style={localStyles.helperText}>
                This creates a primary split folder with rest days. Add templates from the Templates screen when you are ready.
              </Text>
            </>
          )}
        </SetupCard>

        <TouchableOpacity
          style={[localStyles.finishButton, loading && { opacity: 0.65 }]}
          onPress={handleFinish}
          activeOpacity={0.86}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={Colors.background} />
          ) : (
            <>
              <Text style={localStyles.finishText}>Enter IronVault</Text>
              <Ionicons name="arrow-forward" size={20} color={Colors.background} />
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SetupCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <View style={localStyles.card}>
      <View style={localStyles.cardHeader}>
        <View style={localStyles.cardIcon}>
          <Ionicons name={icon} size={20} color={Colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={localStyles.cardTitle}>{title}</Text>
          <Text style={localStyles.cardSubtitle}>{subtitle}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

function SegmentedToggle({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={localStyles.segmentedControl}>
      {options.map((option) => {
        const active = value === option;
        return (
          <TouchableOpacity
            key={option}
            style={[localStyles.segmentButton, active && localStyles.segmentButtonActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChange(option);
            }}
          >
            <Text style={[localStyles.segmentText, active && localStyles.segmentTextActive]}>
              {option}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const localStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
  },
  eyebrow: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: {
    color: Colors.text,
    fontSize: 32,
    lineHeight: 36,
    fontWeight: "900",
    letterSpacing: -1,
    marginBottom: 8,
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "700",
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  card: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  cardIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(50, 215, 75, 0.13)",
    marginRight: 12,
  },
  cardTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 3,
  },
  cardSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  fieldLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginTop: 14,
    marginBottom: 8,
  },
  input: {
    color: Colors.text,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    fontSize: 15,
    fontWeight: "800",
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 13 : 10,
    marginBottom: 12,
  },
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    padding: 4,
  },
  segmentButton: {
    flex: 1,
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 10,
  },
  segmentButtonActive: {
    backgroundColor: Colors.accent,
  },
  segmentText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  segmentTextActive: {
    color: Colors.background,
  },
  inlineInputRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inlineInputLabel: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  smallInput: {
    width: 64,
    color: Colors.text,
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center",
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingVertical: Platform.OS === "ios" ? 8 : 5,
    marginHorizontal: 8,
  },
  inlineInputUnit: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  plateWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  plateChip: {
    minWidth: 62,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: Colors.surface,
  },
  plateChipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  plateText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  plateTextActive: {
    color: Colors.background,
  },
  brandChip: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
    marginRight: 8,
  },
  brandChipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  brandText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  brandTextActive: {
    color: Colors.background,
  },
  addBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    gap: 10,
  },
  addBrandButton: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accent,
  },
  customBrandWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  customBrandChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    gap: 6,
  },
  customBrandText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: "900",
  },
  cycleRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    padding: 12,
  },
  stepButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cycleValue: {
    color: Colors.text,
    fontSize: 19,
    fontWeight: "900",
    minWidth: 38,
    textAlign: "center",
  },
  helperText: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    marginTop: 10,
  },
  finishButton: {
    height: 54,
    borderRadius: 18,
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
  },
  finishText: {
    color: Colors.background,
    fontSize: 15,
    fontWeight: "900",
  },
});
