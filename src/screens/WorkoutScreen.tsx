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
  ActivityIndicator,
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
  getExerciseVariationOptions,
  getExerciseSupportsVariantsForStorage,
  getExerciseAttachmentOptions,
  getDefaultExerciseAttachment,
  getExerciseAttachmentForSave,
  getExerciseAttachmentForStorage,
  hasExplicitNoAttachment,
  NO_ATTACHMENT_OPTION_LABEL,
  normalizeExerciseForAttachmentStorage,
  formatExerciseDisplayName,
  isMachineBrandApplicable,
  isFirstInSuperset,
  isLastInSuperset,
  getSupersetInfo,
  assignSuperset,
  removeSupersetFromExercise,
  cleanInvalidSupersets,
  buildReorderBlocks,
  flattenReorderBlocks,
  createGymReplacementEntry,
  normalizeGymReplacements,
  applyGymReplacementToExerciseSlot,
  cleanExerciseNameForAttachments,
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
  LIMITS,
  MAX_WORKOUT_DURATION_MS,
  clampRestSeconds,
  cleanLimitedText,
  limitText,
  sanitizeRepsInput,
  sanitizeSetWeightInput,
} from "../constants/limits";
import {
  safeJsonParse,
  pushWorkoutToCloud,
  fetchConfigFromCloud,
  syncGymsToCloud,
  saveTemplatesLocallyAndToCloud,
  sanitizeGymsForStorage,
  markGymVariantsDeletedLocally,
  clearGymVariantsDeletedLocally,
} from "../utils/firebaseSync";
import CustomAttachmentModal from "../components/CustomAttachmentModal";
import CustomAlert from "../components/CustomAlert";
import BlockingOverlay from "../components/BlockingOverlay";
import DraggableFlatList from "react-native-draggable-flatlist";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  deleteTemplateNextSessionNotes,
  getTemplateExerciseNoteKey,
  readNextSessionNotesEnabled,
  readTemplateNextSessionNotes,
} from "../utils/nextSessionNotes";
import {
  getExerciseAttachmentSelectionOptions,
  getExerciseAttachmentOptionsWithCustom,
  mergeAttachmentOptions,
  normalizeAttachmentIdentity,
  readCustomAttachments,
  removeCustomAttachmentFromList,
  replaceCustomAttachmentInList,
  saveCustomAttachments,
  sanitizeCustomAttachmentName,
  validateCustomAttachmentName,
} from "../utils/customAttachments";
import {
  formatRpeValue,
  parseRpeValue,
  sanitizeRpeInput,
  workoutUsesRpeTracking,
} from "../utils/rpe";
import {
  buildBestHistoricalSetPositionHints,
  createHistoricalWeightPrefillState,
  getHistoricalSetHintIdentityKey,
  markHistoricalWeightPrefillManual,
  reconcileHistoricalWeightPrefills,
  restoreHistoricalWeightPrefillState,
  type HistoricalWeightPrefillState,
} from "../utils/setHistoryHints";
import {
  hasValidSetInputs,
  isValidCompletedSet,
  toSetInputValue,
} from "../utils/setCompletion";

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

const waitForUiFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

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

const REST_TIMER_PRESETS = [
  { label: "60s", value: 60 },
  { label: "90s", value: 90 },
  { label: "2m", value: 120 },
  { label: "3m", value: 180 },
];

const WARMUP_REST_TIMER_PRESETS = [
  { label: "30s", value: 30 },
  { label: "45s", value: 45 },
  { label: "60s", value: 60 },
  { label: "90s", value: 90 },
];

const getWeightPrefillIdentityKey = (items: any[] = []) =>
  items.map(getHistoricalSetHintIdentityKey).join("||");

const getWeightPrefillStructureKey = (items: any[] = []) =>
  items
    .map((exercise) =>
      (exercise?.sets || [])
        .map(
          (set: any) =>
            `${String(set?.id || "")}:${set?.isWarmup ? 1 : 0}:${set?.completed ? 1 : 0}`,
        )
        .join(","),
    )
    .join("||");

const DEFAULT_WORKING_REST_SECONDS = 90;
const DEFAULT_WARMUP_REST_SECONDS = 60;

type RestTimerType = "working" | "warmup";
type TemplateChangeType = "added" | "deleted" | "replaced" | "variant" | "name";
type TemplateChangeChoice = "dontUpdate" | "updateTemplate" | "gymSwap";

type TemplateChangeItem = {
  id: string;
  type: TemplateChangeType;
  templateExerciseId: string | null;
  originalExercise: any | null;
  workoutExercise: any | null;
  workoutIndex: number | null;
  canGymSwap: boolean;
  hasOtherGymSwaps: boolean;
  choice: TemplateChangeChoice;
  fromLabel?: string | null;
  toLabel?: string | null;
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
  const [totalPausedMs, setTotalPausedMs] = useState(0);
  const [pauseStartedAt, setPauseStartedAt] = useState<number | null>(null);
  const [timerEndTime, setTimerEndTime] = useState<number | null>(null);
  const [displayRestTime, setDisplayRestTime] = useState(0);

  const [sessionRestEnabled, setSessionRestEnabled] = useState(true);
  const [sessionRestDuration, setSessionRestDuration] = useState(
    String(DEFAULT_WORKING_REST_SECONDS),
  );
  const [sessionWarmupRestEnabled, setSessionWarmupRestEnabled] =
    useState(false);
  const [sessionWarmupRestDuration, setSessionWarmupRestDuration] = useState(
    String(DEFAULT_WARMUP_REST_SECONDS),
  );
  const [activeRestType, setActiveRestType] = useState<RestTimerType | null>(
    null,
  );
  const [isSessionMenuVisible, setIsSessionMenuVisible] = useState(false);
  const [isAutoCheckEnabled, setIsAutoCheckEnabled] = useState(false);
  const [rpeTrackingEnabled, setRpeTrackingEnabled] = useState(false);
  const [isPlateCalcEnabled, setIsPlateCalcEnabled] = useState(true);
  const [availablePlates, setAvailablePlates] = useState<number[]>([]);
  const [isReorderMode, setIsReorderMode] = useState(false);
  const [isReorderModalVisible, setIsReorderModalVisible] = useState(false);
  const [reorderDraftExercises, setReorderDraftExercises] = useState<any[]>([]);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [footerHeight, setFooterHeight] = useState(0);

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
  const [nextSessionNotesEnabled, setNextSessionNotesEnabled] =
    useState(false);
  const [nextSessionNotes, setNextSessionNotes] = useState<
    Record<string, string>
  >({});
  const [isPlateCalcVisible, setIsPlateCalcVisible] = useState(false);
  const [calcTarget, setCalcTarget] = useState("");
  const [calcBar, setCalcBar] = useState("20");
  const [plateInventory, setPlateInventory] = useState<
    Record<number, number | null>
  >({});

  const [isPreFlightVisible, setIsPreFlightVisible] = useState(false);
  const [isChangingLocation, setIsChangingLocation] = useState(false);
  const [isPreFlightConfirming, setIsPreFlightConfirming] = useState(false);
  const [gyms, setGyms] = useState<any[]>([]);
  const [workoutHistory, setWorkoutHistory] = useState<any[]>([]);
  const [selectedGymId, setSelectedGymId] = useState<string | null>(null);
  const [globalVariants, setGlobalVariants] = useState<string[]>([]);

  const [isTagModalVisible, setIsTagModalVisible] = useState(false);
  const [tagExIdx, setTagExIdx] = useState<number | null>(null);
  const [tagSearchQuery, setTagSearchQuery] = useState("");
  const [customAttachments, setCustomAttachments] = useState<string[]>([]);
  const [customAttachmentModal, setCustomAttachmentModal] = useState<{
    visible: boolean;
    exerciseIndex: number | null;
    value: string;
    error: string;
    editingAttachment: string | null;
  }>({
    visible: false,
    exerciseIndex: null,
    value: "",
    error: "",
    editingAttachment: null,
  });

  const igCardRef = useRef<any>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [workoutBlockingMessage, setWorkoutBlockingMessage] = useState("");
  const [isHistoricalWeightPrefillActive, setIsHistoricalWeightPrefillActive] =
    useState(false);
  const workoutNameInputRef = useRef<TextInput>(null);
  const saveTimeoutRef = useRef<any>(null);
  const restNotificationIdRef = useRef<string | null>(null);
  const sessionRestEnabledRef = useRef(sessionRestEnabled);
  const sessionRestDurationRef = useRef(sessionRestDuration);
  const sessionWarmupRestEnabledRef = useRef(sessionWarmupRestEnabled);
  const sessionWarmupRestDurationRef = useRef(sessionWarmupRestDuration);
  const activeRestTypeRef = useRef<RestTimerType | null>(activeRestType);
  const finishWorkoutInFlightRef = useRef(false);
  const workoutBlockingRef = useRef(false);
  const historicalWeightPrefillStateRef =
    useRef<HistoricalWeightPrefillState>({});
  const skipNextWeightPrefillReconcileRef = useRef(false);
  const isWorkoutBlocking = workoutBlockingMessage.length > 0;

  const markSetWeightManual = (setId: any) => {
    historicalWeightPrefillStateRef.current =
      markHistoricalWeightPrefillManual(
        historicalWeightPrefillStateRef.current,
        setId,
      );
  };

  const runWorkoutBlockingAction = async (
    message: string,
    action: () => Promise<void> | void,
  ) => {
    if (workoutBlockingRef.current) return;

    workoutBlockingRef.current = true;
    setWorkoutBlockingMessage(message);
    try {
      await action();
    } catch (error) {
      console.error("Workout action failed:", error);
    } finally {
      workoutBlockingRef.current = false;
      setWorkoutBlockingMessage("");
    }
  };

  const templateActionTaken = useRef(false);
  const incompleteActionTaken = useRef(false);
  const workoutFinalizedRef = useRef(false);
  const durationLimitNoticeShownRef = useRef(false);

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
  const [finishConfirmAlert, setFinishConfirmAlert] = useState({
    visible: false,
    navAction: null as any,
  });
  const [durationLimitAlert, setDurationLimitAlert] = useState<{
    visible: boolean;
    finalExercises: any[];
    navAction: any;
    cappedFinishedAt: number | null;
  }>({
    visible: false,
    finalExercises: [],
    navAction: null,
    cappedFinishedAt: null,
  });
  const [templateAlertVisible, setTemplateAlertVisible] = useState(false);
  const [templateDecisionAlert, setTemplateDecisionAlert] = useState<{
    visible: boolean;
    finalExercises: any[];
    navAction: any;
    forcedFinishedAt: number | null;
    changes: TemplateChangeItem[];
    createNewTemplate: boolean;
    newTemplateName: string;
    newTemplateNameError: string;
  }>({
    visible: false,
    finalExercises: [],
    navAction: null,
    forcedFinishedAt: null,
    changes: [],
    createNewTemplate: false,
    newTemplateName: "",
    newTemplateNameError: "",
  });
  const [removeSetAlert, setRemoveSetAlert] = useState({
    visible: false,
    exIdx: -1,
    setId: "",
    isWarmup: false,
  });
  const [pendingGymReplacementUpdates, setPendingGymReplacementUpdates] =
    useState<any[]>([]);

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

  const formatDurationFromMs = (durationMs: number) => {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m ${seconds}s`;
  };

  const getActiveWorkoutDurationMs = (endMs = Date.now()) => {
    if (!startTimeMs) return 0;
    const runningPausedMs = pauseStartedAt
      ? Math.max(0, endMs - pauseStartedAt)
      : 0;
    return Math.max(0, endMs - startTimeMs - totalPausedMs - runningPausedMs);
  };

  const uid = auth.currentUser?.uid;

  const normalizeTemplateNameForCompare = (value: any) =>
    cleanLimitedText(value, LIMITS.nameChars).toLowerCase();

  const getExerciseBaseComparableKey = (exercise: any) => {
    const source = exercise?.templateBaseExercise || exercise || {};
    const stableId = String(
      source?.id ||
        source?.originalExerciseId ||
        exercise?.originalExerciseId ||
        exercise?.exerciseId ||
        "",
    ).trim();
    const name = String(
      cleanExerciseNameForAttachments(source) || source?.name || exercise?.name || "",
    )
      .trim()
      .toLowerCase();
    const unilateral = !!(source?.is_unilateral ?? exercise?.is_unilateral);

    return `${stableId ? `id:${stableId}` : `name:${name}`}|side:${
      unilateral ? 1 : 0
    }`;
  };

  const getExerciseBaseNameComparableKey = (exercise: any) => {
    const source = exercise?.templateBaseExercise || exercise || {};
    const name = String(cleanExerciseNameForAttachments(source) || "")
      .trim()
      .toLowerCase();
    const unilateral = !!(source?.is_unilateral ?? exercise?.is_unilateral);
    return `name:${name}|side:${unilateral ? 1 : 0}`;
  };

  const isSameExerciseBaseAsTemplateSlot = (
    workoutExercise: any,
    templateExercise: any,
  ) =>
    getExerciseBaseComparableKey(workoutExercise) ===
      getExerciseBaseComparableKey(templateExercise) ||
    getExerciseBaseNameComparableKey(workoutExercise) ===
      getExerciseBaseNameComparableKey(templateExercise);

  const getExerciseVariantForTemplateCompare = (exercise: any) => {
    const variationOptions = getExerciseVariationOptions(exercise);
    const variant = String(
      exercise?.exerciseVariant || (variationOptions.length > 0 ? "Normal" : ""),
    ).trim();
    return variant || "";
  };

  const getExerciseSelectionCompare = (exercise: any) => ({
    variant: getExerciseVariantForTemplateCompare(exercise),
    attachment: getExerciseAttachmentForStorage(exercise) || "",
  });

  const getExerciseSelectionLabel = (exercise: any) => {
    const selection = getExerciseSelectionCompare(exercise);
    const parts = [];
    if (selection.variant) parts.push(selection.variant);
    if (selection.attachment) parts.push(selection.attachment);
    if (!selection.attachment && hasExplicitNoAttachment(exercise)) {
      parts.push(NO_ATTACHMENT_OPTION_LABEL);
    }
    return parts.join(" · ") || "Default";
  };

  const hasExerciseSelectionChange = (
    workoutExercise: any,
    templateExercise: any,
  ) => {
    const current = getExerciseSelectionCompare(workoutExercise);
    const original = getExerciseSelectionCompare(templateExercise);
    return (
      current.variant !== original.variant ||
      current.attachment !== original.attachment
    );
  };

  useEffect(() => {
    let isMounted = true;

    readCustomAttachments(uid).then((attachments) => {
      if (isMounted) setCustomAttachments(attachments);
    });

    return () => {
      isMounted = false;
    };
  }, [uid]);

  useEffect(() => {
    sessionRestEnabledRef.current = sessionRestEnabled;
  }, [sessionRestEnabled]);

  useEffect(() => {
    sessionRestDurationRef.current = sessionRestDuration;
  }, [sessionRestDuration]);

  useEffect(() => {
    sessionWarmupRestEnabledRef.current = sessionWarmupRestEnabled;
  }, [sessionWarmupRestEnabled]);

  useEffect(() => {
    sessionWarmupRestDurationRef.current = sessionWarmupRestDuration;
  }, [sessionWarmupRestDuration]);

  useEffect(() => {
    activeRestTypeRef.current = activeRestType;
  }, [activeRestType]);

  const buildTemplateExercisesFromWorkout = (
    sourceExercises: any[],
    latestTemplate?: any,
  ) => {
    return sourceExercises
      .map((ex) => ({
        ...ex,
        sets: (ex.sets || []).filter((s: any) =>
          isValidCompletedSet(ex, s),
        ),
      }))
      .filter((ex) => ex.sets.length > 0)
      .map((ex, idx) => {
        const base = normalizeExerciseForAttachmentStorage(
          ex.templateBaseExercise || ex,
        );
        const normalizedExercise = normalizeExerciseForAttachmentStorage(ex);
        const attachmentOptions = getExerciseAttachmentOptions({
          ...base,
          attachment: normalizedExercise.attachment || base.attachment,
        });
        const baseId = ex.templateBaseExercise
          ? base.id || base.originalExerciseId || ex.originalExerciseId || null
          : ex.originalExerciseId || ex.exerciseId || base.id || null;
        const latestTemplateExercise = (latestTemplate?.exercises || []).find(
          (templateExercise: any) => templateExercise?.id === baseId,
        );
        return {
          id: baseId || genId(`ex-${idx}-`),
          name: base.name || ex.name || "Exercise",
          reminder: base.reminder || ex.reminder || "",
          muscle: base.muscle || ex.muscle,
          equipment: base.equipment || ex.equipment,
          equipmentType: base.equipmentType || ex.equipmentType,
          machineBrandApplicable:
            base.machineBrandApplicable ?? ex.machineBrandApplicable,
          brandApplicable: base.brandApplicable ?? ex.brandApplicable,
          image: base.image || ex.image,
          exerciseVariant:
            base.exerciseVariant || ex.exerciseVariant || "Normal",
          variationOptions: base.variationOptions || ex.variationOptions,
          supportsVariants: getExerciseSupportsVariantsForStorage({
            ...normalizedExercise,
            ...base,
          }),
          attachment:
            getExerciseAttachmentForSave({
              ...base,
              attachment:
                normalizedExercise.attachment === ""
                  ? ""
                  : normalizedExercise.attachment || base.attachment,
            }),
          attachmentOptions:
            attachmentOptions.length > 0 ? attachmentOptions : undefined,
          supportsAttachments: attachmentOptions.length > 0 ? true : undefined,
          is_unilateral: !!(base.is_unilateral ?? ex.is_unilateral),
          supersetId: ex.supersetId || null,
          supersetOrder: ex.supersetOrder,
          gymReplacements: normalizeGymReplacements(
            latestTemplateExercise?.gymReplacements ?? base.gymReplacements,
          ),
          sets: ex.sets.map((s: any) => ({ isWarmup: !!s.isWarmup })),
        };
      });
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
    const currentWorkoutName = cleanLimitedText(workoutName, LIMITS.nameChars);
    const currentTemplateName = cleanLimitedText(
      activeTemplate?.name,
      LIMITS.nameChars,
    );
    const baseName = currentWorkoutName || currentTemplateName || "New Template";
    if (!activeTemplate?.id) return baseName;

    return normalizeTemplateNameForCompare(currentWorkoutName) &&
      normalizeTemplateNameForCompare(currentWorkoutName) !==
        normalizeTemplateNameForCompare(currentTemplateName)
      ? currentWorkoutName
      : `${baseName} (New)`;
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
      ? safeJsonParse<any[]>(rawTemplates, []).filter(Boolean)
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
    try {
      await saveTemplatesLocallyAndToCloud(updatedTemplates, uid);
    } catch (e) {
      await AsyncStorage.setItem(
        `@workout_templates_${uid}`,
        JSON.stringify(updatedTemplates),
      );
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

  const getTemplateExerciseById = (
    template: any,
    templateExerciseId: string | null,
  ) => {
    if (!templateExerciseId) return null;
    return (template?.exercises || []).find(
      (exercise: any) =>
        (exercise?.id || exercise?.originalExerciseId) === templateExerciseId,
    );
  };

  const buildPendingGymReplacementUpdate = ({
    templateExerciseId,
    replacementExercise,
    gymId,
    gymName,
    exerciseIndex,
  }: {
    templateExerciseId: string | null;
    replacementExercise: any | null;
    gymId: string | null;
    gymName: string;
    exerciseIndex: number | null;
  }) => {
    if (
      !activeTemplate?.id ||
      !templateExerciseId ||
      !replacementExercise ||
      !gymId
    ) {
      return null;
    }

    return {
      id: `${templateExerciseId}:${gymId}`,
      templateId: activeTemplate.id,
      templateExerciseId,
      gymId,
      gymName: gymName || "this gym",
      replacementExercise: createGymReplacementEntry(replacementExercise),
      exerciseIndex,
      createdAt: Date.now(),
    };
  };

  const shouldOfferGymSwapSave = (
    previousExercise: any,
    templateExerciseId: string | null,
    selectedGym: any,
  ) => {
    if (isEditing) return false;
    if (!activeTemplate?.id) return false;
    if (!selectedGymId || !selectedGym?.id) return false;
    if (!Array.isArray(gyms) || gyms.length < 2) return false;
    if (!templateExerciseId) return false;

    const templateSlotExists = (activeTemplate.exercises || []).some(
      (templateExercise: any) =>
        (templateExercise?.id || templateExercise?.originalExerciseId) ===
        templateExerciseId,
    );
    if (!templateSlotExists) return false;

    return !!(
      previousExercise?.templateBaseExercise ||
      previousExercise?.templateSwapSourceExerciseId ||
      previousExercise?.originalExerciseId
    );
  };

  const queuePendingGymReplacementUpdate = async ({
    templateExerciseId,
    replacementExercise,
    gymId,
    gymName,
    exerciseIndex,
    snapshotExercises,
  }: {
    templateExerciseId: string | null;
    replacementExercise: any | null;
    gymId: string | null;
    gymName: string;
    exerciseIndex: number | null;
    snapshotExercises?: any[];
  }) => {
    const pendingUpdate = buildPendingGymReplacementUpdate({
      templateExerciseId,
      replacementExercise,
      gymId,
      gymName,
      exerciseIndex,
    });
    if (!pendingUpdate) {
      return;
    }

    const nextPendingUpdates = [
      ...pendingGymReplacementUpdates.filter(
        (update: any) => update.id !== pendingUpdate.id,
      ),
      pendingUpdate,
    ];
    setPendingGymReplacementUpdates(nextPendingUpdates);

    await saveActiveSessionSnapshot({
      exercises: snapshotExercises,
      pendingGymReplacementUpdates: nextPendingUpdates,
    });
  };

  const removePendingGymReplacementUpdate = async ({
    templateExerciseId,
    gymId,
    snapshotExercises,
  }: {
    templateExerciseId: string | null;
    gymId: string | null;
    snapshotExercises?: any[];
  }) => {
    if (!templateExerciseId || !gymId) return;

    const pendingUpdateId = `${templateExerciseId}:${gymId}`;
    const nextPendingUpdates = pendingGymReplacementUpdates.filter(
      (update: any) => update.id !== pendingUpdateId,
    );
    if (nextPendingUpdates.length === pendingGymReplacementUpdates.length) {
      return;
    }

    setPendingGymReplacementUpdates(nextPendingUpdates);
    await saveActiveSessionSnapshot({
      exercises: snapshotExercises,
      pendingGymReplacementUpdates: nextPendingUpdates,
    });
  };

  const getTemplateComparableKey = (exercise: any) => {
    const hasTemplateBase = !!exercise?.templateBaseExercise;
    const source = hasTemplateBase ? exercise.templateBaseExercise : exercise;
    if (typeof source === "string") {
      return `name:${source.trim().toLowerCase()}|variant:Normal|side:0`;
    }

    const stableId = String(
      hasTemplateBase
        ? source?.id ||
            source?.originalExerciseId ||
            exercise?.originalExerciseId ||
            exercise?.exerciseId ||
            ""
        : exercise?.originalExerciseId ||
            exercise?.exerciseId ||
            source?.id ||
            source?.originalExerciseId ||
            "",
    ).trim();
    const name = String(source?.name || exercise?.name || "")
      .trim()
      .toLowerCase();
    const variant = String(
      source?.exerciseVariant || exercise?.exerciseVariant || "Normal",
    ).trim();
    const attachment = getExerciseAttachmentForStorage(source);
    const unilateral = !!(source?.is_unilateral ?? exercise?.is_unilateral);

    return `${stableId ? `id:${stableId}` : `name:${name}`}|variant:${variant}|attachment:${
      attachment || "None"
    }|side:${
      unilateral ? 1 : 0
    }`;
  };

  const getTemplateExerciseStableId = (exercise: any) => {
    const id = exercise?.id || exercise?.originalExerciseId;
    return id ? String(id) : null;
  };

  const getWorkoutTemplateSlotId = (exercise: any) => {
    const id =
      exercise?.templateSwapSourceExerciseId ||
      exercise?.templateBaseExercise?.id ||
      exercise?.templateBaseExercise?.originalExerciseId;
    return id ? String(id) : null;
  };

  const getActualExerciseComparableKey = (exercise: any) => {
    const stableId = String(
      exercise?.originalExerciseId ||
        exercise?.exerciseId ||
        exercise?.id ||
        "",
    ).trim();
    const name = String(exercise?.name || "").trim().toLowerCase();
    const variant = String(exercise?.exerciseVariant || "Normal").trim();
    const attachment = getExerciseAttachmentForStorage(exercise);
    const unilateral = !!exercise?.is_unilateral;

    return `${stableId ? `id:${stableId}` : `name:${name}`}|variant:${variant}|attachment:${
      attachment || "None"
    }|side:${
      unilateral ? 1 : 0
    }`;
  };

  const getExerciseNameComparableKey = (exercise: any) => {
    const source = exercise?.templateBaseExercise || exercise || {};
    const name = String(
      cleanExerciseNameForAttachments(source) || source?.name || exercise?.name || "",
    )
      .trim()
      .toLowerCase();
    const variant = String(
      source?.exerciseVariant || exercise?.exerciseVariant || "Normal",
    ).trim();
    const attachment = getExerciseAttachmentForStorage(source);
    const unilateral = !!(source?.is_unilateral ?? exercise?.is_unilateral);

    return `name:${name}|variant:${variant}|attachment:${
      attachment || "None"
    }|side:${unilateral ? 1 : 0}`;
  };

  const isSameExerciseAsTemplateSlot = (
    exercise: any,
    templateExercise: any,
  ) =>
    getActualExerciseComparableKey(exercise) ===
      getTemplateComparableKey(templateExercise) ||
    getExerciseNameComparableKey(exercise) ===
      getExerciseNameComparableKey(templateExercise);

  const getOtherGymSwapCount = (templateExercise: any) => {
    const replacements = normalizeGymReplacements(templateExercise?.gymReplacements);
    return Object.keys(replacements).filter((gymId) => gymId !== selectedGymId)
      .length;
  };

  const buildTemplateChangeItems = (workoutExercises: any[]) => {
    if (!activeTemplate?.id) return [];

    const templateExercises = Array.isArray(activeTemplate?.exercises)
      ? activeTemplate.exercises
      : [];
    const usedTemplateExerciseIds = new Set<string>();
    const pendingUpdatesBySlot = new Map<string, any>();
    pendingGymReplacementUpdates
      .filter((update: any) => update?.templateId === activeTemplate.id)
      .forEach((update: any) => {
        if (update?.templateExerciseId) {
          pendingUpdatesBySlot.set(String(update.templateExerciseId), update);
        }
    });

    const changes: TemplateChangeItem[] = [];
    const originalTemplateName = cleanLimitedText(
      activeTemplate?.name,
      LIMITS.nameChars,
    );
    const currentWorkoutName = cleanLimitedText(workoutName, LIMITS.nameChars);

    if (
      currentWorkoutName &&
      normalizeTemplateNameForCompare(currentWorkoutName) !==
        normalizeTemplateNameForCompare(originalTemplateName)
    ) {
      changes.push({
        id: "name:template",
        type: "name",
        templateExerciseId: null,
        originalExercise: null,
        workoutExercise: null,
        workoutIndex: null,
        canGymSwap: false,
        hasOtherGymSwaps: false,
        choice: "dontUpdate",
        fromLabel: originalTemplateName || "Template",
        toLabel: currentWorkoutName,
      });
    }

    (workoutExercises || []).forEach((workoutExercise: any, index: number) => {
      const templateExerciseId = getWorkoutTemplateSlotId(workoutExercise);
      const originalExercise = templateExerciseId
        ? getTemplateExerciseById(activeTemplate, templateExerciseId)
        : null;

      if (templateExerciseId && originalExercise) {
        usedTemplateExerciseIds.add(templateExerciseId);
        const wasManuallyReplaced = !!workoutExercise?.templateSwapSourceExerciseId;
        const isExistingGymReplacement =
          !!workoutExercise?.replacementForGymId && !wasManuallyReplaced;
        const isBackToOriginal = isSameExerciseAsTemplateSlot(
          workoutExercise,
          originalExercise,
        );
        const isSameBase = isSameExerciseBaseAsTemplateSlot(
          workoutExercise,
          originalExercise,
        );

        if (
          !isExistingGymReplacement &&
          isSameBase &&
          hasExerciseSelectionChange(workoutExercise, originalExercise)
        ) {
          changes.push({
            id: `variant:${templateExerciseId}`,
            type: "variant",
            templateExerciseId,
            originalExercise,
            workoutExercise,
            workoutIndex: index,
            canGymSwap: false,
            hasOtherGymSwaps: getOtherGymSwapCount(originalExercise) > 0,
            choice: "dontUpdate",
            fromLabel: getExerciseSelectionLabel(originalExercise),
            toLabel: getExerciseSelectionLabel(workoutExercise),
          });
        } else if (wasManuallyReplaced && !isBackToOriginal) {
          changes.push({
            id: `replaced:${templateExerciseId}`,
            type: "replaced",
            templateExerciseId,
            originalExercise,
            workoutExercise,
            workoutIndex: index,
            canGymSwap:
              !!pendingUpdatesBySlot.get(templateExerciseId) &&
              Array.isArray(gyms) &&
              gyms.length > 1,
            hasOtherGymSwaps: getOtherGymSwapCount(originalExercise) > 0,
            choice: "dontUpdate",
          });
        }
        return;
      }

      changes.push({
        id: `added:${workoutExercise?.id || workoutExercise?.originalExerciseId || index}`,
        type: "added",
        templateExerciseId: null,
        originalExercise: null,
        workoutExercise,
        workoutIndex: index,
        canGymSwap: false,
        hasOtherGymSwaps: false,
        choice: "dontUpdate",
      });
    });

    templateExercises.forEach((templateExercise: any, index: number) => {
      const templateExerciseId =
        getTemplateExerciseStableId(templateExercise) || `template-${index}`;
      if (usedTemplateExerciseIds.has(templateExerciseId)) return;

      changes.push({
        id: `deleted:${templateExerciseId}`,
        type: "deleted",
        templateExerciseId,
        originalExercise: templateExercise,
        workoutExercise: null,
        workoutIndex: null,
        canGymSwap: false,
        hasOtherGymSwaps: getOtherGymSwapCount(templateExercise) > 0,
        choice: "dontUpdate",
      });
    });

    return changes;
  };

  const showTemplateDecisionBeforeSave = (
    finalExercises: any[],
    navAction: any,
    forcedFinishedAt?: number,
  ) => {
    if (isEditing || !activeTemplate?.id) return false;

    const detectedChanges = buildTemplateChangeItems(exercises);

    if (detectedChanges.length === 0) {
      clearPendingGymReplacementUpdatesForActiveTemplate();
      return false;
    }

    setTemplateDecisionAlert({
      visible: true,
      finalExercises,
      navAction,
      forcedFinishedAt: forcedFinishedAt || null,
      changes: detectedChanges,
      createNewTemplate: false,
      newTemplateName: limitText(
        getSuggestedNewTemplateName(),
        LIMITS.nameChars,
      ),
      newTemplateNameError: "",
    });
    finishWorkoutInFlightRef.current = false;
    setIsFinishing(false);
    return true;
  };

  const createExerciseEntryFromWorkoutExercise = (exercise: any = {}) => {
    const stableId =
      exercise?.originalExerciseId || exercise?.exerciseId || exercise?.id;
    return {
      ...exercise,
      id: stableId || exercise?.id || null,
      exerciseId: stableId || exercise?.exerciseId || null,
    };
  };

  const getTemplateSetPatternFromWorkoutExercise = (
    exercise: any,
    fallbackSets: any[] = [],
  ) => {
    const completedSetPattern = (exercise?.sets || [])
      .filter((set: any) => !!set?.completed)
      .map((set: any) => ({ isWarmup: !!set.isWarmup }));

    if (completedSetPattern.length > 0) return completedSetPattern;

    const fallbackPattern = (fallbackSets || []).map((set: any) => ({
      isWarmup: !!set?.isWarmup,
    }));
    return fallbackPattern.length > 0 ? fallbackPattern : [{ isWarmup: false }];
  };

  const buildTemplateExerciseFromWorkoutChange = (
    workoutExercise: any,
    existingTemplateExercise?: any,
  ) => {
    const entry = normalizeExerciseForAttachmentStorage(
      createExerciseEntryFromWorkoutExercise(workoutExercise),
    );
    const variationOptions = getExerciseVariationOptions(entry);
    const attachmentOptions = getExerciseAttachmentOptions(entry);
    const gymReplacements = {
      ...normalizeGymReplacements(existingTemplateExercise?.gymReplacements),
    };

    if (selectedGymId) {
      delete gymReplacements[selectedGymId];
    }

    return {
      id: entry.id || genId("ex-"),
      name: entry.name || "Exercise",
      reminder: entry.reminder || "",
      muscle: entry.muscle,
      equipment: entry.equipment,
      equipmentType: entry.equipmentType,
      machineBrandApplicable: entry.machineBrandApplicable,
      brandApplicable: entry.brandApplicable,
      image: entry.image,
      exerciseVariant:
        entry.exerciseVariant || (variationOptions.length > 0 ? "Normal" : undefined),
      variationOptions:
        entry.variationOptions || (variationOptions.length > 0 ? variationOptions : undefined),
      supportsVariants: getExerciseSupportsVariantsForStorage(entry),
      attachment: getExerciseAttachmentForSave(entry),
      attachmentOptions:
        attachmentOptions.length > 0 ? attachmentOptions : undefined,
      supportsAttachments: attachmentOptions.length > 0 ? true : undefined,
      is_unilateral: !!entry.is_unilateral,
      brand: entry.brand,
      machineBrand: entry.machineBrand,
      supersetId: existingTemplateExercise?.supersetId || entry.supersetId || null,
      supersetOrder:
        existingTemplateExercise?.supersetOrder ?? entry.supersetOrder,
      gymReplacements,
      sets: getTemplateSetPatternFromWorkoutExercise(
        workoutExercise,
        existingTemplateExercise?.sets,
      ),
    };
  };

  const getInsertionAnchorForAddedChange = (
    change: TemplateChangeItem,
    removedTemplateIds: Set<string>,
  ) => {
    if (typeof change.workoutIndex !== "number") return null;

    for (let i = change.workoutIndex - 1; i >= 0; i--) {
      const candidateId = getWorkoutTemplateSlotId(exercises[i]);
      if (candidateId && !removedTemplateIds.has(candidateId)) {
        return candidateId;
      }
    }

    return null;
  };

  const applyTemplateChangeChoicesToTemplate = async (
    changes: TemplateChangeItem[],
  ) => {
    if (!uid || !activeTemplate?.id) return null;

    const meaningfulChanges = changes.filter(
      (change) => change.choice !== "dontUpdate",
    );
    const remainingPendingUpdates = pendingGymReplacementUpdates.filter(
      (update: any) => update?.templateId !== activeTemplate.id,
    );

    if (meaningfulChanges.length === 0) {
      setPendingGymReplacementUpdates(remainingPendingUpdates);
      return null;
    }

    const rawTemplates = await AsyncStorage.getItem(
      `@workout_templates_${uid}`,
    );
    const existingTemplates = rawTemplates
      ? safeJsonParse<any[]>(rawTemplates, []).filter(Boolean)
      : [];
    const templateIndex = existingTemplates.findIndex(
      (template: any) => template?.id === activeTemplate.id,
    );
    if (templateIndex === -1) {
      setPendingGymReplacementUpdates(remainingPendingUpdates);
      return null;
    }

    const storedTemplate = existingTemplates[templateIndex];
    const changesByTemplateId = new Map<string, TemplateChangeItem>();
    const removedTemplateIds = new Set<string>();
    const additions = changes.filter(
      (change) => change.type === "added" && change.choice === "updateTemplate",
    );

    changes.forEach((change) => {
      if (!change.templateExerciseId || change.choice === "dontUpdate") return;
      changesByTemplateId.set(change.templateExerciseId, change);
      if (change.type === "deleted" && change.choice === "updateTemplate") {
        removedTemplateIds.add(change.templateExerciseId);
      }
    });

    const additionsByAnchor = new Map<string | null, TemplateChangeItem[]>();
    additions.forEach((change) => {
      const anchorId = getInsertionAnchorForAddedChange(
        change,
        removedTemplateIds,
      );
      const existing = additionsByAnchor.get(anchorId) || [];
      additionsByAnchor.set(anchorId, [...existing, change]);
    });

    const buildAdditionExercises = (anchorId: string | null) =>
      (additionsByAnchor.get(anchorId) || [])
        .map((change) =>
          change.workoutExercise
            ? buildTemplateExerciseFromWorkoutChange(change.workoutExercise)
            : null,
        )
        .filter(Boolean);

    const nextExercises = [
      ...buildAdditionExercises(null),
      ...(storedTemplate.exercises || []).flatMap((templateExercise: any) => {
        const templateExerciseId =
          getTemplateExerciseStableId(templateExercise) || "";
        const change = changesByTemplateId.get(templateExerciseId);
        let nextTemplateExercise = templateExercise;

        if (change?.type === "deleted" && change.choice === "updateTemplate") {
          return buildAdditionExercises(templateExerciseId);
        }

        if (
          change?.type === "replaced" &&
          change.choice === "updateTemplate" &&
          change.workoutExercise
        ) {
          nextTemplateExercise = buildTemplateExerciseFromWorkoutChange(
            change.workoutExercise,
            templateExercise,
          );
        } else if (
          change?.type === "variant" &&
          change.choice === "updateTemplate" &&
          change.workoutExercise
        ) {
          const updatedSelection = buildTemplateExerciseFromWorkoutChange(
            change.workoutExercise,
            templateExercise,
          );
          nextTemplateExercise = {
            ...updatedSelection,
            sets: Array.isArray(templateExercise?.sets)
              ? templateExercise.sets
              : updatedSelection.sets,
          };
        } else if (
          change?.type === "replaced" &&
          change.choice === "gymSwap" &&
          selectedGymId &&
          change.workoutExercise
        ) {
          nextTemplateExercise = {
            ...templateExercise,
            gymReplacements: {
              ...normalizeGymReplacements(templateExercise.gymReplacements),
              [selectedGymId]: createGymReplacementEntry(
                createExerciseEntryFromWorkoutExercise(change.workoutExercise),
              ),
            },
          };
        }

        return [
          nextTemplateExercise,
          ...buildAdditionExercises(templateExerciseId),
        ];
      }),
    ];

    const nameChange = changes.find(
      (change) => change.type === "name" && change.choice === "updateTemplate",
    );
    const nextTemplateName =
      cleanLimitedText(nameChange?.toLabel, LIMITS.nameChars) ||
      cleanLimitedText(storedTemplate?.name, LIMITS.nameChars) ||
      "Template";

    const updatedTemplate = {
      ...storedTemplate,
      name: nextTemplateName,
      exercises: cleanInvalidSupersets(nextExercises),
      updatedAt: Date.now(),
    };
    const updatedTemplates = [...existingTemplates];
    updatedTemplates[templateIndex] = updatedTemplate;

    try {
      await saveTemplatesLocallyAndToCloud(updatedTemplates, uid);
    } catch (error) {
      await AsyncStorage.setItem(
        `@workout_templates_${uid}`,
        JSON.stringify(updatedTemplates),
      );
      console.log("Cloud routine backup delayed.", error);
    }

    setActiveTemplate(updatedTemplate);
    setPendingGymReplacementUpdates(remainingPendingUpdates);
    await saveActiveSessionSnapshot({
      templateData: updatedTemplate,
      pendingGymReplacementUpdates: remainingPendingUpdates,
    });

    return updatedTemplate;
  };

  const updateTemplateChangeChoice = (
    changeId: string,
    choice: TemplateChangeChoice,
  ) => {
    setTemplateDecisionAlert((prev) => ({
      ...prev,
      changes: prev.changes.map((change) =>
        change.id === changeId ? { ...change, choice } : change,
      ),
    }));
  };

  const getUpdatedTemplateNameFromDecision = (
    changes: TemplateChangeItem[],
  ) => {
    const nameChange = changes.find(
      (change) => change.type === "name" && change.choice === "updateTemplate",
    );
    return (
      cleanLimitedText(nameChange?.toLabel, LIMITS.nameChars) ||
      cleanLimitedText(activeTemplate?.name, LIMITS.nameChars) ||
      "Template"
    );
  };

  const validateNewTemplateNameForDecision = async (
    decision: typeof templateDecisionAlert,
  ) => {
    if (!decision.createNewTemplate) return "";

    const name = cleanLimitedText(decision.newTemplateName, LIMITS.nameChars);
    if (!name) return "Enter a template name.";

    const updatedExistingName = getUpdatedTemplateNameFromDecision(
      decision.changes,
    );
    if (
      normalizeTemplateNameForCompare(name) ===
      normalizeTemplateNameForCompare(updatedExistingName)
    ) {
      return "Use a different name from the existing template.";
    }

    if (!uid) return "";
    const rawTemplates = await AsyncStorage.getItem(
      `@workout_templates_${uid}`,
    );
    const existingTemplates = rawTemplates
      ? safeJsonParse<any[]>(rawTemplates, []).filter(Boolean)
      : [];
    const duplicate = existingTemplates.some(
      (template: any) =>
        normalizeTemplateNameForCompare(template?.name) ===
        normalizeTemplateNameForCompare(name),
    );

    return duplicate ? "A template with this name already exists." : "";
  };

  const confirmTemplateDecisionChoices = async () => {
    if (finishWorkoutInFlightRef.current) return;

    const decision = {
      ...templateDecisionAlert,
      newTemplateName: cleanLimitedText(
        templateDecisionAlert.newTemplateName,
        LIMITS.nameChars,
      ),
    };
    let nameError = "";
    try {
      nameError = await validateNewTemplateNameForDecision(decision);
    } catch (error) {
      console.log("Could not validate new template name:", error);
      nameError = "Could not check this name. Please try again.";
    }
    if (nameError) {
      setTemplateDecisionAlert((prev) => ({
        ...prev,
        newTemplateName: decision.newTemplateName,
        newTemplateNameError: nameError,
      }));
      return;
    }

    finishWorkoutInFlightRef.current = true;
    setIsFinishing(true);
    setTemplateDecisionAlert((prev) => ({
      ...prev,
      visible: false,
      newTemplateName: decision.newTemplateName,
      newTemplateNameError: "",
    }));
    setTimeout(() => finishAfterTemplateDecision(decision), 250);
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
    setTemplateNameInput(
      limitText(getSuggestedNewTemplateName(), LIMITS.nameChars),
    );
    setTemplateNamePrompt({
      visible: true,
      title,
      message,
      sourceExercises,
    });
  };

  const confirmTemplateNamePrompt = async () => {
    const preferredName = cleanLimitedText(templateNameInput, LIMITS.nameChars);
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
        const scheduledNotifications =
          await Notifications.getAllScheduledNotificationsAsync();
        await Promise.all(
          scheduledNotifications
            .filter(
              (notification) =>
                notification?.content?.data?.type === "REST_TIMER_COMPLETE",
            )
            .map((notification) =>
              Notifications.cancelScheduledNotificationAsync(
                notification.identifier,
              ),
            ),
        );
      }
    } catch (error) {
      console.log("Unable to clear rest timer notification:", error);
    }
  };

  const scheduleRestNotification = async (
    seconds: number,
    restType: RestTimerType = "working",
  ) => {
    if (isEditing) return;
    await clearRestTimerNotification(true);
    if (seconds <= 0) return;

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: restType === "warmup" ? "Warm-up Rest Over!" : "Rest Over!",
        body:
          restType === "warmup"
            ? "Ready for your next warm-up or working set."
            : "Time for your next set. Let's go!",
        sound: true,
        data: { type: "REST_TIMER_COMPLETE", screen: "Workout", restType },
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
          weight: toSetInputValue(s.weight),
          reps: toSetInputValue(s.reps),
          repsL: toSetInputValue(s.repsL),
          repsR: toSetInputValue(s.repsR),
          rpe: formatRpeValue(s.rpe),
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
        sessionWarmupRestEnabled:
          overrides.sessionWarmupRestEnabled ?? sessionWarmupRestEnabled,
        sessionWarmupRestDuration:
          overrides.sessionWarmupRestDuration ?? sessionWarmupRestDuration,
        timerEndTime: overrides.timerEndTime ?? timerEndTime,
        activeRestType: overrides.activeRestType ?? activeRestType,
        pendingGymReplacementUpdates:
          overrides.pendingGymReplacementUpdates ??
          pendingGymReplacementUpdates,
        isKg,
        historicalWeightPrefillState:
          historicalWeightPrefillStateRef.current,
        rpeTrackingEnabled:
          overrides.rpeTrackingEnabled ?? rpeTrackingEnabled,
        totalPausedMs: overrides.totalPausedMs ?? totalPausedMs,
        pauseStartedAt: overrides.pauseStartedAt ?? pauseStartedAt,
        isWorkoutPaused: overrides.isWorkoutPaused ?? !!pauseStartedAt,
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
    const restType: RestTimerType = completedSet?.isWarmup
      ? "warmup"
      : "working";
    if (restType === "warmup" && !sessionWarmupRestEnabledRef.current) return;
    if (!shouldStartRestForExercise(exerciseIndex, exerciseList)) return;

    const durationValue =
      restType === "warmup"
        ? sessionWarmupRestDurationRef.current
        : sessionRestDurationRef.current;
    const fallbackSeconds =
      restType === "warmup"
        ? DEFAULT_WARMUP_REST_SECONDS
        : DEFAULT_WORKING_REST_SECONDS;
    const parsedSeconds = parseInt(String(durationValue || ""), 10);
    const restSeconds = clampRestSeconds(
      Number.isFinite(parsedSeconds) && parsedSeconds > 0
        ? parsedSeconds
        : fallbackSeconds,
    );
    const nextEndTime = Date.now() + restSeconds * 1000;

    activeRestTypeRef.current = restType;
    setActiveRestType(restType);
    setTimerEndTime(nextEndTime);
    setDisplayRestTime(restSeconds);
    scheduleRestNotification(restSeconds, restType);
    saveActiveSessionSnapshot({
      timerEndTime: nextEndTime,
      activeRestType: restType,
    }).catch((error) => {
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
      activeRestTypeRef.current = null;
      setActiveRestType(null);
      await clearRestTimerNotification(true);
    }

    await saveActiveSessionSnapshot({
      sessionRestEnabled: nextEnabled,
      timerEndTime: nextEnabled ? timerEndTime : null,
      activeRestType: nextEnabled ? activeRestTypeRef.current : null,
    });
  };

  const updateSessionRestDuration = async (seconds: number) => {
    if (isEditing) return;

    const safeSeconds = clampRestSeconds(seconds);
    const nextDuration = String(safeSeconds);
    sessionRestDurationRef.current = nextDuration;
    setSessionRestDuration(nextDuration);
    await saveActiveSessionSnapshot({ sessionRestDuration: nextDuration });
  };

  const toggleSessionWarmupRestTimer = async () => {
    if (isEditing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextEnabled = !sessionWarmupRestEnabledRef.current;
    const shouldClearWarmupTimer =
      !nextEnabled && activeRestTypeRef.current === "warmup";
    sessionWarmupRestEnabledRef.current = nextEnabled;
    setSessionWarmupRestEnabled(nextEnabled);

    if (shouldClearWarmupTimer) {
      setTimerEndTime(null);
      setDisplayRestTime(0);
      activeRestTypeRef.current = null;
      setActiveRestType(null);
      await clearRestTimerNotification(true);
    }

    await saveActiveSessionSnapshot({
      sessionWarmupRestEnabled: nextEnabled,
      timerEndTime: shouldClearWarmupTimer ? null : timerEndTime,
      activeRestType: shouldClearWarmupTimer ? null : activeRestTypeRef.current,
    });
  };

  const updateSessionWarmupRestDuration = async (seconds: number) => {
    if (isEditing) return;

    const safeSeconds = clampRestSeconds(seconds);
    const nextDuration = String(safeSeconds);
    sessionWarmupRestDurationRef.current = nextDuration;
    setSessionWarmupRestDuration(nextDuration);
    await saveActiveSessionSnapshot({
      sessionWarmupRestDuration: nextDuration,
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
      const historyList = safeJsonParse<any[]>(historyRaw, [])
        .filter((w: any) => w.gymId === gymId)
        .sort((a: any, b: any) => parseInt(b.id) - parseInt(a.id));

      for (const pastWorkout of historyList) {
        const pastEx = pastWorkout.fullWorkoutData?.find(
          (e: any) =>
            cleanExerciseNameForAttachments(e) ===
            cleanExerciseNameForAttachments(ex),
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

  const getHistoricalEquipmentTagsForGym = (
    gymId: string | null,
    allowedBrands: Set<string>,
  ) => {
    const tagsByExerciseName = new Map<string, string>();
    if (!gymId) return tagsByExerciseName;

    const sortedHistory = [...workoutHistory]
      .filter((workout: any) => String(workout?.gymId || "") === String(gymId))
      .sort((a: any, b: any) => {
        const aTime = Number(a?.startedAt || a?.id || 0);
        const bTime = Number(b?.startedAt || b?.id || 0);
        return bTime - aTime;
      });

    for (const pastWorkout of sortedHistory) {
      const pastExercises = Array.isArray(pastWorkout?.fullWorkoutData)
        ? pastWorkout.fullWorkoutData
        : [];

      for (const pastExercise of pastExercises) {
        const exerciseName = cleanExerciseNameForAttachments(pastExercise);
        const equipmentTag = String(pastExercise?.equipmentTag || "").trim();
        if (
          !exerciseName ||
          tagsByExerciseName.has(exerciseName) ||
          !equipmentTag ||
          !allowedBrands.has(equipmentTag) ||
          !isMachineBrandApplicable(pastExercise)
        ) {
          continue;
        }

        tagsByExerciseName.set(exerciseName, equipmentTag);
      }
    }

    return tagsByExerciseName;
  };

  const prepareExercisesForGym = (
    sourceExercises: any[],
    gymId: string | null,
  ) => {
    const selectedGym = gyms.find((g) => g.id === gymId);
    const newGymVariants = selectedGym?.variants || [];
    const defaultMachineBrand = selectedGym?.defaultMachineBrand || null;
    const allowedBrands = new Set([
      ...DEFAULT_VARIANTS,
      ...globalVariants,
      ...newGymVariants,
    ]);
    const historicalTags = getHistoricalEquipmentTagsForGym(
      gymId,
      allowedBrands,
    );

    return sourceExercises.map((exercise) => {
      const preparedExercise =
        activeTemplate?.id && gymId
          ? applyGymReplacementToExerciseSlot(exercise, gymId)
          : { ...exercise };

      if (!isMachineBrandApplicable(preparedExercise)) {
        const { equipmentTag, machineBrand, ...cleanedExercise } =
          preparedExercise;
        return cleanedExercise;
      }

      const exerciseName = String(
        cleanExerciseNameForAttachments(preparedExercise || exercise),
      );
      const historicalTag = historicalTags.get(exerciseName);

      if (historicalTag && allowedBrands.has(historicalTag)) {
        return { ...preparedExercise, equipmentTag: historicalTag };
      }

      if (defaultMachineBrand && allowedBrands.has(defaultMachineBrand)) {
        return { ...preparedExercise, equipmentTag: defaultMachineBrand };
      }

      const { equipmentTag, ...cleanedExercise } = preparedExercise;
      return cleanedExercise;
    });
  };

  const handleConfirmPreFlight = async () => {
    if (isPreFlightConfirming) return;

    if (gyms.length > 0 && !selectedGymId) {
      Alert.alert("Select Gym", "Choose a gym before starting this workout.");
      return;
    }

    const nextGymId = selectedGymId;
    const shouldMarkUnsaved = isChangingLocation;

    setIsPreFlightConfirming(true);
    await waitForUiFrame();

    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (!startTimeMs) {
        const startMs = Date.now();
        setStartTimeMs(startMs);
        setTotalPausedMs(0);
        setPauseStartedAt(null);
        if (uid) {
          await AsyncStorage.setItem(
            `@active_workout_start_${uid}`,
            startMs.toString(),
          );
        }
      }

      if (nextGymId && uid) {
        await AsyncStorage.setItem(`@last_used_gym_${uid}`, nextGymId);
      }

      const preparedExercises = prepareExercisesForGym(exercises, nextGymId);
      const prefillState = isHistoricalWeightPrefillActive
        ? historicalWeightPrefillStateRef.current
        : createHistoricalWeightPrefillState(preparedExercises);
      const preparedHints = preparedExercises.map((exercise) =>
        buildBestHistoricalSetPositionHints(exercise, workoutHistory, isKg),
      );
      const reconciled = reconcileHistoricalWeightPrefills(
        preparedExercises,
        preparedHints,
        prefillState,
      );
      historicalWeightPrefillStateRef.current = reconciled.state;
      skipNextWeightPrefillReconcileRef.current = true;
      setIsHistoricalWeightPrefillActive(true);
      setExercises(reconciled.exercises);
      if (shouldMarkUnsaved) setHasUnsavedChanges(true);
      setIsChangingLocation(false);
      setIsPreFlightVisible(false);
    } catch (error) {
      console.error("Failed to prepare workout start:", error);
      Alert.alert(
        "Start Failed",
        "IronVault could not start this workout. Please try again.",
      );
    } finally {
      setIsPreFlightConfirming(false);
    }
  };

  const buildWorkoutExerciseFromSelection = async (
    exData: any,
    gymId: string | null = selectedGymId,
  ) => {
    const attachmentExercise = normalizeExerciseForAttachmentStorage(exData);
    const variationOptions = getExerciseVariationOptions(attachmentExercise);
    const attachmentOptions = getExerciseAttachmentOptionsWithCustom(
      attachmentExercise,
      customAttachments,
    );
    const newExercise = {
      id: genId("ex-"),
      originalExerciseId:
        attachmentExercise.id || attachmentExercise.originalExerciseId || null,
      name: attachmentExercise.name,
      reminder: attachmentExercise.reminder || "",
      remark: "",
      muscle: attachmentExercise.muscle,
      exerciseVariant: variationOptions.length > 0 ? "Normal" : undefined,
      variationOptions,
      attachment: getExerciseAttachmentForSave(attachmentExercise),
      attachmentOptions:
        attachmentOptions.length > 0 ? attachmentOptions : undefined,
      supportsAttachments: attachmentOptions.length > 0 ? true : undefined,
      is_unilateral: !!attachmentExercise.is_unilateral,
      equipment: attachmentExercise.equipment,
      equipmentType: attachmentExercise.equipmentType,
      machineBrandApplicable: attachmentExercise.machineBrandApplicable,
      brandApplicable: attachmentExercise.brandApplicable,
      brand: attachmentExercise.brand,
      machineBrand: attachmentExercise.machineBrand,
      image: attachmentExercise.image,
      sets: [
        {
          id: genId(),
          weight: "",
          reps: "",
          repsL: "",
          repsR: "",
          rpe: "",
          completed: false,
          isWarmup: false,
          createdAt: Date.now(),
        },
      ],
    };

    return getAutoFilledExercise(newExercise, gymId);
  };

  const addExercisesToWorkout = async (exerciseList: any[]) => {
    const incoming = Array.isArray(exerciseList)
      ? exerciseList.filter(Boolean)
      : [];
    if (incoming.length === 0) return;

    const availableSlots = LIMITS.exercisesPerWorkout - exercises.length;
    if (availableSlots <= 0) {
      showInfo(
        "Exercise Limit Reached",
        "Each workout can have up to 25 exercises.",
      );
      return;
    }

    const exercisesToAdd = incoming.slice(0, availableSlots);
    if (incoming.length > availableSlots) {
      showInfo(
        "Some Exercises Were Not Added",
        `This workout only has room for ${availableSlots} more exercise${availableSlots === 1 ? "" : "s"}.`,
      );
    }

    const builtExercises = await Promise.all(
      exercisesToAdd.map((exData) => buildWorkoutExerciseFromSelection(exData)),
    );
    setExercises((prev) => [...prev, ...builtExercises]);
    setHasUnsavedChanges(true);
  };

  const openCustomAttachmentModal = (exerciseIndex: number) => {
    setCustomAttachmentModal({
      visible: true,
      exerciseIndex,
      value: "",
      error: "",
      editingAttachment: null,
    });
  };

  const closeCustomAttachmentModal = () => {
    setCustomAttachmentModal({
      visible: false,
      exerciseIndex: null,
      value: "",
      error: "",
      editingAttachment: null,
    });
  };

  const reconcileExerciseCustomAttachment = (
    exercise: any,
    previousAttachment: string,
    nextAttachment: string | null,
    nextCustomAttachments: string[],
  ) => {
    const previousKey = normalizeAttachmentIdentity(previousAttachment);
    const explicitNoAttachment = hasExplicitNoAttachment(exercise);
    const currentAttachment = explicitNoAttachment
      ? ""
      : getDefaultExerciseAttachment(exercise);
    const currentKey = normalizeAttachmentIdentity(currentAttachment);
    const attachmentOptions = Array.isArray(exercise?.attachmentOptions)
      ? exercise.attachmentOptions
          .map((attachment: string) =>
            normalizeAttachmentIdentity(attachment) === previousKey
              ? nextAttachment
              : attachment,
          )
          .filter(Boolean)
      : [];
    const fallbackExercise = {
      ...exercise,
      attachment: undefined,
      attachmentOptions,
    };
    const attachment =
      currentKey === previousKey
        ? nextAttachment || getDefaultExerciseAttachment(fallbackExercise)
        : currentAttachment;
    const savedAttachment =
      (attachment || explicitNoAttachment) ? attachment : undefined;
    const options = getExerciseAttachmentOptionsWithCustom(
      {
        ...exercise,
        attachment: savedAttachment,
        attachmentOptions,
      },
      nextCustomAttachments,
    );

    return {
      ...exercise,
      attachment: savedAttachment,
      attachmentOptions: options.length > 0 ? options : undefined,
      supportsAttachments: options.length > 0 ? true : undefined,
    };
  };

  const editCustomAttachment = (attachment: string) => {
    setCustomAttachmentModal((prev) => ({
      ...prev,
      visible: true,
      value: attachment,
      error: "",
      editingAttachment: attachment,
    }));
  };

  const deleteCustomAttachment = async (attachment: string) => {
    const nextCustomAttachments = await saveCustomAttachments(
      removeCustomAttachmentFromList(customAttachments, attachment),
      uid,
    );

    setCustomAttachments(nextCustomAttachments);
    setExercises((prev) =>
      prev.map((exercise) =>
        reconcileExerciseCustomAttachment(
          exercise,
          attachment,
          null,
          nextCustomAttachments,
        ),
      ),
    );
    setCustomAttachmentModal((prev) =>
      normalizeAttachmentIdentity(prev.editingAttachment) ===
      normalizeAttachmentIdentity(attachment)
        ? { ...prev, value: "", error: "", editingAttachment: null }
        : prev,
    );
    setHasUnsavedChanges(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const saveCustomAttachmentForExercise = async () => {
    const exerciseIndex = customAttachmentModal.exerciseIndex;
    if (exerciseIndex === null) return;

    const targetExercise = exercises[exerciseIndex];
    if (!targetExercise) return;

    const { attachment, error } = validateCustomAttachmentName(
      customAttachmentModal.value,
      getExerciseAttachmentOptions(targetExercise),
      customAttachments,
      customAttachmentModal.editingAttachment,
    );

    if (error) {
      setCustomAttachmentModal((prev) => ({ ...prev, error }));
      return;
    }

    const isEditingAttachment = !!customAttachmentModal.editingAttachment;
    const nextCustomAttachments = await saveCustomAttachments(
      isEditingAttachment
        ? replaceCustomAttachmentInList(
            customAttachments,
            customAttachmentModal.editingAttachment!,
            attachment,
          )
        : [...customAttachments, attachment],
      uid,
    );

    setCustomAttachments(nextCustomAttachments);
    setExercises((prev) => {
      const up = [...prev];
      if (!up[exerciseIndex]) return prev;
      return up.map((exercise, index) => {
        if (isEditingAttachment) {
          const reconciled = reconcileExerciseCustomAttachment(
            exercise,
            customAttachmentModal.editingAttachment!,
            attachment,
            nextCustomAttachments,
          );
          return index === exerciseIndex
            ? {
                ...reconciled,
                attachment: sanitizeCustomAttachmentName(attachment),
              }
            : reconciled;
        }

        if (index !== exerciseIndex) return exercise;
        const nextOptions = mergeAttachmentOptions(
          [attachment, ...getExerciseAttachmentOptions(exercise)],
          nextCustomAttachments,
        );
        return {
          ...exercise,
          attachment: sanitizeCustomAttachmentName(attachment),
          attachmentOptions: nextOptions,
          supportsAttachments: true,
        };
      });
    });
    setHasUnsavedChanges(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    closeCustomAttachmentModal();
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
      const rpePreference = await AsyncStorage.getItem(
        `@rpe_tracking_enabled_${uid}`,
      );
      const loadedRpeTrackingEnabled = rpePreference === "true";
      setRpeTrackingEnabled(loadedRpeTrackingEnabled);
      const pc = await AsyncStorage.getItem(`@plate_calc_enabled_${uid}`);
      setIsPlateCalcEnabled(pc !== "false");

      const pkg = await AsyncStorage.getItem(`@plates_kg_${uid}`);
      const plbs = await AsyncStorage.getItem(`@plates_lbs_${uid}`);
      setAvailablePlates(
        usingKg
          ? pkg
            ? safeJsonParse(pkg, DEFAULT_PLATES_KG)
            : DEFAULT_PLATES_KG
          : plbs
            ? safeJsonParse(plbs, DEFAULT_PLATES_LBS)
            : DEFAULT_PLATES_LBS,
      );

      const storedInv = await AsyncStorage.getItem(`@plate_inventory_${uid}`);
      if (storedInv) setPlateInventory(safeJsonParse(storedInv, {}));

      const savedGyms = await AsyncStorage.getItem(`@user_gyms_${uid}`);
      let loadedGyms = savedGyms ? safeJsonParse<any[]>(savedGyms, []) : [];

      const savedHistory = await AsyncStorage.getItem(
        `@workout_history_${uid}`,
      );
      const parsedHistory = savedHistory
        ? safeJsonParse<any[]>(savedHistory, []).filter(
            (workout: any) => workout && workout.id,
          )
        : [];
      setWorkoutHistory(parsedHistory);
      if (loadedGyms.length === 0) {
        const cloudGyms = await fetchConfigFromCloud("gyms");
        if (cloudGyms) loadedGyms = cloudGyms;
      }
      setGyms(loadedGyms);

      const savedGlobalVars = await AsyncStorage.getItem(
        `@global_variants_${uid}`,
      );
      if (savedGlobalVars) {
        setGlobalVariants(safeJsonParse(savedGlobalVars, []));
      } else {
        const cloudVars = await fetchConfigFromCloud("global_variants" as any);
        if (cloudVars) setGlobalVariants(cloudVars);
      }

      const activeSession = await AsyncStorage.getItem(
        `@active_session_${uid}`,
      );

      if (route.params?.editData) {
        historicalWeightPrefillStateRef.current = {};
        skipNextWeightPrefillReconcileRef.current = false;
        setIsHistoricalWeightPrefillActive(false);
        setRpeTrackingEnabled(workoutUsesRpeTracking(route.params.editData));
        const loadedEx = initializeSets(
          route.params.editData.fullWorkoutData || [],
        );
        setExercises(loadedEx);
        setWorkoutName(
          limitText(route.params.editData.workoutName || "Edit Session", LIMITS.nameChars),
        );
        setHasUnsavedChanges(false);
        if (route.params.editData.duration)
          setWorkoutDurationStr(route.params.editData.duration);
        setSelectedGymId(route.params.editData.gymId || null);
      } else if (activeSession) {
        const parsed = safeJsonParse<any>(activeSession, {});
        const activeSessionUsesKg =
          typeof parsed.isKg === "boolean" ? parsed.isKg : usingKg;
        setIsKg(activeSessionUsesKg);
        setCalcBar(activeSessionUsesKg ? "20" : "45");
        setAvailablePlates(
          activeSessionUsesKg
            ? pkg
              ? safeJsonParse(pkg, DEFAULT_PLATES_KG)
              : DEFAULT_PLATES_KG
            : plbs
              ? safeJsonParse(plbs, DEFAULT_PLATES_LBS)
              : DEFAULT_PLATES_LBS,
        );
        setRpeTrackingEnabled(
          workoutUsesRpeTracking({
            rpeTrackingEnabled: parsed.rpeTrackingEnabled,
            fullWorkoutData: parsed.exercises,
          }),
        );
        const restoredExercises = initializeSets(parsed.exercises || []);
        historicalWeightPrefillStateRef.current =
          restoreHistoricalWeightPrefillState(
            parsed.historicalWeightPrefillState,
            restoredExercises,
          );
        skipNextWeightPrefillReconcileRef.current = true;
        setIsHistoricalWeightPrefillActive(true);
        setExercises(restoredExercises);
        setWorkoutName(
          limitText(parsed.workoutName || "New Session", LIMITS.nameChars),
        );
        if (parsed.templateData) setActiveTemplate(parsed.templateData);
        if (Array.isArray(parsed.pendingGymReplacementUpdates)) {
          setPendingGymReplacementUpdates(parsed.pendingGymReplacementUpdates);
        }
        if (parsed.gymId) setSelectedGymId(parsed.gymId);
        if (typeof parsed.sessionRestEnabled === "boolean") {
          sessionRestEnabledRef.current = parsed.sessionRestEnabled;
          setSessionRestEnabled(parsed.sessionRestEnabled);
        }
        if (parsed.sessionRestDuration) {
          const clampedRestDuration = String(
            clampRestSeconds(parsed.sessionRestDuration),
          );
          sessionRestDurationRef.current = clampedRestDuration;
          setSessionRestDuration(clampedRestDuration);
        }
        if (typeof parsed.sessionWarmupRestEnabled === "boolean") {
          sessionWarmupRestEnabledRef.current =
            parsed.sessionWarmupRestEnabled;
          setSessionWarmupRestEnabled(parsed.sessionWarmupRestEnabled);
        }
        if (parsed.sessionWarmupRestDuration) {
          const clampedWarmupRestDuration = String(
            clampRestSeconds(parsed.sessionWarmupRestDuration),
          );
          sessionWarmupRestDurationRef.current = clampedWarmupRestDuration;
          setSessionWarmupRestDuration(clampedWarmupRestDuration);
        }
        if (parsed.timerEndTime && parsed.timerEndTime > Date.now()) {
          const restoredRestType =
            parsed.activeRestType === "warmup" ? "warmup" : "working";
          activeRestTypeRef.current = restoredRestType;
          setActiveRestType(restoredRestType);
          setTimerEndTime(parsed.timerEndTime);
          setDisplayRestTime(
            Math.ceil((parsed.timerEndTime - Date.now()) / 1000),
          );
        } else if (parsed.timerEndTime) {
          activeRestTypeRef.current = null;
          setActiveRestType(null);
          await clearRestTimerNotification(true);
        }

        const startStr = await AsyncStorage.getItem(
          `@active_workout_start_${uid}`,
        );
        const parsedStartMs = startStr ? parseInt(startStr, 10) : null;
        if (parsedStartMs) setStartTimeMs(parsedStartMs);

        const savedPausedMs = Math.max(0, Number(parsed.totalPausedMs || 0));
        let effectivePausedMs = savedPausedMs;
        if (parsed.isWorkoutPaused && parsed.pauseStartedAt) {
          const resumedPausedMs =
            savedPausedMs +
            Math.max(0, Date.now() - Number(parsed.pauseStartedAt));
          effectivePausedMs = resumedPausedMs;
          setTotalPausedMs(resumedPausedMs);
          setPauseStartedAt(null);
          await AsyncStorage.setItem(
            `@active_session_${uid}`,
            JSON.stringify({
              ...parsed,
              totalPausedMs: resumedPausedMs,
              pauseStartedAt: null,
              isWorkoutPaused: false,
              timerEndTime: null,
              activeRestType: null,
              timestamp: Date.now(),
            }),
          );
          activeRestTypeRef.current = null;
          setActiveRestType(null);
          await clearRestTimerNotification(true);
        } else {
          setTotalPausedMs(savedPausedMs);
          setPauseStartedAt(parsed.pauseStartedAt || null);
        }

        if (
          parsedStartMs &&
          !durationLimitNoticeShownRef.current &&
          Date.now() - parsedStartMs - effectivePausedMs >
            MAX_WORKOUT_DURATION_MS
        ) {
          durationLimitNoticeShownRef.current = true;
          setTimeout(() => {
            showInfo(
              "Workout Over 24h",
              "When you finish this workout, IronVault will ask you to save it at the 24-hour mark or keep editing.",
            );
          }, 500);
        }
      } else {
        historicalWeightPrefillStateRef.current = {};
        skipNextWeightPrefillReconcileRef.current = false;
        setIsHistoricalWeightPrefillActive(false);
        const lastGym = await AsyncStorage.getItem(`@last_used_gym_${uid}`);
        let initialGymId: string | null = null;
        if (lastGym && loadedGyms.some((g: any) => g.id === lastGym)) {
          initialGymId = lastGym;
        } else if (loadedGyms.length > 0) {
          initialGymId = loadedGyms[0].id;
        }

        if (initialGymId) setSelectedGymId(initialGymId);

        setIsPreFlightVisible(true);

        if (route.params?.templateData) {
          setActiveTemplate(route.params.templateData);
          setWorkoutName(
            limitText(route.params.templateData.name || "New Session", LIMITS.nameChars),
          );
          const mapped = (route.params.templateData.exercises || []).map(
            (exObj: any, exIdx: number) => {
              const sourceExercise =
                typeof exObj === "string" ? { name: exObj } : exObj || {};
              const attachmentExercise =
                normalizeExerciseForAttachmentStorage(sourceExercise);
              const attachmentOptions =
                getExerciseAttachmentOptions(attachmentExercise);
              const exName = attachmentExercise.name;
              const isUnilateral = !!attachmentExercise.is_unilateral;
              const brand = attachmentExercise.brand;
              let generatedSets: any[] = [];

              if (Array.isArray(sourceExercise.sets)) {
                generatedSets = sourceExercise.sets.map((s: any, setIdx: number) => ({
                  id: genId(`set-${exIdx}-${setIdx}-`),
                  weight: "",
                  reps: "",
                  repsL: "",
                  repsR: "",
                  rpe: "",
                  completed: false,
                  isWarmup: !!s.isWarmup,
                  createdAt: Date.now() + setIdx,
                }));
              } else {
                const numSets =
                  typeof exObj === "string" ? 1 : sourceExercise.sets || 1;
                generatedSets = Array.from({ length: numSets }).map(
                  (_, setIdx) => ({
                    id: genId(`set-${exIdx}-${setIdx}-`),
                    weight: "",
                    reps: "",
                    repsL: "",
                    repsR: "",
                    rpe: "",
                    completed: false,
                    isWarmup: false,
                    createdAt: Date.now() + setIdx,
                  }),
                );
              }
              return {
                id: genId(`ex-${exIdx}-`),
                originalExerciseId:
                  attachmentExercise.id || attachmentExercise.originalExerciseId,
                name: exName,
                muscle: attachmentExercise.muscle,
                equipment: attachmentExercise.equipment,
                equipmentType: attachmentExercise.equipmentType,
                machineBrandApplicable:
                  attachmentExercise.machineBrandApplicable,
                brandApplicable: attachmentExercise.brandApplicable,
                image: attachmentExercise.image,
                reminder: attachmentExercise.reminder || "",
                remark: "",
                exerciseVariant: attachmentExercise.exerciseVariant || "Normal",
                variationOptions: attachmentExercise.variationOptions,
                attachment: getExerciseAttachmentForSave(attachmentExercise),
                attachmentOptions:
                  attachmentOptions.length > 0 ? attachmentOptions : undefined,
                supportsAttachments:
                  attachmentOptions.length > 0 ? true : undefined,
                is_unilateral: isUnilateral,
                brand: brand,
                machineBrand: attachmentExercise.machineBrand,
                supersetId: attachmentExercise.supersetId || null,
                supersetOrder: attachmentExercise.supersetOrder,
                gymReplacements: normalizeGymReplacements(
                  attachmentExercise.gymReplacements,
                ),
                templateBaseExercise: {
                  ...attachmentExercise,
                  sets: undefined,
                  gymReplacements: normalizeGymReplacements(
                    attachmentExercise.gymReplacements,
                  ),
                },
                sets: generatedSets,
              };
            },
          );
          setExercises(initializeSets(mapped));
        } else if (route.params?.initialExercise) {
          const seededExercise = await buildWorkoutExerciseFromSelection(
            route.params.initialExercise,
            initialGymId,
          );
          setExercises(initializeSets([seededExercise]));
        }
      }
      setIsLoaded(true);
    })();
  }, [route.params, uid]);

  useEffect(() => {
    let isMounted = true;

    const loadNextSessionNotes = async () => {
      if (!uid || isEditing || !activeTemplate?.id) {
        if (isMounted) setNextSessionNotesEnabled(false);
        if (isMounted) setNextSessionNotes({});
        return;
      }

      const enabled = await readNextSessionNotesEnabled(uid);
      if (isMounted) setNextSessionNotesEnabled(enabled);
      if (!enabled) {
        if (isMounted) setNextSessionNotes({});
        return;
      }

      const notes = await readTemplateNextSessionNotes(uid, activeTemplate.id);
      if (isMounted) setNextSessionNotes(notes);
    };

    loadNextSessionNotes();

    return () => {
      isMounted = false;
    };
  }, [activeTemplate?.id, isEditing, uid]);

  useEffect(() => {
    if (!startTimeMs || isEditing || isSummaryVisible || isPreFlightVisible)
      return;
    const updateWorkoutTimer = () => {
      setWorkoutDurationStr(formatDurationFromMs(getActiveWorkoutDurationMs()));
    };
    updateWorkoutTimer();
    const interval = setInterval(updateWorkoutTimer, 1000);
    return () => clearInterval(interval);
  }, [
    startTimeMs,
    totalPausedMs,
    pauseStartedAt,
    isEditing,
    isSummaryVisible,
    isPreFlightVisible,
  ]);

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
    pendingGymReplacementUpdates,
    sessionRestEnabled,
    sessionRestDuration,
    sessionWarmupRestEnabled,
    sessionWarmupRestDuration,
    rpeTrackingEnabled,
    timerEndTime,
    activeRestType,
    totalPausedMs,
    pauseStartedAt,
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
        activeRestTypeRef.current = null;
        setActiveRestType(null);
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

  const handleReplaceExercise = (index: number) => {
    setSelectedExerciseIndex(index);
    setIsExerciseMenuVisible(false);
    navigation.navigate("Search", {
      mode: "replace",
      existingExercises: exercises
        .filter((_, i) => i !== index)
        .map((e) => e.name),
      onSelect: async (exData: any) => {
        const previousExercise = exercises[index];
        const templateExerciseId =
          previousExercise?.templateSwapSourceExerciseId ||
          previousExercise?.templateBaseExercise?.id ||
          previousExercise?.templateBaseExercise?.originalExerciseId ||
          null;
        const templateBaseExercise = getTemplateExerciseById(
          activeTemplate,
          templateExerciseId,
        );
        const attachmentExercise = normalizeExerciseForAttachmentStorage(exData);
        const variationOptions = getExerciseVariationOptions(attachmentExercise);
        const attachmentOptions = getExerciseAttachmentOptions(attachmentExercise);
        let newEx = {
          name: attachmentExercise.name,
          originalExerciseId:
            attachmentExercise.id || attachmentExercise.originalExerciseId || null,
          reminder: attachmentExercise.reminder || "",
          remark: "",
          muscle: attachmentExercise.muscle,
          exerciseVariant: variationOptions.length > 0 ? "Normal" : undefined,
          variationOptions,
          attachment: getExerciseAttachmentForSave(attachmentExercise),
          attachmentOptions:
            attachmentOptions.length > 0 ? attachmentOptions : undefined,
          supportsAttachments: attachmentOptions.length > 0 ? true : undefined,
          is_unilateral: !!attachmentExercise.is_unilateral,
          equipment: attachmentExercise.equipment,
          equipmentType: attachmentExercise.equipmentType,
          machineBrandApplicable: attachmentExercise.machineBrandApplicable,
          brandApplicable: attachmentExercise.brandApplicable,
          brand: attachmentExercise.brand,
          machineBrand: attachmentExercise.machineBrand,
          image: attachmentExercise.image,
          supersetId: previousExercise?.supersetId || null,
          supersetOrder: previousExercise?.supersetOrder,
          ...(templateBaseExercise && templateExerciseId
            ? {
                templateSwapSourceExerciseId: templateExerciseId,
                replacedOriginalName:
                  templateBaseExercise.name ||
                  previousExercise?.replacedOriginalName ||
                  previousExercise?.name,
              }
            : {}),
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
                  rpe: formatRpeValue(set.rpe),
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
                    rpe: "",
                    completed: false,
                    isWarmup: false,
                    createdAt: Date.now(),
                  },
                ],
        };
        newEx = await getAutoFilledExercise(newEx, selectedGymId);

        const updatedExercises = cleanInvalidSupersets(
          exercises.map((exercise, exerciseIndex) =>
            exerciseIndex === index ? newEx : exercise,
          ),
        );
        setExercises(updatedExercises);
        setHasUnsavedChanges(true);

        const selectedGym = gyms.find((gym: any) => gym.id === selectedGymId);
        if (
          shouldOfferGymSwapSave(
            previousExercise,
            templateExerciseId,
            selectedGym,
          )
        ) {
          const isBackToTemplateExercise =
            templateBaseExercise &&
            isSameExerciseAsTemplateSlot(newEx, templateBaseExercise);

          if (isBackToTemplateExercise) {
            await removePendingGymReplacementUpdate({
              templateExerciseId,
              gymId: selectedGymId,
              snapshotExercises: updatedExercises,
            });
          } else {
            await queuePendingGymReplacementUpdate({
              templateExerciseId,
              replacementExercise: attachmentExercise,
              gymId: selectedGymId,
              gymName: selectedGym?.name || "this gym",
              exerciseIndex: index,
              snapshotExercises: updatedExercises,
            });
          }
        }
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
    if (
      cleanExerciseNameForAttachments(loggedExercise) !==
      cleanExerciseNameForAttachments(targetExercise)
    )
      return false;

    const targetAttachment = getExerciseAttachmentForStorage(targetExercise);
    const loggedAttachment = getExerciseAttachmentForStorage(loggedExercise);
    if (targetAttachment !== loggedAttachment) return false;

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
        const parsedGyms = safeJsonParse(savedGyms, []);
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

    const parsed = safeJsonParse<any[]>(raw, [])
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
        isValidCompletedSet(found, s),
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

    const isComplete = hasValidSetInputs(currentExercise, currentSet);

    if (!isComplete) return;

    markSetWeightManual(setId);
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

  const hasIncompleteSetsForFinish = (items: any[]) =>
    items.some((ex) =>
      Array.isArray(ex?.sets)
        ? ex.sets.some((s: any) => !isValidCompletedSet(ex, s))
        : true,
    );

  const handleFinishWorkout = (navAction?: any) => {
    if (finishWorkoutInFlightRef.current) return;

    finishWorkoutInFlightRef.current = true;
    setIsFinishing(true);

    const hasIncomplete = hasIncompleteSetsForFinish(exercises);

    if (hasIncomplete) {
      setIncompleteFinishAlert({ visible: true, navAction });
    } else {
      finishWorkout(exercises, navAction);
    }
  };

  const requestFinishWorkout = (navAction?: any) => {
    if (finishWorkoutInFlightRef.current) return;

    if (!isEditing && !hasIncompleteSetsForFinish(exercises)) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setFinishConfirmAlert({ visible: true, navAction });
      return;
    }

    handleFinishWorkout(navAction);
  };

  const finishWorkout = async (
    finalExercisesToSave: any[],
    navAction?: any,
    forcedFinishedAt?: number,
    options: { skipTemplateDecision?: boolean } = {},
  ) => {
    if (!uid) {
      finishWorkoutInFlightRef.current = false;
      setIsFinishing(false);
      return;
    }

    try {
      const requestedFinishedAt = forcedFinishedAt || Date.now();
      const workoutStartedAt = isEditing
        ? Number(
            route.params?.editData?.startedAt ||
              route.params?.editData?.id ||
              requestedFinishedAt,
          )
        : startTimeMs || requestedFinishedAt;
      const pausedMsForSession = isEditing
        ? Number(route.params?.editData?.totalPausedMs || 0)
        : totalPausedMs;

      if (
        !forcedFinishedAt &&
        !isEditing &&
        workoutStartedAt &&
        requestedFinishedAt - workoutStartedAt - pausedMsForSession >
          MAX_WORKOUT_DURATION_MS
      ) {
        setDurationLimitAlert({
          visible: true,
          finalExercises: finalExercisesToSave,
          navAction,
          cappedFinishedAt:
            workoutStartedAt + pausedMsForSession + MAX_WORKOUT_DURATION_MS,
        });
        finishWorkoutInFlightRef.current = false;
        setIsFinishing(false);
        return;
      }

      if (
        finalExercisesToSave.length > 0 &&
        !options.skipTemplateDecision &&
        showTemplateDecisionBeforeSave(
          finalExercisesToSave,
          navAction,
          forcedFinishedAt,
        )
      ) {
        return;
      }

      workoutFinalizedRef.current = true;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      setTimerEndTime(null);
      setDisplayRestTime(0);
      activeRestTypeRef.current = null;
      setActiveRestType(null);
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
      const list = raw
        ? safeJsonParse<any[]>(raw, []).filter((w: any) => w && w.id)
        : [];

      finalExercisesToSave.forEach((ex) => {
        if (ex && ex.sets) {
          ex.sets.forEach((s: any) => {
            if (isValidCompletedSet(ex, s, { includeWarmup: false })) {
              if (ex.is_unilateral) {
                vol +=
                  parseFloat(s.weight) * parseInt(s.repsL) +
                  parseFloat(s.weight) * parseInt(s.repsR);
                totalSets += 1;
              } else {
                vol += parseFloat(s.weight) * parseInt(s.reps);
                totalSets += 1;
              }
            }
          });
        }
      });

      const finishedAt = requestedFinishedAt;

      let finalDuration = "0m 0s";
      let finalDurationSeconds = 0;
      if (!isEditing && workoutStartedAt) {
        finalDurationSeconds = Math.max(
          0,
          Math.floor((finishedAt - workoutStartedAt - pausedMsForSession) / 1000),
        );
        finalDuration = formatDurationFromMs(finalDurationSeconds * 1000);
      } else if (isEditing && route.params?.editData?.duration) {
        finalDuration = route.params.editData.duration;
        finalDurationSeconds = Number(
          route.params?.editData?.durationSeconds || 0,
        );
      }

      if (!isEditing) {
        setStartTimeMs(null);
        setTotalPausedMs(0);
        setPauseStartedAt(null);
        setWorkoutDurationStr(finalDuration);
      }

      const detectedPRs = !isEditing
        ? detectWorkoutPRs(finalExercisesToSave, list, { isKg })
        : [];

      const detectedPRDisplayCount = getWorkoutPRDisplayCount(detectedPRs);
      const calculatedPrType =
        detectedPRDisplayCount > 0
          ? `${detectedPRDisplayCount} PR${
              detectedPRDisplayCount === 1 ? "" : "s"
            }`
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
        durationSeconds: finalDurationSeconds,
        totalPausedMs: isEditing
          ? Number(route.params?.editData?.totalPausedMs || 0)
          : pausedMsForSession,
        rpeTrackingEnabled,
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

      pushWorkoutToCloud(session).catch((error) => {
        console.log("Workout cloud backup delayed: saved locally.", error);
      });

      if (!isEditing) {
        await AsyncStorage.removeItem(`@active_session_${uid}`);
        await AsyncStorage.removeItem(`@active_workout_start_${uid}`);
        await AsyncStorage.setItem(`@last_search_filter_${uid}`, "All");
        if (activeTemplate?.id) {
          try {
            await deleteTemplateNextSessionNotes(uid, activeTemplate.id);
            setNextSessionNotes({});
          } catch (error) {
            console.log("Could not clear next session notes", error);
          }
        }

        const exercisesForSummary = finalExercisesToSave
          .map((ex) => ({
            ...ex,
            sets: ex.sets.filter((s: any) =>
              isValidCompletedSet(ex, s, { includeWarmup: false }),
            ),
          }))
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
          durationSeconds: finalDurationSeconds,
          totalPausedMs: session.totalPausedMs,
          prType: calculatedPrType,
          prs: detectedPRs,
          exercises: exercisesForSummary,
        });

        finishWorkoutInFlightRef.current = false;
        setIsFinishing(false);
        if (activeTemplate) {
          setSummaryType("finish");
          setIsSummaryVisible(true);
        } else {
          setTemplateAlertVisible(true);
        }
      } else {
        if (navAction) {
          setIsEditable(false);
          finishWorkoutInFlightRef.current = false;
          setIsFinishing(false);
          navigation.dispatch(navAction);
        } else {
          setIsEditable(false);
          setHasUnsavedChanges(false);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          finishWorkoutInFlightRef.current = false;
          setIsFinishing(false);
          showInfo(
            "Workout Updated!",
            "Your changes have been saved successfully.",
          );
        }
      }
    } catch (error) {
      console.error("Failed to finish workout:", error);
      workoutFinalizedRef.current = false;
      finishWorkoutInFlightRef.current = false;
      setIsFinishing(false);
      Alert.alert(
        "Finish Failed",
        "IronVault could not finish this workout. Your session is still on this device, so please try again.",
      );
    }
  };

  const clearPendingGymReplacementUpdatesForActiveTemplate = () => {
    if (!activeTemplate?.id) return;
    setPendingGymReplacementUpdates((prev) =>
      prev.filter((update: any) => update?.templateId !== activeTemplate.id),
    );
  };

  const finishAfterTemplateDecision = async (
    decisionOverride?: typeof templateDecisionAlert,
  ) => {
    const decision = decisionOverride || templateDecisionAlert;
    finishWorkoutInFlightRef.current = true;
    setIsFinishing(true);

    try {
      await applyTemplateChangeChoicesToTemplate(decision.changes);
      if (decision.createNewTemplate) {
        await saveWorkoutAsNewTemplate(
          decision.finalExercises,
          decision.newTemplateName,
        );
      }
      clearPendingGymReplacementUpdatesForActiveTemplate();

      await finishWorkout(
        decision.finalExercises,
        decision.navAction,
        decision.forcedFinishedAt || undefined,
        { skipTemplateDecision: true },
      );
    } catch (error) {
      console.error("Failed to apply template finish choices:", error);
      setTemplateDecisionAlert({ ...decision, visible: true });
      finishWorkoutInFlightRef.current = false;
      setIsFinishing(false);
      Alert.alert(
        "Could Not Finish",
        "IronVault could not apply those template choices. Your workout is still here, so please try again.",
      );
    }
  };

  const getSummaryData = () => {
    if (summaryType === "finish" && completedWorkoutData)
      return completedWorkoutData;
    const cleaned = exercises
      .map((ex) => ({
        ...ex,
        sets: ex.sets.filter((s: any) => {
          return isValidCompletedSet(ex, s, { includeWarmup: false });
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

  const getTemplateChangeCounts = (changes: TemplateChangeItem[]) => ({
    added: changes.filter((change) => change.type === "added").length,
    deleted: changes.filter((change) => change.type === "deleted").length,
    replaced: changes.filter((change) => change.type === "replaced").length,
    variant: changes.filter((change) => change.type === "variant").length,
    name: changes.filter((change) => change.type === "name").length,
  });

  const formatTemplateChangeCount = (
    label: string,
    count: number,
  ) => `${count} ${label}${count === 1 ? "" : "s"}`;

  const getTemplateReviewSummary = (changes: TemplateChangeItem[]) => {
    const counts = getTemplateChangeCounts(changes);
    return [
      counts.replaced > 0
        ? formatTemplateChangeCount("Replaced Exercise", counts.replaced)
        : null,
      counts.added > 0
        ? formatTemplateChangeCount("Added Exercise", counts.added)
        : null,
      counts.deleted > 0
        ? formatTemplateChangeCount("Deleted Exercise", counts.deleted)
        : null,
      counts.variant > 0
        ? formatTemplateChangeCount("Selection Change", counts.variant)
        : null,
      counts.name > 0 ? "Name Change" : null,
    ]
      .filter(Boolean)
      .join("  •  ");
  };

  const getTemplateChangeTitle = (change: TemplateChangeItem) => {
    if (change.type === "name") {
      return change.toLabel || "New template name";
    }
    if (change.type === "variant") {
      return formatExerciseDisplayName(change.workoutExercise || change.originalExercise);
    }
    if (change.type === "added") {
      return change.workoutExercise
        ? formatExerciseDisplayName(change.workoutExercise)
        : "Added exercise";
    }
    if (change.type === "deleted") {
      return change.originalExercise
        ? formatExerciseDisplayName(change.originalExercise)
        : "Deleted exercise";
    }
    return change.workoutExercise
      ? formatExerciseDisplayName(change.workoutExercise)
      : "Replacement";
  };

  const getTemplateChangeSubtitle = (change: TemplateChangeItem) => {
    if (change.type === "name") {
      return `Rename from ${change.fromLabel || "Template"}`;
    }
    if (change.type === "variant") {
      return `${change.fromLabel || "Default"} → ${change.toLabel || "Default"}`;
    }
    if (change.type === "added") return "Added during this workout";
    if (change.type === "deleted") return "Removed from this workout";
    return "Replaced during this workout";
  };

  const getTemplateChangeKicker = (change: TemplateChangeItem) => {
    if (change.type === "name") return "NAME";
    if (change.type === "variant") return "SELECTION";
    if (change.type === "added") return "ADDED";
    if (change.type === "deleted") return "DELETED";
    return "REPLACED";
  };

  const getTemplateChangeOptions = (change: TemplateChangeItem) => {
    if (change.type === "name") {
      return [
        { value: "dontUpdate" as const, label: "Don't Update" },
        { value: "updateTemplate" as const, label: "Rename" },
      ];
    }

    if (change.type === "variant") {
      return [
        { value: "dontUpdate" as const, label: "Don't Update" },
        { value: "updateTemplate" as const, label: "Update Template" },
      ];
    }

    if (change.type === "added") {
      return [
        { value: "dontUpdate" as const, label: "Don't Update" },
        { value: "updateTemplate" as const, label: "Add" },
      ];
    }

    if (change.type === "deleted") {
      return [
        { value: "dontUpdate" as const, label: "Don't Update" },
        { value: "updateTemplate" as const, label: "Remove" },
      ];
    }

    return [
      { value: "dontUpdate" as const, label: "Don't Update" },
      ...(change.canGymSwap
        ? [{ value: "gymSwap" as const, label: "Gym Swap" }]
        : []),
      { value: "updateTemplate" as const, label: "Update Template" },
    ];
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

  const setHintExerciseIdentityKey = getWeightPrefillIdentityKey(exercises);

  const previousSetHints = useMemo(() => {
    return exercises.map((exercise) =>
      buildBestHistoricalSetPositionHints(exercise, workoutHistory, isKg),
    );
  }, [setHintExerciseIdentityKey, workoutHistory, isKg]);

  const getPreviousSetPlaceholder = (
    exerciseIndex: number,
    set: any,
    setTypeIndex: number,
    field: "reps" | "repsL" | "repsR",
  ) => {
    const hint = previousSetHints[exerciseIndex];
    const bucket = set?.isWarmup ? hint?.warmup : hint?.working;
    const pastSet = bucket?.[setTypeIndex];
    const value = pastSet?.[field];
    if (value === undefined || value === null || String(value).trim() === "")
      return "0";
    return String(value);
  };

  const setPrefillStructureKey = getWeightPrefillStructureKey(exercises);

  useEffect(() => {
    if (
      !isLoaded ||
      !isHistoricalWeightPrefillActive ||
      isEditing ||
      isPreFlightVisible
    ) {
      return;
    }

    if (skipNextWeightPrefillReconcileRef.current) {
      skipNextWeightPrefillReconcileRef.current = false;
      return;
    }

    setExercises((currentExercises) => {
      if (
        getWeightPrefillIdentityKey(currentExercises) !==
          setHintExerciseIdentityKey ||
        getWeightPrefillStructureKey(currentExercises) !==
          setPrefillStructureKey
      ) {
        return currentExercises;
      }
      const reconciled = reconcileHistoricalWeightPrefills(
        currentExercises,
        previousSetHints,
        historicalWeightPrefillStateRef.current,
      );
      historicalWeightPrefillStateRef.current = reconciled.state;
      return reconciled.changed ? reconciled.exercises : currentExercises;
    });
  }, [
    isLoaded,
    isHistoricalWeightPrefillActive,
    isEditing,
    isPreFlightVisible,
    setHintExerciseIdentityKey,
    setPrefillStructureKey,
    previousSetHints,
  ]);

  const workoutStats = useMemo(() => {
    const totalExercises = exercises.length;
    const totalWarmupSets = exercises.reduce(
      (sum, ex) => sum + (ex.sets || []).filter((s: any) => s.isWarmup).length,
      0,
    );
    const totalSets = exercises.reduce(
      (sum, ex) => sum + (ex.sets || []).filter((s: any) => !s.isWarmup).length,
      0,
    );
    const completedSets = exercises.reduce(
      (sum, ex) =>
        sum +
        (ex.sets || []).filter((s: any) =>
          isValidCompletedSet(ex, s, { includeWarmup: false }),
        ).length,
      0,
    );

    return {
      totalExercises,
      totalSets,
      completedSets,
      totalWarmupSets,
      hasAnySet: totalExercises > 0 && totalSets + totalWarmupSets > 0,
    };
  }, [exercises]);

  const renderRestDurationControls = (
    label: string,
    duration: string,
    updateDuration: (seconds: number) => Promise<void>,
    presets = REST_TIMER_PRESETS,
  ) => (
    <>
      <View style={styles.restDurationRow}>
        <Text style={styles.restDurationLabel}>{label}</Text>
        <View style={styles.restDurationStepper}>
          <TouchableOpacity
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              await updateDuration(parseInt(duration || "0", 10) - 10);
            }}
            style={styles.restDurationStepButton}
          >
            <Text style={styles.restDurationStepText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.restDurationValue}>{duration}s</Text>
          <TouchableOpacity
            onPress={async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              await updateDuration(parseInt(duration || "0", 10) + 10);
            }}
            style={styles.restDurationStepButton}
          >
            <Text style={styles.restDurationStepText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.restPresetRow}>
        {presets.map((preset) => {
          const active =
            String(parseInt(duration || "0", 10)) === String(preset.value);
          return (
            <TouchableOpacity
              key={`${label}-${preset.value}`}
              activeOpacity={0.8}
              style={[
                styles.restPresetChip,
                active && styles.restPresetChipActive,
              ]}
              onPress={async () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                await updateDuration(preset.value);
              }}
            >
              <Text
                style={[
                  styles.restPresetChipText,
                  active && styles.restPresetChipTextActive,
                ]}
              >
                {preset.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </>
  );

  const fallbackFooterHeight = displayRestTime > 0 ? 188 : 112;
  const workoutListBottomPadding =
    isEditable && !isKeyboardVisible
      ? Math.max(footerHeight, fallbackFooterHeight, 96) + 12
      : 40;

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
                      const pausedAt = Date.now();
                      setPauseStartedAt(pausedAt);
                      setTimerEndTime(null);
                      setDisplayRestTime(0);
                      activeRestTypeRef.current = null;
                      setActiveRestType(null);
                      await clearRestTimerNotification(true);
                      await saveActiveSessionSnapshot({
                        pauseStartedAt: pausedAt,
                        isWorkoutPaused: true,
                        timerEndTime: null,
                        activeRestType: null,
                      });
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
        visible={finishConfirmAlert.visible}
        title="Finish Workout?"
        message="This will save the session to History. You can still edit it later if something looks off."
        buttons={[
          { text: "Cancel", style: "cancel" },
          {
            text: "Finish Workout",
            onPress: () => handleFinishWorkout(finishConfirmAlert.navAction),
          },
        ]}
        onClose={() =>
          setFinishConfirmAlert({ visible: false, navAction: null })
        }
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
                    isValidCompletedSet(ex, s),
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
        visible={durationLimitAlert.visible}
        title="Workout Over 24h"
        message="This workout has been running for more than 24 hours. Save it as a 24-hour session or keep editing for now."
        buttons={[
          { text: "Keep Editing", style: "cancel" },
          {
            text: "End at 24h",
            onPress: () => {
              if (!durationLimitAlert.cappedFinishedAt) return;
              const finalExercises = durationLimitAlert.finalExercises;
              const navAction = durationLimitAlert.navAction;
              const cappedFinishedAt = durationLimitAlert.cappedFinishedAt;
              finishWorkoutInFlightRef.current = true;
              setIsFinishing(true);
              setTimeout(
                () =>
                  finishWorkout(finalExercises, navAction, cappedFinishedAt),
                250,
              );
            },
          },
        ]}
        onClose={() =>
          setDurationLimitAlert((prev) => ({ ...prev, visible: false }))
        }
      />
      <CustomAlert
        visible={templateAlertVisible}
        title="Want to repeat this workout?"
        message="Save this session as a reusable template so you can start it faster next time. Weights and reps will not be saved into the template."
        buttons={[
          {
            text: "Not Now",
            style: "cancel",
            onPress: () => {
              templateActionTaken.current = true;
              setTimeout(openFinishSummary, 400);
            },
          },
          {
            text: "Save as Template",
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
      <Modal
        visible={templateDecisionAlert.visible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setTemplateDecisionAlert((prev) => ({ ...prev, visible: false }));
          finishWorkoutInFlightRef.current = false;
          setIsFinishing(false);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.86)",
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: "#1C1C1E",
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              borderWidth: 1,
              borderColor: "#2C2C2E",
              paddingTop: 18,
              paddingHorizontal: 18,
              paddingBottom: Math.max(insets.bottom + 14, 24),
              maxHeight: Math.min(
                windowHeight * 0.86,
                windowHeight - insets.top - 18,
              ),
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 14,
                marginBottom: 14,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: "#32D74B",
                    fontSize: 13,
                    fontWeight: "900",
                    letterSpacing: 0,
                    marginBottom: 6,
                    textTransform: "uppercase",
                  }}
                >
                  Changes Detected
                </Text>
                <Text
                  style={{
                    color: "#FFF",
                    fontSize: 24,
                    fontWeight: "900",
                    marginBottom: 6,
                  }}
                >
                  Review Template Changes
                </Text>
                <Text
                  style={{
                    color: "#A1A1A6",
                    fontSize: 14,
                    fontWeight: "800",
                    lineHeight: 20,
                  }}
                >
                  {getTemplateReviewSummary(templateDecisionAlert.changes)}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setTemplateDecisionAlert((prev) => ({
                    ...prev,
                    visible: false,
                  }));
                  finishWorkoutInFlightRef.current = false;
                  setIsFinishing(false);
                }}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: "#2C2C2E",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="close" size={20} color="#A1A1A6" />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={{ maxHeight: Math.min(windowHeight * 0.58, 560) }}
              contentContainerStyle={{ paddingBottom: 12, gap: 12 }}
            >
              <View
                style={{
                  backgroundColor: "#111113",
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: templateDecisionAlert.createNewTemplate
                    ? "#32D74B"
                    : "#2C2C2E",
                  padding: 14,
                }}
              >
                <TouchableOpacity
                  activeOpacity={0.86}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setTemplateDecisionAlert((prev) => {
                      const nextCreateNew = !prev.createNewTemplate;
                      return {
                        ...prev,
                        createNewTemplate: nextCreateNew,
                        newTemplateName:
                          nextCreateNew && !prev.newTemplateName
                            ? limitText(
                                getSuggestedNewTemplateName(),
                                LIMITS.nameChars,
                              )
                            : prev.newTemplateName,
                        newTemplateNameError: "",
                      };
                    });
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      width: 38,
                      height: 38,
                      borderRadius: 19,
                      backgroundColor: templateDecisionAlert.createNewTemplate
                        ? "#32D74B"
                        : "#2C2C2E",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons
                      name={
                        templateDecisionAlert.createNewTemplate
                          ? "checkmark"
                          : "copy-outline"
                      }
                      size={20}
                      color={
                        templateDecisionAlert.createNewTemplate
                          ? "#000"
                          : "#32D74B"
                      }
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: "#FFF",
                        fontSize: 17,
                        fontWeight: "900",
                      }}
                    >
                      Create New Template
                    </Text>
                    <Text
                      style={{
                        color: "#8E8E93",
                        fontSize: 12,
                        fontWeight: "800",
                        lineHeight: 17,
                        marginTop: 3,
                      }}
                    >
                      Save this finished workout as a separate template.
                    </Text>
                  </View>
                </TouchableOpacity>

                {templateDecisionAlert.createNewTemplate && (
                  <View style={{ marginTop: 14 }}>
                    <TextInput
                      value={templateDecisionAlert.newTemplateName}
                      onChangeText={(text) =>
                        setTemplateDecisionAlert((prev) => ({
                          ...prev,
                          newTemplateName: limitText(text, LIMITS.nameChars),
                          newTemplateNameError: "",
                        }))
                      }
                      maxLength={LIMITS.nameChars}
                      placeholder="Template name"
                      placeholderTextColor="#6B7280"
                      selectTextOnFocus
                      style={{
                        minHeight: 50,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: templateDecisionAlert.newTemplateNameError
                          ? "#FF453A"
                          : "#3A3A3C",
                        backgroundColor: "#1C1C1E",
                        color: "#FFFFFF",
                        paddingHorizontal: 14,
                        fontSize: 15,
                        fontWeight: "800",
                      }}
                      returnKeyType="done"
                    />
                    {!!templateDecisionAlert.newTemplateNameError && (
                      <Text
                        style={{
                          color: "#FF453A",
                          fontSize: 12,
                          fontWeight: "800",
                          marginTop: 8,
                        }}
                      >
                        {templateDecisionAlert.newTemplateNameError}
                      </Text>
                    )}
                  </View>
                )}
              </View>

              {templateDecisionAlert.changes.map((change) => {
                const options = getTemplateChangeOptions(change);
                const selectedGymName =
                  gyms.find((gym) => gym.id === selectedGymId)?.name ||
                  "this gym";
                const showOtherGymSwapNotice =
                  change.hasOtherGymSwaps &&
                  change.choice === "updateTemplate" &&
                  change.type === "replaced";
                const showRemoveSwapNotice =
                  change.hasOtherGymSwaps &&
                  change.choice === "updateTemplate" &&
                  change.type === "deleted";

                return (
                  <View
                    key={change.id}
                    style={{
                      backgroundColor: "#111113",
                      borderRadius: 18,
                      borderWidth: 1,
                      borderColor: "#2C2C2E",
                      padding: 14,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "flex-start",
                        gap: 12,
                        marginBottom: 12,
                      }}
                    >
                      <View
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 19,
                          backgroundColor:
                            change.type === "deleted"
                              ? "rgba(255,69,58,0.16)"
                              : "rgba(50,215,75,0.14)",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons
                          name={
                            change.type === "added"
                              ? "add"
                              : change.type === "deleted"
                                ? "remove"
                                : change.type === "name"
                                  ? "create-outline"
                                  : change.type === "variant"
                                    ? "options-outline"
                                    : "swap-horizontal"
                          }
                          size={20}
                          color={change.type === "deleted" ? "#FF453A" : "#32D74B"}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            color:
                              change.type === "deleted" ? "#FF453A" : "#32D74B",
                            fontSize: 12,
                            fontWeight: "900",
                            letterSpacing: 0,
                            marginBottom: 4,
                          }}
                        >
                          {getTemplateChangeKicker(change)}
                        </Text>
                        {change.type === "replaced" && (
                          <Text
                            style={{
                              color: "#8E8E93",
                              fontSize: 14,
                              fontWeight: "800",
                              lineHeight: 19,
                              marginBottom: 4,
                            }}
                            numberOfLines={2}
                          >
                            {change.originalExercise
                              ? formatExerciseDisplayName(change.originalExercise)
                              : "Template exercise"}
                          </Text>
                        )}
                        {change.type === "replaced" && (
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 5,
                              marginBottom: 4,
                            }}
                          >
                            <Ionicons
                              name="arrow-down"
                              size={13}
                              color="#32D74B"
                            />
                            <Text
                              style={{
                                color: "#32D74B",
                                fontSize: 11,
                                fontWeight: "900",
                                textTransform: "uppercase",
                              }}
                            >
                              Changed to
                            </Text>
                          </View>
                        )}
                        <Text
                          style={{
                            color: "#FFF",
                            fontSize: 18,
                            fontWeight: "900",
                            lineHeight: 23,
                          }}
                          numberOfLines={3}
                          adjustsFontSizeToFit
                          minimumFontScale={0.82}
                        >
                          {getTemplateChangeTitle(change)}
                        </Text>
                        <Text
                          style={{
                            color: "#8E8E93",
                            fontSize: 13,
                            fontWeight: "800",
                            marginTop: 4,
                          }}
                        >
                          {getTemplateChangeSubtitle(change)}
                        </Text>
                      </View>
                    </View>

                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      {options.map((option) => {
                        const isSelected = change.choice === option.value;
                        return (
                          <TouchableOpacity
                            key={option.value}
                            onPress={() => {
                              Haptics.selectionAsync();
                              updateTemplateChangeChoice(change.id, option.value);
                            }}
                            style={{
                              minHeight: 38,
                              borderRadius: 19,
                              paddingHorizontal: 13,
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: isSelected
                                ? "#32D74B"
                                : "#1C1C1E",
                              borderWidth: 1,
                              borderColor: isSelected ? "#32D74B" : "#3A3A3C",
                            }}
                          >
                            <Text
                              style={{
                                color: isSelected ? "#000" : "#A1A1A6",
                                fontSize: 13,
                                fontWeight: "900",
                              }}
                              numberOfLines={1}
                            >
                              {option.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {change.choice === "gymSwap" && (
                      <Text
                        style={{
                          color: "#32D74B",
                          fontSize: 12,
                          fontWeight: "800",
                          lineHeight: 18,
                          marginTop: 10,
                        }}
                      >
                        Saves this replacement only for {selectedGymName}.
                      </Text>
                    )}
                    {showOtherGymSwapNotice && (
                      <Text
                        style={{
                          color: "#FFD60A",
                          fontSize: 12,
                          fontWeight: "800",
                          lineHeight: 18,
                          marginTop: 10,
                        }}
                      >
                        Other gym swaps for this exercise stay saved.
                      </Text>
                    )}
                    {showRemoveSwapNotice && (
                      <Text
                        style={{
                          color: "#FFD60A",
                          fontSize: 12,
                          fontWeight: "800",
                          lineHeight: 18,
                          marginTop: 10,
                        }}
                      >
                        Removing this exercise also removes its gym swaps.
                      </Text>
                    )}
                  </View>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <TouchableOpacity
                onPress={() => {
                  setTemplateDecisionAlert((prev) => ({
                    ...prev,
                    visible: false,
                  }));
                  finishWorkoutInFlightRef.current = false;
                  setIsFinishing(false);
                }}
                style={{
                  flex: 1,
                  minHeight: 52,
                  borderRadius: 18,
                  backgroundColor: "#2C2C2E",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#A1A1A6", fontSize: 16, fontWeight: "900" }}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={isFinishing}
                onPress={() => {
                  confirmTemplateDecisionChoices();
                }}
                style={{
                  flex: 1.45,
                  minHeight: 52,
                  borderRadius: 18,
                  backgroundColor: isFinishing ? "#1F8F35" : "#32D74B",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ color: "#000", fontSize: 16, fontWeight: "900" }}>
                  Confirm Choices
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
                    disabled={isPreFlightConfirming}
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
                opacity: isPreFlightConfirming ? 0.8 : 1,
              }}
              disabled={isPreFlightConfirming}
              onPress={handleConfirmPreFlight}
            >
              {isPreFlightConfirming ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text
                  style={{ color: "#000", fontSize: 18, fontWeight: "900" }}
                >
                  Confirm
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={{
                alignItems: "center",
                paddingVertical: 10,
                opacity: isPreFlightConfirming ? 0.45 : 1,
              }}
              disabled={isPreFlightConfirming}
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
            <View
              style={{
                width: "100%",
                minHeight: isEditable && !isReorderMode ? 34 : undefined,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor:
                  isEditable && !isReorderMode ? "#1C1C1E" : "transparent",
                borderWidth: isEditable && !isReorderMode ? 1 : 0,
                borderColor: "#2C2C2E",
                borderRadius: 17,
                paddingHorizontal: isEditable && !isReorderMode ? 10 : 0,
                marginBottom: 6,
              }}
            >
              {isEditable && !isReorderMode && (
                <TouchableOpacity
                  style={{
                    position: "absolute",
                    left: 10,
                    width: 22,
                    height: 26,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  activeOpacity={0.75}
                  onPress={() => workoutNameInputRef.current?.focus()}
                  hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                >
                  <Ionicons name="create-outline" size={15} color="#8E8E93" />
                </TouchableOpacity>
              )}
              <TextInput
                ref={workoutNameInputRef}
                style={[
                  styles.headerTitleInput,
                  {
                    flex: 0,
                    width: "100%",
                    height: "auto",
                    fontSize: 17,
                    padding: 0,
                    paddingHorizontal: isEditable && !isReorderMode ? 36 : 0,
                    textAlign: "center",
                  },
                ]}
                value={workoutName}
                editable={isEditable && !isReorderMode}
                onChangeText={(t) => {
                  setWorkoutName(limitText(t, LIMITS.nameChars));
                  setHasUnsavedChanges(true);
                }}
                maxLength={LIMITS.nameChars}
                placeholder="Workout Name"
                placeholderTextColor="#48484A"
                selectTextOnFocus
                textAlign="center"
                selectionColor="#FFF"
              />
            </View>
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
          <TouchableOpacity
            activeOpacity={1}
            style={[
              styles.actionMenuContent,
              {
                maxHeight: Math.max(
                  360,
                  windowHeight - insets.top - insets.bottom - 32,
                ),
              },
            ]}
          >
            <ScrollView
              style={{ width: "100%" }}
              contentContainerStyle={{ alignItems: "center" }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
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

            {!isEditing &&
              sessionRestEnabled &&
              renderRestDurationControls(
                "Working Rest",
                sessionRestDuration,
                updateSessionRestDuration,
              )}

            {!isEditing && sessionRestEnabled && (
              <View style={styles.actionSheetRow}>
                <View style={styles.actionSheetIconCircle}>
                  <Ionicons
                    name="flame-outline"
                    size={20}
                    color="#32D74B"
                  />
                </View>
                <View style={styles.actionSheetTextBlock}>
                  <Text style={styles.actionSheetRowTitle}>Warm-up Rest</Text>
                  <Text style={styles.actionSheetRowSubtitle}>
                    Use a separate timer after warm-up sets
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.compactTogglePill,
                    {
                      backgroundColor: sessionWarmupRestEnabled
                        ? "#32D74B"
                        : "#3A3A3C",
                    },
                  ]}
                  onPress={toggleSessionWarmupRestTimer}
                >
                  <Text
                    style={[
                      styles.compactToggleText,
                      { color: sessionWarmupRestEnabled ? "#000" : "#FFF" },
                    ]}
                  >
                    {sessionWarmupRestEnabled ? "ON" : "OFF"}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {!isEditing &&
              sessionRestEnabled &&
              sessionWarmupRestEnabled &&
              renderRestDurationControls(
                "Warm-up Rest",
                sessionWarmupRestDuration,
                updateSessionWarmupRestDuration,
                WARMUP_REST_TIMER_PRESETS,
              )}

            <TouchableOpacity
              style={styles.actionMenuBtnCancel}
              onPress={() => setIsSessionMenuVisible(false)}
            >
              <Text style={styles.actionMenuBtnTextCancel}>Close</Text>
            </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <CustomAttachmentModal
        visible={customAttachmentModal.visible}
        value={customAttachmentModal.value}
        error={customAttachmentModal.error}
        customAttachments={customAttachments}
        editingAttachment={customAttachmentModal.editingAttachment}
        onChangeText={(value) =>
          setCustomAttachmentModal((prev) => ({
            ...prev,
            value,
            error: "",
          }))
        }
        onCancel={closeCustomAttachmentModal}
        onSave={saveCustomAttachmentForExercise}
        onEditAttachment={editCustomAttachment}
        onDeleteAttachment={deleteCustomAttachment}
      />

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
              onChangeText={(t) =>
                setTemplateNameInput(limitText(t, LIMITS.nameChars))
              }
              maxLength={LIMITS.nameChars}
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

            const formatSummaryWeight = (value: number) => {
              if (!Number.isFinite(value)) return "0";
              return Number.isInteger(value)
                ? value.toFixed(0)
                : value.toFixed(2);
            };

            const formatBestSet = (ex: any, set: any) => {
              const weight = parseFloat(set.weight || "0") || 0;
              const weightLabel = formatSummaryWeight(weight);
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
            const exerciseBreakdown = data.exercises.map((ex: any) => {
              const completedSets = ex.sets || [];
              const bestSet = completedSets.slice().sort((a: any, b: any) => {
                const strengthDiff =
                  getSetStrengthScore(ex, b) - getSetStrengthScore(ex, a);
                if (strengthDiff !== 0) return strengthDiff;

                const weightDiff =
                  (parseFloat(b?.weight || "0") || 0) -
                  (parseFloat(a?.weight || "0") || 0);
                if (weightDiff !== 0) return weightDiff;

                return (
                  getSetRepsForStrengthScore(ex, b) -
                  getSetRepsForStrengthScore(ex, a)
                );
              })[0];
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
              const visibleExerciseLimit = 6;

              const getSetWeight = (set: any) =>
                parseFloat(set?.weight || "0") || 0;

              const getDisplayRepCount = (ex: any, set: any) => {
                if (ex.is_unilateral) {
                  return (
                    (parseInt(set?.repsL || "0") || 0) +
                    (parseInt(set?.repsR || "0") || 0)
                  );
                }
                return parseInt(set?.reps || "0") || 0;
              };

              const getBestStrengthSetForExercise = (ex: any) => {
                const completedSets = Array.isArray(ex.sets) ? ex.sets : [];
                return completedSets.slice().sort((a: any, b: any) => {
                  const strengthDiff =
                    getSetStrengthScore(ex, b) - getSetStrengthScore(ex, a);
                  if (strengthDiff !== 0) return strengthDiff;

                  const weightDiff = getSetWeight(b) - getSetWeight(a);
                  if (weightDiff !== 0) return weightDiff;

                  return (
                    getSetRepsForStrengthScore(ex, b) -
                    getSetRepsForStrengthScore(ex, a)
                  );
                })[0];
              };

              const exerciseBreakdownRows = data.exercises
                .map((ex: any) => {
                  const completedSets = Array.isArray(ex.sets) ? ex.sets : [];
                  const bestSet = getBestStrengthSetForExercise(ex);
                  const totalExerciseVolume = completedSets.reduce(
                    (sum: number, set: any) => sum + getSetVolume(ex, set),
                    0,
                  );
                  const totalExerciseReps = completedSets.reduce(
                    (sum: number, set: any) =>
                      sum + getDisplayRepCount(ex, set),
                    0,
                  );

                  return {
                    name: formatExerciseDisplayName(ex),
                    setCount: completedSets.length,
                    repCount: totalExerciseReps,
                    bestSetLabel: bestSet ? formatBestSet(ex, bestSet) : "—",
                    volume: totalExerciseVolume,
                  };
                })
                .filter((item: any) => item.setCount > 0);

              const totalReps = exerciseBreakdownRows.reduce(
                (sum: number, item: any) => sum + item.repCount,
                0,
              );
              const visibleExerciseRows = exerciseBreakdownRows.slice(
                0,
                visibleExerciseLimit,
              );
              const hiddenExerciseCount = Math.max(
                exerciseBreakdownRows.length - visibleExerciseRows.length,
                0,
              );

              return (
                <View
                  style={{
                    width: capture ? 380 : "100%",
                    maxWidth: 380,
                    minHeight: capture ? 0 : 520,
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
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: 30,
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
                      {data.date} | {data.duration}
                    </Text>

                    <View
                      style={{
                        marginTop: 24,
                        marginHorizontal: -5,
                      }}
                    >
                      {[
                        [
                          {
                            label: "Total Volume",
                            value: `${formatFullVolume(data.volume)} ${unitLabel}`,
                          },
                          { label: "Sets", value: `${data.totalSets}` },
                        ],
                        [
                          { label: "Reps", value: `${totalReps}` },
                          {
                            label: "Exercises",
                            value: `${exerciseBreakdownRows.length}`,
                          },
                        ],
                      ].map((row, rowIndex) => (
                        <View
                          key={`share-stat-row-${rowIndex}`}
                          style={{
                            flexDirection: "row",
                            marginTop: rowIndex === 0 ? 0 : 10,
                          }}
                        >
                          {row.map((item) => (
                            <View
                              key={item.label}
                              style={{ flex: 1, paddingHorizontal: 5 }}
                            >
                              <View
                                style={{
                                  minHeight: 78,
                                  justifyContent: "center",
                                  backgroundColor: "rgba(28, 28, 30, 0.54)",
                                  borderRadius: 20,
                                  paddingVertical: 14,
                                  paddingHorizontal: 12,
                                  borderWidth: 1,
                                  borderColor: "rgba(255, 255, 255, 0.07)",
                                }}
                              >
                                <Text
                                  style={{
                                    color: "#FFFFFF",
                                    fontSize: 20,
                                    lineHeight: 24,
                                    fontWeight: "900",
                                    textAlign: "center",
                                    letterSpacing: -0.35,
                                  }}
                                  numberOfLines={1}
                                  adjustsFontSizeToFit
                                  minimumFontScale={0.68}
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
                                  adjustsFontSizeToFit
                                  minimumFontScale={0.78}
                                >
                                  {item.label}
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      ))}
                    </View>

                    <View
                      style={{
                        marginTop: 22,
                        backgroundColor: "rgba(28, 28, 30, 0.58)",
                        borderRadius: 22,
                        padding: 16,
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
                          marginBottom: 10,
                        }}
                      >
                        Exercise Breakdown
                      </Text>

                      {visibleExerciseRows.map((item: any, index: number) => (
                        <View
                          key={`${item.name}-${index}`}
                          style={{
                            paddingVertical: 9,
                            borderTopWidth: index === 0 ? 0 : 1,
                            borderTopColor: "rgba(255, 255, 255, 0.065)",
                          }}
                        >
                          <Text
                            style={{
                              color: "#FFFFFF",
                              fontSize: 13,
                              fontWeight: "900",
                              lineHeight: 17,
                            }}
                            numberOfLines={1}
                          >
                            {item.name}
                          </Text>
                          <Text
                            style={{
                              color: "#32D74B",
                              fontSize: 12,
                              fontWeight: "900",
                              lineHeight: 18,
                              marginTop: 3,
                            }}
                            numberOfLines={1}
                          >
                            Top {item.bestSetLabel}
                          </Text>
                          <Text
                            style={{
                              color: "#8E8E93",
                              fontSize: 11,
                              fontWeight: "800",
                              lineHeight: 16,
                            }}
                            numberOfLines={1}
                          >
                            {item.setCount} set{item.setCount === 1 ? "" : "s"}{" "}
                            · {formatFullVolume(item.volume)} {unitLabel} volume
                          </Text>
                        </View>
                      ))}

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
                                  {formatSummaryWeight(set.weight)}{" "}
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

                const deleteExercise = async () => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                  const templateExerciseId =
                    exerciseToDelete?.templateSwapSourceExerciseId ||
                    exerciseToDelete?.templateBaseExercise?.id ||
                    exerciseToDelete?.templateBaseExercise?.originalExerciseId ||
                    null;
                  const updatedExercises = cleanInvalidSupersets(
                    exercises.filter(
                      (_: any, i: number) => i !== selectedExerciseIndex,
                    ),
                  );
                  setExercises(updatedExercises);
                  await removePendingGymReplacementUpdate({
                    templateExerciseId,
                    gymId: selectedGymId,
                    snapshotExercises: updatedExercises,
                  });
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
                      onPress={() =>
                        runWorkoutBlockingAction(
                          "Saving brand...",
                          async () => {
                            Haptics.notificationAsync(
                              Haptics.NotificationFeedbackType.Success,
                            );
                            const newVariant = cleanLimitedText(
                              tagSearchQuery,
                              LIMITS.nameChars,
                            );
                            if (!newVariant) return;
                            const updatedGyms = sanitizeGymsForStorage(
                              gyms.map((g) =>
                                g.id === selectedGymId
                                  ? {
                                      ...g,
                                      variants: [
                                        ...(Array.isArray(g.variants)
                                          ? g.variants
                                          : []),
                                        newVariant,
                                      ],
                                    }
                                  : g,
                              ),
                            );
                            await clearGymVariantsDeletedLocally(
                              String(selectedGymId || ""),
                              [newVariant],
                              uid,
                            );
                            setGyms(updatedGyms);
                            await AsyncStorage.setItem(
                              `@user_gyms_${uid}`,
                              JSON.stringify(updatedGyms),
                            );
                            syncGymsToCloud(updatedGyms).catch((error) =>
                              console.log("Gym brand cloud sync delayed:", error),
                            );
                            setExercises((prev) => {
                              const up = [...prev];
                              up[tagExIdx!].equipmentTag = newVariant;
                              return up;
                            });
                            setHasUnsavedChanges(true);
                            setIsTagModalVisible(false);
                            setTagSearchQuery("");
                          },
                        )
                      }
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
                                      onPress: () => {
                                        const updatedGyms =
                                          sanitizeGymsForStorage(
                                            gyms.map((g) =>
                                              g.id === selectedGymId
                                                ? {
                                                    ...g,
                                                    variants: Array.isArray(
                                                      g.variants,
                                                    )
                                                      ? g.variants.filter(
                                                          (v: string) =>
                                                            v !== variant,
                                                        )
                                                      : [],
                                                  }
                                                : g,
                                            ),
                                          );

                                        Haptics.impactAsync(
                                          Haptics.ImpactFeedbackStyle.Heavy,
                                        );
                                        setGyms(updatedGyms);

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

                                        Promise.resolve()
                                          .then(async () => {
                                            if (!uid) return;
                                            await markGymVariantsDeletedLocally(
                                              String(selectedGymId || ""),
                                              [variant],
                                              uid,
                                            );
                                            await AsyncStorage.setItem(
                                              `@user_gyms_${uid}`,
                                              JSON.stringify(updatedGyms),
                                            );
                                            syncGymsToCloud(updatedGyms).catch(
                                              (error) =>
                                                console.log(
                                                  "Gym brand cloud sync delayed:",
                                                  error,
                                                ),
                                            );
                                          })
                                          .catch((error) => {
                                            console.log(
                                              "Gym brand delete persistence delayed:",
                                              error,
                                            );
                                          });
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
              onChangeText={(t) => setCurrentRemark(limitText(t, LIMITS.noteChars))}
              maxLength={LIMITS.noteChars}
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
                        remark: cleanLimitedText(currentRemark, LIMITS.noteChars),
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
                            {parseRpeValue(s.rpe) !== null
                              ? ` · RPE ${formatRpeValue(s.rpe)}`
                              : ""}
                          </Text>
                        ) : (
                          <Text style={{ color: "#32D74B", fontWeight: "800" }}>
                            {s.weight} {isKg ? "kg" : "lbs"} × {s.reps}
                            {parseRpeValue(s.rpe) !== null
                              ? ` · RPE ${formatRpeValue(s.rpe)}`
                              : ""}
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
            { paddingBottom: workoutListBottomPadding },
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

                    {isEditable && workoutStats.hasAnySet && (
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
          renderItem={({ item: ex, getIndex, isActive }) => {
            const exIdx = getIndex() ?? 0;
            const exerciseVariationOptions = getExerciseVariationOptions(ex);
            const exerciseAttachmentOptions =
              getExerciseAttachmentOptionsWithCustom(ex, customAttachments);
            const exerciseAttachmentSelectionOptions =
              getExerciseAttachmentSelectionOptions(ex, customAttachments);
            const nextSessionNote = nextSessionNotesEnabled
              ? nextSessionNotes[getTemplateExerciseNoteKey(ex)] || ""
              : "";

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

                        {isEditable &&
                          exerciseAttachmentSelectionOptions.length > 0 && (
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={{
                              paddingTop: 8,
                              paddingRight: 12,
                            }}
                          >
                            {exerciseAttachmentSelectionOptions.map((attachment) => {
                              const isNoAttachment =
                                attachment === NO_ATTACHMENT_OPTION_LABEL;
                              const currentAttachment =
                                getExerciseAttachmentForStorage(ex);
                              const isActive = isNoAttachment
                                ? !currentAttachment
                                : currentAttachment === attachment;
                              return (
                                <TouchableOpacity
                                  key={attachment}
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
                                        attachment: isNoAttachment
                                          ? ""
                                          : attachment,
                                        attachmentOptions:
                                          exerciseAttachmentOptions,
                                        supportsAttachments: true,
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
                                    {attachment}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                            <TouchableOpacity
                              key="custom-attachment"
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                borderRadius: 999,
                                marginRight: 8,
                                backgroundColor: "#111113",
                                borderWidth: 1,
                                borderColor: "#32D74B",
                              }}
                              onPress={() => openCustomAttachmentModal(exIdx)}
                            >
                              <Text
                                style={{
                                  color: "#32D74B",
                                  fontSize: 11,
                                  fontWeight: "900",
                                }}
                              >
                                + Custom
                              </Text>
                            </TouchableOpacity>
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

                  {nextSessionNote ? (
                    <View
                      style={{
                        marginBottom: 14,
                        paddingHorizontal: 13,
                        paddingVertical: 11,
                        borderRadius: 14,
                        backgroundColor: "rgba(50, 215, 75, 0.1)",
                        borderWidth: 1,
                        borderColor: "rgba(50, 215, 75, 0.24)",
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          marginBottom: 5,
                        }}
                      >
                        <Ionicons
                          name="document-text-outline"
                          size={14}
                          color="#32D74B"
                          style={{ marginRight: 6 }}
                        />
                        <Text
                          style={{
                            color: "#32D74B",
                            fontSize: 10,
                            fontWeight: "900",
                            letterSpacing: 1.2,
                          }}
                        >
                          NEXT SESSION NOTE
                        </Text>
                      </View>
                      <Text
                        style={{
                          color: "#D1D1D6",
                          fontSize: 13,
                          fontWeight: "700",
                          lineHeight: 18,
                        }}
                      >
                        {nextSessionNote}
                      </Text>
                    </View>
                  ) : null}

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

                      {rpeTrackingEnabled && (
                        <View style={{ flex: 0.65, alignItems: "center" }}>
                          <Text
                            style={{
                              color: "#8E8E93",
                              fontSize: 11,
                              fontWeight: "700",
                              textAlign: "center",
                            }}
                          >
                            RPE
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
                      const workingSetNum = ex.sets
                        .slice(0, sIdx + 1)
                        .filter((set: any) => !set.isWarmup).length;
                      const setTypeIndex =
                        ex.sets
                          .slice(0, sIdx + 1)
                          .filter((set: any) => !!set.isWarmup === !!s.isWarmup)
                          .length - 1;
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
                              const targetIsWarmup = !s.isWarmup;
                              const warmupSetCount = (ex.sets || []).filter(
                                (set: any) => set.isWarmup,
                              ).length;
                              const workingSetCount = (ex.sets || []).filter(
                                (set: any) => !set.isWarmup,
                              ).length;
                              if (
                                targetIsWarmup &&
                                warmupSetCount >= LIMITS.warmupSetsPerExercise
                              ) {
                                showInfo(
                                  "Set Limit Reached",
                                  "Each exercise can have up to 10 warm-up sets.",
                                );
                                return;
                              }
                              if (
                                !targetIsWarmup &&
                                workingSetCount >= LIMITS.workingSetsPerExercise
                              ) {
                                showInfo(
                                  "Set Limit Reached",
                                  "Each exercise can have up to 10 working sets.",
                                );
                                return;
                              }
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
                            selectTextOnFocus
                            maxLength={7}
                            onChangeText={(t) => {
                              markSetWeightManual(s.id);
                              const nextWeight = sanitizeSetWeightInput(
                                t,
                                s.weight,
                              );
                              setExercises((prev) => {
                                const up = [...prev];
                                const newSets = [...up[exIdx].sets];
                                const setIndex = newSets.findIndex(
                                  (set: any) => set.id === s.id,
                                );
                                if (setIndex !== -1) {
                                  newSets[setIndex] = {
                                    ...newSets[setIndex],
                                    weight: nextWeight,
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
                                placeholder={getPreviousSetPlaceholder(
                                  exIdx,
                                  s,
                                  setTypeIndex,
                                  "repsL",
                                )}
                                placeholderTextColor="#48484A"
                                editable={isEditable}
                                maxLength={2}
                                onChangeText={(t) => {
                                  const nextReps = sanitizeRepsInput(t);
                                  setExercises((prev) => {
                                    const up = [...prev];
                                    const newSets = [...up[exIdx].sets];
                                    const setIndex = newSets.findIndex(
                                      (set: any) => set.id === s.id,
                                    );
                                    if (setIndex !== -1) {
                                      newSets[setIndex] = {
                                        ...newSets[setIndex],
                                        repsL: nextReps,
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
                                placeholder={getPreviousSetPlaceholder(
                                  exIdx,
                                  s,
                                  setTypeIndex,
                                  "repsR",
                                )}
                                placeholderTextColor="#48484A"
                                editable={isEditable}
                                maxLength={2}
                                onChangeText={(t) => {
                                  const nextReps = sanitizeRepsInput(t);
                                  setExercises((prev) => {
                                    const up = [...prev];
                                    const newSets = [...up[exIdx].sets];
                                    const setIndex = newSets.findIndex(
                                      (set: any) => set.id === s.id,
                                    );
                                    if (setIndex !== -1) {
                                      newSets[setIndex] = {
                                        ...newSets[setIndex],
                                        repsR: nextReps,
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
                              placeholder={getPreviousSetPlaceholder(
                                exIdx,
                                s,
                                setTypeIndex,
                                "reps",
                              )}
                              placeholderTextColor="#48484A"
                              editable={isEditable}
                              maxLength={2}
                              onChangeText={(t) => {
                                const nextReps = sanitizeRepsInput(t);
                                setExercises((prev) => {
                                  const up = [...prev];
                                  const newSets = [...up[exIdx].sets];
                                  const setIndex = newSets.findIndex(
                                    (set: any) => set.id === s.id,
                                  );
                                  if (setIndex !== -1) {
                                    newSets[setIndex] = {
                                      ...newSets[setIndex],
                                      reps: nextReps,
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

                          {rpeTrackingEnabled && (
                            <TextInput
                              style={[
                                styles.setInput,
                                {
                                  flex: 0.65,
                                  fontSize: 14,
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
                              value={s.rpe || ""}
                              placeholder="—"
                              placeholderTextColor="#48484A"
                              editable={isEditable}
                              maxLength={4}
                              onChangeText={(value) => {
                                const nextRpe = sanitizeRpeInput(value, s.rpe || "");
                                setExercises((prev) => {
                                  const up = [...prev];
                                  const newSets = [...up[exIdx].sets];
                                  const setIndex = newSets.findIndex(
                                    (set: any) => set.id === s.id,
                                  );
                                  if (setIndex !== -1) {
                                    newSets[setIndex] = {
                                      ...newSets[setIndex],
                                      rpe: nextRpe,
                                    };
                                    up[exIdx] = { ...up[exIdx], sets: newSets };
                                  }
                                  return up;
                                });
                                setHasUnsavedChanges(true);
                              }}
                              onBlur={() => {
                                const normalizedRpe = formatRpeValue(s.rpe);
                                if (normalizedRpe !== (s.rpe || "")) {
                                  setExercises((prev) => {
                                    const up = [...prev];
                                    const newSets = [...up[exIdx].sets];
                                    const setIndex = newSets.findIndex(
                                      (set: any) => set.id === s.id,
                                    );
                                    if (setIndex !== -1) {
                                      newSets[setIndex] = {
                                        ...newSets[setIndex],
                                        rpe: normalizedRpe,
                                      };
                                      up[exIdx] = { ...up[exIdx], sets: newSets };
                                    }
                                    return up;
                                  });
                                }
                                handleSetBlur(exIdx, s.id);
                              }}
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
                              const isComplete = hasValidSetInputs(ex, s);

                              if (!s.completed && !isComplete) {
                                Haptics.notificationAsync(
                                  Haptics.NotificationFeedbackType.Warning,
                                );
                                showInfo(
                                  "Incomplete Set",
                                  "Weight and reps must be greater than 0 before marking this set as done.",
                                );
                                return;
                              }

                              markSetWeightManual(s.id);
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
                        const workingSetCount = (ex.sets || []).filter(
                          (set: any) => !set.isWarmup,
                        ).length;
                        if (workingSetCount >= LIMITS.workingSetsPerExercise) {
                          showInfo(
                            "Set Limit Reached",
                            "Each exercise can have up to 10 working sets.",
                          );
                          return;
                        }
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
                                rpe: "",
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
                  onPress={() => {
                    if (exercises.length >= LIMITS.exercisesPerWorkout) {
                      showInfo(
                        "Exercise Limit Reached",
                        "Each workout can have up to 25 exercises.",
                      );
                      return;
                    }
                    navigation.navigate("Search", {
                      multiSelect: true,
                      selectionContext: "workout",
                      maxSelectable: LIMITS.exercisesPerWorkout - exercises.length,
                      existingExercises: exercises.map((e) => e.name),
                      onSelect: async (exData: any) =>
                        addExercisesToWorkout([exData]),
                      onSelectMany: async (exerciseList: any[]) =>
                        addExercisesToWorkout(exerciseList),
                    });
                  }}
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
            onLayout={(event) => {
              const nextHeight = Math.ceil(event.nativeEvent.layout.height);
              setFooterHeight((prev) =>
                prev === nextHeight ? prev : nextHeight,
              );
            }}
          >
            {!isEditing && displayRestTime > 0 && (
              <View style={styles.timerBar}>
                <View style={styles.timerInfo}>
                  <Text style={styles.timerLabel}>
                    {activeRestType === "warmup"
                      ? "WARM-UP REST"
                      : "WORKING REST"}
                  </Text>
                  <Text style={styles.timerTime}>
                    {formatRestClock(displayRestTime)}
                  </Text>
                </View>
                <View style={styles.timerActions}>
                  <TouchableOpacity
                    style={styles.timerBtn}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      const currentRemainingSeconds = timerEndTime
                        ? Math.max(
                            0,
                            Math.ceil((timerEndTime - Date.now()) / 1000),
                          )
                        : 0;
                      const newRemainingSeconds = Math.min(
                        LIMITS.restSecondsMax,
                        currentRemainingSeconds + 30,
                      );
                      const newTime =
                        Date.now() + newRemainingSeconds * 1000;
                      const restType = activeRestTypeRef.current ?? "working";
                      setTimerEndTime(newTime);
                      setDisplayRestTime(newRemainingSeconds);
                      scheduleRestNotification(newRemainingSeconds, restType);
                      saveActiveSessionSnapshot({
                        timerEndTime: newTime,
                        activeRestType: restType,
                      }).catch((error) => {
                        console.log(
                          "Unable to persist rest timer state:",
                          error,
                        );
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
                      activeRestTypeRef.current = null;
                      setActiveRestType(null);
                      await clearRestTimerNotification(true);
                      await saveActiveSessionSnapshot({
                        timerEndTime: null,
                        activeRestType: null,
                      });
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
                  setTimeout(() => requestFinishWorkout(), 100);
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

      <BlockingOverlay
        visible={isWorkoutBlocking}
        message={workoutBlockingMessage}
      />
    </View>
  );
}
