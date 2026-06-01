import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { Ionicons } from "@expo/vector-icons";
import { styles } from "../constants/globalStyles";
import { DEFAULT_PLATES_KG, DEFAULT_PLATES_LBS } from "../constants/data";

import { auth, db } from "../config/firebaseConfig";
import { deleteUser, signOut } from "firebase/auth";
import {
  doc,
  getDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import {
  fetchConfigFromCloud,
  syncSettingsToCloud,
  syncGymsToCloud,
  syncConfigToCloud,
  pushWorkoutListToCloud,
  syncEverythingWithCloud,
  getLocalCloudSyncStatus,
  buildIronVaultBackup,
  importIronVaultBackup,
} from "../utils/firebaseSync";

import CustomAlert from "../components/CustomAlert";
import { genId } from "../utils/helpers";

const GUIDE_CONTENT = [
  {
    title: "Active Workout",
    icon: "fitness",
    color: "#32D74B",
    items: [
      {
        title: "Warm-ups & Deleting Sets",
        desc: "Tap any set number (1, 2, 3...) to instantly toggle it into a Warm-up (W) set. Hold down the set number to permanently delete that set.",
      },
      {
        title: "Session Overrides",
        desc: "Tap the 3-dot menu to adjust your rest timer, open the plate calculator, or rearrange exercises. Changes here apply ONLY to your current workout.",
      },
      {
        title: "On-the-Fly Edits",
        desc: "Tap the header title to rename your workout. Need a new exercise? Search the global database or create custom ones directly mid-workout.",
      },
      {
        title: "Smart Templates",
        desc: "Finished a great freestyle workout? The app will offer to save it as a template. If you edit a template mid-workout, it detects the changes and asks if you want to update the original blueprint!",
      },
    ],
  },
  {
    title: "History & Performance",
    icon: "time",
    color: "#0A84FF",
    items: [
      {
        title: "Quick Delete",
        desc: "Long-press any workout card in the list to permanently erase it from your phone and the cloud.",
      },
      {
        title: "Edit Past Sessions",
        desc: "Tap any past workout to jump back into it. You can fix typos, add missed sets, or adjust the duration.",
      },
      {
        title: "Export Old Cards",
        desc: "Open a past workout and tap the download icon (top right) to save your summary card to your camera roll.",
      },
    ],
  },
  {
    title: "Routines & Templates",
    icon: "document-text",
    color: "#FFD700",
    items: [
      {
        title: "Template Options",
        desc: "Tap the 3-dot menu on any template card to edit its structure, rename it, or delete it permanently.",
      },
      {
        title: "Seamless Start",
        desc: "Tap a template to instantly load it into a new workout session with all your planned sets ready to go.",
      },
    ],
  },
  {
    title: "Exercise Library",
    icon: "library",
    color: "#FF9F0A",
    items: [
      {
        title: "Unified Library",
        desc: "Browse built-in and custom exercises together, then use Favorites, Recent, and Custom filters to keep your library fast and focused.",
      },
      {
        title: "Form Cues & Reminders",
        desc: "Edit custom exercises to add reminders (e.g., 'Keep back straight'). These cues will appear automatically under the exercise name during your workouts.",
      },
    ],
  },
];

const DEFAULT_VARIANTS = [
  "Precor",
  "Hammer Strength",
  "Technogym",
  "Life Fitness",
];

const formatSyncTime = (timestamp?: number | null) => {
  if (!timestamp) return "Never synced";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Never synced";

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (sameDay) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString())
    return `Yesterday, ${time}`;

  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const formatSyncCounts = (status: any) => {
  if (!status) return "No sync data yet";

  const details = [
    `${status.workouts ?? 0} workouts`,
    `${status.templates ?? 0} templates`,
    `${status.folders ?? 0} folders`,
    `${status.personalExercises ?? 0} exercises`,
    `${status.favoriteExercises ?? 0} favorites`,
    `${status.gyms ?? 0} gyms`,
    `${status.machineBrands ?? 0} brands`,
  ];

  return details.join(" · ");
};

const getSyncConfigCount = (configs: any[] = [], key: string) =>
  configs.find((item: any) => item.key === key)?.mergedCount ?? 0;


const getFriendlyOperationError = (error: any, fallback: string) => {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();

  if (message.includes("network") || code.includes("network")) {
    return "Network connection failed. Check your internet connection and try again.";
  }

  if (message.includes("permission") || code.includes("permission")) {
    return "IronVault could not access the required data. Please try again after reopening the app.";
  }

  if (message.includes("json") || message.includes("valid ironvault backup")) {
    return "This file does not look like a valid IronVault backup. Choose a backup exported from IronVault.";
  }

  if (message.includes("cancel")) {
    return "The action was cancelled.";
  }

  return error?.message || fallback;
};

export default function SettingsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [metric, setMetric] = useState("LBS");
  const [rest, setRest] = useState("90");
  const [timerEnabled, setTimerEnabled] = useState(true);
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(false);
  const [plateCalcEnabled, setPlateCalcEnabled] = useState(true);
  const [platesKg, setPlatesKg] = useState<number[]>(DEFAULT_PLATES_KG);
  const [platesLbs, setPlatesLbs] = useState<number[]>(DEFAULT_PLATES_LBS);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [accountDisplayName, setAccountDisplayName] = useState("Athlete");

  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const [isGuideVisible, setIsGuideVisible] = useState(false);
  const [isLegalModalVisible, setIsLegalModalVisible] = useState(false);
  const [legalTab, setLegalTab] = useState<"TERMS" | "PRIVACY">("TERMS");

  const [gyms, setGyms] = useState<any[]>([]);
  const [isGymModalVisible, setIsGymModalVisible] = useState(false);
  const [gymName, setGymName] = useState("");
  const [gymDefaultBrand, setGymDefaultBrand] = useState<string | null>(null);
  const [editingGymId, setEditingGymId] = useState<string | null>(null);
  const [isGymMenuVisible, setIsGymMenuVisible] = useState(false);
  const [selectedGym, setSelectedGym] = useState<any>(null);
  const [deleteGymAlertVisible, setDeleteGymAlertVisible] = useState(false);

  const [globalVariants, setGlobalVariants] = useState<string[]>([]);
  const [isGlobalVariantModalVisible, setIsGlobalVariantModalVisible] =
    useState(false);
  const [newGlobalVariant, setNewGlobalVariant] = useState("");

  const uid = auth.currentUser?.uid;

  const machineBrandOptions = Array.from(
    new Set([...DEFAULT_VARIANTS, ...globalVariants]),
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      });
    });
    return unsubscribe;
  }, [navigation]);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      const m = await AsyncStorage.getItem(`@user_metric_${uid}`);
      const r = await AsyncStorage.getItem(`@rest_time_${uid}`);
      const te = await AsyncStorage.getItem(`@rest_timer_enabled_${uid}`);
      const ac = await AsyncStorage.getItem(`@auto_check_enabled_${uid}`);
      const pc = await AsyncStorage.getItem(`@plate_calc_enabled_${uid}`);
      const pkg = await AsyncStorage.getItem(`@plates_kg_${uid}`);
      const plbs = await AsyncStorage.getItem(`@plates_lbs_${uid}`);

      if (m) setMetric(m);
      if (r) setRest(r);
      if (te !== null) setTimerEnabled(te === "true");
      if (ac !== null) setAutoCheckEnabled(ac === "true");
      if (pc !== null) setPlateCalcEnabled(pc === "true");
      if (pkg) setPlatesKg(JSON.parse(pkg));
      if (plbs) setPlatesLbs(JSON.parse(plbs));

      const localSyncStatus = await getLocalCloudSyncStatus(uid);
      if (localSyncStatus) {
        setSyncStatus(localSyncStatus);
      } else {
        const cloudSyncStatus = await fetchConfigFromCloud(
          "sync_status" as any,
        );
        if (cloudSyncStatus) {
          setSyncStatus(cloudSyncStatus);
          await AsyncStorage.setItem(
            `@cloud_sync_status_${uid}`,
            JSON.stringify(cloudSyncStatus),
          );
        }
      }

      const loadAccountUsername = async () => {
        const user = auth.currentUser;
        if (!user) return;

        const fallbackName = user.email?.split("@")[0] || "Athlete";
        const storedName = await AsyncStorage.getItem(
          `@user_username_${user.uid}`,
        );

        if (storedName) {
          setAccountDisplayName(storedName);
          return;
        }

        try {
          let cloudName: string | null = null;
          const userDoc = await getDoc(doc(db, "users", user.uid));

          if (userDoc.exists() && userDoc.data().username) {
            cloudName = userDoc.data().username;
          } else {
            const q = query(
              collection(db, "usernames"),
              where("uid", "==", user.uid),
            );
            const qSnap = await getDocs(q);
            if (!qSnap.empty) {
              cloudName = qSnap.docs[0].data().display_name;
            }
          }

          if (cloudName) {
            setAccountDisplayName(cloudName);
            await AsyncStorage.setItem(`@user_username_${user.uid}`, cloudName);
          } else {
            setAccountDisplayName(fallbackName);
          }
        } catch (error) {
          console.log("Error fetching settings account username:", error);
          setAccountDisplayName(fallbackName);
        }
      };

      await loadAccountUsername();

      const savedGyms = await AsyncStorage.getItem(`@user_gyms_${uid}`);
      if (savedGyms) {
        setGyms(JSON.parse(savedGyms));
      } else {
        const cloudGyms = await fetchConfigFromCloud("gyms");
        if (cloudGyms && cloudGyms.length > 0) {
          setGyms(cloudGyms);
          await AsyncStorage.setItem(
            `@user_gyms_${uid}`,
            JSON.stringify(cloudGyms),
          );
        }
      }

      const savedGlobalVars = await AsyncStorage.getItem(
        `@global_variants_${uid}`,
      );
      if (savedGlobalVars) {
        setGlobalVariants(JSON.parse(savedGlobalVars));
      } else {
        const cloudVars = await fetchConfigFromCloud("global_variants" as any);
        if (cloudVars) setGlobalVariants(cloudVars);
      }
    })();
  }, [uid]);

  const saveGyms = async (newGyms: any[]) => {
    setGyms(newGyms);
    if (uid) {
      await AsyncStorage.setItem(`@user_gyms_${uid}`, JSON.stringify(newGyms));
      await syncGymsToCloud(newGyms);
    }
  };

  const saveGlobalVariants = async (newVars: string[]) => {
    setGlobalVariants(newVars);
    if (uid) {
      await AsyncStorage.setItem(
        `@global_variants_${uid}`,
        JSON.stringify(newVars),
      );
      await syncConfigToCloud("global_variants" as any, newVars);
    }
  };

  const migrateGymNameUsage = async (gymId: string, newGymName: string) => {
    if (!uid || !gymId || !newGymName.trim()) return;

    const normalizedName = newGymName.trim();
    let changedWorkouts: any[] = [];

    const historyRaw = await AsyncStorage.getItem(`@workout_history_${uid}`);
    if (historyRaw) {
      try {
        const history = JSON.parse(historyRaw);
        if (Array.isArray(history)) {
          const migratedHistory = history.map((workout: any) => {
            if (!workout || String(workout.gymId || "") !== String(gymId)) {
              return workout;
            }

            if (workout.gymName === normalizedName) return workout;

            const updatedWorkout = {
              ...workout,
              gymName: normalizedName,
            };
            changedWorkouts.push(updatedWorkout);
            return updatedWorkout;
          });

          if (changedWorkouts.length > 0) {
            await AsyncStorage.setItem(
              `@workout_history_${uid}`,
              JSON.stringify(migratedHistory),
            );
            await pushWorkoutListToCloud(changedWorkouts);
          }
        }
      } catch (error) {
        console.error("Failed to migrate workout history gym names:", error);
      }
    }

    const activeSessionRaw = await AsyncStorage.getItem(
      `@active_session_${uid}`,
    );
    if (activeSessionRaw) {
      try {
        const activeSession = JSON.parse(activeSessionRaw);
        if (String(activeSession?.gymId || "") === String(gymId)) {
          await AsyncStorage.setItem(
            `@active_session_${uid}`,
            JSON.stringify({
              ...activeSession,
              gymName: normalizedName,
            }),
          );
        }
      } catch (error) {
        console.error("Failed to migrate active session gym name:", error);
      }
    }
  };

  const migrateGymDefaultBrandUsage = async (
    gymId: string,
    oldDefaultBrand: string | null,
    newDefaultBrand: string | null,
  ) => {
    if (
      !uid ||
      !gymId ||
      !oldDefaultBrand ||
      oldDefaultBrand === newDefaultBrand
    ) {
      return {
        changedWorkouts: 0,
        changedExercises: 0,
        changedActiveSession: false,
      };
    }

    const migrateExerciseList = (exerciseList: any[] = []) => {
      let changedExercises = 0;

      const migratedExercises = exerciseList.map((exercise: any) => {
        if (!exercise || exercise.equipmentTag !== oldDefaultBrand) {
          return exercise;
        }

        changedExercises += 1;

        if (newDefaultBrand) {
          return {
            ...exercise,
            equipmentTag: newDefaultBrand,
          };
        }

        const cleanedExercise = { ...exercise };
        delete cleanedExercise.equipmentTag;
        return cleanedExercise;
      });

      return { migratedExercises, changedExercises };
    };

    let changedWorkouts = 0;
    let changedExercises = 0;

    const historyRaw = await AsyncStorage.getItem(`@workout_history_${uid}`);
    if (historyRaw) {
      try {
        const history = JSON.parse(historyRaw);

        if (Array.isArray(history)) {
          const migratedHistory = history.map((workout: any) => {
            if (!workout || workout.gymId !== gymId) return workout;

            const { migratedExercises, changedExercises: changedInWorkout } =
              migrateExerciseList(workout.fullWorkoutData || []);

            if (changedInWorkout === 0) return workout;

            changedWorkouts += 1;
            changedExercises += changedInWorkout;

            return {
              ...workout,
              fullWorkoutData: migratedExercises,
            };
          });

          if (changedWorkouts > 0) {
            await AsyncStorage.setItem(
              `@workout_history_${uid}`,
              JSON.stringify(migratedHistory),
            );

            await pushWorkoutListToCloud(
              migratedHistory.filter(
                (workout: any) => workout && workout.gymId === gymId,
              ),
            );
          }
        }
      } catch (error) {
        console.error("Failed to migrate workout history machine tags:", error);
      }
    }

    let changedActiveSession = false;
    const activeSessionRaw = await AsyncStorage.getItem(
      `@active_session_${uid}`,
    );

    if (activeSessionRaw) {
      try {
        const activeSession = JSON.parse(activeSessionRaw);

        if (activeSession?.gymId === gymId) {
          const {
            migratedExercises,
            changedExercises: changedInActiveSession,
          } = migrateExerciseList(activeSession.exercises || []);

          if (changedInActiveSession > 0) {
            changedActiveSession = true;
            changedExercises += changedInActiveSession;

            await AsyncStorage.setItem(
              `@active_session_${uid}`,
              JSON.stringify({
                ...activeSession,
                exercises: migratedExercises,
                timestamp: Date.now(),
              }),
            );
          }
        }
      } catch (error) {
        console.error("Failed to migrate active workout machine tags:", error);
      }
    }

    return { changedWorkouts, changedExercises, changedActiveSession };
  };

  const handleFullSync = async () => {
    if (!uid) return;

    Alert.alert(
      "Sync with Cloud?",
      "This safely merges your local app data with your cloud backup. Local data will not be deleted. Workouts, templates, folders, exercises, favorites, gyms, machine brands, and settings will all be synced.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sync",
          onPress: async () => {
            setIsSyncing(true);
            try {
              const syncResult = await syncEverythingWithCloud();
              if (syncResult.syncStatus) {
                setSyncStatus(syncResult.syncStatus);
              }

              const [m, r, te, ac, pc, pkg, plbs, savedGyms, savedGlobalVars] =
                await Promise.all([
                  AsyncStorage.getItem(`@user_metric_${uid}`),
                  AsyncStorage.getItem(`@rest_time_${uid}`),
                  AsyncStorage.getItem(`@rest_timer_enabled_${uid}`),
                  AsyncStorage.getItem(`@auto_check_enabled_${uid}`),
                  AsyncStorage.getItem(`@plate_calc_enabled_${uid}`),
                  AsyncStorage.getItem(`@plates_kg_${uid}`),
                  AsyncStorage.getItem(`@plates_lbs_${uid}`),
                  AsyncStorage.getItem(`@user_gyms_${uid}`),
                  AsyncStorage.getItem(`@global_variants_${uid}`),
                ]);

              if (m) setMetric(m);
              if (r) setRest(r);
              if (te !== null) setTimerEnabled(te === "true");
              if (ac !== null) setAutoCheckEnabled(ac === "true");
              if (pc !== null) setPlateCalcEnabled(pc === "true");
              if (pkg) setPlatesKg(JSON.parse(pkg));
              if (plbs) setPlatesLbs(JSON.parse(plbs));
              if (savedGyms) setGyms(JSON.parse(savedGyms));
              if (savedGlobalVars)
                setGlobalVariants(JSON.parse(savedGlobalVars));

              const templatesCount = getSyncConfigCount(
                syncResult.configs,
                "templates",
              );
              const foldersCount = getSyncConfigCount(
                syncResult.configs,
                "folders",
              );
              const exercisesCount = getSyncConfigCount(
                syncResult.configs,
                "personal_exercises",
              );
              const favoritesCount = getSyncConfigCount(
                syncResult.configs,
                "favorite_exercises",
              );
              const gymsCount = getSyncConfigCount(syncResult.configs, "gyms");
              const brandsCount = getSyncConfigCount(
                syncResult.configs,
                "global_variants",
              );

              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );

              Alert.alert(
                "Sync Complete",
                `Synced your full IronVault data.

Workouts: ${syncResult.workouts.mergedCount}
Templates: ${templatesCount}
Folders: ${foldersCount}
Exercises: ${exercisesCount}
Favorites: ${favoritesCount}
Gyms: ${gymsCount}
Machine brands: ${brandsCount}
Last synced: ${formatSyncTime(syncResult.syncStatus?.lastSyncedAt)}`,
              );
            } catch (error) {
              console.error("Cloud sync error:", error);
              Alert.alert(
                "Sync Failed",
                `${getFriendlyOperationError(
                  error,
                  "Could not complete the cloud sync. Your local data was not deleted.",
                )}\n\nYour local data was not deleted.`,
              );
            } finally {
              setIsSyncing(false);
            }
          },
        },
      ],
    );
  };

  const refreshLocalSettingsAfterDataImport = async () => {
    if (!uid) return;

    const [m, r, te, ac, pc, pkg, plbs, savedGyms, savedGlobalVars, status] =
      await Promise.all([
        AsyncStorage.getItem(`@user_metric_${uid}`),
        AsyncStorage.getItem(`@rest_time_${uid}`),
        AsyncStorage.getItem(`@rest_timer_enabled_${uid}`),
        AsyncStorage.getItem(`@auto_check_enabled_${uid}`),
        AsyncStorage.getItem(`@plate_calc_enabled_${uid}`),
        AsyncStorage.getItem(`@plates_kg_${uid}`),
        AsyncStorage.getItem(`@plates_lbs_${uid}`),
        AsyncStorage.getItem(`@user_gyms_${uid}`),
        AsyncStorage.getItem(`@global_variants_${uid}`),
        getLocalCloudSyncStatus(uid),
      ]);

    if (m) setMetric(m);
    if (r) setRest(r);
    if (te !== null) setTimerEnabled(te === "true");
    if (ac !== null) setAutoCheckEnabled(ac === "true");
    if (pc !== null) setPlateCalcEnabled(pc === "true");
    if (pkg) setPlatesKg(JSON.parse(pkg));
    if (plbs) setPlatesLbs(JSON.parse(plbs));
    if (savedGyms) setGyms(JSON.parse(savedGyms));
    if (savedGlobalVars) setGlobalVariants(JSON.parse(savedGlobalVars));
    if (status) setSyncStatus(status);
  };

  const handleExportData = async () => {
    if (!uid || isExporting) return;

    try {
      setIsExporting(true);
      const backup = await buildIronVaultBackup();
      const date = new Date();
      const dateStamp = date.toISOString().slice(0, 10);
      const filename = `ironvault-backup-${dateStamp}.json`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;

      await FileSystem.writeAsStringAsync(
        fileUri,
        JSON.stringify(backup, null, 2),
        { encoding: FileSystem.EncodingType.UTF8 },
      );

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert(
          "Export Ready",
          `Backup created, but sharing is not available on this device. File: ${filename}.`,
        );
        return;
      }

      await Sharing.shareAsync(fileUri, {
        mimeType: "application/json",
        dialogTitle: "Export IronVault Backup",
        UTI: "public.json",
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      console.error("Export backup error:", error);
      Alert.alert(
        "Export Failed",
        getFriendlyOperationError(
          error,
          "Could not export your IronVault backup. Please try again.",
        ),
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportData = async () => {
    if (!uid || isImporting) return;

    Alert.alert(
      "Import Backup?",
      "Choose an IronVault backup JSON file. The import will merge workouts, templates, exercises, favorites, gyms, brands, and settings without wiping local data.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Choose File",
          onPress: async () => {
            try {
              setIsImporting(true);
              const result = await DocumentPicker.getDocumentAsync({
                type: "application/json",
                copyToCacheDirectory: true,
                multiple: false,
              });

              if (result.canceled) return;

              const file = result.assets?.[0];
              if (!file?.uri) {
                throw new Error("Could not read the selected file.");
              }

              const raw = await FileSystem.readAsStringAsync(file.uri, {
                encoding: FileSystem.EncodingType.UTF8,
              });
              const backup = JSON.parse(raw);
              const importResult = await importIronVaultBackup(backup);

              await refreshLocalSettingsAfterDataImport();

              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
              Alert.alert(
                "Import Complete",
                `Merged your backup into IronVault.

Workouts: ${importResult.workouts}
Templates: ${importResult.templates}
Folders: ${importResult.folders}
Exercises: ${importResult.personalExercises}
Favorites: ${importResult.favoriteExercises ?? 0}
Gyms: ${importResult.gyms}
Machine brands: ${importResult.machineBrands}`,
              );
            } catch (error: any) {
              console.error("Import backup error:", error);
              Alert.alert(
                "Import Failed",
                getFriendlyOperationError(
                  error,
                  "Could not import this backup file. Please try again.",
                ),
              );
            } finally {
              setIsImporting(false);
            }
          },
        },
      ],
    );
  };

  const togglePlate = async (plate: number) => {
    if (!uid) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (metric === "KG") {
      const updated = platesKg.includes(plate)
        ? platesKg.filter((p) => p !== plate)
        : [...platesKg, plate].sort((a, b) => b - a);
      setPlatesKg(updated);
      await AsyncStorage.setItem(`@plates_kg_${uid}`, JSON.stringify(updated));
      await syncSettingsToCloud({ platesKg: updated });
    } else {
      const updated = platesLbs.includes(plate)
        ? platesLbs.filter((p) => p !== plate)
        : [...platesLbs, plate].sort((a, b) => b - a);
      setPlatesLbs(updated);
      await AsyncStorage.setItem(`@plates_lbs_${uid}`, JSON.stringify(updated));
      await syncSettingsToCloud({ platesLbs: updated });
    }
  };

  const handleSignOut = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Alert.alert("Sign Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: () =>
          signOut(auth).catch((err) =>
            Alert.alert(
              "Sign Out Failed",
              getFriendlyOperationError(err, "Could not sign out. Please try again."),
            ),
          ),
      },
    ]);
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmationText !== "CONFIRM") {
      Alert.alert(
        "Invalid Input",
        "Please type exactly CONFIRM in all caps to delete your account.",
      );
      return;
    }

    if (!uid || !auth.currentUser) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsDeleting(true);

    try {
      const usernamesRef = collection(db, "usernames");
      const q = query(usernamesRef, where("uid", "==", uid));
      const querySnapshot = await getDocs(q);

      const usernameDeletePromises = querySnapshot.docs.map((d) =>
        deleteDoc(d.ref),
      );
      await Promise.all(usernameDeletePromises);

      const workoutsSnap = await getDocs(
        collection(db, "users", uid, "workouts"),
      );
      const deletePromises = workoutsSnap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(deletePromises);

      const configsSnap = await getDocs(collection(db, "users", uid, "configs"));
      await Promise.all(configsSnap.docs.map((d) => deleteDoc(d.ref)));

      await deleteDoc(doc(db, "users", uid));

      const allKeys = await AsyncStorage.getAllKeys();
      const userKeys = allKeys.filter((k) => k.includes(`_${uid}`));
      await AsyncStorage.multiRemove([
        ...userKeys,
        "@has_completed_setup",
      ]);

      await deleteUser(auth.currentUser);
    } catch (error: any) {
      setIsDeleting(false);
      setIsDeleteModalVisible(false);
      setDeleteConfirmationText("");

      if (error.code === "auth/requires-recent-login") {
        Alert.alert(
          "Security Verification Required",
          "For your security, you must log out and log back in before deleting your account.",
        );
      } else {
        Alert.alert(
          "Delete Account Failed",
          getFriendlyOperationError(
            error,
            "Could not delete your account. Please try again.",
          ),
        );
      }
    }
  };

  const displayName = accountDisplayName || "Athlete";

  const activePlateList = metric === "KG" ? platesKg : platesLbs;
  const defaultPlateList =
    metric === "KG" ? DEFAULT_PLATES_KG : DEFAULT_PLATES_LBS;

  const SectionTitle = ({ title }: { title: string }) => (
    <Text
      style={{
        color: "#8E8E93",
        fontSize: 13,
        fontWeight: "900",
        textTransform: "uppercase",
        letterSpacing: 1.2,
        marginBottom: 12,
      }}
    >
      {title}
    </Text>
  );

  const SettingsCard = ({ children, style }: any) => (
    <View
      style={[
        {
          backgroundColor: "#1C1C1E",
          borderRadius: 24,
          borderWidth: 1,
          borderColor: "#2C2C2E",
          overflow: "hidden",
        },
        style,
      ]}
    >
      {children}
    </View>
  );

  const SettingRow = ({
    title,
    subtitle,
    icon,
    iconColor = "#32D74B",
    right,
    onPress,
    isLast = false,
  }: any) => {
    const RowWrapper: any = onPress ? TouchableOpacity : View;

    return (
      <RowWrapper
        activeOpacity={0.75}
        onPress={onPress}
        style={{
          minHeight: 72,
          paddingVertical: 14,
          paddingHorizontal: 18,
          flexDirection: "row",
          alignItems: "center",
          borderBottomWidth: isLast ? 0 : 1,
          borderBottomColor: "#2C2C2E",
        }}
      >
        {icon && (
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 13,
              backgroundColor: `${iconColor}20`,
              alignItems: "center",
              justifyContent: "center",
              marginRight: 12,
            }}
          >
            <Ionicons name={icon} size={20} color={iconColor} />
          </View>
        )}
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ color: "#FFF", fontSize: 17, fontWeight: "800" }}>
            {title}
          </Text>
          {!!subtitle && (
            <Text
              style={{
                color: "#8E8E93",
                fontSize: 13,
                fontWeight: "600",
                marginTop: 4,
                lineHeight: 18,
              }}
            >
              {subtitle}
            </Text>
          )}
        </View>
        {right}
      </RowWrapper>
    );
  };

  const TogglePill = ({
    options,
    value,
    onChange,
    activeColor = "#32D74B",
  }: any) => (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: "#2C2C2E",
        borderRadius: 16,
        padding: 4,
      }}
    >
      {options.map((option: string) => {
        const active = value === option;
        return (
          <TouchableOpacity
            key={option}
            onPress={() => onChange(option)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 12,
              backgroundColor: active
                ? option === "OFF"
                  ? "#FF453A"
                  : activeColor
                : "transparent",
              minWidth: 52,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: active ? "#FFF" : "#8E8E93",
                fontWeight: "900",
                fontSize: 13,
              }}
            >
              {option}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <View style={styles.screen}>
      <CustomAlert
        visible={deleteGymAlertVisible}
        title="Delete Gym?"
        message={`Are you sure you want to permanently delete "${selectedGym?.name}"? This will not delete your workout history.`}
        buttons={[
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              const updatedGyms = gyms.filter((g) => g.id !== selectedGym.id);
              saveGyms(updatedGyms);
            },
          },
        ]}
        onClose={() => setDeleteGymAlertVisible(false)}
      />

      <Modal
        visible={isGuideVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onDismiss={() => setIsGuideVisible(false)}
        onRequestClose={() => setIsGuideVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <View
            style={{
              width: 40,
              height: 5,
              backgroundColor: "#3A3A3C",
              borderRadius: 3,
              alignSelf: "center",
              marginTop: 12,
              marginBottom: 20,
            }}
          />
          <View style={{ paddingHorizontal: 24, paddingBottom: 16 }}>
            <Text style={{ color: "#FFF", fontSize: 26, fontWeight: "900" }}>
              IronVault Guide
            </Text>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}
          >
            {GUIDE_CONTENT.map((section, idx) => (
              <View
                key={idx}
                style={{
                  backgroundColor: "#1C1C1E",
                  borderRadius: 16,
                  padding: 16,
                  marginBottom: 16,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    marginBottom: 16,
                    borderBottomWidth: 1,
                    borderBottomColor: "#3A3A3C",
                    paddingBottom: 12,
                  }}
                >
                  <Ionicons
                    name={section.icon as any}
                    size={24}
                    color={section.color}
                    style={{ marginRight: 10 }}
                  />
                  <Text
                    style={{ color: "#FFF", fontSize: 20, fontWeight: "800" }}
                  >
                    {section.title}
                  </Text>
                </View>
                {section.items.map((item, i) => (
                  <View
                    key={i}
                    style={{
                      marginBottom: i === section.items.length - 1 ? 0 : 16,
                    }}
                  >
                    <Text
                      style={{
                        color: "#FFF",
                        fontSize: 16,
                        fontWeight: "700",
                        marginBottom: 4,
                      }}
                    >
                      • {item.title}
                    </Text>
                    <Text
                      style={{
                        color: "#8E8E93",
                        fontSize: 14,
                        lineHeight: 22,
                        paddingLeft: 14,
                      }}
                    >
                      {item.desc}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>



      <Modal
        visible={isLegalModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIsLegalModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: "#000" }}>
          <SafeAreaView edges={["top"]} style={{ backgroundColor: "#000" }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 20,
                paddingVertical: 14,
                borderBottomWidth: 1,
                borderBottomColor: "#2C2C2E",
              }}
            >
              <Text style={{ color: "#FFF", fontSize: 18, fontWeight: "900" }}>
                {legalTab === "TERMS" ? "Terms of Service" : "Privacy Policy"}
              </Text>
              <TouchableOpacity onPress={() => setIsLegalModalVisible(false)}>
                <Text style={{ color: "#32D74B", fontSize: 16, fontWeight: "800" }}>
                  Done
                </Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 64 }}>
            {legalTab === "TERMS" ? (
              <Text style={{ color: "#D1D1D6", fontSize: 15, lineHeight: 24 }}>
                <Text style={{ color: "#FFF", fontWeight: "900" }}>Last Updated: May 2026</Text>
                {"\n\n"}
                <Text style={{ color: "#FFF", fontWeight: "900" }}>1. Acceptance of Terms</Text>
                {"\n"}
                By creating an account or using IronVault, you agree to these Terms of Service and the Privacy Policy.
                {"\n\n"}
                <Text style={{ color: "#FFF", fontWeight: "900" }}>2. Fitness and Medical Disclaimer</Text>
                {"\n"}
                IronVault is a workout logging tool. It does not provide medical advice, diagnosis, treatment, coaching, or emergency assistance. You are responsible for training safely.
                {"\n\n"}
                <Text style={{ color: "#FFF", fontWeight: "900" }}>3. User Responsibility</Text>
                {"\n"}
                You are responsible for the workouts, exercises, weights, notes, custom exercises, gyms, machine brands, templates, and other information you create or enter.
                {"\n\n"}
                <Text style={{ color: "#FFF", fontWeight: "900" }}>4. Sync, Backup, and Data Loss</Text>
                {"\n"}
                IronVault provides cloud sync and export/import tools to help keep your data available. No sync or storage system can be guaranteed to be error-free. Keep backups when your data matters.
                {"\n\n"}
                <Text style={{ color: "#FFF", fontWeight: "900" }}>5. Account Deletion</Text>
                {"\n"}
                You can initiate account deletion from Settings. Deletion is intended to remove your cloud account data where possible.
              </Text>
            ) : (
              <Text style={{ color: "#D1D1D6", fontSize: 15, lineHeight: 24 }}>
                <Text style={{ color: "#FFF", fontWeight: "900" }}>Last Updated: May 2026</Text>
                {"\n\n"}
                <Text style={{ color: "#FFF", fontWeight: "900" }}>1. Information We Collect</Text>
                {"\n"}
                IronVault stores account information, workout logs, templates, folders, custom exercises, favorites, gyms, machine brands, app preferences, setup choices, and backup/sync data needed to run the app.
                {"\n\n"}
                <Text style={{ color: "#FFF", fontWeight: "900" }}>2. How We Use Data</Text>
                {"\n"}
                Data is used to provide workout logging, history, progress statistics, exercise stats, templates, gym-specific filters, sync, and backup features.
                {"\n\n"}
                <Text style={{ color: "#FFF", fontWeight: "900" }}>3. Third-Party Services</Text>
                {"\n"}
                IronVault uses Firebase for authentication, cloud database storage, and account-related services.
                {"\n\n"}
                <Text style={{ color: "#FFF", fontWeight: "900" }}>4. Your Controls</Text>
                {"\n"}
                You can export backups, import backups, sync with cloud, sign out, and initiate account deletion from Settings.
                {"\n\n"}
                <Text style={{ color: "#FFF", fontWeight: "900" }}>5. No Selling of Data</Text>
                {"\n"}
                IronVault does not sell your personal information or workout data.
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={isDeleteModalVisible} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.7)",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <View
            style={{
              backgroundColor: "#1C1C1E",
              borderRadius: 16,
              padding: 24,
            }}
          >
            <Text
              style={{
                color: "#FFF",
                fontSize: 20,
                fontWeight: "800",
                marginBottom: 12,
              }}
            >
              Delete Account?
            </Text>
            <Text
              style={{
                color: "#D1D1D6",
                fontSize: 15,
                marginBottom: 20,
                lineHeight: 22,
              }}
            >
              This action is permanent. Your cloud data, including workouts,
              templates, folders, exercises, favorites, gyms, machine brands,
              and settings, will be erased where possible.
            </Text>
            <Text
              style={{
                color: "#8E8E93",
                fontSize: 13,
                marginBottom: 8,
                fontWeight: "600",
              }}
            >
              Type CONFIRM below to proceed:
            </Text>
            <TextInput
              style={{
                backgroundColor: "#000",
                color: "#FFF",
                borderWidth: 1,
                borderColor: "#FF3B30",
                borderRadius: 8,
                padding: 12,
                fontSize: 16,
                marginBottom: 24,
              }}
              value={deleteConfirmationText}
              onChangeText={setDeleteConfirmationText}
              placeholder="CONFIRM"
              placeholderTextColor="#3A3A3C"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <View
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              <TouchableOpacity
                style={{
                  flex: 1,
                  padding: 14,
                  backgroundColor: "#2C2C2E",
                  borderRadius: 8,
                  marginRight: 8,
                  alignItems: "center",
                }}
                onPress={() => {
                  setIsDeleteModalVisible(false);
                  setDeleteConfirmationText("");
                }}
                disabled={isDeleting}
              >
                <Text style={{ color: "#FFF", fontWeight: "700" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 1,
                  padding: 14,
                  backgroundColor: "#FF3B30",
                  borderRadius: 8,
                  marginLeft: 8,
                  alignItems: "center",
                  opacity: deleteConfirmationText === "CONFIRM" ? 1 : 0.5,
                }}
                onPress={handleDeleteAccount}
                disabled={isDeleting || deleteConfirmationText !== "CONFIRM"}
              >
                {isDeleting ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={{ color: "#FFF", fontWeight: "700" }}>
                    Delete
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={isGymMenuVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsGymMenuVisible(false)}
        >
          <View style={styles.actionMenuContent}>
            <Text style={styles.actionMenuTitle}>{selectedGym?.name}</Text>
            <TouchableOpacity
              style={styles.actionMenuBtn}
              onPress={() => {
                setIsGymMenuVisible(false);
                setTimeout(() => {
                  setEditingGymId(selectedGym.id);
                  setGymName(selectedGym.name);
                  setGymDefaultBrand(selectedGym.defaultMachineBrand || null);
                  setIsGymModalVisible(true);
                }, 400);
              }}
            >
              <Text style={styles.actionMenuBtnText}>Edit Gym</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionMenuBtn, styles.actionMenuBtnDestructive]}
              onPress={() => {
                setIsGymMenuVisible(false);
                setTimeout(() => setDeleteGymAlertVisible(true), 400);
              }}
            >
              <Text style={styles.actionMenuBtnText}>Delete Gym</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionMenuBtnCancel}
              onPress={() => setIsGymMenuVisible(false)}
            >
              <Text style={styles.actionMenuBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={isGymModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={[styles.modalOverlay, { justifyContent: "flex-end" }]}
        >
          <View style={[styles.modalContent, { marginBottom: 40 }]}>
            <Text style={styles.modalTitle}>
              {editingGymId ? "Edit Gym" : "New Gym"}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={gymName}
              onChangeText={setGymName}
              placeholder="e.g., Anytime Fitness, Home Gym"
              placeholderTextColor="#48484A"
              selectionColor="#FFF"
              autoFocus
            />

            <Text
              style={{
                color: "#8E8E93",
                fontSize: 12,
                fontWeight: "800",
                textTransform: "uppercase",
                marginTop: 14,
                marginBottom: 10,
              }}
            >
              Default Machine Brand
            </Text>

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 4 }}
            >
              <TouchableOpacity
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  marginRight: 8,
                  backgroundColor: !gymDefaultBrand ? "#32D74B" : "#2C2C2E",
                  borderWidth: 1,
                  borderColor: !gymDefaultBrand ? "#32D74B" : "#3A3A3C",
                }}
                onPress={() => setGymDefaultBrand(null)}
              >
                <Text
                  style={{
                    color: !gymDefaultBrand ? "#000" : "#FFF",
                    fontWeight: "800",
                    fontSize: 12,
                  }}
                >
                  None
                </Text>
              </TouchableOpacity>

              {machineBrandOptions.map((brand) => {
                const active = gymDefaultBrand === brand;

                return (
                  <TouchableOpacity
                    key={brand}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      borderRadius: 999,
                      marginRight: 8,
                      backgroundColor: active ? "#32D74B" : "#2C2C2E",
                      borderWidth: 1,
                      borderColor: active ? "#32D74B" : "#3A3A3C",
                    }}
                    onPress={() => setGymDefaultBrand(brand)}
                  >
                    <Text
                      style={{
                        color: active ? "#000" : "#FFF",
                        fontWeight: "800",
                        fontSize: 12,
                      }}
                    >
                      {brand}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text
              style={{
                color: "#8E8E93",
                fontSize: 12,
                lineHeight: 17,
                marginTop: 8,
                marginBottom: 4,
              }}
            >
              Exercises without an existing machine tag will use this brand when
              this gym is selected. It only applies to machine, cable, Smith,
              assisted, selectorized, and plate-loaded exercises. If you change
              an existing default, only exercise tags matching the old default
              will be changed.
            </Text>
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                onPress={() => {
                  setGymDefaultBrand(null);
                  setEditingGymId(null);
                  setGymName("");
                  setIsGymModalVisible(false);
                }}
              >
                <Text style={styles.modalActionText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  if (!gymName.trim()) return;
                  Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Success,
                  );

                  const nextDefaultBrand = gymDefaultBrand || null;

                  if (editingGymId) {
                    const existingGym = gyms.find((g) => g.id === editingGymId);
                    const previousDefaultBrand =
                      existingGym?.defaultMachineBrand || null;

                    const updatedGyms = gyms.map((g) =>
                      g.id === editingGymId
                        ? {
                            ...g,
                            name: gymName.trim(),
                            defaultMachineBrand: nextDefaultBrand,
                          }
                        : g,
                    );

                    await saveGyms(updatedGyms);
                    await migrateGymNameUsage(editingGymId, gymName.trim());

                    await migrateGymDefaultBrandUsage(
                      editingGymId,
                      previousDefaultBrand,
                      nextDefaultBrand,
                    );
                  } else {
                    await saveGyms([
                      ...gyms,
                      {
                        id: genId("gym-"),
                        name: gymName.trim(),
                        variants: [],
                        defaultMachineBrand: nextDefaultBrand,
                      },
                    ]);
                  }

                  setGymDefaultBrand(null);
                  setEditingGymId(null);
                  setIsGymModalVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.modalActionText,
                    { fontWeight: "bold", color: "#32D74B" },
                  ]}
                >
                  Save
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={isGlobalVariantModalVisible}
        transparent
        animationType="fade"
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={[styles.modalOverlay, { justifyContent: "flex-end" }]}
        >
          <View style={[styles.modalContent, { marginBottom: 40 }]}>
            <Text style={styles.modalTitle}>Add Machine Brand</Text>
            <TextInput
              style={styles.modalInput}
              value={newGlobalVariant}
              onChangeText={setNewGlobalVariant}
              placeholder="e.g., Rogue, Prime..."
              placeholderTextColor="#48484A"
              selectionColor="#FFF"
              autoFocus
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                onPress={() => setIsGlobalVariantModalVisible(false)}
              >
                <Text style={styles.modalActionText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const finalBrand = newGlobalVariant.trim();
                  if (!finalBrand) return;
                  if (
                    globalVariants.includes(finalBrand) ||
                    DEFAULT_VARIANTS.includes(finalBrand)
                  ) {
                    Alert.alert(
                      "Already Exists",
                      "This brand is already in your list.",
                    );
                    return;
                  }
                  Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Success,
                  );
                  saveGlobalVariants([...globalVariants, finalBrand]);
                  setIsGlobalVariantModalVisible(false);
                  setNewGlobalVariant("");
                }}
              >
                <Text
                  style={[
                    styles.modalActionText,
                    { fontWeight: "bold", color: "#32D74B" },
                  ]}
                >
                  Add
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <SafeAreaView edges={["top"]} style={styles.headerContainer}>
        <View style={styles.headerContentFlex}>
          <View style={styles.headerSideBtn} />
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitleStatic}>Settings</Text>
          </View>
          <View style={styles.headerRightActionGroup} />
        </View>
      </SafeAreaView>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 18,
          paddingBottom: 18,
        }}
        showsVerticalScrollIndicator={false}
      >
        <SettingsCard style={{ marginBottom: 18 }}>
          <View
            style={{
              padding: 20,
              flexDirection: "row",
              alignItems: "center",
            }}
          >
            <View
              style={{
                width: 58,
                height: 58,
                borderRadius: 20,
                backgroundColor: "rgba(50, 215, 75, 0.14)",
                alignItems: "center",
                justifyContent: "center",
                marginRight: 14,
              }}
            >
              <Ionicons name="person-outline" size={26} color="#32D74B" />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: "#FFF",
                  fontSize: 22,
                  fontWeight: "900",
                }}
                numberOfLines={1}
              >
                {displayName}
              </Text>
              <Text
                style={{
                  color: "#8E8E93",
                  fontSize: 13,
                  fontWeight: "700",
                  marginTop: 5,
                }}
                numberOfLines={1}
              >
                Logged in as: {auth.currentUser?.email || "No email available"}
              </Text>
            </View>
          </View>
        </SettingsCard>

        <TouchableOpacity
          activeOpacity={0.78}
          style={{
            backgroundColor: "rgba(10, 132, 255, 0.08)",
            borderColor: "rgba(10, 132, 255, 0.55)",
            borderWidth: 1,
            borderRadius: 24,
            padding: 18,
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 26,
          }}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            navigation.navigate("OnboardingGuide", { manual: true });
          }}
        >
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: 16,
              backgroundColor: "rgba(10, 132, 255, 0.18)",
              alignItems: "center",
              justifyContent: "center",
              marginRight: 14,
            }}
          >
            <Ionicons name="book-outline" size={22} color="#0A84FF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: "#0A84FF",
                fontSize: 12,
                fontWeight: "900",
                letterSpacing: 1.2,
              }}
            >
              HELP
            </Text>
            <Text
              style={{
                color: "#FFF",
                fontSize: 20,
                fontWeight: "900",
                marginTop: 4,
              }}
            >
              IronVault Guide
            </Text>
            <Text
              style={{
                color: "#8E8E93",
                fontSize: 14,
                fontWeight: "600",
                marginTop: 4,
              }}
            >
              Learn setup, workouts, splits, stats, and backup.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="#8E8E93" />
        </TouchableOpacity>

        <View style={{ marginBottom: 26 }}>
          <SectionTitle title="Training Preferences" />
          <SettingsCard>
            <SettingRow
              title="Units"
              subtitle="Used across workouts, history, and plate calculator."
              icon="scale-outline"
              right={
                <TogglePill
                  options={["KG", "LBS"]}
                  value={metric}
                  onChange={async (m: string) => {
                    if (!uid) return;
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setMetric(m);
                    await AsyncStorage.setItem(`@user_metric_${uid}`, m);
                    await syncSettingsToCloud({ metric: m });
                  }}
                />
              }
            />

            <SettingRow
              title="Rest Timer"
              subtitle="Automatically starts after completing a set."
              icon="timer-outline"
              right={
                <TogglePill
                  options={["ON", "OFF"]}
                  value={timerEnabled ? "ON" : "OFF"}
                  onChange={async (next: string) => {
                    if (!uid) return;
                    const enabled = next === "ON";
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setTimerEnabled(enabled);
                    await AsyncStorage.setItem(
                      `@rest_timer_enabled_${uid}`,
                      enabled.toString(),
                    );
                    await syncSettingsToCloud({ timerEnabled: enabled });
                  }}
                />
              }
            />

            {timerEnabled && (
              <SettingRow
                title="Default Rest"
                subtitle="Your default rest timer duration in seconds."
                icon="hourglass-outline"
                right={
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: "#2C2C2E",
                      borderRadius: 16,
                      paddingHorizontal: 12,
                    }}
                  >
                    <TextInput
                      style={{
                        color: "#FFF",
                        fontSize: 16,
                        fontWeight: "900",
                        width: 54,
                        height: 44,
                        textAlign: "center",
                      }}
                      keyboardType="number-pad"
                      value={rest}
                      onChangeText={async (t) => {
                        if (!uid) return;
                        setRest(t);
                        await AsyncStorage.setItem(`@rest_time_${uid}`, t);
                        await syncSettingsToCloud({ restTime: t });
                      }}
                    />
                    <Text style={{ color: "#8E8E93", fontWeight: "800" }}>
                      s
                    </Text>
                  </View>
                }
              />
            )}

            <SettingRow
              title="Auto Check Sets"
              subtitle="Automatically marks filled sets as completed."
              icon="checkmark-done-outline"
              right={
                <TogglePill
                  options={["ON", "OFF"]}
                  value={autoCheckEnabled ? "ON" : "OFF"}
                  onChange={async (next: string) => {
                    if (!uid) return;
                    const enabled = next === "ON";
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setAutoCheckEnabled(enabled);
                    await AsyncStorage.setItem(
                      `@auto_check_enabled_${uid}`,
                      enabled.toString(),
                    );
                    await syncSettingsToCloud({ autoCheckEnabled: enabled });
                  }}
                />
              }
            />

            <SettingRow
              title="Plate Calculator"
              subtitle="Show plate loading tools inside workouts."
              icon="barbell-outline"
              isLast
              right={
                <TogglePill
                  options={["ON", "OFF"]}
                  value={plateCalcEnabled ? "ON" : "OFF"}
                  onChange={async (next: string) => {
                    if (!uid) return;
                    const enabled = next === "ON";
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setPlateCalcEnabled(enabled);
                    await AsyncStorage.setItem(
                      `@plate_calc_enabled_${uid}`,
                      enabled.toString(),
                    );
                    await syncSettingsToCloud({ plateCalcEnabled: enabled });
                  }}
                />
              }
            />
          </SettingsCard>

          {plateCalcEnabled && (
            <SettingsCard style={{ marginTop: 12, padding: 18 }}>
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <View>
                  <Text
                    style={{ color: "#FFF", fontSize: 17, fontWeight: "900" }}
                  >
                    Plate Options
                  </Text>
                  <Text
                    style={{
                      color: "#8E8E93",
                      fontSize: 13,
                      marginTop: 4,
                      fontWeight: "600",
                    }}
                  >
                    Choose plates available for {metric} calculations.
                  </Text>
                </View>
                <Text style={{ color: "#32D74B", fontWeight: "900" }}>
                  {activePlateList.length}
                </Text>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  marginHorizontal: -4,
                }}
              >
                {defaultPlateList.map((p) => {
                  const isActive = activePlateList.includes(p);
                  return (
                    <TouchableOpacity
                      key={p}
                      style={{
                        margin: 4,
                        paddingHorizontal: 12,
                        paddingVertical: 9,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: isActive ? "#32D74B" : "#3A3A3C",
                        backgroundColor: isActive
                          ? "rgba(50, 215, 75, 0.14)"
                          : "#2C2C2E",
                      }}
                      onPress={() => togglePlate(p)}
                    >
                      <Text
                        style={{
                          color: isActive ? "#32D74B" : "#8E8E93",
                          fontWeight: "900",
                        }}
                      >
                        {p}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </SettingsCard>
          )}
        </View>

        <View style={{ marginBottom: 26 }}>
          <SectionTitle title="Training Environment" />
          <SettingsCard style={{ marginBottom: 12 }}>
            <SettingRow
              title="Gyms"
              subtitle={`${gyms.length} ${gyms.length === 1 ? "location" : "locations"} configured${gyms.some((g: any) => g.defaultMachineBrand) ? " · default brands enabled" : ""}`}
              icon="location-outline"
              right={
                <TouchableOpacity
                  onPress={() => {
                    setEditingGymId(null);
                    setGymName("");
                    setGymDefaultBrand(null);
                    setIsGymModalVisible(true);
                  }}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: "rgba(50, 215, 75, 0.14)",
                    borderWidth: 1,
                    borderColor: "rgba(50, 215, 75, 0.45)",
                  }}
                >
                  <Text
                    style={{
                      color: "#32D74B",
                      fontWeight: "900",
                      fontSize: 13,
                    }}
                  >
                    + Add
                  </Text>
                </TouchableOpacity>
              }
            />

            <SettingRow
              title="Machine Brands"
              subtitle={`${machineBrandOptions.length} brands available for gym defaults and machine/cable exercise tags.`}
              icon="construct-outline"
              isLast
              right={
                <TouchableOpacity
                  onPress={() => setIsGlobalVariantModalVisible(true)}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: "rgba(50, 215, 75, 0.14)",
                    borderWidth: 1,
                    borderColor: "rgba(50, 215, 75, 0.45)",
                  }}
                >
                  <Text
                    style={{
                      color: "#32D74B",
                      fontWeight: "900",
                      fontSize: 13,
                    }}
                  >
                    + Add
                  </Text>
                </TouchableOpacity>
              }
            />
          </SettingsCard>

          {gyms.length === 0 ? (
            <SettingsCard style={{ padding: 18, alignItems: "center" }}>
              <View
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 16,
                  backgroundColor: "rgba(50, 215, 75, 0.14)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 10,
                }}
              >
                <Ionicons name="location-outline" size={22} color="#32D74B" />
              </View>
              <Text style={{ color: "#FFF", fontSize: 17, fontWeight: "900" }}>
                No gyms yet
              </Text>
              <Text
                style={{
                  color: "#8E8E93",
                  textAlign: "center",
                  marginTop: 6,
                  lineHeight: 20,
                }}
              >
                Add gyms to track locations and default machine brands for
                machine/cable-style exercises.
              </Text>
            </SettingsCard>
          ) : (
            <View style={{ gap: 10 }}>
              {gyms.map((gym: any) => (
                <TouchableOpacity
                  key={gym.id}
                  activeOpacity={0.75}
                  style={{
                    backgroundColor: "#1C1C1E",
                    borderWidth: 1,
                    borderColor: "#2C2C2E",
                    padding: 16,
                    borderRadius: 18,
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                  onPress={() => {
                    setSelectedGym(gym);
                    setIsGymMenuVisible(true);
                  }}
                >
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text
                      style={{ color: "#FFF", fontSize: 16, fontWeight: "900" }}
                    >
                      {gym.name}
                    </Text>
                    <Text
                      style={{
                        color: "#8E8E93",
                        fontSize: 13,
                        marginTop: 4,
                        fontWeight: "700",
                      }}
                    >
                      {gym.defaultMachineBrand
                        ? `Default Machine Brand: ${gym.defaultMachineBrand}`
                        : "No default machine brand"}
                    </Text>
                    <Text
                      style={{
                        color: "#636366",
                        fontSize: 12,
                        marginTop: 4,
                        fontWeight: "600",
                        lineHeight: 17,
                      }}
                    >
                      Used for machine/cable exercises only.
                    </Text>
                  </View>
                  <Ionicons
                    name="ellipsis-horizontal"
                    size={22}
                    color="#8E8E93"
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <SettingsCard style={{ marginTop: 12 }}>
            {[...DEFAULT_VARIANTS, ...globalVariants].map((variant, index) => {
              const isDefault = DEFAULT_VARIANTS.includes(variant);
              const allBrands = [...DEFAULT_VARIANTS, ...globalVariants];
              const isLast = index === allBrands.length - 1;
              return (
                <View
                  key={variant}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingVertical: 15,
                    paddingHorizontal: 18,
                    borderBottomWidth: isLast ? 0 : 1,
                    borderBottomColor: "#2C2C2E",
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: isDefault ? "#8E8E93" : "#FFF",
                        fontSize: 15,
                        fontWeight: "800",
                      }}
                    >
                      {variant}
                    </Text>
                    {isDefault && (
                      <Text
                        style={{
                          color: "#636366",
                          fontSize: 12,
                          fontWeight: "700",
                          marginTop: 2,
                        }}
                      >
                        Built-in brand
                      </Text>
                    )}
                  </View>
                  {!isDefault && (
                    <TouchableOpacity
                      onPress={() => {
                        Alert.alert(
                          "Delete Brand",
                          `Remove "${variant}" from global brands?`,
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () => {
                                saveGlobalVariants(
                                  globalVariants.filter((v) => v !== variant),
                                );
                              },
                            },
                          ],
                        );
                      }}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={20}
                        color="#FF3B30"
                      />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </SettingsCard>
        </View>

        <View style={{ marginBottom: 26 }}>
          <SectionTitle title="Data & Backup" />
          <TouchableOpacity
            activeOpacity={0.78}
            style={{
              backgroundColor: "rgba(50, 215, 75, 0.08)",
              borderColor: "rgba(50, 215, 75, 0.45)",
              borderWidth: 1,
              borderRadius: 24,
              padding: 18,
              flexDirection: "row",
              alignItems: "center",
            }}
            onPress={handleFullSync}
            disabled={isSyncing}
          >
            <View
              style={{
                width: 46,
                height: 46,
                borderRadius: 16,
                backgroundColor: "rgba(50, 215, 75, 0.14)",
                alignItems: "center",
                justifyContent: "center",
                marginRight: 14,
              }}
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color="#32D74B" />
              ) : (
                <Ionicons
                  name="cloud-upload-outline"
                  size={22}
                  color="#32D74B"
                />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: "#32D74B",
                  fontSize: 12,
                  fontWeight: "900",
                  letterSpacing: 1.2,
                }}
              >
                SYNC & BACKUP
              </Text>
              <Text
                style={{
                  color: "#FFF",
                  fontSize: 20,
                  fontWeight: "900",
                  marginTop: 4,
                }}
              >
                {isSyncing
                  ? "Syncing Data"
                  : syncStatus
                    ? "Synced with Cloud"
                    : "Sync with Cloud"}
              </Text>
              <Text
                style={{
                  color: "#8E8E93",
                  fontSize: 14,
                  fontWeight: "600",
                  marginTop: 4,
                  lineHeight: 20,
                }}
              >
                Last synced: {formatSyncTime(syncStatus?.lastSyncedAt)}
              </Text>
              <Text
                style={{
                  color: "#8E8E93",
                  fontSize: 12,
                  fontWeight: "700",
                  marginTop: 4,
                  lineHeight: 18,
                }}
              >
                {formatSyncCounts(syncStatus)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#8E8E93" />
          </TouchableOpacity>

          <SettingsCard style={{ marginTop: 14 }}>
            <SettingRow
              title="Export Data"
              subtitle="Export workouts, templates, exercises, favorites, gyms, brands, and settings."
              icon="download-outline"
              iconColor="#0A84FF"
              onPress={handleExportData}
              right={
                isExporting ? (
                  <ActivityIndicator size="small" color="#0A84FF" />
                ) : (
                  <Ionicons name="chevron-forward" size={22} color="#8E8E93" />
                )
              }
            />
            <SettingRow
              title="Import Data"
              subtitle="Import a backup safely without wiping local data."
              icon="folder-open-outline"
              iconColor="#FF9F0A"
              onPress={handleImportData}
              isLast
              right={
                isImporting ? (
                  <ActivityIndicator size="small" color="#FF9F0A" />
                ) : (
                  <Ionicons name="chevron-forward" size={22} color="#8E8E93" />
                )
              }
            />
          </SettingsCard>
        </View>


        <View style={{ marginBottom: 26 }}>
          <SectionTitle title="Legal & Account" />
          <SettingsCard>
            <SettingRow
              title="Terms of Service"
              subtitle="Review the rules and fitness disclaimer for using IronVault."
              icon="document-text-outline"
              iconColor="#32D74B"
              onPress={() => {
                setLegalTab("TERMS");
                setIsLegalModalVisible(true);
              }}
              right={
                <Ionicons name="chevron-forward" size={22} color="#8E8E93" />
              }
            />
            <SettingRow
              title="Privacy Policy"
              subtitle="See what data IronVault stores and how sync, backup, and deletion work."
              icon="shield-checkmark-outline"
              iconColor="#0A84FF"
              isLast
              onPress={() => {
                setLegalTab("PRIVACY");
                setIsLegalModalVisible(true);
              }}
              right={
                <Ionicons name="chevron-forward" size={22} color="#8E8E93" />
              }
            />
          </SettingsCard>
        </View>

        <View>
          <SectionTitle title="Danger Zone" />
          <SettingsCard>
            <SettingRow
              title="Sign Out"
              subtitle="Log out of this account on this device."
              icon="log-out-outline"
              iconColor="#FF9F0A"
              onPress={handleSignOut}
              right={
                <Ionicons name="chevron-forward" size={22} color="#8E8E93" />
              }
            />
            <SettingRow
              title="Delete Account"
              subtitle="Permanently erase all data."
              icon="warning-outline"
              iconColor="#FF3B30"
              isLast
              onPress={() => setIsDeleteModalVisible(true)}
              right={
                <Ionicons name="chevron-forward" size={22} color="#FF3B30" />
              }
            />
          </SettingsCard>
        </View>
      </ScrollView>
    </View>
  );
}
