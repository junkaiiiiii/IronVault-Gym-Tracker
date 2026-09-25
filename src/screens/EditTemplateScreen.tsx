import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePreventRemove } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import DraggableFlatList from "react-native-draggable-flatlist";
import { GestureHandlerRootView } from "react-native-gesture-handler";
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
  isFirstInSuperset,
  getSupersetInfo,
  assignSuperset,
  removeSupersetFromExercise,
  cleanInvalidSupersets,
  createGymReplacementEntry,
  normalizeGymReplacements,
  buildReorderBlocks,
  flattenReorderBlocks,
} from "../utils/helpers";
import {
  fetchConfigFromCloud,
  safeJsonParse,
  saveTemplatesLocallyAndToCloud,
  syncFoldersToCloud,
} from "../utils/firebaseSync";
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
import { LIMITS, cleanLimitedText, limitText } from "../constants/limits";
import CustomAttachmentModal from "../components/CustomAttachmentModal";
import CustomAlert from "../components/CustomAlert";
import BlockingOverlay from "../components/BlockingOverlay";

const serializeTemplateDraft = (templateName: string, exercises: any[]) => {
  return JSON.stringify({
    name: cleanLimitedText(templateName, LIMITS.nameChars),
    exercises: (exercises || [])
      .slice(0, LIMITS.exercisesPerWorkout)
      .map((ex: any) => ({
        name: limitText(ex?.name || "", LIMITS.nameChars),
        reminder: limitText(ex?.reminder || "", LIMITS.cueChars),
        exerciseVariant: ex?.exerciseVariant || "Normal",
        variationOptions: ex?.variationOptions || null,
        attachment: ex?.attachment || null,
        attachmentOptions: ex?.attachmentOptions || null,
        supportsAttachments: ex?.supportsAttachments === true,
        is_unilateral: !!ex?.is_unilateral,
        warmupSets: Math.min(
          LIMITS.warmupSetsPerExercise,
          Math.max(0, Number(ex?.warmupSets || 0)),
        ),
        workingSets: Math.min(
          LIMITS.workingSetsPerExercise,
          Math.max(0, Number(ex?.workingSets || 0)),
        ),
        supersetId: ex?.supersetId || null,
        supersetOrder: ex?.supersetOrder || null,
        gymReplacements: normalizeGymReplacements(ex?.gymReplacements),
      })),
  });
};

const REORDER_DRAG_ANIMATION_CONFIG = {
  damping: 24,
  mass: 0.6,
  stiffness: 300,
  overshootClamping: true,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 0.01,
};

export default function EditTemplateScreen({ navigation, route }: any) {
  const uid = auth.currentUser?.uid;
  const [name, setName] = useState("New Template");
  const [selected, setSelected] = useState<any[]>([]);
  const [gyms, setGyms] = useState<any[]>([]);
  const [isGymReplacementModalVisible, setIsGymReplacementModalVisible] =
    useState(false);
  const [replacementExerciseIndex, setReplacementExerciseIndex] = useState<
    number | null
  >(null);
  const [isGymSwapManagerVisible, setIsGymSwapManagerVisible] = useState(false);
  const [gymSwapExerciseIndex, setGymSwapExerciseIndex] = useState<
    number | null
  >(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isReorderModalVisible, setIsReorderModalVisible] = useState(false);
  const [reorderDraft, setReorderDraft] = useState<any[]>([]);
  const [isSupersetModalVisible, setIsSupersetModalVisible] = useState(false);
  const [supersetBaseIndex, setSupersetBaseIndex] = useState<number | null>(
    null,
  );
  const [supersetSelectedIndexes, setSupersetSelectedIndexes] = useState<
    number[]
  >([]);
  const [infoAlert, setInfoAlert] = useState({
    visible: false,
    title: "",
    message: "",
    onCloseAction: () => {},
  });
  const [successAlertVisible, setSuccessAlertVisible] = useState(false);
  const [initialDraftSnapshot, setInitialDraftSnapshot] = useState(
    serializeTemplateDraft("New Template", []),
  );
  const [templateSaveMessage, setTemplateSaveMessage] = useState("");
  const [discardAlert, setDiscardAlert] = useState<{
    visible: boolean;
    action: any | null;
  }>({
    visible: false,
    action: null,
  });
  const [deleteExerciseAlert, setDeleteExerciseAlert] = useState<{
    visible: boolean;
    index: number | null;
    name: string;
  }>({
    visible: false,
    index: null,
    name: "",
  });
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
  const allowTemplateLeaveRef = useRef(false);
  const templateSaveInFlightRef = useRef(false);
  const isTemplateSaveBlocking = templateSaveMessage.length > 0;
  const templateData = route.params?.templateData;
  const duplicateTemplateData = route.params?.duplicateTemplateData;

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

  useEffect(() => {
    if (!uid) return;

    const loadGyms = async () => {
      try {
        const savedGyms = await AsyncStorage.getItem(`@user_gyms_${uid}`);
        let parsedGyms = savedGyms ? safeJsonParse<any[]>(savedGyms, []) : [];
        if (!Array.isArray(parsedGyms) || parsedGyms.length === 0) {
          const cloudGyms = await fetchConfigFromCloud("gyms");
          parsedGyms = Array.isArray(cloudGyms) ? cloudGyms : [];
        }
        setGyms(Array.isArray(parsedGyms) ? parsedGyms.filter(Boolean) : []);
      } catch (error) {
        console.log("Unable to load gyms for template replacements", error);
        setGyms([]);
      }
    };

    loadGyms();
  }, [uid]);

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
    const sourceTemplate = duplicateTemplateData || templateData;
    if (!sourceTemplate) return;
    setName(
      limitText(
        sourceTemplate.name || "Edit Template",
        LIMITS.nameChars,
      ),
    );
    const mappedEx = (sourceTemplate.exercises || []).map(
      (ex: any, idx: number) => {
        if (typeof ex === "string") {
          return {
            id: genId(`ex-${idx}-`),
            name: limitText(ex, LIMITS.nameChars),
            warmupSets: 0,
            workingSets: 1,
            is_unilateral: false,
          };
        }

        let warmups = 0;
        let workings = 1;
        if (Array.isArray(ex.sets)) {
          warmups = Math.min(
            LIMITS.warmupSetsPerExercise,
            ex.sets.filter((s: any) => s.isWarmup).length,
          );
          workings = Math.min(
            LIMITS.workingSetsPerExercise,
            ex.sets.filter((s: any) => !s.isWarmup).length,
          );
        } else {
          workings = Math.min(
            LIMITS.workingSetsPerExercise,
            Math.max(0, Number(ex.sets || 1)),
          );
        }

        const attachmentExercise = normalizeExerciseForAttachmentStorage(ex);
        const attachmentOptions = getExerciseAttachmentOptions(attachmentExercise);

        return {
          ...attachmentExercise,
          id: attachmentExercise.id || genId(`ex-${idx}-`),
          name: limitText(
            attachmentExercise.name || "Exercise",
            LIMITS.nameChars,
          ),
          reminder: limitText(
            attachmentExercise.reminder || "",
            LIMITS.cueChars,
          ),
          exerciseVariant: attachmentExercise.exerciseVariant || "Normal",
          variationOptions: getExerciseVariationOptions(attachmentExercise),
          supportsVariants:
            getExerciseSupportsVariantsForStorage(attachmentExercise),
          attachment: getExerciseAttachmentForSave(attachmentExercise),
          attachmentOptions:
            attachmentOptions.length > 0 ? attachmentOptions : undefined,
          supportsAttachments: attachmentOptions.length > 0 ? true : undefined,
          is_unilateral: !!attachmentExercise.is_unilateral,
          warmupSets: warmups,
          workingSets: workings,
          supersetId: attachmentExercise.supersetId || null,
          supersetOrder: attachmentExercise.supersetOrder,
          gymReplacements: normalizeGymReplacements(
            attachmentExercise.gymReplacements,
          ),
        };
      },
    );
    const cleanedMappedEx = cleanInvalidSupersets(
      mappedEx.slice(0, LIMITS.exercisesPerWorkout),
    );
    setSelected(cleanedMappedEx);
    setEditingId(duplicateTemplateData ? null : sourceTemplate.id);
    setInitialDraftSnapshot(
      serializeTemplateDraft(
        limitText(
          sourceTemplate.name || "Edit Template",
          LIMITS.nameChars,
        ),
        cleanedMappedEx,
      ),
    );
  }, [duplicateTemplateData, templateData]);

  useEffect(() => {
    if (templateData || duplicateTemplateData) return;
    setName("New Template");
    setSelected([]);
    setEditingId(null);
    setInitialDraftSnapshot(serializeTemplateDraft("New Template", []));
  }, [duplicateTemplateData, templateData]);

  const currentDraftSnapshot = useMemo(
    () => serializeTemplateDraft(name, selected),
    [name, selected],
  );

  const hasUnsavedTemplateChanges =
    !successAlertVisible &&
    !allowTemplateLeaveRef.current &&
    currentDraftSnapshot !== initialDraftSnapshot;

  usePreventRemove(hasUnsavedTemplateChanges, ({ data: { action } }) => {
    setDiscardAlert({ visible: true, action });
  });

  const discardTemplateChanges = () => {
    const action = discardAlert.action;
    allowTemplateLeaveRef.current = true;
    setDiscardAlert({ visible: false, action: null });
    requestAnimationFrame(() => {
      if (action) navigation.dispatch(action);
      else navigation.goBack();
    });
  };

  const openReorderModal = () => {
    if (selected.length < 2) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setReorderDraft(buildReorderBlocks(selected));
    setIsReorderModalVisible(true);
  };

  const saveReorder = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSelected(flattenReorderBlocks(reorderDraft));
    setIsReorderModalVisible(false);
  };

  const openCreateSupersetModal = (index: number) => {
    if (selected.length < 2) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSupersetBaseIndex(index);
    setSupersetSelectedIndexes([index]);
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
    setSelected((prev) => assignSuperset(prev, supersetSelectedIndexes));
    setSupersetBaseIndex(null);
    setSupersetSelectedIndexes([]);
    setIsSupersetModalVisible(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const removeSupersetAtIndex = (index: number) => {
    setSelected((prev) => removeSupersetFromExercise(prev, index));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const requestDeleteExercise = (index: number) => {
    const exerciseName = selected[index]?.name || "this exercise";
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDeleteExerciseAlert({ visible: true, index, name: exerciseName });
  };

  const confirmDeleteExercise = () => {
    const index = deleteExerciseAlert.index;
    if (index === null) return;

    setSelected((prev) =>
      cleanInvalidSupersets(prev.filter((_, idx) => idx !== index)),
    );
    setDeleteExerciseAlert({ visible: false, index: null, name: "" });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const replaceExerciseAtIndex = (index: number, exData: any) => {
    setSelected((prev) =>
      prev.map((existing, idx) => {
        if (idx !== index) return existing;
        const attachmentExercise = normalizeExerciseForAttachmentStorage(exData);
        const variationOptions = getExerciseVariationOptions(attachmentExercise);
        const attachmentOptions = getExerciseAttachmentOptions(attachmentExercise);
        return {
          ...existing,
          name: attachmentExercise.name || existing.name,
          reminder: attachmentExercise.reminder || "",
          muscle: attachmentExercise.muscle,
          equipment: attachmentExercise.equipment,
          image: attachmentExercise.image,
          brand: undefined,
          machineBrand: undefined,
          equipmentTag: undefined,
          exerciseVariant: variationOptions.length > 0 ? "Normal" : undefined,
          variationOptions,
          supportsVariants:
            getExerciseSupportsVariantsForStorage(attachmentExercise),
          attachment: getExerciseAttachmentForSave(attachmentExercise),
          attachmentOptions:
            attachmentOptions.length > 0 ? attachmentOptions : undefined,
          supportsAttachments: attachmentOptions.length > 0 ? true : undefined,
          is_unilateral: !!attachmentExercise.is_unilateral,
          gymReplacements: {},
        };
      }),
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const buildTemplateExercise = (exData: any) => {
    const attachmentExercise = normalizeExerciseForAttachmentStorage(exData);
    const variationOptions = getExerciseVariationOptions(attachmentExercise);
    const attachmentOptions = getExerciseAttachmentOptions(attachmentExercise);
    return {
      id: genId("ex-"),
      name: limitText(attachmentExercise.name || "Exercise", LIMITS.nameChars),
      reminder: limitText(attachmentExercise.reminder || "", LIMITS.cueChars),
      muscle: attachmentExercise.muscle,
      equipment: attachmentExercise.equipment,
      image: attachmentExercise.image,
      exerciseVariant: variationOptions.length > 0 ? "Normal" : undefined,
      variationOptions,
      supportsVariants:
        getExerciseSupportsVariantsForStorage(attachmentExercise),
      attachment: getExerciseAttachmentForSave(attachmentExercise),
      attachmentOptions:
        attachmentOptions.length > 0 ? attachmentOptions : undefined,
      supportsAttachments: attachmentOptions.length > 0 ? true : undefined,
      is_unilateral: !!attachmentExercise.is_unilateral,
      gymReplacements: {},
      warmupSets: 0,
      workingSets: 1,
    };
  };

  const addExercisesToTemplate = (exerciseList: any[]) => {
    const incoming = Array.isArray(exerciseList)
      ? exerciseList.filter(Boolean)
      : [];
    if (incoming.length === 0) return;

    const availableSlots = LIMITS.exercisesPerWorkout - selected.length;
    if (availableSlots <= 0) {
      showInfo(
        "Exercise Limit Reached",
        "Each template can have up to 25 exercises.",
      );
      return;
    }

    const exercisesToAdd = incoming.slice(0, availableSlots);
    if (incoming.length > availableSlots) {
      showInfo(
        "Some Exercises Were Not Added",
        `This template only has room for ${availableSlots} more exercise${availableSlots === 1 ? "" : "s"}.`,
      );
    }

    setSelected((prev) => [
      ...prev,
      ...exercisesToAdd.map((exData) => buildTemplateExercise(exData)),
    ]);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const openReplaceExercise = (index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("Search", {
      mode: "replace",
      existingExercises: selected
        .filter((_, idx) => idx !== index)
        .map((e) => e.name),
      onSelect: (exData: any) => replaceExerciseAtIndex(index, exData),
    });
  };

  const getGymName = (gymId: string) =>
    gyms.find((gym: any) => gym.id === gymId)?.name || "Unknown Gym";

  const getGymSwapSummary = (exercise: any) => {
    const gymIds = Object.keys(
      normalizeGymReplacements(exercise?.gymReplacements),
    );
    if (gymIds.length === 0) return "Swap this exercise at selected gyms";
    if (gymIds.length <= 2) return gymIds.map(getGymName).join(", ");
    return `${gymIds.length} gyms configured`;
  };

  const openGymSwapManager = (index: number) => {
    if (gyms.length < 2) {
      showInfo(
        "More Gyms Needed",
        "Gym-specific swaps are useful when you train at more than one gym.",
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setGymSwapExerciseIndex(index);
    setIsGymSwapManagerVisible(true);
  };

  const openGymReplacementPicker = (index: number) => {
    if (gyms.length < 2) {
      showInfo(
        "More Gyms Needed",
        "Add another gym before setting up gym-specific exercise swaps.",
      );
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setReplacementExerciseIndex(index);
    setIsGymSwapManagerVisible(false);
    setIsGymReplacementModalVisible(true);
  };

  const selectReplacementGym = (gymId: string) => {
    const index = replacementExerciseIndex;
    if (index === null) return;
    setIsGymReplacementModalVisible(false);
    navigation.navigate("Search", {
      mode: "gymSwap",
      existingExercises: selected.map((e) => e.name),
      onSelect: (exData: any) => {
        setSelected((prev) =>
          prev.map((existing, idx) => {
            if (idx !== index) return existing;
            return {
              ...existing,
              gymReplacements: {
                ...normalizeGymReplacements(existing.gymReplacements),
                [gymId]: createGymReplacementEntry(exData),
              },
            };
          }),
        );
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      },
    });
    setReplacementExerciseIndex(null);
  };

  const removeGymReplacement = (exerciseIndex: number, gymId: string) => {
    setSelected((prev) =>
      prev.map((existing, idx) => {
        if (idx !== exerciseIndex) return existing;
        const replacements = normalizeGymReplacements(existing.gymReplacements);
        delete replacements[gymId];
        return { ...existing, gymReplacements: replacements };
      }),
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
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
    setSelected((prev) =>
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const saveCustomAttachmentForExercise = async () => {
    const exerciseIndex = customAttachmentModal.exerciseIndex;
    if (exerciseIndex === null) return;

    const targetExercise = selected[exerciseIndex];
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
    setSelected((prev) => {
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
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    closeCustomAttachmentModal();
  };

  const save = async () => {
    if (templateSaveInFlightRef.current) return;

    if (selected.length === 0) {
      showInfo(
        "Empty Template",
        "Please add at least one exercise before saving.",
      );
      return;
    }
    if (!uid) return;

    templateSaveInFlightRef.current = true;
    setTemplateSaveMessage(
      editingId ? "Saving template..." : "Creating template...",
    );

    try {
      const raw = await AsyncStorage.getItem(`@workout_templates_${uid}`);
      const list = raw
        ? safeJsonParse<any[]>(raw, []).filter((t: any) => t)
        : [];

      if (!editingId && list.length >= LIMITS.templatesPerUser) {
        showInfo("Template Limit Reached", "You can save up to 50 templates.");
        return;
      }

      const finalName =
        cleanLimitedText(name, LIMITS.nameChars) || "New Template";
      const isDuplicate = list.some(
        (t: any) =>
          t.name.trim().toLowerCase() === finalName.toLowerCase() &&
          t.id !== editingId,
      );

      if (isDuplicate) {
        showInfo(
          "Name Taken",
          duplicateTemplateData
            ? `Rename this duplicated template before saving. "${finalName}" already exists.`
            : `A template named "${finalName}" already exists. Please choose a different name.`,
        );
        return;
      }

      const cleanedSelected = cleanInvalidSupersets(
        selected.slice(0, LIMITS.exercisesPerWorkout),
      );

      const exercisesToSave = cleanedSelected.map((ex) => {
        const attachmentExercise = normalizeExerciseForAttachmentStorage(ex);
        const variationOptions = getExerciseVariationOptions(attachmentExercise);
        const attachmentOptions = getExerciseAttachmentOptions(attachmentExercise);
        const warmupCount = Math.min(
          LIMITS.warmupSetsPerExercise,
          Math.max(0, Number(attachmentExercise.warmupSets || 0)),
        );
        const workingCount = Math.min(
          LIMITS.workingSetsPerExercise,
          Math.max(0, Number(attachmentExercise.workingSets || 0)),
        );
        const generatedSets = [
          ...Array.from({ length: warmupCount }).map(() => ({
            isWarmup: true,
          })),
          ...Array.from({ length: workingCount }).map(() => ({
            isWarmup: false,
          })),
        ];
        if (generatedSets.length === 0) generatedSets.push({ isWarmup: false });

        return {
          id: attachmentExercise.id || genId("ex-"),
          name: limitText(
            attachmentExercise.name || "Exercise",
            LIMITS.nameChars,
          ),
          reminder: limitText(
            attachmentExercise.reminder || "",
            LIMITS.cueChars,
          ),
          muscle: attachmentExercise.muscle,
          equipment: attachmentExercise.equipment,
          image: attachmentExercise.image,
          exerciseVariant:
            attachmentExercise.exerciseVariant ||
            (variationOptions.length > 0 ? "Normal" : undefined),
          variationOptions:
            variationOptions.length > 0 ? variationOptions : undefined,
          supportsVariants:
            getExerciseSupportsVariantsForStorage(attachmentExercise),
          attachment: getExerciseAttachmentForSave(attachmentExercise),
          attachmentOptions:
            attachmentOptions.length > 0 ? attachmentOptions : undefined,
          supportsAttachments: attachmentOptions.length > 0 ? true : undefined,
          is_unilateral: !!attachmentExercise.is_unilateral,
          supersetId: attachmentExercise.supersetId || null,
          supersetOrder: attachmentExercise.supersetOrder,
          gymReplacements: normalizeGymReplacements(
            attachmentExercise.gymReplacements,
          ),
          sets: generatedSets,
        };
      });

      let updatedTemplates;
      let newTemplateId: string | null = null;

      if (editingId) {
        updatedTemplates = list.map((t: any) =>
          t.id === editingId
            ? {
                ...t,
                name: finalName,
                exercises: exercisesToSave,
                updatedAt: Date.now(),
              }
            : t,
        );
      } else {
        newTemplateId = genId("tpl-");
        updatedTemplates = [
          ...list,
          {
            id: newTemplateId,
            name: finalName,
            exercises: exercisesToSave,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ];
      }

      try {
        await saveTemplatesLocallyAndToCloud(updatedTemplates, uid);
      } catch (e) {
        await AsyncStorage.setItem(
          `@workout_templates_${uid}`,
          JSON.stringify(updatedTemplates),
        );
        console.log("Cloud routine backup delayed.", e);
      }

      if (newTemplateId && route.params?.folderId) {
        const fRaw = await AsyncStorage.getItem(`@workout_folders_${uid}`);
        if (fRaw) {
          const storedFolders = safeJsonParse<any[]>(fRaw, []);
          const fIndex = storedFolders.findIndex(
            (f: any) => f.id === route.params.folderId,
          );

          if (fIndex !== -1) {
            const currentIds = Array.isArray(storedFolders[fIndex].templateIds)
              ? storedFolders[fIndex].templateIds
              : [];
            storedFolders[fIndex] = {
              ...storedFolders[fIndex],
              templateIds: Array.from(new Set([...currentIds, newTemplateId])),
              updatedAt: Date.now(),
            };
            await AsyncStorage.setItem(
              `@workout_folders_${uid}`,
              JSON.stringify(storedFolders),
            );
            syncFoldersToCloud(storedFolders).catch((e) => {
              console.log("Failed to sync folder update", e);
            });
          }
        }
      }

      setSelected(cleanedSelected);
      setInitialDraftSnapshot(
        serializeTemplateDraft(finalName, cleanedSelected),
      );
      allowTemplateLeaveRef.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccessAlertVisible(true);
    } catch (error) {
      console.error("Template save failed:", error);
      showInfo(
        "Save Failed",
        "IronVault could not finish saving this template. Please try again.",
      );
    } finally {
      templateSaveInFlightRef.current = false;
      setTemplateSaveMessage("");
    }
  };
  const updateWorkingSets = (index: number, change: number) => {
    setSelected((prev) => {
      const up = [...prev];
      up[index] = {
        ...up[index],
        workingSets: Math.min(
          LIMITS.workingSetsPerExercise,
          Math.max(0, (up[index].workingSets || 0) + change),
        ),
      };
      return up;
    });
  };

  const updateWarmupSets = (index: number, change: number) => {
    setSelected((prev) => {
      const up = [...prev];
      up[index] = {
        ...up[index],
        warmupSets: Math.min(
          LIMITS.warmupSetsPerExercise,
          Math.max(0, (up[index].warmupSets || 0) + change),
        ),
      };
      return up;
    });
  };

  const renderExerciseCard = (ex: any, i: number) => {
    const supersetInfo = getSupersetInfo(selected, ex.supersetId);
    const supersetLabel = supersetInfo?.label || "A";
    const showSupersetHeader =
      !!ex.supersetId && isFirstInSuperset(selected, i);
    const supersetOrderLabel = ex.supersetId
      ? `${supersetLabel}${ex.supersetOrder || 1}`
      : null;
    const showGymSwapRow = gyms.length > 1;
    const gymSwapSummary = getGymSwapSummary(ex);
    const variationOptions = getExerciseVariationOptions(ex);
    const attachmentOptions = getExerciseAttachmentOptionsWithCustom(
      ex,
      customAttachments,
    );
    const attachmentSelectionOptions = getExerciseAttachmentSelectionOptions(
      ex,
      customAttachments,
    );

    return (
      <View key={ex.id || `${ex.name}-${i}`}>
        {showSupersetHeader && (
          <View style={styles.supersetGroupHeader}>
            <View>
              <Text style={styles.supersetGroupKicker}>
                SUPERSET {supersetLabel}
              </Text>
              <Text style={styles.supersetGroupMeta}>
                {supersetInfo?.exercises?.length || 2} exercises · saved with
                template
              </Text>
            </View>
            <Ionicons name="git-merge-outline" size={20} color="#32D74B" />
          </View>
        )}

        <View
          style={[
            styles.exerciseCard,
            ex.supersetId && styles.exerciseCardInSuperset,
          ]}
        >
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: 20,
            }}
          >
            <View style={{ flex: 1, paddingRight: 10 }}>
              <TouchableOpacity
                activeOpacity={0.9}
                onLongPress={openReorderModal}
                delayLongPress={220}
              >
                <Text
                  style={[styles.exerciseTitle, { flexWrap: "wrap" }]}
                  numberOfLines={2}
                >
                  {supersetOrderLabel && (
                    <Text style={{ color: "#32D74B", fontSize: 14 }}>
                      {supersetOrderLabel}{" "}
                    </Text>
                  )}
                  {formatExerciseDisplayName(ex)}{" "}
                  {ex.is_unilateral && (
                    <Text style={{ color: "#32D74B", fontSize: 14 }}>
                      (L/R)
                    </Text>
                  )}
                </Text>
              </TouchableOpacity>

              {selected.length > 1 && (
                <Text style={styles.exerciseTitleHint}>
                  Hold title to reorder
                </Text>
              )}

              {variationOptions.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingTop: 10 }}
                >
                  {variationOptions.map((variant) => {
                    const active = (ex.exerciseVariant || "Normal") === variant;
                    return (
                      <TouchableOpacity
                        key={variant}
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          marginRight: 8,
                          backgroundColor: active ? "#32D74B" : "#2C2C2E",
                          borderWidth: 1,
                          borderColor: active ? "#32D74B" : "#3A3A3C",
                        }}
                        onPress={() => {
                          setSelected((prev) => {
                            const up = [...prev];
                            up[i] = { ...up[i], exerciseVariant: variant };
                            return up;
                          });
                        }}
                      >
                        <Text
                          style={{
                            color: active ? "#000" : "#D1D1D6",
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

              {attachmentSelectionOptions.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingTop: 8 }}
                >
                  {attachmentSelectionOptions.map((attachment) => {
                    const isNoAttachment =
                      attachment === NO_ATTACHMENT_OPTION_LABEL;
                    const currentAttachment =
                      getExerciseAttachmentForStorage(ex);
                    const active = isNoAttachment
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
                          backgroundColor: active ? "#32D74B" : "#2C2C2E",
                          borderWidth: 1,
                          borderColor: active ? "#32D74B" : "#3A3A3C",
                        }}
                        onPress={() => {
                          setSelected((prev) => {
                            const up = [...prev];
                            up[i] = {
                              ...up[i],
                              attachment: isNoAttachment ? "" : attachment,
                              attachmentOptions,
                              supportsAttachments: true,
                            };
                            return up;
                          });
                        }}
                      >
                        <Text
                          style={{
                            color: active ? "#000" : "#D1D1D6",
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
                    onPress={() => openCustomAttachmentModal(i)}
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
            </View>

            <TouchableOpacity
              onPress={() => openReplaceExercise(i)}
              style={{ paddingHorizontal: 8, paddingVertical: 4 }}
            >
              <Ionicons
                name="swap-horizontal-outline"
                size={22}
                color="#32D74B"
              />
            </TouchableOpacity>

            {ex.supersetId ? (
              <TouchableOpacity
                onPress={() => removeSupersetAtIndex(i)}
                style={{ paddingHorizontal: 8, paddingVertical: 4 }}
              >
                <Ionicons name="unlink-outline" size={22} color="#32D74B" />
              </TouchableOpacity>
            ) : selected.length > 1 ? (
              <TouchableOpacity
                onPress={() => openCreateSupersetModal(i)}
                style={{ paddingHorizontal: 8, paddingVertical: 4 }}
              >
                <Ionicons name="git-merge-outline" size={22} color="#32D74B" />
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              onPress={() => requestDeleteExercise(i)}
              style={{ paddingHorizontal: 4, paddingVertical: 4 }}
            >
              <Ionicons name="trash-outline" size={22} color="#FF3B30" />
            </TouchableOpacity>
          </View>

          <View
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: "#2C2C2E",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text
                  style={{ color: "#F2F2F7", fontSize: 14, fontWeight: "800" }}
                >
                  Warm-ups
                </Text>
                <Text style={{ color: "#8E8E93", fontSize: 11, marginTop: 2 }}>
                  Preparation sets before working weight
                </Text>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "#1C1C1E",
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: "#2C2C2E",
                  padding: 3,
                }}
              >
                <TouchableOpacity
                  style={[
                    styles.moveBtn,
                    { marginRight: 0, backgroundColor: "transparent" },
                  ]}
                  onPress={() => updateWarmupSets(i, -1)}
                  disabled={(ex.warmupSets || 0) === 0}
                >
                  <Text
                    style={[
                      styles.moveBtnText,
                      (ex.warmupSets || 0) === 0 && { color: "#3A3A3C" },
                    ]}
                  >
                    -
                  </Text>
                </TouchableOpacity>
                <Text
                  style={{
                    color: "#FFD700",
                    fontSize: 15,
                    fontWeight: "900",
                    minWidth: 28,
                    textAlign: "center",
                  }}
                >
                  {ex.warmupSets || 0}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.moveBtn,
                    { marginRight: 0, backgroundColor: "transparent" },
                  ]}
                  onPress={() => updateWarmupSets(i, 1)}
                >
                  <Text style={styles.moveBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 12,
              }}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text
                  style={{ color: "#F2F2F7", fontSize: 14, fontWeight: "800" }}
                >
                  Working sets
                </Text>
                <Text style={{ color: "#8E8E93", fontSize: 11, marginTop: 2 }}>
                  Main logged sets for this exercise
                </Text>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "#1C1C1E",
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: "#2C2C2E",
                  padding: 3,
                }}
              >
                <TouchableOpacity
                  style={[
                    styles.moveBtn,
                    { marginRight: 0, backgroundColor: "transparent" },
                  ]}
                  onPress={() => updateWorkingSets(i, -1)}
                  disabled={(ex.workingSets || 0) === 0}
                >
                  <Text
                    style={[
                      styles.moveBtnText,
                      (ex.workingSets || 0) === 0 && { color: "#3A3A3C" },
                    ]}
                  >
                    -
                  </Text>
                </TouchableOpacity>
                <Text
                  style={{
                    color: "#F2F2F7",
                    fontSize: 15,
                    fontWeight: "900",
                    minWidth: 28,
                    textAlign: "center",
                  }}
                >
                  {ex.workingSets ?? 1}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.moveBtn,
                    { marginRight: 0, backgroundColor: "transparent" },
                  ]}
                  onPress={() => updateWorkingSets(i, 1)}
                >
                  <Text style={styles.moveBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {showGymSwapRow && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => openGymSwapManager(i)}
              style={{
                marginTop: 13,
                paddingTop: 12,
                borderTopWidth: 1,
                borderTopColor: "#2C2C2E",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text
                  style={{
                    color: "#F2F2F7",
                    fontSize: 14,
                    fontWeight: "800",
                  }}
                >
                  Gym-specific swaps
                </Text>
                <Text
                  style={{ color: "#8E8E93", fontSize: 11, marginTop: 3 }}
                  numberOfLines={1}
                >
                  {gymSwapSummary}
                </Text>
              </View>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: "#1C1C1E",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="chevron-forward" size={17} color="#8E8E93" />
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.screen}>
      <CustomAlert
        visible={infoAlert.visible}
        title={infoAlert.title}
        message={infoAlert.message}
        buttons={[{ text: "OK" }]}
        onClose={() => {
          setInfoAlert((prev) => ({ ...prev, visible: false }));
          setTimeout(() => infoAlert.onCloseAction(), 400);
        }}
      />
      <CustomAlert
        visible={successAlertVisible}
        title="Template Saved Successfully!"
        message={`Your template "${name}" has been saved.`}
        buttons={[{ text: "Continue", onPress: () => navigation.goBack() }]}
        onClose={() => setSuccessAlertVisible(false)}
      />
      <CustomAlert
        visible={discardAlert.visible}
        title="Discard Changes?"
        message="You have unsaved template changes. Leaving now will discard them."
        buttons={[
          { text: "Keep Editing", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: discardTemplateChanges,
          },
        ]}
        onClose={() => setDiscardAlert((prev) => ({ ...prev, visible: false }))}
      />
      <CustomAlert
        visible={deleteExerciseAlert.visible}
        title="Delete Exercise?"
        message={`Remove ${deleteExerciseAlert.name || "this exercise"} from this template? This will also remove its saved set structure from the template.`}
        buttons={[
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: confirmDeleteExercise,
          },
        ]}
        onClose={() =>
          setDeleteExerciseAlert({ visible: false, index: null, name: "" })
        }
      />
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
              <View style={styles.reorderModalHeader}>
                <View>
                  <Text style={styles.reorderModalKicker}>TEMPLATE ORDER</Text>
                  <Text style={styles.reorderModalTitle}>
                    Reorder Exercises
                  </Text>
                  <Text style={styles.reorderModalSubtitle}>
                    Hold and drag rows into order.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.reorderModalClose}
                  onPress={() => setIsReorderModalVisible(false)}
                >
                  <Ionicons name="close" size={22} color="#FFF" />
                </TouchableOpacity>
              </View>

              <DraggableFlatList
                data={reorderDraft}
                keyExtractor={(item: any, index: number) =>
                  String(item.id || index)
                }
                style={{ maxHeight: 420 }}
                contentContainerStyle={{ paddingBottom: 6 }}
                activationDistance={0}
                animationConfig={REORDER_DRAG_ANIMATION_CONFIG}
                onDragBegin={() =>
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                }
                onDragEnd={({ data }) => setReorderDraft(data)}
                renderItem={({ item, drag, isActive }) => (
                  <TouchableOpacity
                    activeOpacity={0.92}
                    onLongPress={drag}
                    delayLongPress={120}
                    style={styles.reorderExerciseRow}
                  >
                    <Ionicons
                      name="reorder-three-outline"
                      size={24}
                      color={isActive ? "#32D74B" : "#8E8E93"}
                    />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text
                        style={styles.reorderExerciseTitle}
                        numberOfLines={1}
                      >
                        {item.blockType === "superset"
                          ? `Superset: ${(item.members || []).map((member: any) => member.name).join(" + ")}`
                          : `${formatExerciseDisplayName(item.members?.[0] || item)}${(item.members?.[0] || item).is_unilateral ? " (L/R)" : ""}`}
                      </Text>
                      <Text
                        style={styles.reorderExerciseSubtitle}
                        numberOfLines={1}
                      >
                        {item.blockType === "superset"
                          ? `${(item.members || []).length} exercises · moves together`
                          : `${((item.members?.[0] || item).warmupSets || 0) + ((item.members?.[0] || item).workingSets || 0)} sets`}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
              />

              <View style={styles.reorderModalFooter}>
                <TouchableOpacity
                  style={styles.reorderCancelButton}
                  onPress={() => setIsReorderModalVisible(false)}
                >
                  <Text style={styles.reorderCancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.reorderDoneButton}
                  onPress={saveReorder}
                >
                  <Text style={styles.reorderDoneButtonText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </GestureHandlerRootView>
      </Modal>

      <Modal visible={isSupersetModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.actionMenuCard}>
            <Text style={styles.actionMenuTitle}>Create Superset</Text>
            <Text style={styles.actionMenuSubtitle}>
              {supersetBaseIndex !== null
                ? `${formatExerciseDisplayName(selected[supersetBaseIndex])} is included. Select exercises to pair with it.`
                : "Select exercises to group together."}
            </Text>
            <ScrollView
              style={{ maxHeight: 320 }}
              showsVerticalScrollIndicator={false}
            >
              {selected.map((ex, idx) => {
                const isBase = idx === supersetBaseIndex;
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
                style={styles.reorderCancelButton}
                onPress={() => {
                  setIsSupersetModalVisible(false);
                  setSupersetSelectedIndexes([]);
                  setSupersetBaseIndex(null);
                }}
              >
                <Text style={styles.reorderCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.reorderDoneButton}
                onPress={createSupersetFromSelection}
              >
                <Text style={styles.reorderDoneButtonText}>
                  Create Superset
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={isGymSwapManagerVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.actionMenuCard}>
            <Text style={styles.actionMenuTitle}>Gym-specific swaps</Text>
            <Text style={styles.actionMenuSubtitle}>
              Swap this exercise only when starting this template at selected
              gyms.
            </Text>

            {gymSwapExerciseIndex !== null && selected[gymSwapExerciseIndex] ? (
              <View style={{ marginTop: 12 }}>
                <Text
                  style={{
                    color: "#F2F2F7",
                    fontSize: 14,
                    fontWeight: "900",
                    marginBottom: 10,
                  }}
                  numberOfLines={2}
                >
                  {formatExerciseDisplayName(selected[gymSwapExerciseIndex])}
                </Text>

                {Object.entries(
                  normalizeGymReplacements(
                    selected[gymSwapExerciseIndex]?.gymReplacements,
                  ),
                ).length === 0 ? (
                  <View
                    style={{
                      paddingVertical: 14,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      backgroundColor: "#1C1C1E",
                      borderWidth: 1,
                      borderColor: "#2C2C2E",
                    }}
                  >
                    <Text
                      style={{ color: "#8E8E93", fontSize: 12, lineHeight: 18 }}
                    >
                      No swaps set yet. Add one if this gym uses a different
                      exercise for the same template slot.
                    </Text>
                  </View>
                ) : (
                  <ScrollView
                    style={{ maxHeight: 260 }}
                    showsVerticalScrollIndicator={false}
                  >
                    {Object.entries(
                      normalizeGymReplacements(
                        selected[gymSwapExerciseIndex]?.gymReplacements,
                      ),
                    ).map(([gymId, replacement]: any) => (
                      <View
                        key={gymId}
                        style={{
                          paddingVertical: 11,
                          paddingHorizontal: 12,
                          borderRadius: 12,
                          backgroundColor: "#1C1C1E",
                          borderWidth: 1,
                          borderColor: "#2C2C2E",
                          marginBottom: 8,
                          flexDirection: "row",
                          alignItems: "center",
                        }}
                      >
                        <View style={{ flex: 1, paddingRight: 10 }}>
                          <Text
                            style={{
                              color: "#F2F2F7",
                              fontSize: 12,
                              fontWeight: "900",
                            }}
                            numberOfLines={1}
                          >
                            {getGymName(gymId)}
                          </Text>
                          <Text
                            style={{
                              color: "#32D74B",
                              fontSize: 12,
                              marginTop: 3,
                            }}
                            numberOfLines={2}
                          >
                            → {replacement?.name || "Replacement exercise"}
                          </Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => {
                            if (gymSwapExerciseIndex !== null) {
                              removeGymReplacement(gymSwapExerciseIndex, gymId);
                            }
                          }}
                          style={{ padding: 6 }}
                        >
                          <Ionicons
                            name="close-outline"
                            size={20}
                            color="#8E8E93"
                          />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </ScrollView>
                )}

                <TouchableOpacity
                  style={{
                    marginTop: 14,
                    width: "100%",
                    minHeight: 52,
                    borderRadius: 18,
                    backgroundColor: "#32D74B",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 18,
                  }}
                  activeOpacity={0.82}
                  onPress={() => {
                    if (gymSwapExerciseIndex !== null) {
                      openGymReplacementPicker(gymSwapExerciseIndex);
                    }
                  }}
                >
                  <Text
                    style={{
                      color: "#000",
                      fontSize: 16,
                      fontWeight: "900",
                    }}
                  >
                    Add gym swap
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <TouchableOpacity
              style={{
                marginTop: 12,
                width: "100%",
                minHeight: 50,
                borderRadius: 18,
                backgroundColor: "#2C2C2E",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 18,
              }}
              activeOpacity={0.82}
              onPress={() => {
                setIsGymSwapManagerVisible(false);
                setGymSwapExerciseIndex(null);
              }}
            >
              <Text
                style={{
                  color: "#F2F2F7",
                  fontSize: 16,
                  fontWeight: "900",
                }}
              >
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isGymReplacementModalVisible}
        transparent
        animationType="fade"
      >
        <View style={styles.modalOverlay}>
          <View style={styles.actionMenuCard}>
            <Text style={styles.actionMenuTitle}>Choose gym</Text>
            <Text style={styles.actionMenuSubtitle}>
              Select the gym where this exercise should swap to a different
              movement.
            </Text>
            <ScrollView
              style={{ maxHeight: 320 }}
              showsVerticalScrollIndicator={false}
            >
              {gyms.map((gym: any) => (
                <TouchableOpacity
                  key={gym.id}
                  style={styles.supersetPickerRow}
                  onPress={() => selectReplacementGym(gym.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.supersetPickerTitle} numberOfLines={1}>
                      {gym.name}
                    </Text>
                    <Text style={styles.supersetPickerMeta}>
                      Choose or update this gym swap
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#8E8E93" />
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={{
                marginTop: 14,
                width: "100%",
                minHeight: 50,
                borderRadius: 18,
                backgroundColor: "#2C2C2E",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 18,
              }}
              activeOpacity={0.82}
              onPress={() => {
                setIsGymReplacementModalVisible(false);
                setReplacementExerciseIndex(null);
              }}
            >
              <Text
                style={{
                  color: "#F2F2F7",
                  fontSize: 16,
                  fontWeight: "900",
                }}
              >
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <SafeAreaView edges={["top"]} style={styles.headerContainer}>
        <View style={styles.headerContentFlex}>
          <TouchableOpacity
            style={styles.headerSideBtn}
            onPress={() => navigation.goBack()}
          >
            <View style={styles.customBackChevron} />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <TextInput
              style={styles.headerTitleInput}
              value={name}
              onChangeText={(value) => setName(limitText(value, LIMITS.nameChars))}
              maxLength={LIMITS.nameChars}
              selectTextOnFocus
              textAlign="center"
              selectionColor="#FFF"
            />
          </View>
          <View style={styles.headerRightActionGroup}>
            <TouchableOpacity
              style={[
                styles.headerSideBtn,
                isTemplateSaveBlocking && { opacity: 0.45 },
              ]}
              onPress={save}
              disabled={isTemplateSaveBlocking}
            >
              <Text style={styles.headerActionText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 18 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {selected.length > 1 && (
            <TouchableOpacity
              style={styles.reorderInlineButton}
              onPress={openReorderModal}
            >
              <Ionicons name="swap-vertical" size={17} color="#32D74B" />
              <Text style={styles.reorderInlineButtonText}>
                Reorder Exercises
              </Text>
            </TouchableOpacity>
          )}

          {selected.map((ex, i) => renderExerciseCard(ex, i))}

          <TouchableOpacity
            style={styles.addExerciseCard}
            onPress={() => {
              if (selected.length >= LIMITS.exercisesPerWorkout) {
                showInfo(
                  "Exercise Limit Reached",
                  "Each template can have up to 25 exercises.",
                );
                return;
              }
              navigation.navigate("Search", {
                multiSelect: true,
                selectionContext: "template",
                maxSelectable: LIMITS.exercisesPerWorkout - selected.length,
                existingExercises: selected.map((e) => e.name),
                onSelect: (exData: any) => addExercisesToTemplate([exData]),
                onSelectMany: (exerciseList: any[]) =>
                  addExercisesToTemplate(exerciseList),
              });
            }}
          >
            <Text style={styles.addExerciseText}>+ Add Exercise</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <BlockingOverlay
        visible={isTemplateSaveBlocking}
        message={templateSaveMessage}
      />
    </View>
  );
}
