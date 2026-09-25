import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  SectionList,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "../config/firebaseConfig";
import { styles } from "../constants/globalStyles";
import { Colors } from "../theme";
import { INITIAL_EXERCISES, MUSCLE_GROUPS } from "../constants/data";
import {
  prepareSections,
  fetchGitHubExercises,
  normalizeExerciseImageUrl,
  getExerciseVariationOptions,
  calculate1RM,
  isMachineBrandApplicable,
  normalizeExerciseMuscleGroup,
  getActiveBuiltInExercises,
  filterAndRankExercisesBySearch,
  getExerciseAttachmentForSave,
  getExerciseAttachmentOptions,
  normalizeExerciseForAttachmentStorage,
} from "../utils/helpers";
import {
  clearConfigValuesDeletedLocally,
  markConfigValuesDeletedLocally,
  safeJsonParse,
  syncFavoriteExercisesToCloud,
  syncPersonalExercisesToCloud,
} from "../utils/firebaseSync";
import CustomAlert from "../components/CustomAlert";
import { LIMITS, cleanLimitedText, limitText } from "../constants/limits";
import BlockingOverlay from "../components/BlockingOverlay";

export default function SearchScreen({ navigation, route }: any) {
  const [globalExercises, setGlobalExercises] = useState<any[]>([]);
  const [personalExercises, setPersonalExercises] = useState<any[]>([]);
  const [favoriteExerciseNames, setFavoriteExerciseNames] = useState<string[]>(
    [],
  );
  const [history, setHistory] = useState<any[]>([]);
  const [libraryView, setLibraryView] = useState<
    "All" | "Favorites" | "Recent" | "Custom"
  >("All");
  const [isFetchingAPI, setIsFetchingAPI] = useState(true);
  const [activeFilter, setActiveFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  const [isAddVisible, setIsAddVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMuscle, setNewMuscle] = useState("Chest");
  const [newReminder, setNewReminder] = useState("");
  const [newIsUnilateral, setNewIsUnilateral] = useState(false);
  const [newSupportsVariants, setNewSupportsVariants] = useState(false);
  const [editingCustomExercise, setEditingCustomExercise] = useState<any>(null);

  const [searchAlert, setSearchAlert] = useState({
    visible: false,
    exercise: null as any,
  });
  const [infoAlert, setInfoAlert] = useState({
    visible: false,
    title: "",
    message: "",
  });
  const [selectedDetailExercise, setSelectedDetailExercise] =
    useState<any>(null);
  const [isDetailVisible, setIsDetailVisible] = useState(false);
  const [multiSelectedExercises, setMultiSelectedExercises] = useState<any[]>(
    [],
  );
  const [searchBlockingMessage, setSearchBlockingMessage] = useState("");
  const searchBlockingRef = useRef(false);

  const isSearchBlocking = searchBlockingMessage.length > 0;

  const runSearchBlockingAction = async (
    message: string,
    action: () => Promise<void> | void,
  ) => {
    if (searchBlockingRef.current) return;

    searchBlockingRef.current = true;
    setSearchBlockingMessage(message);
    try {
      await action();
    } catch (error) {
      console.error("Search action failed:", error);
    } finally {
      searchBlockingRef.current = false;
      setSearchBlockingMessage("");
    }
  };

  const uid = auth.currentUser?.uid;
  const existingExercises: string[] = route.params?.existingExercises || [];
  const isReplaceMode = route.params?.mode === "replace";
  const isGymSwapMode = route.params?.mode === "gymSwap";
  const allowMultiSelect =
    route.params?.multiSelect === true && !isReplaceMode && !isGymSwapMode;
  const isExercisePickerFlow =
    !!route.params?.onSelect ||
    !!route.params?.onSelectMany ||
    allowMultiSelect ||
    isReplaceMode ||
    isGymSwapMode;
  const selectionContext =
    route.params?.selectionContext ||
    (isExercisePickerFlow ? "workout" : "library");
  const maxSelectable = Math.max(
    0,
    Number(
      route.params?.maxSelectable ??
        Math.max(0, LIMITS.exercisesPerWorkout - existingExercises.length),
    ),
  );
  const primaryActionLabel = isGymSwapMode
    ? "Use"
    : isReplaceMode
      ? "Replace"
      : "Add";
  const shouldResetFilterForPicker = isExercisePickerFlow;
  const shouldPersistSearchFilter = !shouldResetFilterForPicker;

  useEffect(() => {
    const loadData = async () => {
      if (!uid) return;
      setIsFetchingAPI(true);

      let loadedGlobalExercises: any[] = [];
      const cachedGlobal = await AsyncStorage.getItem(
        "@github_global_exercises",
      );
      if (cachedGlobal) {
        const parsedCachedGlobal = safeJsonParse(cachedGlobal, []);
        loadedGlobalExercises = Array.isArray(parsedCachedGlobal)
          ? parsedCachedGlobal
          : [];
        setGlobalExercises(loadedGlobalExercises);
        setIsFetchingAPI(false);
      }

      try {
        const fetchedData = await fetchGitHubExercises();
        if (fetchedData && fetchedData.length > 0) {
          loadedGlobalExercises = fetchedData;
          setGlobalExercises(fetchedData);
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

      const saved = await AsyncStorage.getItem(`@user_exercises_${uid}`);
      if (saved) {
        const parsedAll = safeJsonParse(saved, []);
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

      const savedFavorites = await AsyncStorage.getItem(
        `@favorite_exercises_${uid}`,
      );
      const savedHistory = await AsyncStorage.getItem(
        `@workout_history_${uid}`,
      );
      const savedFilter = await AsyncStorage.getItem(
        `@last_search_filter_${uid}`,
      );
      if (savedFavorites) {
        const parsedFavorites = safeJsonParse(savedFavorites, []);
        setFavoriteExerciseNames(
          Array.isArray(parsedFavorites) ? parsedFavorites.map(String) : [],
        );
      }
      if (savedHistory) {
        const parsedHistory = safeJsonParse(savedHistory, []);
        setHistory(Array.isArray(parsedHistory) ? parsedHistory : []);
      }
      setActiveFilter(shouldResetFilterForPicker ? "All" : savedFilter || "All");
    };

    loadData();
  }, [shouldResetFilterForPicker, uid]);

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

  const normalizeExistingExerciseName = (value: any) =>
    normalizeExerciseName(value);

  const isExistingExercise = (exercise: any) => {
    const key = getExerciseMatchKey(exercise);
    return existingExercises.some(
      (name) => normalizeExistingExerciseName(name) === key,
    );
  };

  const isMultiSelectedExercise = (exercise: any) => {
    const key = getExerciseMatchKey(exercise);
    return multiSelectedExercises.some(
      (selectedExercise) => getExerciseMatchKey(selectedExercise) === key,
    );
  };

  const getNormalizedSelectedExercise = (exercise: any) => ({
    ...exercise,
    muscle: normalizeExerciseMuscleGroup(exercise?.muscle),
  });

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

  const isExerciseFavorite = (exercise: any) => {
    const key = getExerciseMatchKey(exercise);
    return favoriteExerciseNames.some(
      (name) => getFavoriteMatchKey(name) === key,
    );
  };

  const saveFavoriteExerciseNames = async (nextFavorites: string[]) => {
    if (!uid) return;
    const byKey = new Map<string, string>();
    nextFavorites.forEach((name) => {
      const displayName = String(name || "").trim();
      const key = getFavoriteMatchKey(displayName);
      if (displayName && key && !byKey.has(key)) byKey.set(key, displayName);
    });
    const cleaned = Array.from(byKey.values());
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

  const toggleFavoriteExercise = async (exercise: any) => {
    const key = getExerciseMatchKey(exercise);
    const displayName = getExerciseKey(exercise);
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

  const parseWorkoutDate = (value: any) => {
    if (!value) return new Date(0);
    if (typeof value === "number") return new Date(value);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
  };

  const getCompletedSetsForExercise = (exercise: any) =>
    exercise?.sets?.filter((set: any) => set?.completed && !set?.isWarmup) ||
    [];

  const getRepsForSet = (exercise: any, set: any) => {
    if (exercise?.is_unilateral) {
      return Math.max(Number(set?.repsL || 0), Number(set?.repsR || 0));
    }
    return Number(set?.reps || 0);
  };

  const getSearchExerciseStats = (exercise: any) => {
    const target = getExerciseMatchKey(exercise);
    const performances: any[] = [];

    history.forEach((workout) => {
      const timestamp =
        Number(workout?.startedAt) ||
        Number(workout?.id) ||
        parseWorkoutDate(workout?.date).getTime();

      (workout?.fullWorkoutData || []).forEach((loggedExercise: any) => {
        if (getExerciseMatchKey(loggedExercise) !== target) return;

        const completedSets = getCompletedSetsForExercise(loggedExercise);
        if (!completedSets.length) return;

        let bestSet: any = null;
        let bestScore = -1;
        let volume = 0;

        completedSets.forEach((set: any) => {
          const weight = Number(set?.weight || 0);
          const reps = getRepsForSet(loggedExercise, set);
          volume += weight * reps;
          const score = weight * 1000 + reps;
          if (score > bestScore) {
            bestScore = score;
            bestSet = set;
          }
        });

        performances.push({
          workoutName: workout?.workoutName || "Workout",
          date: timestamp,
          bestSet,
          volume,
          setCount: completedSets.length,
          isKg: workout?.isKg !== false,
          isUnilateral: !!loggedExercise?.is_unilateral,
        });
      });
    });

    const sorted = performances.sort((a, b) => b.date - a.date);
    const latest = sorted[0] || null;
    let allTimeBest: any = null;
    let bestScore = -1;
    let maxEstimatedOneRM = 0;

    sorted.forEach((item) => {
      if (!item.bestSet) return;
      const weight = Number(item.bestSet?.weight || 0);
      const reps = item.isUnilateral
        ? Math.max(
            Number(item.bestSet?.repsL || 0),
            Number(item.bestSet?.repsR || 0),
          )
        : Number(item.bestSet?.reps || 0);
      const score = weight * 1000 + reps;
      if (score > bestScore) {
        bestScore = score;
        allTimeBest = item;
      }
      maxEstimatedOneRM = Math.max(
        maxEstimatedOneRM,
        calculate1RM(String(weight), String(reps)),
      );
    });

    return {
      performances: sorted,
      latest,
      allTimeBest,
      maxEstimatedOneRM,
      sessions: sorted.length,
      sets: sorted.reduce((sum, item) => sum + item.setCount, 0),
    };
  };

  const formatDetailDate = (timestamp: number) => {
    if (!timestamp) return "No date";
    return new Date(timestamp).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const formatDetailBestSet = (item: any) => {
    if (!item?.bestSet) return "No sets";
    const unit = item.isKg ? "kg" : "lbs";
    if (item.isUnilateral) {
      return `${item.bestSet.weight}${unit} × ${item.bestSet.repsL || 0}/${item.bestSet.repsR || 0}`;
    }
    return `${item.bestSet.weight}${unit} × ${item.bestSet.reps || 0}`;
  };

  const openExerciseDetail = (exercise: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedDetailExercise(exercise);
    setIsDetailVisible(true);
  };

  const closeExerciseDetail = () => {
    setIsDetailVisible(false);
    setSelectedDetailExercise(null);
  };

  const openEditCustomExercise = (exercise: any) => {
    if (!exercise?.is_custom) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingCustomExercise(exercise);
    setNewName(limitText(exercise?.name || "", LIMITS.nameChars));
    setNewMuscle(normalizeExerciseMuscleGroup(exercise?.muscle));
    setNewReminder(limitText(exercise?.reminder || "", LIMITS.cueChars));
    setNewIsUnilateral(!!exercise?.is_unilateral);
    setNewSupportsVariants(getExerciseVariationOptions(exercise).length > 0);
    setIsDetailVisible(false);
    setIsAddVisible(true);
  };

  const resetCustomExerciseForm = () => {
    setEditingCustomExercise(null);
    setNewName("");
    setNewReminder("");
    setNewIsUnilateral(false);
    setNewSupportsVariants(false);
  };

  const toggleMultiSelectedExercise = (exercise: any) => {
    if (!allowMultiSelect) return;

    if (isExistingExercise(exercise)) {
      setInfoAlert({
        visible: true,
        title: "Already Added",
        message: `This exercise is already in the ${selectionContext}.`,
      });
      return;
    }

    const key = getExerciseMatchKey(exercise);
    const alreadySelected = isMultiSelectedExercise(exercise);
    if (alreadySelected) {
      setMultiSelectedExercises((current) =>
        current.filter((item) => getExerciseMatchKey(item) !== key),
      );
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }

    if (multiSelectedExercises.length >= maxSelectable) {
      setInfoAlert({
        visible: true,
        title: "Exercise Limit Reached",
        message: `You can add ${maxSelectable} more exercise${maxSelectable === 1 ? "" : "s"} to this ${selectionContext}.`,
      });
      return;
    }

    setMultiSelectedExercises((current) => [
      ...current,
      getNormalizedSelectedExercise(exercise),
    ]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const submitMultiSelectedExercises = () => {
    if (!allowMultiSelect || multiSelectedExercises.length === 0) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (route.params?.onSelectMany) {
      route.params.onSelectMany(multiSelectedExercises);
    } else {
      multiSelectedExercises.forEach((exercise) => {
        route.params.onSelect(exercise);
      });
    }
    navigation.goBack();
  };

  const handleExerciseSelection = async (selectedEx: any) => {
    if (!uid) return;
    if (allowMultiSelect) {
      toggleMultiSelectedExercise(selectedEx);
      setIsDetailVisible(false);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    route.params.onSelect(getNormalizedSelectedExercise(selectedEx));
    navigation.goBack();
  };

  const saveCustomExercise = async () => {
    if (searchBlockingRef.current) return;
    const trimmed = cleanLimitedText(newName, LIMITS.nameChars);
    const finalReminder = cleanLimitedText(newReminder, LIMITS.cueChars);
    if (!uid || !trimmed) return;

    searchBlockingRef.current = true;
    setSearchBlockingMessage(
      editingCustomExercise ? "Saving changes..." : "Saving exercise...",
    );

    try {
      if (editingCustomExercise) {
        const updated = {
          ...editingCustomExercise,
          name: trimmed,
          muscle: normalizeExerciseMuscleGroup(newMuscle),
          reminder: finalReminder,
          is_unilateral: newIsUnilateral,
          supportsVariants: newSupportsVariants,
          variationOptions: newSupportsVariants
            ? ["Normal", "Paused", "Tempo"]
            : undefined,
          updatedAt: Date.now(),
        };

        const editingId = String(editingCustomExercise?.id || "");
        const editingName = getExerciseMatchKey(editingCustomExercise);
        const updatedPersonal = cleanStoredCustomExercises(
          personalExercises.map((exercise) => {
            const sameId =
              editingId && String(exercise?.id || "") === editingId;
            const sameName = getExerciseMatchKey(exercise) === editingName;
            return sameId || sameName ? updated : exercise;
          }),
          globalExercises,
        );

        setPersonalExercises(updatedPersonal);
        await AsyncStorage.setItem(
          `@user_exercises_${uid}`,
          JSON.stringify(updatedPersonal),
        );
        syncPersonalExercisesToCloud(updatedPersonal).catch((error) =>
          console.log("Custom exercise cloud sync delayed:", error),
        );
        setSelectedDetailExercise(updated);
        setIsAddVisible(false);
        resetCustomExerciseForm();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }

      if (personalExercises.length >= LIMITS.customExercisesPerUser) {
        setInfoAlert({
          visible: true,
          title: "Custom Exercise Limit Reached",
          message: "You can save up to 100 custom exercises.",
        });
        return;
      }

      const created = createCustomExerciseRecord({
        name: trimmed,
        muscle: normalizeExerciseMuscleGroup(newMuscle),
        reminder: finalReminder,
        is_unilateral: newIsUnilateral,
        supportsVariants: newSupportsVariants,
        variationOptions: newSupportsVariants
          ? ["Normal", "Paused", "Tempo"]
          : undefined,
      });

      const updatedPersonal = cleanStoredCustomExercises(
        [...personalExercises, created],
        globalExercises,
      );
      setPersonalExercises(updatedPersonal);
      await AsyncStorage.setItem(
        `@user_exercises_${uid}`,
        JSON.stringify(updatedPersonal),
      );
      syncPersonalExercisesToCloud(updatedPersonal).catch((error) =>
        console.log("Custom exercise cloud sync delayed:", error),
      );
      setIsAddVisible(false);
      resetCustomExerciseForm();
      handleExerciseSelection(created);
    } catch (error) {
      console.error("Custom exercise save failed:", error);
    } finally {
      searchBlockingRef.current = false;
      setSearchBlockingMessage("");
    }
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
      return unifiedExercises.filter((exercise) =>
        isExerciseFavorite(exercise),
      );
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

  const selectedCount = existingExercises.length;
  const hasSearchQuery = searchQuery.trim().length > 0;
  const hasActiveFilter = activeFilter !== "All";
  const resultCountLabel = `${searchedExercises.length} ${
    searchedExercises.length === 1 ? "exercise" : "exercises"
  }${hasActiveFilter ? ` in ${activeFilter}` : ""}`;
  const modeContextLabel = isGymSwapMode
    ? "Choose the exercise to use for this gym swap"
    : isReplaceMode
      ? "Choose one exercise to replace the current movement"
      : allowMultiSelect
        ? multiSelectedExercises.length > 0
          ? `${multiSelectedExercises.length} selected`
          : selectedCount > 0
            ? `${selectedCount} already in this ${selectionContext}`
            : "Select exercises, then add them together"
      : selectedCount > 0
        ? `${selectedCount} already in this workout`
        : hasSearchQuery
          ? "Best name matches appear first"
          : "Tap a card for details, or use + to insert quickly";

  return (
    <View style={localStyles.screen}>
      <CustomAlert
        visible={infoAlert.visible}
        title={infoAlert.title}
        message={infoAlert.message}
        buttons={[{ text: "OK" }]}
        onClose={() => setInfoAlert((prev) => ({ ...prev, visible: false }))}
      />
      <CustomAlert
        visible={searchAlert.visible}
        title="Create Custom Exercise?"
        message={`Add ${searchAlert.exercise?.name} as a custom exercise in your exercise library?`}
        buttons={[
          { text: "Cancel", style: "cancel" },
          {
            text: "Add",
            onPress: () =>
              runSearchBlockingAction("Saving exercise...", async () => {
                if (searchAlert.exercise && uid) {
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
                  const exerciseToAdd = createCustomExerciseRecord({
                    name: searchAlert.exercise.name,
                    muscle: normalizeExerciseMuscleGroup(
                      searchAlert.exercise.muscle,
                    ),
                    reminder: "",
                    is_unilateral: false,
                    supportsVariants: false,
                  });
                  const updatedPersonal = cleanStoredCustomExercises(
                    [...personalExercises, exerciseToAdd],
                    globalExercises,
                  );
                  setPersonalExercises(updatedPersonal);
                  await AsyncStorage.setItem(
                    `@user_exercises_${uid}`,
                    JSON.stringify(updatedPersonal),
                  );
                  syncPersonalExercisesToCloud(updatedPersonal).catch((error) =>
                    console.log("Custom exercise cloud sync delayed:", error),
                  );
                  setSearchAlert((prev) => ({ ...prev, visible: false }));
                  handleExerciseSelection(exerciseToAdd);
                }
              }),
          },
        ]}
        onClose={() => setSearchAlert((prev) => ({ ...prev, visible: false }))}
      />

      <SafeAreaView edges={["top"]} style={styles.headerContainer}>
        <View style={styles.headerContentFlex}>
          <TouchableOpacity
            style={styles.headerSideBtn}
            activeOpacity={0.75}
            onPress={() => navigation.goBack()}
          >
            <Text style={localStyles.headerCancelText} numberOfLines={1}>
              Cancel
            </Text>
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitleStatic}>
              {isGymSwapMode
                ? "Choose Exercise"
                : isReplaceMode
                  ? "Replace Exercise"
                  : allowMultiSelect
                    ? "Select Exercises"
                  : "Add Exercise"}
            </Text>
          </View>
          <View style={styles.headerRightActionGroup} />
        </View>
      </SafeAreaView>

      <Modal visible={isAddVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={localStyles.createModalOverlay}
        >
          <TouchableOpacity
            style={localStyles.createModalBackdrop}
            activeOpacity={1}
            onPress={() => {
              setIsAddVisible(false);
              resetCustomExerciseForm();
            }}
          />

          <View style={localStyles.createModalCard}>
            <View style={localStyles.createModalHandle} />
            <View style={localStyles.createModalHeader}>
              <View>
                <Text style={localStyles.createModalTitle}>
                  {editingCustomExercise ? "Edit Exercise" : "Create Exercise"}
                </Text>
                <Text style={localStyles.createModalSubtitle}>
                  {editingCustomExercise
                    ? "Update this custom movement across your exercise library."
                    : "Add a custom movement to your exercise library."}
                </Text>
              </View>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={localStyles.createModalBody}
            >
              <Text style={localStyles.createSectionLabel}>Basic Info</Text>
              <TextInput
                style={localStyles.createInput}
                value={newName}
                onChangeText={(value) =>
                  setNewName(limitText(value, LIMITS.nameChars))
                }
                maxLength={LIMITS.nameChars}
                placeholder="Exercise name"
                placeholderTextColor={Colors.textSubtle}
                selectionColor={Colors.accent}
                autoFocus
              />
              <TextInput
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
                multiline
              />

              <Text style={localStyles.createSectionLabel}>Exercise Type</Text>
              <View style={localStyles.createChipRow}>
                <TouchableOpacity
                  style={[
                    localStyles.createChip,
                    !newIsUnilateral && localStyles.createChipActive,
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

              <Text style={localStyles.createSectionLabel}>Variants</Text>
              <View style={localStyles.createChipRow}>
                <TouchableOpacity
                  style={[
                    localStyles.createChip,
                    !newSupportsVariants && localStyles.createChipActive,
                  ]}
                  onPress={() => setNewSupportsVariants(false)}
                >
                  <Text
                    style={[
                      localStyles.createChipText,
                      !newSupportsVariants && localStyles.createChipTextActive,
                    ]}
                  >
                    Off
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    localStyles.createChip,
                    newSupportsVariants && localStyles.createChipActive,
                  ]}
                  onPress={() => setNewSupportsVariants(true)}
                >
                  <Text
                    style={[
                      localStyles.createChipText,
                      newSupportsVariants && localStyles.createChipTextActive,
                    ]}
                  >
                    On
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={localStyles.createSectionLabel}>Muscle Group</Text>
              <View style={localStyles.createChipWrap}>
                {MUSCLE_GROUPS.map((muscle) => (
                  <TouchableOpacity
                    key={muscle}
                    style={[
                      localStyles.createChip,
                      newMuscle === muscle && localStyles.createChipActive,
                    ]}
                    onPress={() => setNewMuscle(muscle)}
                  >
                    <Text
                      style={[
                        localStyles.createChipText,
                        newMuscle === muscle &&
                          localStyles.createChipTextActive,
                      ]}
                    >
                      {muscle}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <View style={localStyles.createModalFooter}>
              <TouchableOpacity
                style={localStyles.createCancelButton}
                onPress={() => {
                  setIsAddVisible(false);
                  resetCustomExerciseForm();
                }}
              >
                <Text style={localStyles.createCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  localStyles.createSaveButton,
                  (!newName.trim() || isSearchBlocking) &&
                    localStyles.createSaveButtonDisabled,
                ]}
                disabled={!newName.trim() || isSearchBlocking}
                onPress={saveCustomExercise}
              >
                <Text style={localStyles.createSaveText}>
                  {editingCustomExercise ? "Save Changes" : "Save Exercise"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={isDetailVisible} transparent animationType="slide">
        <View style={localStyles.detailModalOverlay}>
          <TouchableOpacity
            style={localStyles.detailModalBackdrop}
            activeOpacity={1}
            onPress={closeExerciseDetail}
          />
          <View style={localStyles.detailModalCard}>
            <View style={localStyles.detailModalHandle} />
            <View style={localStyles.detailHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={localStyles.detailKicker}>
                  {formatLibraryLabel(
                    normalizeExerciseMuscleGroup(
                      selectedDetailExercise?.muscle,
                    ),
                  )}
                  {selectedDetailExercise?.is_custom ? " · Custom" : ""}
                </Text>
                <Text style={localStyles.detailTitle}>
                  {selectedDetailExercise?.name}
                </Text>
                <Text style={localStyles.detailSubtitle}>
                  {[
                    selectedDetailExercise?.equipment,
                    isMachineBrandApplicable(selectedDetailExercise)
                      ? "Machine brand tracked"
                      : null,
                  ]
                    .filter(Boolean)
                    .map(formatLibraryLabel)
                    .join(" · ") || "Exercise"}
                </Text>
              </View>
              <TouchableOpacity
                style={localStyles.detailCloseButton}
                onPress={closeExerciseDetail}
              >
                <Ionicons name="close" size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            {selectedDetailExercise &&
              (() => {
                const detailStats = getSearchExerciseStats(
                  selectedDetailExercise,
                );
                const recent = detailStats.performances.slice(0, 4);
                return (
                  <>
                    <View style={localStyles.detailStatsGrid}>
                      <View style={localStyles.detailStatBox}>
                        <Text style={localStyles.detailStatValue}>
                          {detailStats.sessions}
                        </Text>
                        <Text style={localStyles.detailStatLabel}>
                          Sessions
                        </Text>
                      </View>
                      <View style={localStyles.detailStatBox}>
                        <Text style={localStyles.detailStatValue}>
                          {detailStats.sets}
                        </Text>
                        <Text style={localStyles.detailStatLabel}>Sets</Text>
                      </View>
                      <View style={localStyles.detailStatBox}>
                        <Text
                          style={localStyles.detailStatValue}
                          numberOfLines={1}
                        >
                          {detailStats.allTimeBest
                            ? formatDetailBestSet(detailStats.allTimeBest)
                            : "—"}
                        </Text>
                        <Text style={localStyles.detailStatLabel}>
                          Best Set
                        </Text>
                      </View>
                      <View style={localStyles.detailStatBox}>
                        <Text style={localStyles.detailStatValue}>
                          {detailStats.maxEstimatedOneRM
                            ? `${detailStats.maxEstimatedOneRM}`
                            : "—"}
                        </Text>
                        <Text style={localStyles.detailStatLabel}>
                          Est. 1RM
                        </Text>
                      </View>
                    </View>

                    <View style={localStyles.detailRecentBlock}>
                      <Text style={localStyles.detailSectionTitle}>
                        Recent Performances
                      </Text>
                      {recent.length > 0 ? (
                        recent.map((item, index) => (
                          <View
                            key={`${item.date}-${index}`}
                            style={localStyles.detailPerformanceRow}
                          >
                            <View style={{ flex: 1 }}>
                              <Text
                                style={localStyles.detailPerformanceTitle}
                                numberOfLines={1}
                              >
                                {item.workoutName}
                              </Text>
                              <Text style={localStyles.detailPerformanceMeta}>
                                {formatDetailDate(item.date)} · {item.setCount}{" "}
                                {item.setCount === 1 ? "set" : "sets"}
                              </Text>
                            </View>
                            <Text
                              style={localStyles.detailPerformanceSet}
                              numberOfLines={1}
                            >
                              {formatDetailBestSet(item)}
                            </Text>
                          </View>
                        ))
                      ) : (
                        <View style={localStyles.detailEmptyState}>
                          <Ionicons
                            name="barbell-outline"
                            size={24}
                            color={Colors.textMuted}
                          />
                          <Text style={localStyles.detailEmptyTitle}>
                            No history yet
                          </Text>
                          <Text style={localStyles.detailEmptyBody}>
                            Add this exercise to a workout to start tracking
                            stats.
                          </Text>
                        </View>
                      )}
                    </View>
                  </>
                );
              })()}

            {(() => {
              const isAlreadyInWorkout =
                !!selectedDetailExercise &&
                isExistingExercise(selectedDetailExercise);
              const isSelectedForMulti =
                allowMultiSelect &&
                !!selectedDetailExercise &&
                isMultiSelectedExercise(selectedDetailExercise);
              const isPrimaryDisabled =
                !isReplaceMode && !isGymSwapMode && isAlreadyInWorkout;

              return (
                <>
                  {selectedDetailExercise?.is_custom && (
                    <TouchableOpacity
                      style={localStyles.detailSecondaryButton}
                      activeOpacity={0.84}
                      onPress={() =>
                        openEditCustomExercise(selectedDetailExercise)
                      }
                    >
                      <Ionicons
                        name="create-outline"
                        size={18}
                        color={Colors.accent}
                      />
                      <Text style={localStyles.detailSecondaryButtonText}>
                        Edit Custom Exercise
                      </Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[
                      localStyles.detailPrimaryButton,
                      isPrimaryDisabled &&
                        localStyles.detailPrimaryButtonDisabled,
                    ]}
                    disabled={isPrimaryDisabled}
                    onPress={() => {
                      if (selectedDetailExercise)
                        handleExerciseSelection(selectedDetailExercise);
                    }}
                  >
                    <Text style={localStyles.detailPrimaryButtonText}>
                      {isGymSwapMode
                        ? "Use Exercise"
                        : isReplaceMode
                          ? "Replace Exercise"
                          : allowMultiSelect
                            ? isAlreadyInWorkout
                              ? "Already Added"
                              : isSelectedForMulti
                                ? "Remove from Selection"
                                : "Select Exercise"
                          : isAlreadyInWorkout
                            ? "Already Added"
                            : "Add to Workout"}
                    </Text>
                  </TouchableOpacity>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      <View style={localStyles.controlsBlock}>
        <View style={localStyles.segmentWrapper}>
          {(["All", "Favorites", "Recent", "Custom"] as const).map((view) => (
            <TouchableOpacity
              key={view}
              style={[
                localStyles.segmentButton,
                libraryView === view && localStyles.segmentButtonActive,
              ]}
              onPress={() => setLibraryView(view)}
            >
              <Text
                style={[
                  localStyles.segmentText,
                  libraryView === view && localStyles.segmentTextActive,
                ]}
              >
                {view}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={localStyles.searchBar}>
          <Ionicons name="search" size={22} color={Colors.textMuted} />
          <TextInput
            style={localStyles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder={
              isReplaceMode
                ? "Search replacement exercise..."
                : isGymSwapMode
                  ? "Search gym swap exercise..."
                  : "Search exercises..."
            }
            placeholderTextColor={Colors.textMuted}
            selectionColor={Colors.accent}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Ionicons
                name="close-circle"
                size={20}
                color={Colors.textMuted}
              />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={localStyles.chipRow}
        >
          {["All", ...MUSCLE_GROUPS].map((muscle) => (
            <TouchableOpacity
              key={muscle}
              style={[
                localStyles.categoryChip,
                activeFilter === muscle && localStyles.categoryChipActive,
              ]}
              onPress={async () => {
                setActiveFilter(muscle);
                if (uid && shouldPersistSearchFilter)
                  await AsyncStorage.setItem(
                    `@last_search_filter_${uid}`,
                    muscle,
                  );
              }}
            >
              <Text
                style={[
                  localStyles.categoryChipText,
                  activeFilter === muscle && localStyles.categoryChipTextActive,
                ]}
              >
                {muscle}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={localStyles.resultSummaryRow}>
          <View style={localStyles.resultSummaryTextBlock}>
            <Text style={localStyles.resultSummaryTitle}>
              {resultCountLabel}
            </Text>
            <Text style={localStyles.resultSummarySub} numberOfLines={1}>
              {modeContextLabel}
            </Text>
          </View>
          {activeFilter !== "All" && (
            <TouchableOpacity
              style={localStyles.clearFilterPill}
              activeOpacity={0.8}
              onPress={async () => {
                setActiveFilter("All");
                if (uid && shouldPersistSearchFilter)
                  await AsyncStorage.setItem(
                    `@last_search_filter_${uid}`,
                    "All",
                  );
              }}
            >
              <Text style={localStyles.clearFilterText}>Clear filter</Text>
            </TouchableOpacity>
          )}
        </View>

        {libraryView === "Custom" && (
          <TouchableOpacity
            style={localStyles.createExerciseCard}
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
              setNewMuscle(
                activeFilter === "All"
                  ? "Chest"
                  : normalizeExerciseMuscleGroup(activeFilter),
              );
              setEditingCustomExercise(null);
              setIsAddVisible(true);
            }}
          >
            <View style={localStyles.createExerciseIcon}>
              <Ionicons name="add" size={22} color={Colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={localStyles.createExerciseKicker}>
                CUSTOM EXERCISE
              </Text>
              <Text style={localStyles.createExerciseTitle}>
                Create Custom Exercise
              </Text>
              <Text style={localStyles.createExerciseSub}>
                Add a movement that is not in the library
              </Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {isFetchingAPI && globalExercises.length === 0 ? (
        <View style={localStyles.loadingState}>
          <ActivityIndicator size="large" color={Colors.accent} />
          <Text style={localStyles.mutedText}>Loading Exercise Library...</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item, idx) => `${item?.name || "exercise"}-${idx}`}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={[
            localStyles.listContent,
            allowMultiSelect &&
              multiSelectedExercises.length > 0 &&
              localStyles.listContentWithFooter,
          ]}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{title}</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const isAlreadyAdded = isExistingExercise(item);
            const isFavorite = isExerciseFavorite(item);
            const isMultiSelected =
              allowMultiSelect && isMultiSelectedExercise(item);
            const imageUri = normalizeExerciseImageUrl(item.image);
            const isDirectAddDisabled =
              !isReplaceMode && !isGymSwapMode && isAlreadyAdded;

            return (
              <TouchableOpacity
                style={[
                  localStyles.exerciseCard,
                  isMultiSelected && localStyles.exerciseCardSelected,
                  isDirectAddDisabled && localStyles.exerciseCardDisabled,
                ]}
                activeOpacity={0.84}
                onPress={() => openExerciseDetail(item)}
              >
                {imageUri && !imageErrors[item.name] ? (
                  <Image
                    source={{ uri: imageUri }}
                    style={localStyles.exerciseImage}
                    transition={200}
                    cachePolicy="disk"
                    contentFit="cover"
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
                </View>

                <View style={localStyles.exerciseActionsColumn}>
                  <TouchableOpacity
                    style={localStyles.favoriteButton}
                    onPress={(event) => {
                      event.stopPropagation();
                      toggleFavoriteExercise(item);
                    }}
                  >
                    <Ionicons
                      name={isFavorite ? "star" : "star-outline"}
                      size={22}
                      color={isFavorite ? Colors.accent : Colors.textMuted}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      localStyles.addIndicator,
                      isReplaceMode && localStyles.replaceIndicator,
                      isGymSwapMode && localStyles.useIndicator,
                      isMultiSelected && localStyles.addIndicatorSelected,
                      isDirectAddDisabled && localStyles.addIndicatorDone,
                    ]}
                    disabled={isDirectAddDisabled}
                    accessibilityLabel={
                      isDirectAddDisabled ? "Already added" : primaryActionLabel
                    }
                    onPress={(event) => {
                      event.stopPropagation();
                      handleExerciseSelection(item);
                    }}
                  >
                    <Ionicons
                      name={
                        isDirectAddDisabled
                          ? "checkmark"
                          : isMultiSelected
                            ? "checkmark"
                          : isGymSwapMode
                            ? "checkmark"
                            : isReplaceMode
                              ? "swap-horizontal"
                              : "add"
                      }
                      size={isReplaceMode ? 19 : 21}
                      color={
                        isDirectAddDisabled
                          ? Colors.textMuted
                          : isMultiSelected
                            ? Colors.background
                            : Colors.accent
                      }
                    />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={localStyles.emptyState}>
              <Ionicons name="search" size={28} color={Colors.textMuted} />
              <Text style={localStyles.emptyTitle}>
                {hasSearchQuery || hasActiveFilter
                  ? "No matching exercises"
                  : libraryView === "Favorites"
                    ? "No favorites yet"
                    : libraryView === "Recent"
                      ? "No recent exercises yet"
                      : libraryView === "Custom"
                        ? "No custom exercises yet"
                        : "No exercises found"}
              </Text>
              <Text style={localStyles.emptyBody}>
                {hasSearchQuery || hasActiveFilter
                  ? `Try a shorter search${hasSearchQuery ? ` like "${searchQuery.trim().split(/\s+/)[0]}"` : ""}${hasActiveFilter ? ", or clear the muscle filter" : ""}.`
                  : libraryView === "Favorites"
                    ? "Favorite exercises from the library to find them faster during workouts."
                    : libraryView === "Recent"
                      ? "Exercises will appear here after you log them in a workout."
                      : libraryView === "Custom"
                        ? "Create a custom exercise when it does not exist in the library."
                        : "Try a different search term or category filter."}
              </Text>
            </View>
          }
        />
      )}

      {allowMultiSelect && multiSelectedExercises.length > 0 && (
        <SafeAreaView edges={["bottom"]} style={localStyles.multiSelectFooter}>
          <TouchableOpacity
            style={localStyles.multiSelectButton}
            activeOpacity={0.86}
            onPress={submitMultiSelectedExercises}
          >
            <Text style={localStyles.multiSelectButtonText}>
              Add {multiSelectedExercises.length} exercise
              {multiSelectedExercises.length === 1 ? "" : "s"}
            </Text>
          </TouchableOpacity>
        </SafeAreaView>
      )}

      <BlockingOverlay
        visible={isSearchBlocking}
        message={searchBlockingMessage}
      />
    </View>
  );
}

const localStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  headerCancelText: {
    color: Colors.danger,
    fontSize: 16,
    fontWeight: "700",
  },
  controlsBlock: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.card,
  },
  segmentWrapper: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 5,
    marginBottom: 16,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
  },
  segmentButtonActive: { backgroundColor: Colors.borderStrong },
  segmentText: { color: Colors.textMuted, fontSize: 15, fontWeight: "800" },
  segmentTextActive: { color: Colors.text },
  searchBar: {
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 17,
    fontWeight: "700",
    marginLeft: 10,
    paddingVertical: 8,
  },
  chipRow: { paddingRight: 20 },
  resultSummaryRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 12,
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
  categoryChip: {
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    marginRight: 10,
  },
  categoryChipActive: {
    backgroundColor: Colors.text,
    borderColor: Colors.text,
  },
  categoryChipText: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: "800",
  },
  categoryChipTextActive: { color: Colors.background },
  createExerciseCard: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.32)",
    borderRadius: 24,
    padding: 16,
  },
  createExerciseIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(50, 215, 75, 0.16)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  createExerciseKicker: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.9,
    marginBottom: 4,
  },
  createExerciseTitle: { color: Colors.text, fontSize: 20, fontWeight: "900" },
  createExerciseSub: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  listContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  listContentWithFooter: { paddingBottom: 112 },
  sectionTitle: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.7,
    marginBottom: 12,
    marginTop: 8,
  },
  exerciseCard: {
    height: 88,
    borderRadius: 22,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  exerciseCardSelected: {
    borderColor: "rgba(50,215,75,0.55)",
    backgroundColor: "rgba(50,215,75,0.1)",
  },
  exerciseCardDisabled: { opacity: 0.48 },
  exerciseImage: {
    width: 52,
    height: 52,
    borderRadius: 15,
    backgroundColor: Colors.border,
    marginRight: 13,
  },
  exerciseImageFallback: {
    width: 52,
    height: 52,
    borderRadius: 15,
    backgroundColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
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
    marginBottom: 5,
  },
  exerciseTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    marginBottom: 5,
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
  exerciseMeta: { color: Colors.textMuted, fontSize: 14, fontWeight: "700" },
  exerciseBottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  exerciseActionsColumn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    marginLeft: 10,
  },
  favoriteButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
  },
  addIndicator: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(50,215,75,0.14)",
    borderWidth: 1,
    borderColor: "rgba(50,215,75,0.35)",
  },
  addIndicatorSelected: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  replaceIndicator: {},
  useIndicator: {},
  addIndicatorDone: {
    backgroundColor: "transparent",
    borderColor: Colors.borderStrong,
  },
  addIndicatorText: { color: Colors.accent, fontSize: 13, fontWeight: "900" },
  addIndicatorDoneText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
  },
  detailModalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  detailModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  detailModalCard: {
    maxHeight: "88%",
    backgroundColor: Colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  detailModalHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: Colors.borderStrong,
    marginBottom: 16,
  },
  detailHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  detailKicker: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  detailTitle: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.4,
    marginBottom: 5,
  },
  detailSubtitle: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
  },
  detailCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  detailStatsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  },
  detailStatBox: {
    width: "48.5%",
    minHeight: 76,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    justifyContent: "center",
  },
  detailStatValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 4,
  },
  detailStatLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  detailRecentBlock: {
    marginBottom: 16,
  },
  detailSectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 10,
  },
  detailPerformanceRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 8,
  },
  detailPerformanceTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 3,
  },
  detailPerformanceMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  detailPerformanceSet: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: "900",
    marginLeft: 10,
    maxWidth: 112,
  },
  detailEmptyState: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
  },
  detailEmptyTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 8,
    marginBottom: 4,
  },
  detailEmptyBody: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 17,
  },
  detailSecondaryButton: {
    height: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.28)",
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    marginBottom: 10,
  },
  detailSecondaryButtonText: {
    color: Colors.accent,
    fontSize: 14,
    fontWeight: "900",
  },
  detailPrimaryButton: {
    height: 52,
    borderRadius: 16,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  detailPrimaryButtonDisabled: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  detailPrimaryButtonText: {
    color: Colors.background,
    fontSize: 15,
    fontWeight: "900",
  },
  loadingState: { flex: 1, alignItems: "center", justifyContent: "center" },
  mutedText: {
    color: Colors.textMuted,
    marginTop: 12,
    fontSize: 15,
    fontWeight: "700",
  },
  multiSelectFooter: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.card,
  },
  multiSelectButton: {
    minHeight: 58,
    borderRadius: 20,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  multiSelectButtonText: {
    color: Colors.background,
    fontSize: 17,
    fontWeight: "900",
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
  createChipRow: { flexDirection: "row", gap: 10, marginBottom: 4 },
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
  modalActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 18,
  },
  modalActionText: { color: Colors.text, fontSize: 17, fontWeight: "800" },
  emptyState: { alignItems: "center", paddingTop: 70, paddingHorizontal: 30 },
  emptyTitle: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 14,
  },
  emptyBody: {
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: 8,
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 21,
  },
});
