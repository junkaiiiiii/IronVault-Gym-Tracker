import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
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
  syncWorkoutHistoryWithCloud,
} from "../utils/firebaseSync";
import { styles } from "../constants/globalStyles";
import { Colors } from "../theme";

type RangeKey = "7D" | "30D" | "90D" | "1Y" | "ALL";
type ChartMetric = "volume" | "sets" | "time";
type ChartPeriod = "weekly" | "monthly";

const RANGE_OPTIONS: { label: string; value: RangeKey; days: number | null }[] = [
  { label: "7D", value: "7D", days: 7 },
  { label: "30D", value: "30D", days: 30 },
  { label: "90D", value: "90D", days: 90 },
  { label: "1Y", value: "1Y", days: 365 },
  { label: "All", value: "ALL", days: null },
];

const formatCompactNumber = (value: number) => {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}m`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value)}`;
};

const formatSignedPercent = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded === 0) return "No change vs previous";
  return `${rounded > 0 ? "+" : ""}${rounded}% vs previous`;
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

const addPeriod = (timestamp: number, period: ChartPeriod, amount: number) => {
  const date = new Date(timestamp);
  if (period === "weekly") date.setDate(date.getDate() + amount * 7);
  else date.setMonth(date.getMonth() + amount);
  return date.getTime();
};

const getPeriodStart = (timestamp: number, period: ChartPeriod) => {
  return period === "weekly" ? getWeekStart(timestamp) : getMonthStart(timestamp);
};

const formatPeriodLabel = (timestamp: number, period: ChartPeriod) => {
  const date = new Date(timestamp);
  if (period === "weekly") {
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString(undefined, { month: "short" });
};

const parseDurationToSeconds = (duration: any): number => {
  if (typeof duration === "number" && Number.isFinite(duration)) return Math.max(0, duration);
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

const getMetricLabel = (metric: ChartMetric) => {
  if (metric === "sets") return "Sets";
  if (metric === "time") return "Time";
  return "Volume";
};

const formatTrendValue = (value: number, metric: ChartMetric, isKg: boolean) => {
  if (metric === "time") return formatDuration(value);
  if (metric === "sets") return `${Math.round(value)}`;
  return `${formatCompactNumber(value)} ${isKg ? "kg" : "lbs"}`;
};

export default function ProgressStatsScreen({ navigation }: any) {
  const [history, setHistory] = useState<any[]>([]);
  const [selectedRange, setSelectedRange] = useState<RangeKey>("30D");
  const [isGlobalKg, setIsGlobalKg] = useState(false);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("volume");
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>("weekly");
  const [loading, setLoading] = useState(false);

  const uid = auth.currentUser?.uid;

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);

    try {
      const pref = await AsyncStorage.getItem(`@user_metric_${uid}`);
      setIsGlobalKg(pref === "KG");

      await syncWorkoutHistoryWithCloud();
      const mergedData = await getLocalWorkoutHistory(uid);
      setHistory(
        mergedData
          .filter((workout: any) => workout && workout.id)
          .sort((a: any, b: any) => getWorkoutTimestamp(b) - getWorkoutTimestamp(a)),
      );
    } catch (error) {
      console.error("Failed to load progress statistics:", error);
      const pref = await AsyncStorage.getItem(`@user_metric_${uid}`);
      setIsGlobalKg(pref === "KG");

      const saved = await AsyncStorage.getItem(`@workout_history_${uid}`);
      const localData = saved
        ? JSON.parse(saved).filter((workout: any) => workout && workout.id)
        : [];
      setHistory(
        localData.sort((a: any, b: any) => getWorkoutTimestamp(b) - getWorkoutTimestamp(a)),
      );
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", load);
    return unsubscribe;
  }, [navigation, load]);

  const rangeFilteredHistory = useMemo(() => {
    const activeRange = RANGE_OPTIONS.find((range) => range.value === selectedRange);
    if (!activeRange?.days) return history;

    const cutoff = Date.now() - activeRange.days * 24 * 60 * 60 * 1000;
    return history.filter((workout) => getWorkoutTimestamp(workout) >= cutoff);
  }, [history, selectedRange]);

  const summary = useMemo(() => {
    const workouts = rangeFilteredHistory.length;
    const sets = rangeFilteredHistory.reduce((sum, workout) => sum + getCompletedSets(workout), 0);
    const exercises = rangeFilteredHistory.reduce((sum, workout) => sum + getExerciseCount(workout), 0);
    const volume = rangeFilteredHistory.reduce(
      (sum, workout) => sum + convertVolume(workout, isGlobalKg),
      0,
    );
    const seconds = rangeFilteredHistory.reduce(
      (sum, workout) => sum + parseDurationToSeconds(workout?.duration),
      0,
    );

    return { workouts, sets, exercises, volume, seconds };
  }, [rangeFilteredHistory, isGlobalKg]);

  const trendData = useMemo(() => {
    const periodMap = new Map<
      number,
      { key: number; label: string; value: number; workouts: number }
    >();

    rangeFilteredHistory
      .filter((workout) => getWorkoutTimestamp(workout) > 0)
      .forEach((workout) => {
        const timestamp = getWorkoutTimestamp(workout);
        const key = getPeriodStart(timestamp, chartPeriod);
        const current = periodMap.get(key) || {
          key,
          label: formatPeriodLabel(key, chartPeriod),
          value: 0,
          workouts: 0,
        };

        if (chartMetric === "volume") current.value += convertVolume(workout, isGlobalKg);
        else if (chartMetric === "sets") current.value += getCompletedSets(workout);
        else current.value += parseDurationToSeconds(workout?.duration);

        current.workouts += 1;
        periodMap.set(key, current);
      });

    let points = Array.from(periodMap.values()).sort((a, b) => a.key - b.key);

    if (points.length > 0) {
      const firstKey = points[0].key;
      const lastKey = points[points.length - 1].key;
      const filled: { key: number; label: string; value: number; workouts: number }[] = [];

      for (let cursor = firstKey; cursor <= lastKey; cursor = addPeriod(cursor, chartPeriod, 1)) {
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
    if (points.length > maxPoints) points = points.slice(points.length - maxPoints);

    const current = points[points.length - 1] || null;
    const previous = points[points.length - 2] || null;
    const comparison =
      current && previous && previous.value > 0
        ? ((current.value - previous.value) / previous.value) * 100
        : null;

    return {
      points,
      current,
      previous,
      comparison,
      maxValue: Math.max(...points.map((point) => point.value), 0),
    };
  }, [rangeFilteredHistory, chartPeriod, chartMetric, isGlobalKg]);

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
            <Text style={[localStyles.chipText, active && localStyles.activeChipText]}>
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
            style={[localStyles.segmentChip, active && localStyles.segmentChipActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onChange(option.value);
            }}
          >
            <Text style={[localStyles.segmentChipText, active && localStyles.segmentChipTextActive]}>
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
          <Ionicons name="analytics-outline" size={28} color={Colors.textMuted} />
          <Text style={localStyles.trendEmptyTitle}>No trend data yet</Text>
          <Text style={localStyles.trendEmptySubtitle}>
            Complete workouts to see weekly and monthly progress trends.
          </Text>
        </View>
      );
    }

    return (
      <View style={localStyles.chartArea}>
        {points.map((point, index) => {
          const height = Math.max(8, Math.round((point.value / maxValue) * 112));
          const isCurrent = index === points.length - 1;
          const previous = points[index - 1];
          const direction = !previous
            ? "same"
            : point.value > previous.value
              ? "up"
              : point.value < previous.value
                ? "down"
                : "same";

          return (
            <View key={`${point.key}-${index}`} style={localStyles.chartColumnWrap}>
              <View style={localStyles.chartColumnTrack}>
                <View
                  style={[
                    localStyles.chartColumn,
                    { height },
                    isCurrent && localStyles.chartColumnCurrent,
                  ]}
                />
                <View
                  style={[
                    localStyles.chartDot,
                    {
                      bottom: height + 4,
                      backgroundColor:
                        direction === "down"
                          ? Colors.danger
                          : direction === "up"
                            ? Colors.accent
                            : Colors.textMuted,
                    },
                    isCurrent && localStyles.chartDotCurrent,
                  ]}
                />
              </View>
              <Text style={localStyles.chartLabel} numberOfLines={1}>
                {point.label}
              </Text>
            </View>
          );
        })}
      </View>
    );
  };

  const comparisonText = formatSignedPercent(trendData.comparison);

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

        <View style={localStyles.summaryCard}>
          <View style={localStyles.summaryHeaderRow}>
            <View>
              <Text style={localStyles.summaryLabel}>
                {selectedRange === "ALL" ? "Lifetime" : `Last ${selectedRange}`}
              </Text>
              <Text style={localStyles.summaryTitle}>Training Summary</Text>
            </View>
            <View style={localStyles.syncPill}>
              <Ionicons name="cloud-done-outline" size={13} color={Colors.accent} />
              <Text style={localStyles.syncPillText}>{loading ? "Syncing" : "Synced"}</Text>
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
              <Text style={localStyles.statValue}>{formatCompactNumber(summary.volume)}</Text>
              <Text style={localStyles.statLabel}>{isGlobalKg ? "kg" : "lbs"} Volume</Text>
            </View>
            <View style={localStyles.statBox}>
              <Text style={localStyles.statValue}>{formatDuration(summary.seconds)}</Text>
              <Text style={localStyles.statLabel}>Time</Text>
            </View>
          </View>
        </View>

        <View style={localStyles.trendCard}>
          <View style={localStyles.trendHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={localStyles.summaryLabel}>Progress Trend</Text>
              <Text style={localStyles.trendTitle}>
                {getMetricLabel(chartMetric)} · {chartPeriod === "weekly" ? "Weekly" : "Monthly"}
              </Text>
            </View>
            <View style={localStyles.trendScopeBadge}>
              <Text style={localStyles.trendScopeBadgeText}>All Training</Text>
            </View>
          </View>

          {renderSegmentedControl(
            [
              { label: "Volume", value: "volume" },
              { label: "Sets", value: "sets" },
              { label: "Time", value: "time" },
            ],
            chartMetric,
            setChartMetric,
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
            <View>
              <Text style={localStyles.trendValueLabel}>
                {chartPeriod === "weekly" ? "Current Week" : "Current Month"}
              </Text>
              <Text style={localStyles.trendValue}>
                {trendData.current
                  ? formatTrendValue(trendData.current.value, chartMetric, isGlobalKg)
                  : chartMetric === "time"
                    ? "0m"
                    : "0"}
              </Text>
            </View>

            {comparisonText && (
              <View
                style={[
                  localStyles.comparisonPill,
                  trendData.comparison !== null && trendData.comparison < 0 && localStyles.comparisonPillDown,
                ]}
              >
                <Ionicons
                  name={
                    trendData.comparison !== null && trendData.comparison < 0
                      ? "trending-down"
                      : "trending-up"
                  }
                  size={13}
                  color={
                    trendData.comparison !== null && trendData.comparison < 0
                      ? Colors.danger
                      : Colors.accent
                  }
                />
                <Text
                  style={[
                    localStyles.comparisonPillText,
                    trendData.comparison !== null &&
                      trendData.comparison < 0 &&
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

          {renderTrendChart()}
        </View>
      </ScrollView>
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
  chartColumnCurrent: {
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
  chartDotCurrent: {
    width: 9,
    height: 9,
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
});
