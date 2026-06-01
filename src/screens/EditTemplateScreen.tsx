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
  formatExerciseDisplayName,
  isFirstInSuperset,
  getSupersetInfo,
  assignSuperset,
  removeSupersetFromExercise,
  buildReorderBlocks,
  flattenReorderBlocks,
} from "../utils/helpers";
import {
  syncTemplatesToCloud,
  syncFoldersToCloud,
} from "../utils/firebaseSync";
import CustomAlert from "../components/CustomAlert";


const serializeTemplateDraft = (templateName: string, exercises: any[]) => {
  return JSON.stringify({
    name: (templateName || "").trim(),
    exercises: (exercises || []).map((ex: any) => ({
      name: ex?.name || "",
      reminder: ex?.reminder || "",
      exerciseVariant: ex?.exerciseVariant || "Normal",
      variationOptions: ex?.variationOptions || null,
      is_unilateral: !!ex?.is_unilateral,
      warmupSets: Number(ex?.warmupSets || 0),
      workingSets: Number(ex?.workingSets || 0),
      supersetId: ex?.supersetId || null,
      supersetOrder: ex?.supersetOrder || null,
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
  const [discardAlert, setDiscardAlert] = useState<{ visible: boolean; action: any | null }>({
    visible: false,
    action: null,
  });
  const allowTemplateLeaveRef = useRef(false);

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
    if (!route.params?.templateData) return;
    setName(route.params.templateData.name || "Edit Template");
    const mappedEx = (route.params.templateData.exercises || []).map(
      (ex: any, idx: number) => {
        if (typeof ex === "string") {
          return {
            id: genId(`ex-${idx}-`),
            name: ex,
            warmupSets: 0,
            workingSets: 1,
            is_unilateral: false,
          };
        }

        let warmups = 0;
        let workings = 1;
        if (Array.isArray(ex.sets)) {
          warmups = ex.sets.filter((s: any) => s.isWarmup).length;
          workings = ex.sets.filter((s: any) => !s.isWarmup).length;
        } else {
          workings = ex.sets || 1;
        }

        return {
          ...ex,
          id: ex.id || genId(`ex-${idx}-`),
          exerciseVariant: ex.exerciseVariant || "Normal",
          is_unilateral: !!ex.is_unilateral,
          warmupSets: warmups,
          workingSets: workings,
          supersetId: ex.supersetId || null,
          supersetOrder: ex.supersetOrder,
        };
      },
    );
    setSelected(mappedEx);
    setEditingId(route.params.templateData.id);
    setInitialDraftSnapshot(
      serializeTemplateDraft(route.params.templateData.name || "Edit Template", mappedEx),
    );
  }, [route.params]);

  useEffect(() => {
    if (route.params?.templateData) return;
    setInitialDraftSnapshot(serializeTemplateDraft("New Template", []));
  }, [route.params?.templateData]);

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

  const save = async () => {
    if (selected.length === 0) {
      showInfo(
        "Empty Template",
        "Please add at least one exercise before saving.",
      );
      return;
    }
    if (!uid) return;

    const raw = await AsyncStorage.getItem(`@workout_templates_${uid}`);
    const list = raw ? JSON.parse(raw).filter((t: any) => t) : [];
    const finalName = name.trim() || "New Template";
    const isDuplicate = list.some(
      (t: any) =>
        t.name.trim().toLowerCase() === finalName.toLowerCase() &&
        t.id !== editingId,
    );

    if (isDuplicate) {
      showInfo(
        "Name Taken",
        `A template named "${finalName}" already exists. Please choose a different name.`,
      );
      return;
    }

    const exercisesToSave = selected.map((ex) => {
      const generatedSets = [
        ...Array.from({ length: ex.warmupSets || 0 }).map(() => ({
          isWarmup: true,
        })),
        ...Array.from({ length: ex.workingSets || 0 }).map(() => ({
          isWarmup: false,
        })),
      ];
      if (generatedSets.length === 0) generatedSets.push({ isWarmup: false });
      return {
        id: ex.id || genId("ex-"),
        name: ex.name || "Exercise",
        reminder: ex.reminder || "",
        exerciseVariant: ex.exerciseVariant || "Normal",
        variationOptions: ex.variationOptions,
        is_unilateral: !!ex.is_unilateral,
        supersetId: ex.supersetId || null,
        supersetOrder: ex.supersetOrder,
        sets: generatedSets,
      };
    });

    let updatedTemplates;
    if (editingId) {
      updatedTemplates = list.map((t: any) =>
        t.id === editingId
          ? { ...t, name: finalName, exercises: exercisesToSave }
          : t,
      );
    } else {
      const newTemplateId = genId("tpl-");
      updatedTemplates = [
        ...list,
        {
          id: newTemplateId,
          name: finalName,
          exercises: exercisesToSave,
          createdAt: Date.now(),
        },
      ];
      if (route.params?.folderId) {
        const fRaw = await AsyncStorage.getItem(`@workout_folders_${uid}`);
        if (fRaw) {
          const storedFolders = JSON.parse(fRaw);
          const fIndex = storedFolders.findIndex(
            (f: any) => f.id === route.params.folderId,
          );
          if (fIndex !== -1) {
            const currentIds = storedFolders[fIndex].templateIds || [];
            storedFolders[fIndex].templateIds = Array.from(
              new Set([...currentIds, newTemplateId]),
            );
            await AsyncStorage.setItem(
              `@workout_folders_${uid}`,
              JSON.stringify(storedFolders),
            );
            try {
              await syncFoldersToCloud(storedFolders);
            } catch (e) {
              console.log("Failed to sync folder update", e);
            }
          }
        }
      }
    }

    await AsyncStorage.setItem(
      `@workout_templates_${uid}`,
      JSON.stringify(updatedTemplates),
    );
    try {
      await syncTemplatesToCloud(updatedTemplates);
    } catch (e) {
      console.log("Cloud routine backup delayed.", e);
    }
    setInitialDraftSnapshot(serializeTemplateDraft(finalName, selected));
    allowTemplateLeaveRef.current = true;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSuccessAlertVisible(true);
  };

  const updateWorkingSets = (index: number, change: number) => {
    setSelected((prev) => {
      const up = [...prev];
      up[index] = {
        ...up[index],
        workingSets: Math.max(0, (up[index].workingSets || 0) + change),
      };
      return up;
    });
  };

  const updateWarmupSets = (index: number, change: number) => {
    setSelected((prev) => {
      const up = [...prev];
      up[index] = {
        ...up[index],
        warmupSets: Math.max(0, (up[index].warmupSets || 0) + change),
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

              {getExerciseVariationOptions(ex).length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingTop: 10 }}
                >
                  {getExerciseVariationOptions(ex).map((variant) => {
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
            </View>

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
              onPress={() =>
                setSelected((prev) => prev.filter((_, idx) => idx !== i))
              }
              style={{ paddingHorizontal: 4, paddingVertical: 4 }}
            >
              <Ionicons name="trash-outline" size={22} color="#FF3B30" />
            </TouchableOpacity>
          </View>

          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 15,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text
                style={{
                  color: "#FFD700",
                  fontSize: 16,
                  fontWeight: "600",
                  width: 110,
                }}
              >
                Warm-ups: {ex.warmupSets || 0}
              </Text>
              <TouchableOpacity
                style={styles.moveBtn}
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
              <TouchableOpacity
                style={styles.moveBtn}
                onPress={() => updateWarmupSets(i, 1)}
              >
                <Text style={styles.moveBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text
                style={{
                  color: "#8E8E93",
                  fontSize: 16,
                  fontWeight: "600",
                  width: 110,
                }}
              >
                Working: {ex.workingSets ?? 1}
              </Text>
              <TouchableOpacity
                style={styles.moveBtn}
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
              <TouchableOpacity
                style={styles.moveBtn}
                onPress={() => updateWorkingSets(i, 1)}
              >
                <Text style={styles.moveBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
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
          { text: "Discard", style: "destructive", onPress: discardTemplateChanges },
        ]}
        onClose={() => setDiscardAlert((prev) => ({ ...prev, visible: false }))}
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
              onChangeText={setName}
              selectTextOnFocus
              textAlign="center"
              selectionColor="#FFF"
            />
          </View>
          <View style={styles.headerRightActionGroup}>
            <TouchableOpacity style={styles.headerSideBtn} onPress={save}>
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
            onPress={() =>
              navigation.navigate("Search", {
                existingExercises: selected.map((e) => e.name),
                onSelect: (exData: any) =>
                  setSelected((prev) => [
                    ...prev,
                    {
                      id: genId("ex-"),
                      name: exData.name,
                      reminder: exData.reminder,
                      exerciseVariant:
                        getExerciseVariationOptions(exData).length > 0
                          ? "Normal"
                          : undefined,
                      variationOptions: getExerciseVariationOptions(exData),
                      is_unilateral: !!exData.is_unilateral,
                      warmupSets: 0,
                      workingSets: 1,
                    },
                  ]),
              })
            }
          >
            <Text style={styles.addExerciseText}>+ Add Exercise</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
