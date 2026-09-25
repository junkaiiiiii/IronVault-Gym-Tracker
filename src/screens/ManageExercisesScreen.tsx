import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  FlatList,
  SectionList,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { auth } from "../config/firebaseConfig";
import { styles } from "../constants/globalStyles";
import { Colors, Radius } from "../theme";
import { INITIAL_EXERCISES, MUSCLE_GROUPS } from "../constants/data";
import {
  prepareSections,
  calculate1RM,
  cleanExerciseNameForAttachments,
  fetchGitHubExercises,
  normalizeExerciseImageUrl,
  getExerciseVariationOptions,
  isMachineBrandApplicable,
  normalizeExerciseMuscleGroup,
  getActiveBuiltInExercises,
  filterAndRankExercisesBySearch,
  getExerciseAttachmentForSave,
  getExerciseAttachmentForStorage,
  getExerciseAttachmentOptions,
  NO_ATTACHMENT_OPTION_LABEL,
  normalizeExerciseAttachment,
  normalizeExerciseForAttachmentStorage,
  shouldAllowNoAttachmentOption,
} from "../utils/helpers";
import {
  clearConfigValuesDeletedLocally,
  markConfigValuesDeletedLocally,
  safeJsonParse,
  pushWorkoutListToCloud,
  syncFavoriteExercisesToCloud,
  syncPersonalExercisesToCloud,
  saveTemplatesLocallyAndToCloud,
  markConfigItemsDeletedLocally,
} from "../utils/firebaseSync";
import CustomAlert from "../components/CustomAlert";
import { LIMITS, cleanLimitedText, limitText } from "../constants/limits";
import BlockingOverlay from "../components/BlockingOverlay";
import { formatRpeValue, parseRpeValue } from "../utils/rpe";

const NO_ATTACHMENT_FILTER = "__no_attachment__";

export default function ManageExercisesScreen({ navigation }: any) {
  const [globalExercises, setGlobalExercises] = useState<any[]>([]);
  const [personalExercises, setPersonalExercises] = useState<any[]>([]);
  const [favoriteExerciseNames, setFavoriteExerciseNames] = useState<string[]>(
    [],
  );
  const [libraryView, setLibraryView] = useState<
    "All" | "Favorites" | "Recent" | "Custom"
  >("All");
  const [isFetchingAPI, setIsFetchingAPI] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [gyms, setGyms] = useState<any[]>([]);
  const [activeFilter, setActiveFilter] = useState("All");
  const [metric, setMetric] = useState("LBS");
  const [selectedEx, setSelectedEx] = useState<any>(null);
  const [isDetailVisible, setIsDetailVisible] = useState(false);
  const [detailRange, setDetailRange] = useState<
    "7D" | "30D" | "90D" | "1Y" | "All"
  >("90D");
  const [detailGymFilter, setDetailGymFilter] = useState<string>("All");
  const [detailBrandFilter, setDetailBrandFilter] = useState<string>("All");
  const [isExModalVisible, setIsExModalVisible] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [menuExercise, setMenuExercise] = useState<any>(null);
  const [editingExName, setEditingExName] = useState<string | null>(null);
  const [editingMode, setEditingMode] = useState<
    "new" | "details" | "reminder"
  >("new");

  const [newName, setNewName] = useState("");
  const [newMuscle, setNewMuscle] = useState("Chest");
  const [newReminder, setNewReminder] = useState("");
  const [newIsUnilateral, setNewIsUnilateral] = useState(false);
  const [newSupportsVariants, setNewSupportsVariants] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const reminderRef = useRef<TextInput>(null);
  const sectionListRef = useRef<SectionList<any>>(null);
  const [isHighlighting, setIsHighlighting] = useState(false);

  const [infoAlert, setInfoAlert] = useState({
    visible: false,
    title: "",
    message: "",
  });
  const [deleteAlertVisible, setDeleteAlertVisible] = useState(false);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});
  const [detailVariantFilter, setDetailVariantFilter] = useState<string>("All");
  const [detailAttachmentFilter, setDetailAttachmentFilter] =
    useState<string>("All");
  const [detailChartMode, setDetailChartMode] = useState<
    "Strength" | "Volume" | "Best Set"
  >("Strength");

  // 🌟 UPDATED: Added isOverride tracking
  const [addAlert, setAddAlert] = useState({
    visible: false,
    exercise: null as any,
    isOverride: false,
  });
  const [exerciseBlockingMessage, setExerciseBlockingMessage] = useState("");
  const exerciseBlockingRef = useRef(false);

  const uid = auth.currentUser?.uid;
  const isExerciseBlocking = exerciseBlockingMessage.length > 0;

  const runExerciseBlockingAction = async (
    message: string,
    action: () => Promise<void> | void,
  ) => {
    if (exerciseBlockingRef.current) return;

    exerciseBlockingRef.current = true;
    setExerciseBlockingMessage(message);
    try {
      await action();
    } catch (error) {
      console.error("Exercise action failed:", error);
    } finally {
      exerciseBlockingRef.current = false;
      setExerciseBlockingMessage("");
    }
  };

  const getSavedGymId = (gym: any) => {
    return String(gym?.id ?? gym?.gymId ?? gym?.value ?? "");
  };

  const getSavedGymName = (gym: any) => {
    return String(gym?.name ?? gym?.gymName ?? gym?.label ?? "").trim();
  };

  const refreshGymsFromStorage = async () => {
    if (!uid) return;
    try {
      const savedGyms = await AsyncStorage.getItem(`@user_gyms_${uid}`);
      if (savedGyms) {
        const parsed = safeJsonParse(savedGyms, []);
        if (Array.isArray(parsed)) setGyms(parsed);
      } else {
        setGyms([]);
      }
    } catch (error) {
      console.log("Unable to refresh gyms for exercise filters:", error);
    }
  };

  const normalizeExerciseName = (value: any) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const formatLibraryLabel = (value: any) =>
    String(value || "Exercise")
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());

  const getExerciseKey = (exercise: any) => String(exercise?.name || "").trim();

  const getExerciseMatchKey = (exercise: any) =>
    normalizeExerciseName(exercise?.name);

  const getExerciseIdentityKeys = (exercise: any) => {
    const keys = new Set<string>();
    const id = String(exercise?.id || "").trim();
    const name = normalizeExerciseName(exercise?.name);
    const rawImage = String(exercise?.image || "").trim();
    const image = normalizeExerciseImageUrl(rawImage).toLowerCase();
    if (id) keys.add(`id:${id}`);
    if (name) keys.add(`name:${name}`);
    if (image) keys.add(`image:${image}`);
    return Array.from(keys);
  };

  const LEGACY_IMPORTED_CUSTOM_NAMES = new Set([
    "cable hammer curls - rope attachment",
    "calf raise",
    "lying leg curls",
    "lying leg curl",
    "machine jm press",
    "quad extension",
    "single arm reverse pec deck",
    "single arm rope hammer curl",
    "squat",
    "standing biceps cable curl",
    "straight bar cable crunches",
    "straight bar forearm curl",
    "tricep overhead extension",
    "tricep press machine",
    "triceps overhead extension with rope",
    "triceps pushdown",
  ]);

  const looksLikeBuiltInExercise = (exercise: any) => {
    const id = String(exercise?.id || "")
      .trim()
      .toLowerCase();
    const name = getExerciseMatchKey(exercise);
    const image = normalizeExerciseImageUrl(
      exercise?.image || "",
    ).toLowerCase();

    return (
      LEGACY_IMPORTED_CUSTOM_NAMES.has(name) ||
      /^ex-/.test(id) ||
      id.startsWith("gh_") ||
      image.includes("githubusercontent.com/junkaiiiiii/ironvault-exercises") ||
      image.includes("/ironvault-exercises/main/images/") ||
      image.includes("githubusercontent.com/yuhonas/free-exercise-db") ||
      image.includes("/yuhonas/free-exercise-db/") ||
      image.includes("free-exercise-db")
    );
  };

  const createCustomExerciseRecord = (exercise: any) => {
    const normalizedExercise = normalizeExerciseForAttachmentStorage(exercise);
    const attachmentOptions = getExerciseAttachmentOptions(normalizedExercise);
    return {
      ...normalizedExercise,
      name: cleanLimitedText(
        normalizedExercise?.name || "Custom Exercise",
        LIMITS.nameChars,
      ),
      reminder: limitText(
        normalizedExercise?.reminder || "",
        LIMITS.cueChars,
      ),
      muscle: normalizeExerciseMuscleGroup(normalizedExercise?.muscle),
      attachment: getExerciseAttachmentForSave(normalizedExercise),
      attachmentOptions:
        attachmentOptions.length > 0 ? attachmentOptions : undefined,
      supportsAttachments: attachmentOptions.length > 0 ? true : undefined,
      id:
        normalizedExercise?.id && !looksLikeBuiltInExercise(normalizedExercise)
          ? normalizedExercise.id
          : `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      is_custom: true,
      source: "custom",
      createdByUser: true,
      createdAt: normalizedExercise?.createdAt || Date.now(),
    };
  };

  const looksLikeAppCreatedCustomExercise = (exercise: any) => {
    if (!exercise || exercise.is_custom !== true) return false;

    const name = getExerciseMatchKey(exercise);
    if (!name || LEGACY_IMPORTED_CUSTOM_NAMES.has(name)) return false;

    const image = normalizeExerciseImageUrl(exercise?.image || "").trim();
    const equipment = String(exercise?.equipment || "").trim();
    const hasLegacyLibraryFields =
      !!image ||
      !!equipment ||
      exercise?.instructions !== undefined ||
      exercise?.description !== undefined ||
      exercise?.level !== undefined ||
      exercise?.force !== undefined ||
      exercise?.mechanic !== undefined ||
      exercise?.category !== undefined ||
      exercise?.secondaryMuscles !== undefined;

    if (hasLegacyLibraryFields) return false;

    const id = String(exercise?.id || "")
      .trim()
      .toLowerCase();
    const hasCustomIdentity =
      id.startsWith("custom_") ||
      id.startsWith("iv_custom_") ||
      exercise.createdByUser === true;

    const hasCustomFormFields =
      exercise?.reminder !== undefined ||
      exercise?.is_unilateral !== undefined ||
      exercise?.supportsVariants !== undefined ||
      exercise?.variationOptions !== undefined;

    return hasCustomIdentity && hasCustomFormFields;
  };

  const cleanStoredCustomExercises = (
    exercises: any[],
    referenceExercises: any[] = globalExercises,
  ) => {
    const references = [...INITIAL_EXERCISES, ...referenceExercises];
    const builtInIdentityKeys = new Set<string>();
    const builtInNameKeys = new Set<string>();

    references.forEach((exercise) => {
      getExerciseIdentityKeys(exercise).forEach((identityKey) =>
        builtInIdentityKeys.add(identityKey),
      );
      const nameKey = getExerciseMatchKey(exercise);
      if (nameKey) builtInNameKeys.add(nameKey);
    });

    const customByName = new Map<string, any>();

    (Array.isArray(exercises) ? exercises : []).forEach((exercise) => {
      if (!exercise || exercise.is_custom !== true) return;

      const nameKey = getExerciseMatchKey(exercise);
      if (!nameKey) return;

      const matchesBuiltInByIdentity = getExerciseIdentityKeys(exercise).some(
        (identityKey) => builtInIdentityKeys.has(identityKey),
      );
      const matchesBuiltInByName = builtInNameKeys.has(nameKey);
      const matchesBuiltInByShape = looksLikeBuiltInExercise(exercise);
      const appCreatedCustom = looksLikeAppCreatedCustomExercise(exercise);

      if (
        matchesBuiltInByIdentity ||
        matchesBuiltInByName ||
        matchesBuiltInByShape ||
        !appCreatedCustom
      ) {
        return;
      }

      customByName.set(nameKey, {
        ...exercise,
        is_custom: true,
        source: "custom",
        createdByUser: true,
      });
    });

    return Array.from(customByName.values()).sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || "")),
    );
  };

  const getFavoriteMatchKey = (value: any) => normalizeExerciseName(value);

  const getFavoriteDisplayName = (exercise: any) => getExerciseKey(exercise);

  const isExerciseFavorite = (exercise: any) => {
    const key = getExerciseMatchKey(exercise);
    return favoriteExerciseNames.some(
      (name) => getFavoriteMatchKey(name) === key,
    );
  };

  const cleanFavoriteExerciseNames = (names: string[]) => {
    const byKey = new Map<string, string>();
    names.forEach((name) => {
      const displayName = String(name || "").trim();
      const key = getFavoriteMatchKey(displayName);
      if (displayName && key && !byKey.has(key)) {
        byKey.set(key, displayName);
      }
    });
    return Array.from(byKey.values());
  };

  const saveFavoriteExerciseNames = async (nextFavorites: string[]) => {
    if (!uid) return;
    const cleaned = cleanFavoriteExerciseNames(nextFavorites);
    const nextKeys = new Set(cleaned.map(getFavoriteMatchKey));
    const currentKeys = new Set(favoriteExerciseNames.map(getFavoriteMatchKey));
    const removedFavorites = favoriteExerciseNames.filter(
      (name) => !nextKeys.has(getFavoriteMatchKey(name)),
    );
    const restoredFavorites = cleaned.filter(
      (name) => !currentKeys.has(getFavoriteMatchKey(name)),
    );

    setFavoriteExerciseNames(cleaned);
    if (removedFavorites.length > 0) {
      await markConfigValuesDeletedLocally(
        "favorite_exercises",
        removedFavorites,
        uid,
      );
    }
    if (restoredFavorites.length > 0) {
      await clearConfigValuesDeletedLocally(
        "favorite_exercises",
        restoredFavorites,
        uid,
      );
    }
    await AsyncStorage.setItem(
      `@favorite_exercises_${uid}`,
      JSON.stringify(cleaned),
    );
    syncFavoriteExercisesToCloud(cleaned).catch((error) =>
      console.log("Favorite exercise cloud sync delayed:", error),
    );
  };

  const transferFavoriteExerciseName = async (
    oldName: string,
    newName: string,
  ) => {
    const oldKey = getFavoriteMatchKey(oldName);
    const nextDisplayName = String(newName || "").trim();
    if (!oldKey || !nextDisplayName) return;

    const wasFavorite = favoriteExerciseNames.some(
      (name) => getFavoriteMatchKey(name) === oldKey,
    );
    if (!wasFavorite) return;

    await saveFavoriteExerciseNames([
      ...favoriteExerciseNames.filter(
        (name) => getFavoriteMatchKey(name) !== oldKey,
      ),
      nextDisplayName,
    ]);
  };

  const deleteCustomExercise = (exercise: any) => {
    if (!exercise) {
      setDeleteAlertVisible(false);
      setIsMenuVisible(false);
      setMenuExercise(null);
      return;
    }

    const exerciseKey = getExerciseMatchKey(exercise);
    if (!exerciseKey) {
      setDeleteAlertVisible(false);
      setIsMenuVisible(false);
      setMenuExercise(null);
      return;
    }

    const nextPersonalExercises = cleanStoredCustomExercises(
      personalExercises.filter(
        (item) => getExerciseMatchKey(item) !== exerciseKey,
      ),
    );
    const nextFavoriteExercises = cleanFavoriteExerciseNames(
      favoriteExerciseNames.filter(
        (name) => getFavoriteMatchKey(name) !== exerciseKey,
      ),
    );

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setDeleteAlertVisible(false);
    setIsMenuVisible(false);
    setIsDetailVisible(false);
    setSelectedEx(null);
    setMenuExercise(null);
    setPersonalExercises(nextPersonalExercises);
    setFavoriteExerciseNames(nextFavoriteExercises);

    Promise.resolve()
      .then(async () => {
        if (uid) {
          await markConfigItemsDeletedLocally(
            "personal_exercises",
            [exercise],
            uid,
          );
        }
        await savePersonalExercises(nextPersonalExercises);
        await saveFavoriteExerciseNames(nextFavoriteExercises);
      })
      .catch((error) => {
        console.log("Custom exercise delete persistence delayed:", error);
      });
  };

  const toggleFavoriteExercise = async (exercise: any) => {
    const key = getExerciseMatchKey(exercise);
    const displayName = getFavoriteDisplayName(exercise);
    if (!key || !displayName) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const isFavorite = favoriteExerciseNames.some(
      (name) => getFavoriteMatchKey(name) === key,
    );
    const nextFavorites = isFavorite
      ? favoriteExerciseNames.filter(
          (name) => getFavoriteMatchKey(name) !== key,
        )
      : [...favoriteExerciseNames, displayName];
    await saveFavoriteExerciseNames(nextFavorites);
  };

  const load = async () => {
    if (!uid) return;
    setIsFetchingAPI(true);

    // 1. Load instantly from cache for a fast UI
    let loadedGlobalExercises: any[] = [];
    const cachedGlobal = await AsyncStorage.getItem("@github_global_exercises");
    if (cachedGlobal) {
      const parsedCachedGlobal = safeJsonParse(cachedGlobal, []);
      loadedGlobalExercises = Array.isArray(parsedCachedGlobal)
        ? parsedCachedGlobal
        : [];
      setGlobalExercises(loadedGlobalExercises);
      setIsFetchingAPI(false); // Turn off loading spinner immediately
    }

    // 2. Silently fetch the latest version from GitHub in the background
    try {
      const fetchedData = await fetchGitHubExercises();
      if (fetchedData && fetchedData.length > 0) {
        loadedGlobalExercises = fetchedData;
        setGlobalExercises(fetchedData); // Instantly updates UI if there's a new exercise
        await AsyncStorage.setItem(
          "@github_global_exercises",
          JSON.stringify(fetchedData),
        );
      } else if (!cachedGlobal) {
        loadedGlobalExercises = INITIAL_EXERCISES;
        setGlobalExercises(INITIAL_EXERCISES);
      }
    } catch (error) {
      console.log("Silent background sync failed, relying on cache.");
      if (!cachedGlobal) {
        loadedGlobalExercises = INITIAL_EXERCISES;
        setGlobalExercises(INITIAL_EXERCISES);
      }
    } finally {
      setIsFetchingAPI(false);
    }

    const ex = await AsyncStorage.getItem(`@user_exercises_${uid}`);
    if (ex) {
      const parsedAll = safeJsonParse(ex, []);
      const cleanedCustomExercises = cleanStoredCustomExercises(
        parsedAll,
        loadedGlobalExercises,
      );
      setPersonalExercises(cleanedCustomExercises);
      if (
        Array.isArray(parsedAll) &&
        JSON.stringify(parsedAll) !== JSON.stringify(cleanedCustomExercises)
      ) {
        await AsyncStorage.setItem(
          `@user_exercises_${uid}`,
          JSON.stringify(cleanedCustomExercises),
        );
        syncPersonalExercisesToCloud(cleanedCustomExercises).catch((error) =>
          console.log("Cleaned custom exercises cloud sync delayed:", error),
        );
      }
    } else {
      setPersonalExercises([]);
    }

    const hi = await AsyncStorage.getItem(`@workout_history_${uid}`);
    const m = await AsyncStorage.getItem(`@user_metric_${uid}`);
    const savedGyms = await AsyncStorage.getItem(`@user_gyms_${uid}`);
    const savedFavorites = await AsyncStorage.getItem(
      `@favorite_exercises_${uid}`,
    );
    if (hi) {
      const parsedHistory = safeJsonParse<any[]>(hi, []);
      setHistory(parsedHistory.filter((w: any) => w && w.id));
    }
    if (m) setMetric(m);
    if (savedGyms) {
      const parsedGyms = safeJsonParse(savedGyms, []);
      setGyms(Array.isArray(parsedGyms) ? parsedGyms : []);
    } else {
      setGyms([]);
    }
    if (savedFavorites) {
      const parsedFavorites = safeJsonParse(savedFavorites, []);
      setFavoriteExerciseNames(
        Array.isArray(parsedFavorites)
          ? cleanFavoriteExerciseNames(parsedFavorites.map(String))
          : [],
      );
    } else {
      setFavoriteExerciseNames([]);
    }
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      requestAnimationFrame(() => {
        try {
          sectionListRef.current?.scrollToLocation({
            sectionIndex: 0,
            itemIndex: 0,
            animated: false,
            viewPosition: 0,
          });
        } catch (error) {
          // SectionList can throw before sections are measured; safe to ignore.
        }
      });
      load();
    });
    return unsubscribe;
  }, [navigation, uid]);

  useEffect(() => {
    if (isDetailVisible) {
      refreshGymsFromStorage();
    }
  }, [isDetailVisible, uid]);

  const savePersonalExercises = async (updatedPersonal: any[]) => {
    if (!uid) return;
    const cleanedPersonalExercises = cleanStoredCustomExercises(
      updatedPersonal,
      globalExercises,
    );
    setPersonalExercises(cleanedPersonalExercises);
    await AsyncStorage.setItem(
      `@user_exercises_${uid}`,
      JSON.stringify(cleanedPersonalExercises),
    );
    syncPersonalExercisesToCloud(cleanedPersonalExercises).catch((error) =>
      console.log("Custom exercise cloud sync delayed:", error),
    );
  };

  const parseWorkoutDate = (value: any) => {
    if (!value) return new Date(0);
    if (typeof value === "number") return new Date(value);

    const raw = String(value).trim();
    const nativeDate = new Date(raw);
    if (!Number.isNaN(nativeDate.getTime())) return nativeDate;

    const parts = raw.split(/[\/-]/).map((part) => parseInt(part, 10));
    if (parts.length >= 3 && parts.every((part) => !Number.isNaN(part))) {
      const [a, b, c] = parts;
      const year = c < 100 ? 2000 + c : c;
      const day = a > 12 ? a : b;
      const month = a > 12 ? b : a;
      return new Date(year, month - 1, day);
    }

    return new Date(0);
  };

  const getExerciseCardStats = (exerciseName: string) => {
    const targetName = cleanExerciseNameForAttachments(exerciseName);
    let heaviestWeight = -1;
    let maxRepsAtHeaviest = -1;
    let completedSessions = 0;
    let lastDate: any = null;

    history.forEach((w) => {
      const matchingExercises = (w.fullWorkoutData || []).filter(
        (ex: any) =>
          ex && cleanExerciseNameForAttachments(ex) === targetName,
      );
      if (matchingExercises.length === 0) return;

      let hasCompletedSet = false;
      matchingExercises.forEach((found: any) => {
        if (!Array.isArray(found?.sets)) return;
        found.sets.forEach((set: any) => {
          if (set.completed && !set.isWarmup) {
            const wVal = parseFloat(set.weight);
            const rVal = found.is_unilateral
              ? Math.max(
                  parseInt(set.repsL || "0", 10),
                  parseInt(set.repsR || "0", 10),
                )
              : parseInt(set.reps || "0", 10);

            if (Number.isFinite(wVal) && wVal > 0 && rVal > 0) {
              hasCompletedSet = true;
              if (wVal > heaviestWeight) {
                heaviestWeight = wVal;
                maxRepsAtHeaviest = rVal;
              } else if (wVal === heaviestWeight && rVal > maxRepsAtHeaviest) {
                maxRepsAtHeaviest = rVal;
              }
            }
          }
        });
      });

      if (hasCompletedSet) {
        completedSessions += 1;
        const currentDate = parseWorkoutDate(w.date);
        if (
          !lastDate ||
          currentDate.getTime() > parseWorkoutDate(lastDate).getTime()
        ) {
          lastDate = w.date;
        }
      }
    });

    return {
      hasHistory: heaviestWeight !== -1,
      bestText:
        heaviestWeight === -1
          ? "No history yet"
          : `Best ${heaviestWeight}${metric} × ${maxRepsAtHeaviest}`,
      sessionText:
        completedSessions === 0
          ? "Tap to view details"
          : `${completedSessions} session${completedSessions === 1 ? "" : "s"}${lastDate ? ` • Last ${formatShortDate(lastDate)}` : ""}`,
    };
  };

  const builtInReferenceExercises = useMemo(() => {
    const byKey = new Map<string, any>();

    getActiveBuiltInExercises(globalExercises).forEach((exercise) => {
      const key = getExerciseMatchKey(exercise);
      if (!key) return;
      byKey.set(key, exercise);
    });

    return Array.from(byKey.values());
  }, [globalExercises]);

  const unifiedExercises = useMemo(() => {
    const byName = new Map<string, any>();
    const builtInLookup = new Map<string, any>();

    builtInReferenceExercises.forEach((exercise) => {
      const key = getExerciseMatchKey(exercise);
      if (!key) return;

      const builtinExercise = {
        ...exercise,
        is_custom: false,
        source: "builtin",
      };
      byName.set(key, builtinExercise);
      getExerciseIdentityKeys(exercise).forEach((identityKey) => {
        builtInLookup.set(identityKey, builtinExercise);
      });
    });

    personalExercises.forEach((exercise) => {
      const key = getExerciseMatchKey(exercise);
      if (!key) return;

      const matchingBuiltin =
        getExerciseIdentityKeys(exercise)
          .map((identityKey) => builtInLookup.get(identityKey))
          .find(Boolean) || byName.get(key);

      if (matchingBuiltin) {
        const builtinKey = getExerciseMatchKey(matchingBuiltin);
        byName.set(builtinKey || key, {
          ...matchingBuiltin,
          is_custom: false,
          source: "builtin",
          has_personal_copy: true,
        });
        return;
      }

      if (looksLikeBuiltInExercise(exercise)) return;

      byName.set(key, { ...exercise, is_custom: true, source: "custom" });
    });

    return Array.from(byName.values()).sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || "")),
    );
  }, [builtInReferenceExercises, personalExercises]);

  const trueCustomExercises = useMemo(() => {
    return cleanStoredCustomExercises(personalExercises);
  }, [personalExercises, globalExercises]);

  const recentExerciseNames = useMemo(() => {
    const seen = new Set<string>();
    return [...history]
      .sort(
        (a, b) =>
          parseWorkoutDate(b.date).getTime() -
          parseWorkoutDate(a.date).getTime(),
      )
      .flatMap((workout) => workout.fullWorkoutData || [])
      .map((exercise: any) => String(exercise?.name || "").trim())
      .filter((name) => {
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      });
  }, [history]);

  const displayedExercises = useMemo(() => {
    if (libraryView === "Favorites") {
      const recentOrder = new Map<string, number>(
        recentExerciseNames.map((name, index) => [
          getFavoriteMatchKey(name),
          index,
        ]),
      );
      return unifiedExercises
        .filter((exercise) => isExerciseFavorite(exercise))
        .sort((a, b) => {
          const aOrder = recentOrder.get(getExerciseMatchKey(a));
          const bOrder = recentOrder.get(getExerciseMatchKey(b));
          if (aOrder !== undefined || bOrder !== undefined) {
            return (aOrder ?? 9999) - (bOrder ?? 9999);
          }
          return String(a.name || "").localeCompare(String(b.name || ""));
        });
    }
    if (libraryView === "Recent") {
      const order = new Map<string, number>(
        recentExerciseNames.map((name, index) => [
          getFavoriteMatchKey(name),
          index,
        ]),
      );
      return unifiedExercises
        .filter((exercise) => order.has(getExerciseMatchKey(exercise)))
        .sort(
          (a, b) =>
            (order.get(getExerciseMatchKey(a)) ?? 9999) -
            (order.get(getExerciseMatchKey(b)) ?? 9999),
        );
    }
    if (libraryView === "Custom") {
      return trueCustomExercises;
    }
    return unifiedExercises;
  }, [
    favoriteExerciseNames,
    libraryView,
    recentExerciseNames,
    trueCustomExercises,
    unifiedExercises,
  ]);

  const searchedExercises = useMemo(() => {
    let filtered = displayedExercises;
    if (activeFilter !== "All") {
      filtered = filtered.filter(
        (ex) => ex && normalizeExerciseMuscleGroup(ex.muscle) === activeFilter,
      );
    }
    if (searchQuery.trim()) {
      filtered = filterAndRankExercisesBySearch(filtered, searchQuery);
    }
    return filtered;
  }, [displayedExercises, activeFilter, searchQuery]);

  const sections = useMemo(
    () => prepareSections(searchedExercises, "All"),
    [searchedExercises],
  );

  const hasSearchQuery = searchQuery.trim().length > 0;
  const hasActiveFilter = activeFilter !== "All";
  const resultCountLabel = `${searchedExercises.length} ${
    searchedExercises.length === 1 ? "exercise" : "exercises"
  }${hasActiveFilter ? ` in ${activeFilter}` : ""}`;
  const libraryContextLabel = hasSearchQuery
    ? "Best name matches appear first"
    : libraryView === "Favorites"
      ? "Your starred exercises"
      : libraryView === "Recent"
        ? "Recently logged exercises"
        : libraryView === "Custom"
          ? "Exercises you created"
          : "Browse, filter, or search your library";

  const formatShortDate = (value: any) => {
    const date = parseWorkoutDate(value);
    if (date.getTime() === 0) return value || "Unknown date";
    return date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  };

  const formatFullDate = (value: any) => {
    const date = parseWorkoutDate(value);
    if (date.getTime() === 0) return value || "Unknown date";
    return date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const formatNumber = (value: number, decimals = 0) => {
    if (!Number.isFinite(value)) return "0";
    return value.toLocaleString(undefined, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: 0,
    });
  };

  const getWeight = (set: any) => {
    const value = parseFloat(String(set?.weight ?? "0"));
    return Number.isFinite(value) ? value : 0;
  };

  const getReps = (set: any, isUnilateral: boolean) => {
    if (isUnilateral) {
      const left = parseInt(String(set?.repsL ?? "0"), 10) || 0;
      const right = parseInt(String(set?.repsR ?? "0"), 10) || 0;
      return {
        display: `${left}L / ${right}R`,
        total: left + right,
        bestSide: Math.max(left, right),
      };
    }
    const reps = parseInt(String(set?.reps ?? "0"), 10) || 0;
    return { display: `${reps}`, total: reps, bestSide: reps };
  };

  const isCompletedWorkingSet = (set: any, isUnilateral: boolean) => {
    if (!set || set.isWarmup || !set.completed) return false;
    const weight = getWeight(set);
    const reps = getReps(set, isUnilateral);
    return weight > 0 && reps.total > 0;
  };

  const getSetVolume = (set: any, isUnilateral: boolean) => {
    const weight = getWeight(set);
    const reps = getReps(set, isUnilateral);
    return weight * reps.total;
  };

  const getEstimatedOneRepMax = (set: any, isUnilateral: boolean) => {
    const weight = getWeight(set);
    const reps = getReps(set, isUnilateral).bestSide;
    if (weight <= 0 || reps <= 0) return 0;
    return Number(calculate1RM(String(weight), String(reps))) || 0;
  };

  const getGymName = (workout: any) => {
    const workoutGymId = String(workout?.gymId ?? "");
    if (workoutGymId) {
      const currentGym = gyms.find(
        (gym) => getSavedGymId(gym) === workoutGymId,
      );
      const currentName = currentGym ? getSavedGymName(currentGym) : "";
      return currentName || workout?.gymName || "Unknown Gym";
    }
    return workout?.gymName || "No Gym";
  };

  const getGymFilterId = (workout: any) => {
    if (workout?.gymId) return String(workout.gymId);
    if (workout?.gymName) return `legacy:${String(workout.gymName).trim()}`;
    return "none";
  };

  const allExerciseSessions = useMemo(() => {
    if (!selectedEx) return [];

    return history
      .flatMap((workout) => {
        const selectedName = cleanExerciseNameForAttachments(selectedEx);
        const exercises = Array.isArray(workout.fullWorkoutData)
          ? workout.fullWorkoutData
          : [];

        return exercises
          .map((found: any, exerciseIndex: number) => {
            if (
              !found ||
              cleanExerciseNameForAttachments(found) !== selectedName
            ) {
              return null;
            }
            const attachment = getExerciseAttachmentForStorage(found);
            if (!Array.isArray(found.sets)) return null;

            const isUnilateral = !!found.is_unilateral;
            const workingSets = found.sets.filter((set: any) =>
              isCompletedWorkingSet(set, isUnilateral),
            );
            if (workingSets.length === 0) return null;

            const bestSet = workingSets.reduce((best: any, current: any) => {
              const currentRM = getEstimatedOneRepMax(current, isUnilateral);
              const bestRM = best
                ? getEstimatedOneRepMax(best, isUnilateral)
                : -1;
              return currentRM > bestRM ? current : best;
            }, null);

            const bestWeightSet = workingSets.reduce(
              (best: any, current: any) => {
                if (!best) return current;
                const currentWeight = getWeight(current);
                const bestWeight = getWeight(best);
                if (currentWeight > bestWeight) return current;
                if (currentWeight === bestWeight) {
                  return getReps(current, isUnilateral).bestSide >
                    getReps(best, isUnilateral).bestSide
                    ? current
                    : best;
                }
                return best;
              },
              null,
            );

            const sessionVolume = workingSets.reduce(
              (sum: number, set: any) => sum + getSetVolume(set, isUnilateral),
              0,
            );
            const brandApplies = isMachineBrandApplicable(found || selectedEx);
            const equipmentTag = brandApplies
              ? found.equipmentTag || found.brand || found.machineBrand || null
              : null;
            const exerciseVariant = found.exerciseVariant || "Normal";
            const gymName = getGymName(workout);

            return {
              id: `${workout.id || workout.startedAt || workout.date || "workout"}-${exerciseIndex}`,
              workoutId: workout.id,
              date: workout.startedAt || workout.date,
              parsedDate: parseWorkoutDate(workout.startedAt || workout.date),
              workoutName: workout.workoutName || "Workout",
              gymId: getGymFilterId(workout),
              gymName,
              equipmentTag,
              exerciseVariant,
              attachment,
              attachmentFilterValue:
                normalizeExerciseAttachment(attachment) ||
                NO_ATTACHMENT_FILTER,
              remark: found.remark || "",
              isUnilateral,
              sets: workingSets,
              bestSet,
              bestWeightSet,
              bestOneRM: getEstimatedOneRepMax(bestSet, isUnilateral),
              sessionVolume,
            };
          })
          .filter(Boolean);
      })
      .filter(Boolean)
      .sort(
        (a: any, b: any) => b.parsedDate.getTime() - a.parsedDate.getTime(),
      );
  }, [selectedEx, history, gyms]);

  const detailBrandApplicable = useMemo(
    () => (selectedEx ? isMachineBrandApplicable(selectedEx) : false),
    [selectedEx],
  );

  const detailGymOptions = useMemo(() => {
    const map = new Map<string, string>();

    gyms.forEach((gym: any) => {
      const id = getSavedGymId(gym);
      const name = getSavedGymName(gym);
      if (id && name) {
        map.set(id, name);
      }
    });

    allExerciseSessions.forEach((session: any) => {
      const id = session.gymId || "none";
      if (id === "none") {
        map.set("none", "No Gym");
        return;
      }

      const currentGym = gyms.find((gym: any) => getSavedGymId(gym) === id);
      const currentName = currentGym ? getSavedGymName(currentGym) : "";
      map.set(id, currentName || session.gymName || "Unknown Gym");
    });

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => {
        if (a.id === "none") return 1;
        if (b.id === "none") return -1;
        return a.name.localeCompare(b.name);
      });
  }, [allExerciseSessions, gyms]);

  useEffect(() => {
    if (detailGymFilter === "All") return;
    const hasSelectedGym = detailGymOptions.some(
      (gym) => gym.id === detailGymFilter,
    );
    if (!hasSelectedGym) {
      setDetailGymFilter("All");
    }
  }, [detailGymFilter, detailGymOptions]);

  const detailBrandOptions = useMemo(() => {
    if (!detailBrandApplicable) return [];
    const set = new Set<string>();
    allExerciseSessions.forEach((session: any) => {
      if (session.equipmentTag) set.add(session.equipmentTag);
    });
    return Array.from(set).sort();
  }, [allExerciseSessions, detailBrandApplicable]);

  const detailVariantOptions = useMemo(() => {
    const configured = selectedEx
      ? getExerciseVariationOptions(selectedEx)
      : [];
    const seen = new Set<string>(configured);
    allExerciseSessions.forEach((session: any) => {
      if (session.exerciseVariant) seen.add(session.exerciseVariant);
    });
    return Array.from(seen).filter(Boolean);
  }, [selectedEx, allExerciseSessions]);

  const detailAttachmentOptions = useMemo(() => {
    const byValue = new Map<string, string>();
    const configured = selectedEx ? getExerciseAttachmentOptions(selectedEx) : [];
    const hasAttachmentHistory = allExerciseSessions.some((session: any) =>
      normalizeExerciseAttachment(session.attachment),
    );

    const allowsNoAttachment =
      selectedEx && shouldAllowNoAttachmentOption(selectedEx);

    if (configured.length === 0 && !hasAttachmentHistory && !allowsNoAttachment) {
      return [];
    }

    const addAttachment = (attachment: any) => {
      const normalized = normalizeExerciseAttachment(attachment);
      if (normalized) {
        byValue.set(normalized, normalized);
        return;
      }
      byValue.set(NO_ATTACHMENT_FILTER, NO_ATTACHMENT_OPTION_LABEL);
    };

    if (allowsNoAttachment) {
      addAttachment("");
    }
    configured.forEach(addAttachment);
    allExerciseSessions.forEach((session: any) => {
      addAttachment(session.attachment);
    });

    return Array.from(byValue.entries()).map(([value, label]) => ({
      value,
      label,
    }));
  }, [selectedEx, allExerciseSessions]);

  useEffect(() => {
    if (detailAttachmentFilter === "All") return;
    const hasSelectedAttachment = detailAttachmentOptions.some(
      (attachment) => attachment.value === detailAttachmentFilter,
    );
    if (!hasSelectedAttachment) {
      setDetailAttachmentFilter("All");
    }
  }, [detailAttachmentFilter, detailAttachmentOptions]);

  const filteredExerciseSessions = useMemo(() => {
    const now = Date.now();
    const rangeDays =
      detailRange === "7D"
        ? 7
        : detailRange === "30D"
          ? 30
          : detailRange === "90D"
            ? 90
            : detailRange === "1Y"
              ? 365
              : null;

    return allExerciseSessions.filter((session: any) => {
      if (rangeDays !== null) {
        const diffDays = (now - session.parsedDate.getTime()) / 86400000;
        if (diffDays > rangeDays) return false;
      }
      if (detailGymFilter !== "All" && session.gymId !== detailGymFilter) {
        return false;
      }
      if (
        detailBrandApplicable &&
        detailBrandFilter !== "All" &&
        session.equipmentTag !== detailBrandFilter
      ) {
        return false;
      }
      if (
        detailVariantFilter !== "All" &&
        (session.exerciseVariant || "Normal") !== detailVariantFilter
      ) {
        return false;
      }
      if (
        detailAttachmentFilter !== "All" &&
        session.attachmentFilterValue !== detailAttachmentFilter
      ) {
        return false;
      }
      return true;
    });
  }, [
    allExerciseSessions,
    detailRange,
    detailGymFilter,
    detailBrandFilter,
    detailVariantFilter,
    detailAttachmentFilter,
    detailBrandApplicable,
  ]);

  const exerciseStats = useMemo(() => {
    const allSets = filteredExerciseSessions.flatMap((session: any) =>
      session.sets.map((set: any) => ({
        set,
        isUnilateral: session.isUnilateral,
        session,
        oneRM: getEstimatedOneRepMax(set, session.isUnilateral),
        volume: getSetVolume(set, session.isUnilateral),
      })),
    );

    const totalVolume = allSets.reduce(
      (sum: number, item: any) => sum + item.volume,
      0,
    );
    const totalSets = allSets.length;
    const bestSetItem = allSets.reduce((best: any, item: any) => {
      if (!best) return item;
      if (item.oneRM > best.oneRM) return item;
      if (
        item.oneRM === best.oneRM &&
        getWeight(item.set) > getWeight(best.set)
      )
        return item;
      return best;
    }, null);
    const maxOneRM = allSets.reduce(
      (max: number, item: any) => Math.max(max, item.oneRM),
      0,
    );
    const bestVolumeSession = filteredExerciseSessions.reduce(
      (best: any, session: any) =>
        !best || session.sessionVolume > best.sessionVolume ? session : best,
      null,
    );

    const bestWeightItem = allSets.reduce((best: any, item: any) => {
      if (!best) return item;
      const currentWeight = getWeight(item.set);
      const bestWeight = getWeight(best.set);
      if (currentWeight > bestWeight) return item;
      if (
        currentWeight === bestWeight &&
        getReps(item.set, item.isUnilateral).bestSide >
          getReps(best.set, best.isUnilateral).bestSide
      ) {
        return item;
      }
      return best;
    }, null);

    const bestSetVolumeItem = allSets.reduce((best: any, item: any) => {
      if (!best) return item;
      if (item.volume > best.volume) return item;
      if (
        item.volume === best.volume &&
        getWeight(item.set) > getWeight(best.set)
      ) {
        return item;
      }
      return best;
    }, null);

    const repPRMap = new Map<number, any>();
    allSets.forEach((item: any) => {
      const target = getReps(item.set, item.isUnilateral).bestSide;
      if (!target || target <= 0) return;

      const currentBest = repPRMap.get(target);
      if (!currentBest) {
        repPRMap.set(target, item);
        return;
      }

      const itemWeight = getWeight(item.set);
      const currentBestWeight = getWeight(currentBest.set);
      if (itemWeight > currentBestWeight) {
        repPRMap.set(target, item);
      }
    });

    const canonicalRepTargets = [1, 3, 5, 8, 10, 12, 15, 20];
    const repPRs = Array.from(repPRMap.entries())
      .map(([target, item]) => ({ target, ...item }))
      .filter((record: any) => canonicalRepTargets.includes(record.target))
      .sort((a, b) => a.target - b.target);

    const recordCount =
      (bestWeightItem ? 1 : 0) +
      (maxOneRM ? 1 : 0) +
      (bestSetVolumeItem ? 1 : 0) +
      repPRs.filter((record: any) => record.target !== 1).length +
      (bestVolumeSession ? 1 : 0);

    return {
      totalVolume,
      totalSets,
      bestSetItem,
      maxOneRM,
      bestVolumeSession,
      bestWeightItem,
      bestSetVolumeItem,
      repPRs,
      recordCount,
    };
  }, [filteredExerciseSessions]);

  const chartData = useMemo(() => {
    return [...filteredExerciseSessions]
      .reverse()
      .map((session: any) => {
        const value =
          detailChartMode === "Volume"
            ? session.sessionVolume
            : detailChartMode === "Best Set"
              ? getWeight(session.bestWeightSet)
              : session.bestOneRM;

        return {
          date: session.date,
          label: formatShortDate(session.date),
          value,
        };
      })
      .filter((item) => item.value > 0)
      .slice(-8);
  }, [filteredExerciseSessions, detailChartMode]);

  const chartMeta = useMemo(() => {
    if (detailChartMode === "Volume") {
      return {
        title: "Volume Trend",
        subtitle: `Total ${selectedEx?.name || "exercise"} volume per session`,
        icon: "bar-chart-outline" as const,
        type: "bar" as const,
      };
    }
    if (detailChartMode === "Best Set") {
      return {
        title: "Best Set Trend",
        subtitle: `Highest top-set weight per session`,
        icon: "podium-outline" as const,
        type: "line" as const,
      };
    }
    return {
      title: "Strength Trend",
      subtitle: "Best estimated 1RM per session",
      icon: "trending-up" as const,
      type: "line" as const,
    };
  }, [detailChartMode, selectedEx?.name]);

  const chartLayout = useMemo(() => {
    const width = Math.max(Dimensions.get("window").width - 76, 260);
    const height = 154;
    const points = chartData;
    const max = Math.max(...points.map((item) => item.value), 1);
    const min =
      points.length > 1 ? Math.min(...points.map((item) => item.value)) : 0;
    const range = Math.max(max - min, 1);

    const mapped = points.map((point, index) => {
      const x =
        points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const normalized = (point.value - min) / range;
      const y = height - 16 - normalized * (height - 34);
      return { ...point, x, y };
    });

    const segments = mapped.slice(0, -1).map((point, index) => {
      const next = mapped[index + 1];
      const dx = next.x - point.x;
      const dy = next.y - point.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      return { x: point.x, y: point.y, length, angle };
    });

    return { width, height, max, min, points: mapped, segments };
  }, [chartData]);

  const formatSetSummary = (set: any, isUnilateral: boolean) => {
    const weight = formatNumber(getWeight(set), 1);
    const reps = getReps(set, isUnilateral).display;
    return isUnilateral
      ? `${weight}${metric} × ${reps}`
      : `${weight}${metric} × ${reps}`;
  };

  return (
    <View style={styles.screen}>
      <CustomAlert
        visible={infoAlert.visible}
        title={infoAlert.title}
        message={infoAlert.message}
        buttons={[{ text: "OK" }]}
        onClose={() => setInfoAlert((prev) => ({ ...prev, visible: false }))}
      />
      <CustomAlert
        visible={deleteAlertVisible}
        title="Delete?"
        message="Remove exercise from library permanently?"
        buttons={[
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => deleteCustomExercise(menuExercise),
          },
        ]}
        onClose={() => setDeleteAlertVisible(false)}
      />

      {/* 🌟 UPDATED: Smart Alert for Overwriting vs Adding */}
      <CustomAlert
        visible={addAlert.visible}
        title={
          addAlert.isOverride ? "Replace Custom Exercise?" : "Save to Library"
        }
        message={
          addAlert.isOverride
            ? `You already have a custom exercise named ${addAlert.exercise?.name}. Replace it with this library exercise?`
            : `Save ${addAlert.exercise?.name} to your exercise library for tracking and future workouts?`
        }
        buttons={[
          { text: "Cancel", style: "cancel" },
          {
            text: addAlert.isOverride ? "Replace" : "Save",
            style: "default",
            onPress: () =>
              runExerciseBlockingAction(
                addAlert.isOverride
                  ? "Replacing exercise..."
                  : "Saving exercise...",
                async () => {
                  if (addAlert.exercise) {
                    Haptics.notificationAsync(
                      Haptics.NotificationFeedbackType.Success,
                    );
                    let updatedPersonal = [...personalExercises];

                    // If overriding, clean out the old version first
                    if (addAlert.isOverride) {
                      updatedPersonal = updatedPersonal.filter(
                        (e) => e.name !== addAlert.exercise.name,
                      );
                    } else if (
                      updatedPersonal.length >= LIMITS.customExercisesPerUser
                    ) {
                      setInfoAlert({
                        visible: true,
                        title: "Custom Exercise Limit Reached",
                        message: "You can save up to 100 custom exercises.",
                      });
                      return;
                    }

                    updatedPersonal.push(
                      createCustomExerciseRecord(addAlert.exercise),
                    );
                    await savePersonalExercises(updatedPersonal);
                  }
                  setAddAlert({
                    visible: false,
                    exercise: null,
                    isOverride: false,
                  });
                },
              ),
          },
        ]}
        onClose={() =>
          setAddAlert({ visible: false, exercise: null, isOverride: false })
        }
      />

      <Modal visible={isMenuVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsMenuVisible(false)}
        >
          <View style={styles.actionMenuContent}>
            <Text style={styles.actionMenuTitle}>Exercise Options</Text>
            <TouchableOpacity
              style={styles.actionMenuBtn}
              onPress={() => {
                setIsMenuVisible(false);
                setTimeout(() => {
                  setEditingExName(menuExercise.name);
                  setEditingMode("details");
                  setNewName(limitText(menuExercise.name, LIMITS.nameChars));
                  setNewMuscle(
                    normalizeExerciseMuscleGroup(menuExercise.muscle),
                  );
                  setNewReminder(
                    limitText(menuExercise.reminder || "", LIMITS.cueChars),
                  );
                  setNewIsUnilateral(menuExercise.is_unilateral || false);
                  setNewSupportsVariants(
                    getExerciseVariationOptions(menuExercise).length > 0,
                  );
                  setIsExModalVisible(true);
                }, 400);
              }}
            >
              <Text style={styles.actionMenuBtnText}>Edit Details</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionMenuBtn}
              onPress={() => {
                setIsMenuVisible(false);
                setTimeout(() => {
                  setEditingExName(menuExercise.name);
                  setEditingMode("reminder");
                  setNewName(limitText(menuExercise.name, LIMITS.nameChars));
                  setNewMuscle(
                    normalizeExerciseMuscleGroup(menuExercise.muscle),
                  );
                  setNewReminder(
                    limitText(menuExercise.reminder || "", LIMITS.cueChars),
                  );
                  setNewIsUnilateral(menuExercise.is_unilateral || false);
                  setNewSupportsVariants(
                    getExerciseVariationOptions(menuExercise).length > 0,
                  );
                  setIsExModalVisible(true);
                }, 400);
              }}
            >
              <Text style={styles.actionMenuBtnText}>Edit Reminder / Cue</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionMenuBtn, styles.actionMenuBtnDestructive]}
              onPress={() => {
                setIsMenuVisible(false);
                setTimeout(() => {
                  setDeleteAlertVisible(true);
                }, 400);
              }}
            >
              <Text style={styles.actionMenuBtnText}>Delete Exercise</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionMenuBtnCancel}
              onPress={() => setIsMenuVisible(false)}
            >
              <Text style={styles.actionMenuBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={isExModalVisible}
        transparent
        animationType="fade"
        onShow={() =>
          setTimeout(
            () =>
              editingMode === "reminder"
                ? (reminderRef.current?.focus(), setIsHighlighting(true))
                : inputRef.current?.focus(),
            50,
          )
        }
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={localStyles.createModalOverlay}
        >
          <TouchableOpacity
            style={localStyles.createModalBackdrop}
            activeOpacity={1}
            onPress={() => setIsExModalVisible(false)}
          />

          <View style={localStyles.createModalCard}>
            <View style={localStyles.createModalHandle} />
            <View style={localStyles.createModalHeader}>
              <Text style={localStyles.createModalTitle}>
                {editingMode === "new"
                  ? "Create Exercise"
                  : editingMode === "details"
                    ? "Edit Exercise"
                    : "Edit Cue"}
              </Text>
              <Text style={localStyles.createModalSubtitle}>
                {editingMode === "new"
                  ? "Add a custom movement to your exercise library."
                  : editingMode === "details"
                    ? "Update the exercise details used across your library."
                    : "Update the training cue shown for this exercise."}
              </Text>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={localStyles.createModalBody}
            >
              {(editingMode === "new" || editingMode === "details") && (
                <TextInput
                  ref={inputRef}
                  style={localStyles.createInput}
                  value={newName}
                  onChangeText={(value) =>
                    setNewName(limitText(value, LIMITS.nameChars))
                  }
                  maxLength={LIMITS.nameChars}
                  placeholder="Exercise name"
                  placeholderTextColor={Colors.textSubtle}
                  selectionColor={Colors.accent}
                />
              )}
              {(editingMode === "new" || editingMode === "reminder") && (
                <TextInput
                  ref={reminderRef}
                  style={[
                    localStyles.createInput,
                    localStyles.createInputMultiline,
                  ]}
                  value={newReminder}
                  onChangeText={(value) =>
                    setNewReminder(limitText(value, LIMITS.cueChars))
                  }
                  maxLength={LIMITS.cueChars}
                  placeholder="Training cue (optional)"
                  placeholderTextColor={Colors.textSubtle}
                  selectionColor={Colors.accent}
                  selection={
                    isHighlighting
                      ? { start: 0, end: newReminder?.length || 0 }
                      : undefined
                  }
                  onSelectionChange={() => {
                    if (isHighlighting) setIsHighlighting(false);
                  }}
                />
              )}

              {(editingMode === "new" || editingMode === "details") && (
                <>
                  <Text style={localStyles.createSectionLabel}>
                    Exercise Type
                  </Text>
                  <View style={localStyles.createChipWrap}>
                    <TouchableOpacity
                      style={[
                        localStyles.createChip,
                        !newIsUnilateral && localStyles.createChipActive,
                        { marginBottom: 10 },
                      ]}
                      onPress={() => setNewIsUnilateral(false)}
                    >
                      <Text
                        style={[
                          localStyles.createChipText,
                          !newIsUnilateral && localStyles.createChipTextActive,
                        ]}
                      >
                        Bilateral
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        localStyles.createChip,
                        newIsUnilateral && localStyles.createChipActive,
                        { marginBottom: 10 },
                      ]}
                      onPress={() => setNewIsUnilateral(true)}
                    >
                      <Text
                        style={[
                          localStyles.createChipText,
                          newIsUnilateral && localStyles.createChipTextActive,
                        ]}
                      >
                        Left / Right
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <Text
                    style={[localStyles.createSectionLabel, { marginTop: 10 }]}
                  >
                    Exercise Variants
                  </Text>
                  <Text style={localStyles.variantHelpText}>
                    Turn this on for movements where Normal, Paused, and Tempo
                    should be tracked separately.
                  </Text>
                  <View style={localStyles.createChipWrap}>
                    <TouchableOpacity
                      style={[
                        localStyles.createChip,
                        !newSupportsVariants && localStyles.createChipActive,
                        { marginBottom: 10 },
                      ]}
                      onPress={() => setNewSupportsVariants(false)}
                    >
                      <Text
                        style={[
                          localStyles.createChipText,
                          !newSupportsVariants &&
                            localStyles.createChipTextActive,
                        ]}
                      >
                        Off
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        localStyles.createChip,
                        newSupportsVariants && localStyles.createChipActive,
                        { marginBottom: 10 },
                      ]}
                      onPress={() => setNewSupportsVariants(true)}
                    >
                      <Text
                        style={[
                          localStyles.createChipText,
                          newSupportsVariants &&
                            localStyles.createChipTextActive,
                        ]}
                      >
                        Normal / Paused / Tempo
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <Text
                    style={[localStyles.createSectionLabel, { marginTop: 10 }]}
                  >
                    Muscle Group
                  </Text>
                  <View style={localStyles.createChipWrap}>
                    {MUSCLE_GROUPS.map((m) => (
                      <TouchableOpacity
                        key={m}
                        style={[
                          localStyles.createChip,
                          newMuscle === m && localStyles.createChipActive,
                          { marginBottom: 10 },
                        ]}
                        onPress={() => setNewMuscle(m)}
                      >
                        <Text
                          style={[
                            localStyles.createChipText,
                            newMuscle === m && localStyles.createChipTextActive,
                          ]}
                        >
                          {m}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>

            <View style={localStyles.createModalFooter}>
              <TouchableOpacity
                style={localStyles.createCancelButton}
                onPress={() => setIsExModalVisible(false)}
              >
                <Text style={localStyles.createCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  localStyles.createSaveButton,
                  ((editingMode !== "reminder" && !newName.trim()) ||
                    isExerciseBlocking) &&
                    localStyles.createSaveButtonDisabled,
                ]}
                disabled={
                  (editingMode !== "reminder" && !newName.trim()) ||
                  isExerciseBlocking
                }
                onPress={async () => {
                  if (exerciseBlockingRef.current) return;
                  exerciseBlockingRef.current = true;
                  setExerciseBlockingMessage(
                    editingMode === "new"
                      ? "Saving exercise..."
                      : "Saving changes...",
                  );
                  try {
                    const finalName = cleanLimitedText(
                      newName,
                      LIMITS.nameChars,
                    );
                    const finalReminder = cleanLimitedText(
                      newReminder,
                      LIMITS.cueChars,
                    );
                    if (editingMode !== "reminder" && !finalName) return;
                    if (!uid) return;
                    Haptics.notificationAsync(
                      Haptics.NotificationFeedbackType.Success,
                    );

                  if (editingExName) {
                    const updatedPersonal = personalExercises.map((e) =>
                      e.name === editingExName
                        ? {
                            ...e,
                            name: finalName,
                            muscle: normalizeExerciseMuscleGroup(newMuscle),
                            reminder: finalReminder,
                            is_unilateral: newIsUnilateral,
                            supportsVariants: newSupportsVariants,
                            variationOptions: newSupportsVariants
                              ? ["Normal", "Paused", "Tempo"]
                              : undefined,
                          }
                        : e,
                    );
                    await savePersonalExercises(updatedPersonal);
                    await transferFavoriteExerciseName(
                      editingExName,
                      finalName,
                    );

                    if (editingMode === "details") {
                      const tmplRaw = await AsyncStorage.getItem(
                        `@workout_templates_${uid}`,
                      );
                      if (tmplRaw) {
                        const tmpls = safeJsonParse<any[]>(tmplRaw, []).map((t: any) => ({
                          ...t,
                          exercises: Array.isArray(t.exercises) ? t.exercises.map((ex: any) =>
                            ex.name === editingExName
                              ? {
                                  ...ex,
                                  name: finalName,
                                  is_unilateral: newIsUnilateral,
                                }
                              : ex,
                          ) : [],
                        }));
                        await saveTemplatesLocallyAndToCloud(tmpls, uid);
                      }
                      const histRaw = await AsyncStorage.getItem(
                        `@workout_history_${uid}`,
                      );
                      if (histRaw) {
                        const hist = safeJsonParse<any[]>(histRaw, []).map((w: any) => ({
                          ...w,
                          fullWorkoutData: Array.isArray(w.fullWorkoutData) ? w.fullWorkoutData.map((ex: any) =>
                            ex.name === editingExName
                              ? {
                                  ...ex,
                                  name: finalName,
                                  is_unilateral: newIsUnilateral,
                                }
                              : ex,
                          ) : [],
                        }));
                        await AsyncStorage.setItem(
                          `@workout_history_${uid}`,
                          JSON.stringify(hist),
                        );
                        setHistory(hist);
                        pushWorkoutListToCloud(hist).catch((error) => {
                          console.log(
                            "Cloud workout history refresh delayed after custom exercise edit.",
                            error,
                          );
                        });
                      }

                      const activeSessionRaw = await AsyncStorage.getItem(
                        `@active_session_${uid}`,
                      );
                      if (activeSessionRaw) {
                        try {
                          const activeSession = safeJsonParse<any>(activeSessionRaw, null);
                          if (activeSession && Array.isArray(activeSession.exercises)) {
                            activeSession.exercises =
                              activeSession.exercises.map((ex: any) => {
                                if (ex.name !== editingExName) return ex;
                                const updated = {
                                  ...ex,
                                  name: finalName,
                                  is_unilateral: newIsUnilateral,
                                };
                                if (newIsUnilateral && !ex.is_unilateral) {
                                  updated.sets = (ex.sets || []).map(
                                    (s: any) => ({
                                      ...s,
                                      repsL: s.reps || "",
                                      repsR: s.reps || "",
                                      reps: "",
                                    }),
                                  );
                                }
                                if (!newIsUnilateral && ex.is_unilateral) {
                                  updated.sets = (ex.sets || []).map(
                                    (s: any) => ({
                                      ...s,
                                      reps: s.repsL || s.repsR || "",
                                      repsL: "",
                                      repsR: "",
                                    }),
                                  );
                                }
                                return updated;
                              });
                            await AsyncStorage.setItem(
                              `@active_session_${uid}`,
                              JSON.stringify(activeSession),
                            );
                          }
                        } catch {
                          // Ignore parsing errors
                        }
                      }
                    }
                  } else {
                    if (
                      personalExercises.length >= LIMITS.customExercisesPerUser
                    ) {
                      setInfoAlert({
                        visible: true,
                        title: "Custom Exercise Limit Reached",
                        message: "You can save up to 100 custom exercises.",
                      });
                      return;
                    }
                    await savePersonalExercises([
                      ...personalExercises,
                      createCustomExerciseRecord({
                        name: finalName,
                        muscle: normalizeExerciseMuscleGroup(newMuscle),
                        reminder: finalReminder,
                        is_unilateral: newIsUnilateral,
                        supportsVariants: newSupportsVariants,
                        variationOptions: newSupportsVariants
                          ? ["Normal", "Paused", "Tempo"]
                          : undefined,
                      }),
                    ]);
                  }
                  setIsExModalVisible(false);
                  setNewName("");
                  setNewReminder("");
                  setNewIsUnilateral(false);
                  setNewSupportsVariants(false);
                  } catch (error) {
                    console.error("Custom exercise save failed:", error);
                  } finally {
                    exerciseBlockingRef.current = false;
                    setExerciseBlockingMessage("");
                  }
                }}
              >
                <Text style={localStyles.createSaveText}>
                  {editingMode === "new" ? "Save Exercise" : "Save"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={isDetailVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onDismiss={() => setIsDetailVisible(false)}
        onRequestClose={() => setIsDetailVisible(false)}
      >
        <View style={localStyles.detailScreen}>
          <SafeAreaView edges={["top"]} style={localStyles.detailHeaderSafe}>
            <View style={localStyles.detailHeader}>
              {normalizeExerciseImageUrl(selectedEx?.image) &&
              !imageErrors[selectedEx?.name || "detail"] ? (
                <Image
                  source={{
                    uri: normalizeExerciseImageUrl(selectedEx?.image)!,
                  }}
                  onError={() =>
                    setImageErrors((prev) => ({
                      ...prev,
                      [selectedEx?.name || "detail"]: true,
                    }))
                  }
                  transition={200}
                  contentFit="contain"
                  style={localStyles.detailThumbnail}
                />
              ) : (
                <View style={localStyles.detailThumbnailFallback}>
                  <Ionicons name="barbell" size={24} color={Colors.textMuted} />
                </View>
              )}

              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={localStyles.detailEyebrow}>
                  {normalizeExerciseMuscleGroup(selectedEx?.muscle) ||
                    "Exercise"}
                </Text>
                <Text style={localStyles.detailTitle} numberOfLines={2}>
                  {selectedEx?.name}
                </Text>
                {!!selectedEx?.equipment && (
                  <Text style={localStyles.detailSubtitle} numberOfLines={1}>
                    {selectedEx.equipment}
                  </Text>
                )}
              </View>

              <TouchableOpacity
                onPress={() => setIsDetailVisible(false)}
                style={localStyles.detailCloseBtn}
              >
                <Ionicons name="close" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>
          </SafeAreaView>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={localStyles.detailContent}
          >
            {allExerciseSessions.length > 0 && (
              <>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={localStyles.rangeRow}
                >
                  {(["7D", "30D", "90D", "1Y", "All"] as const).map((range) => {
                    const active = detailRange === range;
                    return (
                      <TouchableOpacity
                        key={range}
                        style={[
                          localStyles.rangeChip,
                          active && localStyles.rangeChipActive,
                        ]}
                        onPress={() => setDetailRange(range)}
                      >
                        <Text
                          style={[
                            localStyles.rangeChipText,
                            active && localStyles.rangeChipTextActive,
                          ]}
                        >
                          {range}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <View style={localStyles.detailFilterBlock}>
                  <Text style={localStyles.detailSectionKicker}>Filters</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={localStyles.detailFilterRow}
                  >
                    <TouchableOpacity
                      style={[
                        localStyles.smallFilterChip,
                        detailGymFilter === "All" &&
                          localStyles.smallFilterChipActive,
                      ]}
                      onPress={() => setDetailGymFilter("All")}
                    >
                      <Text
                        style={[
                          localStyles.smallFilterText,
                          detailGymFilter === "All" &&
                            localStyles.smallFilterTextActive,
                        ]}
                      >
                        All Gyms
                      </Text>
                    </TouchableOpacity>
                    {detailGymOptions.map((gym) => (
                      <TouchableOpacity
                        key={gym.id}
                        style={[
                          localStyles.smallFilterChip,
                          detailGymFilter === gym.id &&
                            localStyles.smallFilterChipActive,
                        ]}
                        onPress={() => setDetailGymFilter(gym.id)}
                      >
                        <Text
                          style={[
                            localStyles.smallFilterText,
                            detailGymFilter === gym.id &&
                              localStyles.smallFilterTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {gym.name}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>

                  {detailVariantOptions.length > 0 && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={[
                        localStyles.detailFilterRow,
                        { paddingTop: 8 },
                      ]}
                    >
                      <TouchableOpacity
                        style={[
                          localStyles.smallFilterChip,
                          detailVariantFilter === "All" &&
                            localStyles.smallFilterChipActive,
                        ]}
                        onPress={() => setDetailVariantFilter("All")}
                      >
                        <Text
                          style={[
                            localStyles.smallFilterText,
                            detailVariantFilter === "All" &&
                              localStyles.smallFilterTextActive,
                          ]}
                        >
                          All Variants
                        </Text>
                      </TouchableOpacity>
                      {detailVariantOptions.map((variant) => (
                        <TouchableOpacity
                          key={variant}
                          style={[
                            localStyles.smallFilterChip,
                            detailVariantFilter === variant &&
                              localStyles.smallFilterChipActive,
                          ]}
                          onPress={() => setDetailVariantFilter(variant)}
                        >
                          <Text
                            style={[
                              localStyles.smallFilterText,
                              detailVariantFilter === variant &&
                                localStyles.smallFilterTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {variant}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}

                  {detailAttachmentOptions.length > 0 && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={[
                        localStyles.detailFilterRow,
                        { paddingTop: 8 },
                      ]}
                    >
                      <TouchableOpacity
                        style={[
                          localStyles.smallFilterChip,
                          detailAttachmentFilter === "All" &&
                            localStyles.smallFilterChipActive,
                        ]}
                        onPress={() => setDetailAttachmentFilter("All")}
                      >
                        <Text
                          style={[
                            localStyles.smallFilterText,
                            detailAttachmentFilter === "All" &&
                              localStyles.smallFilterTextActive,
                          ]}
                        >
                          All Attachments
                        </Text>
                      </TouchableOpacity>
                      {detailAttachmentOptions.map((attachment) => (
                        <TouchableOpacity
                          key={attachment.value}
                          style={[
                            localStyles.smallFilterChip,
                            detailAttachmentFilter === attachment.value &&
                              localStyles.smallFilterChipActive,
                          ]}
                          onPress={() =>
                            setDetailAttachmentFilter(attachment.value)
                          }
                        >
                          <Text
                            style={[
                              localStyles.smallFilterText,
                              detailAttachmentFilter === attachment.value &&
                                localStyles.smallFilterTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {attachment.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}

                  {detailBrandApplicable && detailBrandOptions.length > 0 && (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={[
                        localStyles.detailFilterRow,
                        { paddingTop: 8 },
                      ]}
                    >
                      <TouchableOpacity
                        style={[
                          localStyles.smallFilterChip,
                          detailBrandFilter === "All" &&
                            localStyles.smallFilterChipActive,
                        ]}
                        onPress={() => setDetailBrandFilter("All")}
                      >
                        <Text
                          style={[
                            localStyles.smallFilterText,
                            detailBrandFilter === "All" &&
                              localStyles.smallFilterTextActive,
                          ]}
                        >
                          All Brands
                        </Text>
                      </TouchableOpacity>
                      {detailBrandOptions.map((brand) => (
                        <TouchableOpacity
                          key={brand}
                          style={[
                            localStyles.smallFilterChip,
                            detailBrandFilter === brand &&
                              localStyles.smallFilterChipActive,
                          ]}
                          onPress={() => setDetailBrandFilter(brand)}
                        >
                          <Text
                            style={[
                              localStyles.smallFilterText,
                              detailBrandFilter === brand &&
                                localStyles.smallFilterTextActive,
                            ]}
                            numberOfLines={1}
                          >
                            {brand}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>
              </>
            )}

            {allExerciseSessions.length === 0 ? (
              <View style={localStyles.noStatsCard}>
                <View style={localStyles.noStatsIcon}>
                  <Ionicons
                    name="analytics-outline"
                    size={28}
                    color={Colors.accent}
                  />
                </View>
                <Text style={localStyles.noStatsTitle}>No history yet</Text>
                <Text style={localStyles.noStatsBody}>
                  Complete this exercise in a workout and IronVault will start
                  tracking your best sets, estimated 1RM, volume trend, and
                  recent performances.
                </Text>

                <TouchableOpacity
                  style={localStyles.primaryDetailButton}
                  onPress={() => {
                    setIsDetailVisible(false);
                    navigation.navigate("Workout", {
                      initialExercise: selectedEx,
                    });
                  }}
                >
                  <Ionicons name="play" size={16} color={Colors.background} />
                  <Text style={localStyles.primaryDetailButtonText}>
                    Start Workout
                  </Text>
                </TouchableOpacity>

                {selectedEx && (
                  <TouchableOpacity
                    style={localStyles.secondaryDetailButton}
                    onPress={() => toggleFavoriteExercise(selectedEx)}
                  >
                    <Text style={localStyles.secondaryDetailButtonText}>
                      {isExerciseFavorite(selectedEx)
                        ? "Remove from Favorites"
                        : "Add to Favorites"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : filteredExerciseSessions.length === 0 ? (
              <View style={localStyles.noStatsCard}>
                <View style={localStyles.noStatsIcon}>
                  <Ionicons
                    name="filter-outline"
                    size={28}
                    color={Colors.accent}
                  />
                </View>
                <Text style={localStyles.noStatsTitle}>
                  No data for this filter
                </Text>
                <Text style={localStyles.noStatsBody}>
                  {detailAttachmentOptions.length > 0 && detailBrandApplicable
                    ? "Try changing the time range, gym, attachment, or machine brand filter to view more performances for this exercise."
                    : detailAttachmentOptions.length > 0
                      ? "Try changing the time range, gym, or attachment filter to view more performances for this exercise."
                      : detailBrandApplicable
                        ? "Try changing the time range, gym, or machine brand filter to view more performances for this exercise."
                        : "Try changing the time range or gym filter to view more performances for this exercise."}
                </Text>
                <TouchableOpacity
                  style={localStyles.secondaryDetailButton}
                  onPress={() => {
                  setDetailRange("All");
                  setDetailGymFilter("All");
                  setDetailBrandFilter("All");
                  setDetailAttachmentFilter("All");
                }}
              >
                  <Text style={localStyles.secondaryDetailButtonText}>
                    Clear Filters
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={localStyles.overviewCard}>
                  <View style={localStyles.cardHeaderRowCompact}>
                    <View>
                      <Text style={localStyles.cardTitle}>Overview</Text>
                      <Text style={localStyles.cardSubtitle}>
                        Performance in the selected filters
                      </Text>
                    </View>
                    <Ionicons
                      name="analytics-outline"
                      size={20}
                      color={Colors.accent}
                    />
                  </View>

                  <View style={localStyles.overviewGrid}>
                    <View style={localStyles.overviewItem}>
                      <Text style={localStyles.overviewLabel}>Last Done</Text>
                      <Text style={localStyles.overviewValue} numberOfLines={1}>
                        {filteredExerciseSessions[0]
                          ? formatShortDate(filteredExerciseSessions[0].date)
                          : "--"}
                      </Text>
                    </View>
                    <View style={localStyles.overviewItem}>
                      <Text style={localStyles.overviewLabel}>Sessions</Text>
                      <Text style={localStyles.overviewValue} numberOfLines={1}>
                        {filteredExerciseSessions.length}
                      </Text>
                    </View>
                    <View style={localStyles.overviewItem}>
                      <Text style={localStyles.overviewLabel}>Sets</Text>
                      <Text style={localStyles.overviewValue} numberOfLines={1}>
                        {exerciseStats.totalSets}
                      </Text>
                    </View>
                    <View style={localStyles.overviewItem}>
                      <Text style={localStyles.overviewLabel}>Volume</Text>
                      <Text style={localStyles.overviewValue} numberOfLines={1}>
                        {formatNumber(exerciseStats.totalVolume, 0)} {metric}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={localStyles.strengthCard}>
                  <View style={localStyles.cardHeaderRowCompact}>
                    <View>
                      <Text style={localStyles.cardTitle}>Strength</Text>
                      <Text style={localStyles.cardSubtitle}>
                        Your strongest set and current estimate
                      </Text>
                    </View>
                    <Ionicons
                      name="barbell-outline"
                      size={20}
                      color={Colors.accent}
                    />
                  </View>

                  <View style={localStyles.strengthRow}>
                    <View style={localStyles.strengthMetric}>
                      <Text style={localStyles.strengthLabel}>Best Set</Text>
                      <Text style={localStyles.strengthValue} numberOfLines={1}>
                        {exerciseStats.bestSetItem
                          ? formatSetSummary(
                              exerciseStats.bestSetItem.set,
                              exerciseStats.bestSetItem.isUnilateral,
                            )
                          : "--"}
                      </Text>
                    </View>
                    <View style={localStyles.strengthDivider} />
                    <View style={localStyles.strengthMetric}>
                      <Text style={localStyles.strengthLabel}>Est. 1RM</Text>
                      <Text style={localStyles.strengthValue} numberOfLines={1}>
                        {exerciseStats.maxOneRM
                          ? `${formatNumber(exerciseStats.maxOneRM, 1)}${metric}`
                          : "--"}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={localStyles.trendCard}>
                  <View style={localStyles.cardHeaderRow}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text style={localStyles.cardTitle}>
                        {chartMeta.title}
                      </Text>
                      <Text style={localStyles.cardSubtitle}>
                        {chartMeta.subtitle}
                      </Text>
                    </View>
                    <Ionicons
                      name={chartMeta.icon}
                      size={20}
                      color={Colors.accent}
                    />
                  </View>

                  <View style={localStyles.chartModeRow}>
                    {(["Strength", "Volume", "Best Set"] as const).map(
                      (mode) => {
                        const active = detailChartMode === mode;
                        return (
                          <TouchableOpacity
                            key={mode}
                            style={[
                              localStyles.chartModeChip,
                              active && localStyles.chartModeChipActive,
                            ]}
                            onPress={() => setDetailChartMode(mode)}
                          >
                            <Text
                              style={[
                                localStyles.chartModeText,
                                active && localStyles.chartModeTextActive,
                              ]}
                            >
                              {mode}
                            </Text>
                          </TouchableOpacity>
                        );
                      },
                    )}
                  </View>

                  {chartData.length <= 1 ? (
                    <View style={localStyles.trendEmptyBox}>
                      <Text style={localStyles.trendEmptyTitle}>
                        More data needed
                      </Text>
                      <Text style={localStyles.trendEmptyText}>
                        Log this exercise again to see your progression over
                        time.
                      </Text>
                    </View>
                  ) : chartMeta.type === "bar" ? (
                    <View style={localStyles.barChartRow}>
                      {chartData.map((point, index, arr) => {
                        const max = Math.max(
                          ...arr.map((item) => item.value),
                          1,
                        );
                        const height = Math.max(20, (point.value / max) * 132);
                        const isBest = point.value === max;
                        return (
                          <View
                            key={`${point.date}-${index}`}
                            style={localStyles.detailBarWrap}
                          >
                            <Text
                              style={localStyles.detailBarValue}
                              numberOfLines={1}
                            >
                              {formatNumber(point.value, 0)}
                            </Text>
                            <View style={localStyles.detailBarTrack}>
                              <View
                                style={[
                                  localStyles.detailBarFill,
                                  { height },
                                  isBest && localStyles.detailBarFillBest,
                                ]}
                              />
                            </View>
                            <Text
                              style={localStyles.detailBarLabel}
                              numberOfLines={1}
                            >
                              {point.label}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  ) : (
                    <View style={localStyles.lineChartBlock}>
                      <View
                        style={[
                          localStyles.lineChartCanvas,
                          {
                            width: chartLayout.width,
                            height: chartLayout.height,
                          },
                        ]}
                      >
                        <View style={[localStyles.lineGrid, { top: 24 }]} />
                        <View
                          style={[
                            localStyles.lineGrid,
                            { top: chartLayout.height / 2 },
                          ]}
                        />
                        <View style={[localStyles.lineGrid, { bottom: 16 }]} />

                        {chartLayout.segments.map((segment, index) => (
                          <View
                            key={`segment-${index}`}
                            style={[
                              localStyles.lineSegment,
                              {
                                left: segment.x,
                                top: segment.y,
                                width: segment.length,
                                transform: [{ rotateZ: `${segment.angle}deg` }],
                              },
                            ]}
                          />
                        ))}

                        {chartLayout.points.map((point, index) => {
                          const isBest = point.value === chartLayout.max;
                          return (
                            <View
                              key={`${point.date}-${index}`}
                              style={[
                                localStyles.linePointWrap,
                                { left: point.x - 19, top: point.y - 20 },
                              ]}
                            >
                              <Text
                                style={localStyles.linePointValue}
                                numberOfLines={1}
                              >
                                {formatNumber(point.value, 0)}
                              </Text>
                              <View
                                style={[
                                  localStyles.linePoint,
                                  isBest && localStyles.linePointBest,
                                ]}
                              />
                            </View>
                          );
                        })}
                      </View>

                      <View style={localStyles.lineLabelRow}>
                        {chartData.map((point, index) => (
                          <Text
                            key={`${point.date}-label-${index}`}
                            style={localStyles.detailBarLabel}
                            numberOfLines={1}
                          >
                            {point.label}
                          </Text>
                        ))}
                      </View>
                    </View>
                  )}
                </View>

                <View style={localStyles.recordsCard}>
                  <View style={localStyles.cardHeaderRowCompact}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text style={localStyles.cardTitle}>
                        Personal Records
                      </Text>
                      <Text style={localStyles.cardSubtitle}>
                        Clean records for this exercise and filter
                      </Text>
                    </View>
                    <Ionicons
                      name="trophy-outline"
                      size={20}
                      color={Colors.accent}
                    />
                  </View>

                  <View style={localStyles.recordsList}>
                    <View style={localStyles.recordRow}>
                      <Text style={localStyles.recordRowLabel}>
                        Heaviest Set
                      </Text>
                      <Text
                        style={localStyles.recordRowValue}
                        numberOfLines={1}
                      >
                        {exerciseStats.bestWeightItem
                          ? formatSetSummary(
                              exerciseStats.bestWeightItem.set,
                              exerciseStats.bestWeightItem.isUnilateral,
                            )
                          : "--"}
                      </Text>
                    </View>
                    <View style={localStyles.recordRow}>
                      <Text style={localStyles.recordRowLabel}>
                        Best 1RM Estimate
                      </Text>
                      <Text
                        style={localStyles.recordRowValue}
                        numberOfLines={1}
                      >
                        {exerciseStats.maxOneRM
                          ? `${formatNumber(exerciseStats.maxOneRM, 1)}${metric}`
                          : "--"}
                      </Text>
                    </View>
                    {!!exerciseStats.bestVolumeSession && (
                      <View style={localStyles.recordRow}>
                        <Text style={localStyles.recordRowLabel}>
                          Best Volume Session
                        </Text>
                        <Text
                          style={localStyles.recordRowValue}
                          numberOfLines={1}
                        >
                          {formatNumber(
                            exerciseStats.bestVolumeSession.sessionVolume,
                            0,
                          )}{" "}
                          {metric}
                        </Text>
                      </View>
                    )}
                  </View>

                  {exerciseStats.repPRs.filter(
                    (record: any) => record.target !== 1,
                  ).length > 0 && (
                    <View style={localStyles.repRecordsBlock}>
                      <Text style={localStyles.repRecordsTitle}>
                        Rep Records
                      </Text>
                      <View style={localStyles.repRecordsGrid}>
                        {exerciseStats.repPRs
                          .filter((record: any) => record.target !== 1)
                          .slice(0, 6)
                          .map((record: any) => (
                            <View
                              key={`rep-record-${record.target}`}
                              style={localStyles.repRecordChip}
                            >
                              <Text style={localStyles.repRecordLabel}>
                                {record.target}RM
                              </Text>
                              <Text
                                style={localStyles.repRecordValue}
                                numberOfLines={1}
                              >
                                {formatSetSummary(
                                  record.set,
                                  record.isUnilateral,
                                )}
                              </Text>
                            </View>
                          ))}
                      </View>
                    </View>
                  )}
                </View>

                <View style={localStyles.recentSectionHeader}>
                  <Text style={localStyles.cardTitle}>Recent Performances</Text>
                  <Text style={localStyles.cardSubtitle}>
                    {filteredExerciseSessions.length} logged session
                    {filteredExerciseSessions.length === 1 ? "" : "s"}
                  </Text>
                </View>

                {filteredExerciseSessions.slice(0, 12).map((session: any) => (
                  <View key={session.id} style={localStyles.performanceCard}>
                    <View style={localStyles.performanceHeader}>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text
                          style={localStyles.performanceTitle}
                          numberOfLines={1}
                        >
                          {session.workoutName}
                        </Text>
                        <Text
                          style={localStyles.performanceMeta}
                          numberOfLines={2}
                        >
                          {[
                            formatFullDate(session.date),
                            session.exerciseVariant &&
                            session.exerciseVariant !== "Normal"
                              ? session.exerciseVariant
                              : null,
                            session.attachment,
                            session.gymName,
                            session.equipmentTag,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Text>
                      </View>
                      <View style={localStyles.performancePill}>
                        <Text style={localStyles.performancePillText}>
                          {formatNumber(session.sessionVolume, 0)} {metric}
                        </Text>
                      </View>
                    </View>

                    <View style={localStyles.setList}>
                      {session.sets.map((set: any, index: number) => (
                        <View
                          key={`${session.id}-${index}`}
                          style={localStyles.setRow}
                        >
                          <Text style={localStyles.setIndex}>
                            Set {index + 1}
                          </Text>
                          <Text style={localStyles.setValue}>
                            {formatSetSummary(set, session.isUnilateral)}
                            {parseRpeValue(set.rpe) !== null
                              ? ` · RPE ${formatRpeValue(set.rpe)}`
                              : ""}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {!!session.remark && (
                      <View style={localStyles.remarkBox}>
                        <Ionicons
                          name="chatbubble-ellipses-outline"
                          size={14}
                          color={Colors.textMuted}
                        />
                        <Text style={localStyles.remarkText}>
                          {session.remark}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </Modal>

      <SafeAreaView edges={["top"]} style={styles.headerContainer}>
        <View style={styles.headerContentFlex}>
          <View style={styles.headerSideBtn} />
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitleStatic}>Exercises</Text>
          </View>
          <View style={styles.headerRightActionGroup} />
        </View>
      </SafeAreaView>

      <View style={localStyles.topContent}>
        <View style={localStyles.searchContainer}>
          <Ionicons
            name="search"
            size={20}
            color={Colors.textMuted}
            style={localStyles.searchIcon}
          />
          <TextInput
            style={localStyles.searchInput}
            placeholder="Search exercises..."
            placeholderTextColor={Colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            clearButtonMode="while-editing"
            autoCorrect={false}
          />
        </View>

        <View style={localStyles.tabWrapper}>
          {(["All", "Favorites", "Recent", "Custom"] as const).map((view) => (
            <TouchableOpacity
              key={view}
              style={[
                localStyles.tab,
                libraryView === view && localStyles.activeTab,
              ]}
              onPress={() => setLibraryView(view)}
            >
              <Text
                style={[
                  localStyles.tabText,
                  libraryView === view && localStyles.activeTabText,
                ]}
              >
                {view}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {libraryView === "Custom" && (
          <TouchableOpacity
            style={localStyles.createCustomExerciseCard}
            activeOpacity={0.84}
            onPress={() => {
              if (personalExercises.length >= LIMITS.customExercisesPerUser) {
                setInfoAlert({
                  visible: true,
                  title: "Custom Exercise Limit Reached",
                  message: "You can save up to 100 custom exercises.",
                });
                return;
              }
              setEditingExName(null);
              setEditingMode("new");
              setNewName("");
              setNewMuscle(
                activeFilter === "All"
                  ? "Chest"
                  : normalizeExerciseMuscleGroup(activeFilter),
              );
              setNewIsUnilateral(false);
              setNewReminder("");
              setNewSupportsVariants(false);
              setIsExModalVisible(true);
            }}
          >
            <View style={localStyles.createCustomExerciseIcon}>
              <Ionicons name="add" size={22} color={Colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={localStyles.createCustomExerciseKicker}>
                CUSTOM EXERCISE
              </Text>
              <Text style={localStyles.createCustomExerciseTitle}>
                Create Custom Exercise
              </Text>
              <Text style={localStyles.createCustomExerciseSub}>
                Add a movement that is not in the library
              </Text>
            </View>
          </TouchableOpacity>
        )}

        <View style={localStyles.libraryStatsRow}>
          <View style={localStyles.libraryStatCard}>
            <Text style={localStyles.libraryStatValue}>
              {displayedExercises.length}
            </Text>
            <Text style={localStyles.libraryStatLabel}>Exercises</Text>
          </View>
          <View style={localStyles.libraryStatCard}>
            <Text style={localStyles.libraryStatValue}>
              {
                displayedExercises.filter(
                  (ex: any) => getExerciseCardStats(ex.name).hasHistory,
                ).length
              }
            </Text>
            <Text style={localStyles.libraryStatLabel}>Tracked</Text>
          </View>
          <View style={localStyles.libraryStatCard}>
            <Text style={localStyles.libraryStatValue}>
              {libraryView === "Custom"
                ? searchedExercises.length
                : trueCustomExercises.length}
            </Text>
            <Text style={localStyles.libraryStatLabel}>Custom</Text>
          </View>
        </View>
      </View>

      <View style={localStyles.filterBar}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20 }}
          data={["All", ...MUSCLE_GROUPS]}
          keyExtractor={(item) => item}
          renderItem={({ item: m }) => (
            <TouchableOpacity
              style={[
                localStyles.filterChip,
                activeFilter === m && localStyles.filterChipActive,
              ]}
              onPress={async () => {
                if (!uid) return;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setActiveFilter(m);
                await AsyncStorage.setItem(`@last_search_filter_${uid}`, m);
              }}
            >
              <Text
                style={[
                  localStyles.filterChipText,
                  activeFilter === m && localStyles.filterChipTextActive,
                ]}
              >
                {m}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      <View style={localStyles.resultSummaryRow}>
        <View style={localStyles.resultSummaryTextBlock}>
          <Text style={localStyles.resultSummaryTitle}>{resultCountLabel}</Text>
          <Text style={localStyles.resultSummarySub} numberOfLines={1}>
            {libraryContextLabel}
          </Text>
        </View>
        {hasActiveFilter && (
          <TouchableOpacity
            style={localStyles.clearFilterPill}
            activeOpacity={0.84}
            onPress={async () => {
              if (!uid) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveFilter("All");
              await AsyncStorage.setItem(`@last_search_filter_${uid}`, "All");
            }}
          >
            <Text style={localStyles.clearFilterText}>Clear filter</Text>
          </TouchableOpacity>
        )}
      </View>

      {isFetchingAPI && globalExercises.length === 0 ? (
        <View
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={{ color: Colors.textMuted, marginTop: 12 }}>
            Loading Exercise Library...
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          ref={sectionListRef}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 18,
            paddingTop: 8,
          }}
          stickySectionHeadersEnabled={false}
          keyExtractor={(item, idx) => item?.name + idx.toString()}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{title}</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const isCustomExercise = item.is_custom === true;
            const isFavorite = isExerciseFavorite(item);
            const cardStats = getExerciseCardStats(item.name);

            const openDetails = () => {
              setSelectedEx(item);
              setImageErrors((prev) => ({ ...prev, [item.name]: false }));
              setDetailVariantFilter("All");
              setDetailRange("90D");
              setDetailGymFilter("All");
              setDetailBrandFilter("All");
              setDetailAttachmentFilter("All");
              setIsDetailVisible(true);
            };

            const openCustomMenu = () => {
              if (!isCustomExercise) return;
              setMenuExercise(item);
              setIsMenuVisible(true);
            };

            return (
              <TouchableOpacity
                style={localStyles.exerciseCard}
                activeOpacity={0.84}
                onPress={openDetails}
                onLongPress={openCustomMenu}
              >
                {normalizeExerciseImageUrl(item.image) &&
                !imageErrors[item.name] ? (
                  <Image
                    source={{ uri: normalizeExerciseImageUrl(item.image)! }}
                    style={localStyles.exerciseImage}
                    contentFit="cover"
                    transition={200}
                    cachePolicy="disk"
                    onError={() =>
                      setImageErrors((prev) => ({ ...prev, [item.name]: true }))
                    }
                  />
                ) : (
                  <View style={localStyles.exerciseImageFallback}>
                    <Ionicons
                      name="barbell"
                      size={24}
                      color={Colors.textMuted}
                    />
                  </View>
                )}

                <View style={localStyles.exerciseContent}>
                  <Text style={localStyles.exerciseKicker}>
                    {formatLibraryLabel(
                      normalizeExerciseMuscleGroup(item.muscle),
                    )}
                  </Text>
                  <Text style={localStyles.exerciseTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text
                    style={[
                      localStyles.exerciseBestText,
                      !cardStats.hasHistory && localStyles.exerciseNoHistoryText,
                    ]}
                    numberOfLines={1}
                  >
                    {cardStats.bestText}
                  </Text>
                </View>

                <TouchableOpacity
                  style={localStyles.exerciseActionButton}
                  onPress={(event) => {
                    event.stopPropagation();
                    toggleFavoriteExercise(item);
                  }}
                >
                  <Ionicons
                    name={isFavorite ? "star" : "star-outline"}
                    size={24}
                    color={isFavorite ? Colors.accent : Colors.textMuted}
                  />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={localStyles.libraryEmptyCard}>
              <View style={localStyles.libraryEmptyIcon}>
                <Ionicons
                  name={
                    libraryView === "Favorites"
                      ? "star-outline"
                      : libraryView === "Recent"
                        ? "time-outline"
                        : libraryView === "Custom"
                          ? "create-outline"
                          : "search-outline"
                  }
                  size={26}
                  color={Colors.textMuted}
                />
              </View>
              <Text style={localStyles.libraryEmptyTitle}>
                {hasSearchQuery || hasActiveFilter
                  ? "No matching exercises"
                  : libraryView === "Custom"
                    ? "No custom exercises yet"
                    : libraryView === "Favorites"
                      ? "No favorites yet"
                      : libraryView === "Recent"
                        ? "No recent exercises yet"
                        : "No exercises found"}
              </Text>
              <Text style={localStyles.libraryEmptyText}>
                {hasSearchQuery || hasActiveFilter
                  ? `Try a shorter search${hasSearchQuery ? ` like "${searchQuery.trim().split(/\s+/)[0]}"` : ""}${hasActiveFilter ? ", or clear the muscle filter" : ""}.`
                  : libraryView === "Custom"
                    ? "Create your own exercise when it does not exist in the library."
                    : libraryView === "Favorites"
                      ? "Tap the star on exercises you use often to keep them here."
                      : libraryView === "Recent"
                        ? "Exercises will appear here after you log them in a workout."
                        : "Try a different search term or category filter."}
              </Text>
            </View>
          }
        />
      )}

      <BlockingOverlay
        visible={isExerciseBlocking}
        message={exerciseBlockingMessage}
      />
    </View>
  );
}

const localStyles = StyleSheet.create({
  libraryEmptyCard: {
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 22,
    marginTop: 22,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  libraryEmptyIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  libraryEmptyTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 7,
    textAlign: "center",
  },
  libraryEmptyText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    textAlign: "center",
  },
  headerAddButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(50, 215, 75, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.28)",
  },
  topContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
  },
  tabWrapper: {
    flexDirection: "row",
    marginTop: 14,
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 5,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: 12 },
  activeTab: { backgroundColor: Colors.borderStrong },
  tabText: { color: Colors.textMuted, fontWeight: "900", fontSize: 15 },
  activeTabText: { color: Colors.text },
  createCustomExerciseCard: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.32)",
    borderRadius: 24,
    padding: 16,
  },
  createCustomExerciseIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(50, 215, 75, 0.16)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  createCustomExerciseKicker: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.9,
    marginBottom: 3,
  },
  createCustomExerciseTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  createCustomExerciseSub: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  createModalOverlay: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  createModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  createModalCard: {
    maxHeight: "84%",
    borderRadius: 28,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  createModalHandle: {
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: Colors.borderStrong,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  createModalHeader: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 14,
  },
  createModalTitle: {
    color: Colors.text,
    fontSize: 25,
    fontWeight: "900",
    textAlign: "center",
  },
  createModalSubtitle: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center",
  },
  createModalBody: { paddingHorizontal: 24, paddingBottom: 18 },
  createSectionLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 10,
  },
  createInput: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    color: Colors.text,
    fontSize: 17,
    fontWeight: "800",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  createInputMultiline: {
    minHeight: 74,
    paddingTop: 15,
    textAlignVertical: "top",
    fontSize: 15,
    lineHeight: 20,
  },
  createChipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingBottom: 6,
  },
  createChip: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: Colors.cardAlt,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 0,
  },
  createChipActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  createChipText: { color: Colors.textMuted, fontSize: 14, fontWeight: "900" },
  createChipTextActive: { color: Colors.background },
  createModalFooter: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  createCancelButton: {
    flex: 1,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.cardAlt,
  },
  createCancelText: { color: Colors.text, fontSize: 16, fontWeight: "900" },
  createSaveButton: {
    flex: 1.35,
    height: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accent,
  },
  createSaveButtonDisabled: { opacity: 0.35 },
  createSaveText: { color: Colors.background, fontSize: 16, fontWeight: "900" },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 52,
    borderWidth: 1,
    borderColor: Colors.border,
  },

  detailScreen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  detailHeaderSafe: {
    backgroundColor: Colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.card,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  detailThumbnail: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: Colors.text,
    marginRight: 14,
  },
  detailThumbnailFallback: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  detailEyebrow: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 3,
  },
  detailTitle: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 28,
  },
  detailSubtitle: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  detailCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
  },
  detailContent: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 18,
  },
  rangeRow: {
    paddingBottom: 16,
  },
  rangeChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: Colors.card,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rangeChipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  rangeChipText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
  },
  rangeChipTextActive: {
    color: Colors.background,
  },
  detailFilterBlock: {
    marginBottom: 16,
  },
  detailSectionKicker: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  detailFilterRow: {
    paddingRight: 20,
  },
  smallFilterChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 8,
    maxWidth: 180,
  },
  smallFilterChipActive: {
    borderColor: "rgba(50, 215, 75, 0.55)",
    backgroundColor: "rgba(50, 215, 75, 0.16)",
  },
  smallFilterText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  smallFilterTextActive: {
    color: Colors.accent,
  },
  noStatsCard: {
    backgroundColor: "#111112",
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: Colors.card,
    alignItems: "center",
    marginTop: 8,
  },
  noStatsIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(50, 215, 75, 0.14)",
    marginBottom: 14,
  },
  noStatsTitle: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 8,
  },
  noStatsBody: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 18,
  },
  primaryDetailButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    alignSelf: "stretch",
  },
  primaryDetailButtonText: {
    color: Colors.background,
    fontSize: 15,
    fontWeight: "900",
    marginLeft: 8,
  },
  secondaryDetailButton: {
    minHeight: 46,
    borderRadius: 14,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    alignSelf: "stretch",
    marginTop: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryDetailButtonText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  overviewCard: {
    backgroundColor: "#111112",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.card,
    marginBottom: 14,
  },
  cardHeaderRowCompact: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  overviewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  overviewItem: {
    width: "48.5%",
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  overviewLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  overviewValue: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  strengthCard: {
    backgroundColor: "#111112",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.card,
    marginBottom: 14,
  },
  strengthRow: {
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: Colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  strengthMetric: {
    flex: 1,
    padding: 14,
  },
  strengthLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  strengthValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  strengthDivider: {
    width: 1,
    backgroundColor: Colors.border,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  exerciseStatCard: {
    width: "48.5%",
    backgroundColor: "#111112",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.card,
  },
  exerciseStatLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginBottom: 8,
  },
  exerciseStatValue: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  exerciseStatUnit: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
  },
  exerciseStatSubtext: {
    color: Colors.textSubtle,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 5,
  },
  trendCard: {
    backgroundColor: "#111112",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.card,
    marginBottom: 14,
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  cardTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  cardSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  trendEmptyBox: {
    height: 170,
    borderRadius: 18,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  trendEmptyTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 6,
  },
  trendEmptyText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 19,
  },
  barChartRow: {
    height: 190,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  detailBarWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    minWidth: 34,
  },
  detailBarValue: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
    marginBottom: 6,
  },
  detailBarTrack: {
    width: 20,
    height: 132,
    borderRadius: 10,
    backgroundColor: Colors.card,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  detailBarFill: {
    width: "100%",
    borderRadius: 10,
    backgroundColor: Colors.borderStrong,
  },
  detailBarFillBest: {
    backgroundColor: Colors.accent,
  },
  detailBarLabel: {
    color: Colors.textSubtle,
    fontSize: 10,
    fontWeight: "800",
    marginTop: 8,
    flex: 1,
    textAlign: "center",
  },
  chartModeRow: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: Radius.pill,
    padding: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chartModeChip: {
    flex: 1,
    minHeight: 34,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  chartModeChipActive: {
    backgroundColor: Colors.accent,
  },
  chartModeText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  chartModeTextActive: {
    color: Colors.background,
  },
  lineChartBlock: {
    paddingTop: 4,
  },
  lineChartCanvas: {
    alignSelf: "center",
    position: "relative",
    overflow: "visible",
    marginBottom: 12,
  },
  lineGrid: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  lineSegment: {
    position: "absolute",
    height: 3,
    borderRadius: 999,
    backgroundColor: Colors.accent,
    transformOrigin: "0px 1.5px",
  },
  linePointWrap: {
    position: "absolute",
    width: 38,
    alignItems: "center",
  },
  linePointValue: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    marginBottom: 4,
  },
  linePoint: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: Colors.background,
    borderWidth: 3,
    borderColor: Colors.accent,
  },
  linePointBest: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  lineLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  recordsCard: {
    backgroundColor: "#111112",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.card,
    marginBottom: 14,
  },
  recordsList: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    overflow: "hidden",
  },
  recordRow: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  recordRowLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  recordRowValue: {
    flex: 1,
    textAlign: "right",
    color: Colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  repRecordsBlock: {
    marginTop: 14,
  },
  repRecordsTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 10,
  },
  repRecordsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  repRecordChip: {
    width: "48.5%",
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 11,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  repRecordLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 5,
  },
  repRecordValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: "900",
  },
  recordsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  recordPill: {
    width: "48.5%",
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  recordLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  recordValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  highlightCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.22)",
    borderRadius: 18,
    padding: 14,
    marginBottom: 20,
  },
  highlightIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(50, 215, 75, 0.14)",
    marginRight: 12,
  },
  highlightTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  highlightText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  recentSectionHeader: {
    marginTop: 4,
    marginBottom: 12,
  },
  performanceCard: {
    backgroundColor: "#111112",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.card,
    marginBottom: 12,
  },
  performanceHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  performanceTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  performanceMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
    lineHeight: 17,
  },
  performancePill: {
    backgroundColor: Colors.card,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  performancePillText: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: "900",
  },
  setList: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  setRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  setIndex: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
  },
  setValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  remarkBox: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 10,
  },
  remarkText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginLeft: 8,
    flex: 1,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: Colors.text, fontSize: 16, fontWeight: "600" },
  libraryStatsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  libraryStatCard: {
    flex: 1,
    backgroundColor: "#111112",
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: Colors.card,
  },
  libraryStatValue: { color: Colors.text, fontSize: 20, fontWeight: "900" },
  libraryStatLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    marginTop: 4,
  },
  filterBar: { paddingBottom: 8 },
  resultSummaryRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  resultSummaryTextBlock: { flex: 1, minWidth: 0 },
  resultSummaryTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  resultSummarySub: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  clearFilterPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  clearFilterText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  filterChip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 10,
  },
  filterChipActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  filterChipText: { color: Colors.textMuted, fontSize: 14, fontWeight: "900" },
  filterChipTextActive: { color: Colors.background },
  exerciseCard: {
    height: 94,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  exerciseImage: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.text,
    marginRight: 14,
  },
  exerciseImageFallback: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  exerciseContent: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  exerciseTextBlock: { minWidth: 0 },
  exerciseKicker: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  exerciseTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  exerciseTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "900",
    minWidth: 0,
  },
  sourceBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: Colors.cardAlt,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sourceBadgeCustom: {
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    borderColor: "rgba(50, 215, 75, 0.28)",
  },
  sourceBadgeText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
  },
  sourceBadgeTextCustom: { color: Colors.accent },
  exerciseBestText: {
    color: "#D1D1D6",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 5,
  },
  exerciseTapHint: {
    color: Colors.textSubtle,
    fontSize: 12,
    fontWeight: "800",
    flex: 1,
    minWidth: 0,
  },
  exerciseNoHistoryText: { color: Colors.textMuted },
  exerciseMetaText: {
    color: Colors.textSubtle,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3,
  },
  exerciseBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  exerciseActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginLeft: 8,
  },
  exerciseActionButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    marginLeft: 10,
  },
  exerciseDetailsButton: {
    minWidth: 82,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(50,215,75,0.14)",
    borderWidth: 1,
    borderColor: "rgba(50,215,75,0.32)",
    paddingHorizontal: 14,
  },
  exerciseDetailsButtonText: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: "900",
  },
  exerciseAddButton: {
    paddingHorizontal: 14,
    backgroundColor: "rgba(50, 215, 75, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.32)",
  },
  exerciseAddButtonText: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: "900",
  },
  variantHelpText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
    marginBottom: 10,
  },
});
