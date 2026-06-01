import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Modal,
  Alert,
  useWindowDimensions,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import ViewShot from "react-native-view-shot";
import * as MediaLibrary from "expo-media-library";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { usePreventRemove } from "@react-navigation/native";
import { auth } from "../config/firebaseConfig";
import { styles } from "../constants/globalStyles";
import {
  genId,
  calculate1RM,
  formatDuration,
  getExerciseVariationOptions,
  formatExerciseDisplayName,
  isMachineBrandApplicable,
  isFirstInSuperset,
  isLastInSuperset,
  getSupersetInfo,
  assignSuperset,
  removeSupersetFromExercise,
  buildReorderBlocks,
  flattenReorderBlocks,
} from "../utils/helpers";
import {
  detectWorkoutPRs,
  formatPRValue,
  formatPRSummaryLabel,
  getGroupedWorkoutPRs,
  getWorkoutPRDisplayCount,
} from "../utils/performance";
import { DEFAULT_PLATES_KG, DEFAULT_PLATES_LBS } from "../constants/data";
import {
  pushWorkoutToCloud,
  fetchConfigFromCloud,
  syncGymsToCloud,
  syncTemplatesToCloud,
} from "../utils/firebaseSync";
import CustomAlert from "../components/CustomAlert";
import DraggableFlatList from "react-native-draggable-flatlist";
import { GestureHandlerRootView } from "react-native-gesture-handler";

Notifications.setNotificationHandler({
  handleNotification: async () =>
    ({
      shouldShowAlert: false,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }) as Notifications.NotificationBehavior,
});

const DEFAULT_VARIANTS = [
  "Precor",
  "Hammer Strength",
  "Technogym",
  "Life Fitness",
];

const startOfLocalDay = (value: number): number => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const formatWorkoutLogDate = (value: number): string => {
  return new Date(startOfLocalDay(value)).toLocaleDateString();
};

const formatRestClock = (totalSeconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const REORDER_DRAG_ANIMATION_CONFIG = {
  damping: 80,
  mass: 0.12,
  stiffness: 900,
  overshootClamping: true,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 0.01,
};

export default function WorkoutScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [isLoaded, setIsLoaded] = useState(false);
  const [exercises, setExercises] = useState<any[]>([]);
  const [isKg, setIsKg] = useState(false);
  const [workoutName, setWorkoutName] = useState("New Session");
  const [startTimeMs, setStartTimeMs] = useState<number | null>(null);
  const [workoutDurationStr, setWorkoutDurationStr] = useState("0m 0s");
  const [timerEndTime, setTimerEndTime] = useState<number | null>(null);
  const [displayRestTime, setDisplayRestTime] = useState(0);

  const [sessionRestEnabled, setSessionRestEnabled] = useState(true);
  const [sessionRestDuration, setSessionRestDuration] = useState("90");
  const [isSessionMenuVisible, setIsSessionMenuVisible] = useState(false);
  const [isAutoCheckEnabled, setIsAutoCheckEnabled] = useState(false);
  const [isPlateCalcEnabled, setIsPlateCalcEnabled] = useState(true);
  const [availablePlates, setAvailablePlates] = useState<number[]>([]);
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [isDraggingExercise, setIsDraggingExercise] = useState(false);
  const [isReorderModalVisible, setIsReorderModalVisible] = useState(false);
  const [reorderDraftExercises, setReorderDraftExercises] = useState<any[]>([]);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

  const isEditing = !!route.params?.editData;
  const [isEditable, setIsEditable] = useState(!isEditing);

  const [isExerciseMenuVisible, setIsExerciseMenuVisible] = useState(false);
  const [selectedExerciseIndex, setSelectedExerciseIndex] = useState<
    number | null
  >(null);
  const [isSupersetModalVisible, setIsSupersetModalVisible] = useState(false);
  const [supersetSelectedIndexes, setSupersetSelectedIndexes] = useState<
    number[]
  >([]);
  const [isHistoryModalVisible, setIsHistoryModalVisible] = useState(false);
  const [historyExerciseName, setHistoryExerciseName] = useState<string | null>(
    null,
  );
  const [historyExerciseContext, setHistoryExerciseContext] = useState<
    any | null
  >(null);
  const [exerciseHistoryData, setExerciseHistoryData] = useState<any[]>([]);
  const [historyGymFilter, setHistoryGymFilter] = useState<string | null>(null);
  const [historyBrandFilter, setHistoryBrandFilter] = useState<string | null>(
    null,
  );
  const [historyBrandOptions, setHistoryBrandOptions] = useState<string[]>([]);
  const [historyGymOptions, setHistoryGymOptions] = useState<
    { id: string; name: string }[]
  >([]);

  const [isRemarkModalVisible, setIsRemarkModalVisible] = useState(false);
  const [currentRemark, setCurrentRemark] = useState("");
  const [isSummaryVisible, setIsSummaryVisible] = useState(false);
  const [summaryType, setSummaryType] = useState<"finish" | "share">("finish");
  const [completedWorkoutData, setCompletedWorkoutData] = useState<any>(null);
  const [templateNamePrompt, setTemplateNamePrompt] = useState({
    visible: false,
    title: "",
    message: "",
    sourceExercises: [] as any[],
  });
  const [templateNameInput, setTemplateNameInput] = useState("");

  const [activeTemplate, setActiveTemplate] = useState<any>(null);
  const [isDiffModalVisible, setIsDiffModalVisible] = useState(false);
  const [isPlateCalcVisible, setIsPlateCalcVisible] = useState(false);
  const [calcTarget, setCalcTarget] = useState("");
  const [calcBar, setCalcBar] = useState("20");
  const [plateInventory, setPlateInventory] = useState<
    Record<number, number | null>
  >({});

  const [isPreFlightVisible, setIsPreFlightVisible] = useState(false);
  const [isChangingLocation, setIsChangingLocation] = useState(false);
  const [gyms, setGyms] = useState<any[]>([]);
  const [selectedGymId, setSelectedGymId] = useState<string | null>(null);
  const [globalVariants, setGlobalVariants] = useState<string[]>([]);

  const [isTagModalVisible, setIsTagModalVisible] = useState(false);
  const [tagExIdx, setTagExIdx] = useState<number | null>(null);
  const [tagSearchQuery, setTagSearchQuery] = useState("");

  const igCardRef = useRef<any>(null);
  const [initialStateStr, setInitialStateStr] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const saveTimeoutRef = useRef<any>(null);
  const restNotificationIdRef = useRef<string | null>(null);
  const sessionRestEnabledRef = useRef(sessionRestEnabled);
  const sessionRestDurationRef = useRef(sessionRestDuration);
  const finishWorkoutInFlightRef = useRef(false);

  const templateActionTaken = useRef(false);
  const diffActionTaken = useRef(false);
  const incompleteActionTaken = useRef(false);
  const workoutFinalizedRef = useRef(false);

  const [infoAlert, setInfoAlert] = useState({
    visible: false,
    title: "",
    message: "",
    onCloseAction: () => {},
  });
  const [navAlert, setNavAlert] = useState<{
    visible: boolean;
    type: "leave" | "save";
    action: any;
  }>({ visible: false, type: "leave", action: null });
  const [incompleteFinishAlert, setIncompleteFinishAlert] = useState({
    visible: false,
    navAction: null as any,
  });
  const [templateAlertVisible, setTemplateAlertVisible] = useState(false);
  const [diffAlertVisible, setDiffAlertVisible] = useState(false);
  const [removeSetAlert, setRemoveSetAlert] = useState({
    visible: false,
    exIdx: -1,
    setId: "",
    isWarmup: false,
  });

  const showInfo = (
    title: string,
    message: string,
    onCloseAction?: () => void,
  ) => {
    setInfoAlert({
      visible: true,
      title,
      message,
      onCloseAction: onCloseAction || (() => {}),
    });
  };

  const uid = auth.currentUser?.uid;

  useEffect(() => {
    sessionRestEnabledRef.current = sessionRestEnabled;
  }, [sessionRestEnabled]);

  useEffect(() => {
    sessionRestDurationRef.current = sessionRestDuration;
  }, [sessionRestDuration]);

  const buildTemplateExercisesFromWorkout = (sourceExercises: any[]) => {
    return sourceExercises
      .map((ex, idx) => ({
        ...ex,
        sets: (ex.sets || []).filter((s: any) =>
          ex.is_unilateral
            ? s.completed &&
              String(s.weight || "").trim() !== "" &&
              String(s.repsL || "").trim() !== "" &&
              String(s.repsR || "").trim() !== ""
            : s.completed &&
              String(s.weight || "").trim() !== "" &&
              String(s.reps || "").trim() !== "",
        ),
      }))
      .filter((ex) => ex.sets.length > 0)
      .map((ex, idx) => ({
        id: genId(`ex-${idx}-`),
        name: ex.name || "Exercise",
        reminder: ex.reminder || "",
        exerciseVariant: ex.exerciseVariant || "Normal",
        variationOptions: ex.variationOptions,
        is_unilateral: !!ex.is_unilateral,
        supersetId: ex.supersetId || null,
        supersetOrder: ex.supersetOrder,
        sets: ex.sets.map((s: any) => ({ isWarmup: !!s.isWarmup })),
      }));
  };

  const getUniqueTemplateName = (
    preferredName: string,
    templates: any[],
    excludeId?: string | null,
  ) => {
    const baseName = preferredName.trim() || "New Template";
    const exists = (candidate: string) =>
      templates.some(
        (t: any) =>
          t?.id !== excludeId &&
          String(t?.name || "")
            .trim()
            .toLowerCase() === candidate.trim().toLowerCase(),
      );

    if (!exists(baseName)) {
      return { name: baseName, wasAdjusted: false };
    }

    let count = 2;
    let candidate = `${baseName} (New)`;
    while (exists(candidate)) {
      candidate = `${baseName} (New ${count})`;
      count += 1;
    }
    return { name: candidate, wasAdjusted: true };
  };

  const getSuggestedNewTemplateName = () => {
    const baseName =
      String(activeTemplate?.name || workoutName || "New Template").trim() ||
      "New Template";
    return activeTemplate?.id ? `${baseName} (New)` : baseName;
  };

  const saveWorkoutAsNewTemplate = async (
    sourceExercises: any[],
    preferredName?: string,
  ) => {
    if (!uid) return null;

    const rawTemplates = await AsyncStorage.getItem(
      `@workout_templates_${uid}`,
    );
    const existingTemplates = rawTemplates
      ? JSON.parse(rawTemplates).filter(Boolean)
      : [];
    const { name: finalTemplateName, wasAdjusted } = getUniqueTemplateName(
      preferredName || getSuggestedNewTemplateName(),
      existingTemplates,
    );

    const templateExercises =
      buildTemplateExercisesFromWorkout(sourceExercises);
    if (templateExercises.length === 0) return null;

    const newTemplate = {
      id: genId("tpl-"),
      name: finalTemplateName,
      exercises: templateExercises,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const updatedTemplates = [...existingTemplates, newTemplate];
    await AsyncStorage.setItem(
      `@workout_templates_${uid}`,
      JSON.stringify(updatedTemplates),
    );
    try {
      await syncTemplatesToCloud(updatedTemplates);
    } catch (e) {
      console.log("Cloud routine backup delayed.", e);
    }

    return {
      template: newTemplate,
      wasAdjusted,
      originalName:
        (preferredName || getSuggestedNewTemplateName()).trim() ||
        "New Template",
    };
  };

  const updateOriginalTemplateFromWorkout = async (sourceExercises: any[]) => {
    if (!uid || !activeTemplate?.id) return null;

    const rawTemplates = await AsyncStorage.getItem(
      `@workout_templates_${uid}`,
    );
    const existingTemplates = rawTemplates
      ? JSON.parse(rawTemplates).filter(Boolean)
      : [];
    const originalIndex = existingTemplates.findIndex(
      (t: any) => t.id === activeTemplate.id,
    );
    if (originalIndex === -1) return null;

    const templateExercises =
      buildTemplateExercisesFromWorkout(sourceExercises);
    if (templateExercises.length === 0) return null;

    const updatedTemplate = {
      ...existingTemplates[originalIndex],
      name: workoutName.trim() || existingTemplates[originalIndex].name,
      exercises: templateExercises,
      updatedAt: Date.now(),
    };

    const updatedTemplates = [...existingTemplates];
    updatedTemplates[originalIndex] = updatedTemplate;

    await AsyncStorage.setItem(
      `@workout_templates_${uid}`,
      JSON.stringify(updatedTemplates),
    );
    try {
      await syncTemplatesToCloud(updatedTemplates);
    } catch (e) {
      console.log("Cloud routine backup delayed.", e);
    }

    setActiveTemplate(updatedTemplate);
    return updatedTemplate;
  };

  const openFinishSummary = () => {
    setTemplateNamePrompt((prev) => ({ ...prev, visible: false }));
    setSummaryType("finish");
    setIsSummaryVisible(true);
  };

  const openTemplateNamePrompt = (
    sourceExercises: any[],
    title = "New Template Name",
    message = "Name the new template before saving it.",
  ) => {
    setTemplateNameInput(getSuggestedNewTemplateName());
    setTemplateNamePrompt({
      visible: true,
      title,
      message,
      sourceExercises,
    });
  };

  const confirmTemplateNamePrompt = async () => {
    const preferredName = templateNameInput.trim();
    if (!preferredName) {
      showInfo(
        "Template Name Required",
        "Please enter a name for the template.",
      );
      return;
    }

    const result = await saveWorkoutAsNewTemplate(
      templateNamePrompt.sourceExercises,
      preferredName,
    );

    setTemplateNamePrompt((prev) => ({ ...prev, visible: false }));

    setTimeout(() => {
      if (result?.wasAdjusted) {
        showInfo(
          "Template Saved",
          `A template named "${result.originalName}" already exists, so this one was saved as "${result.template.name}".`,
          openFinishSummary,
        );
      } else {
        openFinishSummary();
      }
    }, 250);
  };

  const clearRestTimerNotification = async (clearAllScheduled = false) => {
    try {
      if (restNotificationIdRef.current) {
        await Notifications.cancelScheduledNotificationAsync(
          restNotificationIdRef.current,
        );
        restNotificationIdRef.current = null;
      }

      if (clearAllScheduled) {
        await Notifications.cancelAllScheduledNotificationsAsync();
      }
    } catch (error) {
      console.log("Unable to clear rest timer notification:", error);
    }
  };

  const scheduleRestNotification = async (seconds: number) => {
    if (isEditing) return;
    await clearRestTimerNotification(true);
    if (seconds <= 0) return;

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Rest Over!",
        body: "Time for your next set. Let's go!",
        sound: true,
        data: { type: "REST_TIMER_COMPLETE", screen: "Workout" },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: seconds,
      },
    });

    restNotificationIdRef.current = notificationId;
  };

  useEffect(() => {
    (async () => {
      workoutFinalizedRef.current = false;
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== "granted") await Notifications.requestPermissionsAsync();
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("beforeRemove", () => {
      if (!isEditing && !isFinishing && exercises.length === 0 && uid) {
        AsyncStorage.removeItem(`@active_session_${uid}`);
        AsyncStorage.removeItem(`@active_workout_start_${uid}`);
        clearRestTimerNotification(true);
      }
    });
    return unsubscribe;
  }, [navigation, isEditing, isFinishing, exercises.length, uid]);

  const initializeSets = (exercisesList: any[]) => {
    return exercisesList.map((ex, exIdx) => ({
      ...ex,
      id: ex.id || genId(`ex-${exIdx}-`),
      sets:
        ex.sets?.map((s: any, sIdx: number) => ({
          ...s,
          id: s.id || genId(`set-${exIdx}-${sIdx}-`),
          repsL: s.repsL || "",
          repsR: s.repsR || "",
          createdAt: s.createdAt || Date.now() + sIdx,
        })) || [],
    }));
  };

  const saveActiveSessionSnapshot = async (overrides: any = {}) => {
    if (
      !uid ||
      isEditing ||
      isFinishing ||
      isPreFlightVisible ||
      workoutFinalizedRef.current
    )
      return;

    const snapshotExercises = overrides.exercises ?? exercises;
    if (!snapshotExercises || snapshotExercises.length === 0) {
      await AsyncStorage.removeItem(`@active_session_${uid}`);
      return;
    }

    await AsyncStorage.setItem(
      `@active_session_${uid}`,
      JSON.stringify({
        exercises: snapshotExercises,
        workoutName: overrides.workoutName ?? workoutName,
        gymId: overrides.gymId ?? selectedGymId,
        templateData: overrides.templateData ?? activeTemplate,
        sessionRestEnabled: overrides.sessionRestEnabled ?? sessionRestEnabled,
        sessionRestDuration:
          overrides.sessionRestDuration ?? sessionRestDuration,
        timerEndTime: overrides.timerEndTime ?? timerEndTime,
        timestamp: Date.now(),
      }),
    );
  };

  const openReorderModal = () => {
    if (!isEditable || exercises.length < 2) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setReorderDraftExercises(buildReorderBlocks(exercises));
    setIsSessionMenuVisible(false);
    setIsReorderModalVisible(true);
  };

  const cancelReorderModal = () => {
    setIsReorderModalVisible(false);
    setReorderDraftExercises([]);
  };

  const applyReorderModal = () => {
    setExercises(flattenReorderBlocks(reorderDraftExercises));
    setHasUnsavedChanges(true);
    setIsReorderModalVisible(false);
    setReorderDraftExercises([]);
  };

  const openCreateSupersetModal = () => {
    if (selectedExerciseIndex === null) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSupersetSelectedIndexes([selectedExerciseIndex]);
    setIsExerciseMenuVisible(false);
    setIsSupersetModalVisible(true);
  };

  const createSupersetFromSelection = () => {
    if (supersetSelectedIndexes.length < 2) {
      showInfo(
        "Select Exercises",
        "Choose at least one more exercise to create a superset.",
      );
      return;
    }
    setExercises((prev) => assignSuperset(prev, supersetSelectedIndexes));
    setHasUnsavedChanges(true);
    setIsSupersetModalVisible(false);
    setSupersetSelectedIndexes([]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const removeSelectedSuperset = () => {
    if (selectedExerciseIndex === null) return;
    setExercises((prev) =>
      removeSupersetFromExercise(prev, selectedExerciseIndex),
    );
    setHasUnsavedChanges(true);
    setIsExerciseMenuVisible(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const shouldStartRestForExercise = (
    exerciseIndex: number,
    exerciseList: any[] = exercises,
  ) => {
    return isLastInSuperset(exerciseList, exerciseIndex);
  };

  const startRestTimerForCompletedSet = (
    exerciseIndex: number,
    completedSet: any,
    exerciseList: any[] = exercises,
  ) => {
    if (isEditing) return;
    if (!sessionRestEnabledRef.current) return;
    if (completedSet?.isWarmup) return;
    if (!shouldStartRestForExercise(exerciseIndex, exerciseList)) return;

    const parsedSeconds = parseInt(sessionRestDurationRef.current || "90", 10);
    const restSeconds =
      Number.isFinite(parsedSeconds) && parsedSeconds > 0 ? parsedSeconds : 90;
    const nextEndTime = Date.now() + restSeconds * 1000;

    setTimerEndTime(nextEndTime);
    setDisplayRestTime(restSeconds);
    scheduleRestNotification(restSeconds);
    saveActiveSessionSnapshot({ timerEndTime: nextEndTime }).catch((error) => {
      console.log("Unable to persist rest timer state:", error);
    });
  };

  const toggleSessionRestTimer = async () => {
    if (isEditing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextEnabled = !sessionRestEnabledRef.current;
    sessionRestEnabledRef.current = nextEnabled;
    setSessionRestEnabled(nextEnabled);

    if (!nextEnabled) {
      setTimerEndTime(null);
      setDisplayRestTime(0);
      await clearRestTimerNotification(true);
    }

    await saveActiveSessionSnapshot({
      sessionRestEnabled: nextEnabled,
      timerEndTime: nextEnabled ? timerEndTime : null,
    });
  };

  const getAutoFilledExercise = async (ex: any, gymId: string | null) => {
    if (!isMachineBrandApplicable(ex)) {
      const { equipmentTag, machineBrand, ...cleaned } = ex;
      return cleaned;
    }

    if (ex.equipmentTag) return ex;

    const selectedGym = gyms.find((g) => g.id === gymId);
    const gymDefaultBrand = selectedGym?.defaultMachineBrand || null;

    if (!gymId || !uid) {
      if (ex.brand) return { ...ex, equipmentTag: ex.brand };
      return gymDefaultBrand ? { ...ex, equipmentTag: gymDefaultBrand } : ex;
    }

    const historyRaw = await AsyncStorage.getItem(`@workout_history_${uid}`);
    if (historyRaw) {
      const historyList = JSON.parse(historyRaw)
        .filter((w: any) => w.gymId === gymId)
        .sort((a: any, b: any) => parseInt(b.id) - parseInt(a.id));

      for (const pastWorkout of historyList) {
        const pastEx = pastWorkout.fullWorkoutData?.find(
          (e: any) => e.name === ex.name,
        );
        if (pastEx && isMachineBrandApplicable(pastEx) && pastEx.equipmentTag) {
          return { ...ex, equipmentTag: pastEx.equipmentTag };
        }
      }
    }

    if (ex.brand) {
      return { ...ex, equipmentTag: ex.brand };
    }

    if (gymDefaultBrand) {
      return { ...ex, equipmentTag: gymDefaultBrand };
    }

    return ex;
  };

  useEffect(() => {
    (async () => {
      if (!uid) return;
      const pref = await AsyncStorage.getItem(`@user_metric_${uid}`);
      const usingKg = pref === "KG";
      setIsKg(usingKg);
      setCalcBar(usingKg ? "20" : "45");

      const te = await AsyncStorage.getItem(`@rest_timer_enabled_${uid}`);
      const loadedRestEnabled = te !== "false";
      sessionRestEnabledRef.current = loadedRestEnabled;
      setSessionRestEnabled(loadedRestEnabled);
      const storedRest = await AsyncStorage.getItem(`@rest_time_${uid}`);
      const loadedRestDuration = storedRest || "90";
      sessionRestDurationRef.current = loadedRestDuration;
      setSessionRestDuration(loadedRestDuration);

      const ac = await AsyncStorage.getItem(`@auto_check_enabled_${uid}`);
      setIsAutoCheckEnabled(ac === "true");
      const pc = await AsyncStorage.getItem(`@plate_calc_enabled_${uid}`);
      setIsPlateCalcEnabled(pc !== "false");

      const pkg = await AsyncStorage.getItem(`@plates_kg_${uid}`);
      const plbs = await AsyncStorage.getItem(`@plates_lbs_${uid}`);
      setAvailablePlates(
        usingKg
          ? pkg
            ? JSON.parse(pkg)
            : DEFAULT_PLATES_KG
          : plbs
            ? JSON.parse(plbs)
            : DEFAULT_PLATES_LBS,
      );

      const storedInv = await AsyncStorage.getItem(`@plate_inventory_${uid}`);
      if (storedInv) setPlateInventory(JSON.parse(storedInv));

      const savedGyms = await AsyncStorage.getItem(`@user_gyms_${uid}`);
      let loadedGyms = savedGyms ? JSON.parse(savedGyms) : [];
      if (loadedGyms.length === 0) {
        const cloudGyms = await fetchConfigFromCloud("gyms");
        if (cloudGyms) loadedGyms = cloudGyms;
      }
      setGyms(loadedGyms);

      const savedGlobalVars = await AsyncStorage.getItem(
        `@global_variants_${uid}`,
      );
      if (savedGlobalVars) {
        setGlobalVariants(JSON.parse(savedGlobalVars));
      } else {
        const cloudVars = await fetchConfigFromCloud("global_variants" as any);
        if (cloudVars) setGlobalVariants(cloudVars);
      }

      const activeSession = await AsyncStorage.getItem(
        `@active_session_${uid}`,
      );

      if (route.params?.editData) {
        const loadedEx = initializeSets(
          route.params.editData.fullWorkoutData || [],
        );
        setExercises(loadedEx);
        setWorkoutName(route.params.editData.workoutName || "Edit Session");
        setInitialStateStr(
          JSON.stringify({
            exercises: loadedEx,
            workoutName: route.params.editData.workoutName,
          }),
        );
        setHasUnsavedChanges(false);
        if (route.params.editData.duration)
          setWorkoutDurationStr(route.params.editData.duration);
        setSelectedGymId(route.params.editData.gymId || null);
      } else if (activeSession) {
        const parsed = JSON.parse(activeSession);
        setExercises(initializeSets(parsed.exercises || []));
        setWorkoutName(parsed.workoutName || "New Session");
        if (parsed.templateData) setActiveTemplate(parsed.templateData);
        if (parsed.gymId) setSelectedGymId(parsed.gymId);
        if (typeof parsed.sessionRestEnabled === "boolean") {
          sessionRestEnabledRef.current = parsed.sessionRestEnabled;
          setSessionRestEnabled(parsed.sessionRestEnabled);
        }
        if (parsed.sessionRestDuration) {
          sessionRestDurationRef.current = parsed.sessionRestDuration;
          setSessionRestDuration(parsed.sessionRestDuration);
        }
        if (parsed.timerEndTime && parsed.timerEndTime > Date.now()) {
          setTimerEndTime(parsed.timerEndTime);
          setDisplayRestTime(
            Math.ceil((parsed.timerEndTime - Date.now()) / 1000),
          );
        } else if (parsed.timerEndTime) {
          await clearRestTimerNotification(true);
        }

        const startStr = await AsyncStorage.getItem(
          `@active_workout_start_${uid}`,
        );
        if (startStr) setStartTimeMs(parseInt(startStr, 10));
      } else {
        const lastGym = await AsyncStorage.getItem(`@last_used_gym_${uid}`);
        if (lastGym && loadedGyms.some((g: any) => g.id === lastGym)) {
          setSelectedGymId(lastGym);
        } else if (loadedGyms.length > 0) {
          setSelectedGymId(loadedGyms[0].id);
        }

        setIsPreFlightVisible(true);

        if (route.params?.templateData) {
          setActiveTemplate(route.params.templateData);
          setWorkoutName(route.params.templateData.name);
          const mapped = (route.params.templateData.exercises || []).map(
            (exObj: any, exIdx: number) => {
              const exName = typeof exObj === "string" ? exObj : exObj.name;
              const isUnilateral = !!exObj.is_unilateral;
              const brand = exObj.brand;
              let generatedSets: any[] = [];

              if (Array.isArray(exObj.sets)) {
                generatedSets = exObj.sets.map((s: any, setIdx: number) => ({
                  id: genId(`set-${exIdx}-${setIdx}-`),
                  weight: "",
                  reps: "",
                  repsL: "",
                  repsR: "",
                  completed: false,
                  isWarmup: !!s.isWarmup,
                  createdAt: Date.now() + setIdx,
                }));
              } else {
                const numSets = typeof exObj === "string" ? 1 : exObj.sets || 1;
                generatedSets = Array.from({ length: numSets }).map(
                  (_, setIdx) => ({
                    id: genId(`set-${exIdx}-${setIdx}-`),
                    weight: "",
                    reps: "",
                    repsL: "",
                    repsR: "",
                    completed: false,
                    isWarmup: false,
                    createdAt: Date.now() + setIdx,
                  }),
                );
              }
              return {
                id: genId(`ex-${exIdx}-`),
                name: exName,
                reminder: exObj.reminder || "",
                remark: "",
                exerciseVariant: exObj.exerciseVariant || "Normal",
                variationOptions: exObj.variationOptions,
                is_unilateral: isUnilateral,
                brand: brand,
                sets: generatedSets,
              };
            },
          );
          setExercises(initializeSets(mapped));
        }
      }
      setIsLoaded(true);
    })();
  }, [route.params, uid]);

  useEffect(() => {
    if (!startTimeMs || isEditing || isSummaryVisible || isPreFlightVisible)
      return;
    const interval = setInterval(
      () => setWorkoutDurationStr(formatDuration(startTimeMs, Date.now())),
      1000,
    );
    return () => clearInterval(interval);
  }, [startTimeMs, isEditing, isSummaryVisible, isPreFlightVisible]);

  useEffect(() => {
    if (!isLoaded || !uid || isEditing || isFinishing || isPreFlightVisible) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      return;
    }
    if (exercises.length === 0) {
      AsyncStorage.removeItem(`@active_session_${uid}`);
      return;
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveActiveSessionSnapshot();
    }, 1000);
    return () => clearTimeout(saveTimeoutRef.current);
  }, [
    exercises,
    workoutName,
    selectedGymId,
    activeTemplate,
    sessionRestEnabled,
    sessionRestDuration,
    timerEndTime,
    isEditing,
    isLoaded,
    isFinishing,
    isPreFlightVisible,
    uid,
  ]);

  useEffect(() => {
    if (!timerEndTime) return;
    const interval = setInterval(() => {
      const remaining = Math.ceil((timerEndTime - Date.now()) / 1000);
      if (remaining <= 0) {
        restNotificationIdRef.current = null;
        setTimerEndTime(null);
        setDisplayRestTime(0);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setDisplayRestTime(remaining);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [timerEndTime]);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setIsKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setIsKeyboardVisible(false),
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  usePreventRemove(
    !isPreFlightVisible &&
      !isFinishing &&
      !isSummaryVisible &&
      isEditable &&
      (isEditing ? hasUnsavedChanges : true),
    ({ data: { action } }) => {
      setNavAlert({
        visible: true,
        type: isEditing ? "save" : "leave",
        action,
      });
    },
  );

  const moveExercise = (
    index: number,
    direction: "up" | "down" | "top" | "bottom",
  ) => {
    Haptics.selectionAsync();
    setExercises((prev) => {
      const up = [...prev];
      const [movedItem] = up.splice(index, 1);
      if (direction === "up") up.splice(Math.max(0, index - 1), 0, movedItem);
      else if (direction === "down")
        up.splice(Math.min(up.length, index + 1), 0, movedItem);
      else if (direction === "top") up.unshift(movedItem);
      else if (direction === "bottom") up.push(movedItem);
      return up;
    });
    setHasUnsavedChanges(true);
  };

  const handleReplaceExercise = (index: number) => {
    setSelectedExerciseIndex(index);
    setIsExerciseMenuVisible(false);
    navigation.navigate("Search", {
      existingExercises: exercises
        .filter((_, i) => i !== index)
        .map((e) => e.name),
      onSelect: async (exData: any) => {
        const previousExercise = exercises[index];
        const variationOptions = getExerciseVariationOptions(exData);
        let newEx = {
          name: exData.name,
          reminder: exData.reminder || "",
          remark: "",
          exerciseVariant: variationOptions.length > 0 ? "Normal" : undefined,
          variationOptions,
          is_unilateral: !!exData.is_unilateral,
          brand: exData.brand,
          id: previousExercise?.id || genId("ex-"),
          sets:
            previousExercise?.sets?.length > 0
              ? previousExercise.sets.map((set: any) => ({
                  ...set,
                  id: set.id || genId(),
                  weight: set.weight ?? "",
                  reps: set.reps ?? "",
                  repsL: set.repsL ?? "",
                  repsR: set.repsR ?? "",
                  completed: !!set.completed,
                  isWarmup: !!set.isWarmup,
                  createdAt: set.createdAt || Date.now(),
                }))
              : [
                  {
                    id: genId(),
                    weight: "",
                    reps: "",
                    repsL: "",
                    repsR: "",
                    completed: false,
                    isWarmup: false,
                    createdAt: Date.now(),
                  },
                ],
        };
        newEx = await getAutoFilledExercise(newEx, selectedGymId);

        setExercises((prev) => {
          const up = [...prev];
          up[index] = newEx;
          return up;
        });
        setHasUnsavedChanges(true);
      },
    });
  };

  const getHistoryExerciseVariant = (exercise: any) => {
    if (!exercise) return null;
    if (exercise.exerciseVariant) return exercise.exerciseVariant;
    if (exercise.variationOptions?.length > 0) return "Normal";
    return null;
  };

  const isSameHistoryExercise = (loggedExercise: any, targetExercise: any) => {
    if (!loggedExercise || !targetExercise) return false;
    if (loggedExercise.name !== targetExercise.name) return false;

    const targetVariant = getHistoryExerciseVariant(targetExercise);
    if (!targetVariant) return true;

    const loggedVariant = loggedExercise.exerciseVariant || "Normal";
    return loggedVariant === targetVariant;
  };

  const getLatestGymsForHistory = async () => {
    if (!uid) return gyms;

    try {
      const savedGyms = await AsyncStorage.getItem(`@user_gyms_${uid}`);
      if (savedGyms) {
        const parsedGyms = JSON.parse(savedGyms);
        if (Array.isArray(parsedGyms)) {
          setGyms(parsedGyms);
          return parsedGyms;
        }
      }
    } catch (error) {
      console.log("Unable to refresh gyms for exercise history:", error);
    }

    return gyms;
  };

  const loadExerciseHistory = async (
    exerciseContext: any | null,
    gymFilter: string | null = historyGymFilter,
    brandFilter: string | null = historyBrandFilter,
  ) => {
    if (!uid || !exerciseContext?.name) return;

    const latestGyms = await getLatestGymsForHistory();
    const raw = await AsyncStorage.getItem(`@workout_history_${uid}`);
    if (!raw) {
      setExerciseHistoryData([]);
      setHistoryBrandOptions([]);
      setHistoryGymOptions([]);
      return;
    }

    const parsed = JSON.parse(raw)
      .filter((w: any) => w && w.id)
      .sort((a: any, b: any) => parseInt(b.id) - parseInt(a.id));

    const brandSet = new Set<string>();
    const gymMap = new Map<string, string>();
    const allMatches: any[] = [];

    for (const w of parsed) {
      if (!w?.fullWorkoutData) continue;

      const found = w.fullWorkoutData.find((e: any) =>
        isSameHistoryExercise(e, exerciseContext),
      );
      if (!found?.sets) continue;

      const completedSets = found.sets.filter((s: any) =>
        found.is_unilateral
          ? s.completed && s.weight && s.repsL && s.repsR
          : s.completed && s.weight && s.reps,
      );
      if (completedSets.length === 0) continue;

      const brandApplies = isMachineBrandApplicable(found);
      const equipmentTag = brandApplies
        ? found.equipmentTag || found.brand || found.machineBrand || null
        : null;
      const gymId = w.gymId || null;
      const latestGymName = gymId
        ? latestGyms.find((g: any) => g.id === gymId)?.name
        : null;
      const gymName = latestGymName || w.gymName || "Unknown Gym";

      if (brandApplies && equipmentTag) brandSet.add(equipmentTag);
      if (gymId) gymMap.set(gymId, gymName);

      allMatches.push({
        id: w.id,
        date: w.date,
        workoutName: w.workoutName,
        gymId,
        gymName,
        equipmentTag,
        remark: found.remark || null,
        exerciseVariant: found.exerciseVariant || "Normal",
        is_unilateral: found.is_unilateral,
        sets: completedSets,
      });
    }

    const gymOptions = Array.from(gymMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const brandOptions = Array.from(brandSet).sort();

    setHistoryBrandOptions(brandOptions);
    setHistoryGymOptions(gymOptions);

    const safeGymFilter =
      gymFilter && gymOptions.some((gym) => gym.id === gymFilter)
        ? gymFilter
        : null;
    const safeBrandFilter =
      brandFilter && brandOptions.includes(brandFilter) ? brandFilter : null;

    if (safeGymFilter !== gymFilter) setHistoryGymFilter(safeGymFilter);
    if (safeBrandFilter !== brandFilter) setHistoryBrandFilter(safeBrandFilter);

    const filtered = allMatches.filter((session) => {
      if (safeGymFilter && session.gymId !== safeGymFilter) return false;
      if (safeBrandFilter && session.equipmentTag !== safeBrandFilter)
        return false;
      return true;
    });

    setExerciseHistoryData(filtered.slice(0, 5));
  };

  const showExerciseHistory = async (exerciseContext: any) => {
    if (!uid || !exerciseContext) return;
    const context = { ...exerciseContext };
    setHistoryExerciseContext(context);
    setHistoryExerciseName(formatExerciseDisplayName(context));
    setHistoryGymFilter(null);
    setHistoryBrandFilter(null);
    await loadExerciseHistory(context, null, null);
    setIsHistoryModalVisible(true);
  };

  const handleSetBlur = async (exIdx: number, setId: string) => {
    if (!isAutoCheckEnabled || !isEditable || isEditing || !uid) return;

    const currentExercise = exercises[exIdx];
    const currentSet = currentExercise?.sets?.find(
      (set: any) => set.id === setId,
    );
    if (!currentExercise || !currentSet || currentSet.completed) return;

    const isComplete = currentExercise.is_unilateral
      ? String(currentSet.weight || "").trim() !== "" &&
        String(currentSet.repsL || "").trim() !== "" &&
        String(currentSet.repsR || "").trim() !== ""
      : String(currentSet.weight || "").trim() !== "" &&
        String(currentSet.reps || "").trim() !== "";

    if (!isComplete) return;

    const completedSet = { ...currentSet, completed: true };
    const nextExercises = exercises.map(
      (exercise: any, exerciseIndex: number) => {
        if (exerciseIndex !== exIdx) return exercise;
        return {
          ...exercise,
          sets: exercise.sets.map((set: any) =>
            set.id === setId ? completedSet : set,
          ),
        };
      },
    );

    setExercises(nextExercises);
    setHasUnsavedChanges(true);
    startRestTimerForCompletedSet(exIdx, completedSet, nextExercises);
  };

  const handleFinishWorkout = (navAction?: any) => {
    if (finishWorkoutInFlightRef.current) return;

    finishWorkoutInFlightRef.current = true;
    setIsFinishing(true);

    let hasIncomplete = false;
    exercises.forEach((ex) => {
      ex.sets.forEach((s: any) => {
        if (ex.is_unilateral) {
          if (
            !s.completed ||
            s.weight.trim() === "" ||
            (s.repsL || "").trim() === "" ||
            (s.repsR || "").trim() === ""
          )
            hasIncomplete = true;
        } else {
          if (
            !s.completed ||
            s.weight.trim() === "" ||
            (s.reps || "").trim() === ""
          )
            hasIncomplete = true;
        }
      });
    });

    if (hasIncomplete) {
      setIncompleteFinishAlert({ visible: true, navAction });
    } else {
      finishWorkout(exercises, navAction);
    }
  };

  const finishWorkout = async (
    finalExercisesToSave: any[],
    navAction?: any,
  ) => {
    if (!uid) {
      finishWorkoutInFlightRef.current = false;
      setIsFinishing(false);
      return;
    }

    workoutFinalizedRef.current = true;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    setTimerEndTime(null);
    setDisplayRestTime(0);
    await clearRestTimerNotification(true);

    if (finalExercisesToSave.length === 0) {
      showInfo(
        "Empty Session",
        "No completed sets were found. Workout discarded.",
        async () => {
          finishWorkoutInFlightRef.current = false;
          setIsFinishing(false);
          setIsEditable(false);
          if (!isEditing) {
            await AsyncStorage.removeItem(`@active_session_${uid}`);
            await AsyncStorage.removeItem(`@active_workout_start_${uid}`);
            await AsyncStorage.setItem(`@last_search_filter_${uid}`, "All");
          }
          if (navAction) navigation.dispatch(navAction);
          else navigation.reset({ index: 0, routes: [{ name: "Home" }] });
        },
      );
      return;
    }

    let vol = 0;
    let totalSets = 0;
    const raw = await AsyncStorage.getItem(`@workout_history_${uid}`);
    const list = raw ? JSON.parse(raw).filter((w: any) => w && w.id) : [];

    finalExercisesToSave.forEach((ex) => {
      if (ex && ex.sets) {
        ex.sets.forEach((s: any) => {
          if (s && s.completed && !s.isWarmup) {
            if (ex.is_unilateral && s.weight && s.repsL && s.repsR) {
              vol +=
                parseFloat(s.weight) * parseInt(s.repsL) +
                parseFloat(s.weight) * parseInt(s.repsR);
              totalSets += 1;
            } else if (!ex.is_unilateral && s.weight && s.reps) {
              vol += parseFloat(s.weight) * parseInt(s.reps);
              totalSets += 1;
            }
          }
        });
      }
    });

    const finishedAt = Date.now();
    const workoutStartedAt = isEditing
      ? Number(
          route.params?.editData?.startedAt ||
            route.params?.editData?.id ||
            Date.now(),
        )
      : startTimeMs || Date.now();

    let finalDuration = "0m 0s";
    if (!isEditing && workoutStartedAt) {
      finalDuration = formatDuration(workoutStartedAt, finishedAt);
    } else if (isEditing && route.params?.editData?.duration) {
      finalDuration = route.params.editData.duration;
    }

    if (!isEditing) {
      setStartTimeMs(null);
      setWorkoutDurationStr(finalDuration);
    }

    const detectedPRs = !isEditing
      ? detectWorkoutPRs(finalExercisesToSave, list, { isKg })
      : [];

    const detectedPRDisplayCount = getWorkoutPRDisplayCount(detectedPRs);
    const calculatedPrType =
      detectedPRDisplayCount > 0
        ? `${detectedPRDisplayCount} PR${detectedPRDisplayCount === 1 ? "" : "s"}`
        : null;

    const gymObj = gyms.find((g) => g.id === selectedGymId);

    const session = {
      id: route.params?.editData?.id || finishedAt.toString(),
      startedAt: workoutStartedAt,
      finishedAt: isEditing
        ? route.params?.editData?.finishedAt || finishedAt
        : finishedAt,
      date:
        route.params?.editData?.date || formatWorkoutLogDate(workoutStartedAt),
      workoutName,
      templateId:
        activeTemplate?.id || route.params?.editData?.templateId || null,
      volume: vol,
      isKg,
      gymId: selectedGymId,
      gymName: gymObj ? gymObj.name : null,
      fullWorkoutData: finalExercisesToSave,
      duration: finalDuration,
      prType: calculatedPrType,
      prs: detectedPRs,
    };

    await AsyncStorage.setItem(
      `@workout_history_${uid}`,
      JSON.stringify(
        route.params?.editData
          ? list.map((w: any) => (w?.id === session.id ? session : w))
          : [...list, session],
      ),
    );

    try {
      await pushWorkoutToCloud(session);
    } catch (e) {
      console.log("Cloud backup delayed: saved locally.");
    }

    if (!isEditing) {
      await AsyncStorage.removeItem(`@active_session_${uid}`);
      await AsyncStorage.removeItem(`@active_workout_start_${uid}`);
      await AsyncStorage.setItem(`@last_search_filter_${uid}`, "All");

      const exercisesForSummary = finalExercisesToSave
        .map((ex) => ({ ...ex, sets: ex.sets.filter((s: any) => !s.isWarmup) }))
        .filter((ex) => ex.sets.length > 0);
      setCompletedWorkoutData({
        id: session.id,
        name: workoutName,
        date: session.date,
        startedAt: session.startedAt,
        finishedAt: session.finishedAt,
        gymName: session.gymName,
        volume: vol,
        totalSets: totalSets,
        duration: finalDuration,
        prType: calculatedPrType,
        prs: detectedPRs,
        exercises: exercisesForSummary,
      });

      if (activeTemplate) {
        let hasStructuralChanges = false;
        if (finalExercisesToSave.length !== activeTemplate.exercises.length) {
          hasStructuralChanges = true;
        } else {
          for (let i = 0; i < finalExercisesToSave.length; i++) {
            const curEx = finalExercisesToSave[i];
            const tplEx = activeTemplate.exercises[i];
            if (
              curEx.name !== (typeof tplEx === "string" ? tplEx : tplEx.name) ||
              (curEx.exerciseVariant || "Normal") !==
                ((typeof tplEx === "string"
                  ? "Normal"
                  : tplEx.exerciseVariant) || "Normal") ||
              !!curEx.is_unilateral !== !!tplEx.is_unilateral
            ) {
              hasStructuralChanges = true;
              break;
            }
            if (
              curEx.sets.filter((s: any) => s.isWarmup).length !==
                (tplEx.sets?.filter((s: any) => s.isWarmup).length || 0) ||
              curEx.sets.filter((s: any) => !s.isWarmup).length !==
                (tplEx.sets?.filter((s: any) => !s.isWarmup).length ||
                  tplEx.sets?.length ||
                  1)
            ) {
              hasStructuralChanges = true;
              break;
            }
          }
        }

        if (hasStructuralChanges) {
          finishWorkoutInFlightRef.current = false;
          setIsFinishing(false);
          setDiffAlertVisible(true);
          return;
        } else {
          finishWorkoutInFlightRef.current = false;
          setIsFinishing(false);
          setSummaryType("finish");
          setIsSummaryVisible(true);
          return;
        }
      }
      finishWorkoutInFlightRef.current = false;
      setIsFinishing(false);
      setTemplateAlertVisible(true);
    } else {
      if (navAction) {
        setIsEditable(false);
        finishWorkoutInFlightRef.current = false;
        setIsFinishing(false);
        navigation.dispatch(navAction);
      } else {
        setIsEditable(false);
        setHasUnsavedChanges(false);
        setInitialStateStr(
          JSON.stringify({ exercises: finalExercisesToSave, workoutName }),
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        finishWorkoutInFlightRef.current = false;
        setIsFinishing(false);
        showInfo(
          "Workout Updated!",
          "Your changes have been saved successfully.",
        );
      }
    }
  };

  const getSummaryData = () => {
    if (summaryType === "finish" && completedWorkoutData)
      return completedWorkoutData;
    const cleaned = exercises
      .map((ex) => ({
        ...ex,
        sets: ex.sets.filter((s: any) => {
          if (ex.is_unilateral)
            return (
              s.completed &&
              s.weight.trim() !== "" &&
              (s.repsL || "").trim() !== "" &&
              (s.repsR || "").trim() !== "" &&
              !s.isWarmup
            );
          return (
            s.completed &&
            s.weight.trim() !== "" &&
            (s.reps || "").trim() !== "" &&
            !s.isWarmup
          );
        }),
      }))
      .filter((ex) => ex.sets.length > 0);

    let vol = 0;
    let sets = 0;
    cleaned.forEach((ex: any) => {
      ex.sets.forEach((s: any) => {
        if (ex.is_unilateral)
          vol +=
            parseFloat(s.weight) * parseInt(s.repsL) +
            parseFloat(s.weight) * parseInt(s.repsR);
        else vol += parseFloat(s.weight) * parseInt(s.reps);
        sets += 1;
      });
    });
    return {
      name: workoutName,
      date: route.params?.editData?.date || new Date().toLocaleDateString(),
      gymName: gyms.find((g) => g.id === selectedGymId)?.name || null,
      volume: vol,
      totalSets: sets,
      duration: isEditing
        ? route.params.editData.duration || "0m"
        : workoutDurationStr,
      prType: route.params?.editData?.prType || null,
      prs: route.params?.editData?.prs || [],
      exercises: cleaned,
    };
  };

  const handleSaveImage = async () => {
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        showInfo(
          "Permission Needed",
          "Please grant camera roll permissions to save your workout summary.",
        );
        return;
      }
      if (igCardRef.current) {
        const uri = await igCardRef.current.capture();
        await MediaLibrary.saveToLibraryAsync(uri);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        Alert.alert(
          "Saved!",
          "Workout summary saved perfectly to your camera roll.",
        );
      }
    } catch (error: any) {
      showInfo("Error Saving", "Could not save the image.");
    }
  };

  const updatePlateInventory = async (p: number, action: "inc" | "dec") => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPlateInventory((prev) => {
      const current = prev[p] === undefined ? null : prev[p];
      let next = current;
      if (action === "dec")
        next = current === null ? 5 : current === 0 ? null : current - 1;
      else next = current === null ? null : current + 1;
      const newInv = { ...prev, [p]: next };
      if (uid)
        AsyncStorage.setItem(`@plate_inventory_${uid}`, JSON.stringify(newInv));
      return newInv;
    });
  };

  const plateResult = useMemo(() => {
    const t = parseFloat(calcTarget);
    const b = parseFloat(calcBar);
    if (!t || !b || t <= b)
      return { result: [], actualTarget: b, isExact: true };
    let perSideTarget = (t - b) / 2;
    let perSideActual = 0;
    const result: any[] = [];
    availablePlates.forEach((p) => {
      const desiredPairs = Math.floor((perSideTarget - perSideActual) / p);
      const invLimit = plateInventory[p];
      const maxPairsAllowed =
        invLimit === undefined || invLimit === null ? Infinity : invLimit;
      const actualPairsToUse = Math.min(desiredPairs, maxPairsAllowed);
      if (actualPairsToUse > 0) {
        result.push({ weight: p, count: actualPairsToUse });
        perSideActual += actualPairsToUse * p;
      }
    });
    return {
      result,
      actualTarget: b + perSideActual * 2,
      isExact: Math.abs(t - (b + perSideActual * 2)) < 0.01,
    };
  }, [calcTarget, calcBar, availablePlates, plateInventory]);

  const currentGymVariants =
    gyms.find((g) => g.id === selectedGymId)?.variants || [];

  const allVariants = Array.from(
    new Set([...DEFAULT_VARIANTS, ...globalVariants, ...currentGymVariants]),
  );

  const filteredVariants = allVariants.filter((v: string) =>
    v.toLowerCase().includes(tagSearchQuery.toLowerCase()),
  );

  const selectedGymName =
    gyms.find((g) => g.id === selectedGymId)?.name ||
    (selectedGymId ? "Selected Gym" : "No gym selected");

  const workoutStats = useMemo(() => {
    const totalExercises = exercises.length;
    const totalSets = exercises.reduce(
      (sum, ex) => sum + (ex.sets || []).filter((s: any) => !s.isWarmup).length,
      0,
    );
    const completedSets = exercises.reduce(
      (sum, ex) =>
        sum +
        (ex.sets || []).filter((s: any) => s.completed && !s.isWarmup).length,
      0,
    );

    return { totalExercises, totalSets, completedSets };
  }, [exercises]);

  return (
    <View style={styles.screen}>
      <CustomAlert
        visible={infoAlert.visible}
        title={infoAlert.title}
        message={infoAlert.message}
        buttons={[{ text: "OK" }]}
        onClose={() => {
          setInfoAlert((prev) => ({ ...prev, visible: false }));
          setTimeout(() => {
            infoAlert.onCloseAction();
          }, 400);
        }}
      />

      <CustomAlert
        visible={navAlert.visible}
        title={navAlert.type === "save" ? "Save Changes?" : "Leave Workout?"}
        message={
          navAlert.type === "save"
            ? "You have unsaved changes to this workout."
            : "What would you like to do?"
        }
        buttons={
          navAlert.type === "save"
            ? [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Discard",
                  style: "destructive",
                  onPress: () => {
                    setIsEditable(false);
                    navigation.dispatch(navAlert.action);
                  },
                },
                {
                  text: "Save",
                  onPress: () =>
                    setTimeout(() => handleFinishWorkout(navAlert.action), 400),
                },
              ]
            : exercises.length === 0
              ? [
                  {
                    text: "Abandon",
                    style: "destructive",
                    onPress: async () => {
                      setIsEditable(false);
                      if (uid) {
                        await AsyncStorage.removeItem(`@active_session_${uid}`);
                        await AsyncStorage.removeItem(
                          `@active_workout_start_${uid}`,
                        );
                        await AsyncStorage.setItem(
                          `@last_search_filter_${uid}`,
                          "All",
                        );
                        await clearRestTimerNotification(true);
                      }
                      navigation.dispatch(navAlert.action);
                    },
                  },
                  { text: "Cancel", style: "cancel" },
                ]
              : [
                  {
                    text: "Pause Workout",
                    onPress: async () => {
                      await saveActiveSessionSnapshot();
                      setIsEditable(false);
                      setNavAlert((prev) => ({ ...prev, visible: false }));
                      navigation.navigate("Home");
                    },
                  },
                  {
                    text: "Abandon",
                    style: "destructive",
                    onPress: async () => {
                      setIsEditable(false);
                      if (uid) {
                        await AsyncStorage.removeItem(`@active_session_${uid}`);
                        await AsyncStorage.removeItem(
                          `@active_workout_start_${uid}`,
                        );
                        await AsyncStorage.setItem(
                          `@last_search_filter_${uid}`,
                          "All",
                        );
                        await clearRestTimerNotification(true);
                      }
                      navigation.dispatch(navAlert.action);
                    },
                  },
                  { text: "Cancel", style: "cancel" },
                ]
        }
        onClose={() => setNavAlert((prev) => ({ ...prev, visible: false }))}
      />

      <CustomAlert
        visible={incompleteFinishAlert.visible}
        title="Incomplete Sets Detected"
        message="You have empty or unchecked sets left. What would you like to do?"
        buttons={[
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => {
              incompleteActionTaken.current = true;
              finishWorkoutInFlightRef.current = false;
              setIsFinishing(false);
            },
          },
          {
            text: "Delete & Finish",
            style: "destructive",
            onPress: () => {
              incompleteActionTaken.current = true;
              const cleanedExercises = exercises
                .map((ex) => ({
                  ...ex,
                  sets: ex.sets.filter((s: any) =>
                    ex.is_unilateral
                      ? s.completed &&
                        s.weight.trim() !== "" &&
                        (s.repsL || "").trim() !== "" &&
                        (s.repsR || "").trim() !== ""
                      : s.completed &&
                        s.weight.trim() !== "" &&
                        (s.reps || "").trim() !== "",
                  ),
                }))
                .filter((ex) => ex.sets.length > 0);
              setTimeout(
                () =>
                  finishWorkout(
                    cleanedExercises,
                    incompleteFinishAlert.navAction,
                  ),
                400,
              );
            },
          },
        ]}
        onClose={() => {
          setIncompleteFinishAlert((prev) => ({ ...prev, visible: false }));
          if (!incompleteActionTaken.current) {
            finishWorkoutInFlightRef.current = false;
            setIsFinishing(false);
          }
          incompleteActionTaken.current = false;
        }}
      />
      <CustomAlert
        visible={templateAlertVisible}
        title="Save Workout as Template?"
        message="Create a reusable template from the completed exercises and set structure? Weights and reps will not be saved into the template."
        buttons={[
          {
            text: "No",
            style: "cancel",
            onPress: () => {
              templateActionTaken.current = true;
              setTimeout(openFinishSummary, 400);
            },
          },
          {
            text: "Save Template",
            onPress: () => {
              templateActionTaken.current = true;
              setTimeout(
                () =>
                  openTemplateNamePrompt(
                    exercises,
                    "New Template Name",
                    "Name this reusable template before saving it.",
                  ),
                400,
              );
            },
          },
        ]}
        onClose={() => {
          setTemplateAlertVisible(false);
          if (!templateActionTaken.current) {
            setTimeout(openFinishSummary, 400);
          }
          templateActionTaken.current = false;
        }}
      />
      <CustomAlert
        visible={diffAlertVisible}
        title="Template Changed"
        message="This saved session no longer matches the original template structure. How should IronVault handle the template?"
        buttons={[
          {
            text: "Keep Session Only",
            style: "cancel",
            onPress: () => {
              diffActionTaken.current = true;
              setTimeout(openFinishSummary, 400);
            },
          },
          {
            text: "Save as New Template",
            onPress: () => {
              diffActionTaken.current = true;
              setTimeout(
                () =>
                  openTemplateNamePrompt(
                    exercises,
                    "New Template Name",
                    "Save this changed workout as a separate template.",
                  ),
                400,
              );
            },
          },
          {
            text: "Update Original",
            onPress: async () => {
              diffActionTaken.current = true;
              await updateOriginalTemplateFromWorkout(exercises);
              setTimeout(openFinishSummary, 400);
            },
          },
        ]}
        onClose={() => {
          setDiffAlertVisible(false);
          if (!diffActionTaken.current) {
            setTimeout(openFinishSummary, 400);
          }
          diffActionTaken.current = false;
        }}
      />
      <CustomAlert
        visible={removeSetAlert.visible}
        title="Remove Set"
        message={`Delete ${removeSetAlert.isWarmup ? "Warm-up" : "Set"}?`}
        buttons={[
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              setExercises((prev) => {
                const up = [...prev];
                up[removeSetAlert.exIdx] = {
                  ...up[removeSetAlert.exIdx],
                  sets: up[removeSetAlert.exIdx].sets.filter(
                    (set: any) => set.id !== removeSetAlert.setId,
                  ),
                };
                return up;
              });
              setHasUnsavedChanges(true);
            },
          },
        ]}
        onClose={() =>
          setRemoveSetAlert((prev) => ({ ...prev, visible: false }))
        }
      />

      <Modal visible={isPreFlightVisible} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.8)",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <View
            style={{
              backgroundColor: "#1C1C1E",
              borderRadius: 20,
              padding: 24,
              paddingBottom: 30,
            }}
          >
            <Text
              style={{
                color: "#FFF",
                fontSize: 24,
                fontWeight: "900",
                marginBottom: 20,
                textAlign: "center",
              }}
            >
              {isChangingLocation ? "Change Location" : "Start Session"}
            </Text>

            <Text
              style={{
                color: "#8E8E93",
                fontSize: 12,
                fontWeight: "800",
                marginBottom: 8,
                textTransform: "uppercase",
              }}
            >
              SELECT GYM
            </Text>
            <View style={{ maxHeight: 200, marginBottom: 24 }}>
              <ScrollView showsVerticalScrollIndicator={false}>
                {gyms.map((gym) => (
                  <TouchableOpacity
                    key={gym.id}
                    style={{
                      padding: 16,
                      backgroundColor:
                        selectedGymId === gym.id
                          ? "rgba(50,215,75,0.15)"
                          : "#2C2C2E",
                      borderRadius: 12,
                      marginBottom: 8,
                      borderWidth: 1,
                      borderColor:
                        selectedGymId === gym.id ? "#32D74B" : "transparent",
                    }}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSelectedGymId(gym.id);
                    }}
                  >
                    <Text
                      style={{
                        color: selectedGymId === gym.id ? "#32D74B" : "#FFF",
                        fontWeight: "700",
                        fontSize: 16,
                      }}
                    >
                      {gym.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <TouchableOpacity
              style={{
                backgroundColor: "#32D74B",
                padding: 18,
                borderRadius: 12,
                alignItems: "center",
                marginBottom: 12,
              }}
              onPress={async () => {
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Success,
                );
                setIsPreFlightVisible(false);

                if (!startTimeMs) {
                  const startMs = Date.now();
                  setStartTimeMs(startMs);
                  await AsyncStorage.setItem(
                    `@active_workout_start_${uid}`,
                    startMs.toString(),
                  );
                }

                if (selectedGymId) {
                  await AsyncStorage.setItem(
                    `@last_used_gym_${uid}`,
                    selectedGymId,
                  );
                }

                const selectedGym = gyms.find((g) => g.id === selectedGymId);
                const newGymVariants = selectedGym?.variants || [];
                const defaultMachineBrand =
                  selectedGym?.defaultMachineBrand || null;
                const allowed = new Set([
                  ...DEFAULT_VARIANTS,
                  ...globalVariants,
                  ...newGymVariants,
                ]);

                const updated = await Promise.all(
                  exercises.map(async (ex) => {
                    let tempEx = { ...ex };

                    if (!isMachineBrandApplicable(tempEx)) {
                      delete tempEx.equipmentTag;
                      delete tempEx.machineBrand;
                      return tempEx;
                    }

                    let historicalTag = null;
                    const historyRaw = await AsyncStorage.getItem(
                      `@workout_history_${uid}`,
                    );
                    if (historyRaw && selectedGymId) {
                      const historyList = JSON.parse(historyRaw)
                        .filter((w: any) => w.gymId === selectedGymId)
                        .sort(
                          (a: any, b: any) => parseInt(b.id) - parseInt(a.id),
                        );
                      for (const pastWorkout of historyList) {
                        const pastEx = pastWorkout.fullWorkoutData?.find(
                          (e: any) => e.name === ex.name,
                        );
                        if (
                          pastEx &&
                          isMachineBrandApplicable(pastEx) &&
                          pastEx.equipmentTag
                        ) {
                          historicalTag = pastEx.equipmentTag;
                          break;
                        }
                      }
                    }

                    // When changing gyms, do not carry over the machine tag from
                    // the previous gym. Use this gym's saved/manual tag for the
                    // exercise if it exists in history; otherwise fall back to the
                    // gym default machine brand. This keeps gym-specific machines
                    // separate while still respecting tags manually used at this gym.
                    if (historicalTag && allowed.has(historicalTag)) {
                      tempEx.equipmentTag = historicalTag;
                    } else if (
                      defaultMachineBrand &&
                      allowed.has(defaultMachineBrand)
                    ) {
                      tempEx.equipmentTag = defaultMachineBrand;
                    } else {
                      delete tempEx.equipmentTag;
                    }

                    return tempEx;
                  }),
                );

                setExercises(updated);
                if (isChangingLocation) setHasUnsavedChanges(true);
                setIsChangingLocation(false);
              }}
            >
              <Text style={{ color: "#000", fontSize: 18, fontWeight: "900" }}>
                Confirm
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ alignItems: "center", paddingVertical: 10 }}
              onPress={() => {
                if (isChangingLocation) {
                  setIsPreFlightVisible(false);
                  setIsChangingLocation(false);
                } else {
                  navigation.goBack();
                }
              }}
            >
              <Text
                style={{ color: "#FF3B30", fontSize: 16, fontWeight: "700" }}
              >
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <SafeAreaView edges={["top"]} style={styles.headerContainer}>
        <View
          style={[
            styles.headerContentFlex,
            { height: "auto", minHeight: 64, paddingVertical: 10 },
          ]}
        >
          {!isReorderMode ? (
            <TouchableOpacity
              style={styles.headerSideBtn}
              onPress={() => navigation.goBack()}
            >
              <View style={styles.customBackChevron} />
            </TouchableOpacity>
          ) : (
            <View style={styles.headerSideBtn} />
          )}

          <View
            style={[
              styles.headerTitleContainer,
              { justifyContent: "center", alignItems: "center" },
            ]}
          >
            <TextInput
              style={[
                styles.headerTitleInput,
                { flex: 0, height: "auto", fontSize: 17, marginBottom: 6 },
              ]}
              value={workoutName}
              editable={isEditable && !isReorderMode}
              onChangeText={(t) => {
                setWorkoutName(t);
                setHasUnsavedChanges(true);
              }}
              placeholder="Workout Name"
              placeholderTextColor="#48484A"
              selectTextOnFocus
              textAlign="center"
              selectionColor="#FFF"
            />
            {!isEditing && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "rgba(50, 215, 75, 0.15)",
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                  borderRadius: 12,
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: "#32D74B",
                    marginRight: 6,
                  }}
                />
                <Text
                  style={{
                    color: "#32D74B",
                    fontSize: 12,
                    fontWeight: "900",
                    letterSpacing: 0.5,
                    marginTop: Platform.OS === "ios" ? 2 : 0,
                  }}
                >
                  {workoutDurationStr}
                </Text>
              </View>
            )}
            {isEditing && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "#2C2C2E",
                  paddingHorizontal: 12,
                  paddingVertical: 4,
                  borderRadius: 12,
                }}
              >
                <Ionicons
                  name="time"
                  size={12}
                  color="#8E8E93"
                  style={{ marginRight: 4 }}
                />
                <Text
                  style={{
                    color: "#8E8E93",
                    fontSize: 12,
                    fontWeight: "800",
                    letterSpacing: 0.5,
                    marginTop: Platform.OS === "ios" ? 2 : 0,
                  }}
                >
                  {workoutDurationStr}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.headerRightActionGroup}>
            {!isEditing ? (
              <View style={{ width: 40 }} />
            ) : isEditable ? (
              <View style={{ width: 40 }} />
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <TouchableOpacity
                  style={{ padding: 8 }}
                  onPress={() => {
                    setSummaryType("share");
                    setIsSummaryVisible(true);
                  }}
                >
                  <Ionicons name="download-outline" size={24} color="#FFF" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={{ padding: 8, marginLeft: 8 }}
                  onPress={() => setIsEditable(true)}
                >
                  <Ionicons name="pencil-outline" size={24} color="#FFF" />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </SafeAreaView>

      <Modal visible={isSessionMenuVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsSessionMenuVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.actionMenuContent}>
            <Text style={styles.actionMenuTitle}>Session Options</Text>
            <Text style={styles.actionMenuSubtitle} numberOfLines={1}>
              {workoutName} · {selectedGymName}
            </Text>

            {!isEditing && isPlateCalcEnabled && (
              <TouchableOpacity
                style={styles.actionSheetRow}
                onPress={() => {
                  setIsSessionMenuVisible(false);
                  setIsPlateCalcVisible(true);
                }}
              >
                <View style={styles.actionSheetIconCircle}>
                  <Ionicons
                    name="calculator-outline"
                    size={20}
                    color="#32D74B"
                  />
                </View>
                <View style={styles.actionSheetTextBlock}>
                  <Text style={styles.actionSheetRowTitle}>
                    Plate Calculator
                  </Text>
                  <Text style={styles.actionSheetRowSubtitle}>
                    Calculate barbell loading for your set
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#8E8E93" />
              </TouchableOpacity>
            )}

            {isEditable && exercises.length > 1 && (
              <TouchableOpacity
                style={styles.actionSheetRow}
                onPress={openReorderModal}
              >
                <View style={styles.actionSheetIconCircle}>
                  <Ionicons
                    name="swap-vertical-outline"
                    size={20}
                    color="#32D74B"
                  />
                </View>
                <View style={styles.actionSheetTextBlock}>
                  <Text style={styles.actionSheetRowTitle}>
                    Reorder Exercises
                  </Text>
                  <Text style={styles.actionSheetRowSubtitle}>
                    Open a compact list to arrange this workout
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#8E8E93" />
              </TouchableOpacity>
            )}

            {!isEditing && (
              <View style={styles.actionSheetRow}>
                <View style={styles.actionSheetIconCircle}>
                  <Ionicons name="timer-outline" size={20} color="#32D74B" />
                </View>
                <View style={styles.actionSheetTextBlock}>
                  <Text style={styles.actionSheetRowTitle}>Rest Timer</Text>
                  <Text style={styles.actionSheetRowSubtitle}>
                    Auto-start after completed sets
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.compactTogglePill,
                    {
                      backgroundColor: sessionRestEnabled
                        ? "#32D74B"
                        : "#FF3B30",
                    },
                  ]}
                  onPress={toggleSessionRestTimer}
                >
                  <Text
                    style={[
                      styles.compactToggleText,
                      { color: sessionRestEnabled ? "#000" : "#FFF" },
                    ]}
                  >
                    {sessionRestEnabled ? "ON" : "OFF"}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {!isEditing && sessionRestEnabled && (
              <View style={styles.restDurationRow}>
                <Text style={styles.restDurationLabel}>Duration</Text>
                <View style={styles.restDurationStepper}>
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSessionRestDuration(
                        String(
                          Math.max(
                            0,
                            parseInt(sessionRestDuration || "0") - 10,
                          ),
                        ),
                      );
                    }}
                    style={styles.restDurationStepButton}
                  >
                    <Text style={styles.restDurationStepText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.restDurationValue}>
                    {sessionRestDuration}s
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSessionRestDuration(
                        String(parseInt(sessionRestDuration || "0") + 10),
                      );
                    }}
                    style={styles.restDurationStepButton}
                  >
                    <Text style={styles.restDurationStepText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={styles.actionMenuBtnCancel}
              onPress={() => setIsSessionMenuVisible(false)}
            >
              <Text style={styles.actionMenuBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={isReorderModalVisible} transparent animationType="fade">
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <View style={styles.reorderModalContent}>
              <View style={styles.reorderModalHandle} />
              <Text style={styles.actionMenuTitle}>Reorder Exercises</Text>
              <Text style={styles.actionMenuSubtitle}>
                Hold and drag to rearrange your session.
              </Text>

              <DraggableFlatList
                data={reorderDraftExercises}
                keyExtractor={(item: any, index: number) =>
                  String(item.id || `${item.name}-${index}`)
                }
                style={styles.reorderModalList}
                contentContainerStyle={{ paddingBottom: 4 }}
                activationDistance={0}
                animationConfig={REORDER_DRAG_ANIMATION_CONFIG}
                onDragBegin={() =>
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                }
                onDragEnd={({ data }) => setReorderDraftExercises(data)}
                renderItem={({ item, drag, isActive, getIndex }) => (
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onLongPress={drag}
                    delayLongPress={120}
                    style={styles.reorderModalRow}
                  >
                    <Ionicons
                      name="reorder-three-outline"
                      size={24}
                      color={isActive ? "#32D74B" : "#8E8E93"}
                    />
                    <View style={styles.reorderModalIndexBadge}>
                      <Text style={styles.reorderModalIndexText}>
                        {(getIndex() ?? 0) + 1}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.reorderModalTitle} numberOfLines={1}>
                        {item.blockType === "superset"
                          ? `Superset: ${(item.members || []).map((member: any) => member.name).join(" + ")}`
                          : `${formatExerciseDisplayName(item.members?.[0] || item)}${(item.members?.[0] || item).is_unilateral ? " (L/R)" : ""}`}
                      </Text>
                      <Text style={styles.reorderModalMeta} numberOfLines={1}>
                        {item.blockType === "superset"
                          ? `${(item.members || []).length} exercises · moves together`
                          : ((item.members?.[0] || item).exerciseVariant &&
                            (item.members?.[0] || item).exerciseVariant !==
                              "Normal"
                              ? `${(item.members?.[0] || item).exerciseVariant} · `
                              : "") +
                            (isMachineBrandApplicable(item.members?.[0] || item)
                              ? (item.members?.[0] || item).equipmentTag ||
                                "No machine tag"
                              : "Free weight / bodyweight")}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
              />

              <View style={styles.reorderModalFooter}>
                <TouchableOpacity
                  style={styles.reorderModalCancelButton}
                  onPress={cancelReorderModal}
                >
                  <Text style={styles.reorderModalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.reorderModalDoneButton}
                  onPress={applyReorderModal}
                >
                  <Text style={styles.reorderModalDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </GestureHandlerRootView>
      </Modal>

      <Modal visible={isPlateCalcVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[styles.modalOverlay, { justifyContent: "flex-end" }]}
        >
          <View
            style={[
              styles.modalContent,
              {
                width: "100%",
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
                paddingBottom: Platform.OS === "ios" ? 40 : 20,
                margin: 0,
              },
            ]}
          >
            <View
              style={{
                width: 40,
                height: 5,
                backgroundColor: "#3A3A3C",
                borderRadius: 3,
                marginBottom: 20,
              }}
            />
            <Text style={styles.modalTitle}>Plate Calculator</Text>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                width: "100%",
                marginBottom: 16,
              }}
            >
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={styles.modalGroupLabel}>
                  Target ({isKg ? "KG" : "LBS"})
                </Text>
                <TextInput
                  style={[styles.modalInput, { marginBottom: 0 }]}
                  keyboardType="decimal-pad"
                  value={calcTarget}
                  onChangeText={setCalcTarget}
                  placeholder="0"
                  placeholderTextColor="#48484A"
                  selectionColor="#32D74B"
                  autoFocus
                />
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.modalGroupLabel}>
                  Bar ({isKg ? "KG" : "LBS"})
                </Text>
                <TextInput
                  style={[styles.modalInput, { marginBottom: 0 }]}
                  keyboardType="decimal-pad"
                  value={calcBar}
                  onChangeText={setCalcBar}
                  placeholder={isKg ? "20" : "45"}
                  placeholderTextColor="#48484A"
                  selectionColor="#32D74B"
                />
              </View>
            </View>
            <View style={{ width: "100%", marginBottom: 16 }}>
              <Text
                style={[
                  styles.modalGroupLabel,
                  { textAlign: "left", marginBottom: 8 },
                ]}
              >
                Max Pairs Available (Per Side)
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {availablePlates.map((p) => {
                  const limit =
                    plateInventory[p] === undefined ||
                    plateInventory[p] === null
                      ? "∞"
                      : plateInventory[p];
                  return (
                    <View
                      key={p}
                      style={{
                        backgroundColor: "#2C2C2E",
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        marginRight: 8,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color: "#FFF",
                          fontWeight: "800",
                          marginBottom: 6,
                        }}
                      >
                        {p}
                      </Text>
                      <View
                        style={{ flexDirection: "row", alignItems: "center" }}
                      >
                        <TouchableOpacity
                          onPress={() => updatePlateInventory(p, "dec")}
                          style={{ paddingHorizontal: 8 }}
                        >
                          <Text
                            style={{
                              color: "#8E8E93",
                              fontSize: 18,
                              fontWeight: "600",
                            }}
                          >
                            -
                          </Text>
                        </TouchableOpacity>
                        <Text
                          style={{
                            color: "#32D74B",
                            fontWeight: "800",
                            fontSize: 16,
                            width: 20,
                            textAlign: "center",
                          }}
                        >
                          {limit}
                        </Text>
                        <TouchableOpacity
                          onPress={() => updatePlateInventory(p, "inc")}
                          style={{ paddingHorizontal: 8 }}
                        >
                          <Text
                            style={{
                              color: "#8E8E93",
                              fontSize: 18,
                              fontWeight: "600",
                            }}
                          >
                            +
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
            <View
              style={{ width: "100%", minHeight: 120, alignItems: "center" }}
            >
              {parseFloat(calcTarget) <= parseFloat(calcBar) ? (
                <Text style={{ color: "#8E8E93", marginTop: 20 }}>
                  Just the empty bar for this one!
                </Text>
              ) : plateResult.result.length === 0 && calcTarget !== "" ? (
                <Text style={{ color: "#8E8E93", marginTop: 20 }}>
                  Weight doesn't match standard plates.
                </Text>
              ) : (
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  style={{ width: "100%", maxHeight: 200 }}
                >
                  {!plateResult.isExact && (
                    <Text
                      style={{
                        color: "#FFD700",
                        fontSize: 15,
                        fontWeight: "800",
                        marginBottom: 16,
                        textAlign: "center",
                      }}
                    >
                      Closest match: {plateResult.actualTarget}{" "}
                      {isKg ? "kg" : "lbs"}
                    </Text>
                  )}
                  {plateResult.result.length > 0 && (
                    <Text
                      style={{
                        color: "#FFF",
                        fontSize: 14,
                        fontWeight: "700",
                        marginBottom: 10,
                        textAlign: "center",
                      }}
                    >
                      Plates Per Side:
                    </Text>
                  )}
                  {plateResult.result.map((p, i) => (
                    <View
                      key={i}
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        backgroundColor: "#2C2C2E",
                        padding: 12,
                        borderRadius: 10,
                        marginBottom: 8,
                      }}
                    >
                      <Text
                        style={{
                          color: "#FFF",
                          fontSize: 16,
                          fontWeight: "800",
                        }}
                      >
                        {p.weight} {isKg ? "kg" : "lbs"}
                      </Text>
                      <Text
                        style={{
                          color: "#32D74B",
                          fontSize: 16,
                          fontWeight: "800",
                        }}
                      >
                        × {p.count}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>
            <TouchableOpacity
              style={[styles.actionMenuBtnCancel, { marginTop: 20 }]}
              onPress={() => setIsPlateCalcVisible(false)}
            >
              <Text style={styles.actionMenuBtnTextCancel}>Close</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={templateNamePrompt.visible}
        transparent
        animationType="fade"
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.72)",
            justifyContent: "center",
            paddingHorizontal: 22,
          }}
        >
          <View
            style={{
              backgroundColor: "#1C1C1E",
              borderRadius: 24,
              borderWidth: 1,
              borderColor: "#2C2C2E",
              padding: 20,
            }}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: 20,
                fontWeight: "900",
                marginBottom: 8,
              }}
            >
              {templateNamePrompt.title}
            </Text>
            <Text
              style={{
                color: "#A1A1AA",
                fontSize: 14,
                lineHeight: 20,
                marginBottom: 16,
              }}
            >
              {templateNamePrompt.message}
            </Text>
            <TextInput
              value={templateNameInput}
              onChangeText={setTemplateNameInput}
              placeholder="Template name"
              placeholderTextColor="#6B7280"
              autoFocus
              selectTextOnFocus
              style={{
                minHeight: 52,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "#3A3A3C",
                backgroundColor: "#111113",
                color: "#FFFFFF",
                paddingHorizontal: 16,
                fontSize: 16,
                fontWeight: "700",
                marginBottom: 18,
              }}
              returnKeyType="done"
              onSubmitEditing={confirmTemplateNamePrompt}
            />
            <View style={{ flexDirection: "row" }}>
              <TouchableOpacity
                style={[
                  styles.finishButton,
                  { flex: 1, backgroundColor: "#2C2C2E", marginRight: 8 },
                ]}
                onPress={() => {
                  setTemplateNamePrompt((prev) => ({
                    ...prev,
                    visible: false,
                  }));
                  setTimeout(openFinishSummary, 250);
                }}
              >
                <Text style={[styles.finishButtonText, { color: "#FFFFFF" }]}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.finishButton,
                  { flex: 1, backgroundColor: "#32D74B", marginLeft: 8 },
                ]}
                onPress={confirmTemplateNamePrompt}
              >
                <Text style={[styles.finishButtonText, { color: "#000000" }]}>
                  Save
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isSummaryVisible}
        animationType="slide"
        presentationStyle="fullScreen"
      >
        <View style={[styles.screen, { paddingTop: insets.top }]}>
          {(() => {
            const data = getSummaryData();
            if (!data) return null;

            const formatShareVolume = (value: number) => {
              const rounded = Math.round(value || 0);
              if (rounded >= 1000) {
                const compact = rounded / 1000;
                return `${compact % 1 === 0 ? compact.toFixed(0) : compact.toFixed(1)}k`;
              }
              return `${rounded}`;
            };

            const formatFullVolume = (value: number) => {
              const rounded = Math.round(value || 0);
              return rounded.toLocaleString();
            };

            const getSetVolume = (ex: any, set: any) => {
              const weight = parseFloat(set.weight || "0") || 0;
              if (ex.is_unilateral) {
                return (
                  weight *
                  ((parseInt(set.repsL || "0") || 0) +
                    (parseInt(set.repsR || "0") || 0))
                );
              }
              return weight * (parseInt(set.reps || "0") || 0);
            };

            const getSetRepsLabel = (ex: any, set: any) => {
              if (ex.is_unilateral)
                return `${set.repsL || 0}L / ${set.repsR || 0}R`;
              return `${set.reps || 0}`;
            };

            const formatBestSet = (ex: any, set: any) => {
              const weight = parseFloat(set.weight || "0") || 0;
              const weightLabel = Number.isInteger(weight)
                ? weight.toFixed(0)
                : weight.toFixed(1);
              return `${weightLabel}${isKg ? "kg" : "lbs"} × ${getSetRepsLabel(ex, set)}`;
            };

            const getSetRepsForStrengthScore = (ex: any, set: any) => {
              if (ex.is_unilateral) {
                return Math.max(
                  parseInt(set.repsL || "0") || 0,
                  parseInt(set.repsR || "0") || 0,
                );
              }
              return parseInt(set.reps || "0") || 0;
            };

            const getSetStrengthScore = (ex: any, set: any) => {
              const weight = parseFloat(set.weight || "0") || 0;
              const reps = getSetRepsForStrengthScore(ex, set);
              if (weight <= 0 || reps <= 0 || reps > 36) return 0;
              return weight * (1 + reps / 30);
            };

            const allCompletedSets = data.exercises.flatMap((ex: any) =>
              ex.sets.map((set: any) => ({
                exerciseName: formatExerciseDisplayName(ex),
                weight: parseFloat(set.weight || "0") || 0,
                repsLabel: getSetRepsLabel(ex, set),
                volume: getSetVolume(ex, set),
                strengthScore: getSetStrengthScore(ex, set),
                isUnilateral: !!ex.is_unilateral,
              })),
            );

            const rankedTopSets = [...allCompletedSets].sort(
              (a: any, b: any) => {
                if (b.strengthScore !== a.strengthScore) {
                  return b.strengthScore - a.strengthScore;
                }
                return b.volume - a.volume;
              },
            );

            const topSets = rankedTopSets.slice(0, 5);
            const shareTopSets = rankedTopSets.slice(0, 3);

            const exerciseBreakdown = data.exercises.map((ex: any) => {
              const completedSets = ex.sets || [];
              const bestSet = completedSets
                .slice()
                .sort(
                  (a: any, b: any) => getSetVolume(ex, b) - getSetVolume(ex, a),
                )[0];
              const totalExerciseVolume = completedSets.reduce(
                (sum: number, set: any) => sum + getSetVolume(ex, set),
                0,
              );
              return {
                name: formatExerciseDisplayName(ex),
                setCount: completedSets.length,
                bestSetLabel: bestSet ? formatBestSet(ex, bestSet) : "—",
                volume: totalExerciseVolume,
              };
            });

            const exercisePreview = data.exercises.slice(0, 6);
            const summaryPRGroups = getGroupedWorkoutPRs(
              Array.isArray(data.prs) ? data.prs : [],
              4,
            );
            const gymLine = data.gymName ? ` • ${data.gymName}` : "";
            const newPrCount = getWorkoutPRDisplayCount(
              Array.isArray(data.prs) ? data.prs : [],
            );
            const primaryTitle =
              summaryType === "finish" ? "Workout Complete" : "Workout Summary";

            const closeSummary = (destination: "home" | "history" = "home") => {
              setTemplateNamePrompt((prev) => ({ ...prev, visible: false }));
              setIsSummaryVisible(false);
              if (summaryType !== "finish") return;

              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              );
              setIsEditable(false);

              navigation.reset({
                index: 0,
                routes: [
                  destination === "history"
                    ? { name: "Home", params: { screen: "History" } }
                    : { name: "Home" },
                ],
              });
            };

            const ShareCard = ({ capture = false }: { capture?: boolean }) => {
              const unitLabel = isKg ? "kg" : "lbs";
              const statItems = [
                {
                  label: "Volume",
                  value: `${formatFullVolume(data.volume)} ${unitLabel.toUpperCase()}`,
                },
                { label: "Exercises", value: `${data.exercises.length}` },
                { label: "Sets", value: `${data.totalSets}` },
              ];

              const getBestStrengthSetForExercise = (ex: any) => {
                const completedSets = Array.isArray(ex.sets) ? ex.sets : [];
                return completedSets.slice().sort((a: any, b: any) => {
                  const strengthDiff =
                    getSetStrengthScore(ex, b) - getSetStrengthScore(ex, a);
                  if (strengthDiff !== 0) return strengthDiff;
                  return getSetVolume(ex, b) - getSetVolume(ex, a);
                })[0];
              };

              const exerciseSetGroups = data.exercises
                .map((ex: any) => {
                  const completedSets = Array.isArray(ex.sets) ? ex.sets : [];
                  const bestSet = getBestStrengthSetForExercise(ex);
                  return {
                    name: formatExerciseDisplayName(ex),
                    exercise: ex,
                    sets: completedSets,
                    bestSet,
                    bestSetLabel: bestSet ? formatBestSet(ex, bestSet) : "—",
                    setCount: completedSets.length,
                  };
                })
                .filter((item: any) => item.setCount > 0);

              const exerciseCount = exerciseSetGroups.length;
              const isSingleExercise = exerciseCount === 1;
              const isDenseWorkout = exerciseCount >= 6;
              const maxVisibleExercises =
                exerciseCount >= 9 ? 8 : exerciseCount;
              const visibleExerciseGroups = exerciseSetGroups.slice(
                0,
                maxVisibleExercises,
              );
              const hiddenExerciseCount = Math.max(
                exerciseCount - visibleExerciseGroups.length,
                0,
              );
              const setsPerExercise =
                exerciseCount <= 3 ? 3 : exerciseCount <= 5 ? 2 : 1;
              const singleExercise = isSingleExercise
                ? exerciseSetGroups[0]
                : null;
              const singleSets = singleExercise ? singleExercise.sets : [];
              const visibleSingleSets = singleSets.slice(0, 10);
              const hiddenSingleSetCount = Math.max(
                singleSets.length - visibleSingleSets.length,
                0,
              );

              const getRangeLabel = (
                items: any[],
                mapper: (set: any) => number,
              ) => {
                const values = items
                  .map(mapper)
                  .filter(
                    (value: number) => Number.isFinite(value) && value > 0,
                  );
                if (values.length === 0) return "—";
                const min = Math.min(...values);
                const max = Math.max(...values);
                const format = (value: number) =>
                  Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
                return min === max
                  ? format(max)
                  : `${format(min)}–${format(max)}`;
              };

              const singleWeightRange = singleExercise
                ? `${getRangeLabel(singleSets, (set: any) => parseFloat(set.weight || "0") || 0)} ${unitLabel}`
                : "—";
              const singleRepRange = singleExercise
                ? getRangeLabel(singleSets, (set: any) =>
                    getSetRepsForStrengthScore(singleExercise.exercise, set),
                  )
                : "—";

              const getVisibleSetsForGroup = (item: any) => {
                if (isDenseWorkout) return item.bestSet ? [item.bestSet] : [];
                return item.sets.slice(0, setsPerExercise);
              };

              return (
                <View
                  style={{
                    width: capture ? 380 : "100%",
                    maxWidth: 380,
                    minHeight: capture ? 0 : 520,
                    maxHeight: 380 * (16 / 9),
                    backgroundColor: "#0B0B0D",
                    borderRadius: capture ? 0 : 30,
                    padding: 26,
                    borderWidth: capture ? 0 : 1,
                    borderColor: "#242426",
                    overflow: "hidden",
                  }}
                  collapsable={false}
                >
                  <View>
                    <View>
                      <Text
                        style={{
                          color: "#FFFFFF",
                          fontSize: 31,
                          lineHeight: 35,
                          fontWeight: "900",
                          letterSpacing: -0.9,
                        }}
                        numberOfLines={2}
                        adjustsFontSizeToFit
                      >
                        {data.name}
                      </Text>
                      <Text
                        style={{
                          color: "#8E8E93",
                          fontSize: 13,
                          fontWeight: "800",
                          marginTop: 10,
                        }}
                        numberOfLines={1}
                      >
                        {data.date} · {data.duration}
                      </Text>
                    </View>

                    <View
                      style={{
                        flexDirection: "row",
                        marginTop: 24,
                        marginHorizontal: -5,
                      }}
                    >
                      {statItems.map((item) => (
                        <View
                          key={item.label}
                          style={{ flex: 1, paddingHorizontal: 5 }}
                        >
                          <View
                            style={{
                              backgroundColor: "rgba(28, 28, 30, 0.62)",
                              borderRadius: 18,
                              paddingVertical: 14,
                              paddingHorizontal: 10,
                              borderWidth: 1,
                              borderColor: "rgba(255, 255, 255, 0.07)",
                            }}
                          >
                            <Text
                              style={{
                                color: "#FFFFFF",
                                fontSize: 16,
                                fontWeight: "900",
                                textAlign: "center",
                              }}
                              numberOfLines={1}
                              adjustsFontSizeToFit
                              minimumFontScale={0.7}
                            >
                              {item.value}
                            </Text>
                            <Text
                              style={{
                                color: "#8E8E93",
                                fontSize: 9,
                                fontWeight: "900",
                                letterSpacing: 0.75,
                                textTransform: "uppercase",
                                marginTop: 6,
                                textAlign: "center",
                              }}
                              numberOfLines={1}
                            >
                              {item.label}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>

                    {isSingleExercise && singleExercise ? (
                      <>
                        <View
                          style={{
                            marginTop: 22,
                            backgroundColor: "rgba(28, 28, 30, 0.58)",
                            borderRadius: 22,
                            padding: 17,
                            borderWidth: 1,
                            borderColor: "rgba(255, 255, 255, 0.08)",
                          }}
                        >
                          <Text
                            style={{
                              color: "#8E8E93",
                              fontSize: 10,
                              fontWeight: "900",
                              letterSpacing: 1,
                              textTransform: "uppercase",
                            }}
                            numberOfLines={1}
                          >
                            Top Set
                          </Text>
                          <Text
                            style={{
                              color: "#FFFFFF",
                              fontSize: 29,
                              lineHeight: 34,
                              fontWeight: "900",
                              letterSpacing: -0.9,
                              marginTop: 8,
                            }}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.75}
                          >
                            {singleExercise.bestSetLabel}
                          </Text>
                          <Text
                            style={{
                              color: "#8E8E93",
                              fontSize: 13,
                              fontWeight: "800",
                              marginTop: 8,
                            }}
                            numberOfLines={1}
                          >
                            {singleExercise.name}
                          </Text>
                        </View>

                        <View
                          style={{
                            flexDirection: "row",
                            marginTop: 12,
                            marginHorizontal: -5,
                          }}
                        >
                          {[
                            { label: "Weight Range", value: singleWeightRange },
                            { label: "Rep Range", value: singleRepRange },
                          ].map((item) => (
                            <View
                              key={item.label}
                              style={{ flex: 1, paddingHorizontal: 5 }}
                            >
                              <View
                                style={{
                                  backgroundColor: "rgba(28, 28, 30, 0.46)",
                                  borderRadius: 18,
                                  paddingVertical: 13,
                                  paddingHorizontal: 12,
                                  borderWidth: 1,
                                  borderColor: "rgba(255, 255, 255, 0.065)",
                                }}
                              >
                                <Text
                                  style={{
                                    color: "#FFFFFF",
                                    fontSize: 16,
                                    fontWeight: "900",
                                  }}
                                  numberOfLines={1}
                                  adjustsFontSizeToFit
                                  minimumFontScale={0.76}
                                >
                                  {item.value}
                                </Text>
                                <Text
                                  style={{
                                    color: "#8E8E93",
                                    fontSize: 9,
                                    fontWeight: "900",
                                    letterSpacing: 0.75,
                                    textTransform: "uppercase",
                                    marginTop: 5,
                                  }}
                                  numberOfLines={1}
                                >
                                  {item.label}
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>

                        <View
                          style={{
                            marginTop: 16,
                            backgroundColor: "rgba(28, 28, 30, 0.46)",
                            borderRadius: 22,
                            padding: 16,
                            borderWidth: 1,
                            borderColor: "rgba(255, 255, 255, 0.07)",
                          }}
                        >
                          <Text
                            style={{
                              color: "#FFFFFF",
                              fontSize: 14,
                              fontWeight: "900",
                              letterSpacing: 0.2,
                              marginBottom: 10,
                            }}
                          >
                            Working Sets
                          </Text>

                          {visibleSingleSets.map((set: any, index: number) => (
                            <View
                              key={`single-set-${index}`}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                paddingVertical: 6,
                                borderTopWidth: index === 0 ? 0 : 1,
                                borderTopColor: "rgba(255, 255, 255, 0.06)",
                              }}
                            >
                              <Text
                                style={{
                                  color: "#8E8E93",
                                  fontSize: 11,
                                  fontWeight: "900",
                                  width: 24,
                                }}
                              >
                                {index + 1}
                              </Text>
                              <Text
                                style={{
                                  color: "#FFFFFF",
                                  fontSize: 13,
                                  fontWeight: "800",
                                  flex: 1,
                                }}
                                numberOfLines={1}
                              >
                                {formatBestSet(singleExercise.exercise, set)}
                              </Text>
                            </View>
                          ))}

                          {hiddenSingleSetCount > 0 ? (
                            <Text
                              style={{
                                color: "#8E8E93",
                                fontSize: 12,
                                fontWeight: "900",
                                marginTop: 9,
                              }}
                              numberOfLines={1}
                            >
                              +{hiddenSingleSetCount} more set
                              {hiddenSingleSetCount === 1 ? "" : "s"}
                            </Text>
                          ) : null}
                        </View>
                      </>
                    ) : (
                      <View
                        style={{
                          marginTop: 24,
                          backgroundColor: "rgba(28, 28, 30, 0.58)",
                          borderRadius: 22,
                          padding: exerciseCount <= 5 ? 17 : 16,
                          borderWidth: 1,
                          borderColor: "rgba(255, 255, 255, 0.08)",
                        }}
                      >
                        <Text
                          style={{
                            color: "#FFFFFF",
                            fontSize: 14,
                            fontWeight: "900",
                            letterSpacing: 0.2,
                            marginBottom: exerciseCount <= 5 ? 12 : 10,
                          }}
                        >
                          Working Sets
                        </Text>

                        {visibleExerciseGroups.map(
                          (item: any, index: number) => {
                            const visibleSets = getVisibleSetsForGroup(item);
                            const compact = exerciseCount >= 6;

                            return (
                              <View
                                key={`${item.name}-${index}`}
                                style={{
                                  paddingVertical: compact ? 7 : 10,
                                  borderTopWidth: index === 0 ? 0 : 1,
                                  borderTopColor: "rgba(255, 255, 255, 0.065)",
                                }}
                              >
                                <View
                                  style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    marginBottom: compact ? 0 : 7,
                                  }}
                                >
                                  <Text
                                    style={{
                                      color: "#FFFFFF",
                                      fontSize: compact ? 12 : 13,
                                      fontWeight: "900",
                                      flex: 1,
                                      paddingRight: 10,
                                    }}
                                    numberOfLines={1}
                                  >
                                    {item.name}
                                  </Text>
                                  {compact ? (
                                    <Text
                                      style={{
                                        color: "#32D74B",
                                        fontSize: 12,
                                        fontWeight: "900",
                                      }}
                                      numberOfLines={1}
                                      adjustsFontSizeToFit
                                      minimumFontScale={0.78}
                                    >
                                      {item.bestSetLabel}
                                    </Text>
                                  ) : (
                                    <Text
                                      style={{
                                        color: "#8E8E93",
                                        fontSize: 10,
                                        fontWeight: "900",
                                      }}
                                      numberOfLines={1}
                                    >
                                      {item.setCount} set
                                      {item.setCount === 1 ? "" : "s"}
                                    </Text>
                                  )}
                                </View>

                                {!compact
                                  ? visibleSets.map(
                                      (set: any, setIndex: number) => (
                                        <Text
                                          key={`${item.name}-set-${setIndex}`}
                                          style={{
                                            color:
                                              setIndex === 0
                                                ? "#32D74B"
                                                : "#D1D1D6",
                                            fontSize: 12,
                                            fontWeight:
                                              setIndex === 0 ? "900" : "800",
                                            lineHeight: 18,
                                          }}
                                          numberOfLines={1}
                                        >
                                          {formatBestSet(item.exercise, set)}
                                        </Text>
                                      ),
                                    )
                                  : null}
                              </View>
                            );
                          },
                        )}

                        {hiddenExerciseCount > 0 ? (
                          <Text
                            style={{
                              color: "#8E8E93",
                              fontSize: 12,
                              fontWeight: "900",
                              marginTop: 10,
                            }}
                            numberOfLines={1}
                          >
                            +{hiddenExerciseCount} more exercise
                            {hiddenExerciseCount === 1 ? "" : "s"}
                          </Text>
                        ) : null}
                      </View>
                    )}
                  </View>
                </View>
              );
            };

            return (
              <View style={{ flex: 1 }}>
                <View
                  style={{ position: "absolute", top: -10000, left: -10000 }}
                >
                  <ViewShot
                    ref={igCardRef}
                    options={{ format: "png", quality: 1.0 }}
                    style={{ backgroundColor: "transparent", width: 380 }}
                  >
                    <ShareCard capture />
                  </ViewShot>
                </View>

                <View
                  style={{
                    paddingHorizontal: 20,
                    paddingTop: 18,
                    paddingBottom: 14,
                    borderBottomWidth: 1,
                    borderBottomColor: "#1F1F21",
                  }}
                >
                  <Text
                    style={{
                      color: "#8E8E93",
                      fontSize: 12,
                      fontWeight: "900",
                      letterSpacing: 1.1,
                      textTransform: "uppercase",
                      textAlign: "center",
                    }}
                  >
                    {summaryType === "finish"
                      ? "Session Saved"
                      : "Share Preview"}
                  </Text>
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 22,
                      fontWeight: "900",
                      textAlign: "center",
                      marginTop: 5,
                    }}
                  >
                    {primaryTitle}
                  </Text>
                </View>

                <ScrollView
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{
                    paddingHorizontal: 20,
                    paddingTop: 18,
                    paddingBottom: 24,
                  }}
                >
                  {summaryType === "finish" ? (
                    <>
                      <View
                        style={{
                          backgroundColor: "#1C1C1E",
                          borderRadius: 28,
                          padding: 20,
                          borderWidth: 1,
                          borderColor: "#2C2C2E",
                          marginBottom: 14,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            marginBottom: 16,
                          }}
                        >
                          <View
                            style={{
                              width: 46,
                              height: 46,
                              borderRadius: 23,
                              backgroundColor: "rgba(50, 215, 75, 0.14)",
                              alignItems: "center",
                              justifyContent: "center",
                              marginRight: 13,
                            }}
                          >
                            <Ionicons
                              name="checkmark"
                              size={25}
                              color="#32D74B"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                color: "#FFFFFF",
                                fontSize: 22,
                                fontWeight: "900",
                                letterSpacing: -0.5,
                              }}
                              numberOfLines={2}
                            >
                              {data.name}
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
                              {data.date}
                              {gymLine} • {data.duration}
                            </Text>
                          </View>
                        </View>

                        <View
                          style={{ flexDirection: "row", marginHorizontal: -5 }}
                        >
                          {[
                            {
                              label: "Exercises",
                              value: `${data.exercises.length}`,
                            },
                            { label: "Sets", value: `${data.totalSets}` },
                            {
                              label: "Volume",
                              value: `${formatFullVolume(data.volume)} ${isKg ? "kg" : "lbs"}`,
                            },
                          ].map((item) => (
                            <View
                              key={item.label}
                              style={{ flex: 1, paddingHorizontal: 5 }}
                            >
                              <View
                                style={{
                                  backgroundColor: "#121214",
                                  borderRadius: 18,
                                  paddingVertical: 14,
                                  paddingHorizontal: 10,
                                  borderWidth: 1,
                                  borderColor: "#2C2C2E",
                                  minHeight: 76,
                                  justifyContent: "center",
                                }}
                              >
                                <Text
                                  style={{
                                    color: "#FFFFFF",
                                    fontSize: item.label === "Volume" ? 15 : 20,
                                    fontWeight: "900",
                                    textAlign: "center",
                                  }}
                                  numberOfLines={1}
                                  adjustsFontSizeToFit
                                >
                                  {item.value}
                                </Text>
                                <Text
                                  style={{
                                    color: "#8E8E93",
                                    fontSize: 10,
                                    fontWeight: "900",
                                    letterSpacing: 0.7,
                                    textTransform: "uppercase",
                                    textAlign: "center",
                                    marginTop: 6,
                                  }}
                                  numberOfLines={1}
                                >
                                  {item.label}
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>

                        {newPrCount > 0 ? (
                          <View
                            style={{
                              marginTop: 14,
                              borderRadius: 18,
                              paddingVertical: 11,
                              paddingHorizontal: 13,
                              backgroundColor: "rgba(50, 215, 75, 0.12)",
                              borderWidth: 1,
                              borderColor: "rgba(50, 215, 75, 0.3)",
                              flexDirection: "row",
                              alignItems: "center",
                            }}
                          >
                            <Ionicons
                              name="trophy"
                              size={16}
                              color="#32D74B"
                              style={{ marginRight: 9 }}
                            />
                            <Text
                              style={{
                                color: "#32D74B",
                                fontSize: 13,
                                fontWeight: "900",
                                flex: 1,
                              }}
                              numberOfLines={1}
                            >
                              {newPrCount} New PR{newPrCount === 1 ? "" : "s"}{" "}
                              detected
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <View
                        style={{
                          backgroundColor: "#1C1C1E",
                          borderRadius: 24,
                          padding: 18,
                          borderWidth: 1,
                          borderColor: "#2C2C2E",
                          marginBottom: 14,
                        }}
                      >
                        <Text
                          style={{
                            color: "#FFFFFF",
                            fontSize: 16,
                            fontWeight: "900",
                            marginBottom: 12,
                          }}
                        >
                          {summaryPRGroups.length > 0 ? "New PRs" : "Top Sets"}
                        </Text>
                        {summaryPRGroups.length > 0
                          ? summaryPRGroups.map((group: any, index: number) => (
                              <View
                                key={
                                  group.key || `${group.exerciseName}-${index}`
                                }
                                style={{
                                  flexDirection: "row",
                                  alignItems: "flex-start",
                                  paddingVertical: 10,
                                  borderTopWidth: index === 0 ? 0 : 1,
                                  borderTopColor: "#2C2C2E",
                                }}
                              >
                                <Ionicons
                                  name="trophy"
                                  size={15}
                                  color="#32D74B"
                                  style={{ marginRight: 10, marginTop: 3 }}
                                />
                                <View style={{ flex: 1 }}>
                                  <Text
                                    style={{
                                      color: "#FFFFFF",
                                      fontSize: 14,
                                      fontWeight: "900",
                                    }}
                                    numberOfLines={1}
                                  >
                                    {group.exerciseName}
                                  </Text>
                                  {group.records.map((record: any) => (
                                    <View
                                      key={
                                        record.id ||
                                        `${record.label}-${record.reps}`
                                      }
                                      style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        marginTop: 5,
                                      }}
                                    >
                                      <Text
                                        style={{
                                          color: "#8E8E93",
                                          fontSize: 12,
                                          fontWeight: "800",
                                          flex: 1,
                                          paddingRight: 8,
                                        }}
                                        numberOfLines={1}
                                      >
                                        {formatPRSummaryLabel(record)}
                                      </Text>
                                      <Text
                                        style={{
                                          color: "#32D74B",
                                          fontSize: 12,
                                          fontWeight: "900",
                                        }}
                                        numberOfLines={1}
                                      >
                                        {formatPRValue(record)}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                              </View>
                            ))
                          : topSets.map((set: any, index: number) => (
                              <View
                                key={`${set.exerciseName}-${index}`}
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  paddingVertical: 10,
                                  borderTopWidth: index === 0 ? 0 : 1,
                                  borderTopColor: "#2C2C2E",
                                }}
                              >
                                <Text
                                  style={{
                                    color: "#8E8E93",
                                    fontSize: 12,
                                    fontWeight: "900",
                                    width: 24,
                                  }}
                                >
                                  {index + 1}
                                </Text>
                                <Text
                                  style={{
                                    color: "#FFFFFF",
                                    fontSize: 14,
                                    fontWeight: "800",
                                    flex: 1,
                                    paddingRight: 10,
                                  }}
                                  numberOfLines={1}
                                >
                                  {set.exerciseName}
                                </Text>
                                <Text
                                  style={{
                                    color: "#32D74B",
                                    fontSize: 13,
                                    fontWeight: "900",
                                  }}
                                  numberOfLines={1}
                                >
                                  {Number.isInteger(set.weight)
                                    ? set.weight.toFixed(0)
                                    : set.weight.toFixed(1)}{" "}
                                  {isKg ? "kg" : "lbs"} × {set.repsLabel}
                                </Text>
                              </View>
                            ))}
                      </View>

                      <View
                        style={{
                          backgroundColor: "#1C1C1E",
                          borderRadius: 24,
                          padding: 18,
                          borderWidth: 1,
                          borderColor: "#2C2C2E",
                        }}
                      >
                        <Text
                          style={{
                            color: "#FFFFFF",
                            fontSize: 16,
                            fontWeight: "900",
                            marginBottom: 8,
                          }}
                        >
                          Exercise Breakdown
                        </Text>
                        {exerciseBreakdown.map((item: any, index: number) => (
                          <View
                            key={`${item.name}-${index}`}
                            style={{
                              paddingVertical: 12,
                              borderTopWidth: index === 0 ? 0 : 1,
                              borderTopColor: "#2C2C2E",
                            }}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                              }}
                            >
                              <Text
                                style={{
                                  color: "#FFFFFF",
                                  fontSize: 14,
                                  fontWeight: "900",
                                  flex: 1,
                                  paddingRight: 10,
                                }}
                                numberOfLines={1}
                              >
                                {item.name}
                              </Text>
                              <Text
                                style={{
                                  color: "#8E8E93",
                                  fontSize: 12,
                                  fontWeight: "800",
                                }}
                                numberOfLines={1}
                              >
                                {item.setCount} set
                                {item.setCount === 1 ? "" : "s"}
                              </Text>
                            </View>
                            <Text
                              style={{
                                color: "#32D74B",
                                fontSize: 12,
                                fontWeight: "800",
                                marginTop: 5,
                              }}
                              numberOfLines={1}
                            >
                              Best {item.bestSetLabel} •{" "}
                              {formatFullVolume(item.volume)}{" "}
                              {isKg ? "kg" : "lbs"}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </>
                  ) : (
                    <View style={{ alignItems: "center" }}>
                      <ShareCard />
                    </View>
                  )}
                </ScrollView>

                <View
                  style={{
                    paddingHorizontal: 20,
                    paddingTop: 12,
                    paddingBottom: Math.max(insets.bottom, 18),
                    borderTopWidth: 1,
                    borderTopColor: "#1F1F21",
                    backgroundColor: "#000000",
                  }}
                >
                  {summaryType === "finish" ? (
                    <>
                      <View style={{ flexDirection: "row", marginBottom: 10 }}>
                        <TouchableOpacity
                          style={[
                            styles.finishButton,
                            {
                              flex: 1,
                              backgroundColor: "#2C2C2E",
                              marginRight: 8,
                            },
                          ]}
                          onPress={() => closeSummary("history")}
                        >
                          <Text
                            style={[styles.finishButtonText, { color: "#FFF" }]}
                          >
                            View History
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.finishButton,
                            {
                              flex: 1,
                              backgroundColor: "#2C2C2E",
                              marginLeft: 8,
                            },
                          ]}
                          onPress={handleSaveImage}
                        >
                          <Text
                            style={[styles.finishButtonText, { color: "#FFF" }]}
                          >
                            Save Image
                          </Text>
                        </TouchableOpacity>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.finishButton,
                          { backgroundColor: "#32D74B" },
                        ]}
                        onPress={() => closeSummary("home")}
                      >
                        <Text
                          style={[styles.finishButtonText, { color: "#000" }]}
                        >
                          Done
                        </Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <View style={{ flexDirection: "row" }}>
                      <TouchableOpacity
                        style={[
                          styles.finishButton,
                          {
                            flex: 1,
                            backgroundColor: "#2C2C2E",
                            marginRight: 10,
                          },
                        ]}
                        onPress={() => setIsSummaryVisible(false)}
                      >
                        <Text
                          style={[styles.finishButtonText, { color: "#FFF" }]}
                        >
                          Close
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.finishButton,
                          {
                            flex: 1,
                            backgroundColor: "#32D74B",
                            marginLeft: 10,
                          },
                        ]}
                        onPress={handleSaveImage}
                      >
                        <Text
                          style={[styles.finishButtonText, { color: "#000" }]}
                        >
                          Save Image
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            );
          })()}
        </View>
      </Modal>

      <Modal visible={isExerciseMenuVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsExerciseMenuVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.actionMenuContent}>
            <Text style={styles.actionMenuTitle}>Exercise Options</Text>
            <Text style={styles.actionMenuSubtitle} numberOfLines={1}>
              {selectedExerciseIndex !== null
                ? formatExerciseDisplayName(exercises[selectedExerciseIndex])
                : "Exercise"}
            </Text>

            <TouchableOpacity
              style={styles.actionSheetRow}
              onPress={() => {
                if (selectedExerciseIndex !== null) {
                  const selectedExercise = exercises[selectedExerciseIndex];
                  setIsExerciseMenuVisible(false);
                  showExerciseHistory(selectedExercise);
                }
              }}
            >
              <View style={styles.actionSheetIconCircle}>
                <Ionicons name="time-outline" size={20} color="#32D74B" />
              </View>
              <View style={styles.actionSheetTextBlock}>
                <Text style={styles.actionSheetRowTitle}>View History</Text>
                <Text style={styles.actionSheetRowSubtitle}>
                  Previous sessions, gyms, and equipment context
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#8E8E93" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionSheetRow}
              onPress={() =>
                selectedExerciseIndex !== null &&
                handleReplaceExercise(selectedExerciseIndex)
              }
            >
              <View style={styles.actionSheetIconCircle}>
                <Ionicons
                  name="swap-horizontal-outline"
                  size={20}
                  color="#32D74B"
                />
              </View>
              <View style={styles.actionSheetTextBlock}>
                <Text style={styles.actionSheetRowTitle}>Replace Exercise</Text>
                <Text style={styles.actionSheetRowSubtitle}>
                  Keep set rows, clear remarks, and swap movement
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#8E8E93" />
            </TouchableOpacity>

            {selectedExerciseIndex !== null &&
            exercises[selectedExerciseIndex]?.supersetId ? (
              <TouchableOpacity
                style={styles.actionSheetRow}
                onPress={removeSelectedSuperset}
              >
                <View style={styles.actionSheetIconCircle}>
                  <Ionicons name="unlink-outline" size={20} color="#32D74B" />
                </View>
                <View style={styles.actionSheetTextBlock}>
                  <Text style={styles.actionSheetRowTitle}>
                    Remove From Superset
                  </Text>
                  <Text style={styles.actionSheetRowSubtitle}>
                    Ungroup these exercises without deleting them
                  </Text>
                </View>
              </TouchableOpacity>
            ) : exercises.length > 1 ? (
              <TouchableOpacity
                style={styles.actionSheetRow}
                onPress={openCreateSupersetModal}
              >
                <View style={styles.actionSheetIconCircle}>
                  <Ionicons
                    name="git-merge-outline"
                    size={20}
                    color="#32D74B"
                  />
                </View>
                <View style={styles.actionSheetTextBlock}>
                  <Text style={styles.actionSheetRowTitle}>
                    Create Superset
                  </Text>
                  <Text style={styles.actionSheetRowSubtitle}>
                    Group this exercise with another movement
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#8E8E93" />
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.actionSheetRow, styles.actionSheetRowDanger]}
              onPress={() => {
                if (selectedExerciseIndex === null) return;
                const exerciseToDelete = exercises[selectedExerciseIndex];
                const completedCount = (exerciseToDelete?.sets || []).filter(
                  (set: any) => !!set.completed,
                ).length;

                const deleteExercise = () => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                  setExercises((prev) =>
                    prev.filter(
                      (_: any, i: number) => i !== selectedExerciseIndex,
                    ),
                  );
                  setIsExerciseMenuVisible(false);
                  setHasUnsavedChanges(true);
                };

                if (completedCount > 0) {
                  Alert.alert(
                    `Delete ${exerciseToDelete?.name || "exercise"}?`,
                    `This will remove ${completedCount} completed set${
                      completedCount === 1 ? "" : "s"
                    } from this workout.`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: deleteExercise,
                      },
                    ],
                  );
                } else {
                  deleteExercise();
                }
              }}
            >
              <View
                style={[
                  styles.actionSheetIconCircle,
                  styles.actionSheetIconCircleDanger,
                ]}
              >
                <Ionicons name="trash-outline" size={20} color="#FF3B30" />
              </View>
              <View style={styles.actionSheetTextBlock}>
                <Text
                  style={[styles.actionSheetRowTitle, { color: "#FF3B30" }]}
                >
                  Delete Exercise
                </Text>
                <Text style={styles.actionSheetRowSubtitle}>
                  Remove this exercise and all its sets
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionMenuBtnCancel}
              onPress={() => setIsExerciseMenuVisible(false)}
            >
              <Text style={styles.actionMenuBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={isSupersetModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.actionMenuCard}>
            <Text style={styles.actionMenuTitle}>Create Superset</Text>
            <Text style={styles.actionMenuSubtitle}>
              {selectedExerciseIndex !== null
                ? `${formatExerciseDisplayName(exercises[selectedExerciseIndex])} is included. Select exercises to pair with it.`
                : "Select exercises to group together."}
            </Text>

            <ScrollView
              style={{ maxHeight: 320 }}
              showsVerticalScrollIndicator={false}
            >
              {exercises.map((ex, idx) => {
                const isBase = idx === selectedExerciseIndex;
                const checked = supersetSelectedIndexes.includes(idx);
                return (
                  <TouchableOpacity
                    key={ex.id || `${ex.name}-${idx}`}
                    style={styles.supersetPickerRow}
                    disabled={isBase}
                    onPress={() => {
                      setSupersetSelectedIndexes((prev) =>
                        prev.includes(idx)
                          ? prev.filter((item) => item !== idx)
                          : [...prev, idx],
                      );
                    }}
                  >
                    <View
                      style={[
                        styles.supersetPickerCheck,
                        checked && styles.supersetPickerCheckActive,
                      ]}
                    >
                      {checked && (
                        <Ionicons name="checkmark" size={15} color="#000" />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text
                        style={styles.supersetPickerTitle}
                        numberOfLines={1}
                      >
                        {formatExerciseDisplayName(ex)}
                      </Text>
                      <Text style={styles.supersetPickerMeta}>
                        {isBase
                          ? "Included"
                          : ex.supersetId
                            ? "Currently in another superset"
                            : "Tap to include"}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.reorderModalFooter}>
              <TouchableOpacity
                style={styles.reorderModalCancelButton}
                onPress={() => {
                  setIsSupersetModalVisible(false);
                  setSupersetSelectedIndexes([]);
                }}
              >
                <Text style={styles.reorderModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.reorderModalDoneButton}
                onPress={createSupersetFromSelection}
              >
                <Text style={styles.reorderModalDoneText}>Create Superset</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={isTagModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            style={{
              flex: 1,
              width: "100%",
              justifyContent: "center",
              alignItems: "center",
            }}
            activeOpacity={1}
            onPress={() => {
              setIsTagModalVisible(false);
              setTagSearchQuery("");
            }}
          >
            <TouchableOpacity
              activeOpacity={1}
              style={{
                backgroundColor: "#1C1C1E",
                borderRadius: 24,
                width: "90%",
                maxHeight: "80%",
                overflow: "hidden",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 10 },
                shadowOpacity: 0.5,
                shadowRadius: 20,
                elevation: 10,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingHorizontal: 20,
                  paddingVertical: 18,
                  borderBottomWidth: 1,
                  borderBottomColor: "#2C2C2E",
                }}
              >
                <TouchableOpacity
                  style={{ zIndex: 10, width: 60 }}
                  onPress={() => {
                    setIsTagModalVisible(false);
                    setTagSearchQuery("");
                  }}
                >
                  <Text
                    style={{
                      color: "#FF3B30",
                      fontSize: 16,
                      fontWeight: "600",
                    }}
                  >
                    Cancel
                  </Text>
                </TouchableOpacity>

                <View
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    alignItems: "center",
                    pointerEvents: "none",
                  }}
                >
                  <Text
                    style={{ color: "#FFF", fontSize: 17, fontWeight: "700" }}
                  >
                    Equipment
                  </Text>
                </View>

                <View style={{ zIndex: 10, width: 60, alignItems: "flex-end" }}>
                  {exercises[tagExIdx || 0]?.equipmentTag ? (
                    <TouchableOpacity
                      onPress={() => {
                        setExercises((prev) => {
                          const up = [...prev];
                          delete up[tagExIdx!].equipmentTag;
                          return up;
                        });
                        setHasUnsavedChanges(true);
                        setIsTagModalVisible(false);
                      }}
                    >
                      <Text
                        style={{
                          color: "#FF9F0A",
                          fontSize: 16,
                          fontWeight: "600",
                        }}
                      >
                        Clear
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>

              <View style={{ padding: 16, backgroundColor: "#1C1C1E" }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: "#2C2C2E",
                    borderRadius: 12,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                  }}
                >
                  <Ionicons
                    name="search"
                    size={20}
                    color="#8E8E93"
                    style={{ marginRight: 8 }}
                  />
                  <TextInput
                    style={{ flex: 1, color: "#FFF", fontSize: 16, padding: 0 }}
                    placeholder="Search or add machine..."
                    placeholderTextColor="#8E8E93"
                    value={tagSearchQuery}
                    onChangeText={setTagSearchQuery}
                    autoFocus
                    selectionColor="#32D74B"
                  />
                </View>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: 16,
                  paddingBottom: 20,
                }}
              >
                {tagSearchQuery.trim() !== "" &&
                  !filteredVariants.some(
                    (v: string) =>
                      v.toLowerCase() === tagSearchQuery.trim().toLowerCase(),
                  ) && (
                    <TouchableOpacity
                      style={{
                        backgroundColor: "rgba(50, 215, 75, 0.1)",
                        borderWidth: 1,
                        borderColor: "rgba(50, 215, 75, 0.3)",
                        borderRadius: 16,
                        padding: 16,
                        flexDirection: "row",
                        alignItems: "center",
                        marginBottom: 16,
                      }}
                      onPress={async () => {
                        Haptics.notificationAsync(
                          Haptics.NotificationFeedbackType.Success,
                        );
                        const newVariant = tagSearchQuery.trim();
                        const updatedGyms = gyms.map((g) =>
                          g.id === selectedGymId
                            ? {
                                ...g,
                                variants: [...(g.variants || []), newVariant],
                              }
                            : g,
                        );
                        setGyms(updatedGyms);
                        await AsyncStorage.setItem(
                          `@user_gyms_${uid}`,
                          JSON.stringify(updatedGyms),
                        );
                        await syncGymsToCloud(updatedGyms);
                        setExercises((prev) => {
                          const up = [...prev];
                          up[tagExIdx!].equipmentTag = newVariant;
                          return up;
                        });
                        setHasUnsavedChanges(true);
                        setIsTagModalVisible(false);
                        setTagSearchQuery("");
                      }}
                    >
                      <Ionicons
                        name="add-circle"
                        size={24}
                        color="#32D74B"
                        style={{ marginRight: 12 }}
                      />
                      <Text
                        style={{
                          color: "#32D74B",
                          fontSize: 16,
                          fontWeight: "700",
                        }}
                      >
                        Add "{tagSearchQuery.trim()}" to Gym
                      </Text>
                    </TouchableOpacity>
                  )}

                {filteredVariants.length > 0 ? (
                  <View
                    style={{
                      backgroundColor: "#2C2C2E",
                      borderRadius: 16,
                      overflow: "hidden",
                    }}
                  >
                    {filteredVariants.map((variant: string, index: number) => {
                      const isSelected =
                        exercises[tagExIdx || 0]?.equipmentTag === variant;
                      const isLast = index === filteredVariants.length - 1;

                      const isDefault =
                        DEFAULT_VARIANTS.includes(variant) ||
                        globalVariants.includes(variant);

                      return (
                        <View
                          key={variant}
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            paddingVertical: 16,
                            paddingHorizontal: 16,
                            borderBottomWidth: isLast ? 0 : 1,
                            borderBottomColor: "#3A3A3C",
                          }}
                        >
                          <TouchableOpacity
                            style={{
                              flex: 1,
                              flexDirection: "row",
                              alignItems: "center",
                            }}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setExercises((prev) => {
                                const up = [...prev];
                                up[tagExIdx!].equipmentTag = variant;
                                return up;
                              });
                              setHasUnsavedChanges(true);
                              setIsTagModalVisible(false);
                              setTagSearchQuery("");
                            }}
                          >
                            <Ionicons
                              name={
                                isSelected
                                  ? "checkmark-circle"
                                  : "ellipse-outline"
                              }
                              size={24}
                              color={isSelected ? "#32D74B" : "#8E8E93"}
                              style={{ marginRight: 12 }}
                            />
                            <Text
                              style={{
                                color: "#FFF",
                                fontSize: 16,
                                fontWeight: "600",
                              }}
                            >
                              {variant}
                            </Text>
                          </TouchableOpacity>

                          {!isDefault && (
                            <TouchableOpacity
                              onPress={() => {
                                Alert.alert(
                                  "Delete Variant",
                                  `Remove "${variant}" from this gym?`,
                                  [
                                    { text: "Cancel", style: "cancel" },
                                    {
                                      text: "Delete",
                                      style: "destructive",
                                      onPress: async () => {
                                        const updatedGyms = gyms.map((g) =>
                                          g.id === selectedGymId
                                            ? {
                                                ...g,
                                                variants: g.variants.filter(
                                                  (v: string) => v !== variant,
                                                ),
                                              }
                                            : g,
                                        );
                                        setGyms(updatedGyms);
                                        await AsyncStorage.setItem(
                                          `@user_gyms_${uid}`,
                                          JSON.stringify(updatedGyms),
                                        );
                                        await syncGymsToCloud(updatedGyms);

                                        if (
                                          exercises[tagExIdx || 0]
                                            ?.equipmentTag === variant
                                        ) {
                                          setExercises((prev) => {
                                            const up = [...prev];
                                            delete up[tagExIdx!].equipmentTag;
                                            return up;
                                          });
                                        }
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
                  </View>
                ) : (
                  tagSearchQuery.trim() === "" && (
                    <Text
                      style={{
                        color: "#8E8E93",
                        textAlign: "center",
                        marginTop: 20,
                      }}
                    >
                      No saved machines yet. Search above to add one!
                    </Text>
                  )
                )}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={isRemarkModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Session Remark</Text>
            <TextInput
              style={[
                styles.modalInput,
                { textAlign: "left", minHeight: 80, fontSize: 16 },
              ]}
              value={currentRemark}
              onChangeText={setCurrentRemark}
              placeholder="e.g., Felt sick, lowered weight."
              placeholderTextColor="#48484A"
              selectionColor="#FFF"
              multiline
              autoFocus
            />
            <View style={styles.modalButtonRow}>
              <TouchableOpacity onPress={() => setIsRemarkModalVisible(false)}>
                <Text style={styles.modalActionText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  if (selectedExerciseIndex !== null) {
                    setExercises((prev) => {
                      const up = [...prev];
                      up[selectedExerciseIndex] = {
                        ...up[selectedExerciseIndex],
                        remark: currentRemark.trim(),
                      };
                      return up;
                    });
                    setHasUnsavedChanges(true);
                  }
                  setIsRemarkModalVisible(false);
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

      <Modal visible={isHistoryModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => setIsHistoryModalVisible(false)}
          />
          <View
            style={[
              styles.actionMenuContent,
              {
                height: Math.min(windowHeight * 0.74, 620),
                maxHeight: windowHeight - insets.top - insets.bottom - 64,
              },
            ]}
          >
            <Text style={styles.actionMenuTitle}>
              {historyExerciseName} History
            </Text>
            <Text style={styles.actionMenuSubtitle}>
              Recent performances from your logged sessions
            </Text>

            <View style={{ width: "100%", marginBottom: 14 }}>
              {historyGymOptions.length > 0 && (
                <View style={{ marginBottom: 12 }}>
                  <Text
                    style={{
                      color: "#8E8E93",
                      fontSize: 11,
                      fontWeight: "800",
                      marginBottom: 8,
                      textTransform: "uppercase",
                    }}
                  >
                    Gym
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                  >
                    {[
                      { label: "All Gyms", value: null },
                      ...historyGymOptions.map((gym) => ({
                        label: gym.name,
                        value: gym.id,
                      })),
                    ].map((filter, idx) => {
                      const active = historyGymFilter === filter.value;
                      return (
                        <TouchableOpacity
                          key={`gym-${filter.value || idx}`}
                          style={{
                            paddingHorizontal: 12,
                            paddingVertical: 8,
                            borderRadius: 999,
                            marginRight: 8,
                            backgroundColor: active ? "#32D74B" : "#2C2C2E",
                            borderWidth: 1,
                            borderColor: active ? "#32D74B" : "#3A3A3C",
                          }}
                          onPress={async () => {
                            setHistoryGymFilter(filter.value);
                            await loadExerciseHistory(
                              historyExerciseContext,
                              filter.value,
                              historyBrandFilter,
                            );
                          }}
                        >
                          <Text
                            style={{
                              color: active ? "#000" : "#FFF",
                              fontWeight: "800",
                              fontSize: 12,
                            }}
                            numberOfLines={1}
                          >
                            {filter.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}

              {historyExerciseContext &&
                isMachineBrandApplicable(historyExerciseContext) &&
                historyBrandOptions.length > 0 && (
                  <View>
                    <Text
                      style={{
                        color: "#8E8E93",
                        fontSize: 11,
                        fontWeight: "800",
                        marginBottom: 8,
                        textTransform: "uppercase",
                      }}
                    >
                      Machine Brand
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                    >
                      {[
                        { label: "All Brands", value: null },
                        ...historyBrandOptions.map((brand) => ({
                          label: brand,
                          value: brand,
                        })),
                      ].map((filter, idx) => {
                        const active = historyBrandFilter === filter.value;
                        return (
                          <TouchableOpacity
                            key={`brand-${filter.value || idx}`}
                            style={{
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                              borderRadius: 999,
                              marginRight: 8,
                              backgroundColor: active ? "#32D74B" : "#2C2C2E",
                              borderWidth: 1,
                              borderColor: active ? "#32D74B" : "#3A3A3C",
                            }}
                            onPress={async () => {
                              setHistoryBrandFilter(filter.value);
                              await loadExerciseHistory(
                                historyExerciseContext,
                                historyGymFilter,
                                filter.value,
                              );
                            }}
                          >
                            <Text
                              style={{
                                color: active ? "#000" : "#FFF",
                                fontWeight: "800",
                                fontSize: 12,
                              }}
                              numberOfLines={1}
                            >
                              {filter.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}
            </View>

            {exerciseHistoryData.length > 0 ? (
              <ScrollView
                style={{ width: "100%", flex: 1 }}
                contentContainerStyle={{ paddingBottom: 4 }}
                showsVerticalScrollIndicator={false}
              >
                {exerciseHistoryData.map((session, idx) => (
                  <View
                    key={idx}
                    style={{
                      marginBottom: 16,
                      width: "100%",
                      backgroundColor: "#2C2C2E",
                      padding: 16,
                      borderRadius: 16,
                    }}
                  >
                    <Text
                      style={{
                        color: "#FFF",
                        fontWeight: "800",
                        marginBottom: 6,
                      }}
                    >
                      {session.date} - {session.workoutName}
                    </Text>
                    {(session.gymName || session.equipmentTag) && (
                      <Text
                        style={{
                          color: "#8E8E93",
                          fontSize: 12,
                          fontWeight: "700",
                          marginBottom: 12,
                        }}
                      >
                        {[session.gymName, session.equipmentTag]
                          .filter(Boolean)
                          .join(" • ")}
                      </Text>
                    )}
                    {session.sets.map((s: any, sIdx: number) => (
                      <View
                        key={sIdx}
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          marginBottom: 6,
                        }}
                      >
                        <Text style={{ color: "#8E8E93", fontWeight: "600" }}>
                          {s.isWarmup ? "Warm-up" : `Set ${sIdx + 1}`}
                        </Text>
                        {session.is_unilateral ? (
                          <Text style={{ color: "#32D74B", fontWeight: "800" }}>
                            {s.weight} {isKg ? "kg" : "lbs"} × {s.repsL}L /{" "}
                            {s.repsR}R
                          </Text>
                        ) : (
                          <Text style={{ color: "#32D74B", fontWeight: "800" }}>
                            {s.weight} {isKg ? "kg" : "lbs"} × {s.reps}
                          </Text>
                        )}
                      </View>
                    ))}
                    {session.remark && (
                      <View
                        style={{
                          marginTop: 10,
                          paddingTop: 10,
                          borderTopWidth: 1,
                          borderTopColor: "#3A3A3C",
                        }}
                      >
                        <Text
                          style={{
                            color: "#8E8E93",
                            fontSize: 12,
                            fontStyle: "italic",
                          }}
                        >
                          "{session.remark}"
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>
            ) : (
              <Text
                style={{
                  color: "#8E8E93",
                  marginBottom: 20,
                  textAlign: "center",
                }}
              >
                No history yet. Complete this exercise in a workout to build its
                performance history.
              </Text>
            )}
            <TouchableOpacity
              style={styles.actionMenuBtnCancel}
              onPress={() => setIsHistoryModalVisible(false)}
            >
              <Text style={styles.actionMenuBtnTextCancel}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={{ flex: 1 }}>
        <DraggableFlatList
          data={exercises}
          keyExtractor={(item: any, index: number) => String(item.id || index)}
          contentContainerStyle={[
            styles.scrollContent,
            !isEditable && { paddingBottom: 40 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          showsVerticalScrollIndicator={false}
          activationDistance={18}
          onDragEnd={() => {}}
          ListHeaderComponent={
            <>
              <View style={styles.workoutOverviewCard}>
                <View style={styles.workoutOverviewHeader}>
                  <View style={{ flex: 1, paddingRight: 12 }}>
                    <Text style={styles.workoutOverviewKicker}>
                      {isEditing ? "EDIT WORKOUT" : "LIVE SESSION"}
                    </Text>
                    <Text style={styles.workoutOverviewTitle} numberOfLines={1}>
                      {selectedGymName}
                    </Text>
                  </View>
                  <View style={styles.workoutOverviewActions}>
                    {!isEditing && (
                      <TouchableOpacity
                        style={styles.workoutOverviewAction}
                        disabled={!isEditable || isReorderMode}
                        onPress={() => {
                          setIsChangingLocation(true);
                          setIsPreFlightVisible(true);
                        }}
                      >
                        <Ionicons
                          name="location-outline"
                          size={16}
                          color={
                            isEditable && !isReorderMode ? "#32D74B" : "#8E8E93"
                          }
                        />
                        <Text
                          style={[
                            styles.workoutOverviewActionText,
                            (!isEditable || isReorderMode) && {
                              color: "#8E8E93",
                            },
                          ]}
                        >
                          Gym
                        </Text>
                      </TouchableOpacity>
                    )}

                    {((!isEditing && isPlateCalcEnabled) ||
                      (isEditable && exercises.length > 1)) && (
                      <TouchableOpacity
                        style={styles.workoutOverviewAction}
                        onPress={() => setIsSessionMenuVisible(true)}
                      >
                        <Ionicons
                          name="ellipsis-horizontal"
                          size={17}
                          color="#32D74B"
                        />
                        <Text style={styles.workoutOverviewActionText}>
                          More
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                <View style={styles.workoutOverviewStatsRow}>
                  <View style={styles.workoutOverviewStat}>
                    <Text style={styles.workoutOverviewStatValue}>
                      {workoutStats.totalExercises}
                    </Text>
                    <Text style={styles.workoutOverviewStatLabel}>
                      Exercises
                    </Text>
                  </View>
                  <View style={styles.workoutOverviewDivider} />
                  <View style={styles.workoutOverviewStat}>
                    <Text style={styles.workoutOverviewStatValue}>
                      {workoutStats.completedSets}/{workoutStats.totalSets}
                    </Text>
                    <Text style={styles.workoutOverviewStatLabel}>
                      Sets Done
                    </Text>
                  </View>
                  <View style={styles.workoutOverviewDivider} />
                  <View style={styles.workoutOverviewStat}>
                    <Text
                      style={[
                        styles.workoutOverviewStatValue,
                        !isEditing &&
                          displayRestTime > 0 && { color: "#32D74B" },
                      ]}
                    >
                      {isEditing
                        ? workoutDurationStr
                        : displayRestTime > 0
                          ? formatRestClock(displayRestTime)
                          : sessionRestEnabled
                            ? `${sessionRestDuration}s`
                            : "Off"}
                    </Text>
                    <Text style={styles.workoutOverviewStatLabel}>
                      {isEditing
                        ? "Time"
                        : displayRestTime > 0
                          ? "Resting"
                          : "Rest"}
                    </Text>
                  </View>
                </View>
              </View>
            </>
          }
          renderItem={({ item: ex, getIndex, drag, isActive }) => {
            const exIdx = getIndex() ?? 0;
            const exerciseVariationOptions = getExerciseVariationOptions(ex);

            const supersetInfo = getSupersetInfo(exercises, ex.supersetId);
            const supersetLabel = supersetInfo?.label || "A";
            const showSupersetHeader =
              !!ex.supersetId && isFirstInSuperset(exercises, exIdx);
            const supersetOrderLabel = ex.supersetId
              ? `${supersetLabel}${ex.supersetOrder || 1}`
              : null;

            return (
              <View>
                {showSupersetHeader && (
                  <View style={styles.supersetGroupHeader}>
                    <View>
                      <Text style={styles.supersetGroupKicker}>
                        SUPERSET {supersetLabel}
                      </Text>
                      <Text style={styles.supersetGroupMeta}>
                        {supersetInfo?.exercises?.length || 2} exercises · Rest
                        after {supersetLabel}
                        {supersetInfo?.exercises?.length || 2}
                      </Text>
                    </View>
                    <Ionicons
                      name="git-merge-outline"
                      size={20}
                      color="#32D74B"
                    />
                  </View>
                )}
                <View
                  style={[
                    styles.exerciseCard,
                    ex.supersetId && styles.exerciseCardInSuperset,
                    isActive && styles.exerciseCardDragging,
                  ]}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      marginBottom: 15,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        flex: 1,
                        paddingRight: 10,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <TouchableOpacity
                          activeOpacity={0.88}
                          disabled={!isEditable || exercises.length < 2}
                          onLongPress={openReorderModal}
                          delayLongPress={220}
                          hitSlop={{ top: 8, bottom: 8, left: 4, right: 12 }}
                        >
                          <Text
                            style={[styles.exerciseTitle, { flexShrink: 1 }]}
                            numberOfLines={2}
                          >
                            {supersetOrderLabel && (
                              <Text style={{ color: "#32D74B", fontSize: 16 }}>
                                {supersetOrderLabel}{" "}
                              </Text>
                            )}
                            {formatExerciseDisplayName(ex)}{" "}
                            {ex.is_unilateral && (
                              <Text style={{ color: "#32D74B", fontSize: 16 }}>
                                {" "}
                                (L/R)
                              </Text>
                            )}
                          </Text>
                        </TouchableOpacity>

                        {isEditable && exerciseVariationOptions.length > 0 && (
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={{
                              paddingTop: 10,
                              paddingRight: 12,
                            }}
                          >
                            {exerciseVariationOptions.map((variant) => {
                              const isActive =
                                (ex.exerciseVariant || "Normal") === variant;
                              return (
                                <TouchableOpacity
                                  key={variant}
                                  style={{
                                    paddingHorizontal: 10,
                                    paddingVertical: 6,
                                    borderRadius: 999,
                                    marginRight: 8,
                                    backgroundColor: isActive
                                      ? "#32D74B"
                                      : "#2C2C2E",
                                    borderWidth: 1,
                                    borderColor: isActive
                                      ? "#32D74B"
                                      : "#3A3A3C",
                                  }}
                                  onPress={() => {
                                    Haptics.impactAsync(
                                      Haptics.ImpactFeedbackStyle.Light,
                                    );
                                    setExercises((prev) => {
                                      const up = [...prev];
                                      up[exIdx] = {
                                        ...up[exIdx],
                                        exerciseVariant: variant,
                                      };
                                      return up;
                                    });
                                    setHasUnsavedChanges(true);
                                  }}
                                >
                                  <Text
                                    style={{
                                      color: isActive ? "#000" : "#D1D1D6",
                                      fontSize: 11,
                                      fontWeight: "900",
                                    }}
                                  >
                                    {variant}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </ScrollView>
                        )}

                        <View
                          style={{
                            flexDirection: "row",
                            flexWrap: "wrap",
                            alignItems: "center",
                            marginTop: 6,
                          }}
                        >
                          {isMachineBrandApplicable(ex) && isEditable ? (
                            <TouchableOpacity
                              style={{
                                backgroundColor: ex.equipmentTag
                                  ? "#2C2C2E"
                                  : "rgba(50, 215, 75, 0.15)",
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: 6,
                                marginRight: 8,
                                borderWidth: 1,
                                borderColor: ex.equipmentTag
                                  ? "transparent"
                                  : "rgba(50, 215, 75, 0.3)",
                                flexDirection: "row",
                                alignItems: "center",
                              }}
                              onPress={() => {
                                if (!isMachineBrandApplicable(ex)) return;
                                if (selectedGymId) {
                                  setTagExIdx(exIdx);
                                  setIsTagModalVisible(true);
                                } else {
                                  showInfo(
                                    "No Location",
                                    "Please select a gym location from the Session Options menu first to tag equipment.",
                                  );
                                }
                              }}
                            >
                              <Text
                                style={{
                                  color: ex.equipmentTag
                                    ? "#D1D1D6"
                                    : "#32D74B",
                                  fontSize: 11,
                                  fontWeight: "800",
                                }}
                              >
                                {ex.equipmentTag
                                  ? ex.equipmentTag
                                  : "+ Add Machine Brand"}
                              </Text>
                              {ex.equipmentTag && (
                                <Ionicons
                                  name="chevron-down"
                                  size={10}
                                  color="#D1D1D6"
                                  style={{ marginLeft: 4 }}
                                />
                              )}
                            </TouchableOpacity>
                          ) : isMachineBrandApplicable(ex) &&
                            ex.equipmentTag ? (
                            // Viewing/editing past workout — static pill, not tappable
                            <View
                              style={{
                                backgroundColor: "#2C2C2E",
                                paddingHorizontal: 8,
                                paddingVertical: 4,
                                borderRadius: 6,
                                marginRight: 8,
                                borderWidth: 1,
                                borderColor: "transparent",
                                flexDirection: "row",
                                alignItems: "center",
                              }}
                            >
                              <Text
                                style={{
                                  color: "#D1D1D6",
                                  fontSize: 11,
                                  fontWeight: "800",
                                }}
                              >
                                {ex.equipmentTag}
                              </Text>
                            </View>
                          ) : null}

                          {ex.reminder && (
                            <Text
                              style={{
                                color: "#32D74B",
                                fontSize: 12,
                                fontWeight: "700",
                              }}
                            >
                              • {ex.reminder}
                            </Text>
                          )}
                        </View>
                      </View>
                    </View>

                    <View
                      style={{ flexDirection: "row", alignItems: "center" }}
                    >
                      {isEditable ? (
                        <View
                          style={{ flexDirection: "row", alignItems: "center" }}
                        >
                          <TouchableOpacity
                            style={[
                              styles.exerciseOptionsBtn,
                              { paddingLeft: 10, paddingRight: 10 },
                            ]}
                            onPress={() => {
                              setCurrentRemark(ex.remark || "");
                              setSelectedExerciseIndex(exIdx);
                              setIsRemarkModalVisible(true);
                            }}
                          >
                            <Ionicons
                              name={
                                ex.remark
                                  ? "chatbubble-ellipses"
                                  : "chatbubble-ellipses-outline"
                              }
                              size={20}
                              color={ex.remark ? "#32D74B" : "#8E8E93"}
                            />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.exerciseOptionsBtn}
                            onPress={() => {
                              setSelectedExerciseIndex(exIdx);
                              setIsExerciseMenuVisible(true);
                            }}
                          >
                            <Text style={styles.exerciseOptionsIcon}>⋮</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  {/* COLUMN HEADERS — gap:6 is the only spacing primitive.
                    No marginHorizontal on any cell. Flat siblings only.   */}
                  {ex.sets && ex.sets.length > 0 && (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 8,
                        marginTop: -4,
                      }}
                    >
                      <View style={{ flex: 0.5, alignItems: "center" }}>
                        <TouchableOpacity
                          onPress={() =>
                            showInfo(
                              "Set Options",
                              "• Tap a set number to toggle Warm-up.\n• Hold down a set number to Delete it.",
                            )
                          }
                        >
                          <Text
                            style={{
                              color: "#8E8E93",
                              fontSize: 11,
                              fontWeight: "700",
                              textAlign: "center",
                            }}
                          >
                            SET ⓘ
                          </Text>
                        </TouchableOpacity>
                      </View>

                      <View style={{ flex: 1, alignItems: "center" }}>
                        <Text
                          style={{
                            color: "#8E8E93",
                            fontSize: 11,
                            fontWeight: "700",
                            textAlign: "center",
                          }}
                        >
                          {isKg ? "KG" : "LBS"}
                        </Text>
                      </View>

                      {ex.is_unilateral ? (
                        <>
                          <View style={{ flex: 0.8, alignItems: "center" }}>
                            <Text
                              style={{
                                color: "#8E8E93",
                                fontSize: 11,
                                fontWeight: "700",
                                textAlign: "center",
                              }}
                            >
                              L
                            </Text>
                          </View>
                          <View style={{ flex: 0.8, alignItems: "center" }}>
                            <Text
                              style={{
                                color: "#8E8E93",
                                fontSize: 11,
                                fontWeight: "700",
                                textAlign: "center",
                              }}
                            >
                              R
                            </Text>
                          </View>
                        </>
                      ) : (
                        <View style={{ flex: 1, alignItems: "center" }}>
                          <Text
                            style={{
                              color: "#8E8E93",
                              fontSize: 11,
                              fontWeight: "700",
                              textAlign: "center",
                            }}
                          >
                            REPS
                          </Text>
                        </View>
                      )}

                      <View style={{ flex: 0.5, alignItems: "center" }}>
                        <Text
                          style={{
                            color: "#8E8E93",
                            fontSize: 11,
                            fontWeight: "700",
                            textAlign: "center",
                          }}
                        >
                          DONE
                        </Text>
                      </View>
                    </View>
                  )}

                  {/* 🌟 COHESIVE 4-COLUMN INPUT BOX ROWS */}
                  {ex.sets &&
                    ex.sets.map((s: any, sIdx: number) => {
                      const GAP = 4;
                      const workingSetNum = ex.sets
                        .slice(0, sIdx + 1)
                        .filter((set: any) => !set.isWarmup).length;
                      return (
                        <View key={s.id} style={[styles.tableRow, { gap: 6 }]}>
                          {/* SET */}
                          <TouchableOpacity
                            style={{
                              flex: 0.5,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                            disabled={!isEditable}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setExercises((prev) => {
                                const up = [...prev];
                                const newSets = [...up[exIdx].sets];
                                const targetIndex = newSets.findIndex(
                                  (set: any) => set.id === s.id,
                                );
                                if (targetIndex === -1) return prev;
                                newSets[targetIndex] = {
                                  ...newSets[targetIndex],
                                  isWarmup: !newSets[targetIndex].isWarmup,
                                };
                                newSets.sort((a, b) => {
                                  if (a.isWarmup && !b.isWarmup) return -1;
                                  if (!a.isWarmup && b.isWarmup) return 1;
                                  return (
                                    (a.createdAt || 0) - (b.createdAt || 0)
                                  );
                                });
                                up[exIdx] = { ...up[exIdx], sets: newSets };
                                return up;
                              });
                              setHasUnsavedChanges(true);
                            }}
                            onLongPress={() => {
                              Haptics.impactAsync(
                                Haptics.ImpactFeedbackStyle.Heavy,
                              );
                              setRemoveSetAlert({
                                visible: true,
                                exIdx,
                                setId: s.id,
                                isWarmup: s.isWarmup,
                              });
                            }}
                          >
                            <Text
                              style={[
                                styles.setNumber,
                                s.isWarmup && { color: "#FFD700" },
                              ]}
                            >
                              {s.isWarmup ? "W" : workingSetNum}
                            </Text>
                          </TouchableOpacity>

                          {/* KG */}
                          <TextInput
                            style={[
                              styles.setInput,
                              {
                                flex: 1,
                                color: s.isWarmup ? "#FFD700" : "#FFF",
                              },
                            ]}
                            keyboardType={
                              Platform.OS === "ios" ? "decimal-pad" : "numeric"
                            }
                            keyboardAppearance="dark"
                            autoCorrect={false}
                            spellCheck={false}
                            autoComplete="off"
                            value={s.weight}
                            placeholder="0"
                            placeholderTextColor="#48484A"
                            editable={isEditable}
                            onChangeText={(t) => {
                              setExercises((prev) => {
                                const up = [...prev];
                                const newSets = [...up[exIdx].sets];
                                const setIndex = newSets.findIndex(
                                  (set: any) => set.id === s.id,
                                );
                                if (setIndex !== -1) {
                                  newSets[setIndex] = {
                                    ...newSets[setIndex],
                                    weight: t,
                                  };
                                  up[exIdx] = { ...up[exIdx], sets: newSets };
                                }
                                return up;
                              });
                              setHasUnsavedChanges(true);
                            }}
                            onBlur={() => handleSetBlur(exIdx, s.id)}
                          />

                          {/* L / R (unilateral) or REPS (bilateral) — flat siblings, no wrapper */}
                          {ex.is_unilateral ? (
                            <>
                              <TextInput
                                style={[
                                  styles.setInput,
                                  {
                                    flex: 0.8,
                                    color: s.isWarmup ? "#FFD700" : "#FFF",
                                  },
                                ]}
                                keyboardType={
                                  Platform.OS === "ios"
                                    ? "number-pad"
                                    : "numeric"
                                }
                                keyboardAppearance="dark"
                                autoCorrect={false}
                                spellCheck={false}
                                autoComplete="off"
                                value={s.repsL}
                                placeholder="L"
                                placeholderTextColor="#48484A"
                                editable={isEditable}
                                onChangeText={(t) => {
                                  setExercises((prev) => {
                                    const up = [...prev];
                                    const newSets = [...up[exIdx].sets];
                                    const setIndex = newSets.findIndex(
                                      (set: any) => set.id === s.id,
                                    );
                                    if (setIndex !== -1) {
                                      newSets[setIndex] = {
                                        ...newSets[setIndex],
                                        repsL: t,
                                      };
                                      up[exIdx] = {
                                        ...up[exIdx],
                                        sets: newSets,
                                      };
                                    }
                                    return up;
                                  });
                                  setHasUnsavedChanges(true);
                                }}
                                onBlur={() => handleSetBlur(exIdx, s.id)}
                              />
                              <TextInput
                                style={[
                                  styles.setInput,
                                  {
                                    flex: 0.8,
                                    color: s.isWarmup ? "#FFD700" : "#FFF",
                                  },
                                ]}
                                keyboardType={
                                  Platform.OS === "ios"
                                    ? "number-pad"
                                    : "numeric"
                                }
                                keyboardAppearance="dark"
                                autoCorrect={false}
                                spellCheck={false}
                                autoComplete="off"
                                value={s.repsR}
                                placeholder="R"
                                placeholderTextColor="#48484A"
                                editable={isEditable}
                                onChangeText={(t) => {
                                  setExercises((prev) => {
                                    const up = [...prev];
                                    const newSets = [...up[exIdx].sets];
                                    const setIndex = newSets.findIndex(
                                      (set: any) => set.id === s.id,
                                    );
                                    if (setIndex !== -1) {
                                      newSets[setIndex] = {
                                        ...newSets[setIndex],
                                        repsR: t,
                                      };
                                      up[exIdx] = {
                                        ...up[exIdx],
                                        sets: newSets,
                                      };
                                    }
                                    return up;
                                  });
                                  setHasUnsavedChanges(true);
                                }}
                                onBlur={() => handleSetBlur(exIdx, s.id)}
                              />
                            </>
                          ) : (
                            <TextInput
                              style={[
                                styles.setInput,
                                {
                                  flex: 1,
                                  color: s.isWarmup ? "#FFD700" : "#FFF",
                                },
                              ]}
                              keyboardType={
                                Platform.OS === "ios" ? "number-pad" : "numeric"
                              }
                              keyboardAppearance="dark"
                              autoCorrect={false}
                              spellCheck={false}
                              autoComplete="off"
                              value={s.reps}
                              placeholder="0"
                              placeholderTextColor="#48484A"
                              editable={isEditable}
                              onChangeText={(t) => {
                                setExercises((prev) => {
                                  const up = [...prev];
                                  const newSets = [...up[exIdx].sets];
                                  const setIndex = newSets.findIndex(
                                    (set: any) => set.id === s.id,
                                  );
                                  if (setIndex !== -1) {
                                    newSets[setIndex] = {
                                      ...newSets[setIndex],
                                      reps: t,
                                    };
                                    up[exIdx] = { ...up[exIdx], sets: newSets };
                                  }
                                  return up;
                                });
                                setHasUnsavedChanges(true);
                              }}
                              onBlur={() => handleSetBlur(exIdx, s.id)}
                            />
                          )}

                          {/* Column 4: DONE Checkbox Button */}
                          <TouchableOpacity
                            disabled={!isEditable}
                            style={[
                              s.completed
                                ? s.isWarmup
                                  ? [
                                      styles.checkOn,
                                      { backgroundColor: "#FFD700" },
                                    ]
                                  : styles.checkOn
                                : styles.checkOff,
                              { flex: 0.5, opacity: isEditable ? 1 : 0.8 },
                            ]}
                            onPress={async () => {
                              let isComplete = false;
                              if (ex.is_unilateral) {
                                isComplete =
                                  s.weight.trim() !== "" &&
                                  (s.repsL || "").trim() !== "" &&
                                  (s.repsR || "").trim() !== "";
                              } else {
                                isComplete =
                                  s.weight.trim() !== "" &&
                                  (s.reps || "").trim() !== "";
                              }

                              if (!s.completed && !isComplete) {
                                Haptics.notificationAsync(
                                  Haptics.NotificationFeedbackType.Warning,
                                );
                                showInfo(
                                  "Incomplete Set",
                                  "Please fill out all weight and rep fields before marking this set as done.",
                                );
                                return;
                              }

                              Haptics.impactAsync(
                                Haptics.ImpactFeedbackStyle.Light,
                              );
                              let ns = false;
                              let completedSetForTimer: any = null;
                              let nextExercisesForTimer: any[] | null = null;
                              setExercises((prev) => {
                                const up = [...prev];
                                const newSets = [...up[exIdx].sets];
                                const setIndex = newSets.findIndex(
                                  (set: any) => set.id === s.id,
                                );
                                if (setIndex !== -1) {
                                  ns = !newSets[setIndex].completed;
                                  newSets[setIndex] = {
                                    ...newSets[setIndex],
                                    completed: ns,
                                  };
                                  up[exIdx] = { ...up[exIdx], sets: newSets };
                                  if (ns) {
                                    completedSetForTimer = newSets[setIndex];
                                    nextExercisesForTimer = up;
                                  }
                                }
                                return up;
                              });
                              setHasUnsavedChanges(true);

                              if (
                                completedSetForTimer &&
                                nextExercisesForTimer
                              ) {
                                startRestTimerForCompletedSet(
                                  exIdx,
                                  completedSetForTimer,
                                  nextExercisesForTimer,
                                );
                              }
                            }}
                          >
                            <Text
                              style={[
                                styles.checkIcon,
                                s.isWarmup && s.completed && { color: "#000" },
                              ]}
                            >
                              {s.completed ? "✓" : ""}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}

                  {isEditable && (
                    <TouchableOpacity
                      style={styles.addSetRow}
                      onPress={() => {
                        setExercises((prev) => {
                          const up = [...prev];
                          up[exIdx] = {
                            ...up[exIdx],
                            sets: [
                              ...up[exIdx].sets,
                              {
                                id: genId(),
                                weight: "",
                                reps: "",
                                repsL: "",
                                repsR: "",
                                completed: false,
                                isWarmup: false,
                                createdAt: Date.now(),
                              },
                            ],
                          };
                          return up;
                        });
                        setHasUnsavedChanges(true);
                      }}
                    >
                      <Text style={styles.addSetText}>+ Add Set</Text>
                    </TouchableOpacity>
                  )}
                  {ex.remark ? (
                    <View
                      style={{
                        marginTop: 20,
                        paddingTop: 15,
                        borderTopWidth: 1,
                        borderTopColor: "#2C2C2E",
                      }}
                    >
                      <Text
                        style={{
                          color: "#8E8E93",
                          fontSize: 11,
                          fontWeight: "800",
                          marginBottom: 4,
                        }}
                      >
                        NOTE
                      </Text>
                      <Text
                        style={{
                          color: "#FFF",
                          fontSize: 14,
                          fontStyle: "italic",
                        }}
                      >
                        "{ex.remark}"
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          }}
          ListFooterComponent={
            <>
              {isEditable && (
                <TouchableOpacity
                  style={styles.addExerciseCard}
                  onPress={() =>
                    navigation.navigate("Search", {
                      existingExercises: exercises.map((e) => e.name),
                      onSelect: async (exData: any) => {
                        let newEx = {
                          id: genId("ex-"),
                          name: exData.name,
                          reminder: exData.reminder || "",
                          remark: "",
                          exerciseVariant:
                            getExerciseVariationOptions(exData).length > 0
                              ? "Normal"
                              : undefined,
                          variationOptions: getExerciseVariationOptions(exData),
                          is_unilateral: !!exData.is_unilateral,
                          brand: exData.brand,
                          sets: [
                            {
                              id: genId(),
                              weight: "",
                              reps: "",
                              repsL: "",
                              repsR: "",
                              completed: false,
                              isWarmup: false,
                              createdAt: Date.now(),
                            },
                          ],
                        };

                        newEx = await getAutoFilledExercise(
                          newEx,
                          selectedGymId,
                        );

                        setExercises((prev) => [...prev, newEx]);
                        setHasUnsavedChanges(true);
                      },
                    })
                  }
                >
                  <View style={styles.addExerciseIconCircle}>
                    <Ionicons name="add" size={24} color="#32D74B" />
                  </View>
                  <Text style={styles.addExerciseText}>Add Exercise</Text>
                  <Text style={styles.addExerciseSubtext}>
                    Build out this session with another movement
                  </Text>
                </TouchableOpacity>
              )}
            </>
          }
        />

        {isEditable && !isKeyboardVisible && (
          <View
            style={[
              styles.footer,
              {
                paddingBottom:
                  Platform.OS === "android"
                    ? Math.max(insets.bottom + 18, 48)
                    : Math.max(insets.bottom + 10, 30),
              },
            ]}
          >
            {!isEditing && displayRestTime > 0 && (
              <View style={styles.timerBar}>
                <View style={styles.timerInfo}>
                  <Text style={styles.timerLabel}>REST TIMER</Text>
                  <Text style={styles.timerTime}>
                    {formatRestClock(displayRestTime)}
                  </Text>
                </View>
                <View style={styles.timerActions}>
                  <TouchableOpacity
                    style={styles.timerBtn}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setTimerEndTime((prev) => {
                        const newTime = prev
                          ? prev + 30000
                          : Date.now() + 30000;
                        const newRemainingSeconds = Math.ceil(
                          (newTime - Date.now()) / 1000,
                        );
                        scheduleRestNotification(newRemainingSeconds);
                        return newTime;
                      });
                    }}
                  >
                    <Text style={styles.timerBtnText}>+30s</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.timerBtn, { backgroundColor: "#3A3A3C" }]}
                    onPress={async () => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setTimerEndTime(null);
                      setDisplayRestTime(0);
                      await clearRestTimerNotification(true);
                    }}
                  >
                    <Text style={styles.timerBtnText}>Skip</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[styles.finishButton, isFinishing && { opacity: 0.7 }]}
              disabled={isFinishing}
              onPress={() => {
                if (isReorderMode) {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setIsReorderMode(false);
                } else {
                  setTimeout(() => handleFinishWorkout(), 100);
                }
              }}
            >
              <Text style={styles.finishButtonText}>
                {isReorderMode
                  ? "Done"
                  : isEditing
                    ? "Save Changes"
                    : "Finish Workout"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}
