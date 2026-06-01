import React, { useEffect, useMemo, useState } from "react";
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
import { Colors, Spacing, Radius, Layout, Typography } from "../theme";
import { INITIAL_EXERCISES, MUSCLE_GROUPS } from "../constants/data";
import {
  prepareSections,
  fetchGitHubExercises,
  normalizeExerciseImageUrl,
  getExerciseVariationOptions,
} from "../utils/helpers";
import {
  syncFavoriteExercisesToCloud,
  syncPersonalExercisesToCloud,
} from "../utils/firebaseSync";
import CustomAlert from "../components/CustomAlert";

export default function SearchScreen({ navigation, route }: any) {
  const [globalExercises, setGlobalExercises] = useState<any[]>([]);
  const [personalExercises, setPersonalExercises] = useState<any[]>([]);
  const [favoriteExerciseNames, setFavoriteExerciseNames] = useState<string[]>([]);
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

  const [searchAlert, setSearchAlert] = useState({
    visible: false,
    exercise: null as any,
  });

  const uid = auth.currentUser?.uid;
  const existingExercises: string[] = route.params?.existingExercises || [];

  useEffect(() => {
    const loadData = async () => {
      if (!uid) return;
      setIsFetchingAPI(true);

      const cachedGlobal = await AsyncStorage.getItem(
        "@github_global_exercises",
      );
      if (cachedGlobal) {
        setGlobalExercises(JSON.parse(cachedGlobal));
        setIsFetchingAPI(false);
      }

      try {
        const fetchedData = await fetchGitHubExercises();
        if (fetchedData && fetchedData.length > 0) {
          setGlobalExercises(fetchedData);
          await AsyncStorage.setItem(
            "@github_global_exercises",
            JSON.stringify(fetchedData),
          );
        } else if (!cachedGlobal) {
          setGlobalExercises(INITIAL_EXERCISES);
        }
      } catch (error) {
        console.log("Silent background sync failed, relying on cache.");
        if (!cachedGlobal) setGlobalExercises(INITIAL_EXERCISES);
      } finally {
        setIsFetchingAPI(false);
      }

      const saved = await AsyncStorage.getItem(`@user_exercises_${uid}`);
      if (saved) {
        const parsedAll = JSON.parse(saved);
        setPersonalExercises(
          parsedAll.filter((e: any) => e.is_custom === true),
        );
      }

      const savedFavorites = await AsyncStorage.getItem(
        `@favorite_exercises_${uid}`,
      );
      const savedHistory = await AsyncStorage.getItem(`@workout_history_${uid}`);
      const savedFilter = await AsyncStorage.getItem(
        `@last_search_filter_${uid}`,
      );
      if (savedFavorites) {
        const parsedFavorites = JSON.parse(savedFavorites);
        setFavoriteExerciseNames(
          Array.isArray(parsedFavorites) ? parsedFavorites.map(String) : [],
        );
      }
      if (savedHistory) {
        const parsedHistory = JSON.parse(savedHistory);
        setHistory(Array.isArray(parsedHistory) ? parsedHistory : []);
      }
      if (savedFilter) setActiveFilter(savedFilter);
    };

    loadData();
  }, [uid]);

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

  const getExerciseMatchKey = (exercise: any) => normalizeExerciseName(exercise?.name);

  const isExerciseFavorite = (exercise: any) =>
    favoriteExerciseNames.includes(getExerciseKey(exercise));

  const saveFavoriteExerciseNames = async (nextFavorites: string[]) => {
    if (!uid) return;
    const cleaned = Array.from(
      new Set(nextFavorites.map((name) => String(name).trim()).filter(Boolean)),
    );
    setFavoriteExerciseNames(cleaned);
    await AsyncStorage.setItem(
      `@favorite_exercises_${uid}`,
      JSON.stringify(cleaned),
    );
    await syncFavoriteExercisesToCloud(cleaned);
  };

  const toggleFavoriteExercise = async (exercise: any) => {
    const key = getExerciseKey(exercise);
    if (!key) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextFavorites = favoriteExerciseNames.includes(key)
      ? favoriteExerciseNames.filter((name) => name !== key)
      : [...favoriteExerciseNames, key];
    await saveFavoriteExerciseNames(nextFavorites);
  };

  const parseWorkoutDate = (value: any) => {
    if (!value) return new Date(0);
    if (typeof value === "number") return new Date(value);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
  };

  const handleExerciseSelection = async (selectedEx: any) => {
    if (!uid) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    route.params.onSelect(selectedEx);
    navigation.goBack();
  };

  const saveCustomExercise = async () => {
    const trimmed = newName.trim();
    if (!uid || !trimmed) return;

    const created = {
      name: trimmed,
      muscle: newMuscle,
      reminder: newReminder.trim(),
      is_unilateral: newIsUnilateral,
      supportsVariants: newSupportsVariants,
      is_custom: true,
    };

    const updatedPersonal = [...personalExercises, created];
    setPersonalExercises(updatedPersonal);
    await AsyncStorage.setItem(
      `@user_exercises_${uid}`,
      JSON.stringify([...globalExercises, ...updatedPersonal]),
    );
    await syncPersonalExercisesToCloud(updatedPersonal);
    setIsAddVisible(false);
    setNewName("");
    setNewReminder("");
    setNewIsUnilateral(false);
    setNewSupportsVariants(false);
    route.params.onSelect(created);
    navigation.goBack();
  };

  const unifiedExercises = useMemo(() => {
    const byName = new Map<string, any>();

    globalExercises.forEach((exercise) => {
      const key = getExerciseMatchKey(exercise);
      if (key) byName.set(key, { ...exercise, is_custom: false, source: "builtin" });
    });

    personalExercises.forEach((exercise) => {
      const key = getExerciseMatchKey(exercise);
      if (!key) return;

      const matchingBuiltin = byName.get(key);
      if (matchingBuiltin) {
        // Older versions let users copy Global exercises into Personal Library.
        // In the unified library, those should fold back into the built-in row,
        // not appear as duplicated Custom exercises.
        byName.set(key, {
          ...exercise,
          ...matchingBuiltin,
          is_custom: false,
          source: "builtin",
          has_personal_copy: true,
        });
        return;
      }

      byName.set(key, { ...exercise, is_custom: true, source: "custom" });
    });

    return Array.from(byName.values()).sort((a, b) =>
      String(a.name || "").localeCompare(String(b.name || "")),
    );
  }, [globalExercises, personalExercises]);

  const recentExerciseNames = useMemo(() => {
    const seen = new Set<string>();
    return [...history]
      .sort(
        (a, b) =>
          parseWorkoutDate(b.date).getTime() - parseWorkoutDate(a.date).getTime(),
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
      return unifiedExercises.filter((exercise) => isExerciseFavorite(exercise));
    }
    if (libraryView === "Recent") {
      const order = new Map<string, number>(
        recentExerciseNames.map((name, index) => [name, index]),
      );
      return unifiedExercises
        .filter((exercise) => order.has(getExerciseKey(exercise)))
        .sort(
          (a, b) =>
            (order.get(getExerciseKey(a)) ?? 9999) -
            (order.get(getExerciseKey(b)) ?? 9999),
        );
    }
    if (libraryView === "Custom") {
      return unifiedExercises.filter((exercise) => exercise.is_custom === true);
    }
    return unifiedExercises;
  }, [favoriteExerciseNames, libraryView, recentExerciseNames, unifiedExercises]);

  const searchedExercises = useMemo(() => {
    let filtered = displayedExercises;
    if (activeFilter !== "All") {
      filtered = filtered.filter((ex) => ex && ex.muscle === activeFilter);
    }
    if (searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().split(" ").filter(Boolean);
      filtered = filtered.filter((ex) => {
        const searchable =
          `${ex?.name || ""} ${ex?.equipment || ""} ${ex?.muscle || ""}`.toLowerCase();
        return terms.every((term) => searchable.includes(term));
      });
    }
    return filtered;
  }, [displayedExercises, activeFilter, searchQuery]);

  const sections = useMemo(
    () => prepareSections(searchedExercises, "All"),
    [searchedExercises],
  );

  const selectedCount = existingExercises.length;

  return (
    <View style={localStyles.screen}>
      <CustomAlert
        visible={searchAlert.visible}
        title="Create Custom Exercise?"
        message={`Add ${searchAlert.exercise?.name} as a custom exercise in your exercise library?`}
        buttons={[
          { text: "Cancel", style: "cancel" },
          {
            text: "Add",
            onPress: async () => {
              if (searchAlert.exercise && uid) {
                const exerciseToAdd = {
                  ...searchAlert.exercise,
                  is_custom: true,
                };
                const updatedPersonal = [...personalExercises, exerciseToAdd];
                setPersonalExercises(updatedPersonal);
                await AsyncStorage.setItem(
                  `@user_exercises_${uid}`,
                  JSON.stringify([...globalExercises, ...updatedPersonal]),
                );
                await syncPersonalExercisesToCloud(updatedPersonal);
                route.params.onSelect(exerciseToAdd);
                navigation.goBack();
              }
            },
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
            <Text style={styles.headerTitleStatic}>Add Exercise</Text>
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
            onPress={() => setIsAddVisible(false)}
          />

          <View style={localStyles.createModalCard}>
            <View style={localStyles.createModalHandle} />
            <View style={localStyles.createModalHeader}>
              <View>
                <Text style={localStyles.createModalTitle}>
                  Create Exercise
                </Text>
                <Text style={localStyles.createModalSubtitle}>
                  Add a custom movement to your exercise library.
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
                onChangeText={setNewName}
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
                onChangeText={setNewReminder}
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
                onPress={() => setIsAddVisible(false)}
              >
                <Text style={localStyles.createCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  localStyles.createSaveButton,
                  !newName.trim() && localStyles.createSaveButtonDisabled,
                ]}
                disabled={!newName.trim()}
                onPress={saveCustomExercise}
              >
                <Text style={localStyles.createSaveText}>Save Exercise</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
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
            placeholder="Search exercises..."
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
                if (uid)
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

        {libraryView === "Custom" && (
          <TouchableOpacity
            style={localStyles.createExerciseCard}
            activeOpacity={0.84}
            onPress={() => {
              setNewMuscle(activeFilter === "All" ? "Chest" : activeFilter);
              setIsAddVisible(true);
            }}
          >
            <View style={localStyles.createExerciseIcon}>
              <Ionicons name="add" size={22} color={Colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={localStyles.createExerciseKicker}>CUSTOM EXERCISE</Text>
              <Text style={localStyles.createExerciseTitle}>Create Custom Exercise</Text>
              <Text style={localStyles.createExerciseSub}>Add a movement that is not in the library</Text>
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
          contentContainerStyle={localStyles.listContent}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{title}</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const isAlreadyAdded = existingExercises.includes(item.name);
            const isFavorite = isExerciseFavorite(item);
            const imageUri = normalizeExerciseImageUrl(item.image);
            const hasVariationOptions =
              getExerciseVariationOptions(item).length > 0;

            return (
              <TouchableOpacity
                style={[
                  localStyles.exerciseCard,
                  isAlreadyAdded && localStyles.exerciseCardDisabled,
                ]}
                activeOpacity={0.84}
                disabled={isAlreadyAdded}
                onPress={() => handleExerciseSelection(item)}
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

                <View style={localStyles.exerciseTextBlock}>
                  <Text style={localStyles.exerciseKicker}>
                    {formatLibraryLabel(item.muscle)}{item.is_custom ? " · Custom" : ""}
                  </Text>
                  <Text style={localStyles.exerciseTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={localStyles.exerciseMeta} numberOfLines={1}>
                    {item.equipment ? `${formatLibraryLabel(item.equipment)} · ` : ""}
                    {item.is_custom ? "Custom" : hasVariationOptions ? "Supports variants" : "Tap to add"}
                  </Text>
                </View>

                <TouchableOpacity
                  style={localStyles.favoriteButton}
                  onPress={() => toggleFavoriteExercise(item)}
                >
                  <Ionicons
                    name={isFavorite ? "star" : "star-outline"}
                    size={20}
                    color={isFavorite ? Colors.accent : Colors.textMuted}
                  />
                </TouchableOpacity>

                <View
                  style={[
                    localStyles.addIndicator,
                    isAlreadyAdded && localStyles.addIndicatorDone,
                  ]}
                >
                  {isAlreadyAdded ? (
                    <Ionicons
                      name="checkmark"
                      size={20}
                      color={Colors.textMuted}
                    />
                  ) : (
                    <Ionicons name="add" size={22} color={Colors.accent} />
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={localStyles.emptyState}>
              <Ionicons name="search" size={28} color={Colors.textMuted} />
              <Text style={localStyles.emptyTitle}>
                {libraryView === "Favorites"
                  ? "No favorites yet"
                  : libraryView === "Recent"
                    ? "No recent exercises yet"
                    : libraryView === "Custom"
                      ? "No custom exercises yet"
                      : "No exercises found"}
              </Text>
              <Text style={localStyles.emptyBody}>
                {libraryView === "Favorites"
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
  sectionTitle: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.7,
    marginBottom: 12,
    marginTop: 8,
  },
  exerciseCard: {
    minHeight: 100,
    borderRadius: 24,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  exerciseCardDisabled: { opacity: 0.48 },
  exerciseImage: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: Colors.border,
    marginRight: 14,
  },
  exerciseImageFallback: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  exerciseTextBlock: { flex: 1, minWidth: 0, paddingRight: 10 },
  exerciseKicker: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  exerciseTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 5,
  },
  exerciseMeta: { color: Colors.textMuted, fontSize: 14, fontWeight: "700" },
  favoriteButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  addIndicator: {
    minWidth: 48,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(50,215,75,0.14)",
    borderWidth: 1,
    borderColor: "rgba(50,215,75,0.35)",
    paddingHorizontal: 12,
  },
  addIndicatorDone: {
    backgroundColor: "transparent",
    borderColor: Colors.borderStrong,
  },
  addIndicatorText: { color: Colors.accent, fontSize: 14, fontWeight: "900" },
  loadingState: { flex: 1, alignItems: "center", justifyContent: "center" },
  mutedText: {
    color: Colors.textMuted,
    marginTop: 12,
    fontSize: 15,
    fontWeight: "700",
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
