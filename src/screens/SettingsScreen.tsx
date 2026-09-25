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
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import * as WebBrowser from "expo-web-browser";
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
  runTransaction,
  setDoc,
} from "firebase/firestore";

import {
  fetchConfigFromCloud,
  syncSettingsToCloud,
  syncGymsToCloud,
  syncConfigToCloud,
  pushWorkoutListToCloud,
  syncEverythingWithCloud,
  getLocalCloudSyncStatus,
  assertReasonableBackupFileSize,
  safeJsonParse,
  markConfigItemsDeletedLocally,
  markConfigValuesDeletedLocally,
  clearConfigValuesDeletedLocally,
  sanitizeGymsForStorage,
  sanitizeMachineBrandsForStorage,
  buildIronVaultBackup,
  previewIronVaultBackupImport,
  importIronVaultBackup,
  previewCloudCategoryRestore,
  restoreCloudCategories,
} from "../utils/firebaseSync";
import type { CloudRestoreCategory } from "../utils/firebaseSync";

import BlockingOverlay from "../components/BlockingOverlay";
import LegalDocument from "../components/LegalDocument";
import {
  LEGAL_DOCUMENTS,
  LEGAL_WEBSITE_URL,
  LegalDocumentType,
} from "../constants/legal";
import { genId } from "../utils/helpers";
import {
  LIMITS,
  clampRestSeconds,
  cleanLimitedText,
  limitText,
  sanitizeWholeNumberInput,
} from "../constants/limits";
import {
  readNextSessionNotesEnabled,
  writeNextSessionNotesEnabled,
} from "../utils/nextSessionNotes";

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

const REST_TIMER_PRESETS = [
  { label: "60s", value: "60" },
  { label: "90s", value: "90" },
  { label: "2m", value: "120" },
  { label: "3m", value: "180" },
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

const getSyncTone = (status: any, isSyncing: boolean) => {
  if (isSyncing) return "#32D74B";
  if (status?.success === false) return "#FF9F0A";
  if (status?.lastSyncedAt) return "#32D74B";
  return "#8E8E93";
};

const getSyncIcon = (status: any, isSyncing: boolean) => {
  if (isSyncing) return "cloud-upload-outline";
  if (status?.success === false) return "alert-circle-outline";
  if (status?.lastSyncedAt) return "cloud-done-outline";
  return "cloud-outline";
};

const getSyncTitle = (status: any, isSyncing: boolean) => {
  if (isSyncing) return "Syncing data";
  if (status?.success === false) return "Cloud backup did not finish";
  if (status?.lastSyncedAt) return "Cloud sync is up to date";
  return "Cloud sync not run yet";
};

const getSyncSubtitle = (status: any, isSyncing = false) => {
  if (isSyncing) {
    return "Merging this device with your cloud backup. Local data stays on this device.";
  }

  if (!status) {
    return "Saved locally. Run a cloud sync to back up this device.";
  }

  if (status.success === false) {
    return "Your data is still saved on this device. Cloud backup did not finish.";
  }

  return `Last successful sync: ${formatSyncTime(status.lastSyncedAt)}`;
};

const getSyncDetailRows = (status: any, isSyncing = false) => {
  if (isSyncing) {
    return [
      "Local data is kept while cloud sync runs.",
      "Do not close the app until the sync finishes.",
    ];
  }

  if (!status) {
    return [
      "Local data is saved on this device first.",
      "No successful cloud backup has been recorded yet.",
    ];
  }

  if (status.success === false) {
    const failedAt = formatSyncTime(status.lastFailedAt || status.lastAttemptedAt);
    const rows = [
      "Local data is safe on this device.",
      `Last cloud attempt: ${failedAt}`,
    ];
    if (status.lastSyncedAt) {
      rows.push(`Last successful sync: ${formatSyncTime(status.lastSyncedAt)}`);
    } else {
      rows.push("No successful cloud sync recorded yet.");
    }
    if (status.errorMessage) rows.push(`Reason: ${status.errorMessage}`);
    return rows;
  }

  return [
    `Last successful sync: ${formatSyncTime(status.lastSyncedAt)}`,
    `Last attempted: ${formatSyncTime(status.lastAttemptedAt || status.lastSyncedAt)}`,
  ];
};

const getSyncSummaryChips = (status: any) => [
  `${status?.workouts ?? 0} workouts`,
  `${status?.templates ?? 0} templates`,
  `${status?.folders ?? 0} folders`,
  `${status?.personalExercises ?? 0} exercises`,
  `${status?.favoriteExercises ?? 0} favorites`,
  `${status?.gyms ?? 0} gyms`,
  `${status?.machineBrands ?? 0} brands`,
  status?.settingsSynced ? "settings synced" : "settings",
];

const getSyncConfigCount = (configs: any[] = [], key: string) =>
  configs.find((item: any) => item.key === key)?.mergedCount ?? 0;

const RESTORE_CATEGORY_OPTIONS: {
  key: CloudRestoreCategory;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    key: "workouts",
    title: "Workout History",
    subtitle: "Completed sessions, PRs, and logged sets.",
    icon: "time-outline",
  },
  {
    key: "templates",
    title: "Templates",
    subtitle: "Saved routines and their exercise structures.",
    icon: "clipboard-outline",
  },
  {
    key: "folders",
    title: "Folders & Splits",
    subtitle: "Template folders, split days, and active split links.",
    icon: "folder-outline",
  },
  {
    key: "personalExercises",
    title: "Custom Exercises",
    subtitle: "Exercises you created yourself.",
    icon: "barbell-outline",
  },
  {
    key: "favoriteExercises",
    title: "Favourite Exercises",
    subtitle: "Your starred exercise shortcuts.",
    icon: "star-outline",
  },
  {
    key: "gyms",
    title: "Gyms",
    subtitle: "Gym list, default machine brands, and local variants.",
    icon: "location-outline",
  },
  {
    key: "machineBrands",
    title: "Machine Brands",
    subtitle: "Global machine brand names.",
    icon: "construct-outline",
  },
  {
    key: "settings",
    title: "Settings",
    subtitle: "Units, rest timer, plate calculator, and setup preferences.",
    icon: "settings-outline",
  },
];

const buildCloudRestoreCompleteSummary = (result: any) => {
  const restored = result?.restored || {};
  return RESTORE_CATEGORY_OPTIONS.filter((option) =>
    result?.selected?.includes(option.key),
  )
    .map((option) => `${option.title}: ${restored[option.key] ?? 0}`)
    .join("\n");
};



const RECENT_LOGIN_WINDOW_MS = 5 * 60 * 1000;

const normalizeUsername = (value: any) => String(value || "").trim().toLowerCase();

const hasRecentSignIn = () => {
  const lastSignInTime = auth.currentUser?.metadata?.lastSignInTime;
  const lastSignInMs = lastSignInTime ? Date.parse(lastSignInTime) : 0;
  return !!lastSignInMs && Date.now() - lastSignInMs <= RECENT_LOGIN_WINDOW_MS;
};

const validateUsername = (value: string) => {
  const normalized = normalizeUsername(value);

  if (!normalized) return "Enter a username.";
  if (normalized.length < 3) return "Username must be at least 3 characters.";
  if (normalized.length > 20) return "Username must be 20 characters or fewer.";
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    return "Use lowercase letters, numbers, and underscores only.";
  }
  if (normalized.startsWith("_") || normalized.endsWith("_")) {
    return "Username cannot start or end with an underscore.";
  }

  return null;
};



const formatBackupPreviewDate = (value: any) => {
  const timestamp = typeof value === "number" ? value : Date.parse(String(value || ""));
  if (!timestamp || Number.isNaN(timestamp)) return "Unknown date";
  return new Date(timestamp).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

const formatBackupPreviewCount = (label: string, total: number, added: number) =>
  `${label}: ${total} in backup · ${added} new`;

const buildBackupPreviewSummary = (preview: any) => {
  const totals = preview?.totals || {};
  const additions = preview?.additions || {};
  const hasNewData = Object.values(additions).some(
    (value: any) => Number(value || 0) > 0,
  );

  return [
    `Exported: ${formatBackupPreviewDate(preview?.metadata?.exportedAt)}`,
    `Backup version: ${preview?.metadata?.version ?? 1}`,
    "",
    formatBackupPreviewCount("Workouts", totals.workouts ?? 0, additions.workouts ?? 0),
    formatBackupPreviewCount("Templates", totals.templates ?? 0, additions.templates ?? 0),
    formatBackupPreviewCount("Folders", totals.folders ?? 0, additions.folders ?? 0),
    formatBackupPreviewCount("Exercises", totals.personalExercises ?? 0, additions.personalExercises ?? 0),
    formatBackupPreviewCount("Favorites", totals.favoriteExercises ?? 0, additions.favoriteExercises ?? 0),
    formatBackupPreviewCount("Gyms", totals.gyms ?? 0, additions.gyms ?? 0),
    formatBackupPreviewCount("Machine brands", totals.machineBrands ?? 0, additions.machineBrands ?? 0),
    formatBackupPreviewCount("Settings", totals.settings ?? 0, additions.settings ?? 0),
    "",
    hasNewData
      ? "Merge-only import adds the new items shown above. Existing local data is kept and duplicates are skipped."
      : "No new items were found. Your current data already appears to contain this backup.",
  ].join("\n");
};

const buildImportCompleteSummary = (importResult: any) => {
  const added = importResult?.added || {};
  const lines = [
    `Workouts added: ${added.workouts ?? 0}`,
    `Templates added: ${added.templates ?? 0}`,
    `Folders added: ${added.folders ?? 0}`,
    `Exercises added: ${added.personalExercises ?? 0}`,
    `Favorites added: ${added.favoriteExercises ?? 0}`,
    `Gyms added: ${added.gyms ?? 0}`,
    `Machine brands added: ${added.machineBrands ?? 0}`,
    `Settings added: ${added.settings ?? 0}`,
  ];

  return [
    "Merged your backup without wiping current data.",
    "",
    ...lines,
    "",
    "Duplicates were skipped and existing local items were kept.",
  ].join("\n");
};

const USERNAME_TAKEN_ERROR = "IRONVAULT_USERNAME_TAKEN";

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
  const scrollRef = useRef<ScrollView>(null);
  const [metric, setMetric] = useState("LBS");
  const [rest, setRest] = useState("90");
  const [timerEnabled, setTimerEnabled] = useState(true);
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(false);
  const [rpeTrackingEnabled, setRpeTrackingEnabled] = useState(false);
  const [plateCalcEnabled, setPlateCalcEnabled] = useState(true);
  const [nextSessionNotesEnabled, setNextSessionNotesEnabled] =
    useState(false);
  const [platesKg, setPlatesKg] = useState<number[]>(DEFAULT_PLATES_KG);
  const [platesLbs, setPlatesLbs] = useState<number[]>(DEFAULT_PLATES_LBS);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isRestorePreviewLoading, setIsRestorePreviewLoading] = useState(false);
  const [isRestoringCloudData, setIsRestoringCloudData] = useState(false);
  const [restorePreview, setRestorePreview] = useState<any>(null);
  const [selectedRestoreCategories, setSelectedRestoreCategories] = useState<
    CloudRestoreCategory[]
  >([]);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [accountDisplayName, setAccountDisplayName] = useState("Athlete");
  const [currentUsernameLower, setCurrentUsernameLower] = useState("");
  const [isUsernameModalVisible, setIsUsernameModalVisible] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [isUsernameSaving, setIsUsernameSaving] = useState(false);
  const [usernameWarning, setUsernameWarning] = useState("");

  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const [isGuideVisible, setIsGuideVisible] = useState(false);
  const [isLegalModalVisible, setIsLegalModalVisible] = useState(false);
  const [legalTab, setLegalTab] = useState<LegalDocumentType>("terms");

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
  const [settingsBlockingMessage, setSettingsBlockingMessage] = useState("");
  const settingsBlockingRef = useRef(false);

  const uid = auth.currentUser?.uid;
  const isSettingsBlocking = settingsBlockingMessage.length > 0;

  const runSettingsBlockingAction = async (
    message: string,
    action: () => Promise<void> | void,
  ) => {
    if (settingsBlockingRef.current) return;

    settingsBlockingRef.current = true;
    setSettingsBlockingMessage(message);
    const startedAt = Date.now();
    try {
      await action();
    } catch (error) {
      console.error("Settings action failed:", error);
    } finally {
      const remainingVisibleMs = Math.max(0, 350 - (Date.now() - startedAt));
      if (remainingVisibleMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingVisibleMs));
      }
      settingsBlockingRef.current = false;
      setSettingsBlockingMessage("");
    }
  };

  const machineBrandOptions = Array.from(
    new Set([...DEFAULT_VARIANTS, ...globalVariants]),
  );

  const normalizeListName = (value: any) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const sanitizeGlobalVariantList = (items: any[]) =>
    sanitizeMachineBrandsForStorage(items);

  const updateRestDraft = (value: string) => {
    const safeInput = sanitizeWholeNumberInput(value, LIMITS.restSecondsMax);
    setRest(safeInput);
  };

  const saveRestDuration = async (value: string) => {
    const safeInput = sanitizeWholeNumberInput(value, LIMITS.restSecondsMax);
    if (!uid) return;

    const parsed = Math.round(Number(safeInput));
    if (
      !Number.isFinite(parsed) ||
      parsed < LIMITS.restSecondsMin ||
      parsed > LIMITS.restSecondsMax
    )
      return;

    const clampedRest = clampRestSeconds(parsed);
    setRest(String(clampedRest));
    await AsyncStorage.setItem(`@rest_time_${uid}`, String(clampedRest));
    syncSettingsToCloud({ restTime: clampedRest }).catch((error) =>
      console.log("Rest setting cloud sync delayed:", error),
    );
  };

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
      const rpe = await AsyncStorage.getItem(`@rpe_tracking_enabled_${uid}`);
      const pc = await AsyncStorage.getItem(`@plate_calc_enabled_${uid}`);
      const nsn = await readNextSessionNotesEnabled(uid);
      const pkg = await AsyncStorage.getItem(`@plates_kg_${uid}`);
      const plbs = await AsyncStorage.getItem(`@plates_lbs_${uid}`);

      if (m) setMetric(m);
      if (r) setRest(String(clampRestSeconds(r)));
      if (te !== null) setTimerEnabled(te === "true");
      if (ac !== null) setAutoCheckEnabled(ac === "true");
      if (rpe !== null) setRpeTrackingEnabled(rpe === "true");
      if (pc !== null) setPlateCalcEnabled(pc === "true");
      setNextSessionNotesEnabled(nsn);
      if (pkg) setPlatesKg(safeJsonParse(pkg, DEFAULT_PLATES_KG));
      if (plbs) setPlatesLbs(safeJsonParse(plbs, DEFAULT_PLATES_LBS));

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

      const ensureUsernameReservation = async (candidateUsername: string) => {
        const user = auth.currentUser;
        const normalized = normalizeUsername(candidateUsername);
        if (!user || validateUsername(normalized)) return false;

        try {
          const now = Date.now();
          const usernameRef = doc(db, "usernames", normalized);
          const userRef = doc(db, "users", user.uid);

          await runTransaction(db, async (transaction) => {
            const usernameSnap = await transaction.get(usernameRef);

            if (usernameSnap.exists()) {
              const ownerUid = usernameSnap.data().uid;
              if (ownerUid && ownerUid !== user.uid) {
                throw new Error(USERNAME_TAKEN_ERROR);
              }
            }

            transaction.set(
              usernameRef,
              {
                uid: user.uid,
                username: normalized,
                usernameLower: normalized,
                display_name: normalized,
                updatedAt: now,
              },
              { merge: true },
            );

            transaction.set(
              userRef,
              {
                username: normalized,
                usernameLower: normalized,
                updatedAt: now,
              },
              { merge: true },
            );
          });

          setUsernameWarning("");
          return true;
        } catch (error: any) {
          if (String(error?.message || "").includes(USERNAME_TAKEN_ERROR)) {
            setUsernameWarning(
              "Your saved username is no longer available. Choose a new one to keep your account synced.",
            );
          } else {
            console.log("Username reservation migration failed:", error);
            setUsernameWarning(
              "Could not verify your username reservation. Check your connection and try again later.",
            );
          }
          return false;
        }
      };

      const loadAccountUsername = async () => {
        const user = auth.currentUser;
        if (!user) return;

        const cacheKey = `@user_username_${user.uid}`;
        const fallbackName = normalizeUsername(user.email?.split("@")[0] || "Athlete");
        const storedName = normalizeUsername(await AsyncStorage.getItem(cacheKey));

        try {
          let cloudName: string | null = null;
          let cloudUsernameLower = "";
          const userDoc = await getDoc(doc(db, "users", user.uid));

          if (userDoc.exists()) {
            const data = userDoc.data();
            cloudName = data.username || data.usernameLower || null;
            cloudUsernameLower = normalizeUsername(data.usernameLower || data.username);
          }

          if (!cloudUsernameLower) {
            const q = query(
              collection(db, "usernames"),
              where("uid", "==", user.uid),
            );
            const qSnap = await getDocs(q);
            if (!qSnap.empty) {
              const reservation = qSnap.docs[0];
              const data = reservation.data();
              cloudName =
                data.usernameLower ||
                data.username ||
                data.display_name ||
                reservation.id;
              cloudUsernameLower = normalizeUsername(
                data.usernameLower || data.username || reservation.id,
              );
            }
          }

          const resolvedUsername = cloudUsernameLower || normalizeUsername(cloudName) || storedName || fallbackName;

          setAccountDisplayName(resolvedUsername);
          setCurrentUsernameLower(resolvedUsername);
          await AsyncStorage.setItem(cacheKey, resolvedUsername);
          await ensureUsernameReservation(resolvedUsername);
        } catch (error) {
          console.log("Error fetching settings account username:", error);
          const fallbackResolved = storedName || fallbackName;
          setAccountDisplayName(fallbackResolved);
          setCurrentUsernameLower(fallbackResolved);
          setUsernameWarning(
            "Could not verify your username. Showing your saved username for now.",
          );
        }
      };

      await loadAccountUsername();

      const savedGyms = await AsyncStorage.getItem(`@user_gyms_${uid}`);
      if (savedGyms) {
        const parsedGyms = safeJsonParse(savedGyms, []);
        const sanitizedGyms = sanitizeGymsForStorage(parsedGyms);
        setGyms(sanitizedGyms);
        if (JSON.stringify(parsedGyms) !== JSON.stringify(sanitizedGyms)) {
          await AsyncStorage.setItem(
            `@user_gyms_${uid}`,
            JSON.stringify(sanitizedGyms),
          );
          syncGymsToCloud(sanitizedGyms).catch((error) =>
            console.log("Cleaned gym sync delayed:", error),
          );
        }
      } else {
        const cloudGyms = await fetchConfigFromCloud("gyms");
        if (cloudGyms && cloudGyms.length > 0) {
          const sanitizedCloudGyms = sanitizeGymsForStorage(cloudGyms);
          setGyms(sanitizedCloudGyms);
          await AsyncStorage.setItem(
            `@user_gyms_${uid}`,
            JSON.stringify(sanitizedCloudGyms),
          );
          if (
            JSON.stringify(cloudGyms) !== JSON.stringify(sanitizedCloudGyms)
          ) {
            syncGymsToCloud(sanitizedCloudGyms).catch((error) =>
              console.log("Cleaned cloud gym sync delayed:", error),
            );
          }
        }
      }

      const savedGlobalVars = await AsyncStorage.getItem(
        `@global_variants_${uid}`,
      );
      if (savedGlobalVars) {
        const parsedGlobalVars = safeJsonParse(savedGlobalVars, []);
        const sanitizedGlobalVars = sanitizeGlobalVariantList(parsedGlobalVars);
        setGlobalVariants(sanitizedGlobalVars);
        if (
          JSON.stringify(parsedGlobalVars) !==
          JSON.stringify(sanitizedGlobalVars)
        ) {
          await AsyncStorage.setItem(
            `@global_variants_${uid}`,
            JSON.stringify(sanitizedGlobalVars),
          );
          syncConfigToCloud("global_variants" as any, sanitizedGlobalVars).catch(
            (error) => console.log("Cleaned machine brand sync delayed:", error),
          );
        }
      } else {
        const cloudVars = await fetchConfigFromCloud("global_variants" as any);
        if (cloudVars) {
          const sanitizedCloudVars = sanitizeGlobalVariantList(cloudVars);
          setGlobalVariants(sanitizedCloudVars);
          await AsyncStorage.setItem(
            `@global_variants_${uid}`,
            JSON.stringify(sanitizedCloudVars),
          );
          if (
            JSON.stringify(cloudVars) !== JSON.stringify(sanitizedCloudVars)
          ) {
            syncConfigToCloud("global_variants" as any, sanitizedCloudVars).catch(
              (error) =>
                console.log("Cleaned cloud machine brand sync delayed:", error),
            );
          }
        }
      }
    })();
  }, [uid]);

  const saveGyms = async (newGyms: any[]) => {
    const sanitizedGyms = sanitizeGymsForStorage(newGyms);
    setGyms(sanitizedGyms);
    if (uid) {
      await AsyncStorage.setItem(
        `@user_gyms_${uid}`,
        JSON.stringify(sanitizedGyms),
      );
      syncGymsToCloud(sanitizedGyms).catch((error) =>
        console.log("Gym sync delayed:", error),
      );
    }
  };

  const deleteSelectedGym = async () => {
    const gymToDelete = selectedGym;
    if (!gymToDelete?.id) {
      setDeleteGymAlertVisible(false);
      setSelectedGym(null);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const updatedGyms = sanitizeGymsForStorage(
      gyms.filter((g) => String(g?.id) !== String(gymToDelete.id)),
    );

    setDeleteGymAlertVisible(false);
    setIsGymMenuVisible(false);
    setSelectedGym(null);
    setEditingGymId(null);
    setGyms(updatedGyms);

    Promise.resolve()
      .then(async () => {
        if (uid) {
          await markConfigItemsDeletedLocally("gyms", [gymToDelete], uid);
        }
        await saveGyms(updatedGyms);
      })
      .catch((error) => {
        console.log("Gym delete persistence delayed:", error);
        Alert.alert(
          "Sync Delayed",
          "The gym was removed on this device. IronVault will try syncing the change again later.",
        );
      });
  };

  const cancelDeleteGym = () => {
    setDeleteGymAlertVisible(false);
    setSelectedGym(null);
  };

  const saveGlobalVariants = async (newVars: string[]) => {
    const sanitizedVars = sanitizeGlobalVariantList(newVars);
    const nextKeys = new Set(sanitizedVars.map(normalizeListName));
    const currentKeys = new Set(globalVariants.map(normalizeListName));
    const removedVariants = globalVariants.filter(
      (variant) => !nextKeys.has(normalizeListName(variant)),
    );
    const restoredVariants = sanitizedVars.filter(
      (variant) => !currentKeys.has(normalizeListName(variant)),
    );

    setGlobalVariants(sanitizedVars);
    if (uid) {
      if (removedVariants.length > 0) {
        await markConfigValuesDeletedLocally(
          "global_variants",
          removedVariants,
          uid,
        );
      }
      if (restoredVariants.length > 0) {
        await clearConfigValuesDeletedLocally(
          "global_variants",
          restoredVariants,
          uid,
        );
      }
      await AsyncStorage.setItem(
        `@global_variants_${uid}`,
        JSON.stringify(sanitizedVars),
      );
      syncConfigToCloud("global_variants" as any, sanitizedVars).catch(
        (error) => console.log("Machine brand cloud sync delayed:", error),
      );
    }
  };

  const deleteGlobalVariant = (variant: string) => {
    const variantKey = normalizeListName(variant);
    if (!variantKey) return;

    const nextVariants = sanitizeGlobalVariantList(
      globalVariants.filter((item) => normalizeListName(item) !== variantKey),
    );

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setGlobalVariants(nextVariants);

    Promise.resolve()
      .then(async () => {
        if (!uid) return;
        await markConfigValuesDeletedLocally(
          "global_variants",
          [variant],
          uid,
        );
        await AsyncStorage.setItem(
          `@global_variants_${uid}`,
          JSON.stringify(nextVariants),
        );
        syncConfigToCloud("global_variants" as any, nextVariants).catch(
          (error) => console.log("Machine brand cloud sync delayed:", error),
        );
      })
      .catch((error) => {
        console.log("Machine brand delete persistence delayed:", error);
      });
  };

  const migrateGymNameUsage = async (gymId: string, newGymName: string) => {
    if (!uid || !gymId || !newGymName.trim()) return;

    const normalizedName = newGymName.trim();
    let changedWorkouts: any[] = [];

    const historyRaw = await AsyncStorage.getItem(`@workout_history_${uid}`);
    if (historyRaw) {
      try {
        const history = safeJsonParse(historyRaw, []);
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
            pushWorkoutListToCloud(changedWorkouts).catch((error) =>
              console.log("Gym-name history cloud sync delayed:", error),
            );
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
        const activeSession = safeJsonParse<any>(activeSessionRaw, {});
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
        const history = safeJsonParse(historyRaw, []);

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

            pushWorkoutListToCloud(
              migratedHistory.filter(
                (workout: any) => workout && workout.gymId === gymId,
              ),
            ).catch((error) =>
              console.log("Gym-brand history cloud sync delayed:", error),
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
        const activeSession = safeJsonParse<any>(activeSessionRaw, {});

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

              const [m, r, te, ac, rpe, pc, pkg, plbs, savedGyms, savedGlobalVars] =
                await Promise.all([
                  AsyncStorage.getItem(`@user_metric_${uid}`),
                  AsyncStorage.getItem(`@rest_time_${uid}`),
                  AsyncStorage.getItem(`@rest_timer_enabled_${uid}`),
                  AsyncStorage.getItem(`@auto_check_enabled_${uid}`),
                  AsyncStorage.getItem(`@rpe_tracking_enabled_${uid}`),
                  AsyncStorage.getItem(`@plate_calc_enabled_${uid}`),
                  AsyncStorage.getItem(`@plates_kg_${uid}`),
                  AsyncStorage.getItem(`@plates_lbs_${uid}`),
                  AsyncStorage.getItem(`@user_gyms_${uid}`),
                  AsyncStorage.getItem(`@global_variants_${uid}`),
                ]);

              if (m) setMetric(m);
              if (r) setRest(String(clampRestSeconds(r)));
              if (te !== null) setTimerEnabled(te === "true");
              if (ac !== null) setAutoCheckEnabled(ac === "true");
              if (rpe !== null) setRpeTrackingEnabled(rpe === "true");
              if (pc !== null) setPlateCalcEnabled(pc === "true");
              if (pkg) setPlatesKg(safeJsonParse(pkg, DEFAULT_PLATES_KG));
              if (plbs) setPlatesLbs(safeJsonParse(plbs, DEFAULT_PLATES_LBS));
              if (savedGyms)
                setGyms(
                  sanitizeGymsForStorage(safeJsonParse(savedGyms, [])),
                );
              if (savedGlobalVars)
                setGlobalVariants(
                  sanitizeGlobalVariantList(safeJsonParse(savedGlobalVars, [])),
                );
              await refreshCloudRestorePreview(false);

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
Settings: ${syncResult.syncStatus?.settingsSynced ? "synced" : "checked"}
Last synced: ${formatSyncTime(syncResult.syncStatus?.lastSyncedAt)}`,
              );
            } catch (error) {
              console.error("Cloud sync error:", error);
              const failedStatus = {
                ...(syncStatus || {}),
                success: false,
                lastAttemptedAt: Date.now(),
                lastFailedAt: Date.now(),
                errorMessage: getFriendlyOperationError(
                  error,
                  "Could not complete the cloud sync.",
                ),
              };
              setSyncStatus(failedStatus);
              await AsyncStorage.setItem(
                `@cloud_sync_status_${uid}`,
                JSON.stringify(failedStatus),
              );
              Alert.alert(
                "Sync Failed",
                `${failedStatus.errorMessage}

Your data is still saved on this device. Cloud backup did not finish.

Last tried: ${formatSyncTime(failedStatus.lastFailedAt)}
${failedStatus.lastSyncedAt ? `Last successful sync: ${formatSyncTime(failedStatus.lastSyncedAt)}\n` : ""}Try Retry Sync again when your connection is stable.`,
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

    const [m, r, te, ac, rpe, pc, pkg, plbs, savedGyms, savedGlobalVars, status] =
      await Promise.all([
        AsyncStorage.getItem(`@user_metric_${uid}`),
        AsyncStorage.getItem(`@rest_time_${uid}`),
        AsyncStorage.getItem(`@rest_timer_enabled_${uid}`),
        AsyncStorage.getItem(`@auto_check_enabled_${uid}`),
        AsyncStorage.getItem(`@rpe_tracking_enabled_${uid}`),
        AsyncStorage.getItem(`@plate_calc_enabled_${uid}`),
        AsyncStorage.getItem(`@plates_kg_${uid}`),
        AsyncStorage.getItem(`@plates_lbs_${uid}`),
        AsyncStorage.getItem(`@user_gyms_${uid}`),
        AsyncStorage.getItem(`@global_variants_${uid}`),
        getLocalCloudSyncStatus(uid),
      ]);

    if (m) setMetric(m);
    if (r) setRest(String(clampRestSeconds(r)));
    if (te !== null) setTimerEnabled(te === "true");
    if (ac !== null) setAutoCheckEnabled(ac === "true");
    if (rpe !== null) setRpeTrackingEnabled(rpe === "true");
    if (pc !== null) setPlateCalcEnabled(pc === "true");
    if (pkg) setPlatesKg(safeJsonParse(pkg, DEFAULT_PLATES_KG));
    if (plbs) setPlatesLbs(safeJsonParse(plbs, DEFAULT_PLATES_LBS));
    if (savedGyms)
      setGyms(sanitizeGymsForStorage(safeJsonParse(savedGyms, [])));
    if (savedGlobalVars)
      setGlobalVariants(
        sanitizeGlobalVariantList(safeJsonParse(savedGlobalVars, [])),
      );
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
      assertReasonableBackupFileSize(raw);
      const backup = JSON.parse(raw);
      const preview = await previewIronVaultBackupImport(backup);
      const previewSummary = buildBackupPreviewSummary(preview);

      setIsImporting(false);
      Alert.alert(
        "Preview IronVault Backup",
        previewSummary,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Merge Backup",
            onPress: async () => {
              try {
                setIsImporting(true);
                const importResult = await importIronVaultBackup(backup);
                await refreshLocalSettingsAfterDataImport();

                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success,
                );
                Alert.alert(
                  "Import Complete",
                  buildImportCompleteSummary(importResult),
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
    } catch (error: any) {
      console.error("Import backup preview error:", error);
      Alert.alert(
        "Import Failed",
        getFriendlyOperationError(
          error,
          "Could not read this backup file. Please try again.",
        ),
      );
    } finally {
      setIsImporting(false);
    }
  };

  const refreshCloudRestorePreview = async (showError = true) => {
    if (!uid || isRestorePreviewLoading) return null;

    try {
      setIsRestorePreviewLoading(true);
      const preview = await previewCloudCategoryRestore();
      setRestorePreview(preview);
      return preview;
    } catch (error: any) {
      console.error("Cloud restore preview error:", error);
      if (showError) {
        Alert.alert(
          "Could Not Check Cloud Backup",
          getFriendlyOperationError(
            error,
            "Could not check your cloud backup. Please try again.",
          ),
        );
      }
      return null;
    } finally {
      setIsRestorePreviewLoading(false);
    }
  };

  const toggleRestoreCategory = (category: CloudRestoreCategory) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedRestoreCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  };

  const handleRestoreSelectedCategories = async () => {
    if (!uid || isRestoringCloudData) return;

    if (selectedRestoreCategories.length === 0) {
      Alert.alert(
        "Choose Data to Restore",
        "Select at least one category before restoring from cloud.",
      );
      return;
    }

    const preview = restorePreview || (await refreshCloudRestorePreview(false));
    const labels = RESTORE_CATEGORY_OPTIONS.filter((option) =>
      selectedRestoreCategories.includes(option.key),
    ).map((option) => option.title);

    Alert.alert(
      "Restore Selected Data?",
      `This replaces the selected categories on this device with your current cloud copy.

Selected:
${labels.map((label) => `• ${label}`).join("\n")}

Cloud checked: ${formatBackupPreviewDate(preview?.readAt)}

IronVault will save a local before-restore backup first.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Restore",
          style: "destructive",
          onPress: async () => {
            if (settingsBlockingRef.current) return;

            settingsBlockingRef.current = true;
            setIsRestoringCloudData(true);
            setSettingsBlockingMessage("Restoring cloud data...");
            try {
              const result = await restoreCloudCategories(
                selectedRestoreCategories,
              );
              await refreshLocalSettingsAfterDataImport();
              if (result.syncStatus) setSyncStatus(result.syncStatus);
              await refreshCloudRestorePreview(false);
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
              Alert.alert(
                "Restore Complete",
                `${buildCloudRestoreCompleteSummary(result)}

Only the selected categories were replaced. A before-restore backup was kept on this device.`,
              );
            } catch (error: any) {
              console.error("Cloud restore error:", error);
              Alert.alert(
                "Restore Failed",
                getFriendlyOperationError(
                  error,
                  "Could not restore your cloud backup. Please try again.",
                ),
              );
            } finally {
              settingsBlockingRef.current = false;
              setIsRestoringCloudData(false);
              setSettingsBlockingMessage("");
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
      syncSettingsToCloud({ platesKg: updated }).catch((error) =>
        console.log("Plate settings cloud sync delayed:", error),
      );
    } else {
      const updated = platesLbs.includes(plate)
        ? platesLbs.filter((p) => p !== plate)
        : [...platesLbs, plate].sort((a, b) => b - a);
      setPlatesLbs(updated);
      await AsyncStorage.setItem(`@plates_lbs_${uid}`, JSON.stringify(updated));
      syncSettingsToCloud({ platesLbs: updated }).catch((error) =>
        console.log("Plate settings cloud sync delayed:", error),
      );
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

    const userToDelete = auth.currentUser;
    if (!uid || !userToDelete) return;

    if (!hasRecentSignIn()) {
      setIsDeleteModalVisible(false);
      setDeleteConfirmationText("");
      Alert.alert(
        "Security Verification Required",
        "For your security, log out and back in, then delete your account right away. No data has been deleted.",
      );
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsDeleting(true);

    const restoreUsernameReservations = async (
      reservations: { ref: any; data: any }[],
    ) => {
      await Promise.all(
        reservations.map(({ ref, data }) =>
          setDoc(ref, data).catch(() => null),
        ),
      );
    };

    let usernameReservations: { ref: any; data: any }[] = [];
    let cloudDataDeleteStarted = false;

    try {
      await userToDelete.getIdToken(true);

      const usernamesRef = collection(db, "usernames");
      const q = query(usernamesRef, where("uid", "==", uid));
      const querySnapshot = await getDocs(q);
      usernameReservations = querySnapshot.docs.map((d) => ({
        ref: d.ref,
        data: d.data(),
      }));

      const usernameDeletePromises = querySnapshot.docs.map((d) =>
        deleteDoc(d.ref),
      );
      await Promise.all(usernameDeletePromises);
      cloudDataDeleteStarted = true;

      const workoutsSnap = await getDocs(
        collection(db, "users", uid, "workouts"),
      );
      const deletePromises = workoutsSnap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(deletePromises);

      const configsSnap = await getDocs(collection(db, "users", uid, "configs"));
      await Promise.all(configsSnap.docs.map((d) => deleteDoc(d.ref)));

      await deleteDoc(doc(db, "users", uid));

      await deleteUser(userToDelete);

      try {
        const allKeys = await AsyncStorage.getAllKeys();
        const userKeys = allKeys.filter((k) => k.includes(`_${uid}`));
        await AsyncStorage.multiRemove([
          ...userKeys,
          "@has_completed_setup",
        ]);
      } catch (storageError) {
        console.log("Account deleted, but local cleanup was incomplete:", storageError);
      }
    } catch (error: any) {
      if (cloudDataDeleteStarted && auth.currentUser?.uid === uid) {
        await restoreUsernameReservations(usernameReservations);
        syncEverythingWithCloud().catch((syncError) => {
          console.log("Could not restore cloud data after failed deletion:", syncError);
        });
      }

      setIsDeleting(false);
      setIsDeleteModalVisible(false);
      setDeleteConfirmationText("");

      if (error.code === "auth/requires-recent-login") {
        Alert.alert(
          "Security Verification Required",
          "For your security, you must log out and log back in before deleting your account. No local data has been deleted.",
        );
      } else {
        Alert.alert(
          "Delete Account Failed",
          getFriendlyOperationError(
            error,
            "Could not delete your account. Your local data has been kept on this device.",
          ),
        );
      }
    }
  };


  const openUsernameEditor = () => {
    const currentName = normalizeUsername(accountDisplayName);
    setUsernameDraft(currentName);
    setUsernameError("");
    setIsUsernameModalVisible(true);
  };

  const handleSaveUsername = async () => {
    if (isUsernameSaving) return;

    const user = auth.currentUser;
    if (!user) {
      setUsernameError("You need to be signed in to change your username.");
      return;
    }

    const nextUsername = normalizeUsername(usernameDraft);
    const validationError = validateUsername(nextUsername);

    if (validationError) {
      setUsernameError(validationError);
      return;
    }

    const previousUsernameLower = currentUsernameLower || normalizeUsername(accountDisplayName);

    if (previousUsernameLower === nextUsername) {
      setAccountDisplayName(nextUsername);
      setCurrentUsernameLower(nextUsername);
      setUsernameWarning("");
      await AsyncStorage.setItem(`@user_username_${user.uid}`, nextUsername);
      setIsUsernameModalVisible(false);
      return;
    }

    setIsUsernameSaving(true);
    setUsernameError("");

    try {
      const now = Date.now();
      const userRef = doc(db, "users", user.uid);
      const nextUsernameRef = doc(db, "usernames", nextUsername);

      await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);
        const nextUsernameSnap = await transaction.get(nextUsernameRef);

        const cloudPreviousUsername = userSnap.exists()
          ? normalizeUsername(userSnap.data().usernameLower || userSnap.data().username || "")
          : "";
        const oldUsernameLower =
          previousUsernameLower || cloudPreviousUsername || normalizeUsername(accountDisplayName);

        let oldUsernameRef = null as any;
        let oldUsernameSnap = null as any;

        if (oldUsernameLower && oldUsernameLower !== nextUsername) {
          oldUsernameRef = doc(db, "usernames", oldUsernameLower);
          oldUsernameSnap = await transaction.get(oldUsernameRef);
        }

        if (nextUsernameSnap.exists()) {
          const ownerUid = nextUsernameSnap.data().uid;
          if (ownerUid && ownerUid !== user.uid) {
            throw new Error(USERNAME_TAKEN_ERROR);
          }
        }

        transaction.set(
          nextUsernameRef,
          {
            uid: user.uid,
            username: nextUsername,
            usernameLower: nextUsername,
            display_name: nextUsername,
            updatedAt: now,
          },
          { merge: true },
        );

        transaction.set(
          userRef,
          {
            username: nextUsername,
            usernameLower: nextUsername,
            updatedAt: now,
          },
          { merge: true },
        );

        if (oldUsernameRef && oldUsernameSnap?.exists()) {
          const oldOwnerUid = oldUsernameSnap.data().uid;
          if (!oldOwnerUid || oldOwnerUid === user.uid) {
            transaction.delete(oldUsernameRef);
          }
        }
      });

      await AsyncStorage.setItem(`@user_username_${user.uid}`, nextUsername);
      setAccountDisplayName(nextUsername);
      setCurrentUsernameLower(nextUsername);
      setUsernameWarning("");
      setIsUsernameModalVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error: any) {
      if (String(error?.message || "").includes(USERNAME_TAKEN_ERROR)) {
        setUsernameError("This username is already taken.");
      } else {
        setUsernameError(
          getFriendlyOperationError(
            error,
            "Could not update your username. Please try again.",
          ),
        );
      }
    } finally {
      setIsUsernameSaving(false);
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

  const syncDetailRows = getSyncDetailRows(syncStatus, isSyncing);
  const syncSummaryChips = getSyncSummaryChips(syncStatus);
  const restoreCategoryCounts = restorePreview?.categories || {};
  const restoreSelectedCount = selectedRestoreCategories.length;

  return (
    <View style={styles.screen}>
      <Modal
        visible={deleteGymAlertVisible}
        transparent
        animationType="fade"
        onRequestClose={cancelDeleteGym}
      >
        <TouchableOpacity
          style={[
            styles.modalOverlay,
            { justifyContent: "center", paddingHorizontal: 24 },
          ]}
          activeOpacity={1}
          onPress={cancelDeleteGym}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={{
              width: "100%",
              maxWidth: 420,
              borderRadius: 24,
              backgroundColor: "#1C1C1E",
              borderWidth: 1,
              borderColor: "#3A3A3C",
              padding: 22,
            }}
          >
            <Text
              style={{
                color: "#FFF",
                fontSize: 20,
                fontWeight: "900",
                textAlign: "center",
                marginBottom: 10,
              }}
            >
              Delete Gym?
            </Text>
            <Text
              style={{
                color: "#8E8E93",
                fontSize: 15,
                lineHeight: 22,
                textAlign: "center",
                marginBottom: 24,
              }}
            >
              Are you sure you want to permanently delete "{selectedGym?.name}"?
              This will not delete your workout history.
            </Text>
            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  minHeight: 50,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#2C2C2E",
                }}
                onPress={cancelDeleteGym}
              >
                <Text
                  style={{
                    color: "#8E8E93",
                    fontSize: 16,
                    fontWeight: "800",
                  }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 1,
                  minHeight: 50,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(255, 59, 48, 0.14)",
                }}
                onPress={deleteSelectedGym}
              >
                <Text
                  style={{
                    color: "#FF3B30",
                    fontSize: 16,
                    fontWeight: "900",
                  }}
                >
                  Delete
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={isUsernameModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={[styles.modalOverlay, { justifyContent: "flex-end" }]}
        >
          <View style={[styles.modalContent, { marginBottom: 40 }]}>
            <Text style={styles.modalTitle}>Change Username</Text>
            <Text
              style={{
                color: "#8E8E93",
                fontSize: 13,
                lineHeight: 19,
                fontWeight: "600",
                marginBottom: 14,
              }}
            >
              Your username is your unique IronVault nickname. Use 3–20
              lowercase letters, numbers, or underscores.
            </Text>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "#2C2C2E",
                borderRadius: 14,
                borderWidth: 1,
                borderColor: usernameError ? "#FF453A" : "#3A3A3C",
                paddingHorizontal: 14,
              }}
            >
              <Text style={{ color: "#8E8E93", fontSize: 16, fontWeight: "900" }}>
                @
              </Text>
              <TextInput
                style={[styles.modalInput, { flex: 1, marginBottom: 0, borderWidth: 0 }]}
                value={usernameDraft}
                onChangeText={(value) => {
                  setUsernameDraft(normalizeUsername(value));
                  if (usernameError) setUsernameError("");
                }}
                placeholder="username"
                placeholderTextColor="#636366"
                selectionColor="#FFF"
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus
                maxLength={20}
              />
            </View>

            {!!usernameError && (
              <Text
                style={{
                  color: "#FF453A",
                  fontSize: 12,
                  fontWeight: "800",
                  marginTop: 9,
                }}
              >
                {usernameError}
              </Text>
            )}

            <View style={styles.modalButtonRow}>
              <TouchableOpacity
                disabled={isUsernameSaving}
                onPress={() => {
                  setUsernameError("");
                  setIsUsernameModalVisible(false);
                }}
              >
                <Text style={styles.modalActionText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={isUsernameSaving}
                onPress={handleSaveUsername}
                style={{ minWidth: 64, alignItems: "flex-end" }}
              >
                {isUsernameSaving ? (
                  <ActivityIndicator size="small" color="#32D74B" />
                ) : (
                  <Text
                    style={[
                      styles.modalActionText,
                      { fontWeight: "bold", color: "#32D74B" },
                    ]}
                  >
                    Save
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>


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
                {LEGAL_DOCUMENTS[legalTab].title}
              </Text>
              <TouchableOpacity onPress={() => setIsLegalModalVisible(false)}>
                <Text style={{ color: "#32D74B", fontSize: 16, fontWeight: "800" }}>
                  Done
                </Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 64 }}>
            <LegalDocument
              type={legalTab}
              textStyle={{ color: "#D1D1D6", fontSize: 15, lineHeight: 24 }}
              headingStyle={{ color: "#FFF", fontWeight: "900" }}
            />
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
                const gym = selectedGym;
                setIsGymMenuVisible(false);
                setTimeout(() => {
                  if (!gym?.id) return;
                  setSelectedGym(gym);
                  setEditingGymId(gym.id);
                  setGymName(limitText(gym.name, LIMITS.nameChars));
                  setGymDefaultBrand(gym.defaultMachineBrand || null);
                  setIsGymModalVisible(true);
                }, 400);
              }}
            >
              <Text style={styles.actionMenuBtnText}>Edit Gym</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionMenuBtn, styles.actionMenuBtnDestructive]}
              onPress={() => {
                const gym = selectedGym;
                setIsGymMenuVisible(false);
                setTimeout(() => {
                  if (!gym?.id) return;
                  setSelectedGym(gym);
                  setDeleteGymAlertVisible(true);
                }, 400);
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
              onChangeText={(value) =>
                setGymName(limitText(value, LIMITS.nameChars))
              }
              maxLength={LIMITS.nameChars}
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
                disabled={isSettingsBlocking}
                onPress={() =>
                  runSettingsBlockingAction(
                    editingGymId ? "Saving gym..." : "Adding gym...",
                    async () => {
                      const finalGymName = cleanLimitedText(
                        gymName,
                        LIMITS.nameChars,
                      );
                      if (!finalGymName) return;
                      const finalGymKey = normalizeListName(finalGymName);
                      const gymNameExists = gyms.some(
                        (gym) =>
                          gym?.id !== editingGymId &&
                          normalizeListName(gym?.name) === finalGymKey,
                      );
                      if (gymNameExists) {
                        Alert.alert(
                          "Already Exists",
                          "A gym with this name is already in your list.",
                        );
                        return;
                      }
                      if (!editingGymId && gyms.length >= LIMITS.gymsPerUser) {
                        Alert.alert(
                          "Gym Limit Reached",
                          "You can save up to 25 gyms.",
                        );
                        return;
                      }
                      Haptics.notificationAsync(
                        Haptics.NotificationFeedbackType.Success,
                      );

                      const nextDefaultBrand = gymDefaultBrand
                        ? cleanLimitedText(gymDefaultBrand, LIMITS.nameChars)
                        : null;

                      if (editingGymId) {
                        const existingGym = gyms.find(
                          (g) => g.id === editingGymId,
                        );
                        const previousDefaultBrand =
                          existingGym?.defaultMachineBrand || null;

                        const updatedGyms = gyms.map((g) =>
                          g.id === editingGymId
                            ? {
                                ...g,
                                name: finalGymName,
                                defaultMachineBrand: nextDefaultBrand,
                              }
                            : g,
                        );

                        await saveGyms(updatedGyms);
                        await migrateGymNameUsage(editingGymId, finalGymName);

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
                            name: finalGymName,
                            variants: [],
                            defaultMachineBrand: nextDefaultBrand,
                          },
                        ]);
                      }

                      setGymDefaultBrand(null);
                      setEditingGymId(null);
                      setIsGymModalVisible(false);
                    },
                  )
                }
              >
                {isSettingsBlocking &&
                settingsBlockingMessage.toLowerCase().includes("gym") ? (
                  <ActivityIndicator color="#32D74B" size="small" />
                ) : (
                  <Text
                    style={[
                      styles.modalActionText,
                      { fontWeight: "bold", color: "#32D74B" },
                    ]}
                  >
                    Save
                  </Text>
                )}
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
              onChangeText={(value) =>
                setNewGlobalVariant(limitText(value, LIMITS.nameChars))
              }
              maxLength={LIMITS.nameChars}
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
                disabled={isSettingsBlocking}
                onPress={() =>
                  runSettingsBlockingAction("Saving brand...", async () => {
                    const finalBrand = cleanLimitedText(
                      newGlobalVariant,
                      LIMITS.nameChars,
                    );
                    if (!finalBrand) return;
                    const finalBrandKey = normalizeListName(finalBrand);
                    if (
                      [...globalVariants, ...DEFAULT_VARIANTS].some(
                        (brand) => normalizeListName(brand) === finalBrandKey,
                      )
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
                    await saveGlobalVariants([...globalVariants, finalBrand]);
                    setIsGlobalVariantModalVisible(false);
                    setNewGlobalVariant("");
                  })
                }
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
        <View style={{ marginBottom: 26 }}>
          <SectionTitle title="Account" />
          <SettingsCard>
            <View
              style={{
                padding: 20,
                flexDirection: "row",
                alignItems: "center",
                borderBottomWidth: 1,
                borderBottomColor: "#2C2C2E",
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
                  @{displayName}
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
                  {auth.currentUser?.email || "No email available"}
                </Text>
              </View>
            </View>
            <SettingRow
              title="Username"
              subtitle={
                usernameWarning || "Unique nickname used for your IronVault account."
              }
              icon={usernameWarning ? "warning-outline" : "at-outline"}
              iconColor={usernameWarning ? "#FF9F0A" : "#32D74B"}
              onPress={openUsernameEditor}
              isLast
              right={<Ionicons name="chevron-forward" size={20} color="#636366" />}
            />
          </SettingsCard>
        </View>

        <View style={{ marginBottom: 26 }}>
          <SectionTitle title="Training Preferences" />
          <View
            style={{
              backgroundColor: "#1C1C1E",
              borderRadius: 24,
              borderWidth: 1,
              borderColor: "#2C2C2E",
              overflow: "hidden",
            }}
          >
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
                    syncSettingsToCloud({ metric: m }).catch((error) =>
                      console.log("Metric cloud sync delayed:", error),
                    );
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
                    syncSettingsToCloud({ timerEnabled: enabled }).catch(
                      (error) =>
                        console.log("Rest timer cloud sync delayed:", error),
                    );
                  }}
                />
              }
            />

            {timerEnabled && (
              <View
                style={{
                  minHeight: 72,
                  paddingVertical: 14,
                  paddingHorizontal: 18,
                  flexDirection: "row",
                  alignItems: "center",
                  borderBottomWidth: 1,
                  borderBottomColor: "#2C2C2E",
                }}
              >
                <View
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 13,
                    backgroundColor: "#32D74B20",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 12,
                  }}
                >
                  <Ionicons
                    name="hourglass-outline"
                    size={20}
                    color="#32D74B"
                  />
                </View>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ color: "#FFF", fontSize: 17, fontWeight: "800" }}>
                    Default Rest
                  </Text>
                  <Text
                    style={{
                      color: "#8E8E93",
                      fontSize: 13,
                      fontWeight: "600",
                      marginTop: 4,
                      lineHeight: 18,
                    }}
                  >
                    Your default rest timer duration in seconds.
                  </Text>
                </View>
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
                    onChangeText={updateRestDraft}
                    maxLength={3}
                    onEndEditing={() => {
                      const parsed = Math.round(Number(rest));
                      const nextRest = Number.isFinite(parsed)
                        ? clampRestSeconds(parsed)
                        : 90;
                      saveRestDuration(String(nextRest));
                    }}
                  />
                  <Text style={{ color: "#8E8E93", fontWeight: "800" }}>s</Text>
                </View>
              </View>
            )}

            {timerEnabled && (
              <View
                style={{
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: "#2C2C2E",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  {REST_TIMER_PRESETS.map((preset) => {
                    const active = String(rest) === String(preset.value);
                    return (
                      <TouchableOpacity
                        key={preset.value}
                        activeOpacity={0.8}
                        style={{
                          width: "23%",
                          height: 42,
                          borderRadius: 21,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: active ? "#32D74B" : "#2C2C2E",
                          borderWidth: 1,
                          borderColor: active ? "#32D74B" : "#3A3A3C",
                        }}
                        onPress={async () => {
                          Haptics.impactAsync(
                            Haptics.ImpactFeedbackStyle.Light,
                          );
                          await saveRestDuration(preset.value);
                        }}
                      >
                        <Text
                          style={{
                            color: active ? "#000" : "#FFF",
                            fontSize: 13,
                            lineHeight: 16,
                            fontWeight: "900",
                            textAlign: "center",
                            includeFontPadding: false,
                          }}
                        >
                          {preset.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
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
                    syncSettingsToCloud({ autoCheckEnabled: enabled }).catch(
                      (error) =>
                        console.log("Auto-check cloud sync delayed:", error),
                    );
                  }}
                />
              }
            />

            <SettingRow
              title="RPE Tracking"
              subtitle="Add optional effort ratings to warm-up and working sets."
              icon="speedometer-outline"
              right={
                <TogglePill
                  options={["ON", "OFF"]}
                  value={rpeTrackingEnabled ? "ON" : "OFF"}
                  onChange={async (next: string) => {
                    if (!uid) return;
                    const enabled = next === "ON";
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setRpeTrackingEnabled(enabled);
                    await AsyncStorage.setItem(
                      `@rpe_tracking_enabled_${uid}`,
                      enabled.toString(),
                    );
                    syncSettingsToCloud({
                      rpeTrackingEnabled: enabled,
                    }).catch((error) =>
                      console.log("RPE tracking cloud sync delayed:", error),
                    );
                  }}
                />
              }
            />

            <SettingRow
              title="Next Session Notes"
              subtitle="Show one-time template exercise notes for your next workout only."
              icon="document-text-outline"
              right={
                <TogglePill
                  options={["ON", "OFF"]}
                  value={nextSessionNotesEnabled ? "ON" : "OFF"}
                  onChange={async (next: string) => {
                    if (!uid) return;
                    const enabled = next === "ON";
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setNextSessionNotesEnabled(enabled);
                    await writeNextSessionNotesEnabled(uid, enabled);
                    syncSettingsToCloud({
                      nextSessionNotesEnabled: enabled,
                    }).catch((error) =>
                      console.log(
                        "Next session notes setting cloud sync delayed:",
                        error,
                      ),
                    );
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
                    syncSettingsToCloud({ plateCalcEnabled: enabled }).catch(
                      (error) =>
                        console.log(
                          "Plate calculator cloud sync delayed:",
                          error,
                        ),
                    );
                  }}
                />
              }
            />
          </View>

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
          <SectionTitle title="Training Setup" />
          <SettingsCard style={{ marginBottom: 12 }}>
            <SettingRow
              title="Gyms"
              subtitle={`${gyms.length} ${gyms.length === 1 ? "location" : "locations"} configured${gyms.some((g: any) => g.defaultMachineBrand) ? " · default brands enabled" : ""}`}
              icon="location-outline"
              right={
                <TouchableOpacity
                  onPress={() => {
                    if (gyms.length >= LIMITS.gymsPerUser) {
                      Alert.alert(
                        "Gym Limit Reached",
                        "You can save up to 25 gyms.",
                      );
                      return;
                    }
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
                        ? `Default machine brand: ${gym.defaultMachineBrand}`
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
                              onPress: () => deleteGlobalVariant(variant),
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
          <SectionTitle title="Data & Sync" />
          <View
            style={{
              backgroundColor:
                syncStatus?.success === false
                  ? "rgba(255, 159, 10, 0.08)"
                  : "rgba(50, 215, 75, 0.08)",
              borderColor:
                syncStatus?.success === false
                  ? "rgba(255, 159, 10, 0.45)"
                  : "rgba(50, 215, 75, 0.45)",
              borderWidth: 1,
              borderRadius: 24,
              padding: 18,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 16,
                  backgroundColor:
                    syncStatus?.success === false
                      ? "rgba(255, 159, 10, 0.14)"
                      : "rgba(50, 215, 75, 0.14)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 14,
                }}
              >
                {isSyncing ? (
                  <ActivityIndicator size="small" color="#32D74B" />
                ) : (
                  <Ionicons
                    name={getSyncIcon(syncStatus, isSyncing) as any}
                    size={22}
                    color={getSyncTone(syncStatus, isSyncing)}
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: getSyncTone(syncStatus, isSyncing),
                    fontSize: 12,
                    fontWeight: "900",
                    letterSpacing: 1.2,
                  }}
                >
                  CLOUD SYNC
                </Text>
                <Text
                  style={{
                    color: "#FFF",
                    fontSize: 20,
                    fontWeight: "900",
                    marginTop: 4,
                  }}
                >
                  {getSyncTitle(syncStatus, isSyncing)}
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
                  {getSyncSubtitle(syncStatus, isSyncing)}
                </Text>
              </View>
            </View>

            <View
              style={{
                marginTop: 14,
                backgroundColor:
                  syncStatus?.success === false
                    ? "rgba(255, 159, 10, 0.1)"
                    : "rgba(255,255,255,0.05)",
                borderRadius: 14,
                padding: 12,
                borderWidth: syncStatus?.success === false ? 1 : 0,
                borderColor: "rgba(255, 159, 10, 0.28)",
              }}
            >
              {syncDetailRows.map((line, index) => (
                <View
                  key={line}
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    marginBottom: index === syncDetailRows.length - 1 ? 0 : 8,
                  }}
                >
                  <Ionicons
                    name={
                      syncStatus?.success === false
                        ? "alert-circle-outline"
                        : "checkmark-circle-outline"
                    }
                    size={15}
                    color={getSyncTone(syncStatus, isSyncing)}
                    style={{ marginTop: 1, marginRight: 8 }}
                  />
                  <Text
                    style={{
                      color: "#D1D1D6",
                      fontSize: 12,
                      fontWeight: "700",
                      lineHeight: 18,
                      flex: 1,
                    }}
                  >
                    {line}
                  </Text>
                </View>
              ))}
            </View>

            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                marginTop: 14,
                paddingTop: 14,
                borderTopWidth: 1,
                borderTopColor: "rgba(255,255,255,0.08)",
                gap: 8,
              }}
            >
              {syncSummaryChips.map((label) => (
                <View
                  key={label}
                  style={{
                    backgroundColor: "rgba(255,255,255,0.06)",
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                  }}
                >
                  <Text
                    style={{
                      color: "#C7C7CC",
                      fontSize: 12,
                      fontWeight: "800",
                    }}
                  >
                    {label}
                  </Text>
                </View>
              ))}
            </View>

            <View
              style={{
                marginTop: 14,
                backgroundColor: "rgba(255,255,255,0.05)",
                borderRadius: 14,
                padding: 12,
              }}
            >
              <Text
                style={{
                  color: "#C7C7CC",
                  fontSize: 12,
                  fontWeight: "700",
                  lineHeight: 18,
                }}
              >
                Data is always saved locally first. Cloud sync backs up workouts,
                templates, folders, exercises, gyms, machine brands, and settings
                when your connection is available.
              </Text>
            </View>
          </View>

          <SettingsCard style={{ marginTop: 14 }}>
            <SettingRow
              title={syncStatus?.success === false ? "Retry Sync" : "Sync Now"}
              subtitle={
                syncStatus?.success === false
                  ? "Try cloud backup again. Local data will stay on this device."
                  : "Manually merge this device with your cloud backup."
              }
              icon="sync-outline"
              iconColor={
                syncStatus?.success === false ? "#FF9F0A" : "#32D74B"
              }
              onPress={isSyncing ? undefined : handleFullSync}
              isLast
              right={
                isSyncing ? (
                  <ActivityIndicator size="small" color="#32D74B" />
                ) : (
                  <Ionicons name="chevron-forward" size={22} color="#8E8E93" />
                )
              }
            />
          </SettingsCard>

          <Text
            style={{
              color: "#8E8E93",
              fontSize: 12,
              fontWeight: "900",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginTop: 20,
              marginBottom: 10,
              paddingHorizontal: 2,
            }}
          >
            Cloud Restore
          </Text>

          <SettingsCard>
            <View
              style={{
                padding: 18,
                flexDirection: "row",
                alignItems: "center",
                borderBottomWidth: 1,
                borderBottomColor: "#2C2C2E",
              }}
            >
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 14,
                  backgroundColor: "rgba(10, 132, 255, 0.14)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 12,
                }}
              >
                {isRestorePreviewLoading ? (
                  <ActivityIndicator size="small" color="#0A84FF" />
                ) : (
                  <Ionicons
                    name="cloud-download-outline"
                    size={21}
                    color="#0A84FF"
                  />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#FFF", fontSize: 18, fontWeight: "900" }}>
                  Restore from Cloud
                </Text>
                <Text
                  style={{
                    color: "#8E8E93",
                    fontSize: 13,
                    fontWeight: "600",
                    marginTop: 4,
                    lineHeight: 18,
                  }}
                >
                  Replace selected categories on this device with your cloud
                  copy.
                </Text>
                <Text
                  style={{
                    color: "#C7C7CC",
                    fontSize: 12,
                    fontWeight: "800",
                    marginTop: 8,
                  }}
                >
                  {restorePreview?.readAt
                    ? `Cloud checked: ${formatBackupPreviewDate(restorePreview.readAt)}`
                    : "Check your cloud copy before restoring."}
                </Text>
              </View>
            </View>

            {RESTORE_CATEGORY_OPTIONS.map((option, index) => {
              const selected = selectedRestoreCategories.includes(option.key);
              const count = restoreCategoryCounts[option.key];
              const hasCount = Number.isFinite(Number(count));

              return (
                <TouchableOpacity
                  key={option.key}
                  activeOpacity={0.78}
                  onPress={() => toggleRestoreCategory(option.key)}
                  style={{
                    minHeight: 68,
                    paddingVertical: 12,
                    paddingHorizontal: 18,
                    flexDirection: "row",
                    alignItems: "center",
                    borderBottomWidth:
                      index === RESTORE_CATEGORY_OPTIONS.length - 1 ? 0 : 1,
                    borderBottomColor: "#2C2C2E",
                    backgroundColor: selected
                      ? "rgba(50, 215, 75, 0.06)"
                      : "transparent",
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 12,
                      backgroundColor: selected
                        ? "rgba(50, 215, 75, 0.16)"
                        : "rgba(255,255,255,0.06)",
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                    }}
                  >
                    <Ionicons
                      name={option.icon as any}
                      size={18}
                      color={selected ? "#32D74B" : "#8E8E93"}
                    />
                  </View>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text
                      style={{
                        color: "#FFF",
                        fontSize: 15,
                        fontWeight: "900",
                      }}
                    >
                      {option.title}
                    </Text>
                    <Text
                      style={{
                        color: "#8E8E93",
                        fontSize: 12,
                        fontWeight: "600",
                        marginTop: 3,
                        lineHeight: 17,
                      }}
                    >
                      {hasCount
                        ? `${count} in cloud · ${option.subtitle}`
                        : option.subtitle}
                    </Text>
                  </View>
                  <Ionicons
                    name={selected ? "checkbox" : "square-outline"}
                    size={24}
                    color={selected ? "#32D74B" : "#8E8E93"}
                  />
                </TouchableOpacity>
              );
            })}

            <View
              style={{
                flexDirection: "row",
                gap: 10,
                padding: 14,
                borderTopWidth: 1,
                borderTopColor: "#2C2C2E",
              }}
            >
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => refreshCloudRestorePreview(true)}
                disabled={isRestorePreviewLoading || isRestoringCloudData}
                style={{
                  flex: 1,
                  minHeight: 48,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "rgba(10, 132, 255, 0.35)",
                  backgroundColor: "rgba(10, 132, 255, 0.1)",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  opacity:
                    isRestorePreviewLoading || isRestoringCloudData ? 0.6 : 1,
                }}
              >
                {isRestorePreviewLoading ? (
                  <ActivityIndicator size="small" color="#0A84FF" />
                ) : (
                  <Ionicons
                    name="refresh-outline"
                    size={18}
                    color="#0A84FF"
                  />
                )}
                <Text
                  style={{ color: "#0A84FF", fontSize: 13, fontWeight: "900" }}
                >
                  Check Cloud
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.82}
                onPress={handleRestoreSelectedCategories}
                disabled={
                  restoreSelectedCount === 0 ||
                  isRestorePreviewLoading ||
                  isRestoringCloudData
                }
                style={{
                  flex: 1.15,
                  minHeight: 48,
                  borderRadius: 16,
                  backgroundColor:
                    restoreSelectedCount === 0 ? "#2C2C2E" : "#32D74B",
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  gap: 8,
                  opacity:
                    isRestorePreviewLoading || isRestoringCloudData ? 0.65 : 1,
                }}
              >
                {isRestoringCloudData ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Ionicons
                    name="return-down-back-outline"
                    size={18}
                    color={restoreSelectedCount === 0 ? "#8E8E93" : "#000"}
                  />
                )}
                <Text
                  style={{
                    color: restoreSelectedCount === 0 ? "#8E8E93" : "#000",
                    fontSize: 13,
                    fontWeight: "900",
                  }}
                >
                  Restore {restoreSelectedCount || ""}
                </Text>
              </TouchableOpacity>
            </View>
          </SettingsCard>

          <View
            style={{
              marginTop: 12,
              backgroundColor: "rgba(10, 132, 255, 0.08)",
              borderColor: "rgba(10, 132, 255, 0.25)",
              borderWidth: 1,
              borderRadius: 16,
              padding: 12,
            }}
          >
            <Text
              style={{
                color: "#C7C7CC",
                fontSize: 12,
                fontWeight: "700",
                lineHeight: 18,
              }}
            >
              Cloud Restore is replace-only for the checked categories. It keeps
              a before-restore backup on this device before making changes.
            </Text>
          </View>

          <Text
            style={{
              color: "#8E8E93",
              fontSize: 12,
              fontWeight: "900",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginTop: 20,
              marginBottom: 10,
              paddingHorizontal: 2,
            }}
          >
            Backup
          </Text>

          <SettingsCard>
            <SettingRow
              title="Export Data"
              subtitle="Create a JSON backup you can save or share."
              icon="download-outline"
              iconColor="#0A84FF"
              onPress={isExporting ? undefined : handleExportData}
              right={
                isExporting ? (
                  <ActivityIndicator size="small" color="#0A84FF" />
                ) : (
                  <Ionicons name="chevron-forward" size={22} color="#8E8E93" />
                )
              }
            />
            <SettingRow
              title="Import Backup"
              subtitle="Merge missing data from an IronVault backup. Existing data is kept."
              icon="folder-open-outline"
              iconColor="#FF9F0A"
              onPress={isImporting ? undefined : handleImportData}
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

          <View
            style={{
              marginTop: 12,
              backgroundColor: "rgba(255, 159, 10, 0.08)",
              borderColor: "rgba(255, 159, 10, 0.25)",
              borderWidth: 1,
              borderRadius: 16,
              padding: 12,
            }}
          >
            <Text
              style={{
                color: "#C7C7CC",
                fontSize: 12,
                fontWeight: "700",
                lineHeight: 18,
              }}
            >
              Import is merge-only. It adds missing backup data and will not
              delete or overwrite your current data.
            </Text>
          </View>
        </View>


        <View style={{ marginBottom: 26 }}>
          <SectionTitle title="Help" />
          <SettingsCard>
            <SettingRow
              title="Quick Start Guide"
              subtitle="Learn the simple flow: add a gym, start a workout, log sets, finish, and save templates only when useful."
              icon="book-outline"
              iconColor="#0A84FF"
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                navigation.navigate("OnboardingGuide", { manual: true });
              }}
              isLast
              right={
                <Ionicons name="chevron-forward" size={22} color="#8E8E93" />
              }
            />
          </SettingsCard>
        </View>


        <View style={{ marginBottom: 26 }}>
          <SectionTitle title="Legal" />
          <SettingsCard>
            <SettingRow
              title="Support & Legal Website"
              subtitle="Open the public support, privacy, terms, and deletion page."
              icon="globe-outline"
              iconColor="#0A84FF"
              onPress={() => WebBrowser.openBrowserAsync(LEGAL_WEBSITE_URL)}
              right={
                <Ionicons name="open-outline" size={22} color="#8E8E93" />
              }
            />
            <SettingRow
              title="Terms of Service"
              subtitle="Review the rules and fitness disclaimer for using IronVault."
              icon="document-text-outline"
              iconColor="#32D74B"
              onPress={() => {
                setLegalTab("terms");
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
                setLegalTab("privacy");
                setIsLegalModalVisible(true);
              }}
              right={
                <Ionicons name="chevron-forward" size={22} color="#8E8E93" />
              }
            />
          </SettingsCard>
        </View>

        <View>
          <SectionTitle title="Account Actions" />
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
              subtitle="Permanently delete your account and cloud data."
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

      <BlockingOverlay
        visible={isSettingsBlocking}
        message={settingsBlockingMessage}
      />
    </View>
  );
}
