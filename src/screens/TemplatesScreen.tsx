import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
  StyleSheet,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { auth } from "../config/firebaseConfig";
import { styles } from "../constants/globalStyles";
import * as Haptics from "expo-haptics";
import DraggableFlatList from "react-native-draggable-flatlist";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  fetchConfigFromCloud,
  syncConfigToCloud,
  syncFoldersToCloud,
  syncSettingsToCloud,
} from "../utils/firebaseSync";
import CustomAlert from "../components/CustomAlert";
import { genId, getSupersetGroups } from "../utils/helpers";

type SplitDay = {
  dayNumber: number;
  type: "rest" | "template";
  templateId?: string | null;
};

type TemplateFolder = {
  id: string;
  name: string;
  templateIds: string[];
  cycleLength: number;
  days: SplitDay[];
  startDate?: number;
  createdAt?: number;
  updatedAt?: number;
};

const clampCycleLength = (value: any) => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 7;
  return Math.max(2, Math.min(9, Math.round(parsed)));
};

const createRestDay = (dayNumber: number): SplitDay => ({
  dayNumber,
  type: "rest",
  templateId: null,
});

const formatSplitStartDate = (value?: number) => {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const startOfLocalDay = (value: number) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const normalizeSplitDays = (
  days: any[] | undefined,
  cycleLength: number,
  templateIds: string[] = [],
): SplitDay[] => {
  const existing = Array.isArray(days) ? days : [];

  return Array.from({ length: cycleLength }, (_, index) => {
    const dayNumber = index + 1;
    const match = existing.find((d: any) => Number(d?.dayNumber) === dayNumber);
    const templateId = match?.templateId || null;

    if (
      match?.type === "template" &&
      templateId &&
      templateIds.includes(templateId)
    ) {
      return { dayNumber, type: "template", templateId };
    }

    return createRestDay(dayNumber);
  });
};

const normalizeFolder = (folder: any): TemplateFolder => {
  const templateIds = Array.isArray(folder?.templateIds)
    ? folder.templateIds.filter(Boolean)
    : [];
  const cycleLength = clampCycleLength(folder?.cycleLength ?? 7);

  return {
    ...folder,
    id: folder?.id || genId("fldr-"),
    name: folder?.name || "Folder",
    templateIds,
    cycleLength,
    days: normalizeSplitDays(folder?.days, cycleLength, templateIds),
    startDate: startOfLocalDay(
      folder?.startDate || folder?.createdAt || Date.now(),
    ),
    createdAt: folder?.createdAt || Date.now(),
    updatedAt: folder?.updatedAt || Date.now(),
  };
};

const resizeSplitDays = (
  days: SplitDay[],
  nextLength: number,
  templateIds: string[],
): SplitDay[] => {
  const cycleLength = clampCycleLength(nextLength);
  return Array.from({ length: cycleLength }, (_, index) => {
    const dayNumber = index + 1;
    const existing = days.find((d) => d.dayNumber === dayNumber);
    if (
      existing?.type === "template" &&
      existing.templateId &&
      templateIds.includes(existing.templateId)
    ) {
      return { dayNumber, type: "template", templateId: existing.templateId };
    }
    return createRestDay(dayNumber);
  });
};

const TEMPLATE_REORDER_DRAG_ANIMATION_CONFIG = {
  damping: 24,
  mass: 0.6,
  stiffness: 300,
  overshootClamping: true,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 0.01,
};

export default function TemplatesScreen({ navigation }: any) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [folders, setFolders] = useState<TemplateFolder[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const listRef = useRef<FlatList<any>>(null);
  const [activeFolderId, setActiveFolderId] = useState<string>("All");
  const [activeSplitFolderId, setActiveSplitFolderId] = useState<string | null>(
    null,
  );

  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<any>(null);
  const [detailTemplate, setDetailTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [isTemplateReorderModalVisible, setIsTemplateReorderModalVisible] = useState(false);
  const [templateReorderDraft, setTemplateReorderDraft] = useState<any[]>([]);

  const [isFolderModalVisible, setIsFolderModalVisible] = useState(false);
  const [isFolderOptionsVisible, setIsFolderOptionsVisible] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderCycleLength, setFolderCycleLength] = useState(7);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);

  const [isSplitModalVisible, setIsSplitModalVisible] = useState(false);
  const [splitCycleLength, setSplitCycleLength] = useState(7);
  const [splitDays, setSplitDays] = useState<SplitDay[]>([]);

  const [isMoveModalVisible, setIsMoveModalVisible] = useState(false);
  const [isBatchSelectVisible, setIsBatchSelectVisible] = useState(false);
  const [batchSelectIds, setBatchSelectIds] = useState<string[]>([]);

  const [isManageMode, setIsManageMode] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [batchDeleteAlertVisible, setBatchDeleteAlertVisible] = useState(false);

  const [infoAlert, setInfoAlert] = useState({
    visible: false,
    title: "",
    message: "",
  });
  const [startAlertVisible, setStartAlertVisible] = useState(false);
  const [pendingStartTemplate, setPendingStartTemplate] = useState<any>(null);
  const [deleteAlertVisible, setDeleteAlertVisible] = useState(false);
  const [deleteFolderAlertVisible, setDeleteFolderAlertVisible] =
    useState(false);

  const insets = useSafeAreaInsets();
  const uid = auth.currentUser?.uid;

  const activeFolder = useMemo(
    () => folders.find((folder) => folder.id === activeFolderId) || null,
    [folders, activeFolderId],
  );

  const saveTemplates = async (nextTemplates: any[]) => {
    setTemplates(nextTemplates);
    if (!uid) return;

    await AsyncStorage.setItem(
      `@workout_templates_${uid}`,
      JSON.stringify(nextTemplates),
    );

    try {
      await syncConfigToCloud("templates", nextTemplates);
    } catch (error) {
      console.error("Failed to sync templates:", error);
    }
  };

  const saveFolders = async (newFolders: TemplateFolder[]) => {
    const normalized = newFolders.map(normalizeFolder);
    setFolders(normalized);
    if (uid) {
      await AsyncStorage.setItem(
        `@workout_folders_${uid}`,
        JSON.stringify(normalized),
      );
      await syncFoldersToCloud(normalized);
    }
  };

  const saveActiveSplitFolder = async (folderId: string | null) => {
    if (!uid) return;

    setActiveSplitFolderId(folderId);

    if (folderId) {
      await AsyncStorage.setItem(`@active_split_folder_${uid}`, folderId);
    } else {
      await AsyncStorage.removeItem(`@active_split_folder_${uid}`);
    }

    try {
      await syncSettingsToCloud({ activeSplitFolderId: folderId });
    } catch (e) {
      console.log("Active split cloud sync delayed", e);
    }
  };

  const setFolderAsActiveSplit = async (folder: TemplateFolder | null) => {
    if (!folder) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await saveActiveSplitFolder(folder.id);
    setIsFolderOptionsVisible(false);
    setInfoAlert({
      visible: true,
      title: "Active Split Updated",
      message: `${folder.name} will now be shown on your Home screen.`,
    });
  };

  const load = async () => {
    if (!uid) return;
    setLoading(true);

    const saved = await AsyncStorage.getItem(`@workout_templates_${uid}`);
    let localTemplates = saved
      ? JSON.parse(saved).filter((t: any) => t && t.id)
      : [];

    if (localTemplates.length === 0) {
      try {
        const cloudTemplates = await fetchConfigFromCloud("templates");
        if (cloudTemplates && cloudTemplates.length > 0) {
          localTemplates = cloudTemplates;
          await AsyncStorage.setItem(
            `@workout_templates_${uid}`,
            JSON.stringify(cloudTemplates),
          );
        }
      } catch (error) {
        console.error("Failed to restore templates:", error);
      }
    }
    setTemplates(localTemplates);

    const savedFolders = await AsyncStorage.getItem(`@workout_folders_${uid}`);
    let localFolders = savedFolders ? JSON.parse(savedFolders) : [];

    if (localFolders.length === 0) {
      try {
        const cloudFolders = await fetchConfigFromCloud("folders");
        if (cloudFolders && cloudFolders.length > 0) {
          localFolders = cloudFolders;
          await AsyncStorage.setItem(
            `@workout_folders_${uid}`,
            JSON.stringify(cloudFolders),
          );
        }
      } catch (e) {
        console.error("Failed to restore folders:", e);
      }
    }

    const normalizedFolders = localFolders.map(normalizeFolder);
    setFolders(normalizedFolders);

    const savedActiveSplitFolderId = await AsyncStorage.getItem(
      `@active_split_folder_${uid}`,
    );
    if (
      savedActiveSplitFolderId &&
      normalizedFolders.some(
        (folder: TemplateFolder) => folder.id === savedActiveSplitFolderId,
      )
    ) {
      setActiveSplitFolderId(savedActiveSplitFolderId);
    } else if (savedActiveSplitFolderId) {
      await saveActiveSplitFolder(null);
    }

    if (JSON.stringify(normalizedFolders) !== JSON.stringify(localFolders)) {
      await AsyncStorage.setItem(
        `@workout_folders_${uid}`,
        JSON.stringify(normalizedFolders),
      );
      try {
        await syncFoldersToCloud(normalizedFolders);
      } catch (e) {}
    }

    const savedHistory = await AsyncStorage.getItem(`@workout_history_${uid}`);
    setHistory(
      savedHistory
        ? JSON.parse(savedHistory).filter((w: any) => w && w.id)
        : [],
    );

    setLoading(false);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      });
      load();
    });
    return unsubscribe;
  }, [navigation, uid]);

  const exitManageMode = () => {
    setIsManageMode(false);
    setSelectedTemplateIds([]);
  };

  const handleTemplatePress = async (template: any) => {
    if (isManageMode) {
      toggleTemplateSelection(template.id);
      return;
    }

    if (!uid) return;
    const active = await AsyncStorage.getItem(`@active_session_${uid}`);
    if (active) {
      setInfoAlert({
        visible: true,
        title: "Workout in Progress",
        message: "Please finish your active session first.",
      });
    } else {
      setPendingStartTemplate(template);
      setStartAlertVisible(true);
    }
  };

  const openTemplateDetail = (template: any) => {
    if (isManageMode) {
      toggleTemplateSelection(template.id);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDetailTemplate(template);
  };

  const startTemplateFromDetail = (template: any) => {
    setDetailTemplate(null);
    setTimeout(() => handleTemplatePress(template), 250);
  };

  const openTemplateReorderModal = () => {
    if (isManageMode) return;

    if (activeFolderId === "All") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setInfoAlert({
        visible: true,
        title: "Open a Folder",
        message: "Template order is controlled inside each folder.",
      });
      return;
    }

    if (searchQuery.trim().length > 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setInfoAlert({
        visible: true,
        title: "Clear Search First",
        message: "Clear the search field before reordering templates.",
      });
      return;
    }

    if (displayedTemplates.length < 2) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTemplateReorderDraft(displayedTemplates);
    setIsTemplateReorderModalVisible(true);
  };

  const saveTemplateReorder = async () => {
    if (activeFolderId === "All") return;

    const folderIndex = folders.findIndex((f) => f.id === activeFolderId);
    if (folderIndex === -1) return;

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const reorderedIds = templateReorderDraft
      .map((template) => template?.id)
      .filter(Boolean);
    const existingSet = new Set(reorderedIds);
    const folder = folders[folderIndex];
    const preservedIds = folder.templateIds.filter((id) => !existingSet.has(id));

    const nextFolders = [...folders];
    nextFolders[folderIndex] = normalizeFolder({
      ...folder,
      templateIds: [...reorderedIds, ...preservedIds],
      updatedAt: Date.now(),
    });

    await saveFolders(nextFolders);
    setIsTemplateReorderModalVisible(false);
  };

  const displayedTemplates = useMemo(() => {
    const baseTemplates = (() => {
      if (activeFolderId === "All") return templates;
      const folder = folders.find((f) => f.id === activeFolderId);
      if (!folder) return [];

      return folder.templateIds
        .map((tId: string) => templates.find((t) => t.id === tId))
        .filter((t: any) => t !== undefined);
    })();

    const query = searchQuery.trim().toLowerCase();
    if (!query) return baseTemplates;

    return baseTemplates.filter((template: any) => {
      const exerciseNames = (template.exercises || [])
        .map((ex: any) => (typeof ex === "string" ? ex : ex?.name || ""))
        .join(" ");
      return `${template.name || ""} ${exerciseNames}`
        .toLowerCase()
        .includes(query);
    });
  }, [templates, folders, activeFolderId, searchQuery]);

  const folderTemplates = useMemo(() => {
    if (!activeFolder) return [];
    return activeFolder.templateIds
      .map((tId) => templates.find((template) => template.id === tId))
      .filter(Boolean);
  }, [activeFolder, templates]);

  const isSelectedFolderEmpty =
    activeFolderId !== "All" && folderTemplates.length === 0;
  const hasTemplateSearch = searchQuery.trim().length > 0;

  const getTemplateCounts = (template: any) => {
    const exercises = template?.exercises || [];
    const totalSets =
      exercises.reduce((sum: number, ex: any) => {
        if (typeof ex === "string") return sum + 1;
        if (Array.isArray(ex.sets)) return sum + ex.sets.length;
        return sum + (ex.sets || 1);
      }, 0) || 0;

    return { exCount: exercises.length, totalSets };
  };

  const getExerciseName = (ex: any) =>
    typeof ex === "string" ? ex : ex?.name || "Exercise";

  const getTemplatePreviewItems = (template: any) => {
    const exercises = template?.exercises || [];
    const groups = getSupersetGroups(exercises);
    const groupedIds = new Set(
      groups.flatMap((group: any) =>
        group.exercises.map((ex: any) => ex.id || ex.name),
      ),
    );
    const items: string[] = [];

    exercises.forEach((ex: any) => {
      const key = typeof ex === "string" ? ex : ex.id || ex.name;
      if (typeof ex !== "string" && ex.supersetId) {
        const group = groups.find(
          (candidate: any) => candidate.id === ex.supersetId,
        );
        const first = group?.exercises?.[0];
        if (first && (first.id || first.name) === key) {
          items.push(
            `Superset ${group.label}: ${group.exercises.map((member: any) => member.name).join(" + ")}`,
          );
        }
        return;
      }
      if (!groupedIds.has(key)) items.push(getExerciseName(ex));
    });

    return items;
  };

  const getTemplatePreview = (template: any) => {
    const names = getTemplatePreviewItems(template);
    if (names.length === 0) return "No exercises added yet";
    const visible = names.slice(0, 3).join(" • ");
    return names.length > 3
      ? `${visible} • +${names.length - 3} more`
      : visible;
  };

  const getTemplateMuscleSummary = (template: any) => {
    const muscles = new Set<string>();
    (template?.exercises || []).forEach((ex: any) => {
      if (typeof ex !== "string" && ex?.muscle) muscles.add(ex.muscle);
    });
    const list = Array.from(muscles).slice(0, 3);
    if (list.length === 0) return "Routine";
    return list.join(" • ");
  };

  const parseWorkoutDate = (value: any) => {
    if (!value) return new Date(0);
    const native = new Date(value);
    if (!Number.isNaN(native.getTime())) return native;
    const parts = String(value)
      .split(/[\/-]/)
      .map((part) => parseInt(part, 10));
    if (parts.length >= 3 && parts.every((part) => !Number.isNaN(part))) {
      const [a, b, c] = parts;
      const year = c < 100 ? 2000 + c : c;
      const day = a > 12 ? a : b;
      const month = a > 12 ? b : a;
      return new Date(year, month - 1, day);
    }
    return new Date(0);
  };

  const getLastUsedText = (template: any) => {
    const templateNames = new Set(
      (template?.exercises || []).map((ex: any) => getExerciseName(ex)),
    );

    const match = history
      .filter((workout: any) => {
        if (workout.templateId && workout.templateId === template.id)
          return true;
        if (workout.workoutName === template.name) return true;

        const workoutNames = new Set(
          (workout.fullWorkoutData || []).map((ex: any) => ex?.name),
        );
        if (templateNames.size === 0 || workoutNames.size === 0) return false;
        let overlap = 0;
        templateNames.forEach((name) => {
          if (workoutNames.has(name)) overlap += 1;
        });
        return overlap >= Math.min(2, templateNames.size);
      })
      .sort(
        (a: any, b: any) =>
          parseWorkoutDate(b.date).getTime() -
          parseWorkoutDate(a.date).getTime(),
      )[0];

    if (!match) return "Never used";
    const date = parseWorkoutDate(match.date);
    if (date.getTime() === 0) return "Used before";
    const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000);
    if (diffDays <= 0) return "Last used today";
    if (diffDays === 1) return "Last used yesterday";
    return `Last used ${diffDays} days ago`;
  };

  const getTemplateById = (templateId?: string | null) => {
    if (!templateId) return null;
    return templates.find((template) => template.id === templateId) || null;
  };

  const openNewFolderModal = () => {
    setEditingFolderId(null);
    setFolderName("");
    setFolderCycleLength(7);
    setIsFolderModalVisible(true);
  };

  const openFolderOptions = (folder: TemplateFolder) => {
    setEditingFolderId(folder.id);
    setFolderName(folder.name);
    setFolderCycleLength(folder.cycleLength || 7);
    setIsFolderOptionsVisible(true);
  };

  const openEditFolderModal = () => {
    setIsFolderOptionsVisible(false);
    setTimeout(() => setIsFolderModalVisible(true), 300);
  };

  const openSplitModal = (folder: TemplateFolder | null = activeFolder) => {
    if (!folder) return;
    const normalized = normalizeFolder(folder);
    setEditingFolderId(normalized.id);
    setSplitCycleLength(normalized.cycleLength);
    setSplitDays(normalized.days);
    setIsFolderOptionsVisible(false);
    setTimeout(
      () => setIsSplitModalVisible(true),
      isFolderOptionsVisible ? 300 : 0,
    );
  };

  const changeSplitCycleLength = (delta: number) => {
    setSplitCycleLength((current) => {
      const next = clampCycleLength(current + delta);
      const templateIds = activeFolder?.templateIds || [];
      setSplitDays((days) => resizeSplitDays(days, next, templateIds));
      return next;
    });
  };

  const updateSplitDay = (dayNumber: number, nextTemplateId: string | null) => {
    setSplitDays((current) =>
      current.map((day) => {
        if (day.dayNumber !== dayNumber) return day;
        if (!nextTemplateId) return createRestDay(dayNumber);
        return { dayNumber, type: "template", templateId: nextTemplateId };
      }),
    );
  };

  const resetSplitStartDateToToday = async () => {
    if (!editingFolderId) return;
    Haptics.selectionAsync();
    const today = startOfLocalDay(Date.now());
    const nextFolders = folders.map((folder) => {
      if (folder.id !== editingFolderId) return folder;
      return normalizeFolder({
        ...folder,
        startDate: today,
        updatedAt: Date.now(),
      });
    });
    await saveFolders(nextFolders);
  };

  const saveSplitSchedule = async () => {
    if (!editingFolderId) return;
    const folderIndex = folders.findIndex(
      (folder) => folder.id === editingFolderId,
    );
    if (folderIndex === -1) return;

    const folder = folders[folderIndex];
    const nextFolder = normalizeFolder({
      ...folder,
      cycleLength: splitCycleLength,
      days: normalizeSplitDays(splitDays, splitCycleLength, folder.templateIds),
      updatedAt: Date.now(),
    });

    const nextFolders = [...folders];
    nextFolders[folderIndex] = nextFolder;
    await saveFolders(nextFolders);
    setIsSplitModalVisible(false);
  };

  const cleanFoldersAfterTemplateDelete = (
    folderList: TemplateFolder[],
    deletedIds: string[],
  ) => {
    const deletedSet = new Set(deletedIds);
    return folderList.map((folder) => {
      const templateIds = folder.templateIds.filter(
        (id) => !deletedSet.has(id),
      );
      const days = folder.days.map((day) => {
        if (
          day.type === "template" &&
          day.templateId &&
          deletedSet.has(day.templateId)
        ) {
          return createRestDay(day.dayNumber);
        }
        return day;
      });
      return normalizeFolder({
        ...folder,
        templateIds,
        days,
        updatedAt: Date.now(),
      });
    });
  };

  const deleteTemplatesByIds = async (ids: string[]) => {
    if (!uid || ids.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const idSet = new Set(ids);
    const updatedTemplates = templates.filter(
      (template) => !idSet.has(template.id),
    );
    const updatedFolders = cleanFoldersAfterTemplateDelete(folders, ids);

    await saveTemplates(updatedTemplates);
    await saveFolders(updatedFolders);

    setSelectedTemplate(null);
    setSelectedTemplateIds([]);
    setIsManageMode(false);
    setInfoAlert({
      visible: true,
      title: "Templates Deleted",
      message: `${ids.length} template${ids.length === 1 ? "" : "s"} removed. Any split days using them were changed to rest days.`,
    });
  };

  const toggleTemplateSelection = (templateId: string) => {
    Haptics.selectionAsync();
    setSelectedTemplateIds((current) =>
      current.includes(templateId)
        ? current.filter((id) => id !== templateId)
        : [...current, templateId],
    );
  };

  const selectAllVisible = () => {
    Haptics.selectionAsync();
    const visibleIds = displayedTemplates.map((template) => template.id);
    setSelectedTemplateIds((current) =>
      Array.from(new Set([...current, ...visibleIds])),
    );
  };

  const renderSplitScheduleCard = () => {
    if (!activeFolder || activeFolderId === "All") return null;

    const scheduledTemplateDays = activeFolder.days.filter(
      (day) => day.type === "template" && day.templateId,
    ).length;

    return (
      <View style={localStyles.splitCardCompact}>
        <View style={localStyles.splitCompactHeaderRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={localStyles.splitKicker}>TRAINING SPLIT</Text>
            <View style={localStyles.splitTitleRowCompact}>
              <Text style={localStyles.splitTitleCompact} numberOfLines={1}>
                {activeFolder.name}
              </Text>
              {activeFolder.id === activeSplitFolderId && (
                <View style={localStyles.activeSplitBadge}>
                  <Text style={localStyles.activeSplitBadgeText}>ACTIVE</Text>
                </View>
              )}
            </View>
            <Text style={localStyles.splitSubCompact}>
              {activeFolder.cycleLength}-day cycle • {scheduledTemplateDays}{" "}
              training day
              {scheduledTemplateDays === 1 ? "" : "s"}
            </Text>
          </View>
          <View style={localStyles.splitHeaderActions}>
            {activeFolder.id !== activeSplitFolderId && (
              <TouchableOpacity
                style={localStyles.setActiveSplitButtonCompact}
                onPress={() => setFolderAsActiveSplit(activeFolder)}
              >
                <Text style={localStyles.setActiveSplitButtonText}>
                  Set Active
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={localStyles.editSplitButtonCompact}
              onPress={() => openSplitModal(activeFolder)}
            >
              <Ionicons name="calendar-outline" size={15} color="#32D74B" />
              <Text style={localStyles.editSplitButtonText}>Edit</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={localStyles.splitTimelineContent}
        >
          {activeFolder.days.map((day) => {
            const template = getTemplateById(day.templateId);
            const isRest = day.type === "rest" || !template;
            return (
              <TouchableOpacity
                key={`${activeFolder.id}-${day.dayNumber}`}
                activeOpacity={isRest ? 1 : 0.82}
                style={[
                  localStyles.splitTimelineChip,
                  isRest
                    ? localStyles.splitTimelineChipRest
                    : localStyles.splitTimelineChipTraining,
                ]}
                onPress={() => {
                  if (!isRest) handleTemplatePress(template);
                }}
              >
                <Text style={localStyles.splitTimelineDay}>
                  D{day.dayNumber}
                </Text>
                <Text
                  style={[
                    localStyles.splitTimelineName,
                    isRest && localStyles.splitTimelineRestName,
                  ]}
                  numberOfLines={1}
                >
                  {isRest ? "Rest" : template.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
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
        onClose={() => setInfoAlert({ ...infoAlert, visible: false })}
      />

      <CustomAlert
        visible={startAlertVisible}
        title="Start Workout"
        message={`Starting: ${pendingStartTemplate?.name}?`}
        buttons={[
          { text: "Cancel", style: "cancel" },
          {
            text: "Start",
            onPress: async () => {
              if (uid)
                await AsyncStorage.setItem(`@last_search_filter_${uid}`, "All");
              navigation.navigate("Workout", {
                templateData: pendingStartTemplate,
              });
            },
          },
        ]}
        onClose={() => setStartAlertVisible(false)}
      />

      <CustomAlert
        visible={deleteAlertVisible}
        title="Delete Template?"
        message="This permanently removes the template and changes any split days using it into rest days."
        buttons={[
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              if (!selectedTemplate) return;
              await deleteTemplatesByIds([selectedTemplate.id]);
            },
          },
        ]}
        onClose={() => setDeleteAlertVisible(false)}
      />

      <CustomAlert
        visible={batchDeleteAlertVisible}
        title={`Delete ${selectedTemplateIds.length} Template${selectedTemplateIds.length === 1 ? "" : "s"}?`}
        message="This permanently removes the selected templates. Any split days using them will automatically become rest days."
        buttons={[
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              await deleteTemplatesByIds(selectedTemplateIds);
            },
          },
        ]}
        onClose={() => setBatchDeleteAlertVisible(false)}
      />

      <CustomAlert
        visible={deleteFolderAlertVisible}
        title="Delete Folder?"
        message="This deletes only the folder and its split schedule. Your templates will not be deleted."
        buttons={[
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              const newFolders = folders.filter(
                (f) => f.id !== editingFolderId,
              );
              saveFolders(newFolders);
              if (editingFolderId === activeSplitFolderId) {
                saveActiveSplitFolder(null);
              }
              setActiveFolderId("All");
            },
          },
        ]}
        onClose={() => setDeleteFolderAlertVisible(false)}
      />

      <Modal
        visible={isTemplateReorderModalVisible}
        transparent
        animationType="fade"
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <View style={styles.reorderModalContent}>
              <View style={styles.reorderModalHeader}>
                <View>
                  <Text style={styles.reorderModalKicker}>TEMPLATE ORDER</Text>
                  <Text style={styles.reorderModalTitle}>Reorder Templates</Text>
                  <Text style={styles.reorderModalSubtitle}>
                    Hold and drag rows into order.
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.reorderModalClose}
                  onPress={() => setIsTemplateReorderModalVisible(false)}
                >
                  <Ionicons name="close" size={22} color="#FFF" />
                </TouchableOpacity>
              </View>

              <DraggableFlatList
                data={templateReorderDraft}
                keyExtractor={(item: any, index: number) =>
                  String(item?.id || index)
                }
                style={{ maxHeight: 420 }}
                contentContainerStyle={{ paddingBottom: 6 }}
                activationDistance={0}
                animationConfig={TEMPLATE_REORDER_DRAG_ANIMATION_CONFIG}
                onDragBegin={() =>
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
                }
                onDragEnd={({ data }) => setTemplateReorderDraft(data)}
                renderItem={({ item, drag, isActive }) => {
                  const { exCount, totalSets } = getTemplateCounts(item);
                  return (
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
                          {item?.name || "Template"}
                        </Text>
                        <Text
                          style={styles.reorderExerciseSubtitle}
                          numberOfLines={1}
                        >
                          {exCount} exercises · {totalSets} sets
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />

              <View style={styles.reorderModalFooter}>
                <TouchableOpacity
                  style={styles.reorderCancelButton}
                  onPress={() => setIsTemplateReorderModalVisible(false)}
                >
                  <Text style={styles.reorderCancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.reorderDoneButton}
                  onPress={saveTemplateReorder}
                >
                  <Text style={styles.reorderDoneButtonText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </GestureHandlerRootView>
      </Modal>

      <Modal
        visible={!!detailTemplate}
        animationType="slide"
        transparent={false}
      >
        <View style={styles.screen}>
          <View
            style={[
              localStyles.detailHeader,
              { paddingTop: Math.max(insets.top, 12) },
            ]}
          >
            <View style={localStyles.detailHeaderContent}>
              <TouchableOpacity
                style={localStyles.detailHeaderButton}
                onPress={() => setDetailTemplate(null)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close" size={30} color="#FFF" />
              </TouchableOpacity>

              <View style={localStyles.detailHeaderTitleWrap}>
                <Text style={localStyles.detailHeaderTitle}>
                  Template Details
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  localStyles.detailHeaderButton,
                  localStyles.detailHeaderButtonRight,
                ]}
                onPress={() => {
                  const template = detailTemplate;
                  setDetailTemplate(null);
                  setTimeout(() => {
                    navigation.navigate("EditTemplate", {
                      templateData: template,
                    });
                  }, 250);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={localStyles.detailHeaderActionText}>Edit</Text>
              </TouchableOpacity>
            </View>
          </View>

          {detailTemplate && (
            <>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[
                  localStyles.detailScrollContent,
                  { paddingBottom: 132 + Math.max(insets.bottom, 10) },
                ]}
              >
                <View style={localStyles.detailHeroCard}>
                  <Text style={localStyles.detailKicker}>ROUTINE</Text>
                  <Text style={localStyles.detailTitle}>
                    {detailTemplate.name}
                  </Text>
                  <Text style={localStyles.detailSubtitle}>
                    {getTemplateCounts(detailTemplate).exCount} exercises •{" "}
                    {getTemplateCounts(detailTemplate).totalSets} sets
                  </Text>
                  <View style={localStyles.detailMetaPillRow}>
                    <View style={localStyles.detailMetaPill}>
                      <Ionicons name="barbell" size={15} color="#32D74B" />
                      <Text style={localStyles.detailMetaPillText}>
                        {getTemplateMuscleSummary(detailTemplate)}
                      </Text>
                    </View>
                    <View style={localStyles.detailMetaPill}>
                      <Ionicons name="time-outline" size={15} color="#32D74B" />
                      <Text style={localStyles.detailMetaPillText}>
                        {getLastUsedText(detailTemplate)}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={localStyles.detailSectionHeaderRow}>
                  <Text style={localStyles.detailSectionTitle}>Exercises</Text>
                  <Text style={localStyles.detailSectionCount}>
                    {(detailTemplate.exercises || []).length}
                  </Text>
                </View>

                {(detailTemplate.exercises || []).length === 0 ? (
                  <View style={localStyles.detailEmptyCard}>
                    <Text style={localStyles.detailEmptyTitle}>
                      No exercises added
                    </Text>
                    <Text style={localStyles.detailEmptyBody}>
                      Edit this template to add exercises.
                    </Text>
                  </View>
                ) : (
                  (() => {
                    const groups = getSupersetGroups(
                      detailTemplate.exercises || [],
                    );
                    const renderedGroupIds = new Set<string>();
                    return (detailTemplate.exercises || []).map(
                      (ex: any, index: number) => {
                        if (typeof ex !== "string" && ex.supersetId) {
                          const group = groups.find(
                            (candidate: any) => candidate.id === ex.supersetId,
                          );
                          if (!group || renderedGroupIds.has(group.id))
                            return null;
                          renderedGroupIds.add(group.id);
                          return (
                            <View
                              key={`superset-${group.id}`}
                              style={localStyles.detailExerciseCard}
                            >
                              <View style={localStyles.detailExerciseNumber}>
                                <Text
                                  style={localStyles.detailExerciseNumberText}
                                >
                                  {group.label}
                                </Text>
                              </View>
                              <View style={{ flex: 1, minWidth: 0 }}>
                                <Text
                                  style={localStyles.detailExerciseName}
                                  numberOfLines={1}
                                >
                                  SUPERSET {group.label}
                                </Text>
                                {group.exercises.map(
                                  (member: any, memberIndex: number) => (
                                    <Text
                                      key={`${member.name}-${memberIndex}`}
                                      style={localStyles.detailExerciseMeta}
                                      numberOfLines={1}
                                    >
                                      {group.label}
                                      {member.supersetOrder ||
                                        memberIndex + 1}{" "}
                                      {member.name}
                                    </Text>
                                  ),
                                )}
                              </View>
                            </View>
                          );
                        }

                        const exName = getExerciseName(ex);
                        const setCount =
                          typeof ex === "string"
                            ? 1
                            : Array.isArray(ex.sets)
                              ? ex.sets.length
                              : ex.sets || 1;
                        const variant =
                          typeof ex !== "string" &&
                          ex.exerciseVariant &&
                          ex.exerciseVariant !== "Normal"
                            ? ex.exerciseVariant
                            : null;
                        return (
                          <View
                            key={`${exName}-${index}`}
                            style={localStyles.detailExerciseCard}
                          >
                            <View style={localStyles.detailExerciseNumber}>
                              <Text
                                style={localStyles.detailExerciseNumberText}
                              >
                                {index + 1}
                              </Text>
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text
                                style={localStyles.detailExerciseName}
                                numberOfLines={2}
                              >
                                {variant ? `${exName} · ${variant}` : exName}
                              </Text>
                              <Text
                                style={localStyles.detailExerciseMeta}
                                numberOfLines={1}
                              >
                                {setCount} set{setCount === 1 ? "" : "s"}
                                {typeof ex !== "string" && ex.is_unilateral
                                  ? " • L/R"
                                  : ""}
                              </Text>
                            </View>
                          </View>
                        );
                      },
                    );
                  })()
                )}
              </ScrollView>

              <View
                style={[
                  localStyles.detailFooter,
                  { paddingBottom: Math.max(insets.bottom, 10) + 10 },
                ]}
              >
                <TouchableOpacity
                  style={localStyles.detailStartButton}
                  onPress={() => startTemplateFromDetail(detailTemplate)}
                  activeOpacity={0.86}
                >
                  <Text style={localStyles.detailStartText}>Start Workout</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>

      <Modal visible={isFolderOptionsVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsFolderOptionsVisible(false)}
        >
          <View style={styles.actionMenuContent}>
            <Text style={styles.actionMenuTitle}>{folderName}</Text>
            <TouchableOpacity
              style={styles.actionMenuBtn}
              onPress={openEditFolderModal}
            >
              <Text style={styles.actionMenuBtnText}>Edit Folder</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionMenuBtn}
              onPress={() =>
                openSplitModal(
                  folders.find((f) => f.id === editingFolderId) || null,
                )
              }
            >
              <Text style={styles.actionMenuBtnText}>Edit Training Split</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionMenuBtn}
              onPress={() =>
                setFolderAsActiveSplit(
                  folders.find((f) => f.id === editingFolderId) || null,
                )
              }
            >
              <Text style={styles.actionMenuBtnText}>
                {editingFolderId === activeSplitFolderId
                  ? "Active Split"
                  : "Set as Active Split"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionMenuBtn, styles.actionMenuBtnDestructive]}
              onPress={() => {
                setIsFolderOptionsVisible(false);
                setTimeout(() => setDeleteFolderAlertVisible(true), 400);
              }}
            >
              <Text style={styles.actionMenuBtnText}>Delete Folder</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionMenuBtnCancel}
              onPress={() => setIsFolderOptionsVisible(false)}
            >
              <Text style={styles.actionMenuBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={isFolderModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={[styles.modalOverlay, { justifyContent: "flex-end" }]}
        >
          <View style={[styles.modalContent, { marginBottom: 40 }]}>
            <Text style={styles.modalTitle}>
              {editingFolderId ? "Edit Folder" : "New Folder"}
            </Text>
            <TextInput
              style={styles.modalInput}
              value={folderName}
              onChangeText={setFolderName}
              placeholder="e.g., Current Split, PPL, Upper Lower"
              placeholderTextColor="#48484A"
              selectionColor="#FFF"
              autoFocus
            />

            <Text style={localStyles.modalLabel}>Cycle Length</Text>
            <View style={localStyles.cycleControlRow}>
              <TouchableOpacity
                style={localStyles.cycleButton}
                onPress={() =>
                  setFolderCycleLength((v) => clampCycleLength(v - 1))
                }
              >
                <Ionicons name="remove" size={20} color="#FFF" />
              </TouchableOpacity>
              <View style={localStyles.cycleValueBox}>
                <Text style={localStyles.cycleValue}>{folderCycleLength}</Text>
                <Text style={localStyles.cycleCaption}>days</Text>
              </View>
              <TouchableOpacity
                style={localStyles.cycleButton}
                onPress={() =>
                  setFolderCycleLength((v) => clampCycleLength(v + 1))
                }
              >
                <Ionicons name="add" size={20} color="#FFF" />
              </TouchableOpacity>
            </View>
            <Text style={localStyles.helperText}>
              Default is 7. You can use 2–9 days for upper/lower, PPL rest, or
              custom split cycles.
            </Text>

            <View style={styles.modalButtonRow}>
              <TouchableOpacity onPress={() => setIsFolderModalVisible(false)}>
                <Text style={styles.modalActionText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const finalName = folderName.trim();
                  if (!finalName) return;

                  const duplicate = folders.find(
                    (f) =>
                      f.name.toLowerCase() === finalName.toLowerCase() &&
                      f.id !== editingFolderId,
                  );
                  if (duplicate) {
                    Haptics.notificationAsync(
                      Haptics.NotificationFeedbackType.Warning,
                    );
                    Alert.alert(
                      "Name Taken",
                      "A folder with this name already exists.",
                    );
                    return;
                  }

                  Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Success,
                  );
                  if (editingFolderId) {
                    saveFolders(
                      folders.map((f) => {
                        if (f.id !== editingFolderId) return f;
                        return normalizeFolder({
                          ...f,
                          name: finalName,
                          cycleLength: folderCycleLength,
                          days: resizeSplitDays(
                            f.days,
                            folderCycleLength,
                            f.templateIds,
                          ),
                          updatedAt: Date.now(),
                        });
                      }),
                    );
                  } else {
                    const newFolder = normalizeFolder({
                      id: genId("fldr-"),
                      name: finalName,
                      templateIds: [],
                      cycleLength: folderCycleLength,
                      days: normalizeSplitDays([], folderCycleLength, []),
                      startDate: startOfLocalDay(Date.now()),
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    });
                    saveFolders([...folders, newFolder]);
                    setActiveFolderId(newFolder.id);
                    if (
                      folders.length === 0 ||
                      finalName.trim().toLowerCase() === "current split"
                    ) {
                      saveActiveSplitFolder(newFolder.id);
                    }
                  }
                  setIsFolderModalVisible(false);
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

      <Modal visible={isSplitModalVisible} transparent animationType="slide">
        <View style={styles.screen}>
          <View style={[styles.headerContainer, { paddingTop: insets.top }]}>
            <View style={localStyles.splitModalHeaderContent}>
              <TouchableOpacity
                style={localStyles.splitModalHeaderButtonLeft}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={() => setIsSplitModalVisible(false)}
              >
                <Ionicons name="close" size={30} color="#FFF" />
              </TouchableOpacity>
              <View style={localStyles.splitModalHeaderTitleWrap}>
                <Text style={styles.headerTitleStatic}>Edit Split</Text>
              </View>
              <TouchableOpacity
                style={localStyles.splitModalHeaderButtonRight}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={saveSplitSchedule}
              >
                <Text style={localStyles.headerSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={localStyles.splitModalContent}
          >
            <View style={localStyles.splitModalIntroCard}>
              <Text style={localStyles.splitKicker}>TRAINING CYCLE</Text>
              <Text style={localStyles.splitTitle}>
                {activeFolder?.name || "Folder"}
              </Text>
              <Text style={localStyles.splitSub}>
                Assign each day to a template or set it as a rest day.
              </Text>

              <View style={[localStyles.cycleControlRow, { marginTop: 16 }]}>
                <TouchableOpacity
                  style={localStyles.cycleButton}
                  onPress={() => changeSplitCycleLength(-1)}
                >
                  <Ionicons name="remove" size={20} color="#FFF" />
                </TouchableOpacity>
                <View style={localStyles.cycleValueBox}>
                  <Text style={localStyles.cycleValue}>{splitCycleLength}</Text>
                  <Text style={localStyles.cycleCaption}>days</Text>
                </View>
                <TouchableOpacity
                  style={localStyles.cycleButton}
                  onPress={() => changeSplitCycleLength(1)}
                >
                  <Ionicons name="add" size={20} color="#FFF" />
                </TouchableOpacity>
              </View>

              <View style={localStyles.splitStartRow}>
                <View style={{ flex: 1 }}>
                  <Text style={localStyles.splitStartLabel}>
                    Cycle start date
                  </Text>
                  <Text style={localStyles.splitStartValue}>
                    {formatSplitStartDate(
                      folders.find((f) => f.id === editingFolderId)?.startDate,
                    )}
                  </Text>
                </View>
                <TouchableOpacity
                  style={localStyles.splitStartButton}
                  onPress={resetSplitStartDateToToday}
                >
                  <Text style={localStyles.splitStartButtonText}>
                    Set Today
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {folderTemplates.length === 0 && (
              <View style={localStyles.emptyCard}>
                <View style={localStyles.emptyIcon}>
                  <Ionicons
                    name="folder-open-outline"
                    size={26}
                    color="#32D74B"
                  />
                </View>
                <Text style={localStyles.emptyTitle}>
                  No templates in this folder
                </Text>
                <Text style={localStyles.emptyBody}>
                  Add templates to this folder first, then assign them to split
                  days.
                </Text>
              </View>
            )}

            {splitDays.map((day) => (
              <View
                key={`split-edit-${day.dayNumber}`}
                style={localStyles.splitEditDayCard}
              >
                <View style={localStyles.splitEditDayHeader}>
                  <Text style={localStyles.splitEditDayNumber}>
                    D{day.dayNumber}
                  </Text>
                  <Text
                    style={localStyles.splitEditDayCurrent}
                    numberOfLines={1}
                  >
                    {day.type === "template"
                      ? getTemplateById(day.templateId)?.name ||
                        "Missing template"
                      : "Rest Day"}
                  </Text>
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <TouchableOpacity
                    style={[
                      localStyles.assignmentChip,
                      day.type === "rest" && localStyles.assignmentChipActive,
                    ]}
                    onPress={() => updateSplitDay(day.dayNumber, null)}
                  >
                    <Ionicons
                      name="moon-outline"
                      size={14}
                      color={day.type === "rest" ? "#000" : "#8E8E93"}
                      style={{ marginRight: 6 }}
                    />
                    <Text
                      style={[
                        localStyles.assignmentChipText,
                        day.type === "rest" &&
                          localStyles.assignmentChipTextActive,
                      ]}
                    >
                      Rest
                    </Text>
                  </TouchableOpacity>

                  {folderTemplates.map((template: any) => {
                    const active =
                      day.type === "template" && day.templateId === template.id;
                    return (
                      <TouchableOpacity
                        key={`${day.dayNumber}-${template.id}`}
                        style={[
                          localStyles.assignmentChip,
                          active && localStyles.assignmentChipActive,
                        ]}
                        onPress={() =>
                          updateSplitDay(day.dayNumber, template.id)
                        }
                      >
                        <Text
                          style={[
                            localStyles.assignmentChipText,
                            active && localStyles.assignmentChipTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {template.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={isMoveModalVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsMoveModalVisible(false)}
        >
          <View style={styles.actionMenuContent}>
            <Text style={styles.actionMenuTitle}>Add to Folder</Text>
            {folders.length === 0 ? (
              <Text
                style={{
                  color: "#8E8E93",
                  textAlign: "center",
                  marginVertical: 20,
                }}
              >
                Create a folder first to organize templates.
              </Text>
            ) : (
              folders.map((f) => (
                <TouchableOpacity
                  key={f.id}
                  style={styles.actionMenuBtn}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    const updatedFolders = folders.map((folder) => {
                      if (folder.id === f.id) {
                        if (
                          !folder.templateIds.includes(selectedTemplate?.id)
                        ) {
                          return normalizeFolder({
                            ...folder,
                            templateIds: [
                              ...folder.templateIds,
                              selectedTemplate?.id,
                            ],
                            updatedAt: Date.now(),
                          });
                        }
                      }
                      return folder;
                    });
                    saveFolders(updatedFolders);
                    setIsMoveModalVisible(false);
                    setInfoAlert({
                      visible: true,
                      title: "Added",
                      message: `Added to ${f.name}`,
                    });
                  }}
                >
                  <Text style={styles.actionMenuBtnText}>{f.name}</Text>
                </TouchableOpacity>
              ))
            )}
            <TouchableOpacity
              style={styles.actionMenuBtnCancel}
              onPress={() => setIsMoveModalVisible(false)}
            >
              <Text style={styles.actionMenuBtnTextCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={isBatchSelectVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsBatchSelectVisible(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={{
              backgroundColor: "#1C1C1E",
              borderRadius: 16,
              width: "90%",
              maxHeight: "80%",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                padding: 20,
                borderBottomWidth: 1,
                borderBottomColor: "#2C2C2E",
              }}
            >
              <TouchableOpacity onPress={() => setIsBatchSelectVisible(false)}>
                <Text
                  style={{ color: "#FF3B30", fontSize: 17, fontWeight: "600" }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
              <Text style={{ color: "#FFF", fontSize: 17, fontWeight: "700" }}>
                Folder Templates
              </Text>
              <TouchableOpacity
                onPress={() => {
                  Haptics.notificationAsync(
                    Haptics.NotificationFeedbackType.Success,
                  );
                  const updatedFolders = folders.map((f) => {
                    if (f.id !== activeFolderId) return f;
                    const days = f.days.map((day) => {
                      if (
                        day.type === "template" &&
                        day.templateId &&
                        !batchSelectIds.includes(day.templateId)
                      ) {
                        return createRestDay(day.dayNumber);
                      }
                      return day;
                    });
                    return normalizeFolder({
                      ...f,
                      templateIds: batchSelectIds,
                      days,
                      updatedAt: Date.now(),
                    });
                  });
                  saveFolders(updatedFolders);
                  setIsBatchSelectVisible(false);
                }}
              >
                <Text
                  style={{ color: "#32D74B", fontSize: 17, fontWeight: "700" }}
                >
                  Save
                </Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={templates}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 20 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => {
                const isSelected = batchSelectIds.includes(item.id);
                const { exCount, totalSets } = getTemplateCounts(item);

                return (
                  <TouchableOpacity
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      paddingVertical: 16,
                      borderBottomWidth: 1,
                      borderBottomColor: "#2C2C2E",
                    }}
                    onPress={() => {
                      Haptics.selectionAsync();
                      if (isSelected) {
                        setBatchSelectIds((prev) =>
                          prev.filter((id) => id !== item.id),
                        );
                      } else {
                        setBatchSelectIds((prev) => [...prev, item.id]);
                      }
                    }}
                  >
                    <Ionicons
                      name={isSelected ? "checkmark-circle" : "ellipse-outline"}
                      size={26}
                      color={isSelected ? "#32D74B" : "#8E8E93"}
                      style={{ marginRight: 16 }}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: "#FFF",
                          fontSize: 16,
                          fontWeight: "800",
                          marginBottom: 4,
                        }}
                      >
                        {item.name}
                      </Text>
                      <Text
                        style={{
                          color: "#8E8E93",
                          fontSize: 13,
                          fontWeight: "600",
                        }}
                      >
                        {exCount} Exercises • {totalSets} Sets
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text
                  style={{
                    color: "#8E8E93",
                    textAlign: "center",
                    marginTop: 20,
                    marginBottom: 20,
                  }}
                >
                  No templates available.
                </Text>
              }
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={isMenuVisible} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsMenuVisible(false)}
        >
          <View style={styles.actionMenuContent}>
            <Text style={styles.actionMenuTitle}>Template Options</Text>
            <TouchableOpacity
              style={styles.actionMenuBtn}
              onPress={() => {
                setIsMenuVisible(false);
                navigation.navigate("EditTemplate", {
                  templateData: selectedTemplate,
                });
              }}
            >
              <Text style={styles.actionMenuBtnText}>Edit Template</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionMenuBtn}
              onPress={() => {
                setIsMenuVisible(false);
                setTimeout(() => setIsMoveModalVisible(true), 400);
              }}
            >
              <Text style={styles.actionMenuBtnText}>Add to Folder</Text>
            </TouchableOpacity>

            {activeFolderId !== "All" && (
              <TouchableOpacity
                style={styles.actionMenuBtn}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  const updatedFolders = folders.map((f) => {
                    if (f.id !== activeFolderId) return f;
                    const days = f.days.map((day) => {
                      if (
                        day.type === "template" &&
                        day.templateId === selectedTemplate?.id
                      ) {
                        return createRestDay(day.dayNumber);
                      }
                      return day;
                    });
                    return normalizeFolder({
                      ...f,
                      templateIds: f.templateIds.filter(
                        (id: string) => id !== selectedTemplate?.id,
                      ),
                      days,
                      updatedAt: Date.now(),
                    });
                  });
                  saveFolders(updatedFolders);
                  setIsMenuVisible(false);
                }}
              >
                <Text style={[styles.actionMenuBtnText, { color: "#FF9F0A" }]}>
                  Remove from this Folder
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.actionMenuBtn, styles.actionMenuBtnDestructive]}
              onPress={() => {
                setIsMenuVisible(false);
                setTimeout(() => setDeleteAlertVisible(true), 400);
              }}
            >
              <Text style={styles.actionMenuBtnText}>
                Delete Template Permanently
              </Text>
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

      <SafeAreaView edges={["top"]} style={styles.headerContainer}>
        <View style={styles.headerContentFlex}>
          <View style={styles.headerSideBtn} />
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitleStatic}>
              {isManageMode
                ? `${selectedTemplateIds.length} selected`
                : "Templates"}
            </Text>
          </View>
          <View style={styles.headerRightActionGroup}>
            {isManageMode ? (
              <TouchableOpacity
                style={localStyles.manageTextButton}
                onPress={exitManageMode}
              >
                <Text style={localStyles.manageText}>Cancel</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.headerSideBtn} />
            )}
          </View>
        </View>
      </SafeAreaView>

      <View style={localStyles.searchWrap}>
        <Ionicons
          name="search"
          size={20}
          color="#8E8E93"
          style={{ marginRight: 8 }}
        />
        <TextInput
          style={localStyles.searchInput}
          placeholder="Search templates or exercises..."
          placeholderTextColor="#8E8E93"
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>

      <View style={localStyles.folderBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20 }}
        >
          <TouchableOpacity
            style={[
              localStyles.folderChip,
              activeFolderId === "All" && localStyles.folderChipActive,
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setActiveFolderId("All");
                      setSelectedTemplateIds([]);
            }}
          >
            <Text
              style={[
                localStyles.folderChipText,
                activeFolderId === "All" && localStyles.folderChipTextActive,
              ]}
            >
              All
            </Text>
          </TouchableOpacity>

          {folders.map((f) => (
            <TouchableOpacity
              key={f.id}
              style={[
                localStyles.folderChip,
                activeFolderId === f.id && localStyles.folderChipActive,
              ]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (activeFolderId === f.id && !isManageMode) {
                  openFolderOptions(f);
                } else {
                  setActiveFolderId(f.id);
                              setSelectedTemplateIds([]);
                }
              }}
            >
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  localStyles.folderChipText,
                  activeFolderId === f.id && localStyles.folderChipTextActive,
                ]}
              >
                {f.name}
              </Text>
              {activeFolderId === f.id && !isManageMode && (
                <Ionicons
                  name="chevron-down"
                  size={12}
                  color="#000"
                  style={{ marginLeft: 6, marginTop: 1 }}
                />
              )}
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={localStyles.newFolderChip}
            onPress={openNewFolderModal}
          >
            <Ionicons
              name="add"
              size={15}
              color="#32D74B"
              style={{ marginRight: 5 }}
            />
            <Text style={localStyles.newFolderChipText}>Folder</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <FlatList
        ref={listRef}
        data={displayedTemplates}
        keyExtractor={(item) => item?.id || Math.random().toString()}
        contentContainerStyle={[
          localStyles.listContent,
          isManageMode && selectedTemplateIds.length > 0
            ? localStyles.listContentWithBottomBar
            : localStyles.listContentCompact,
        ]}
        ListHeaderComponent={
          <View>
            {renderSplitScheduleCard()}

            {isManageMode && (
              <View style={localStyles.managePanel}>
                <View style={{ flex: 1 }}>
                  <Text style={localStyles.managePanelTitle}>
                    Manage Templates
                  </Text>
                  <Text style={localStyles.managePanelSub}>
                    Select templates to delete. Select All only selects visible
                    templates.
                  </Text>
                </View>
                <View style={localStyles.manageActionsRow}>
                  <TouchableOpacity
                    style={localStyles.manageChip}
                    onPress={selectAllVisible}
                  >
                    <Text style={localStyles.manageChipText}>Select All</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={localStyles.manageChip}
                    onPress={() => setSelectedTemplateIds([])}
                  >
                    <Text style={localStyles.manageChipText}>Clear</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {!isManageMode && activeFolderId === "All" && (
              <TouchableOpacity
                style={localStyles.createCard}
                activeOpacity={0.82}
                onPress={() =>
                  navigation.navigate("EditTemplate", {
                    folderId: null,
                  })
                }
              >
                <View style={localStyles.createIcon}>
                  <Ionicons name="add" size={24} color="#32D74B" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={localStyles.createKicker}>TEMPLATE</Text>
                  <Text style={localStyles.createTitle}>Create New Template</Text>
                  <Text style={localStyles.createSub}>
                    Build a reusable workout structure
                  </Text>
                </View>
              </TouchableOpacity>
            )}
          </View>
        }
        renderItem={({ item, index }) => {
          const { exCount, totalSets } = getTemplateCounts(item);
          const preview = getTemplatePreview(item);
          const muscleSummary = getTemplateMuscleSummary(item);
          const selected = selectedTemplateIds.includes(item.id);

          return (
            <View style={localStyles.templateRow}>
              <TouchableOpacity
                style={[
                  localStyles.templateCard,
                  selected && localStyles.templateCardSelected,
                ]}
                activeOpacity={0.86}
                onPress={() => openTemplateDetail(item)}
                onLongPress={openTemplateReorderModal}
                delayLongPress={260}
              >
                <View style={localStyles.templateTopRow}>
                  {isManageMode ? (
                    <View style={localStyles.selectionIconWrap}>
                      <Ionicons
                        name={selected ? "checkmark-circle" : "ellipse-outline"}
                        size={31}
                        color={selected ? "#32D74B" : "#8E8E93"}
                      />
                    </View>
                  ) : (
                    <View style={localStyles.templateIconBox}>
                      <Ionicons name="barbell" size={24} color="#8E8E93" />
                    </View>
                  )}

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={localStyles.templateKicker}>ROUTINE</Text>
                    <Text style={localStyles.templateTitle} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={localStyles.templateMeta}>
                      {exCount} exercises • {totalSets} sets
                    </Text>
                  </View>

                  {!isManageMode && (
                    <TouchableOpacity
                      style={localStyles.optionsButton}
                      onPress={() => {
                        setSelectedTemplate(item);
                        setIsMenuVisible(true);
                      }}
                    >
                      <Ionicons
                        name="ellipsis-horizontal"
                        size={24}
                        color="#8E8E93"
                      />
                    </TouchableOpacity>
                  )}
                </View>

                <View style={localStyles.templatePreviewBox}>
                  <Text style={localStyles.templateMuscles} numberOfLines={1}>
                    {muscleSummary}
                  </Text>
                  <Text style={localStyles.templatePreview} numberOfLines={2}>
                    {preview}
                  </Text>
                </View>

                {!isManageMode && (
                  <View style={localStyles.templateFooter}>
                    <Text style={localStyles.lastUsedText}>
                      {getLastUsedText(item)}
                    </Text>
                    <TouchableOpacity
                      style={localStyles.startButton}
                      onPress={() => handleTemplatePress(item)}
                    >
                      <Text style={localStyles.startButtonText}>Start</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={localStyles.emptyCard}>
            <View style={localStyles.emptyIcon}>
              <Ionicons name="clipboard-outline" size={26} color="#32D74B" />
            </View>
            <Text style={localStyles.emptyTitle}>
              {loading
                ? "Restoring routines..."
                : hasTemplateSearch
                  ? "No matching templates"
                  : activeFolderId === "All"
                    ? "No templates yet"
                    : "This folder is empty"}
            </Text>
            <Text style={localStyles.emptyBody}>
              {activeFolderId !== "All" && !hasTemplateSearch
                ? "Add existing templates from your library to organize this split."
                : "Build reusable routines so you can start your workouts faster and keep your training structure consistent."}
            </Text>

            {activeFolderId !== "All" &&
              !loading &&
              !hasTemplateSearch &&
              !isManageMode && (
                <View style={localStyles.emptyFolderActions}>
                  <TouchableOpacity
                    style={localStyles.emptyFolderPrimaryButton}
                    onPress={() => {
                      const currentFolder = folders.find(
                        (f) => f.id === activeFolderId,
                      );
                      setBatchSelectIds(
                        currentFolder ? currentFolder.templateIds : [],
                      );
                      setIsBatchSelectVisible(true);
                    }}
                  >
                    <Ionicons
                      name="folder-open-outline"
                      size={16}
                      color="#32D74B"
                      style={{ marginRight: 7 }}
                    />
                    <Text style={localStyles.emptyFolderPrimaryText}>
                      Add Existing
                    </Text>
                  </TouchableOpacity>

                </View>
              )}
          </View>
        }
        ListFooterComponent={
          <View>
            {activeFolderId !== "All" &&
            !loading &&
            !isManageMode &&
            !isSelectedFolderEmpty ? (
              <TouchableOpacity
                style={localStyles.folderAddTemplatesButton}
                onPress={() => {
                  const currentFolder = folders.find(
                    (f) => f.id === activeFolderId,
                  );
                  setBatchSelectIds(
                    currentFolder ? currentFolder.templateIds : [],
                  );
                  setIsBatchSelectVisible(true);
                }}
              >
                <Ionicons
                  name="folder-open-outline"
                  size={17}
                  color="#32D74B"
                  style={{ marginRight: 8 }}
                />
                <Text style={localStyles.folderAddTemplatesText}>
                  Add Templates to Folder
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
      />

      {isManageMode && selectedTemplateIds.length > 0 && (
        <SafeAreaView edges={["bottom"]} style={localStyles.manageBottomBar}>
          <TouchableOpacity
            style={localStyles.deleteSelectedButton}
            onPress={() => setBatchDeleteAlertVisible(true)}
          >
            <Ionicons
              name="trash-outline"
              size={18}
              color="#FFF"
              style={{ marginRight: 8 }}
            />
            <Text style={localStyles.deleteSelectedText}>
              Delete {selectedTemplateIds.length} Template
              {selectedTemplateIds.length === 1 ? "" : "s"}
            </Text>
          </TouchableOpacity>
        </SafeAreaView>
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
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
  manageTextButton: {
    minHeight: 36,
    paddingHorizontal: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  manageText: { color: "#32D74B", fontSize: 14, fontWeight: "900" },
  manageIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerSaveText: { color: "#32D74B", fontSize: 16, fontWeight: "900" },
  splitModalHeaderContent: {
    minHeight: 56,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  splitModalHeaderButtonLeft: {
    width: 84,
    minHeight: 56,
    alignItems: "flex-start",
    justifyContent: "center",
  },
  splitModalHeaderButtonRight: {
    width: 84,
    minHeight: 56,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  splitModalHeaderTitleWrap: {
    flex: 1,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 20,
    marginTop: 18,
    marginBottom: 14,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "#2C2C2E",
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, color: "#FFF", fontSize: 16, fontWeight: "600" },
  folderBar: { marginBottom: 14 },
  folderChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "#2C2C2E",
    marginRight: 10,
  },
  folderChipActive: { backgroundColor: "#FFF", borderColor: "#FFF" },
  folderChipText: {
    color: "#8E8E93",
    fontSize: 14,
    fontWeight: "900",
    maxWidth: 150,
  },
  folderChipTextActive: { color: "#000" },
  newFolderChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.3)",
    marginRight: 10,
  },
  newFolderChipText: { color: "#32D74B", fontSize: 14, fontWeight: "900" },
  listContent: { flexGrow: 1, paddingHorizontal: 20 },
  listContentCompact: { paddingBottom: 18 },
  listContentWithBottomBar: { paddingBottom: 132 },
  splitCardCompact: {
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "#2C2C2E",
    borderRadius: 22,
    padding: 16,
    marginBottom: 16,
  },
  splitCompactHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  splitTitleRowCompact: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
  },
  splitTitleCompact: {
    color: "#FFF",
    fontSize: 22,
    fontWeight: "900",
    flexShrink: 1,
    marginRight: 8,
  },
  activeSplitBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(50, 215, 75, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.3)",
  },
  activeSplitBadgeText: {
    color: "#32D74B",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  splitSubCompact: {
    color: "#8E8E93",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 5,
  },
  splitHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 12,
  },
  editSplitButtonCompact: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.28)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  setActiveSplitButtonCompact: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#2C2C2E",
    borderWidth: 1,
    borderColor: "#3A3A3C",
    marginRight: 8,
  },
  setActiveSplitButtonText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "900",
  },
  splitTimelineContent: { paddingRight: 2 },
  splitTimelineChip: {
    width: 96,
    minHeight: 62,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginRight: 10,
    borderWidth: 1,
  },
  splitTimelineChipRest: {
    backgroundColor: "#111112",
    borderColor: "#242426",
  },
  splitTimelineChipTraining: {
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    borderColor: "rgba(50, 215, 75, 0.28)",
  },
  splitTimelineDay: {
    color: "#32D74B",
    fontSize: 12,
    fontWeight: "900",
    marginBottom: 8,
  },
  splitTimelineName: { color: "#FFF", fontSize: 14, fontWeight: "900" },
  splitTimelineRestName: { color: "#8E8E93" },
  splitCard: {
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "#2C2C2E",
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
  },
  splitHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  splitKicker: {
    color: "#32D74B",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 5,
  },
  splitTitle: { color: "#FFF", fontSize: 22, fontWeight: "900" },
  splitSub: {
    color: "#8E8E93",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 5,
    lineHeight: 18,
  },
  editSplitButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.28)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 12,
  },
  editSplitButtonText: {
    color: "#32D74B",
    fontSize: 12,
    fontWeight: "900",
    marginLeft: 6,
  },
  splitDayGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4,
  },
  splitDayCard: {
    width: "31.6%",
    minHeight: 82,
    backgroundColor: "#111112",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.22)",
    padding: 10,
    margin: 4,
  },
  splitDayCardRest: { borderColor: "#242426", opacity: 0.85 },
  splitDayNumber: {
    color: "#32D74B",
    fontSize: 11,
    fontWeight: "900",
    marginBottom: 6,
  },
  splitDayName: { color: "#FFF", fontSize: 13, fontWeight: "900", flex: 1 },
  splitDayRestText: { color: "#8E8E93" },
  splitDayStartButton: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(50, 215, 75, 0.16)",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    marginTop: 8,
  },
  splitDayStartText: { color: "#32D74B", fontSize: 11, fontWeight: "900" },
  managePanel: {
    backgroundColor: "rgba(50, 215, 75, 0.08)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.25)",
    borderRadius: 22,
    padding: 16,
    marginBottom: 14,
  },
  managePanelTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 4,
  },
  managePanelSub: {
    color: "#8E8E93",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  manageActionsRow: { flexDirection: "row", marginTop: 12 },
  manageChip: {
    backgroundColor: "#2C2C2E",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
    marginRight: 8,
  },
  manageChipText: { color: "#FFF", fontSize: 12, fontWeight: "900" },
  createCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.32)",
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
  },
  createIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(50, 215, 75, 0.16)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  createKicker: {
    color: "#32D74B",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 4,
  },
  createTitle: { color: "#FFF", fontSize: 20, fontWeight: "900" },
  createSub: {
    color: "#8E8E93",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
  },
  reorderButton: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(50, 215, 75, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.3)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginBottom: 14,
  },
  reorderButtonText: {
    color: "#32D74B",
    fontWeight: "900",
    fontSize: 13,
    marginLeft: 6,
  },
  templateRow: { flexDirection: "row", alignItems: "center", marginBottom: 14 },
  templateCard: {
    flex: 1,
    backgroundColor: "#1C1C1E",
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2C2C2E",
  },
  templateCardSelected: {
    borderColor: "rgba(50, 215, 75, 0.8)",
    backgroundColor: "rgba(50, 215, 75, 0.08)",
  },
  templateTopRow: { flexDirection: "row", alignItems: "center" },
  templateIconBox: {
    width: 58,
    height: 58,
    borderRadius: 16,
    backgroundColor: "#2C2C2E",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  selectionIconWrap: {
    width: 58,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  templateKicker: {
    color: "#32D74B",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 4,
  },
  templateTitle: { color: "#FFF", fontSize: 22, fontWeight: "900" },
  templateMeta: {
    color: "#8E8E93",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },
  optionsButton: { padding: 8, marginLeft: 6 },
  templatePreviewBox: {
    backgroundColor: "#111112",
    borderRadius: 18,
    padding: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: "#242426",
  },
  templateMuscles: {
    color: "#32D74B",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  templatePreview: {
    color: "#D1D1D6",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  templateFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
  },
  lastUsedText: {
    color: "#8E8E93",
    fontSize: 12,
    fontWeight: "800",
    flex: 1,
    marginRight: 10,
  },
  startButton: {
    backgroundColor: "#32D74B",
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  startButtonText: { color: "#000", fontSize: 14, fontWeight: "900" },
  reorderControls: { marginLeft: 10, gap: 8 },
  reorderControlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1C1C1E",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyCard: {
    marginTop: 12,
    marginBottom: 16,
    backgroundColor: "#111112",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "#1C1C1E",
    alignItems: "center",
  },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "rgba(50, 215, 75, 0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    color: "#FFF",
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 8,
    textAlign: "center",
  },
  emptyBody: {
    color: "#8E8E93",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    textAlign: "center",
  },
  emptyFolderActions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  emptyFolderPrimaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.32)",
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    paddingVertical: 13,
  },
  emptyFolderPrimaryText: { color: "#32D74B", fontSize: 13, fontWeight: "900" },
  emptyFolderSecondaryButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#32D74B",
    paddingVertical: 13,
  },
  emptyFolderSecondaryText: { color: "#000", fontSize: 13, fontWeight: "900" },
  folderAddTemplatesButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.3)",
    padding: 16,
    borderRadius: 18,
    marginTop: 4,
    marginBottom: 34,
  },
  folderAddTemplatesText: { color: "#32D74B", fontWeight: "900", fontSize: 15 },
  modalLabel: {
    color: "#8E8E93",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 14,
    marginBottom: 10,
    textTransform: "uppercase",
  },
  cycleControlRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  cycleButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#2C2C2E",
    alignItems: "center",
    justifyContent: "center",
  },
  cycleValueBox: { width: 100, alignItems: "center" },
  cycleValue: { color: "#FFF", fontSize: 28, fontWeight: "900" },
  cycleCaption: {
    color: "#8E8E93",
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    marginTop: 2,
  },
  helperText: {
    color: "#8E8E93",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    textAlign: "center",
    marginTop: 12,
  },
  splitModalContent: { padding: 20, paddingBottom: 120 },
  splitModalIntroCard: {
    backgroundColor: "#1C1C1E",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#2C2C2E",
    marginBottom: 14,
  },
  splitEditDayCard: {
    backgroundColor: "#1C1C1E",
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: "#2C2C2E",
    marginBottom: 12,
  },
  splitEditDayHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  splitEditDayNumber: {
    color: "#32D74B",
    fontSize: 14,
    fontWeight: "900",
    width: 42,
  },
  splitEditDayCurrent: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "900",
    flex: 1,
  },
  assignmentChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#2C2C2E",
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
    marginRight: 8,
    maxWidth: 180,
  },
  assignmentChipActive: { backgroundColor: "#FFF" },
  assignmentChipText: { color: "#D1D1D6", fontSize: 13, fontWeight: "900" },
  assignmentChipTextActive: { color: "#000" },
  manageBottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.96)",
    borderTopWidth: 1,
    borderTopColor: "#1C1C1E",
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  deleteSelectedButton: {
    backgroundColor: "#FF3B30",
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  deleteSelectedText: { color: "#FFF", fontSize: 16, fontWeight: "900" },

  detailHeader: {
    backgroundColor: "#000",
    borderBottomWidth: 1,
    borderBottomColor: "#1C1C1E",
  },
  detailHeaderContent: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
  },
  detailHeaderButton: {
    width: 76,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "flex-start",
  },
  detailHeaderButtonRight: {
    alignItems: "flex-end",
  },
  detailHeaderTitleWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  detailHeaderTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  detailHeaderActionText: {
    color: "#32D74B",
    fontSize: 17,
    fontWeight: "900",
  },

  detailScrollContent: {
    padding: 20,
    paddingBottom: 120,
  },
  detailHeroCard: {
    backgroundColor: "#1C1C1E",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#2C2C2E",
    padding: 22,
    marginBottom: 22,
  },
  detailKicker: {
    color: "#32D74B",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 8,
  },
  detailTitle: {
    color: "#FFF",
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 38,
  },
  detailSubtitle: {
    color: "#8E8E93",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 8,
  },
  detailMetaPillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 18,
  },
  detailMetaPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: "rgba(50, 215, 75, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.25)",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  detailMetaPillText: {
    color: "#D1D1D6",
    fontSize: 12,
    fontWeight: "800",
    marginLeft: 6,
  },
  detailSectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  detailSectionTitle: {
    color: "#FFF",
    fontSize: 24,
    fontWeight: "900",
  },
  detailSectionCount: {
    color: "#32D74B",
    fontSize: 15,
    fontWeight: "900",
  },
  detailExerciseCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1C1C1E",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2C2C2E",
    padding: 16,
    marginBottom: 12,
  },
  detailExerciseNumber: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(50, 215, 75, 0.14)",
    marginRight: 12,
  },
  detailExerciseNumberText: {
    color: "#32D74B",
    fontSize: 14,
    fontWeight: "900",
  },
  detailExerciseName: {
    color: "#FFF",
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 22,
  },
  detailExerciseMeta: {
    color: "#8E8E93",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  detailEmptyCard: {
    backgroundColor: "#111112",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#242426",
    padding: 22,
    alignItems: "center",
  },
  detailEmptyTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 6,
  },
  detailEmptyBody: {
    color: "#8E8E93",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  detailFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.96)",
    borderTopWidth: 1,
    borderTopColor: "#1C1C1E",
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  detailStartButton: {
    backgroundColor: "#32D74B",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 17,
  },
  detailStartText: {
    color: "#000",
    fontSize: 18,
    fontWeight: "900",
  },

  splitStartRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 18,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  splitStartLabel: {
    color: "#8E8E93",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.7,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  splitStartValue: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "900",
  },
  splitStartButton: {
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(50,215,75,0.14)",
    borderWidth: 1,
    borderColor: "rgba(50,215,75,0.28)",
  },
  splitStartButtonText: {
    color: "#32D74B",
    fontSize: 12,
    fontWeight: "900",
  },
});
