import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { styles as globalStyles } from "../constants/globalStyles";
import { auth, db } from "../config/firebaseConfig";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import FirstTimeOnboarding from "../components/FirstTimeOnboarding";
import CustomAlert from "../components/CustomAlert";
import { Colors } from "../theme";

const GREEN = Colors.accent;
const CARD = Colors.card;
const CARD_SOFT = Colors.surface;
const BORDER = Colors.border;
const MUTED = Colors.textMuted;

type HomeStats = {
  workouts: number;
  sets: number;
  volume: number;
  durationSeconds: number;
};

type SplitDay = {
  dayNumber: number;
  type: "rest" | "template";
  templateId?: string | null;
};

type TemplateFolder = {
  id: string;
  name: string;
  templateIds?: string[];
  cycleLength?: number;
  days?: SplitDay[];
  startDate?: number;
  createdAt?: number;
};

const startOfLocalDay = (value: number): number => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const getWorkoutTimestamp = (workout: any): number => {
  const startedAt = Number(workout?.startedAt);
  if (Number.isFinite(startedAt) && startedAt > 0) return startedAt;

  const idTime = Number(workout?.id);
  if (Number.isFinite(idTime) && idTime > 100000000000) return idTime;

  const parsedDate = Date.parse(workout?.date || "");
  return Number.isFinite(parsedDate) ? parsedDate : 0;
};

const formatWorkoutStartDate = (workout: any): string => {
  const timestamp = getWorkoutTimestamp(workout);
  if (!timestamp) return workout?.date || "Unknown Date";

  return new Date(timestamp).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const clampCycleLength = (value: any): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 7;
  return Math.max(2, Math.min(9, Math.round(parsed)));
};

const getTodaySplitIndex = (folder: TemplateFolder): number => {
  const cycleLength = clampCycleLength(folder.cycleLength ?? 7);
  const startDate = startOfLocalDay(
    folder.startDate || folder.createdAt || Date.now(),
  );
  const today = startOfLocalDay(Date.now());
  const diffDays = Math.max(0, Math.floor((today - startDate) / 86400000));
  return diffDays % cycleLength;
};

const hasConfiguredSplit = (folder: TemplateFolder): boolean => {
  return (
    Array.isArray(folder.days) &&
    folder.days.some((day) => day?.type === "template" && day.templateId)
  );
};

const parseDurationToSeconds = (duration: any): number => {
  if (duration === null || duration === undefined) return 0;

  if (typeof duration === "number") {
    return Number.isFinite(duration) ? Math.max(0, duration * 60) : 0;
  }

  if (typeof duration !== "string") return 0;

  const raw = duration.trim().toLowerCase();
  if (!raw) return 0;

  const colonParts = raw.split(":").map((part) => Number(part));
  if (
    colonParts.length > 1 &&
    colonParts.every((part) => Number.isFinite(part))
  ) {
    if (colonParts.length === 3) {
      return colonParts[0] * 3600 + colonParts[1] * 60 + colonParts[2];
    }

    if (colonParts.length === 2) {
      return colonParts[0] * 60 + colonParts[1];
    }
  }

  const hours = Number(raw.match(/(\d+(?:\.\d+)?)\s*h/)?.[1] || 0);
  const minutes = Number(raw.match(/(\d+(?:\.\d+)?)\s*m/)?.[1] || 0);
  const seconds = Number(raw.match(/(\d+(?:\.\d+)?)\s*s/)?.[1] || 0);

  if (hours || minutes || seconds) {
    return Math.max(0, hours * 3600 + minutes * 60 + seconds);
  }

  const numeric = Number(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(numeric) ? Math.max(0, numeric * 60) : 0;
};

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";

  const roundedSeconds = Math.round(seconds);
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const remainingSeconds = roundedSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${remainingSeconds}s`;
};

const getWorkoutExerciseCount = (workout: any): number => {
  if (!Array.isArray(workout?.fullWorkoutData)) return 0;
  return workout.fullWorkoutData.length;
};

const getWorkoutWorkingSetCount = (workout: any): number => {
  if (!Array.isArray(workout?.fullWorkoutData)) return 0;

  return workout.fullWorkoutData.reduce((total: number, exercise: any) => {
    if (!Array.isArray(exercise?.sets)) return total;

    return (
      total +
      exercise.sets.filter((set: any) => set?.completed && !set?.isWarmup)
        .length
    );
  }, 0);
};

export default function HomeScreen({ navigation }: any) {
  const [hasActiveWorkout, setHasActiveWorkout] = useState(false);
  const [activeWorkoutName, setActiveWorkoutName] = useState("Active Workout");
  const [activeExerciseCount, setActiveExerciseCount] = useState(0);
  const [displayName, setDisplayName] = useState("LIFTER");
  const [gymPromptVisible, setGymPromptVisible] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [folders, setFolders] = useState<TemplateFolder[]>([]);
  const [activeSplitFolderId, setActiveSplitFolderId] = useState<string | null>(
    null,
  );
  const [isGlobalKg, setIsGlobalKg] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const uid = auth.currentUser?.uid;

  const checkSession = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const [session, activeStart] = await Promise.all([
      AsyncStorage.getItem(`@active_session_${user.uid}`),
      AsyncStorage.getItem(`@active_workout_start_${user.uid}`),
    ]);

    if (!session || !activeStart) {
      if (session && !activeStart) {
        await AsyncStorage.removeItem(`@active_session_${user.uid}`);
      }
      setHasActiveWorkout(false);
      setActiveWorkoutName("Active Workout");
      setActiveExerciseCount(0);
      return;
    }

    try {
      const parsed = JSON.parse(session);
      const exerciseCount = Array.isArray(parsed.exercises)
        ? parsed.exercises.length
        : 0;

      if (exerciseCount === 0) {
        await AsyncStorage.removeItem(`@active_session_${user.uid}`);
        await AsyncStorage.removeItem(`@active_workout_start_${user.uid}`);
        setHasActiveWorkout(false);
        setActiveWorkoutName("Active Workout");
        setActiveExerciseCount(0);
        return;
      }

      setHasActiveWorkout(true);
      setActiveWorkoutName(parsed.workoutName || "Active Workout");
      setActiveExerciseCount(exerciseCount);
    } catch (error) {
      await AsyncStorage.removeItem(`@active_session_${user.uid}`);
      await AsyncStorage.removeItem(`@active_workout_start_${user.uid}`);
      setHasActiveWorkout(false);
      setActiveWorkoutName("Active Workout");
      setActiveExerciseCount(0);
    }
  };

  const loadUserData = async () => {
    const user = auth.currentUser;
    if (user) {
      const storedName = await AsyncStorage.getItem(
        `@user_username_${user.uid}`,
      );

      if (storedName) {
        setDisplayName(storedName);
      } else {
        try {
          let cloudName = null;
          const userDoc = await getDoc(doc(db, "users", user.uid));

          if (userDoc.exists() && userDoc.data().username) {
            cloudName = userDoc.data().username;
          } else {
            const q = query(
              collection(db, "usernames"),
              where("uid", "==", user.uid),
            );
            const qSnap = await getDocs(q);
            if (!qSnap.empty) {
              cloudName = qSnap.docs[0].data().display_name;
            }
          }

          if (cloudName) {
            setDisplayName(cloudName);
            await AsyncStorage.setItem(`@user_username_${user.uid}`, cloudName);
          }
        } catch (e) {
          console.log("Error fetching username fallback:", e);
        }
      }
    }
  };

  const loadDashboardData = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const pref = await AsyncStorage.getItem(`@user_metric_${user.uid}`);
    setIsGlobalKg(pref === "KG");

    const savedHistory = await AsyncStorage.getItem(
      `@workout_history_${user.uid}`,
    );
    const parsedHistory = savedHistory
      ? JSON.parse(savedHistory).filter((w: any) => w && w.id)
      : [];

    setHistory(
      parsedHistory.sort((a: any, b: any) => parseInt(b.id) - parseInt(a.id)),
    );

    const savedTemplates = await AsyncStorage.getItem(
      `@workout_templates_${user.uid}`,
    );
    const parsedTemplates = savedTemplates
      ? JSON.parse(savedTemplates).filter((t: any) => t && t.id)
      : [];

    setTemplates(
      parsedTemplates.sort((a: any, b: any) => parseInt(b.id) - parseInt(a.id)),
    );

    const savedFolders = await AsyncStorage.getItem(
      `@workout_folders_${user.uid}`,
    );
    const parsedFolders = savedFolders
      ? JSON.parse(savedFolders).filter((folder: any) => folder && folder.id)
      : [];
    setFolders(parsedFolders);

    const savedActiveSplitFolderId = await AsyncStorage.getItem(
      `@active_split_folder_${user.uid}`,
    );
    setActiveSplitFolderId(savedActiveSplitFolderId || null);
  };

  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      });
      checkSession();
      loadUserData();
      loadDashboardData();
    });
    return unsubscribe;
  }, [navigation]);

  const ensureGymBeforeStarting = async () => {
    const user = auth.currentUser;
    if (!user) return false;

    const savedGymsRaw = await AsyncStorage.getItem(`@user_gyms_${user.uid}`);
    let hasGyms = false;

    if (savedGymsRaw) {
      try {
        const parsedGyms = JSON.parse(savedGymsRaw);
        hasGyms = Array.isArray(parsedGyms) && parsedGyms.length > 0;
      } catch (e) {
        hasGyms = false;
      }
    }

    if (!hasGyms) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setGymPromptVisible(true);
      return false;
    }

    return true;
  };

  const resumeActiveWorkout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.navigate("Workout");
  };

  const startEmptyWorkout = async () => {
    const canStart = await ensureGymBeforeStarting();
    if (!canStart) return;

    if (uid && !hasActiveWorkout) {
      await AsyncStorage.setItem(`@last_search_filter_${uid}`, "All");
    }

    navigation.navigate("Workout");
  };

  const startTemplateWorkout = async (template: any) => {
    const canStart = await ensureGymBeforeStarting();
    if (!canStart) return;

    if (uid) {
      await AsyncStorage.setItem(`@last_search_filter_${uid}`, "All");
    }

    navigation.navigate("Workout", { templateData: template });
  };

  const weekStats = useMemo<HomeStats>(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const workoutsThisWeek = history.filter((w) => {
      const time = getWorkoutTimestamp(w);
      return Number.isFinite(time) && time >= sevenDaysAgo;
    });

    return workoutsThisWeek.reduce(
      (acc, workout) => {
        let volume = workout.volume || 0;
        if (isGlobalKg && workout.isKg === false) {
          volume = volume / 2.20462;
        } else if (!isGlobalKg && workout.isKg === true) {
          volume = volume * 2.20462;
        }

        let sets = 0;
        workout.fullWorkoutData?.forEach((ex: any) => {
          ex.sets?.forEach((set: any) => {
            if (set.completed && !set.isWarmup) sets += 1;
          });
        });

        acc.workouts += 1;
        acc.sets += sets;
        acc.volume += volume;
        acc.durationSeconds += parseDurationToSeconds(workout.duration);
        return acc;
      },
      { workouts: 0, sets: 0, volume: 0, durationSeconds: 0 },
    );
  }, [history, isGlobalKg]);

  const todaySplit = useMemo(() => {
    const templateMap = new Map(
      templates.map((template) => [String(template.id), template]),
    );
    const candidateFolders = folders.filter((folder) => folder && folder.id);

    const explicitActiveFolder = activeSplitFolderId
      ? candidateFolders.find((folder) => folder.id === activeSplitFolderId) ||
        null
      : null;

    const primaryFolder =
      explicitActiveFolder ||
      candidateFolders.find(
        (folder) =>
          folder.name?.toLowerCase() === "current split" &&
          hasConfiguredSplit(folder),
      ) ||
      candidateFolders.find((folder) => hasConfiguredSplit(folder)) ||
      candidateFolders.find(
        (folder) => folder.name?.toLowerCase() === "current split",
      ) ||
      candidateFolders[0] ||
      null;

    if (!primaryFolder) {
      return { state: "none" as const };
    }

    if (!hasConfiguredSplit(primaryFolder)) {
      return { state: "empty" as const, folder: primaryFolder };
    }

    const cycleLength = clampCycleLength(primaryFolder.cycleLength ?? 7);
    const dayIndex = getTodaySplitIndex(primaryFolder);
    const day = primaryFolder.days?.find(
      (item) => Number(item.dayNumber) === dayIndex + 1,
    ) || {
      dayNumber: dayIndex + 1,
      type: "rest" as const,
      templateId: null,
    };

    const template =
      day.type === "template" && day.templateId
        ? templateMap.get(String(day.templateId)) || null
        : null;

    if (!template) {
      return {
        state: "rest" as const,
        folder: primaryFolder,
        day,
        cycleLength,
      };
    }

    return {
      state: "template" as const,
      folder: primaryFolder,
      day,
      cycleLength,
      template,
    };
  }, [folders, templates, activeSplitFolderId]);



  const completedTodayWorkout = useMemo(() => {
    if (todaySplit.state !== "template") return null;

    const today = startOfLocalDay(Date.now());
    const templateId = String(todaySplit.template.id || "");
    const templateName = String(todaySplit.template.name || "").trim().toLowerCase();

    return (
      history.find((workout) => {
        const workoutDay = startOfLocalDay(getWorkoutTimestamp(workout));
        if (workoutDay !== today) return false;

        const workoutTemplateId = workout?.templateId ? String(workout.templateId) : "";
        if (templateId && workoutTemplateId && workoutTemplateId === templateId) return true;

        const workoutName = String(workout?.workoutName || "").trim().toLowerCase();
        return !!templateName && workoutName === templateName;
      }) || null
    );
  }, [history, todaySplit]);


  const lastWorkout = history[0];
  const lastTrainedText = lastWorkout
    ? startOfLocalDay(getWorkoutTimestamp(lastWorkout)) === startOfLocalDay(Date.now())
      ? "Today"
      : startOfLocalDay(getWorkoutTimestamp(lastWorkout)) ===
          startOfLocalDay(Date.now()) - 86400000
        ? "Yesterday"
        : formatWorkoutStartDate(lastWorkout)
    : "No workouts yet";

  const nextScheduledWorkout = useMemo(() => {
    if (todaySplit.state !== "template" && todaySplit.state !== "rest") return null;

    const folder: any = todaySplit.folder;
    const cycleLength = clampCycleLength(folder?.cycleLength ?? 7);
    const currentDayNumber = Number(todaySplit.day?.dayNumber || 1);
    const templateMap = new Map(
      templates.map((template) => [String(template.id), template]),
    );

    for (let offset = 1; offset <= cycleLength; offset += 1) {
      const dayNumber = ((currentDayNumber - 1 + offset) % cycleLength) + 1;
      const day = folder?.days?.find(
        (item: any) => Number(item?.dayNumber) === dayNumber,
      );
      if (day?.type !== "template" || !day.templateId) continue;

      const template: any = templateMap.get(String(day.templateId));
      if (!template) continue;

      return {
        dayNumber,
        name: template.name || `D${dayNumber}`,
        when: offset === 1 ? "Tomorrow" : `In ${offset} days`,
      };
    }

    return null;
  }, [todaySplit, templates]);

  const completedTodayExerciseCount = getWorkoutExerciseCount(completedTodayWorkout);
  const completedTodaySetCount = getWorkoutWorkingSetCount(completedTodayWorkout);
  const completedTodayDuration = formatDuration(
    parseDurationToSeconds(completedTodayWorkout?.duration),
  );

  const volumeUnit = isGlobalKg ? "kg" : "lbs";
  const formattedVolume =
    weekStats.volume >= 1000
      ? `${(weekStats.volume / 1000).toFixed(1)}k`
      : Math.round(weekStats.volume).toString();

  const formattedDuration = formatDuration(weekStats.durationSeconds);

  return (
    <SafeAreaView style={globalStyles.screen} edges={["top"]}>
      <FirstTimeOnboarding />

      <CustomAlert
        visible={gymPromptVisible}
        title="Set Up Your Gym"
        message="To accurately log machine variants and equipment settings, please add at least one gym in the Settings menu before starting."
        buttons={[
          {
            text: "Cancel",
            style: "cancel",
            onPress: () => setGymPromptVisible(false),
          },
          {
            text: "Go to Settings",
            style: "default",
            onPress: () => {
              setGymPromptVisible(false);
              navigation.navigate("Settings");
            },
          },
        ]}
        onClose={() => setGymPromptVisible(false)}
      />

      <ScrollView
        ref={scrollRef}
        style={localStyles.container}
        contentContainerStyle={localStyles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={localStyles.headerRow}>
          <View>
            <Text style={globalStyles.greeting}>Welcome back,</Text>
            <Text style={globalStyles.userName}>
              {displayName.toUpperCase()}
            </Text>
          </View>
        </View>

        {false && hasActiveWorkout && (
          <View style={localStyles.heroCard}>
            <View style={localStyles.heroIconWrap}>
              <Ionicons name="play" size={26} color="#000" />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={localStyles.heroEyebrow}>Workout in Progress</Text>
              <Text style={localStyles.heroTitle}>{activeWorkoutName}</Text>
              <Text style={localStyles.heroMeta}>
                {`${activeExerciseCount} exercise${activeExerciseCount === 1 ? "" : "s"} loaded`}
              </Text>
            </View>

            <TouchableOpacity
              style={localStyles.heroButton}
              onPress={resumeActiveWorkout}
            >
              <Text style={localStyles.heroButtonText}>Resume</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={localStyles.sectionHeader}>
          <Text style={localStyles.sectionTitle}>Today’s Training</Text>
          <TouchableOpacity onPress={() => navigation.navigate("Templates")}>
            <Text style={localStyles.sectionLink}>Manage Split</Text>
          </TouchableOpacity>
        </View>

        <View style={localStyles.todayCard}>
          <View style={localStyles.todayTopRow}>
            <View style={localStyles.todayIconWrap}>
              <Ionicons
                name={
                  hasActiveWorkout
                    ? "play"
                    : completedTodayWorkout
                    ? "checkmark-circle"
                    : todaySplit.state === "template"
                      ? "calendar"
                      : todaySplit.state === "rest"
                      ? "moon"
                      : "layers-outline"
                }
                size={20}
                color={hasActiveWorkout || completedTodayWorkout ? GREEN : todaySplit.state === "rest" ? MUTED : GREEN}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={localStyles.todayEyebrow}>
                {hasActiveWorkout
                  ? "Workout in Progress"
                  : completedTodayWorkout
                  ? "Completed Today"
                  : todaySplit.state === "none"
                    ? "No split configured"
                    : todaySplit.state === "empty"
                    ? todaySplit.folder.name
                    : `${todaySplit.folder.name} · D${todaySplit.day.dayNumber}`}
              </Text>
              <Text style={localStyles.todayTitle}>
                {hasActiveWorkout
                  ? activeWorkoutName
                  : completedTodayWorkout
                  ? todaySplit.state === "template"
                    ? todaySplit.template.name
                    : completedTodayWorkout?.workoutName || "Workout Complete"
                  : todaySplit.state === "template"
                    ? todaySplit.template.name
                    : todaySplit.state === "rest"
                    ? "Rest Day"
                    : todaySplit.state === "empty"
                      ? "Set up your split days"
                      : "Create your training split"}
              </Text>
              <Text style={localStyles.todayMeta}>
                {hasActiveWorkout
                  ? `${activeExerciseCount} exercise${activeExerciseCount === 1 ? "" : "s"} loaded · resume your session`
                  : completedTodayWorkout
                  ? `${completedTodayDuration} · ${completedTodayExerciseCount} exercise${completedTodayExerciseCount === 1 ? "" : "s"} · ${completedTodaySetCount} set${completedTodaySetCount === 1 ? "" : "s"}`
                  : todaySplit.state === "template"
                    ? `${todaySplit.template.exercises?.length || 0} exercises · ${todaySplit.cycleLength}-day cycle`
                    : todaySplit.state === "rest"
                    ? `No scheduled workout today · ${todaySplit.cycleLength}-day cycle`
                    : todaySplit.state === "empty"
                      ? "Assign templates or rest days to show your daily plan here."
                      : "Create a template folder and assign your training days to unlock daily workout suggestions."}
              </Text>
            </View>
          </View>

          <View
            style={
              hasActiveWorkout ||
              completedTodayWorkout ||
              todaySplit.state === "template" ||
              todaySplit.state === "empty" ||
              todaySplit.state === "none"
                ? localStyles.todayActionStack
                : localStyles.todayActionRow
            }
          >
            {hasActiveWorkout ? (
              <TouchableOpacity
                style={localStyles.todayPrimaryButton}
                onPress={resumeActiveWorkout}
              >
                <Text style={localStyles.todayPrimaryText} numberOfLines={1}>
                  Resume Workout
                </Text>
              </TouchableOpacity>
            ) : completedTodayWorkout ? (
              <>
                <TouchableOpacity
                  style={localStyles.todayPrimaryButton}
                  onPress={() => navigation.navigate("History")}
                >
                  <Text style={localStyles.todayPrimaryText} numberOfLines={1}>
                    View History
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={localStyles.todaySecondaryButton}
                  onPress={startEmptyWorkout}
                >
                  <Text
                    style={localStyles.todaySecondaryText}
                    numberOfLines={1}
                  >
                    Start Extra Workout
                  </Text>
                </TouchableOpacity>
              </>
            ) : todaySplit.state === "template" ? (
              <>
                <TouchableOpacity
                  style={localStyles.todayPrimaryButton}
                  onPress={() => startTemplateWorkout(todaySplit.template)}
                >
                  <Text style={localStyles.todayPrimaryText} numberOfLines={1}>
                    Start {todaySplit.template.name}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={localStyles.todaySecondaryButton}
                  onPress={startEmptyWorkout}
                >
                  <Text
                    style={localStyles.todaySecondaryText}
                    numberOfLines={1}
                  >
                    Start Empty Workout
                  </Text>
                </TouchableOpacity>
              </>
            ) : todaySplit.state === "rest" ? (
              <TouchableOpacity
                style={localStyles.todayPrimaryButton}
                onPress={startEmptyWorkout}
              >
                <Text style={localStyles.todayPrimaryText}>
                  Start Empty Workout
                </Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={localStyles.todayPrimaryButton}
                  onPress={() => navigation.navigate("Templates")}
                >
                  <Text style={localStyles.todayPrimaryText}>Set Up Split</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={localStyles.todaySecondaryButton}
                  onPress={startEmptyWorkout}
                >
                  <Text style={localStyles.todaySecondaryText}>
                    Start Empty Workout
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

        <View style={localStyles.sectionHeader}>
          <Text style={localStyles.sectionTitle}>This Week</Text>
          <TouchableOpacity onPress={() => navigation.navigate("History")}>
            <Text style={localStyles.sectionLink}>View History</Text>
          </TouchableOpacity>
        </View>

        <View style={localStyles.statsGrid}>
          <StatCard label="Workouts" value={weekStats.workouts.toString()} />
          <StatCard label="Sets" value={weekStats.sets.toString()} />
          <StatCard label="Volume" value={`${formattedVolume} ${volumeUnit}`} />
          <StatCard label="Time" value={formattedDuration} />
        </View>

        <View style={localStyles.sectionHeader}>
          <Text style={localStyles.sectionTitle}>Training Momentum</Text>
          <TouchableOpacity onPress={() => navigation.navigate("ProgressStats")}>
            <Text style={localStyles.sectionLink}>View Stats</Text>
          </TouchableOpacity>
        </View>

        <View style={localStyles.momentumCard}>
          <View style={localStyles.momentumTopRow}>
            <View style={localStyles.momentumIconWrap}>
              <Ionicons name="trending-up" size={20} color={GREEN} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={localStyles.momentumTitle}>
                {weekStats.workouts > 0
                  ? `${weekStats.workouts} workout${weekStats.workouts === 1 ? "" : "s"} this week`
                  : "Build momentum this week"}
              </Text>
              <Text style={localStyles.momentumSubtitle}>
                {completedTodayWorkout
                  ? "Today’s split workout is completed."
                  : hasActiveWorkout
                    ? "Resume your active workout to keep today’s session moving."
                    : todaySplit.state === "rest"
                      ? "Rest day logged in your current split cycle."
                      : "Stay consistent and keep your training week moving."}
              </Text>
            </View>
          </View>

          <View style={localStyles.momentumRows}>
            <MomentumRow
              icon="time-outline"
              label="Last trained"
              value={lastTrainedText}
            />
            <MomentumRow
              icon="calendar-outline"
              label="Next scheduled"
              value={
                nextScheduledWorkout
                  ? `${nextScheduledWorkout.when} · D${nextScheduledWorkout.dayNumber} ${nextScheduledWorkout.name}`
                  : todaySplit.state === "none"
                    ? "Create a split to unlock schedule insight"
                    : "Assign templates to your split days"
              }
            />
            <MomentumRow
              icon="barbell-outline"
              label="Weekly work"
              value={`${weekStats.sets} set${weekStats.sets === 1 ? "" : "s"} · ${formattedVolume} ${volumeUnit}`}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={localStyles.statCard}>
      <Text style={localStyles.statValue}>{value}</Text>
      <Text style={localStyles.statLabel}>{label}</Text>
    </View>
  );
}

function MomentumRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={localStyles.momentumRow}>
      <View style={localStyles.momentumRowIcon}>
        <Ionicons name={icon} size={15} color={MUTED} />
      </View>
      <Text style={localStyles.momentumRowLabel}>{label}</Text>
      <Text style={localStyles.momentumRowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 18,
  },
  headerRow: {
    marginBottom: 24,
  },
  heroCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD,
    borderRadius: 28,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 26,
  },
  heroIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: GREEN,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  heroEyebrow: {
    color: GREEN,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginBottom: 4,
  },
  heroTitle: {
    color: "#FFF",
    fontSize: 19,
    fontWeight: "900",
    marginBottom: 4,
  },
  heroMeta: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
  },
  heroButton: {
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginLeft: 10,
  },
  heroButtonText: {
    color: "#000",
    fontSize: 13,
    fontWeight: "900",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "900",
  },
  sectionLink: {
    color: GREEN,
    fontSize: 13,
    fontWeight: "900",
  },

  todayCard: {
    backgroundColor: CARD,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 26,
  },
  todayTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  todayIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(50, 215, 75, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  todayEyebrow: {
    color: GREEN,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.7,
    marginBottom: 4,
  },
  todayTitle: {
    color: "#FFF",
    fontSize: 19,
    fontWeight: "900",
    marginBottom: 4,
  },
  todayMeta: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  todayActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  todayActionStack: {
    flexDirection: "column",
    gap: 10,
  },
  todayPrimaryButton: {
    flex: 1,
    backgroundColor: GREEN,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: "center",
  },
  todayPrimaryText: {
    color: "#000",
    fontSize: 13,
    fontWeight: "900",
  },
  todaySecondaryButton: {
    flex: 1,
    backgroundColor: CARD_SOFT,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: "center",
    borderWidth: 1,
    borderColor: BORDER,
  },
  todaySecondaryText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "900",
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 26,
  },
  statCard: {
    width: "48.5%",
    backgroundColor: CARD_SOFT,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  statValue: {
    color: "#FFF",
    fontSize: 21,
    fontWeight: "900",
    marginBottom: 4,
  },
  statLabel: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  card: {
    backgroundColor: CARD,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 26,
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
  },
  cardTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 4,
  },
  cardMeta: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
  },
  exercisePreviewWrap: {
    gap: 8,
  },
  exercisePreviewText: {
    color: "#E5E5EA",
    fontSize: 14,
    fontWeight: "800",
  },
  exerciseMoreText: {
    color: GREEN,
    fontSize: 13,
    fontWeight: "900",
    marginTop: 2,
  },

  momentumCard: {
    backgroundColor: CARD,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 26,
  },
  momentumTopRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  momentumIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(50, 215, 75, 0.12)",
    marginRight: 12,
  },
  momentumTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "900",
    marginBottom: 4,
  },
  momentumSubtitle: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700",
  },
  momentumRows: {
    gap: 10,
  },
  momentumRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: CARD_SOFT,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  momentumRowIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD,
    marginRight: 10,
  },
  momentumRowLabel: {
    color: MUTED,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    width: 104,
  },
  momentumRowValue: {
    flex: 1,
    color: "#FFF",
    fontSize: 13,
    fontWeight: "900",
    textAlign: "right",
  },
  emptyCard: {
    backgroundColor: CARD_SOFT,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 26,
  },
  emptyTitle: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 6,
  },
  emptyMeta: {
    color: MUTED,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
  },
});
