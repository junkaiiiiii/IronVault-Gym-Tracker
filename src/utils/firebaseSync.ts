import AsyncStorage from "@react-native-async-storage/async-storage";
import { db, auth } from "../config/firebaseConfig";
import {
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  query,
  orderBy,
  writeBatch,
} from "firebase/firestore";
import { z } from "zod";

const WorkoutSchema = z
  .object({
    id: z.string().max(100),
    date: z.string().max(50),
    workoutName: z.string().max(150),
    volume: z.number().nonnegative(),
    isKg: z.boolean().optional(),
    gymId: z.string().max(100).nullable().optional(),
    gymName: z.string().max(100).nullable().optional(),
    duration: z.union([z.string().max(50), z.number()]).optional(),
    prType: z.string().max(100).nullable().optional(),
    fullWorkoutData: z.array(z.any()).max(150).optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    completedAt: z.number().optional(),
    startedAt: z.number().optional(),
    finishedAt: z.number().optional(),
    timestamp: z.number().optional(),
  })
  .strip();

type ConfigKey =
  | "templates"
  | "personal_exercises"
  | "folders"
  | "gyms"
  | "global_variants"
  | "favorite_exercises"
  | "sync_status";

const getUid = () => auth.currentUser?.uid || null;

const safeJsonParse = <T = any>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.error("Failed to parse local JSON:", error);
    return fallback;
  }
};

const stripUndefinedDeep = (value: any): any => {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep).filter((item) => item !== undefined);
  }

  if (value && typeof value === "object") {
    return Object.entries(value).reduce((acc: any, [key, item]) => {
      const cleaned = stripUndefinedDeep(item);
      if (cleaned !== undefined) acc[key] = cleaned;
      return acc;
    }, {});
  }

  return value === undefined ? undefined : value;
};

const normalizeForFirestore = (value: any) => stripUndefinedDeep(value);

const isNonEmptyArray = (value: any): value is any[] =>
  Array.isArray(value) && value.length > 0;

const dedupeStringArray = (values: any[] = []) => {
  const byKey = new Map<string, string>();
  values
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const key = item.toLowerCase().replace(/\s+/g, " ");
      if (!byKey.has(key)) byKey.set(key, item);
    });

  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
};

const getItemKey = (item: any) => {
  if (!item) return null;
  if (item.id !== undefined && item.id !== null) return String(item.id);
  if (item.name !== undefined && item.name !== null)
    return `name:${String(item.name).toLowerCase()}`;
  if (item.exercise_name !== undefined && item.exercise_name !== null) {
    return `exercise:${String(item.exercise_name).toLowerCase()}`;
  }
  return null;
};

const getTimestamp = (item: any) => {
  const candidates = [
    item?.updatedAt,
    item?.completedAt,
    item?.timestamp,
    item?.createdAt,
    item?.lastUsedAt,
    item?.id,
  ];

  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return 0;
};

const getCompletenessScore = (item: any) => {
  if (!item) return 0;
  let score = 0;

  if (Array.isArray(item.exercises)) score += item.exercises.length * 10000;
  if (Array.isArray(item.fullWorkoutData))
    score += item.fullWorkoutData.length * 10000;
  if (Array.isArray(item.sets)) score += item.sets.length * 1000;
  if (Array.isArray(item.days)) score += item.days.length * 500;
  if (Array.isArray(item.variants)) score += item.variants.length * 200;

  return score + JSON.stringify(item).length;
};

const chooseBestCopy = (localItem: any, cloudItem: any) => {
  if (!localItem) return cloudItem;
  if (!cloudItem) return localItem;

  const localScore = getCompletenessScore(localItem);
  const cloudScore = getCompletenessScore(cloudItem);

  if (localScore > cloudScore) return localItem;
  if (cloudScore > localScore) return cloudItem;

  const localTime = getTimestamp(localItem);
  const cloudTime = getTimestamp(cloudItem);

  return cloudTime > localTime ? cloudItem : localItem;
};

const mergeArrayByKey = (localItems: any[] = [], cloudItems: any[] = []) => {
  const merged = new Map<string, any>();
  const unkeyed: any[] = [];

  const add = (item: any, source: "local" | "cloud", index: number) => {
    if (!item) return;
    const key = getItemKey(item);

    if (!key) {
      unkeyed.push(item);
      return;
    }

    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      return;
    }

    merged.set(
      key,
      source === "local"
        ? chooseBestCopy(item, existing)
        : chooseBestCopy(existing, item),
    );
  };

  localItems.forEach((item, index) => add(item, "local", index));
  cloudItems.forEach((item, index) => add(item, "cloud", index));

  return [...Array.from(merged.values()), ...unkeyed];
};

const getWorkoutCompletenessScore = (workout: any) => {
  if (!workout) return 0;

  const exercises = Array.isArray(workout.fullWorkoutData)
    ? workout.fullWorkoutData
    : [];

  const completedSetCount = exercises.reduce((total: number, exercise: any) => {
    const sets = Array.isArray(exercise?.sets) ? exercise.sets : [];
    return total + sets.length;
  }, 0);

  return (
    exercises.length * 10000 +
    completedSetCount * 100 +
    JSON.stringify(workout).length
  );
};

const chooseMostCompleteWorkout = (localWorkout: any, cloudWorkout: any) => {
  if (!localWorkout) return cloudWorkout;
  if (!cloudWorkout) return localWorkout;

  const localScore = getWorkoutCompletenessScore(localWorkout);
  const cloudScore = getWorkoutCompletenessScore(cloudWorkout);

  if (localScore > cloudScore) return localWorkout;
  if (cloudScore > localScore) return cloudWorkout;

  const localTime = getTimestamp(localWorkout);
  const cloudTime = getTimestamp(cloudWorkout);

  return cloudTime > localTime ? cloudWorkout : localWorkout;
};

export const mergeWorkoutHistories = (
  localWorkouts: any[] = [],
  cloudWorkouts: any[] = [],
) => {
  const map = new Map<string, any>();

  const addWorkout = (workout: any, source: "local" | "cloud") => {
    if (!workout || !workout.id) return;

    const id = String(workout.id);
    const normalisedWorkout = { ...workout, id };
    const existing = map.get(id);

    if (!existing) {
      map.set(id, normalisedWorkout);
      return;
    }

    map.set(
      id,
      source === "local"
        ? chooseMostCompleteWorkout(normalisedWorkout, existing)
        : chooseMostCompleteWorkout(existing, normalisedWorkout),
    );
  };

  localWorkouts.forEach((workout) => addWorkout(workout, "local"));
  cloudWorkouts.forEach((workout) => addWorkout(workout, "cloud"));

  return Array.from(map.values()).sort(
    (a: any, b: any) => getTimestamp(b) - getTimestamp(a),
  );
};

export const getLocalWorkoutHistory = async (uidOverride?: string) => {
  const uid = uidOverride || getUid();
  if (!uid) return [];

  const raw = await AsyncStorage.getItem(`@workout_history_${uid}`);
  const parsed = safeJsonParse<any[]>(raw, []);
  return Array.isArray(parsed) ? parsed.filter((w: any) => w && w.id) : [];
};

export const saveLocalWorkoutHistory = async (
  workouts: any[],
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  if (!uid) return;

  await AsyncStorage.setItem(
    `@workout_history_${uid}`,
    JSON.stringify(workouts.filter((w: any) => w && w.id)),
  );
};

const sanitizeWorkoutsForCloud = (workouts: any[]) => {
  const sanitized: any[] = [];

  workouts.forEach((workout) => {
    try {
      sanitized.push(WorkoutSchema.parse(workout));
    } catch (error) {
      console.error(
        "Security Alert: Malformed workout payload rejected during bulk sync.",
        error,
      );
    }
  });

  return sanitized;
};

export const pushWorkoutListToCloud = async (workouts: any[]) => {
  const uid = getUid();
  if (!uid || workouts.length === 0) return { uploaded: 0 };

  const sanitizedWorkouts = sanitizeWorkoutsForCloud(workouts);
  const chunkSize = 450;
  let uploaded = 0;

  for (let i = 0; i < sanitizedWorkouts.length; i += chunkSize) {
    const batch = writeBatch(db);
    const chunk = sanitizedWorkouts.slice(i, i + chunkSize);

    chunk.forEach((workout) => {
      batch.set(doc(db, "users", uid, "workouts", workout.id), workout, {
        merge: true,
      });
    });

    await batch.commit();
    uploaded += chunk.length;
  }

  return { uploaded };
};

export const pushAllLocalWorkoutsToCloud = async () => {
  const uid = getUid();
  if (!uid) return { uploaded: 0, localCount: 0 };

  const localWorkouts = await getLocalWorkoutHistory(uid);
  const result = await pushWorkoutListToCloud(localWorkouts);

  return {
    uploaded: result.uploaded,
    localCount: localWorkouts.length,
  };
};

export const fetchWorkoutsFromCloud = async () => {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  try {
    const q = query(
      collection(db, "users", uid, "workouts"),
      orderBy("id", "desc"),
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => doc.data()).filter((w: any) => w && w.id);
  } catch (error) {
    console.error("Error fetching workouts from cloud:", error);
    return [];
  }
};

export const syncWorkoutHistoryWithCloud = async () => {
  const uid = getUid();
  if (!uid)
    return { localCount: 0, cloudCount: 0, mergedCount: 0, uploaded: 0 };

  const [localWorkouts, cloudWorkouts] = await Promise.all([
    getLocalWorkoutHistory(uid),
    fetchWorkoutsFromCloud(),
  ]);

  const mergedWorkouts = mergeWorkoutHistories(localWorkouts, cloudWorkouts);

  await saveLocalWorkoutHistory(mergedWorkouts, uid);
  const uploadResult = await pushWorkoutListToCloud(mergedWorkouts);

  return {
    localCount: localWorkouts.length,
    cloudCount: cloudWorkouts.length,
    mergedCount: mergedWorkouts.length,
    uploaded: uploadResult.uploaded,
  };
};

export const syncSettingsToCloud = async (settings: any) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  const normalizedSettings = { ...settings };
  if (normalizedSettings.timerEnabled !== undefined) {
    normalizedSettings.restTimerEnabled = normalizedSettings.timerEnabled;
  }
  if (normalizedSettings.restTimerEnabled !== undefined) {
    normalizedSettings.timerEnabled = normalizedSettings.restTimerEnabled;
  }

  await setDoc(
    doc(db, "users", uid),
    normalizeForFirestore({ ...normalizedSettings, updatedAt: Date.now() }),
    { merge: true },
  );
};

export const pushWorkoutToCloud = async (workout: any) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  try {
    const sanitizedWorkout = WorkoutSchema.parse(workout);

    await setDoc(
      doc(db, "users", uid, "workouts", sanitizedWorkout.id),
      normalizeForFirestore(sanitizedWorkout),
      { merge: true },
    );
  } catch (error) {
    console.error(
      "Security Alert: Malformed workout payload rejected by client validation.",
      error,
    );
  }
};

export const syncConfigToCloud = async (configKey: string, data: any) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  try {
    const configRef = doc(db, "users", uid, "configs", configKey);
    await setDoc(
      configRef,
      normalizeForFirestore({ data, updatedAt: Date.now() }),
      { merge: true },
    );
  } catch (error) {
    console.error(`Error syncing ${configKey} to cloud:`, error);
  }
};

export const syncTemplatesToCloud = async (templates: any[]) => {
  await syncConfigToCloud("templates", templates);
};

export const syncPersonalExercisesToCloud = async (exercises: any[]) => {
  await syncConfigToCloud("personal_exercises", exercises);
};

export const syncFavoriteExercisesToCloud = async (exerciseNames: string[]) => {
  await syncConfigToCloud("favorite_exercises", exerciseNames);
};

export const syncFoldersToCloud = async (folders: any[]) => {
  await syncConfigToCloud("folders", folders);
};

export const syncGymsToCloud = async (gyms: any[]) => {
  await syncConfigToCloud("gyms", gyms);
};

export const fetchSettingsFromCloud = async () => {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    const docSnap = await getDoc(doc(db, "users", uid));
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.error("Error fetching settings from cloud:", error);
    return null;
  }
};

export const fetchConfigFromCloud = async (type: ConfigKey) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    const docSnap = await getDoc(doc(db, "users", uid, "configs", type));
    return docSnap.exists() ? docSnap.data().data : null;
  } catch (error) {
    console.error("Error fetching config from cloud:", error);
    return null;
  }
};

const configKeyToLocalKey = (uid: string, configKey: ConfigKey) => {
  switch (configKey) {
    case "templates":
      return `@workout_templates_${uid}`;
    case "personal_exercises":
      return `@user_exercises_${uid}`;
    case "folders":
      return `@workout_folders_${uid}`;
    case "gyms":
      return `@user_gyms_${uid}`;
    case "global_variants":
      return `@global_variants_${uid}`;
    case "favorite_exercises":
      return `@favorite_exercises_${uid}`;
    default:
      return null;
  }
};

export const syncConfigWithCloud = async (configKey: ConfigKey) => {
  const uid = getUid();
  if (!uid)
    return { key: configKey, localCount: 0, cloudCount: 0, mergedCount: 0 };

  const localKey = configKeyToLocalKey(uid, configKey);
  if (!localKey)
    return { key: configKey, localCount: 0, cloudCount: 0, mergedCount: 0 };

  const [localRaw, cloudValue] = await Promise.all([
    AsyncStorage.getItem(localKey),
    fetchConfigFromCloud(configKey),
  ]);

  const localValue = safeJsonParse<any[]>(localRaw, []);
  const localArray = Array.isArray(localValue) ? localValue : [];
  const cloudArray = Array.isArray(cloudValue) ? cloudValue : [];

  const merged =
    configKey === "global_variants" || configKey === "favorite_exercises"
      ? dedupeStringArray([...localArray, ...cloudArray])
      : mergeArrayByKey(localArray, cloudArray);

  await AsyncStorage.setItem(localKey, JSON.stringify(merged));
  await syncConfigToCloud(configKey, merged);

  return {
    key: configKey,
    localCount: localArray.length,
    cloudCount: cloudArray.length,
    mergedCount: merged.length,
  };
};

const readLocalSetting = async (uid: string, key: string) =>
  AsyncStorage.getItem(`@${key}_${uid}`);

const writeLocalSetting = async (uid: string, key: string, value: any) => {
  if (value === undefined || value === null) return;
  await AsyncStorage.setItem(
    `@${key}_${uid}`,
    typeof value === "string" ? value : JSON.stringify(value),
  );
};

const removeLocalSetting = async (uid: string, key: string) => {
  await AsyncStorage.removeItem(`@${key}_${uid}`);
};

const pickLocalOrCloud = (
  localValue: string | null,
  cloudValue: any,
  fallback?: any,
) => {
  if (localValue !== null && localValue !== undefined) return localValue;
  if (cloudValue !== undefined && cloudValue !== null) return cloudValue;
  return fallback;
};

export const syncUserProfileAndSettingsWithCloud = async () => {
  const uid = getUid();
  if (!uid) return { synced: false };

  const cloudSettings: any = (await fetchSettingsFromCloud()) || {};

  const [
    usernameRaw,
    metricRaw,
    restTimeRaw,
    restTimerEnabledRaw,
    autoCheckEnabledRaw,
    plateCalcEnabledRaw,
    platesKgRaw,
    platesLbsRaw,
    plateInventoryRaw,
    setupCompleteRaw,
    lastUsedGymRaw,
    activeSplitFolderRaw,
  ] = await Promise.all([
    readLocalSetting(uid, "user_username"),
    readLocalSetting(uid, "user_metric"),
    readLocalSetting(uid, "rest_time"),
    readLocalSetting(uid, "rest_timer_enabled"),
    readLocalSetting(uid, "auto_check_enabled"),
    readLocalSetting(uid, "plate_calc_enabled"),
    readLocalSetting(uid, "plates_kg"),
    readLocalSetting(uid, "plates_lbs"),
    readLocalSetting(uid, "plate_inventory"),
    readLocalSetting(uid, "setup_complete"),
    readLocalSetting(uid, "last_used_gym"),
    readLocalSetting(uid, "active_split_folder"),
  ]);

  const restTimerCloud =
    cloudSettings.restTimerEnabled ?? cloudSettings.timerEnabled;

  const mergedSettings = {
    username: pickLocalOrCloud(usernameRaw, cloudSettings.username),
    metric: pickLocalOrCloud(metricRaw, cloudSettings.metric, "LBS"),
    restTime: Number(pickLocalOrCloud(restTimeRaw, cloudSettings.restTime, 90)),
    restTimerEnabled:
      String(pickLocalOrCloud(restTimerEnabledRaw, restTimerCloud, true)) ===
      "true",
    timerEnabled:
      String(pickLocalOrCloud(restTimerEnabledRaw, restTimerCloud, true)) ===
      "true",
    autoCheckEnabled:
      String(
        pickLocalOrCloud(
          autoCheckEnabledRaw,
          cloudSettings.autoCheckEnabled,
          false,
        ),
      ) === "true",
    plateCalcEnabled:
      String(
        pickLocalOrCloud(
          plateCalcEnabledRaw,
          cloudSettings.plateCalcEnabled,
          true,
        ),
      ) === "true",
    platesKg: safeJsonParse(platesKgRaw, cloudSettings.platesKg || undefined),
    platesLbs: safeJsonParse(
      platesLbsRaw,
      cloudSettings.platesLbs || undefined,
    ),
    plateInventory: safeJsonParse(
      plateInventoryRaw,
      cloudSettings.plateInventory || undefined,
    ),
    setupComplete:
      String(
        pickLocalOrCloud(setupCompleteRaw, cloudSettings.setupComplete, true),
      ) === "true",
    lastUsedGym: pickLocalOrCloud(lastUsedGymRaw, cloudSettings.lastUsedGym),
    activeSplitFolderId: pickLocalOrCloud(
      activeSplitFolderRaw,
      cloudSettings.activeSplitFolderId,
      null,
    ),
  };

  if (mergedSettings.username) {
    await writeLocalSetting(uid, "user_username", mergedSettings.username);
  }
  await writeLocalSetting(uid, "user_metric", mergedSettings.metric);
  await writeLocalSetting(uid, "rest_time", String(mergedSettings.restTime));
  await writeLocalSetting(
    uid,
    "rest_timer_enabled",
    String(mergedSettings.restTimerEnabled),
  );
  await writeLocalSetting(
    uid,
    "auto_check_enabled",
    String(mergedSettings.autoCheckEnabled),
  );
  await writeLocalSetting(
    uid,
    "plate_calc_enabled",
    String(mergedSettings.plateCalcEnabled),
  );
  if (mergedSettings.platesKg !== undefined)
    await writeLocalSetting(uid, "plates_kg", mergedSettings.platesKg);
  if (mergedSettings.platesLbs !== undefined)
    await writeLocalSetting(uid, "plates_lbs", mergedSettings.platesLbs);
  if (mergedSettings.plateInventory !== undefined) {
    await writeLocalSetting(
      uid,
      "plate_inventory",
      mergedSettings.plateInventory,
    );
  }
  await writeLocalSetting(
    uid,
    "setup_complete",
    String(mergedSettings.setupComplete),
  );
  if (mergedSettings.lastUsedGym)
    await writeLocalSetting(uid, "last_used_gym", mergedSettings.lastUsedGym);
  if (mergedSettings.activeSplitFolderId) {
    await writeLocalSetting(
      uid,
      "active_split_folder",
      mergedSettings.activeSplitFolderId,
    );
  }

  await syncSettingsToCloud(mergedSettings);

  return { synced: true };
};

export type CloudSyncStatus = {
  lastSyncedAt: number;
  success: boolean;
  workouts: number;
  templates: number;
  folders: number;
  personalExercises: number;
  favoriteExercises: number;
  gyms: number;
  machineBrands: number;
  uploadedWorkouts: number;
};

export const getLocalCloudSyncStatus = async (uidOverride?: string) => {
  const uid = uidOverride || getUid();
  if (!uid) return null;

  const raw = await AsyncStorage.getItem(`@cloud_sync_status_${uid}`);
  return safeJsonParse<CloudSyncStatus | null>(raw, null);
};

const saveCloudSyncStatus = async (
  status: CloudSyncStatus,
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  if (!uid) return;

  await AsyncStorage.setItem(
    `@cloud_sync_status_${uid}`,
    JSON.stringify(status),
  );
  await syncConfigToCloud("sync_status", status);
};

const validateActiveSplitAfterFolderSync = async (uid: string) => {
  const foldersRaw = await AsyncStorage.getItem(`@workout_folders_${uid}`);
  const folders = safeJsonParse<any[]>(foldersRaw, []);
  const folderIds = new Set(
    (Array.isArray(folders) ? folders : [])
      .map((folder: any) => folder?.id)
      .filter(Boolean)
      .map(String),
  );

  const activeSplitRaw = await readLocalSetting(uid, "active_split_folder");

  if (activeSplitRaw && folderIds.has(String(activeSplitRaw))) {
    await syncSettingsToCloud({ activeSplitFolderId: String(activeSplitRaw) });
    return String(activeSplitRaw);
  }

  await removeLocalSetting(uid, "active_split_folder");
  await syncSettingsToCloud({ activeSplitFolderId: null });
  return null;
};

const SETTINGS_BACKUP_KEYS = [
  "user_username",
  "user_metric",
  "rest_time",
  "rest_timer_enabled",
  "auto_check_enabled",
  "plate_calc_enabled",
  "plates_kg",
  "plates_lbs",
  "plate_inventory",
  "setup_complete",
  "last_used_gym",
  "active_split_folder",
] as const;

type IronVaultBackup = {
  app: "IronVault";
  type: "ironvault-backup";
  version: number;
  exportedAt: number;
  userId?: string | null;
  data: {
    workouts?: any[];
    templates?: any[];
    folders?: any[];
    personalExercises?: any[];
    favoriteExercises?: string[];
    gyms?: any[];
    machineBrands?: string[];
    settings?: Record<string, any>;
  };
};

const readBackupSettingValue = async (uid: string, key: string) => {
  const raw = await AsyncStorage.getItem(`@${key}_${uid}`);
  if (raw === null || raw === undefined) return null;

  if (["plates_kg", "plates_lbs", "plate_inventory"].includes(key)) {
    return safeJsonParse(raw, raw);
  }

  if (
    [
      "rest_timer_enabled",
      "auto_check_enabled",
      "plate_calc_enabled",
      "setup_complete",
    ].includes(key)
  ) {
    return raw === "true";
  }

  if (key === "rest_time") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }

  return raw;
};

const writeImportedSettingValue = async (
  uid: string,
  key: string,
  value: any,
) => {
  if (value === undefined || value === null) return;
  await AsyncStorage.setItem(
    `@${key}_${uid}`,
    typeof value === "string" ? value : JSON.stringify(value),
  );
};

const parseBackupArray = (value: any) => (Array.isArray(value) ? value : []);

export const buildIronVaultBackup = async (): Promise<IronVaultBackup> => {
  const uid = getUid();
  if (!uid) {
    throw new Error("You must be logged in to export data.");
  }

  const [
    workouts,
    templatesRaw,
    foldersRaw,
    personalExercisesRaw,
    favoriteExercisesRaw,
    gymsRaw,
    machineBrandsRaw,
  ] = await Promise.all([
    getLocalWorkoutHistory(uid),
    AsyncStorage.getItem(`@workout_templates_${uid}`),
    AsyncStorage.getItem(`@workout_folders_${uid}`),
    AsyncStorage.getItem(`@user_exercises_${uid}`),
    AsyncStorage.getItem(`@favorite_exercises_${uid}`),
    AsyncStorage.getItem(`@user_gyms_${uid}`),
    AsyncStorage.getItem(`@global_variants_${uid}`),
  ]);

  const settings: Record<string, any> = {};
  for (const key of SETTINGS_BACKUP_KEYS) {
    const value = await readBackupSettingValue(uid, key);
    if (value !== null && value !== undefined) settings[key] = value;
  }

  return {
    app: "IronVault",
    type: "ironvault-backup",
    version: 1,
    exportedAt: Date.now(),
    userId: uid,
    data: {
      workouts,
      templates: parseBackupArray(safeJsonParse(templatesRaw, [])),
      folders: parseBackupArray(safeJsonParse(foldersRaw, [])),
      personalExercises: parseBackupArray(
        safeJsonParse(personalExercisesRaw, []),
      ),
      favoriteExercises: dedupeStringArray(
        parseBackupArray(safeJsonParse(favoriteExercisesRaw, [])),
      ),
      gyms: parseBackupArray(safeJsonParse(gymsRaw, [])),
      machineBrands: dedupeStringArray(
        parseBackupArray(safeJsonParse(machineBrandsRaw, [])),
      ),
      settings,
    },
  };
};

export const importIronVaultBackup = async (backup: any) => {
  const uid = getUid();
  if (!uid) {
    throw new Error("You must be logged in to import data.");
  }

  if (
    !backup ||
    backup.app !== "IronVault" ||
    backup.type !== "ironvault-backup"
  ) {
    throw new Error("This is not a valid IronVault backup file.");
  }

  const data = backup.data || {};

  const [
    localWorkouts,
    templatesRaw,
    foldersRaw,
    personalExercisesRaw,
    favoriteExercisesRaw,
    gymsRaw,
    machineBrandsRaw,
  ] = await Promise.all([
    getLocalWorkoutHistory(uid),
    AsyncStorage.getItem(`@workout_templates_${uid}`),
    AsyncStorage.getItem(`@workout_folders_${uid}`),
    AsyncStorage.getItem(`@user_exercises_${uid}`),
    AsyncStorage.getItem(`@favorite_exercises_${uid}`),
    AsyncStorage.getItem(`@user_gyms_${uid}`),
    AsyncStorage.getItem(`@global_variants_${uid}`),
  ]);

  const mergedWorkouts = mergeWorkoutHistories(
    localWorkouts,
    parseBackupArray(data.workouts),
  );
  const mergedTemplates = mergeArrayByKey(
    parseBackupArray(safeJsonParse(templatesRaw, [])),
    parseBackupArray(data.templates),
  );
  const mergedFolders = mergeArrayByKey(
    parseBackupArray(safeJsonParse(foldersRaw, [])),
    parseBackupArray(data.folders),
  );
  const mergedPersonalExercises = mergeArrayByKey(
    parseBackupArray(safeJsonParse(personalExercisesRaw, [])),
    parseBackupArray(data.personalExercises),
  );
  const mergedFavoriteExercises = dedupeStringArray([
    ...parseBackupArray(safeJsonParse(favoriteExercisesRaw, [])),
    ...parseBackupArray(data.favoriteExercises),
  ]);
  const mergedGyms = mergeArrayByKey(
    parseBackupArray(safeJsonParse(gymsRaw, [])),
    parseBackupArray(data.gyms),
  );
  const mergedMachineBrands = dedupeStringArray([
    ...parseBackupArray(safeJsonParse(machineBrandsRaw, [])),
    ...parseBackupArray(data.machineBrands),
  ]);

  await Promise.all([
    saveLocalWorkoutHistory(mergedWorkouts, uid),
    AsyncStorage.setItem(
      `@workout_templates_${uid}`,
      JSON.stringify(mergedTemplates),
    ),
    AsyncStorage.setItem(
      `@workout_folders_${uid}`,
      JSON.stringify(mergedFolders),
    ),
    AsyncStorage.setItem(
      `@user_exercises_${uid}`,
      JSON.stringify(mergedPersonalExercises),
    ),
    AsyncStorage.setItem(
      `@favorite_exercises_${uid}`,
      JSON.stringify(mergedFavoriteExercises),
    ),
    AsyncStorage.setItem(`@user_gyms_${uid}`, JSON.stringify(mergedGyms)),
    AsyncStorage.setItem(
      `@global_variants_${uid}`,
      JSON.stringify(mergedMachineBrands),
    ),
  ]);

  if (data.settings && typeof data.settings === "object") {
    for (const key of SETTINGS_BACKUP_KEYS) {
      if (Object.prototype.hasOwnProperty.call(data.settings, key)) {
        await writeImportedSettingValue(uid, key, data.settings[key]);
      }
    }
  }

  await validateActiveSplitAfterFolderSync(uid);
  const syncResult = await syncEverythingWithCloud();

  return {
    workouts: mergedWorkouts.length,
    templates: mergedTemplates.length,
    folders: mergedFolders.length,
    personalExercises: mergedPersonalExercises.length,
    favoriteExercises: mergedFavoriteExercises.length,
    gyms: mergedGyms.length,
    machineBrands: mergedMachineBrands.length,
    syncResult,
  };
};

export const syncEverythingWithCloud = async () => {
  const uid = getUid();
  if (!uid) {
    return {
      workouts: { localCount: 0, cloudCount: 0, mergedCount: 0, uploaded: 0 },
      configs: [],
      settings: { synced: false },
    };
  }

  const [settings, workouts, ...configs] = await Promise.all([
    syncUserProfileAndSettingsWithCloud(),
    syncWorkoutHistoryWithCloud(),
    syncConfigWithCloud("templates"),
    syncConfigWithCloud("folders"),
    syncConfigWithCloud("personal_exercises"),
    syncConfigWithCloud("gyms"),
    syncConfigWithCloud("global_variants"),
    syncConfigWithCloud("favorite_exercises"),
  ]);

  await validateActiveSplitAfterFolderSync(uid);

  const getConfigCount = (key: string) =>
    configs.find((item: any) => item.key === key)?.mergedCount ?? 0;

  const syncStatus: CloudSyncStatus = {
    lastSyncedAt: Date.now(),
    success: true,
    workouts: workouts.mergedCount,
    templates: getConfigCount("templates"),
    folders: getConfigCount("folders"),
    personalExercises: getConfigCount("personal_exercises"),
    favoriteExercises: getConfigCount("favorite_exercises"),
    gyms: getConfigCount("gyms"),
    machineBrands: getConfigCount("global_variants"),
    uploadedWorkouts: workouts.uploaded,
  };

  await saveCloudSyncStatus(syncStatus, uid);

  return {
    workouts,
    configs,
    settings,
    syncStatus,
  };
};
