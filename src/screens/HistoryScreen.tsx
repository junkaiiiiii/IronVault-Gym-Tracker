import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { doc, deleteDoc } from "firebase/firestore";

import { auth, db } from "../config/firebaseConfig";
import {
  getLocalWorkoutHistory,
  syncWorkoutHistoryWithCloud,
} from "../utils/firebaseSync";
import { styles } from "../constants/globalStyles";
import { Colors } from "../theme";
import {
  buildHistoricalWorkoutPRMap,
  getUniquePRExerciseCount,
} from "../utils/performance";

type GymOption = {
  id: string;
  name: string;
};

type WorkoutSection = {
  title: string;
  data: any[];
};

type HistoryFilter = "ALL" | "WEEK" | "MONTH";

const startOfLocalDay = (value: number) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const getWeekStart = (timestamp: number) => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date.getTime();
};

const getMonthStart = (timestamp: number) => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
};

const addMonths = (timestamp: number, amount: number) => {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth() + amount, 1).getTime();
};

const formatMonthLabel = (timestamp: number) => {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
};

const parseDurationToSeconds = (duration: any): number => {
  if (typeof duration === "number" && Number.isFinite(duration)) {
    return Math.max(0, duration);
  }

  if (typeof duration !== "string") return 0;

  const value = duration.trim().toLowerCase();
  if (!value) return 0;

  if (/^\d+(\.\d+)?$/.test(value)) return Math.max(0, Number(value));

  if (value.includes(":")) {
    const parts = value
      .split(":")
      .map((part) => Number(part.trim()))
      .filter((part) => Number.isFinite(part));

    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }

  const hours = Number(value.match(/(\d+(?:\.\d+)?)\s*h/)?.[1] || 0);
  const minutes = Number(value.match(/(\d+(?:\.\d+)?)\s*m/)?.[1] || 0);
  const seconds = Number(value.match(/(\d+(?:\.\d+)?)\s*s/)?.[1] || 0);

  return Math.max(0, Math.round(hours * 3600 + minutes * 60 + seconds));
};

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";

  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
};

const formatCompactNumber = (value: number) => {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value)}`;
};

const getWorkoutTimestamp = (workout: any): number => {
  const startedAt = Number(workout?.startedAt);
  if (Number.isFinite(startedAt) && startedAt > 0) return startedAt;

  const idTime = Number(workout?.id);
  if (Number.isFinite(idTime) && idTime > 100000000000) return idTime;

  const parsedDate = Date.parse(workout?.date || "");
  if (Number.isFinite(parsedDate)) return parsedDate;

  return 0;
};

const formatWorkoutDate = (workout: any): string => {
  const timestamp = getWorkoutTimestamp(workout);
  if (!timestamp) return workout?.date || "Unknown Date";

  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const getSectionTitle = (workout: any): string => {
  const timestamp = getWorkoutTimestamp(workout);
  if (!timestamp) return "Unknown Date";

  const today = startOfLocalDay(Date.now());
  const workoutDay = startOfLocalDay(timestamp);
  if (workoutDay === today) return "Today";
  if (workoutDay === today - 24 * 60 * 60 * 1000) return "Yesterday";

  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const convertVolume = (workout: any, displayKg: boolean): number => {
  const rawVolume = Number(workout?.volume || 0);
  if (!Number.isFinite(rawVolume)) return 0;

  if (displayKg && workout?.isKg === false) return rawVolume / 2.20462;
  if (!displayKg && workout?.isKg === true) return rawVolume * 2.20462;
  return rawVolume;
};

const getCompletedSets = (workout: any): number => {
  let count = 0;

  workout?.fullWorkoutData?.forEach((exercise: any) => {
    exercise?.sets?.forEach((set: any) => {
      if (set?.completed && !set?.isWarmup) count += 1;
    });
  });

  return count;
};

const getExerciseCount = (workout: any): number => {
  return (
    workout?.fullWorkoutData?.filter((exercise: any) =>
      exercise?.sets?.some((set: any) => set?.completed && !set?.isWarmup),
    ).length || 0
  );
};

const getBestSetForExercise = (exercise: any, unit: string): string | null => {
  let bestSet: any = null;
  let bestScore = -1;

  exercise?.sets?.forEach((set: any) => {
    if (!set?.completed || set?.isWarmup) return;

    const weight = Number(set.weight || 0);
    const reps = exercise?.is_unilateral
      ? Math.max(Number(set.repsL || 0), Number(set.repsR || 0))
      : Number(set.reps || 0);

    const score = weight * 1000 + reps;
    if (score > bestScore) {
      bestScore = score;
      bestSet = set;
    }
  });

  if (!bestSet) return null;

  if (exercise?.is_unilateral) {
    return `${bestSet.weight}${unit} × ${bestSet.repsL || 0}/${bestSet.repsR || 0}`;
  }

  return `${bestSet.weight}${unit} × ${bestSet.reps || 0}`;
};

const getTopExerciseLines = (workout: any, limit = 2) => {
  const unit = workout?.isKg ? "kg" : "lbs";

  return (
    workout?.fullWorkoutData
      ?.map((exercise: any) => {
        const bestSet = getBestSetForExercise(exercise, unit);
        return bestSet
          ? {
              name: exercise.name,
              bestSet,
              completedSets:
                exercise?.sets?.filter(
                  (set: any) => set?.completed && !set?.isWarmup,
                ).length || 0,
            }
          : null;
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.completedSets - a.completedSets)
      .slice(0, limit) || []
  );
};

const hasRemark = (workout: any) => {
  return workout?.fullWorkoutData?.some(
    (exercise: any) => exercise?.remark && exercise.remark.trim().length > 0,
  );
};

const HISTORY_FILTERS: { label: string; value: HistoryFilter }[] = [
  { label: "All", value: "ALL" },
  { label: "Week", value: "WEEK" },
  { label: "Month", value: "MONTH" },
];

export default function HistoryScreen({ navigation }: any) {
  const [history, setHistory] = useState<any[]>([]);
  const [gyms, setGyms] = useState<GymOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedGymId, setSelectedGymId] = useState<string>("ALL");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("ALL");
  const [selectedMonthStart, setSelectedMonthStart] = useState(() =>
    getMonthStart(Date.now()),
  );
  const [loading, setLoading] = useState(false);
  const [isGlobalKg, setIsGlobalKg] = useState(false);

  const listRef = useRef<SectionList<any, WorkoutSection>>(null);
  const pendingScrollToTopRef = useRef(false);
  const uid = auth.currentUser?.uid;

  const load = async () => {
    if (!uid) return;
    setLoading(true);

    try {
      const pref = await AsyncStorage.getItem(`@user_metric_${uid}`);
      setIsGlobalKg(pref === "KG");

      const savedGyms = await AsyncStorage.getItem(`@user_gyms_${uid}`);
      setGyms(savedGyms ? JSON.parse(savedGyms) : []);

      await syncWorkoutHistoryWithCloud();

      const mergedData = await getLocalWorkoutHistory(uid);
      setHistory(
        mergedData
          .filter((workout: any) => workout && workout.id)
          .sort(
            (a: any, b: any) => getWorkoutTimestamp(b) - getWorkoutTimestamp(a),
          ),
      );
    } catch (error) {
      console.error("Failed to sync history with cloud:", error);

      const savedGyms = await AsyncStorage.getItem(`@user_gyms_${uid}`);
      setGyms(savedGyms ? JSON.parse(savedGyms) : []);

      const saved = await AsyncStorage.getItem(`@workout_history_${uid}`);
      const localData = saved
        ? JSON.parse(saved).filter((workout: any) => workout && workout.id)
        : [];

      setHistory(
        localData.sort(
          (a: any, b: any) => getWorkoutTimestamp(b) - getWorkoutTimestamp(a),
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const dateFilteredHistory = useMemo(() => {
    if (historyFilter === "ALL") return history;

    const now = Date.now();

    if (historyFilter === "WEEK") {
      const cutoff = getWeekStart(now);
      return history.filter(
        (workout) => getWorkoutTimestamp(workout) >= cutoff,
      );
    }

    const monthStart = selectedMonthStart;
    const nextMonthStart = addMonths(monthStart, 1);
    return history.filter((workout) => {
      const timestamp = getWorkoutTimestamp(workout);
      return timestamp >= monthStart && timestamp < nextMonthStart;
    });
  }, [history, historyFilter, selectedMonthStart]);

  const gymFilteredHistory = useMemo(() => {
    if (selectedGymId === "ALL") return dateFilteredHistory;
    if (selectedGymId === "NONE") {
      return dateFilteredHistory.filter((workout) => !workout.gymId);
    }
    return dateFilteredHistory.filter(
      (workout) => String(workout.gymId || "") === String(selectedGymId),
    );
  }, [dateFilteredHistory, selectedGymId]);

  const visibleHistory = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return gymFilteredHistory;

    return gymFilteredHistory.filter((workout) => {
      const workoutName = workout?.workoutName?.toLowerCase() || "";
      const currentGymName =
        gyms.find((gym) => String(gym.id) === String(workout?.gymId))?.name ||
        workout?.gymName ||
        "";
      const gymName = currentGymName.toLowerCase();
      const exerciseMatch = workout?.fullWorkoutData?.some((exercise: any) =>
        exercise?.name?.toLowerCase().includes(query),
      );

      return (
        workoutName.includes(query) || gymName.includes(query) || exerciseMatch
      );
    });
  }, [gymFilteredHistory, searchQuery, gyms]);

  const activeMonthLabel = useMemo(
    () => formatMonthLabel(selectedMonthStart),
    [selectedMonthStart],
  );

  const canGoNextMonth = useMemo(() => {
    return addMonths(selectedMonthStart, 1) <= getMonthStart(Date.now());
  }, [selectedMonthStart]);

  const handleMonthStep = useCallback((amount: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedMonthStart((current) => {
      const next = addMonths(current, amount);
      const currentMonth = getMonthStart(Date.now());
      return Math.min(next, currentMonth);
    });
  }, []);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    selectedGymId !== "ALL" ||
    historyFilter !== "ALL";

  const clearHistoryFilters = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSearchQuery("");
    setSelectedGymId("ALL");
    setHistoryFilter("ALL");
    setSelectedMonthStart(getMonthStart(Date.now()));
  }, []);

  const gymOptions = useMemo(() => {
    const map = new Map<string, string>();
    gyms.forEach((gym) => {
      if (gym?.id) map.set(String(gym.id), gym.name || "Unnamed Gym");
    });

    history.forEach((workout) => {
      if (workout?.gymId) {
        map.set(
          String(workout.gymId),
          map.get(String(workout.gymId)) || workout.gymName || "Unknown Gym",
        );
      }
    });

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [gyms, history]);

  const workoutPRMap = useMemo(() => {
    return buildHistoricalWorkoutPRMap(history, { isKg: isGlobalKg });
  }, [history, isGlobalKg]);

  const getWorkoutPRs = useCallback(
    (workout: any) => {
      const saved = Array.isArray(workout?.prs) ? workout.prs : [];
      if (saved.length > 0) return saved;
      return workoutPRMap[String(workout?.id || "")] || [];
    },
    [workoutPRMap],
  );

  const sections = useMemo<WorkoutSection[]>(() => {
    const grouped = new Map<string, any[]>();

    visibleHistory.forEach((workout) => {
      const title = getSectionTitle(workout);
      if (!grouped.has(title)) grouped.set(title, []);
      grouped.get(title)?.push(workout);
    });

    return Array.from(grouped.entries()).map(([title, data]) => ({
      title,
      data,
    }));
  }, [visibleHistory]);

  const scrollToTop = useCallback((animated = false) => {
    requestAnimationFrame(() => {
      const ref: any = listRef.current;
      if (!ref) return;

      if (typeof ref.scrollToOffset === "function") {
        ref.scrollToOffset({ offset: 0, animated });
        return;
      }

      ref.getScrollResponder?.()?.scrollTo?.({ y: 0, animated });
    });
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      pendingScrollToTopRef.current = true;
      scrollToTop(false);
      load();
    });

    return unsubscribe;
  }, [navigation, uid, scrollToTop]);

  useEffect(() => {
    if (!pendingScrollToTopRef.current || loading) return;

    scrollToTop(false);
    pendingScrollToTopRef.current = false;
  }, [sections, loading, scrollToTop]);

  const deleteWorkout = async (workout: any) => {
    if (!uid) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const updatedHistory = history.filter(
      (item) => item && item.id && String(item.id) !== String(workout?.id),
    );

    setHistory(updatedHistory);
    await AsyncStorage.setItem(
      `@workout_history_${uid}`,
      JSON.stringify(updatedHistory),
    );

    try {
      const workoutRef = doc(db, "users", uid, "workouts", String(workout?.id));
      await deleteDoc(workoutRef);
    } catch (error) {
      console.error("Failed to delete workout from cloud:", error);
    }
  };

  const renderHistoryFilters = () => (
    <View style={localStyles.historyFilterRow}>
      {HISTORY_FILTERS.map((filter) => {
        const active = historyFilter === filter.value;
        return (
          <TouchableOpacity
            key={filter.value}
            style={[
              localStyles.historyFilterChip,
              active && localStyles.historyFilterChipActive,
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setHistoryFilter(filter.value);
            }}
          >
            <Text
              style={[
                localStyles.historyFilterChipText,
                active && localStyles.historyFilterChipTextActive,
              ]}
            >
              {filter.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderMonthSelector = () => {
    if (historyFilter !== "MONTH") return null;

    return (
      <View style={localStyles.monthSelectorCard}>
        <TouchableOpacity
          style={localStyles.monthNavButton}
          activeOpacity={0.8}
          onPress={() => handleMonthStep(-1)}
        >
          <Ionicons name="chevron-back" size={18} color={Colors.text} />
        </TouchableOpacity>

        <View style={localStyles.monthSelectorCenter}>
          <Text style={localStyles.monthSelectorLabel}>{activeMonthLabel}</Text>
          <Text style={localStyles.monthSelectorHint}>Workout log month</Text>
        </View>

        <TouchableOpacity
          style={[
            localStyles.monthNavButton,
            !canGoNextMonth && localStyles.monthNavButtonDisabled,
          ]}
          activeOpacity={0.8}
          disabled={!canGoNextMonth}
          onPress={() => handleMonthStep(1)}
        >
          <Ionicons
            name="chevron-forward"
            size={18}
            color={canGoNextMonth ? Colors.text : Colors.textMuted}
          />
        </TouchableOpacity>
      </View>
    );
  };

  const renderGymFilters = () => (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={localStyles.gymChipContent}
    >
      <TouchableOpacity
        style={[
          localStyles.filterChip,
          selectedGymId === "ALL" && localStyles.activeFilterChip,
        ]}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setSelectedGymId("ALL");
        }}
      >
        <Text
          style={[
            localStyles.filterChipText,
            selectedGymId === "ALL" && localStyles.activeFilterChipText,
          ]}
        >
          All Gyms
        </Text>
      </TouchableOpacity>

      {gymOptions.map((gym) => {
        const active = selectedGymId === gym.id;
        return (
          <TouchableOpacity
            key={gym.id}
            style={[
              localStyles.filterChip,
              active && localStyles.activeFilterChip,
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setSelectedGymId(gym.id);
            }}
          >
            <Text
              style={[
                localStyles.filterChipText,
                active && localStyles.activeFilterChipText,
              ]}
              numberOfLines={1}
            >
              {gym.name}
            </Text>
          </TouchableOpacity>
        );
      })}

      {history.some((workout) => !workout?.gymId) && (
        <TouchableOpacity
          style={[
            localStyles.filterChip,
            selectedGymId === "NONE" && localStyles.activeFilterChip,
          ]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setSelectedGymId("NONE");
          }}
        >
          <Text
            style={[
              localStyles.filterChipText,
              selectedGymId === "NONE" && localStyles.activeFilterChipText,
            ]}
          >
            No Gym
          </Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );

  const renderProgressEntryCard = () => (
    <TouchableOpacity
      style={localStyles.progressEntryCard}
      activeOpacity={0.86}
      onPress={() => navigation.navigate("ProgressStats")}
    >
      <View style={localStyles.progressEntryIcon}>
        <Ionicons name="analytics-outline" size={22} color={Colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={localStyles.progressEntryTitle}>
          Progress & Statistics
        </Text>
        <Text style={localStyles.progressEntrySubtitle} numberOfLines={2}>
          View training summary, trends, volume, and consistency.
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
    </TouchableOpacity>
  );

  const renderHeader = () => (
    <View style={localStyles.headerWrapper}>
      <Text style={localStyles.eyebrow}>Training Journal</Text>
      <Text style={localStyles.screenTitle}>History</Text>
      <Text style={localStyles.subtitle}>
        Review completed sessions and search your workout log.
      </Text>

      {renderProgressEntryCard()}

      <View style={localStyles.logHeaderRow}>
        <View>
          <Text style={localStyles.sectionLabel}>Workout History</Text>
          <Text style={localStyles.logSubtitle}>
            {visibleHistory.length}{" "}
            {visibleHistory.length === 1 ? "session" : "sessions"}
          </Text>
        </View>
      </View>

      <View style={localStyles.searchContainer}>
        <Ionicons
          name="search"
          size={18}
          color={Colors.textMuted}
          style={{ marginRight: 8 }}
        />
        <TextInput
          style={localStyles.searchInput}
          placeholder="Search workouts, exercises, or gyms..."
          placeholderTextColor={Colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
          selectionColor={Colors.accent}
        />
      </View>

      {renderHistoryFilters()}
      {renderMonthSelector()}

      <View style={localStyles.filterHeaderRow}>
        <Text style={localStyles.filterTitle}>Gym</Text>
        <Text style={localStyles.resultCount}>
          {selectedGymId === "ALL"
            ? "All gyms"
            : selectedGymId === "NONE"
              ? "No gym"
              : gymOptions.find((gym) => gym.id === selectedGymId)?.name ||
                "Selected gym"}
        </Text>
      </View>

      {renderGymFilters()}
    </View>
  );

  const renderWorkoutCard = ({ item }: { item: any }) => {
    const topExercises = getTopExerciseLines(item, 2);
    const totalExercises = getExerciseCount(item);
    const completedSets = getCompletedSets(item);
    const convertedVolume = convertVolume(item, isGlobalKg);
    const durationText = formatDuration(parseDurationToSeconds(item.duration));
    const gymName =
      item.gymName || gyms.find((gym) => gym.id === item.gymId)?.name || null;
    const workoutPRs = getWorkoutPRs(item);
    const workoutPRExerciseCount = getUniquePRExerciseCount(workoutPRs);

    return (
      <TouchableOpacity
        style={localStyles.card}
        activeOpacity={0.85}
        onPress={() => navigation.navigate("Workout", { editData: item })}
        onLongPress={() => {
          Alert.alert("Delete Workout", "Remove this session permanently?", [
            { text: "Cancel", style: "cancel" },
            {
              text: "Delete",
              style: "destructive",
              onPress: () => deleteWorkout(item),
            },
          ]);
        }}
      >
        <View style={localStyles.cardTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={localStyles.cardTitle} numberOfLines={1}>
              {item.workoutName || "Unnamed Workout"}
            </Text>
            <Text style={localStyles.cardMeta} numberOfLines={1}>
              {[
                gymName,
                durationText,
                `${totalExercises} ${totalExercises === 1 ? "exercise" : "exercises"}`,
                `${completedSets} ${completedSets === 1 ? "set" : "sets"}`,
              ]
                .filter(Boolean)
                .join(" • ")}
            </Text>
          </View>

          <View style={localStyles.cardAction}>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={Colors.textMuted}
            />
          </View>
        </View>

        <View style={localStyles.metricRow}>
          <View style={localStyles.metricItem}>
            <Text style={localStyles.metricValue}>
              {formatCompactNumber(convertedVolume)}
            </Text>
            <Text style={localStyles.metricLabel}>
              {isGlobalKg ? "kg" : "lbs"}
            </Text>
          </View>
          <View style={localStyles.metricDivider} />
          <View style={localStyles.metricItem}>
            <Text style={localStyles.metricValue}>{completedSets}</Text>
            <Text style={localStyles.metricLabel}>Sets</Text>
          </View>
          <View style={localStyles.metricDivider} />
          <View style={localStyles.metricItem}>
            <Text style={localStyles.metricValue}>{durationText}</Text>
            <Text style={localStyles.metricLabel}>Time</Text>
          </View>
        </View>

        {topExercises.length > 0 && (
          <View style={localStyles.exercisePreviewBlock}>
            {topExercises.map((exercise: any) => (
              <View
                key={`${item.id}-${exercise.name}`}
                style={localStyles.exerciseLine}
              >
                <Text style={localStyles.exerciseName} numberOfLines={1}>
                  {exercise.name}
                </Text>
                <Text style={localStyles.exerciseSet} numberOfLines={1}>
                  {exercise.bestSet}
                </Text>
              </View>
            ))}

            {totalExercises > topExercises.length && (
              <Text style={localStyles.moreExercisesText}>
                +{totalExercises - topExercises.length} more exercises
              </Text>
            )}
          </View>
        )}

        <View style={localStyles.cardFooter}>
          <View style={localStyles.footerBadge}>
            <Ionicons
              name="calendar-outline"
              size={12}
              color={Colors.textMuted}
            />
            <Text style={localStyles.footerBadgeText}>
              {formatWorkoutDate(item)}
            </Text>
          </View>

          {(workoutPRExerciseCount > 0 || item.prType) && (
            <View style={localStyles.footerBadge}>
              <Ionicons
                name="barbell-outline"
                size={12}
                color={Colors.accent}
              />
              <Text
                style={[localStyles.footerBadgeText, { color: Colors.accent }]}
              >
                {workoutPRExerciseCount > 0
                  ? `${workoutPRExerciseCount} PR${workoutPRExerciseCount === 1 ? "" : "s"}`
                  : item.prType}
              </Text>
            </View>
          )}

          {hasRemark(item) && (
            <View style={localStyles.footerBadge}>
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={12}
                color={Colors.accent}
              />
              <Text
                style={[localStyles.footerBadgeText, { color: Colors.accent }]}
              >
                Notes
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const getEmptyStateCopy = () => {
    if (loading) {
      return {
        icon: "sync-outline" as keyof typeof Ionicons.glyphMap,
        title: "Syncing history...",
        subtitle: "Merging your local and cloud workout history.",
        showClear: false,
      };
    }

    if (history.length === 0) {
      return {
        icon: "journal-outline" as keyof typeof Ionicons.glyphMap,
        title: "No workouts yet",
        subtitle:
          "Complete your first workout to start building your training history.",
        showClear: false,
      };
    }

    if (
      searchQuery.trim() &&
      (selectedGymId !== "ALL" || historyFilter !== "ALL")
    ) {
      return {
        icon: "search-outline" as keyof typeof Ionicons.glyphMap,
        title: "No workouts found",
        subtitle: "Try clearing your search or changing your filters.",
        showClear: true,
      };
    }

    if (searchQuery.trim()) {
      return {
        icon: "search-outline" as keyof typeof Ionicons.glyphMap,
        title: "No matching workouts",
        subtitle: "Try searching by workout name, exercise, or gym.",
        showClear: true,
      };
    }

    if (selectedGymId !== "ALL") {
      return {
        icon: "location-outline" as keyof typeof Ionicons.glyphMap,
        title:
          selectedGymId === "NONE"
            ? "No workouts without a gym"
            : "No workouts at this gym",
        subtitle: "Try selecting another gym or clearing the filter.",
        showClear: true,
      };
    }

    if (historyFilter === "WEEK") {
      return {
        icon: "calendar-outline" as keyof typeof Ionicons.glyphMap,
        title: "No workouts this week",
        subtitle: "Your completed workouts for this week will appear here.",
        showClear: true,
      };
    }

    if (historyFilter === "MONTH") {
      return {
        icon: "calendar-outline" as keyof typeof Ionicons.glyphMap,
        title: `No workouts in ${activeMonthLabel}`,
        subtitle:
          "Use the month selector to view another month, or clear the filter.",
        showClear: true,
      };
    }

    return {
      icon: "journal-outline" as keyof typeof Ionicons.glyphMap,
      title: "No workouts logged yet",
      subtitle:
        "Completed workouts will appear here with duration, volume, sets, and exercise highlights.",
      showClear: false,
    };
  };

  const emptyStateCopy = getEmptyStateCopy();

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={["top"]} style={styles.headerContainer}>
        <View style={styles.headerContentFlex}>
          <View style={styles.headerSideBtn} />
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitleStatic}>History</Text>
          </View>
          <View style={styles.headerSideBtn} />
        </View>
      </SafeAreaView>

      <SectionList
        ref={listRef}
        sections={sections}
        keyExtractor={(item) => String(item.id)}
        ListHeaderComponent={renderHeader()}
        stickySectionHeadersEnabled={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={localStyles.listContent}
        renderSectionHeader={({ section }) => (
          <Text style={localStyles.monthHeader}>{section.title}</Text>
        )}
        renderItem={renderWorkoutCard}
        ListEmptyComponent={
          <View style={localStyles.emptyState}>
            <View style={localStyles.emptyIcon}>
              <Ionicons
                name={emptyStateCopy.icon}
                size={30}
                color={Colors.textMuted}
              />
            </View>
            <Text style={localStyles.emptyTitle}>{emptyStateCopy.title}</Text>
            <Text style={localStyles.emptySubtitle}>
              {emptyStateCopy.subtitle}
            </Text>

            {emptyStateCopy.showClear && hasActiveFilters && (
              <TouchableOpacity
                style={localStyles.clearFiltersButton}
                activeOpacity={0.84}
                onPress={clearHistoryFilters}
              >
                <Text style={localStyles.clearFiltersText}>Clear Filters</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />
    </View>
  );
}

const localStyles = StyleSheet.create({
  listContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
  },
  headerWrapper: {
    paddingBottom: 2,
  },
  eyebrow: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  screenTitle: {
    color: Colors.text,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -1,
    marginBottom: 6,
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600",
    marginBottom: 18,
  },
  progressEntryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(50, 215, 75, 0.10)",
    borderRadius: 22,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "rgba(50, 215, 75, 0.30)",
  },
  progressEntryIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: "rgba(50, 215, 75, 0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  progressEntryTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 4,
  },
  progressEntrySubtitle: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  logHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionLabel: {
    color: Colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  logSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 3,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    fontWeight: "600",
    height: "100%",
  },
  historyFilterRow: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 4,
    marginBottom: 14,
  },
  historyFilterChip: {
    flex: 1,
    alignItems: "center",
    borderRadius: 11,
    paddingVertical: 9,
  },
  historyFilterChipActive: {
    backgroundColor: Colors.accent,
  },
  historyFilterChipText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  historyFilterChipTextActive: {
    color: Colors.background,
  },
  monthSelectorCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  monthNavButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  monthNavButtonDisabled: {
    opacity: 0.42,
  },
  monthSelectorCenter: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  monthSelectorLabel: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  monthSelectorHint: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  filterHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  filterTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "900",
  },
  resultCount: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    maxWidth: 180,
  },
  gymChipContent: {
    paddingRight: 20,
    paddingBottom: 12,
  },
  filterChip: {
    backgroundColor: Colors.card,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 9,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 164,
  },
  activeFilterChip: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  filterChipText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  activeFilterChipText: {
    color: Colors.background,
  },
  monthHeader: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 8,
    marginBottom: 10,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  cardTitle: {
    color: Colors.text,
    fontSize: 19,
    fontWeight: "900",
    marginBottom: 4,
  },
  cardMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  cardAction: {
    width: 30,
    alignItems: "flex-end",
  },
  metricRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 14,
  },
  metricItem: {
    flex: 1,
    alignItems: "center",
  },
  metricValue: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 3,
  },
  metricLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metricDivider: {
    width: 1,
    height: 28,
    backgroundColor: Colors.border,
  },
  exercisePreviewBlock: {
    marginBottom: 12,
  },
  exerciseLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
  },
  exerciseName: {
    flex: 1,
    color: "#E5E5EA",
    fontSize: 13,
    fontWeight: "800",
    marginRight: 10,
  },
  exerciseSet: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
  },
  moreExercisesText: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "900",
    marginTop: 4,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  footerBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  footerBadgeText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    marginLeft: 5,
  },
  emptyState: {
    alignItems: "center",
    paddingTop: 48,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: Colors.card,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    textAlign: "center",
  },
  clearFiltersButton: {
    marginTop: 18,
    backgroundColor: Colors.accent,
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  clearFiltersText: {
    color: Colors.background,
    fontSize: 13,
    fontWeight: "900",
  },
});
