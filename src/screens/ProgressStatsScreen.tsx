import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { auth } from "../config/firebaseConfig";
import {
  getLocalWorkoutHistory,
  safeJsonParse,
  syncWorkoutHistoryWithCloud,
} from "../utils/firebaseSync";
import { styles } from "../constants/globalStyles";
import { Colors } from "../theme";
import { isMachineBrandApplicable } from "../utils/helpers";
import {
  formatExercisePerformanceName,
  getExercisePerformanceKey,
} from "../utils/performance";
import {
  chooseHeaviestRpeSet,
  parseRpeValue,
  workoutUsesRpeTracking,
} from "../utils/rpe";
import type { RpePerformanceSet } from "../utils/rpe";

type RangeKey = "7D" | "30D" | "90D" | "1Y" | "ALL";
type ChartMetric = "volume" | "sets" | "time" | "rpe";
type ChartPeriod = "weekly" | "monthly";
type AnalyticsScope = "ALL" | "FREE" | "MACHINES";
type RpeScope = "working" | "warmup";

type RpeExerciseOption = {
  key: string;
  label: string;
  latestTimestamp: number;
};

type TrendPoint = {
  key: number;
  label: string;
  value: number;
  workouts: number;
  rpe?: number;
};

const RANGE_OPTIONS: { label: string; value: RangeKey; days: number | null }[] =
  [
    { label: "7D", value: "7D", days: 7 },
    { label: "30D", value: "30D", days: 30 },
    { label: "90D", value: "90D", days: 90 },
    { label: "1Y", value: "1Y", days: 365 },
    { label: "All", value: "ALL", days: null },
  ];

const SCOPE_OPTIONS: { label: string; value: AnalyticsScope }[] = [
  { label: "All", value: "ALL" },
  { label: "Free Weights", value: "FREE" },
  { label: "Machines", value: "MACHINES" },
];

const formatCompactNumber = (value: number) => {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value)}`;
};

const formatDecimal = (value: number) =>
  Number.isInteger(value) ? `${value}` : value.toFixed(1);

const formatSignedPercent = (
  value: number | null,
  comparisonLabel = "vs previous",
) => {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded === 0) return `No change ${comparisonLabel}`;
  return `${rounded > 0 ? "+" : ""}${rounded}% ${comparisonLabel}`;
};

const formatSignedWeight = (
  value: number | null,
  isKg: boolean,
  comparisonLabel = "vs previous",
) => {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return `No change ${comparisonLabel}`;
  return `${rounded > 0 ? "+" : ""}${formatDecimal(rounded)} ${
    isKg ? "kg" : "lbs"
  } ${comparisonLabel}`;
};

const formatRpePerformanceSet = (
  set: RpePerformanceSet | null,
  isKg: boolean,
) =>
  set
    ? `${formatDecimal(set.weight)} ${isKg ? "kg" : "lbs"} @ RPE ${formatDecimal(
        set.rpe,
      )}`
    : "—";

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

const addPeriod = (timestamp: number, period: ChartPeriod, amount: number) => {
  const date = new Date(timestamp);
  if (period === "weekly") date.setDate(date.getDate() + amount * 7);
  else date.setMonth(date.getMonth() + amount);
  return date.getTime();
};

const getPeriodStart = (timestamp: number, period: ChartPeriod) => {
  return period === "weekly"
    ? getWeekStart(timestamp)
    : getMonthStart(timestamp);
};

const formatPeriodLabel = (timestamp: number, period: ChartPeriod) => {
  const date = new Date(timestamp);
  if (period === "weekly") {
    return date.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  }
  return date.toLocaleDateString(undefined, { month: "short" });
};

const formatShortDate = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
};

const formatComparisonDateRange = (startMs: number, endExclusiveMs: number) => {
  const endMs = Math.max(startMs, endExclusiveMs - 1);
  const start = new Date(startMs);
  const end = new Date(endMs);

  if (start.toDateString() === end.toDateString()) {
    return formatShortDate(startMs);
  }

  const sameMonth =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${start.getDate()}–${formatShortDate(endMs)}`;
  }

  return `${formatShortDate(startMs)}–${formatShortDate(endMs)}`;
};

const getRowRpePerformanceSet = (
  row: any,
  scope: RpeScope,
): RpePerformanceSet | null =>
  scope === "warmup"
    ? row.metrics.warmupTopRpeSet
    : row.metrics.workingTopRpeSet;

const getRowsTopRpeSet = (rows: any[], scope: RpeScope) =>
  rows.reduce<RpePerformanceSet | null>(
    (result, row) =>
      chooseHeaviestRpeSet(result, getRowRpePerformanceSet(row, scope)),
    null,
  );

const getTrendRowValue = (row: any, metric: ChartMetric) => {
  if (metric === "volume") return row.metrics.volume;
  if (metric === "sets") return row.metrics.sets;
  if (metric === "rpe") return 0;
  return row.seconds;
};

const getRowsMetricValue = (
  rows: any[],
  metric: ChartMetric,
  rpeScope: RpeScope,
) => {
  if (metric !== "rpe") {
    return rows.reduce((sum, row) => sum + getTrendRowValue(row, metric), 0);
  }
  return getRowsTopRpeSet(rows, rpeScope)?.weight || 0;
};

const parseDurationToSeconds = (duration: any): number => {
  if (typeof duration === "number" && Number.isFinite(duration))
    return Math.max(0, duration);
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

const getWorkoutTimestamp = (workout: any): number => {
  const startedAt = Number(workout?.startedAt);
  if (Number.isFinite(startedAt) && startedAt > 0) return startedAt;

  const idTime = Number(workout?.id);
  if (Number.isFinite(idTime) && idTime > 100000000000) return idTime;

  const parsedDate = Date.parse(workout?.date || "");
  if (Number.isFinite(parsedDate)) return parsedDate;

  return 0;
};

const getRepsForSet = (exercise: any, set: any): number => {
  if (exercise?.is_unilateral) {
    return Math.max(Number(set?.repsL || 0), Number(set?.repsR || 0));
  }
  return Number(set?.reps || 0);
};

const getExerciseBrand = (exercise: any): string | null => {
  const brand =
    exercise?.equipmentTag || exercise?.machineBrand || exercise?.brand;
  const cleaned = String(brand || "").trim();
  return cleaned || null;
};

const exerciseMatchesAnalyticsFilters = (
  exercise: any,
  scope: AnalyticsScope,
  selectedBrand: string,
) => {
  const brandApplicable = isMachineBrandApplicable(exercise);
  if (scope === "FREE" && brandApplicable) return false;
  if (scope === "MACHINES" && !brandApplicable) return false;
  if (
    selectedBrand !== "ALL" &&
    (!brandApplicable || getExerciseBrand(exercise) !== selectedBrand)
  ) {
    return false;
  }
  return true;
};

const convertScopedVolume = (
  value: number,
  workout: any,
  displayKg: boolean,
): number => {
  if (!Number.isFinite(value)) return 0;
  if (displayKg && workout?.isKg === false) return value / 2.20462;
  if (!displayKg && workout?.isKg === true) return value * 2.20462;
  return value;
};

const getScopedWorkoutMetrics = (
  workout: any,
  scope: AnalyticsScope,
  selectedBrand: string,
  displayKg: boolean,
  rpeExerciseKey: string | null,
) => {
  let sets = 0;
  let exercises = 0;
  let rawVolume = 0;
  let workingTopRpeSet: RpePerformanceSet | null = null;
  let warmupTopRpeSet: RpePerformanceSet | null = null;
  let workingCompletedSets = 0;
  let warmupCompletedSets = 0;

  (workout?.fullWorkoutData || []).forEach((exercise: any) => {
    if (!exerciseMatchesAnalyticsFilters(exercise, scope, selectedBrand)) return;

    const completedSets =
      exercise?.sets?.filter((set: any) => set?.completed) || [];
    const completedWorkingSets = completedSets.filter(
      (set: any) => !set?.isWarmup,
    );

    if (completedWorkingSets.length > 0) {
      exercises += 1;
      sets += completedWorkingSets.length;
    }
    completedWorkingSets.forEach((set: any) => {
      const weight = Number(set?.weight || 0);
      const reps = getRepsForSet(exercise, set);
      rawVolume += weight * reps;
    });

    if (
      !rpeExerciseKey ||
      getExercisePerformanceKey(exercise) !== rpeExerciseKey
    ) {
      return;
    }

    workingCompletedSets += completedWorkingSets.length;
    warmupCompletedSets += completedSets.length - completedWorkingSets.length;

    completedSets.forEach((set: any) => {
      const rpe = parseRpeValue(set?.rpe);
      if (rpe === null) return;
      const rawWeight = Number(set?.weight);
      if (!Number.isFinite(rawWeight) || rawWeight < 0) return;
      const candidate = {
        weight: convertScopedVolume(rawWeight, workout, displayKg),
        rpe,
      };
      if (set?.isWarmup) {
        warmupTopRpeSet = chooseHeaviestRpeSet(warmupTopRpeSet, candidate);
      } else {
        workingTopRpeSet = chooseHeaviestRpeSet(
          workingTopRpeSet,
          candidate,
        );
      }
    });
  });

  return {
    sets,
    exercises,
    volume: convertScopedVolume(rawVolume, workout, displayKg),
    workingTopRpeSet,
    warmupTopRpeSet,
    workingCompletedSets,
    warmupCompletedSets,
  };
};

const getMetricLabel = (metric: ChartMetric) => {
  if (metric === "sets") return "Sets";
  if (metric === "time") return "Time";
  if (metric === "rpe") return "RPE";
  return "Volume";
};

const formatTrendValue = (
  value: number,
  metric: ChartMetric,
  isKg: boolean,
) => {
  if (metric === "time") return formatDuration(value);
  if (metric === "sets") return `${Math.round(value)}`;
  if (metric === "rpe") return "—";
  return `${formatCompactNumber(value)} ${isKg ? "kg" : "lbs"}`;
};

export default function ProgressStatsScreen({ navigation }: any) {
  const [history, setHistory] = useState<any[]>([]);
  const [selectedRange, setSelectedRange] = useState<RangeKey>("30D");
  const [isGlobalKg, setIsGlobalKg] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("volume");
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("weekly");
  const [rpeScope, setRpeScope] = useState<RpeScope>("working");
  const [analyticsScope, setAnalyticsScope] = useState<AnalyticsScope>("ALL");
  const [selectedGymId, setSelectedGymId] = useState("ALL");
  const [selectedBrand, setSelectedBrand] = useState("ALL");
  const [rpePreferenceEnabled, setRpePreferenceEnabled] = useState(false);
  const [selectedRpeExerciseKey, setSelectedRpeExerciseKey] = useState<
    string | null
  >(null);
  const [isRpeExercisePickerVisible, setIsRpeExercisePickerVisible] =
    useState(false);
  const [rpeExerciseSearch, setRpeExerciseSearch] = useState("");
  const [selectedTrendKey, setSelectedTrendKey] = useState<number | null>(null);
  const [selectedCompareTrendKey, setSelectedCompareTrendKey] = useState<
    number | null
  >(null);
  const [gyms, setGyms] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const uid = auth.currentUser?.uid;

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);

    try {
      const pref = await AsyncStorage.getItem(`@user_metric_${uid}`);
      setIsGlobalKg(pref === "KG");
      const rpePreference = await AsyncStorage.getItem(
        `@rpe_tracking_enabled_${uid}`,
      );
      setRpePreferenceEnabled(rpePreference === "true");

      const savedGyms = await AsyncStorage.getItem(`@user_gyms_${uid}`);
      setGyms(savedGyms ? safeJsonParse(savedGyms, []) : []);

      const localData = await getLocalWorkoutHistory(uid);
      setHistory(
        localData
          .filter((workout: any) => workout && workout.id)
          .sort(
            (a: any, b: any) => getWorkoutTimestamp(b) - getWorkoutTimestamp(a),
          ),
      );

      syncWorkoutHistoryWithCloud()
        .then(async () => {
          const mergedData = await getLocalWorkoutHistory(uid);
          setHistory(
            mergedData
              .filter((workout: any) => workout && workout.id)
              .sort(
                (a: any, b: any) =>
                  getWorkoutTimestamp(b) - getWorkoutTimestamp(a),
              ),
          );
        })
        .catch((error) => {
          console.log("Progress stats cloud refresh delayed:", error);
        });
    } catch (error) {
      console.error("Failed to load progress statistics:", error);
      const pref = await AsyncStorage.getItem(`@user_metric_${uid}`);
      setIsGlobalKg(pref === "KG");
      const rpePreference = await AsyncStorage.getItem(
        `@rpe_tracking_enabled_${uid}`,
      );
      setRpePreferenceEnabled(rpePreference === "true");

      const savedGyms = await AsyncStorage.getItem(`@user_gyms_${uid}`);
      setGyms(savedGyms ? safeJsonParse(savedGyms, []) : []);

      const saved = await AsyncStorage.getItem(`@workout_history_${uid}`);
      const localData = saved
        ? safeJsonParse<any[]>(saved, []).filter(
            (workout: any) => workout && workout.id,
          )
        : [];
      setHistory(
        localData.sort(
          (a: any, b: any) => getWorkoutTimestamp(b) - getWorkoutTimestamp(a),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      setSelectedTrendKey(null);
      setSelectedCompareTrendKey(null);
      load();
    });
    return unsubscribe;
  }, [navigation, load]);

  const rangeFilteredHistory = useMemo(() => {
    const activeRange = RANGE_OPTIONS.find(
      (range) => range.value === selectedRange,
    );
    const rangeDays = activeRange?.days ?? null;
    const cutoffTime =
      typeof rangeDays === "number"
        ? Date.now() - rangeDays * 24 * 60 * 60 * 1000
        : null;
    const dateFiltered =
      cutoffTime !== null
        ? history.filter(
            (workout) => getWorkoutTimestamp(workout) >= cutoffTime,
          )
        : history;

    if (selectedGymId === "ALL") return dateFiltered;
    if (selectedGymId === "NONE")
      return dateFiltered.filter((workout) => !workout?.gymId);

    return dateFiltered.filter(
      (workout) => String(workout?.gymId || "") === String(selectedGymId),
    );
  }, [history, selectedRange, selectedGymId]);

  const brandOptions = useMemo(() => {
    const brands = new Set<string>();
    rangeFilteredHistory.forEach((workout) => {
      (workout?.fullWorkoutData || []).forEach((exercise: any) => {
        if (!isMachineBrandApplicable(exercise)) return;
        const brand = getExerciseBrand(exercise);
        if (brand) brands.add(brand);
      });
    });
    return Array.from(brands).sort((a, b) => a.localeCompare(b));
  }, [rangeFilteredHistory]);

  useEffect(() => {
    if (analyticsScope === "FREE" && selectedBrand !== "ALL") {
      setSelectedBrand("ALL");
      return;
    }
    if (selectedBrand !== "ALL" && !brandOptions.includes(selectedBrand)) {
      setSelectedBrand("ALL");
    }
  }, [analyticsScope, brandOptions, selectedBrand]);

  const rpeExerciseOptions = useMemo(() => {
    const options = new Map<string, RpeExerciseOption>();

    rangeFilteredHistory.forEach((workout) => {
      const timestamp = getWorkoutTimestamp(workout);
      (workout?.fullWorkoutData || []).forEach((exercise: any) => {
        if (
          !exerciseMatchesAnalyticsFilters(
            exercise,
            analyticsScope,
            selectedBrand,
          )
        ) {
          return;
        }

        const hasRecordedRpe = (exercise?.sets || []).some(
          (set: any) => {
            const weight = Number(set?.weight);
            return (
              set?.completed &&
              parseRpeValue(set?.rpe) !== null &&
              Number.isFinite(weight) &&
              weight >= 0
            );
          },
        );
        if (!hasRecordedRpe) return;

        const key = getExercisePerformanceKey(exercise);
        const existing = options.get(key);
        if (!existing || timestamp > existing.latestTimestamp) {
          options.set(key, {
            key,
            label: formatExercisePerformanceName(exercise),
            latestTimestamp: timestamp,
          });
        }
      });
    });

    return Array.from(options.values()).sort(
      (a, b) =>
        b.latestTimestamp - a.latestTimestamp || a.label.localeCompare(b.label),
    );
  }, [rangeFilteredHistory, analyticsScope, selectedBrand]);

  useEffect(() => {
    if (
      selectedRpeExerciseKey &&
      rpeExerciseOptions.some(
        (option) => option.key === selectedRpeExerciseKey,
      )
    ) {
      return;
    }
    setSelectedRpeExerciseKey(rpeExerciseOptions[0]?.key || null);
  }, [rpeExerciseOptions, selectedRpeExerciseKey]);

  const selectedRpeExercise = useMemo(
    () =>
      rpeExerciseOptions.find(
        (option) => option.key === selectedRpeExerciseKey,
      ) || null,
    [rpeExerciseOptions, selectedRpeExerciseKey],
  );

  const filteredRpeExerciseOptions = useMemo(() => {
    const query = rpeExerciseSearch.trim().toLowerCase();
    if (!query) return rpeExerciseOptions;
    return rpeExerciseOptions.filter((option) =>
      option.label.toLowerCase().includes(query),
    );
  }, [rpeExerciseOptions, rpeExerciseSearch]);

  useEffect(() => {
    setSelectedTrendKey(null);
    setSelectedCompareTrendKey(null);
  }, [
    selectedRange,
    chartMetric,
    chartPeriod,
    rpeScope,
    analyticsScope,
    selectedGymId,
    selectedBrand,
    selectedRpeExerciseKey,
  ]);

  const allScopedWorkoutRows = useMemo(() => {
    return rangeFilteredHistory
      .map((workout) => {
        const metrics = getScopedWorkoutMetrics(
          workout,
          analyticsScope,
          selectedBrand,
          isGlobalKg,
          selectedRpeExerciseKey,
        );
        return {
          workout,
          metrics,
          timestamp: getWorkoutTimestamp(workout),
          seconds:
            metrics.sets > 0 ? parseDurationToSeconds(workout?.duration) : 0,
        };
      });
  }, [
    rangeFilteredHistory,
    analyticsScope,
    selectedBrand,
    isGlobalKg,
    selectedRpeExerciseKey,
  ]);

  const scopedWorkoutRows = useMemo(
    () => allScopedWorkoutRows.filter((row) => row.metrics.sets > 0),
    [allScopedWorkoutRows],
  );

  const rpeScopedWorkoutRows = useMemo(
    () =>
      allScopedWorkoutRows.filter(
        (row) =>
          workoutUsesRpeTracking(row.workout) &&
          row.metrics.workingCompletedSets +
            row.metrics.warmupCompletedSets >
            0,
      ),
    [allScopedWorkoutRows],
  );

  const summary = useMemo(() => {
    const workouts = scopedWorkoutRows.length;
    const sets = scopedWorkoutRows.reduce(
      (sum, row) => sum + row.metrics.sets,
      0,
    );
    const exercises = scopedWorkoutRows.reduce(
      (sum, row) => sum + row.metrics.exercises,
      0,
    );
    const volume = scopedWorkoutRows.reduce(
      (sum, row) => sum + row.metrics.volume,
      0,
    );
    const seconds = scopedWorkoutRows.reduce(
      (sum, row) => sum + row.seconds,
      0,
    );

    return { workouts, sets, exercises, volume, seconds };
  }, [scopedWorkoutRows]);

  const hasAnyRpeData = useMemo(
    () =>
      history.some((workout: any) =>
        (workout?.fullWorkoutData || []).some((exercise: any) =>
          (exercise?.sets || []).some(
            (set: any) => set?.completed && parseRpeValue(set?.rpe) !== null,
          ),
        ),
      ),
    [history],
  );

  const showRpeAnalytics = hasAnyRpeData || rpePreferenceEnabled;

  useEffect(() => {
    if (!showRpeAnalytics && chartMetric === "rpe") {
      setChartMetric("volume");
    }
  }, [chartMetric, showRpeAnalytics]);

  const trendData = useMemo(() => {
    const periodMap = new Map<number, TrendPoint>();
    const sourceRows =
      chartMetric === "rpe" ? rpeScopedWorkoutRows : scopedWorkoutRows;

    sourceRows
      .filter((row) => row.timestamp > 0)
      .forEach((row) => {
        const rpeSet =
          chartMetric === "rpe"
            ? getRowRpePerformanceSet(row, rpeScope)
            : null;
        if (chartMetric === "rpe" && !rpeSet) return;

        const timestamp = row.timestamp;
        const key = getPeriodStart(timestamp, chartPeriod);
        const current = periodMap.get(key) || {
          key,
          label: formatPeriodLabel(key, chartPeriod),
          value: 0,
          workouts: 0,
        };

        if (chartMetric === "volume") current.value += row.metrics.volume;
        else if (chartMetric === "sets") current.value += row.metrics.sets;
        else if (chartMetric === "time") current.value += row.seconds;
        else {
          const selectedSet = chooseHeaviestRpeSet(
            current.rpe === undefined
              ? null
              : { weight: current.value, rpe: current.rpe },
            rpeSet,
          );
          if (selectedSet) {
            current.value = selectedSet.weight;
            current.rpe = selectedSet.rpe;
          }
        }

        current.workouts += 1;
        periodMap.set(key, current);
      });

    let points = Array.from(periodMap.values()).sort((a, b) => a.key - b.key);

    if (points.length > 0 && chartMetric !== "rpe") {
      const firstKey = points[0].key;
      const lastKey = points[points.length - 1].key;
      const filled: TrendPoint[] = [];

      for (
        let cursor = firstKey;
        cursor <= lastKey;
        cursor = addPeriod(cursor, chartPeriod, 1)
      ) {
        const match = periodMap.get(cursor);
        filled.push(
          match || {
            key: cursor,
            label: formatPeriodLabel(cursor, chartPeriod),
            value: 0,
            workouts: 0,
          },
        );
      }
      points = filled;
    }

    const maxPoints = chartPeriod === "weekly" ? 8 : 10;
    if (points.length > maxPoints)
      points = points.slice(points.length - maxPoints);

    const current = points[points.length - 1] || null;
    const previous = points[points.length - 2] || null;

    return {
      points,
      current,
      previous,
      maxValue: Math.max(...points.map((point) => point.value), 0),
    };
  }, [
    scopedWorkoutRows,
    rpeScopedWorkoutRows,
    chartPeriod,
    chartMetric,
    rpeScope,
  ]);

  const selectedTrendPoint = useMemo(() => {
    if (!trendData.points.length) return null;
    if (selectedTrendKey === null) return trendData.current;
    return (
      trendData.points.find((point) => point.key === selectedTrendKey) ||
      trendData.current
    );
  }, [selectedTrendKey, trendData]);

  useEffect(() => {
    setSelectedCompareTrendKey(null);
  }, [selectedTrendPoint?.key, chartPeriod]);

  const comparisonOptions = useMemo(() => {
    if (!selectedTrendPoint) return [] as TrendPoint[];

    const options = trendData.points.filter(
      (point) => point.key !== selectedTrendPoint.key,
    );
    const defaultPreviousKey = addPeriod(
      selectedTrendPoint.key,
      chartPeriod,
      -1,
    );

    if (!options.some((point) => point.key === defaultPreviousKey)) {
      options.push({
        key: defaultPreviousKey,
        label: formatPeriodLabel(defaultPreviousKey, chartPeriod),
        value: 0,
        workouts: 0,
      });
    }

    return options.sort((a, b) => a.key - b.key);
  }, [selectedTrendPoint, trendData.points, chartPeriod]);

  const effectiveCompareKey = useMemo(() => {
    if (!selectedTrendPoint) return null;
    if (
      selectedCompareTrendKey !== null &&
      selectedCompareTrendKey !== selectedTrendPoint.key
    ) {
      return selectedCompareTrendKey;
    }
    return addPeriod(selectedTrendPoint.key, chartPeriod, -1);
  }, [selectedCompareTrendKey, selectedTrendPoint, chartPeriod]);

  const comparisonOptionIndex = useMemo(() => {
    if (effectiveCompareKey === null) return -1;
    return comparisonOptions.findIndex(
      (option) => option.key === effectiveCompareKey,
    );
  }, [comparisonOptions, effectiveCompareKey]);

  const selectedTrendComparison = useMemo(() => {
    if (!selectedTrendPoint || effectiveCompareKey === null) {
      return {
        previous: null as TrendPoint | null,
        comparison: null as number | null,
        comparisonLabel: "vs selected period",
        note: "Tap a bar to view that period, then use the compare controls to choose another period.",
        selectedRangeLabel: "",
        comparisonRangeLabel: "",
        selectedValue: 0,
        comparisonValue: 0,
        selectedRpeSet: null as RpePerformanceSet | null,
        comparisonRpeSet: null as RpePerformanceSet | null,
      };
    }

    const periodLabel = chartPeriod === "weekly" ? "week" : "month";
    const selectedStart = selectedTrendPoint.key;
    const selectedPeriodEnd = addPeriod(selectedStart, chartPeriod, 1);
    const comparisonStart = effectiveCompareKey;
    const comparisonPeriodEnd = addPeriod(comparisonStart, chartPeriod, 1);
    const now = Date.now();
    const currentPeriodStart = getPeriodStart(now, chartPeriod);
    const currentPeriodEnd = addPeriod(currentPeriodStart, chartPeriod, 1);
    const currentElapsedMs = Math.max(
      0,
      Math.min(now, currentPeriodEnd) - currentPeriodStart,
    );
    const isSelectedCurrentPeriod = selectedStart === currentPeriodStart;
    const isComparisonCurrentPeriod = comparisonStart === currentPeriodStart;
    const comparisonWindowMs =
      isSelectedCurrentPeriod || isComparisonCurrentPeriod
        ? currentElapsedMs
        : Math.max(0, selectedPeriodEnd - selectedStart);
    const selectedEndExclusive = Math.min(
      selectedPeriodEnd,
      selectedStart + comparisonWindowMs,
    );
    const comparisonEndExclusive = Math.min(
      comparisonPeriodEnd,
      comparisonStart + comparisonWindowMs,
    );
    const isPartialCurrentComparison =
      isSelectedCurrentPeriod || isComparisonCurrentPeriod;

    const sourceRows =
      chartMetric === "rpe" ? rpeScopedWorkoutRows : scopedWorkoutRows;
    const selectedRows = sourceRows.filter(
      (row) =>
        row.timestamp >= selectedStart && row.timestamp < selectedEndExclusive,
    );
    const comparisonRows = sourceRows.filter(
      (row) =>
        row.timestamp >= comparisonStart &&
        row.timestamp < comparisonEndExclusive,
    );
    const selectedValue = getRowsMetricValue(
      selectedRows,
      chartMetric,
      rpeScope,
    );
    const comparisonValue = getRowsMetricValue(
      comparisonRows,
      chartMetric,
      rpeScope,
    );
    const selectedRpeSet =
      chartMetric === "rpe" ? getRowsTopRpeSet(selectedRows, rpeScope) : null;
    const comparisonRpeSet =
      chartMetric === "rpe"
        ? getRowsTopRpeSet(comparisonRows, rpeScope)
        : null;
    const comparisonHasData =
      chartMetric === "rpe"
        ? selectedRpeSet !== null && comparisonRpeSet !== null
        : comparisonValue > 0;

    const comparison =
      comparisonHasData
        ? chartMetric === "rpe"
          ? selectedValue - comparisonValue
          : ((selectedValue - comparisonValue) / comparisonValue) * 100
        : null;
    const selectedRangeLabel = formatComparisonDateRange(
      selectedStart,
      selectedEndExclusive,
    );
    const comparisonRangeLabel = formatComparisonDateRange(
      comparisonStart,
      comparisonEndExclusive,
    );
    const metricLabel = getMetricLabel(chartMetric).toLowerCase();
    const rpeExerciseLabel = selectedRpeExercise?.label || "selected exercise";

    return {
      previous: {
        key: comparisonStart,
        label: comparisonRangeLabel,
        value: comparisonValue,
        workouts: 0,
      } as TrendPoint,
      comparison,
      comparisonLabel: `vs ${comparisonRangeLabel}`,
      note:
        comparisonHasData
          ? isPartialCurrentComparison
            ? chartMetric === "rpe"
              ? `Comparing the same elapsed ${periodLabel} portion: ${selectedRangeLabel} with ${comparisonRangeLabel}. Bars show the heaviest ${rpeScope} set recorded with RPE for ${rpeExerciseLabel}.`
              : `Comparing the same elapsed ${periodLabel} portion: ${selectedRangeLabel} with ${comparisonRangeLabel}. Bars still show total ${metricLabel} for each ${periodLabel}.`
            : chartMetric === "rpe"
              ? `Comparing ${selectedRangeLabel} with ${comparisonRangeLabel}. Bars show the heaviest ${rpeScope} set recorded with RPE for ${rpeExerciseLabel}.`
              : `Comparing ${selectedRangeLabel} with ${comparisonRangeLabel}. Bars show total ${metricLabel} for each ${periodLabel}.`
          : `No ${metricLabel} recorded for ${comparisonRangeLabel}. Choose another compare period or tap another bar.`,
      selectedRangeLabel,
      comparisonRangeLabel,
      selectedValue,
      comparisonValue,
      selectedRpeSet,
      comparisonRpeSet,
    };
  }, [
    selectedTrendPoint,
    effectiveCompareKey,
    chartPeriod,
    chartMetric,
    rpeScope,
    scopedWorkoutRows,
    rpeScopedWorkoutRows,
    selectedRpeExercise,
  ]);

  const moveComparePeriod = (direction: -1 | 1) => {
    if (!comparisonOptions.length) return;

    const currentIndex = comparisonOptionIndex >= 0 ? comparisonOptionIndex : 0;
    const nextIndex = Math.min(
      comparisonOptions.length - 1,
      Math.max(0, currentIndex + direction),
    );
    const nextOption = comparisonOptions[nextIndex];
    if (!nextOption) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedCompareTrendKey(nextOption.key);
  };

  const renderRangeChips = () => (
    <View style={localStyles.chipRowCompact}>
      {RANGE_OPTIONS.map((range) => {
        const active = selectedRange === range.value;
        return (
          <TouchableOpacity
            key={range.value}
            style={[localStyles.rangeChip, active && localStyles.activeChip]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setSelectedRange(range.value);
            }}
          >
            <Text
              style={[
                localStyles.chipText,
                active && localStyles.activeChipText,
              ]}
            >
              {range.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderSegmentedControl = <T extends string>(
    options: { label: string; value: T }[],
    value: T,
    onChange: (next: T) => void,
  ) => (
    <View style={localStyles.segmentedControl}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <TouchableOpacity
            key={option.value}
            style={[
              localStyles.segmentChip,
              active && localStyles.segmentChipActive,
            ]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChange(option.value);
            }}
          >
            <Text
              style={[
                localStyles.segmentChipText,
                active && localStyles.segmentChipTextActive,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderTrendChart = () => {
    const points = trendData.points;
    const maxValue = trendData.maxValue || 1;

    if (!points.length) {
      return (
        <View style={localStyles.trendEmptyState}>
          <Ionicons
            name="analytics-outline"
            size={28}
            color={Colors.textMuted}
          />
          <Text style={localStyles.trendEmptyTitle}>No trend data yet</Text>
          <Text style={localStyles.trendEmptySubtitle}>
            {chartMetric === "rpe"
              ? `Record ${rpeScope} set RPE to see weekly and monthly trends.`
              : "Complete workouts to see weekly and monthly progress trends."}
          </Text>
        </View>
      );
    }

    return (
      <View style={localStyles.chartArea}>
        {points.map((point, index) => {
          const height = Math.max(
            8,
            Math.round((point.value / maxValue) * 112),
          );
          const isCurrent = index === points.length - 1;
          const previous = points[index - 1];
          const direction = !previous
            ? "same"
            : point.value > previous.value
              ? "up"
              : point.value < previous.value
                ? "down"
                : "same";

          const isSelected =
            selectedTrendKey === null
              ? isCurrent
              : selectedTrendKey === point.key;
          const isImplicitCurrentSelection = selectedTrendKey === null && isCurrent;
          const isCompared =
            effectiveCompareKey !== null &&
            effectiveCompareKey === point.key &&
            !isSelected;

          return (
            <TouchableOpacity
              key={`${point.key}-${index}`}
              style={localStyles.chartColumnWrap}
              activeOpacity={0.8}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelectedTrendKey(point.key);
                setSelectedCompareTrendKey(null);
              }}
            >
              <View
                style={[
                  localStyles.chartColumnTrack,
                  isCompared && localStyles.chartColumnTrackCompared,
                  isSelected && localStyles.chartColumnTrackSelected,
                ]}
              >
                <View
                  style={[
                    localStyles.chartColumn,
                    { height },
                    isCompared && localStyles.chartColumnCompared,
                    isImplicitCurrentSelection && localStyles.chartColumnCurrent,
                    isSelected && localStyles.chartColumnSelected,
                  ]}
                />
                <View
                  style={[
                    localStyles.chartDot,
                    {
                      bottom: height + 4,
                      backgroundColor:
                        chartMetric === "rpe"
                          ? Colors.textMuted
                          : direction === "down"
                          ? Colors.danger
                          : direction === "up"
                            ? Colors.accent
                            : Colors.textMuted,
                    },
                    isCompared && localStyles.chartDotCompared,
                    isImplicitCurrentSelection && localStyles.chartDotCurrent,
                    isSelected && localStyles.chartDotSelected,
                  ]}
                />
              </View>
              <Text
                style={[
                  localStyles.chartLabel,
                  isCompared && localStyles.chartLabelCompared,
                  isSelected && localStyles.chartLabelSelected,
                ]}
                numberOfLines={1}
              >
                {point.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const comparisonText =
    chartMetric === "rpe"
      ? formatSignedWeight(
          selectedTrendComparison.comparison,
          isGlobalKg,
          selectedTrendComparison.comparisonLabel,
        )
      : formatSignedPercent(
          selectedTrendComparison.comparison,
          selectedTrendComparison.comparisonLabel,
        );

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

  const selectedScopeLabel =
    SCOPE_OPTIONS.find((option) => option.value === analyticsScope)?.label ||
    "All";
  const selectedGymLabel =
    selectedGymId === "ALL"
      ? "All Gyms"
      : selectedGymId === "NONE"
        ? "No Gym"
        : gymOptions.find((gym) => gym.id === selectedGymId)?.name ||
          "Selected Gym";
  const selectedBrandLabel =
    selectedBrand === "ALL" ? "All Brands" : selectedBrand;
  const shouldShowBrandFilter =
    analyticsScope !== "FREE" && brandOptions.length > 0;

  const renderFilterPill = (
    label: string,
    active: boolean,
    onPress: () => void,
    key?: string,
  ) => (
    <TouchableOpacity
      key={key || label}
      style={[localStyles.filterPill, active && localStyles.filterPillActive]}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
    >
      <Text
        style={[
          localStyles.filterPillText,
          active && localStyles.filterPillTextActive,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.screen}>
      <SafeAreaView edges={["top"]} style={styles.headerContainer}>
        <View style={styles.headerContentFlex}>
          <TouchableOpacity
            style={styles.headerSideBtn}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Ionicons name="chevron-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitleStatic}>Progress</Text>
          </View>
          <View style={styles.headerSideBtn} />
        </View>
      </SafeAreaView>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={localStyles.scrollContent}
      >
        <Text style={localStyles.eyebrow}>Analytics</Text>
        <Text style={localStyles.screenTitle}>Progress & Statistics</Text>
        <Text style={localStyles.subtitle}>
          Track your training summary, volume, frequency, and trend changes.
        </Text>

        {renderRangeChips()}

        <View style={localStyles.filterCard}>
          <View style={localStyles.filterSectionHeader}>
            <Text style={localStyles.filterSectionTitle}>Analytics Scope</Text>
            <Text style={localStyles.filterSectionValue}>
              {selectedScopeLabel}
            </Text>
          </View>
          <View style={localStyles.filterPillRow}>
            {SCOPE_OPTIONS.map((option) =>
              renderFilterPill(
                option.label,
                analyticsScope === option.value,
                () => setAnalyticsScope(option.value),
                option.value,
              ),
            )}
          </View>

          <View style={localStyles.filterSectionHeader}>
            <Text style={localStyles.filterSectionTitle}>Gym</Text>
            <Text style={localStyles.filterSectionValue} numberOfLines={1}>
              {selectedGymLabel}
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={localStyles.filterScrollContent}
          >
            {renderFilterPill(
              "All Gyms",
              selectedGymId === "ALL",
              () => setSelectedGymId("ALL"),
              "ALL_GYMS",
            )}
            {gymOptions.map((gym) =>
              renderFilterPill(
                gym.name,
                selectedGymId === gym.id,
                () => setSelectedGymId(gym.id),
                gym.id,
              ),
            )}
            {history.some((workout) => !workout?.gymId) &&
              renderFilterPill(
                "No Gym",
                selectedGymId === "NONE",
                () => setSelectedGymId("NONE"),
                "NO_GYM",
              )}
          </ScrollView>

          {shouldShowBrandFilter && (
            <>
              <View style={localStyles.filterSectionHeader}>
                <Text style={localStyles.filterSectionTitle}>
                  Machine Brand
                </Text>
                <Text style={localStyles.filterSectionValue} numberOfLines={1}>
                  {selectedBrandLabel}
                </Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={localStyles.filterScrollContent}
              >
                {renderFilterPill(
                  "All Brands",
                  selectedBrand === "ALL",
                  () => setSelectedBrand("ALL"),
                  "ALL_BRANDS",
                )}
                {brandOptions.map((brand) =>
                  renderFilterPill(
                    brand,
                    selectedBrand === brand,
                    () => setSelectedBrand(brand),
                    brand,
                  ),
                )}
              </ScrollView>
            </>
          )}

          <View style={localStyles.scopeNote}>
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={Colors.textMuted}
            />
            <Text style={localStyles.scopeNoteText}>
              Machine and cable loads can vary by gym or brand. Filter by gym or
              brand for more comparable volume trends.
            </Text>
          </View>
        </View>

        <View style={localStyles.summaryCard}>
          <View style={localStyles.summaryHeaderRow}>
            <View>
              <Text style={localStyles.summaryLabel}>
                {selectedRange === "ALL" ? "Lifetime" : `Last ${selectedRange}`}
              </Text>
              <Text style={localStyles.summaryTitle}>Training Summary</Text>
            </View>
            <View style={localStyles.syncPill}>
              <Ionicons
                name="cloud-done-outline"
                size={13}
                color={Colors.accent}
              />
              <Text style={localStyles.syncPillText}>
                {loading ? "Syncing" : "Synced"}
              </Text>
            </View>
          </View>

          <View style={localStyles.statsGrid}>
            <View style={localStyles.statBox}>
              <Text style={localStyles.statValue}>{summary.workouts}</Text>
              <Text style={localStyles.statLabel}>Workouts</Text>
            </View>
            <View style={localStyles.statBox}>
              <Text style={localStyles.statValue}>{summary.sets}</Text>
              <Text style={localStyles.statLabel}>Sets</Text>
            </View>
            <View style={localStyles.statBox}>
              <Text style={localStyles.statValue}>
                {formatCompactNumber(summary.volume)}
              </Text>
              <Text style={localStyles.statLabel}>
                {isGlobalKg ? "kg" : "lbs"} Volume
              </Text>
            </View>
            <View style={localStyles.statBox}>
              <Text style={localStyles.statValue}>
                {formatDuration(summary.seconds)}
              </Text>
              <Text style={localStyles.statLabel}>Time</Text>
            </View>
          </View>
        </View>

        <View style={localStyles.trendCard}>
          <View style={localStyles.trendHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={localStyles.summaryLabel}>Progress Trend</Text>
              <Text style={localStyles.trendTitle}>
                {getMetricLabel(chartMetric)} ·{" "}
                {chartPeriod === "weekly" ? "Weekly" : "Monthly"}
              </Text>
            </View>
            <View style={localStyles.trendScopeBadge}>
              <Text style={localStyles.trendScopeBadgeText} numberOfLines={1}>
                {chartMetric === "rpe"
                  ? selectedRpeExercise?.label || "Choose Exercise"
                  : `${selectedScopeLabel} · ${selectedGymLabel}`}
              </Text>
            </View>
          </View>

          {renderSegmentedControl(
            [
              { label: "Volume", value: "volume" },
              { label: "Sets", value: "sets" },
              { label: "Time", value: "time" },
              ...(showRpeAnalytics
                ? [{ label: "RPE", value: "rpe" as ChartMetric }]
                : []),
            ],
            chartMetric,
            setChartMetric,
          )}

          {chartMetric === "rpe" && (
            <>
              <View style={localStyles.rpeExerciseSection}>
                <Text style={localStyles.rpeExerciseLabel}>Exercise</Text>
                <TouchableOpacity
                  style={[
                    localStyles.rpeExerciseSelector,
                    !rpeExerciseOptions.length &&
                      localStyles.rpeExerciseSelectorDisabled,
                  ]}
                  disabled={!rpeExerciseOptions.length}
                  activeOpacity={0.8}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setRpeExerciseSearch("");
                    setIsRpeExercisePickerVisible(true);
                  }}
                >
                  <View style={localStyles.rpeExerciseSelectorTextWrap}>
                    <Text
                      style={localStyles.rpeExerciseSelectorText}
                      numberOfLines={2}
                    >
                      {selectedRpeExercise?.label ||
                        "No RPE exercises in this range"}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-down"
                    size={18}
                    color={
                      rpeExerciseOptions.length
                        ? Colors.text
                        : Colors.textMuted
                    }
                  />
                </TouchableOpacity>
              </View>

              {renderSegmentedControl(
                [
                  { label: "Working Sets", value: "working" },
                  { label: "Warm-up Sets", value: "warmup" },
                ],
                rpeScope,
                setRpeScope,
              )}
            </>
          )}

          {renderSegmentedControl(
            [
              { label: "Weekly", value: "weekly" },
              { label: "Monthly", value: "monthly" },
            ],
            chartPeriod,
            setChartPeriod,
          )}

          <View style={localStyles.trendValueRow}>
            <View style={localStyles.trendValuePrimary}>
              <Text style={localStyles.trendValueLabel}>
                {selectedTrendPoint?.label ||
                  (chartPeriod === "weekly" ? "Current Week" : "Current Month")}
              </Text>
              <Text
                style={localStyles.trendValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.72}
              >
                {selectedTrendPoint
                  ? chartMetric === "rpe"
                    ? formatRpePerformanceSet(
                        selectedTrendComparison.selectedRpeSet,
                        isGlobalKg,
                      )
                    : formatTrendValue(
                        selectedTrendComparison.selectedValue,
                        chartMetric,
                        isGlobalKg,
                      )
                  : chartMetric === "time"
                    ? "0m"
                    : chartMetric === "rpe"
                      ? "—"
                      : "0"}
              </Text>
            </View>

            {comparisonText && (
              <View
                style={[
                  localStyles.comparisonPill,
                  chartMetric === "rpe" && localStyles.comparisonPillNeutral,
                  chartMetric === "rpe" &&
                    localStyles.rpeComparisonPill,
                  chartMetric !== "rpe" &&
                    selectedTrendComparison.comparison !== null &&
                    selectedTrendComparison.comparison < 0 &&
                    localStyles.comparisonPillDown,
                ]}
              >
                <Ionicons
                  name={
                    chartMetric === "rpe"
                      ? "swap-horizontal"
                      : selectedTrendComparison.comparison !== null &&
                          selectedTrendComparison.comparison < 0
                        ? "trending-down"
                        : "trending-up"
                  }
                  size={13}
                  color={
                    chartMetric === "rpe"
                      ? Colors.textMuted
                      : selectedTrendComparison.comparison !== null &&
                          selectedTrendComparison.comparison < 0
                        ? Colors.danger
                        : Colors.accent
                  }
                />
                <Text
                  style={[
                    localStyles.comparisonPillText,
                    chartMetric === "rpe" &&
                      localStyles.comparisonPillTextNeutral,
                    chartMetric !== "rpe" &&
                      selectedTrendComparison.comparison !== null &&
                      selectedTrendComparison.comparison < 0 &&
                      localStyles.comparisonPillTextDown,
                  ]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {comparisonText}
                </Text>
              </View>
            )}
          </View>

          <Text style={localStyles.comparisonNote}>
            {selectedTrendComparison.note}
          </Text>

          {selectedTrendPoint && comparisonOptions.length > 0 && (
            <View style={localStyles.compareControlCard}>
              <View style={localStyles.compareControlTextWrap}>
                <Text style={localStyles.compareControlLabel}>
                  Compare with
                </Text>
                <Text style={localStyles.compareControlValue} numberOfLines={1}>
                  {selectedTrendComparison.comparisonRangeLabel ||
                    "Previous period"}
                </Text>
                <Text style={localStyles.compareControlSubtext}>
                  {chartMetric === "rpe"
                    ? formatRpePerformanceSet(
                        selectedTrendComparison.comparisonRpeSet,
                        isGlobalKg,
                      )
                    : formatTrendValue(
                        selectedTrendComparison.comparisonValue,
                        chartMetric,
                        isGlobalKg,
                      )}
                </Text>
              </View>
              <View style={localStyles.compareStepper}>
                <TouchableOpacity
                  style={[
                    localStyles.compareStepButton,
                    comparisonOptionIndex <= 0 &&
                      localStyles.compareStepButtonDisabled,
                  ]}
                  disabled={comparisonOptionIndex <= 0}
                  onPress={() => moveComparePeriod(-1)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="chevron-back"
                    size={18}
                    color={
                      comparisonOptionIndex <= 0
                        ? Colors.textMuted
                        : Colors.text
                    }
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    localStyles.compareStepButton,
                    comparisonOptionIndex >= comparisonOptions.length - 1 &&
                      localStyles.compareStepButtonDisabled,
                  ]}
                  disabled={
                    comparisonOptionIndex >= comparisonOptions.length - 1
                  }
                  onPress={() => moveComparePeriod(1)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={
                      comparisonOptionIndex >= comparisonOptions.length - 1
                        ? Colors.textMuted
                        : Colors.text
                    }
                  />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {renderTrendChart()}
        </View>
      </ScrollView>

      <Modal
        visible={isRpeExercisePickerVisible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setIsRpeExercisePickerVisible(false)}
      >
        <KeyboardAvoidingView
          style={localStyles.exercisePickerOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <TouchableOpacity
            style={localStyles.exercisePickerBackdrop}
            activeOpacity={1}
            accessibilityRole="button"
            accessibilityLabel="Close exercise selector"
            onPress={() => setIsRpeExercisePickerVisible(false)}
          />
          <View
            style={localStyles.exercisePickerSheet}
            accessibilityViewIsModal
          >
            <View style={localStyles.exercisePickerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={localStyles.exercisePickerEyebrow}>
                  RPE Progress
                </Text>
                <Text style={localStyles.exercisePickerTitle}>
                  Select Exercise
                </Text>
              </View>
              <TouchableOpacity
                style={localStyles.exercisePickerCloseButton}
                accessibilityRole="button"
                accessibilityLabel="Close exercise selector"
                onPress={() => setIsRpeExercisePickerVisible(false)}
              >
                <Ionicons name="close" size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <View style={localStyles.exercisePickerSearch}>
              <Ionicons name="search" size={19} color={Colors.textMuted} />
              <TextInput
                style={localStyles.exercisePickerSearchInput}
                value={rpeExerciseSearch}
                onChangeText={setRpeExerciseSearch}
                placeholder="Search tracked exercises..."
                placeholderTextColor={Colors.textMuted}
                autoCorrect={false}
                autoCapitalize="none"
                keyboardAppearance="dark"
                returnKeyType="search"
              />
              {!!rpeExerciseSearch && (
                <TouchableOpacity
                  style={localStyles.exercisePickerClearButton}
                  accessibilityRole="button"
                  accessibilityLabel="Clear exercise search"
                  onPress={() => setRpeExerciseSearch("")}
                >
                  <Ionicons
                    name="close-circle"
                    size={19}
                    color={Colors.textMuted}
                  />
                </TouchableOpacity>
              )}
            </View>

            <ScrollView
              style={localStyles.exercisePickerList}
              contentContainerStyle={localStyles.exercisePickerListContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {filteredRpeExerciseOptions.map((option) => {
                const selected = option.key === selectedRpeExerciseKey;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      localStyles.exercisePickerRow,
                      selected && localStyles.exercisePickerRowSelected,
                    ]}
                    activeOpacity={0.8}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSelectedRpeExerciseKey(option.key);
                      setIsRpeExercisePickerVisible(false);
                      setRpeExerciseSearch("");
                    }}
                  >
                    <Text
                      style={[
                        localStyles.exercisePickerRowText,
                        selected && localStyles.exercisePickerRowTextSelected,
                      ]}
                      numberOfLines={2}
                    >
                      {option.label}
                    </Text>
                    <Ionicons
                      name={selected ? "checkmark-circle" : "ellipse-outline"}
                      size={22}
                      color={selected ? Colors.accent : Colors.textMuted}
                    />
                  </TouchableOpacity>
                );
              })}

              {filteredRpeExerciseOptions.length === 0 && (
                <View style={localStyles.exercisePickerEmpty}>
                  <Ionicons
                    name="search-outline"
                    size={26}
                    color={Colors.textMuted}
                  />
                  <Text style={localStyles.exercisePickerEmptyText}>
                    No tracked exercises match this search.
                  </Text>
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const localStyles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
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
  chipRowCompact: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 4,
    marginBottom: 14,
  },
  rangeChip: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 11,
  },
  activeChip: {
    backgroundColor: Colors.accent,
  },
  chipText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "900",
  },
  activeChipText: {
    color: Colors.text,
  },
  filterCard: {
    backgroundColor: Colors.card,
    borderRadius: 22,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 9,
  },
  filterSectionTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  filterSectionValue: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    maxWidth: 180,
  },
  filterPillRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  filterScrollContent: {
    paddingRight: 8,
    paddingBottom: 14,
  },
  filterPill: {
    backgroundColor: Colors.surface,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    maxWidth: 170,
  },
  filterPillActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  filterPillText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "900",
  },
  filterPillTextActive: {
    color: Colors.background,
  },
  scopeNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 12,
    marginTop: 2,
  },
  scopeNoteText: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginLeft: 8,
  },
  summaryCard: {
    backgroundColor: Colors.card,
    borderRadius: 22,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summaryHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  summaryLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  summaryTitle: {
    color: Colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  rpeExerciseSection: {
    marginBottom: 12,
  },
  rpeExerciseLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  rpeExerciseSelector: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  rpeExerciseSelectorDisabled: {
    opacity: 0.62,
  },
  rpeExerciseSelectorTextWrap: {
    flex: 1,
    marginRight: 10,
  },
  rpeExerciseSelectorText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  syncPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(50, 215, 75, 0.12)",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  syncPillText: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: "900",
    marginLeft: 4,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statBox: {
    width: "48.5%",
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    minHeight: 82,
    justifyContent: "center",
  },
  statValue: {
    color: Colors.text,
    fontSize: 23,
    fontWeight: "900",
    marginBottom: 4,
  },
  statLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  trendCard: {
    backgroundColor: Colors.card,
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  trendHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  trendTitle: {
    color: Colors.text,
    fontSize: 19,
    fontWeight: "900",
  },
  trendScopeBadge: {
    backgroundColor: Colors.surface,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 132,
  },
  trendScopeBadgeText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
  },
  segmentedControl: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 4,
    marginBottom: 10,
  },
  segmentChip: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 11,
    alignItems: "center",
  },
  segmentChipActive: {
    backgroundColor: Colors.accent,
  },
  segmentChipText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
  },
  segmentChipTextActive: {
    color: Colors.background,
  },
  trendValueRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
    marginBottom: 12,
  },
  trendValuePrimary: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  trendValueLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    marginBottom: 3,
  },
  trendValue: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  comparisonPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(50, 215, 75, 0.12)",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
    maxWidth: 156,
    overflow: "hidden",
  },
  comparisonPillDown: {
    backgroundColor: "rgba(255, 69, 58, 0.12)",
  },
  comparisonPillNeutral: {
    backgroundColor: Colors.elevated,
  },
  rpeComparisonPill: {
    maxWidth: 132,
  },
  comparisonPillText: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: "900",
    marginLeft: 5,
    flexShrink: 1,
  },
  comparisonPillTextDown: {
    color: Colors.danger,
  },
  comparisonPillTextNeutral: {
    color: Colors.textMuted,
  },
  comparisonNote: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16,
    marginTop: -6,
    marginBottom: 12,
  },
  compareControlCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  compareControlTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  compareControlLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    marginBottom: 3,
  },
  compareControlValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 3,
  },
  compareControlSubtext: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
  },
  compareStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  compareStepButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  compareStepButtonDisabled: {
    opacity: 0.38,
  },
  chartArea: {
    height: 164,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingTop: 20,
    paddingBottom: 10,
    overflow: "hidden",
  },
  chartColumnWrap: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "flex-end",
    marginHorizontal: 2,
  },
  chartColumnTrackSelected: {
    borderColor: "rgba(50, 215, 75, 0.28)",
    backgroundColor: "rgba(50, 215, 75, 0.06)",
  },
  chartColumnTrackCompared: {
    borderColor: "rgba(255, 214, 10, 0.32)",
    backgroundColor: "rgba(255, 214, 10, 0.06)",
  },
  chartColumnTrack: {
    height: 124,
    width: "100%",
    justifyContent: "flex-end",
    alignItems: "center",
    position: "relative",
  },
  chartColumn: {
    width: "58%",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    backgroundColor: "rgba(50, 215, 75, 0.35)",
  },
  chartColumnCompared: {
    backgroundColor: "rgba(255, 214, 10, 0.62)",
  },
  chartColumnCurrent: {
    backgroundColor: Colors.accent,
  },
  chartColumnSelected: {
    backgroundColor: Colors.accent,
  },
  chartDot: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: Colors.surface,
  },
  chartDotCompared: {
    width: 9,
    height: 9,
    borderColor: Colors.warning,
  },
  chartDotCurrent: {
    width: 9,
    height: 9,
  },
  chartDotSelected: {
    width: 10,
    height: 10,
    borderColor: Colors.accent,
  },
  chartLabelCompared: {
    color: Colors.warning,
  },
  chartLabelSelected: {
    color: Colors.text,
  },
  chartLabel: {
    color: Colors.textMuted,
    fontSize: 9,
    fontWeight: "900",
    marginTop: 7,
  },
  trendEmptyState: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 22,
    alignItems: "center",
  },
  trendEmptyTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "900",
    marginTop: 10,
    marginBottom: 6,
  },
  trendEmptySubtitle: {
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  exercisePickerOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.68)",
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  exercisePickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  exercisePickerSheet: {
    width: "100%",
    maxWidth: 420,
    height: 520,
    maxHeight: "78%",
    backgroundColor: Colors.card,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
  },
  exercisePickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  exercisePickerEyebrow: {
    color: Colors.accent,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
    marginBottom: 3,
  },
  exercisePickerTitle: {
    color: Colors.text,
    fontSize: 21,
    fontWeight: "900",
  },
  exercisePickerCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.elevated,
  },
  exercisePickerSearch: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 13,
    marginBottom: 10,
  },
  exercisePickerSearchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    fontWeight: "700",
    paddingVertical: 11,
    paddingHorizontal: 9,
  },
  exercisePickerClearButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  exercisePickerList: {
    flex: 1,
    minHeight: 0,
  },
  exercisePickerListContent: {
    flexGrow: 1,
    paddingBottom: 12,
  },
  exercisePickerRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 8,
  },
  exercisePickerRowSelected: {
    borderColor: Colors.accent,
    backgroundColor: "rgba(50, 215, 75, 0.08)",
  },
  exercisePickerRowText: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 19,
    marginRight: 12,
  },
  exercisePickerRowTextSelected: {
    color: Colors.accent,
  },
  exercisePickerEmpty: {
    minHeight: 130,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  exercisePickerEmptyText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 8,
  },
});
