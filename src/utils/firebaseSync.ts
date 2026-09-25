import AsyncStorage from "@react-native-async-storage/async-storage";
import { db, auth } from "../config/firebaseConfig";
import {
  doc,
  setDoc,
  getDoc,
  collection,
  deleteDoc,
  getDocs,
  query,
  orderBy,
  writeBatch,
} from "firebase/firestore";
import { z } from "zod";
import { cleanStoredCustomExercises } from "./exerciseLibraryStorage";
import {
  DEFAULT_CABLE_ATTACHMENTS,
  cleanExerciseNameForAttachments,
  getExerciseAttachmentForStorage,
  getExerciseAttachmentForSave,
  getExerciseAttachmentOptions,
  hasExplicitNoAttachment,
  normalizeExerciseAttachment,
  normalizeExerciseForAttachmentStorage,
} from "./helpers";
import {
  LIMITS,
  clampRestSeconds,
  clampWorkoutDurationSeconds,
  cleanLimitedText,
  limitText,
  sanitizeRepsInput,
  sanitizeSetWeightInput,
} from "../constants/limits";
import { formatRpeValue } from "./rpe";

const WorkoutSchema = z
  .object({
    id: z.string().max(100),
    date: z.string().max(50),
    workoutName: z.string().max(LIMITS.nameChars),
    volume: z.number().nonnegative(),
    isKg: z.boolean().optional(),
    gymId: z.string().max(100).nullable().optional(),
    gymName: z.string().max(LIMITS.nameChars).nullable().optional(),
    duration: z.union([z.string().max(50), z.number()]).optional(),
    durationSeconds: z
      .number()
      .nonnegative()
      .max(LIMITS.workoutDurationHours * 60 * 60)
      .optional(),
    prType: z.string().max(100).nullable().optional(),
    fullWorkoutData: z
      .array(z.any())
      .max(LIMITS.exercisesPerWorkout)
      .optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    completedAt: z.number().optional(),
    startedAt: z.number().optional(),
    finishedAt: z.number().optional(),
    timestamp: z.number().optional(),
    totalPausedMs: z
      .number()
      .nonnegative()
      .max(LIMITS.workoutDurationHours * 60 * 60 * 1000)
      .optional(),
    rpeTrackingEnabled: z.boolean().optional(),
    prs: z.array(z.any()).max(100).optional(),
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

export type CloudRestoreCategory =
  | "workouts"
  | "templates"
  | "folders"
  | "personalExercises"
  | "favoriteExercises"
  | "gyms"
  | "machineBrands"
  | "settings";

const getUid = () => auth.currentUser?.uid || null;
const DELETABLE_CONFIG_KEYS = new Set<ConfigKey>([
  "templates",
  "personal_exercises",
  "folders",
  "gyms",
]);
const STRING_DELETABLE_CONFIG_KEYS = new Set<ConfigKey>([
  "global_variants",
  "favorite_exercises",
]);
const CONFIG_DELETE_TOMBSTONE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const CONFIG_DELETE_TOMBSTONE_LIMIT = 1000;
const HISTORY_EXERCISE_MIGRATION_VERSION = "history_exercise_cleanup_v1";

const isDeletableConfigKey = (configKey: ConfigKey | string) =>
  DELETABLE_CONFIG_KEYS.has(configKey as ConfigKey);

const isStringDeletableConfigKey = (configKey: ConfigKey | string) =>
  STRING_DELETABLE_CONFIG_KEYS.has(configKey as ConfigKey);

const configDeleteTombstoneKey = (uid: string, configKey: ConfigKey | string) =>
  `@deleted_config_ids_${configKey}_${uid}`;

const configValueTombstoneKey = (uid: string, configKey: ConfigKey | string) =>
  `@deleted_config_values_${configKey}_${uid}`;

const configNestedValueTombstoneKey = (
  uid: string,
  configKey: ConfigKey | string,
) => `@deleted_config_nested_values_${configKey}_${uid}`;

const getConfigItemIds = (items: any[] = []) =>
  (Array.isArray(items) ? items : [])
    .map((item) => String(item?.id ?? "").trim())
    .filter(Boolean);

const normalizeConfigStringValue = (value: any) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const normalizeDeletedConfigRecords = (value: any) => {
  const now = Date.now();
  const rawItems = Array.isArray(value) ? value : [];
  const byId = new Map<string, { id: string; deletedAt: number }>();

  rawItems.forEach((item) => {
    const id =
      typeof item === "string"
        ? item.trim()
        : String(item?.id ?? item?.itemId ?? "").trim();
    if (!id) return;

    const deletedAt =
      typeof item === "object" && Number.isFinite(Number(item?.deletedAt))
        ? Number(item.deletedAt)
        : now;

    if (now - deletedAt > CONFIG_DELETE_TOMBSTONE_MAX_AGE_MS) return;

    const existing = byId.get(id);
    if (!existing || deletedAt > existing.deletedAt) {
      byId.set(id, { id, deletedAt });
    }
  });

  return Array.from(byId.values())
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, CONFIG_DELETE_TOMBSTONE_LIMIT);
};

const normalizeDeletedConfigValueRecords = (value: any) => {
  const now = Date.now();
  const rawItems = Array.isArray(value) ? value : [];
  const byValue = new Map<string, { value: string; deletedAt: number }>();

  rawItems.forEach((item) => {
    const normalizedValue =
      typeof item === "string"
        ? normalizeConfigStringValue(item)
        : normalizeConfigStringValue(item?.value ?? item?.name);
    if (!normalizedValue) return;

    const deletedAt =
      typeof item === "object" && Number.isFinite(Number(item?.deletedAt))
        ? Number(item.deletedAt)
        : now;

    if (now - deletedAt > CONFIG_DELETE_TOMBSTONE_MAX_AGE_MS) return;

    const existing = byValue.get(normalizedValue);
    if (!existing || deletedAt > existing.deletedAt) {
      byValue.set(normalizedValue, { value: normalizedValue, deletedAt });
    }
  });

  return Array.from(byValue.values())
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, CONFIG_DELETE_TOMBSTONE_LIMIT);
};

const normalizeDeletedConfigNestedValueRecords = (value: any) => {
  const now = Date.now();
  const rawItems = Array.isArray(value) ? value : [];
  const byValue = new Map<
    string,
    { parentId: string; value: string; deletedAt: number }
  >();

  rawItems.forEach((item) => {
    const parentId = String(
      item?.parentId ?? item?.id ?? item?.gymId ?? "",
    ).trim();
    const normalizedValue = normalizeConfigStringValue(item?.value ?? item?.name);
    if (!parentId || !normalizedValue) return;

    const deletedAt =
      Number.isFinite(Number(item?.deletedAt)) ? Number(item.deletedAt) : now;

    if (now - deletedAt > CONFIG_DELETE_TOMBSTONE_MAX_AGE_MS) return;

    const key = `${parentId}:${normalizedValue}`;
    const existing = byValue.get(key);
    if (!existing || deletedAt > existing.deletedAt) {
      byValue.set(key, { parentId, value: normalizedValue, deletedAt });
    }
  });

  return Array.from(byValue.values())
    .sort((a, b) => b.deletedAt - a.deletedAt)
    .slice(0, CONFIG_DELETE_TOMBSTONE_LIMIT);
};

const readLocalDeletedConfigRecords = async (
  uid: string,
  configKey: ConfigKey | string,
) => {
  const raw = await AsyncStorage.getItem(
    configDeleteTombstoneKey(uid, configKey),
  );
  return normalizeDeletedConfigRecords(safeJsonParse(raw, []));
};

const readLocalDeletedConfigIds = async (
  uid: string,
  configKey: ConfigKey | string,
) =>
  readLocalDeletedConfigRecords(uid, configKey).then((records) =>
    records.map((record) => record.id),
  );

const readLocalDeletedConfigValueRecords = async (
  uid: string,
  configKey: ConfigKey | string,
) => {
  const raw = await AsyncStorage.getItem(
    configValueTombstoneKey(uid, configKey),
  );
  return normalizeDeletedConfigValueRecords(safeJsonParse(raw, []));
};

const readLocalDeletedConfigValues = async (
  uid: string,
  configKey: ConfigKey | string,
) =>
  readLocalDeletedConfigValueRecords(uid, configKey).then((records) =>
    records.map((record) => record.value),
  );

const readLocalDeletedConfigNestedValueRecords = async (
  uid: string,
  configKey: ConfigKey | string,
) => {
  const raw = await AsyncStorage.getItem(
    configNestedValueTombstoneKey(uid, configKey),
  );
  return normalizeDeletedConfigNestedValueRecords(safeJsonParse(raw, []));
};

const saveLocalDeletedConfigRecords = async (
  uid: string,
  configKey: ConfigKey | string,
  records: any[],
) => {
  const normalized = normalizeDeletedConfigRecords(records);
  if (normalized.length === 0) {
    await AsyncStorage.removeItem(configDeleteTombstoneKey(uid, configKey));
    return;
  }

  await AsyncStorage.setItem(
    configDeleteTombstoneKey(uid, configKey),
    JSON.stringify(normalized),
  );
};

const saveLocalDeletedConfigValueRecords = async (
  uid: string,
  configKey: ConfigKey | string,
  records: any[],
) => {
  const normalized = normalizeDeletedConfigValueRecords(records);
  if (normalized.length === 0) {
    await AsyncStorage.removeItem(configValueTombstoneKey(uid, configKey));
    return;
  }

  await AsyncStorage.setItem(
    configValueTombstoneKey(uid, configKey),
    JSON.stringify(normalized),
  );
};

const saveLocalDeletedConfigNestedValueRecords = async (
  uid: string,
  configKey: ConfigKey | string,
  records: any[],
) => {
  const normalized = normalizeDeletedConfigNestedValueRecords(records);
  if (normalized.length === 0) {
    await AsyncStorage.removeItem(configNestedValueTombstoneKey(uid, configKey));
    return;
  }

  await AsyncStorage.setItem(
    configNestedValueTombstoneKey(uid, configKey),
    JSON.stringify(normalized),
  );
};

const mergeDeletedConfigIdsLocally = async (
  uid: string,
  configKey: ConfigKey | string,
  ids: string[] = [],
) => {
  if (!isDeletableConfigKey(configKey) || ids.length === 0) return;

  const now = Date.now();
  const current = await readLocalDeletedConfigRecords(uid, configKey);
  await saveLocalDeletedConfigRecords(uid, configKey, [
    ...current,
    ...ids.map((id) => ({ id, deletedAt: now })),
  ]);
};

const mergeDeletedConfigValuesLocally = async (
  uid: string,
  configKey: ConfigKey | string,
  values: any[] = [],
) => {
  if (!isStringDeletableConfigKey(configKey) || values.length === 0) return;

  const normalizedValues = values.map(normalizeConfigStringValue).filter(Boolean);
  if (normalizedValues.length === 0) return;

  const now = Date.now();
  const current = await readLocalDeletedConfigValueRecords(uid, configKey);
  await saveLocalDeletedConfigValueRecords(uid, configKey, [
    ...current,
    ...normalizedValues.map((value) => ({ value, deletedAt: now })),
  ]);
};

const mergeDeletedConfigNestedValuesLocally = async (
  uid: string,
  configKey: ConfigKey | string,
  records: any[] = [],
) => {
  if (configKey !== "gyms" || records.length === 0) return;

  const current = await readLocalDeletedConfigNestedValueRecords(uid, configKey);
  await saveLocalDeletedConfigNestedValueRecords(uid, configKey, [
    ...current,
    ...records,
  ]);
};

export const markConfigItemsDeletedLocally = async (
  configKey: ConfigKey,
  items: any[] = [],
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  if (!uid || !isDeletableConfigKey(configKey)) return;

  await mergeDeletedConfigIdsLocally(uid, configKey, getConfigItemIds(items));
};

export const markConfigValuesDeletedLocally = async (
  configKey: ConfigKey,
  values: any[] = [],
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  if (!uid || !isStringDeletableConfigKey(configKey)) return;

  await mergeDeletedConfigValuesLocally(uid, configKey, values);
};

export const markGymVariantsDeletedLocally = async (
  gymId: string,
  values: any[] = [],
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  const parentId = String(gymId || "").trim();
  const normalizedValues = values.map(normalizeConfigStringValue).filter(Boolean);
  if (!uid || !parentId || normalizedValues.length === 0) return;

  const now = Date.now();
  await mergeDeletedConfigNestedValuesLocally(
    uid,
    "gyms",
    normalizedValues.map((value) => ({ parentId, value, deletedAt: now })),
  );
};

export const clearConfigItemsDeletedLocally = async (
  configKey: ConfigKey,
  items: any[] = [],
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  if (!uid || !isDeletableConfigKey(configKey)) return;

  const idsToClear = new Set(getConfigItemIds(items));
  if (idsToClear.size === 0) return;

  const current = await readLocalDeletedConfigRecords(uid, configKey);
  await saveLocalDeletedConfigRecords(
    uid,
    configKey,
    current.filter((record) => !idsToClear.has(record.id)),
  );
};

export const clearConfigValuesDeletedLocally = async (
  configKey: ConfigKey,
  values: any[] = [],
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  if (!uid || !isStringDeletableConfigKey(configKey)) return;

  const valuesToClear = new Set(
    values.map(normalizeConfigStringValue).filter(Boolean),
  );
  if (valuesToClear.size === 0) return;

  const current = await readLocalDeletedConfigValueRecords(uid, configKey);
  await saveLocalDeletedConfigValueRecords(
    uid,
    configKey,
    current.filter((record) => !valuesToClear.has(record.value)),
  );
};

export const clearGymVariantsDeletedLocally = async (
  gymId: string,
  values: any[] = [],
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  const parentId = String(gymId || "").trim();
  const valuesToClear = new Set(
    values.map(normalizeConfigStringValue).filter(Boolean),
  );
  if (!uid || !parentId || valuesToClear.size === 0) return;

  const current = await readLocalDeletedConfigNestedValueRecords(uid, "gyms");
  await saveLocalDeletedConfigNestedValueRecords(
    uid,
    "gyms",
    current.filter(
      (record) =>
        record.parentId !== parentId || !valuesToClear.has(record.value),
    ),
  );
};

export const safeJsonParse = <T = any>(
  value: string | null,
  fallback: T,
): T => {
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

const historyExerciseMigrationKey = (uid: string) =>
  `@${HISTORY_EXERCISE_MIGRATION_VERSION}_${uid}`;

const historyExerciseMigrationBackupKey = (uid: string) =>
  `@${HISTORY_EXERCISE_MIGRATION_VERSION}_backup_${uid}`;

const normalizeHistoryExerciseKey = (value: any) =>
  String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const getImpliedHistoricalAttachment = (
  originalName: any,
  normalizedName: any,
  existingAttachment: any,
) => {
  if (normalizeExerciseAttachment(existingAttachment)) return "";

  const originalKey = normalizeHistoryExerciseKey(originalName);
  const normalizedKey = normalizeHistoryExerciseKey(normalizedName);

  if (
    originalKey === "rope hammer curl" ||
    originalKey === "single arm rope hammer curl"
  ) {
    return "Rope";
  }

  if (normalizedKey === "cable chest fly") return "D-Handles";

  return "";
};

const formatHistoricalExerciseDisplayName = (exercise: any = {}) => {
  const parts = [cleanExerciseNameForAttachments(exercise) || "Exercise"];
  const variant = exercise?.exerciseVariant || exercise?.variation;
  const attachment = getExerciseAttachmentForStorage(exercise);
  if (variant && variant !== "Normal") parts.push(String(variant));
  if (attachment) parts.push(attachment);
  return parts.join(" · ");
};

const normalizeHistoryExerciseRecord = (
  exercise: any = {},
  options: { normalizeNested?: boolean } = {},
): any => {
  if (!exercise || typeof exercise !== "object") return exercise;

  const originalName = String(exercise?.name || "").trim();
  const normalizedName =
    cleanLimitedText(
      cleanExerciseNameForAttachments(exercise) || originalName || "Exercise",
      LIMITS.nameChars,
    ) || "Exercise";
  const storedAttachment = normalizeExerciseAttachment(
    getExerciseAttachmentForStorage(exercise),
  );
  const impliedAttachment = getImpliedHistoricalAttachment(
    originalName,
    normalizedName,
    storedAttachment,
  );
  const attachment = storedAttachment || impliedAttachment;
  const attachmentOptions = getExerciseAttachmentOptions({
    ...exercise,
    name: normalizedName,
    attachment,
  })
    .map((option) => cleanLimitedText(option, LIMITS.nameChars))
    .filter(Boolean)
    .slice(0, 16);
  const templateBaseExercise: any =
    options.normalizeNested !== false && exercise?.templateBaseExercise
      ? normalizeHistoryExerciseRecord(exercise.templateBaseExercise, {
          normalizeNested: false,
        })
      : exercise?.templateBaseExercise;

  return {
    ...exercise,
    name: normalizedName,
    attachment:
      (attachment || hasExplicitNoAttachment(exercise))
        ? attachment
        : undefined,
    attachmentOptions:
      attachmentOptions.length > 0 ? attachmentOptions : undefined,
    supportsAttachments:
      attachmentOptions.length > 0 || attachment
        ? true
        : exercise?.supportsAttachments === true
          ? true
          : undefined,
    templateBaseExercise,
  };
};

const normalizeHistoryPrRecord = (record: any = {}) => {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return record;
  }

  const exerciseContext = normalizeHistoryExerciseRecord({
    name: record.exerciseName || record.displayName || "Exercise",
    exerciseVariant: record.variant,
    attachment: record.attachment || undefined,
  });
  const attachment = getExerciseAttachmentForStorage(exerciseContext);

  return {
    ...record,
    exerciseName: exerciseContext.name || record.exerciseName || "Exercise",
    displayName: formatHistoricalExerciseDisplayName(exerciseContext),
    attachment: attachment || null,
  };
};

export const normalizeWorkoutHistoryExerciseRecords = (workouts: any[] = []) =>
  (Array.isArray(workouts) ? workouts : [])
    .filter((workout: any) => workout && workout.id)
    .map((workout: any) => ({
      ...workout,
      fullWorkoutData: Array.isArray(workout?.fullWorkoutData)
        ? workout.fullWorkoutData.map((exercise: any) =>
            normalizeHistoryExerciseRecord(exercise),
          )
        : [],
      prs: Array.isArray(workout?.prs)
        ? workout.prs.map((record: any) => normalizeHistoryPrRecord(record))
        : workout?.prs,
    }));

const countChangedHistoryExercises = (before: any[] = [], after: any[] = []) => {
  let workoutsChanged = 0;
  let exercisesChanged = 0;

  before.forEach((workout: any, workoutIndex: number) => {
    const nextWorkout = after[workoutIndex];
    if (JSON.stringify(workout) !== JSON.stringify(nextWorkout)) {
      workoutsChanged += 1;
    }

    const exercises = Array.isArray(workout?.fullWorkoutData)
      ? workout.fullWorkoutData
      : [];
    const nextExercises = Array.isArray(nextWorkout?.fullWorkoutData)
      ? nextWorkout.fullWorkoutData
      : [];

    exercises.forEach((exercise: any, exerciseIndex: number) => {
      if (
        JSON.stringify(exercise) !==
        JSON.stringify(nextExercises[exerciseIndex])
      ) {
        exercisesChanged += 1;
      }
    });
  });

  return { workoutsChanged, exercisesChanged };
};

export const migrateLocalWorkoutHistoryExerciseRecords = async (
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  if (!uid) {
    return { migrated: false, workoutsChanged: 0, exercisesChanged: 0 };
  }

  const migrationKey = historyExerciseMigrationKey(uid);
  const alreadyMigrated = await AsyncStorage.getItem(migrationKey);
  if (alreadyMigrated === "true") {
    return { migrated: false, workoutsChanged: 0, exercisesChanged: 0 };
  }

  const historyKey = `@workout_history_${uid}`;
  const raw = await AsyncStorage.getItem(historyKey);
  const parsed = safeJsonParse<any[]>(raw, []);
  const existingHistory = Array.isArray(parsed)
    ? parsed.filter((workout: any) => workout && workout.id)
    : [];
  const migratedHistory = normalizeWorkoutHistoryExerciseRecords(existingHistory);
  const changed = JSON.stringify(existingHistory) !== JSON.stringify(migratedHistory);
  const counts = countChangedHistoryExercises(existingHistory, migratedHistory);

  if (changed) {
    const backupKey = historyExerciseMigrationBackupKey(uid);
    const existingBackup = await AsyncStorage.getItem(backupKey);
    if (!existingBackup) {
      await AsyncStorage.setItem(
        backupKey,
        JSON.stringify({
          version: HISTORY_EXERCISE_MIGRATION_VERSION,
          createdAt: Date.now(),
          workouts: existingHistory,
        }),
      );
    }

    await AsyncStorage.setItem(historyKey, JSON.stringify(migratedHistory));
  }

  await AsyncStorage.setItem(migrationKey, "true");

  return {
    migrated: changed,
    workoutsChanged: counts.workoutsChanged,
    exercisesChanged: counts.exercisesChanged,
  };
};

const getCloudErrorMessage = (error: any) => {
  if (error?.message) return String(error.message).slice(0, 180);
  if (typeof error === "string") return error.slice(0, 180);
  return "Cloud sync failed.";
};

const saveLocalCloudSyncFailure = async (uid: string, error: any) => {
  const now = Date.now();
  const current = await getLocalCloudSyncStatus(uid);
  const failedStatus: CloudSyncStatus = {
    lastSyncedAt: current?.lastSyncedAt || 0,
    lastAttemptedAt: now,
    lastFailedAt: now,
    success: false,
    errorMessage: getCloudErrorMessage(error),
    workouts: current?.workouts || 0,
    templates: current?.templates || 0,
    folders: current?.folders || 0,
    personalExercises: current?.personalExercises || 0,
    favoriteExercises: current?.favoriteExercises || 0,
    gyms: current?.gyms || 0,
    machineBrands: current?.machineBrands || 0,
    settingsSynced: current?.settingsSynced || false,
    uploadedWorkouts: current?.uploadedWorkouts || 0,
  };

  await AsyncStorage.setItem(
    `@cloud_sync_status_${uid}`,
    JSON.stringify(failedStatus),
  );
};

const limitWorkoutSets = (sets: any[] = []) => {
  const warmups: any[] = [];
  const working: any[] = [];

  (Array.isArray(sets) ? sets : []).forEach((set) => {
    if (!set) return;
    const target = set.isWarmup ? warmups : working;
    const max = set.isWarmup
      ? LIMITS.warmupSetsPerExercise
      : LIMITS.workingSetsPerExercise;
    if (target.length >= max) return;
    target.push({
      ...set,
      weight: sanitizeSetWeightInput(String(set.weight ?? "")),
      reps: sanitizeRepsInput(String(set.reps ?? "")),
      repsL: sanitizeRepsInput(String(set.repsL ?? "")),
      repsR: sanitizeRepsInput(String(set.repsR ?? "")),
      rpe: formatRpeValue(set.rpe) || undefined,
    });
  });

  return [...warmups, ...working].sort(
    (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0),
  );
};

const sanitizeWorkoutExercises = (exercises: any[] = []) =>
  (Array.isArray(exercises) ? exercises : [])
    .slice(0, LIMITS.exercisesPerWorkout)
    .map((exercise) => {
      const normalizedExercise =
        normalizeExerciseForAttachmentStorage(exercise);
      const attachmentOptions =
        getExerciseAttachmentOptions(normalizedExercise)
          .map((option) => cleanLimitedText(option, LIMITS.nameChars))
          .filter(Boolean)
          .slice(0, 16);
      const attachment = cleanLimitedText(
        getExerciseAttachmentForSave(normalizedExercise),
        LIMITS.nameChars,
      );
      const explicitNoAttachment =
        hasExplicitNoAttachment(normalizedExercise);

      return {
        ...normalizedExercise,
        name: cleanLimitedText(
          normalizedExercise?.name || "Exercise",
          LIMITS.nameChars,
        ),
        reminder: limitText(
          normalizedExercise?.reminder,
          LIMITS.cueChars,
        ).trim(),
        remark: limitText(
          normalizedExercise?.remark,
          LIMITS.noteChars,
        ).trim(),
        attachment:
          (attachment || explicitNoAttachment) ? attachment : undefined,
        attachmentOptions:
          attachmentOptions.length > 0 ? attachmentOptions : undefined,
        supportsAttachments:
          attachmentOptions.length > 0
            ? true
            : normalizedExercise?.supportsAttachments === true
              ? true
              : undefined,
        equipmentTag: normalizedExercise?.equipmentTag
          ? cleanLimitedText(normalizedExercise.equipmentTag, LIMITS.nameChars)
          : normalizedExercise?.equipmentTag,
        machineBrand: normalizedExercise?.machineBrand
          ? cleanLimitedText(normalizedExercise.machineBrand, LIMITS.nameChars)
          : normalizedExercise?.machineBrand,
        brand: normalizedExercise?.brand
          ? cleanLimitedText(normalizedExercise.brand, LIMITS.nameChars)
          : normalizedExercise?.brand,
        sets: limitWorkoutSets(normalizedExercise?.sets || []),
      };
    });

const sanitizeHistoryWorkoutExercises = (exercises: any[] = []) =>
  (Array.isArray(exercises) ? exercises : [])
    .slice(0, LIMITS.exercisesPerWorkout)
    .map((exercise) => {
      const normalizedExercise = normalizeHistoryExerciseRecord(exercise);
      const attachmentOptions =
        getExerciseAttachmentOptions(normalizedExercise)
          .map((option) => cleanLimitedText(option, LIMITS.nameChars))
          .filter(Boolean)
          .slice(0, 16);
      const attachment = cleanLimitedText(
        getExerciseAttachmentForStorage(normalizedExercise),
        LIMITS.nameChars,
      );
      const explicitNoAttachment =
        hasExplicitNoAttachment(normalizedExercise);

      return {
        ...normalizedExercise,
        name: cleanLimitedText(
          normalizedExercise?.name || "Exercise",
          LIMITS.nameChars,
        ),
        reminder: limitText(
          normalizedExercise?.reminder,
          LIMITS.cueChars,
        ).trim(),
        remark: limitText(
          normalizedExercise?.remark,
          LIMITS.noteChars,
        ).trim(),
        attachment:
          (attachment || explicitNoAttachment) ? attachment : undefined,
        attachmentOptions:
          attachmentOptions.length > 0 ? attachmentOptions : undefined,
        supportsAttachments:
          attachmentOptions.length > 0 || attachment
            ? true
            : normalizedExercise?.supportsAttachments === true
              ? true
              : undefined,
        equipmentTag: normalizedExercise?.equipmentTag
          ? cleanLimitedText(normalizedExercise.equipmentTag, LIMITS.nameChars)
          : normalizedExercise?.equipmentTag,
        machineBrand: normalizedExercise?.machineBrand
          ? cleanLimitedText(normalizedExercise.machineBrand, LIMITS.nameChars)
          : normalizedExercise?.machineBrand,
        brand: normalizedExercise?.brand
          ? cleanLimitedText(normalizedExercise.brand, LIMITS.nameChars)
          : normalizedExercise?.brand,
        sets: limitWorkoutSets(normalizedExercise?.sets || []),
      };
    });

const sanitizeWorkoutForStorage = (workout: any) => {
  const historicalWorkout =
    normalizeWorkoutHistoryExerciseRecords([
      { ...workout, id: workout?.id || "workout" },
    ])[0] || workout;
  const durationSeconds =
    historicalWorkout?.durationSeconds !== undefined
      ? clampWorkoutDurationSeconds(historicalWorkout.durationSeconds)
      : historicalWorkout?.durationSeconds;

  return {
    ...historicalWorkout,
    workoutName:
      cleanLimitedText(historicalWorkout?.workoutName || "Workout", LIMITS.nameChars) ||
      "Workout",
    gymName: historicalWorkout?.gymName
      ? cleanLimitedText(historicalWorkout.gymName, LIMITS.nameChars)
      : historicalWorkout?.gymName,
    durationSeconds,
    fullWorkoutData: sanitizeHistoryWorkoutExercises(
      historicalWorkout?.fullWorkoutData || [],
    ),
  };
};

const sanitizeTemplateRecord = (template: any) => ({
  ...template,
  name:
    cleanLimitedText(template.name || "Template", LIMITS.nameChars) ||
    "Template",
  exercises: sanitizeWorkoutExercises(template.exercises || []),
});

const sanitizeTemplateList = (templates: any[] = []) =>
  mergeObjectsByIdentity(
    (Array.isArray(templates) ? templates : [])
      .filter((template) => template && template.id)
      .map(sanitizeTemplateRecord),
    chooseLatestTemplateCopy,
  )
    .items.slice(0, LIMITS.templatesPerUser);

export const sanitizeTemplatesForStorage = (templates: any[] = []) =>
  sanitizeTemplateList(templates);

const mergeFolderCopies = (existing: any, incoming: any) => {
  const chosen = chooseBestCopy(existing, incoming) || {};
  const templateIds = Array.from(
    new Set([
      ...(Array.isArray(existing?.templateIds) ? existing.templateIds : []),
      ...(Array.isArray(incoming?.templateIds) ? incoming.templateIds : []),
    ].filter(Boolean).map(String)),
  );

  return {
    ...chosen,
    templateIds,
  };
};

const sanitizeFolderList = (folders: any[] = []) =>
  mergeObjectsByIdentity(
    (Array.isArray(folders) ? folders : [])
      .filter(Boolean)
      .map((folder) => ({
        ...folder,
        name:
          cleanLimitedText(folder?.name || "Folder", LIMITS.nameChars) ||
          "Folder",
        templateIds: Array.isArray(folder?.templateIds)
          ? Array.from(new Set(folder.templateIds.filter(Boolean).map(String)))
          : [],
      })),
    mergeFolderCopies,
  )
    .items.slice(0, LIMITS.foldersPerUser);

export const sanitizeFoldersForStorage = (folders: any[] = []) =>
  sanitizeFolderList(folders);

const mergeGymCopies = (existing: any, incoming: any) => {
  const chosen = chooseBestCopy(existing, incoming) || {};
  const variants = dedupeStringArray([
    ...(Array.isArray(existing?.variants) ? existing.variants : []),
    ...(Array.isArray(incoming?.variants) ? incoming.variants : []),
  ]);
  const defaultMachineBrand =
    chosen.defaultMachineBrand ||
    incoming?.defaultMachineBrand ||
    existing?.defaultMachineBrand ||
    null;

  return {
    ...chosen,
    id: existing?.id || chosen.id,
    name: existing?.name || chosen.name,
    variants,
    defaultMachineBrand,
  };
};

const sanitizeGymList = (gyms: any[] = []) =>
  mergeObjectsByIdentity(
    (Array.isArray(gyms) ? gyms : []).filter(Boolean).map((gym) => ({
      ...gym,
      name: cleanLimitedText(gym?.name || "Gym", LIMITS.nameChars) || "Gym",
      defaultMachineBrand: gym?.defaultMachineBrand
        ? cleanLimitedText(gym.defaultMachineBrand, LIMITS.nameChars)
        : null,
      variants: Array.isArray(gym?.variants)
        ? dedupeStringArray(
            gym.variants
              .map((variant: any) =>
                cleanLimitedText(variant, LIMITS.nameChars),
              )
              .filter(Boolean),
          )
        : [],
    })),
    mergeGymCopies,
  )
    .items.slice(0, LIMITS.gymsPerUser);

export const sanitizeGymsForStorage = (gyms: any[] = []) =>
  sanitizeGymList(gyms);

export const sanitizeMachineBrandsForStorage = (brands: any[] = []) =>
  sanitizeBrandList(brands);

export const reconcileTemplatesAndFoldersForStorage = (
  templates: any[] = [],
  folders: any[] = [],
) => {
  const { items: cleanTemplates, idAliases } = mergeObjectsByIdentity(
    (Array.isArray(templates) ? templates : [])
      .filter((template) => template && template.id)
      .map(sanitizeTemplateRecord),
    chooseLatestTemplateCopy,
  );
  const limitedTemplates = cleanTemplates.slice(0, LIMITS.templatesPerUser);
  const validTemplateIds = new Set(
    limitedTemplates
      .map((template) => template?.id)
      .filter(Boolean)
      .map(String),
  );
  const remapTemplateId = (templateId: any) => {
    const id = String(templateId || "");
    return idAliases[id] || id;
  };
  const remappedFolders = (Array.isArray(folders) ? folders : []).map(
    (folder) => {
      const templateIds = Array.from(
        new Set(
          (Array.isArray(folder?.templateIds) ? folder.templateIds : [])
            .map(remapTemplateId)
            .filter((templateId: string) => validTemplateIds.has(templateId)),
        ),
      );
      const days = Array.isArray(folder?.days)
        ? folder.days.map((day: any) => {
            const templateId = remapTemplateId(day?.templateId);
            if (
              day?.type === "template" &&
              templateIds.includes(templateId)
            ) {
              return { ...day, templateId };
            }
            return { ...day, type: "rest", templateId: null };
          })
        : folder?.days;

      return {
        ...folder,
        templateIds,
        days,
      };
    },
  );

  return {
    templates: limitedTemplates,
    folders: sanitizeFolderList(remappedFolders),
    templateIdAliases: idAliases,
  };
};

const sanitizeBrandList = (brands: any[] = []) =>
  Array.from(
    new Set(
      (Array.isArray(brands) ? brands : [])
        .map((brand) => cleanLimitedText(brand, LIMITS.nameChars))
        .filter(Boolean),
    ),
  );

const sanitizeConfigDataForLimits = (configKey: string, data: any) => {
  switch (configKey) {
    case "templates":
      return sanitizeTemplateList(data);
    case "folders":
      return sanitizeFolderList(data);
    case "personal_exercises":
      return cleanStoredCustomExercises(data);
    case "gyms":
      return sanitizeGymList(data);
    case "global_variants":
      return sanitizeBrandList(data);
    default:
      return data;
  }
};

const MAX_BACKUP_FILE_BYTES = 8 * 1024 * 1024;
const MAX_BACKUP_ITEM_BYTES = 200 * 1024;
const MAX_BACKUP_WORKOUTS = 5000;
const MAX_BACKUP_LIST_ITEMS = 1000;
const WORKOUT_DELETE_TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const CUSTOM_ATTACHMENT_LIMIT = 20;
const CUSTOM_ATTACHMENT_NAME_LIMIT = 40;

export const assertReasonableBackupFileSize = (raw: string) => {
  if (raw.length > MAX_BACKUP_FILE_BYTES) {
    throw new Error("This backup file is too large to import safely.");
  }
};

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

const normalizeAttachmentIdentity = (value: any) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ");

const sanitizeCustomAttachmentSettings = (value: any) => {
  const defaults = new Set(
    DEFAULT_CABLE_ATTACHMENTS.map((attachment) =>
      normalizeAttachmentIdentity(attachment),
    ),
  );
  const byKey = new Map<string, string>();

  (Array.isArray(value) ? value : []).forEach((item) => {
    const attachment = normalizeExerciseAttachment(item)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, CUSTOM_ATTACHMENT_NAME_LIMIT)
      .trim();
    const key = normalizeAttachmentIdentity(attachment);
    if (!attachment || !key || defaults.has(key) || byKey.has(key)) return;
    byKey.set(key, attachment);
  });

  return Array.from(byKey.values()).slice(0, CUSTOM_ATTACHMENT_LIMIT);
};

const normalizeIdentityText = (value: any) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const getItemIdentityKeys = (item: any) => {
  const keys = new Set<string>();
  if (!item) return [];

  const id = String(item.id ?? "").trim();
  const name = normalizeIdentityText(item.name);
  const title = normalizeIdentityText(item.title);
  const exerciseName = normalizeIdentityText(item.exercise_name);

  if (id) keys.add(`id:${id}`);
  if (name) keys.add(`name:${name}`);
  if (title) keys.add(`title:${title}`);
  if (exerciseName) keys.add(`exercise:${exerciseName}`);

  return Array.from(keys);
};

const addAlias = (
  aliases: Record<string, string>,
  sourceId: any,
  canonicalId: any,
) => {
  const source = String(sourceId ?? "").trim();
  const canonical = String(canonicalId ?? "").trim();
  if (source && canonical && source !== canonical) aliases[source] = canonical;
};

const mergeObjectsByIdentity = (
  items: any[] = [],
  chooseCopy: (existing: any, incoming: any) => any = chooseBestCopy,
) => {
  const merged: any[] = [];
  const keyToIndex = new Map<string, number>();
  const idAliases: Record<string, string> = {};

  (Array.isArray(items) ? items : []).filter(Boolean).forEach((item) => {
    const keys = getItemIdentityKeys(item);
    const existingIndex = keys
      .map((key) => keyToIndex.get(key))
      .find((index) => index !== undefined);

    if (existingIndex === undefined) {
      const nextIndex = merged.length;
      merged.push(item);
      keys.forEach((key) => keyToIndex.set(key, nextIndex));
      return;
    }

    const existing = merged[existingIndex];
    const chosen = chooseCopy(existing, item);
    merged[existingIndex] = chosen;

    const canonicalId = chosen?.id || existing?.id || item?.id;
    addAlias(idAliases, existing?.id, canonicalId);
    addAlias(idAliases, item?.id, canonicalId);

    [
      ...getItemIdentityKeys(existing),
      ...getItemIdentityKeys(item),
      ...getItemIdentityKeys(chosen),
    ].forEach((key) => keyToIndex.set(key, existingIndex));
  });

  return { items: merged, idAliases };
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

const getTemplateUpdatedAt = (template: any) => {
  const candidates = [
    template?.updatedAt,
    template?.lastUpdatedAt,
    template?.modifiedAt,
    template?.createdAt,
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

const chooseLatestTemplateCopy = (localTemplate: any, cloudTemplate: any) => {
  if (!localTemplate) return cloudTemplate;
  if (!cloudTemplate) return localTemplate;

  const localTime = getTemplateUpdatedAt(localTemplate);
  const cloudTime = getTemplateUpdatedAt(cloudTemplate);

  if (localTime > cloudTime) return localTemplate;
  if (cloudTime > localTime) return cloudTemplate;

  const localScore = getCompletenessScore(localTemplate);
  const cloudScore = getCompletenessScore(cloudTemplate);

  if (localScore > cloudScore) return localTemplate;
  if (cloudScore > localScore) return cloudTemplate;

  // When both copies look equal, keep the local copy so manual sync never
  // accidentally reverts a just-edited local template with an identical stale cloud copy.
  return localTemplate;
};

const mergeTemplateArraysByLatestUpdate = (
  localTemplates: any[] = [],
  cloudTemplates: any[] = [],
) => {
  return mergeObjectsByIdentity(
    [...localTemplates, ...cloudTemplates],
    chooseLatestTemplateCopy,
  ).items;
};

const mergeArrayByKey = (localItems: any[] = [], cloudItems: any[] = []) => {
  return mergeObjectsByIdentity([...localItems, ...cloudItems]).items;
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
  return Array.isArray(parsed)
    ? normalizeWorkoutHistoryExerciseRecords(parsed)
    : [];
};

const getWorkoutDeleteTombstones = async (uid: string) => {
  const raw = await AsyncStorage.getItem(`@deleted_workouts_${uid}`);
  const parsed = safeJsonParse<Record<string, number>>(raw, {});
  const now = Date.now();
  const cleaned = Object.entries(parsed || {}).reduce(
    (acc: Record<string, number>, [id, deletedAt]) => {
      const timestamp = Number(deletedAt);
      if (
        id &&
        Number.isFinite(timestamp) &&
        now - timestamp <= WORKOUT_DELETE_TOMBSTONE_MAX_AGE_MS
      ) {
        acc[id] = timestamp;
      }
      return acc;
    },
    {},
  );

  if (Object.keys(cleaned).length !== Object.keys(parsed || {}).length) {
    await AsyncStorage.setItem(
      `@deleted_workouts_${uid}`,
      JSON.stringify(cleaned),
    );
  }

  return cleaned;
};

const saveWorkoutDeleteTombstones = async (
  uid: string,
  tombstones: Record<string, number>,
) => {
  await AsyncStorage.setItem(
    `@deleted_workouts_${uid}`,
    JSON.stringify(tombstones),
  );
};

export const markWorkoutDeletedLocally = async (
  workoutId: string,
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  const id = String(workoutId || "").trim();
  if (!uid || !id) return;

  const tombstones = await getWorkoutDeleteTombstones(uid);
  tombstones[id] = Date.now();
  await saveWorkoutDeleteTombstones(uid, tombstones);
};

export const clearWorkoutDeletedLocally = async (
  workoutId: string,
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  const id = String(workoutId || "").trim();
  if (!uid || !id) return;

  const tombstones = await getWorkoutDeleteTombstones(uid);
  if (!tombstones[id]) return;

  delete tombstones[id];
  await saveWorkoutDeleteTombstones(uid, tombstones);
};

const deleteWorkoutDocFromCloud = async (uid: string, workoutId: string) => {
  await deleteDoc(doc(db, "users", uid, "workouts", workoutId));
};

export const deleteWorkoutFromCloud = async (
  workoutId: string,
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  const id = String(workoutId || "").trim();
  if (!uid || !id) return { deleted: false };

  await deleteWorkoutDocFromCloud(uid, id);
  await clearWorkoutDeletedLocally(id, uid);
  return { deleted: true };
};

const retryPendingWorkoutDeletes = async (uid: string) => {
  const tombstones = await getWorkoutDeleteTombstones(uid);
  const ids = Object.keys(tombstones);
  let deleted = 0;

  for (const id of ids) {
    try {
      await deleteWorkoutDocFromCloud(uid, id);
      delete tombstones[id];
      deleted += 1;
    } catch (error) {
      await saveLocalCloudSyncFailure(uid, error);
    }
  }

  await saveWorkoutDeleteTombstones(uid, tombstones);
  return deleted;
};

export const saveLocalWorkoutHistory = async (
  workouts: any[],
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  if (!uid) return;

  const normalizedWorkouts = normalizeWorkoutHistoryExerciseRecords(workouts);
  await AsyncStorage.setItem(
    `@workout_history_${uid}`,
    JSON.stringify(normalizedWorkouts),
  );
};

const sanitizeWorkoutsForCloud = (workouts: any[]) => {
  const sanitized: any[] = [];

  workouts.forEach((workout) => {
    try {
      sanitized.push(WorkoutSchema.parse(sanitizeWorkoutForStorage(workout)));
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
      batch.set(
        doc(db, "users", uid, "workouts", workout.id),
        normalizeForFirestore(workout),
        { merge: true },
      );
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
    return normalizeWorkoutHistoryExerciseRecords(
      snapshot.docs.map((doc) => doc.data()).filter((w: any) => w && w.id),
    );
  } catch (error) {
    console.error("Error fetching workouts from cloud:", error);
    return [];
  }
};

export const syncWorkoutHistoryWithCloud = async () => {
  const uid = getUid();
  if (!uid)
    return { localCount: 0, cloudCount: 0, mergedCount: 0, uploaded: 0 };

  await migrateLocalWorkoutHistoryExerciseRecords(uid);
  await retryPendingWorkoutDeletes(uid);
  const tombstones = await getWorkoutDeleteTombstones(uid);
  const isDeletedLocally = (workout: any) =>
    !!tombstones[String(workout?.id || "")];

  const [localWorkouts, cloudWorkouts] = await Promise.all([
    getLocalWorkoutHistory(uid),
    fetchWorkoutsFromCloud(),
  ]);

  const filteredLocalWorkouts = localWorkouts.filter(
    (workout) => !isDeletedLocally(workout),
  );
  const filteredCloudWorkouts = cloudWorkouts.filter(
    (workout) => !isDeletedLocally(workout),
  );

  const mergedWorkouts = mergeWorkoutHistories(
    filteredLocalWorkouts,
    filteredCloudWorkouts,
  );

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
  if (normalizedSettings.restTime !== undefined) {
    const restTime = Number(normalizedSettings.restTime);
    if (Number.isFinite(restTime)) {
      normalizedSettings.restTime = clampRestSeconds(restTime);
    }
  }
  if (normalizedSettings.customAttachments !== undefined) {
    normalizedSettings.customAttachments = sanitizeCustomAttachmentSettings(
      normalizedSettings.customAttachments,
    );
  }

  await setDoc(
    doc(db, "users", uid),
    normalizeForFirestore({ ...normalizedSettings, updatedAt: Date.now() }),
    { merge: true },
  );
};

export const pushWorkoutToCloud = async (workout: any) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return { synced: false };

  try {
    const sanitizedWorkout = WorkoutSchema.parse(
      sanitizeWorkoutForStorage(workout),
    );

    await setDoc(
      doc(db, "users", uid, "workouts", sanitizedWorkout.id),
      normalizeForFirestore(sanitizedWorkout),
      { merge: true },
    );
    return { synced: true };
  } catch (error) {
    console.log("Unable to sync workout to cloud:", error);
    await saveLocalCloudSyncFailure(uid, error);
    return { synced: false, error };
  }
};

export const syncConfigToCloud = async (configKey: string, data: any) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return { synced: false };

  try {
    const sanitizedData = sanitizeConfigDataForLimits(configKey, data);
    const configRef = doc(db, "users", uid, "configs", configKey);
    const payload: Record<string, any> = {
      data: sanitizedData,
      updatedAt: Date.now(),
    };

    if (isDeletableConfigKey(configKey)) {
      payload.deletedIds = await readLocalDeletedConfigIds(uid, configKey);
    }
    if (isStringDeletableConfigKey(configKey)) {
      payload.deletedValues = await readLocalDeletedConfigValues(uid, configKey);
    }
    if (configKey === "gyms") {
      payload.deletedVariantValues =
        await readLocalDeletedConfigNestedValueRecords(uid, configKey);
    }

    await setDoc(
      configRef,
      normalizeForFirestore(payload),
      { merge: true },
    );
    return { synced: true };
  } catch (error) {
    console.log(`Error syncing ${configKey} to cloud:`, error);
    if (configKey !== "sync_status") {
      await saveLocalCloudSyncFailure(uid, error);
    }
    return { synced: false, error };
  }
};

export const syncTemplatesToCloud = async (templates: any[]) => {
  await syncConfigToCloud("templates", templates);
};

export const saveTemplatesLocallyAndToCloud = async (
  templates: any[],
  uidOverride?: string,
) => {
  const uid = uidOverride || getUid();
  if (!uid) return { saved: false, count: 0 };

  const cleanedTemplates = sanitizeTemplateList(templates);

  await AsyncStorage.setItem(
    `@workout_templates_${uid}`,
    JSON.stringify(cleanedTemplates),
  );
  syncTemplatesToCloud(cleanedTemplates).catch((error) => {
    console.log("Template cloud sync delayed:", error);
  });

  return { saved: true, count: cleanedTemplates.length };
};

export const syncPersonalExercisesToCloud = async (exercises: any[]) => {
  await syncConfigToCloud(
    "personal_exercises",
    cleanStoredCustomExercises(exercises),
  );
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

const fetchConfigDocumentFromCloud = async (type: ConfigKey) => {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  try {
    const docSnap = await getDoc(doc(db, "users", uid, "configs", type));
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.error("Error fetching config from cloud:", error);
    return null;
  }
};

export const fetchConfigFromCloud = async (type: ConfigKey) => {
  const cloudDoc = await fetchConfigDocumentFromCloud(type);
  return cloudDoc?.data ?? null;
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

  const [
    localRaw,
    cloudDoc,
    localDeletedIds,
    localDeletedValues,
    localDeletedNestedValues,
  ] = await Promise.all([
    AsyncStorage.getItem(localKey),
    fetchConfigDocumentFromCloud(configKey),
    readLocalDeletedConfigIds(uid, configKey),
    readLocalDeletedConfigValues(uid, configKey),
    readLocalDeletedConfigNestedValueRecords(uid, configKey),
  ]);

  const localValue = safeJsonParse<any[]>(localRaw, []);
  const cloudValue = cloudDoc?.data;
  const cloudDeletedIds = isDeletableConfigKey(configKey)
    ? normalizeDeletedConfigRecords(cloudDoc?.deletedIds).map(
        (record) => record.id,
      )
    : [];
  const deletedIds = new Set([...localDeletedIds, ...cloudDeletedIds]);
  const cloudDeletedValues = isStringDeletableConfigKey(configKey)
    ? normalizeDeletedConfigValueRecords(cloudDoc?.deletedValues).map(
        (record) => record.value,
      )
    : [];
  const deletedValues = new Set([
    ...localDeletedValues,
    ...cloudDeletedValues,
  ]);
  const cloudDeletedNestedValues =
    configKey === "gyms"
      ? normalizeDeletedConfigNestedValueRecords(cloudDoc?.deletedVariantValues)
      : [];
  const deletedNestedValues = [
    ...localDeletedNestedValues,
    ...cloudDeletedNestedValues,
  ];
  const deletedGymVariants = new Set(
    deletedNestedValues.map(
      (record) => `${record.parentId}:${record.value}`,
    ),
  );
  const filterDeletedGymVariants = (items: any[]) =>
    configKey === "gyms"
      ? items.map((gym) => {
          const gymId = String(gym?.id ?? "").trim();
          if (!gymId || !Array.isArray(gym?.variants)) return gym;
          return {
            ...gym,
            variants: gym.variants.filter(
              (variant: any) =>
                !deletedGymVariants.has(
                  `${gymId}:${normalizeConfigStringValue(variant)}`,
                ),
            ),
          };
        })
      : items;
  const filterDeletedItems = (items: any[]) =>
    isDeletableConfigKey(configKey)
      ? items.filter(
          (item) => !deletedIds.has(String(item?.id ?? "").trim()),
        )
      : isStringDeletableConfigKey(configKey)
        ? items.filter(
            (item) => !deletedValues.has(normalizeConfigStringValue(item)),
          )
      : items;

  if (cloudDeletedIds.length > 0) {
    await mergeDeletedConfigIdsLocally(uid, configKey, cloudDeletedIds);
  }
  if (cloudDeletedValues.length > 0) {
    await mergeDeletedConfigValuesLocally(uid, configKey, cloudDeletedValues);
  }
  if (cloudDeletedNestedValues.length > 0) {
    await mergeDeletedConfigNestedValuesLocally(
      uid,
      configKey,
      cloudDeletedNestedValues,
    );
  }

  const localArray = filterDeletedGymVariants(
    filterDeletedItems(Array.isArray(localValue) ? localValue : []),
  );
  const cloudArray = filterDeletedGymVariants(
    filterDeletedItems(Array.isArray(cloudValue) ? cloudValue : []),
  );

  const rawMerged =
    configKey === "global_variants" || configKey === "favorite_exercises"
      ? dedupeStringArray([...localArray, ...cloudArray])
      : configKey === "templates"
        ? mergeTemplateArraysByLatestUpdate(localArray, cloudArray)
        : mergeArrayByKey(localArray, cloudArray);

  const merged = sanitizeConfigDataForLimits(configKey, rawMerged);

  await AsyncStorage.setItem(localKey, JSON.stringify(merged));
  const cloudWrite = await syncConfigToCloud(configKey, merged);
  if (!cloudWrite.synced) {
    throw cloudWrite.error || new Error(`Could not sync ${configKey}.`);
  }

  return {
    key: configKey,
    localCount: localArray.length,
    cloudCount: cloudArray.length,
    mergedCount: merged.length,
    cloudSynced: true,
  };
};

const reconcileLocalTemplatesAndFolders = async (uid: string) => {
  const [templatesRaw, foldersRaw] = await Promise.all([
    AsyncStorage.getItem(`@workout_templates_${uid}`),
    AsyncStorage.getItem(`@workout_folders_${uid}`),
  ]);

  const currentTemplates = safeJsonParse<any[]>(templatesRaw, []);
  const currentFolders = safeJsonParse<any[]>(foldersRaw, []);
  const reconciled = reconcileTemplatesAndFoldersForStorage(
    currentTemplates,
    currentFolders,
  );

  const templatesChanged =
    JSON.stringify(currentTemplates) !== JSON.stringify(reconciled.templates);
  const foldersChanged =
    JSON.stringify(currentFolders) !== JSON.stringify(reconciled.folders);

  if (templatesChanged) {
    await AsyncStorage.setItem(
      `@workout_templates_${uid}`,
      JSON.stringify(reconciled.templates),
    );
  }
  if (foldersChanged) {
    await AsyncStorage.setItem(
      `@workout_folders_${uid}`,
      JSON.stringify(reconciled.folders),
    );
  }

  if (templatesChanged) {
    const templateWrite = await syncConfigToCloud(
      "templates",
      reconciled.templates,
    );
    if (!templateWrite.synced) {
      throw templateWrite.error || new Error("Could not sync templates.");
    }
  }

  if (foldersChanged) {
    const folderWrite = await syncConfigToCloud("folders", reconciled.folders);
    if (!folderWrite.synced) {
      throw folderWrite.error || new Error("Could not sync folders.");
    }
  }

  return {
    templatesCount: reconciled.templates.length,
    foldersCount: reconciled.folders.length,
    changed: templatesChanged || foldersChanged,
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
    rpeTrackingEnabledRaw,
    plateCalcEnabledRaw,
    nextSessionNotesEnabledRaw,
    platesKgRaw,
    platesLbsRaw,
    plateInventoryRaw,
    setupCompleteRaw,
    lastUsedGymRaw,
    activeSplitFolderRaw,
    customAttachmentsRaw,
  ] = await Promise.all([
    readLocalSetting(uid, "user_username"),
    readLocalSetting(uid, "user_metric"),
    readLocalSetting(uid, "rest_time"),
    readLocalSetting(uid, "rest_timer_enabled"),
    readLocalSetting(uid, "auto_check_enabled"),
    readLocalSetting(uid, "rpe_tracking_enabled"),
    readLocalSetting(uid, "plate_calc_enabled"),
    readLocalSetting(uid, "next_session_notes_enabled"),
    readLocalSetting(uid, "plates_kg"),
    readLocalSetting(uid, "plates_lbs"),
    readLocalSetting(uid, "plate_inventory"),
    readLocalSetting(uid, "setup_complete"),
    readLocalSetting(uid, "last_used_gym"),
    readLocalSetting(uid, "active_split_folder"),
    readLocalSetting(uid, "custom_attachments"),
  ]);

  const restTimerCloud =
    cloudSettings.restTimerEnabled ?? cloudSettings.timerEnabled;

  const mergedSettings = {
    username: pickLocalOrCloud(usernameRaw, cloudSettings.username),
    metric: pickLocalOrCloud(metricRaw, cloudSettings.metric, "KG"),
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
    rpeTrackingEnabled:
      String(
        pickLocalOrCloud(
          rpeTrackingEnabledRaw,
          cloudSettings.rpeTrackingEnabled,
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
    nextSessionNotesEnabled:
      String(
        pickLocalOrCloud(
          nextSessionNotesEnabledRaw,
          cloudSettings.nextSessionNotesEnabled,
          false,
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
    customAttachments: sanitizeCustomAttachmentSettings(
      customAttachmentsRaw !== null && customAttachmentsRaw !== undefined
        ? safeJsonParse(customAttachmentsRaw, [])
        : cloudSettings.customAttachments,
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
    "rpe_tracking_enabled",
    String(mergedSettings.rpeTrackingEnabled),
  );
  await writeLocalSetting(
    uid,
    "plate_calc_enabled",
    String(mergedSettings.plateCalcEnabled),
  );
  await writeLocalSetting(
    uid,
    "next_session_notes_enabled",
    String(mergedSettings.nextSessionNotesEnabled),
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
  await writeLocalSetting(
    uid,
    "custom_attachments",
    mergedSettings.customAttachments,
  );

  await syncSettingsToCloud(mergedSettings);

  return { synced: true };
};

export type CloudSyncStatus = {
  lastSyncedAt: number;
  lastAttemptedAt?: number;
  lastFailedAt?: number;
  success: boolean;
  errorMessage?: string;
  workouts: number;
  templates: number;
  folders: number;
  personalExercises: number;
  favoriteExercises: number;
  gyms: number;
  machineBrands: number;
  settingsSynced?: boolean;
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
  "rpe_tracking_enabled",
  "plate_calc_enabled",
  "next_session_notes_enabled",
  "plates_kg",
  "plates_lbs",
  "plate_inventory",
  "setup_complete",
  "last_used_gym",
  "active_split_folder",
  "custom_attachments",
] as const;

const BOOLEAN_SETTINGS_BACKUP_KEYS = [
  "rest_timer_enabled",
  "auto_check_enabled",
  "rpe_tracking_enabled",
  "plate_calc_enabled",
  "next_session_notes_enabled",
  "setup_complete",
] as const;

type IronVaultBackup = {
  app: "IronVault";
  appName: "IronVault";
  type: "ironvault-backup";
  version: number;
  backupVersion: number;
  exportedAt: number;
  userId?: string | null;
  username?: string | null;
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

  if (
    ["plates_kg", "plates_lbs", "plate_inventory", "custom_attachments"].includes(
      key,
    )
  ) {
    return safeJsonParse(raw, raw);
  }

  if ((BOOLEAN_SETTINGS_BACKUP_KEYS as readonly string[]).includes(key)) {
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

const parseBackupStringArray = (value: any) =>
  Array.isArray(value)
    ? value.filter((item: any) => typeof item === "string")
    : [];

const validateIronVaultBackupShape = (backup: any) => {
  const appName = backup?.app || backup?.appName;
  const backupVersion = Number(backup?.version ?? backup?.backupVersion ?? 1);

  if (
    !backup ||
    appName !== "IronVault" ||
    backup.type !== "ironvault-backup"
  ) {
    throw new Error("This is not a valid IronVault backup file.");
  }

  if (Number.isFinite(backupVersion) && backupVersion > 1) {
    throw new Error(
      "This backup was created by a newer IronVault version and cannot be imported safely.",
    );
  }

  if (!backup.data || typeof backup.data !== "object") {
    throw new Error("This backup file is missing its data section.");
  }

  return backup.data;
};

const serializedSizeWithinLimit = (value: any) => {
  try {
    return JSON.stringify(value).length <= MAX_BACKUP_ITEM_BYTES;
  } catch {
    return false;
  }
};

const GenericBackupObjectSchema = z
  .object({
    id: z.union([z.string().max(100), z.number()]).optional(),
    name: z.string().max(150).optional(),
    title: z.string().max(150).optional(),
    updatedAt: z.number().optional(),
    createdAt: z.number().optional(),
  })
  .passthrough();

const sanitizeBackupObjectArray = (
  value: any,
  maxItems = MAX_BACKUP_LIST_ITEMS,
) =>
  parseBackupArray(value)
    .slice(0, maxItems)
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .filter(serializedSizeWithinLimit)
    .map((item) => GenericBackupObjectSchema.safeParse(item))
    .filter((result) => result.success)
    .map((result: any) => result.data);

const sanitizeBackupWorkoutArray = (value: any) =>
  parseBackupArray(value)
    .slice(0, MAX_BACKUP_WORKOUTS)
    .filter(serializedSizeWithinLimit)
    .map((workout) => WorkoutSchema.safeParse(workout))
    .filter((result) => result.success)
    .map((result: any) => WorkoutSchema.parse(sanitizeWorkoutForStorage(result.data)));

const sanitizeBackupSettings = (settings: any) => {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return {};
  }

  return SETTINGS_BACKUP_KEYS.reduce((acc: Record<string, any>, key) => {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) return acc;
    const value = settings[key];

    if (key === "custom_attachments") {
      const customAttachments = sanitizeCustomAttachmentSettings(value);
      if (customAttachments.length > 0) {
        acc[key] = customAttachments;
      }
      return acc;
    }

    if ((BOOLEAN_SETTINGS_BACKUP_KEYS as readonly string[]).includes(key)) {
      if (typeof value === "boolean") acc[key] = value;
      else if (value === "true" || value === "false") {
        acc[key] = value === "true";
      }
      return acc;
    }

    if (typeof value === "string") {
      acc[key] = value.slice(0, 200);
      return acc;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      acc[key] = value;
      return acc;
    }
    if (typeof value === "boolean") {
      acc[key] = value;
      return acc;
    }
    if (Array.isArray(value)) {
      if (value.length <= 100 && serializedSizeWithinLimit(value)) {
        acc[key] = value;
      }
      return acc;
    }
    if (
      value &&
      typeof value === "object" &&
      serializedSizeWithinLimit(value)
    ) {
      acc[key] = value;
    }

    return acc;
  }, {});
};

const mergeMissingWorkoutsOnly = (
  localItems: any[] = [],
  backupItems: any[] = [],
) => {
  const seen = new Set(
    localItems
      .map((item: any) => item?.id)
      .filter(Boolean)
      .map(String),
  );

  const toAdd = backupItems.filter((item: any) => {
    if (!item?.id) return false;
    const id = String(item.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return { merged: [...localItems, ...toAdd], added: toAdd.length };
};

const mergeMissingObjectsOnly = (
  localItems: any[] = [],
  backupItems: any[] = [],
) => {
  const seen = new Set<string>();
  localItems.forEach((item: any) => {
    getItemIdentityKeys(item).forEach((key) => seen.add(key));
  });

  const toAdd = backupItems.filter((item: any) => {
    const keys = getItemIdentityKeys(item);
    if (keys.length === 0) return false;
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });

  return { merged: [...localItems, ...toAdd], added: toAdd.length };
};

const mergeMissingStringsOnly = (
  localItems: string[] = [],
  backupItems: string[] = [],
) => {
  const seen = new Set(localItems.map((item: string) => String(item)));
  const toAdd = backupItems.filter((item: string) => {
    const value = String(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });

  return { merged: [...localItems, ...toAdd], added: toAdd.length };
};

export const __firebaseSyncTestables = {
  normalizeForFirestore,
  sanitizeWorkoutForStorage,
  sanitizeGymsForStorage,
  sanitizeMachineBrandsForStorage,
  sanitizeTemplatesForStorage,
  normalizeWorkoutHistoryExerciseRecords,
  reconcileTemplatesAndFoldersForStorage,
  normalizeDeletedConfigRecords,
  normalizeDeletedConfigValueRecords,
  normalizeDeletedConfigNestedValueRecords,
  validateIronVaultBackupShape,
  sanitizeBackupSettings,
  mergeMissingWorkoutsOnly,
  mergeMissingObjectsOnly,
  mergeMissingStringsOnly,
};

const getImportableSettingKeys = async (
  uid: string,
  settings: Record<string, any> = {},
) => {
  const keys: string[] = [];

  for (const key of SETTINGS_BACKUP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
    const current = await AsyncStorage.getItem(`@${key}_${uid}`);
    if (current === null || current === undefined) keys.push(key);
  }

  return keys;
};

export const previewIronVaultBackupImport = async (backup: any) => {
  const uid = getUid();
  if (!uid) {
    throw new Error("You must be logged in to import data.");
  }

  const data = validateIronVaultBackupShape(backup);

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

  const backupWorkouts = sanitizeBackupWorkoutArray(data.workouts);
  const backupTemplates = sanitizeBackupObjectArray(data.templates);
  const backupFolders = sanitizeBackupObjectArray(data.folders);
  const backupExercises = cleanStoredCustomExercises(
    sanitizeBackupObjectArray(data.personalExercises),
  );
  const backupFavorites = dedupeStringArray(
    parseBackupStringArray(data.favoriteExercises),
  );
  const backupGyms = sanitizeBackupObjectArray(data.gyms);
  const backupMachineBrands = dedupeStringArray(
    parseBackupStringArray(data.machineBrands),
  );
  const backupSettings = sanitizeBackupSettings(data.settings);

  return {
    metadata: {
      exportedAt: backup.exportedAt || backup.exportedAtMs,
      version: backup.version ?? backup.backupVersion ?? 1,
      userId: backup.userId || null,
      username: backup.username || null,
    },
    totals: {
      workouts: backupWorkouts.length,
      templates: backupTemplates.length,
      folders: backupFolders.length,
      personalExercises: backupExercises.length,
      favoriteExercises: backupFavorites.length,
      gyms: backupGyms.length,
      machineBrands: backupMachineBrands.length,
      settings: Object.keys(backupSettings).length,
    },
    additions: {
      workouts: mergeMissingWorkoutsOnly(localWorkouts, backupWorkouts).added,
      templates: mergeMissingObjectsOnly(
        parseBackupArray(safeJsonParse(templatesRaw, [])),
        backupTemplates,
      ).added,
      folders: mergeMissingObjectsOnly(
        parseBackupArray(safeJsonParse(foldersRaw, [])),
        backupFolders,
      ).added,
      personalExercises: mergeMissingObjectsOnly(
        cleanStoredCustomExercises(
          parseBackupArray(safeJsonParse(personalExercisesRaw, [])),
        ),
        backupExercises,
      ).added,
      favoriteExercises: mergeMissingStringsOnly(
        dedupeStringArray(
          parseBackupStringArray(safeJsonParse(favoriteExercisesRaw, [])),
        ),
        backupFavorites,
      ).added,
      gyms: mergeMissingObjectsOnly(
        parseBackupArray(safeJsonParse(gymsRaw, [])),
        backupGyms,
      ).added,
      machineBrands: mergeMissingStringsOnly(
        dedupeStringArray(
          parseBackupStringArray(safeJsonParse(machineBrandsRaw, [])),
        ),
        backupMachineBrands,
      ).added,
      settings: (await getImportableSettingKeys(uid, backupSettings)).length,
    },
  };
};

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
  const username =
    typeof settings.user_username === "string" ? settings.user_username : null;

  return {
    app: "IronVault",
    appName: "IronVault",
    type: "ironvault-backup",
    version: 1,
    backupVersion: 1,
    exportedAt: Date.now(),
    userId: uid,
    username,
    data: {
      workouts,
      templates: parseBackupArray(safeJsonParse(templatesRaw, [])),
      folders: parseBackupArray(safeJsonParse(foldersRaw, [])),
      personalExercises: cleanStoredCustomExercises(
        parseBackupArray(safeJsonParse(personalExercisesRaw, [])),
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

  const data = validateIronVaultBackupShape(backup);

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

  const localTemplates = parseBackupArray(safeJsonParse(templatesRaw, []));
  const localFolders = parseBackupArray(safeJsonParse(foldersRaw, []));
  const localPersonalExercises = cleanStoredCustomExercises(
    parseBackupArray(safeJsonParse(personalExercisesRaw, [])),
  );
  const localFavoriteExercises = dedupeStringArray(
    parseBackupStringArray(safeJsonParse(favoriteExercisesRaw, [])),
  );
  const localGyms = parseBackupArray(safeJsonParse(gymsRaw, []));
  const localMachineBrands = dedupeStringArray(
    parseBackupStringArray(safeJsonParse(machineBrandsRaw, [])),
  );

  const backupWorkouts = sanitizeBackupWorkoutArray(data.workouts);
  const backupTemplates = sanitizeBackupObjectArray(data.templates);
  const backupFolders = sanitizeBackupObjectArray(data.folders);
  const backupPersonalExercises = cleanStoredCustomExercises(
    sanitizeBackupObjectArray(data.personalExercises),
  );
  const backupFavoriteExercises = dedupeStringArray(
    parseBackupStringArray(data.favoriteExercises),
  );
  const backupGyms = sanitizeBackupObjectArray(data.gyms);
  const backupMachineBrands = dedupeStringArray(
    parseBackupStringArray(data.machineBrands),
  );
  const backupSettings = sanitizeBackupSettings(data.settings);

  const workoutsMerge = mergeMissingWorkoutsOnly(localWorkouts, backupWorkouts);
  const templatesMerge = mergeMissingObjectsOnly(
    localTemplates,
    backupTemplates,
  );
  const foldersMerge = mergeMissingObjectsOnly(localFolders, backupFolders);
  const personalExercisesMerge = mergeMissingObjectsOnly(
    localPersonalExercises,
    backupPersonalExercises,
  );
  const favoriteExercisesMerge = mergeMissingStringsOnly(
    localFavoriteExercises,
    backupFavoriteExercises,
  );
  const gymsMerge = mergeMissingObjectsOnly(localGyms, backupGyms);
  const machineBrandsMerge = mergeMissingStringsOnly(
    localMachineBrands,
    backupMachineBrands,
  );

  await Promise.all([
    saveLocalWorkoutHistory(workoutsMerge.merged, uid),
    AsyncStorage.setItem(
      `@workout_templates_${uid}`,
      JSON.stringify(templatesMerge.merged),
    ),
    AsyncStorage.setItem(
      `@workout_folders_${uid}`,
      JSON.stringify(foldersMerge.merged),
    ),
    AsyncStorage.setItem(
      `@user_exercises_${uid}`,
      JSON.stringify(cleanStoredCustomExercises(personalExercisesMerge.merged)),
    ),
    AsyncStorage.setItem(
      `@favorite_exercises_${uid}`,
      JSON.stringify(favoriteExercisesMerge.merged),
    ),
    AsyncStorage.setItem(`@user_gyms_${uid}`, JSON.stringify(gymsMerge.merged)),
    AsyncStorage.setItem(
      `@global_variants_${uid}`,
      JSON.stringify(machineBrandsMerge.merged),
    ),
  ]);

  const importedSettingKeys = await getImportableSettingKeys(
    uid,
    backupSettings,
  );
  for (const key of importedSettingKeys) {
    await writeImportedSettingValue(uid, key, backupSettings[key]);
  }

  await Promise.all([
    clearConfigItemsDeletedLocally("templates", templatesMerge.merged, uid),
    clearConfigItemsDeletedLocally("folders", foldersMerge.merged, uid),
    clearConfigItemsDeletedLocally(
      "personal_exercises",
      personalExercisesMerge.merged,
      uid,
    ),
    clearConfigItemsDeletedLocally("gyms", gymsMerge.merged, uid),
    clearConfigValuesDeletedLocally(
      "favorite_exercises",
      favoriteExercisesMerge.merged,
      uid,
    ),
    clearConfigValuesDeletedLocally(
      "global_variants",
      machineBrandsMerge.merged,
      uid,
    ),
    ...gymsMerge.merged.map((gym: any) =>
      clearGymVariantsDeletedLocally(
        String(gym?.id || ""),
        Array.isArray(gym?.variants) ? gym.variants : [],
        uid,
      ),
    ),
  ]);

  await validateActiveSplitAfterFolderSync(uid);
  const syncResult = await syncEverythingWithCloud();

  return {
    added: {
      workouts: workoutsMerge.added,
      templates: templatesMerge.added,
      folders: foldersMerge.added,
      personalExercises: personalExercisesMerge.added,
      favoriteExercises: favoriteExercisesMerge.added,
      gyms: gymsMerge.added,
      machineBrands: machineBrandsMerge.added,
      settings: importedSettingKeys.length,
    },
    totals: {
      workouts: workoutsMerge.merged.length,
      templates: templatesMerge.merged.length,
      folders: foldersMerge.merged.length,
      personalExercises: personalExercisesMerge.merged.length,
      favoriteExercises: favoriteExercisesMerge.merged.length,
      gyms: gymsMerge.merged.length,
      machineBrands: machineBrandsMerge.merged.length,
    },
    syncResult,
  };
};

const getIdsMissingFromNext = (currentItems: any[] = [], nextItems: any[] = []) => {
  const nextIds = new Set(getConfigItemIds(nextItems));
  return getConfigItemIds(currentItems).filter((id) => !nextIds.has(id));
};

const getStringsMissingFromNext = (
  currentItems: any[] = [],
  nextItems: any[] = [],
) => {
  const nextValues = new Set(
    (Array.isArray(nextItems) ? nextItems : [])
      .map(normalizeConfigStringValue)
      .filter(Boolean),
  );

  return (Array.isArray(currentItems) ? currentItems : []).filter((item) => {
    const value = normalizeConfigStringValue(item);
    return value && !nextValues.has(value);
  });
};

const getLocalConfigArray = async (uid: string, configKey: ConfigKey) => {
  const localKey = configKeyToLocalKey(uid, configKey);
  if (!localKey) return [];
  return parseBackupArray(safeJsonParse(await AsyncStorage.getItem(localKey), []));
};

const getCloudConfigArrayForRestore = async (configKey: ConfigKey) => {
  const cloudDoc = await fetchConfigDocumentFromCloud(configKey);
  const cloudValue = parseBackupArray(cloudDoc?.data);
  const deletedIds = isDeletableConfigKey(configKey)
    ? new Set(
        normalizeDeletedConfigRecords(cloudDoc?.deletedIds).map(
          (record) => record.id,
        ),
      )
    : new Set<string>();
  const deletedValues = isStringDeletableConfigKey(configKey)
    ? new Set(
        normalizeDeletedConfigValueRecords(cloudDoc?.deletedValues).map(
          (record) => record.value,
        ),
      )
    : new Set<string>();
  const deletedGymVariants =
    configKey === "gyms"
      ? new Set(
          normalizeDeletedConfigNestedValueRecords(
            cloudDoc?.deletedVariantValues,
          ).map((record) => `${record.parentId}:${record.value}`),
        )
      : new Set<string>();

  const filtered = cloudValue
    .filter((item) =>
      isDeletableConfigKey(configKey)
        ? !deletedIds.has(String(item?.id ?? "").trim())
        : isStringDeletableConfigKey(configKey)
          ? !deletedValues.has(normalizeConfigStringValue(item))
          : true,
    )
    .map((item) => {
      if (configKey !== "gyms" || !Array.isArray(item?.variants)) return item;
      const gymId = String(item?.id ?? "").trim();
      return {
        ...item,
        variants: item.variants.filter(
          (variant: any) =>
            !deletedGymVariants.has(
              `${gymId}:${normalizeConfigStringValue(variant)}`,
            ),
        ),
      };
    });

  return sanitizeConfigDataForLimits(configKey, filtered);
};

const readCloudSettingsForRestore = async () => {
  const cloudSettings: any = (await fetchSettingsFromCloud()) || {};
  const settings: Record<string, any> = {};

  if (cloudSettings.username !== undefined) {
    settings.user_username = cloudSettings.username;
  }
  if (cloudSettings.metric !== undefined) {
    settings.user_metric = cloudSettings.metric;
  }
  if (cloudSettings.restTime !== undefined) {
    settings.rest_time = cloudSettings.restTime;
  }
  const restTimerEnabled =
    cloudSettings.restTimerEnabled ?? cloudSettings.timerEnabled;
  if (restTimerEnabled !== undefined) {
    settings.rest_timer_enabled = !!restTimerEnabled;
  }
  if (cloudSettings.autoCheckEnabled !== undefined) {
    settings.auto_check_enabled = !!cloudSettings.autoCheckEnabled;
  }
  if (cloudSettings.rpeTrackingEnabled !== undefined) {
    settings.rpe_tracking_enabled = !!cloudSettings.rpeTrackingEnabled;
  }
  if (cloudSettings.plateCalcEnabled !== undefined) {
    settings.plate_calc_enabled = !!cloudSettings.plateCalcEnabled;
  }
  if (cloudSettings.nextSessionNotesEnabled !== undefined) {
    settings.next_session_notes_enabled =
      !!cloudSettings.nextSessionNotesEnabled;
  }
  if (cloudSettings.platesKg !== undefined) {
    settings.plates_kg = cloudSettings.platesKg;
  }
  if (cloudSettings.platesLbs !== undefined) {
    settings.plates_lbs = cloudSettings.platesLbs;
  }
  if (cloudSettings.plateInventory !== undefined) {
    settings.plate_inventory = cloudSettings.plateInventory;
  }
  if (cloudSettings.setupComplete !== undefined) {
    settings.setup_complete = !!cloudSettings.setupComplete;
  }
  if (cloudSettings.lastUsedGym !== undefined) {
    settings.last_used_gym = cloudSettings.lastUsedGym;
  }
  if (cloudSettings.activeSplitFolderId !== undefined) {
    settings.active_split_folder = cloudSettings.activeSplitFolderId;
  }
  if (cloudSettings.customAttachments !== undefined) {
    settings.custom_attachments = sanitizeCustomAttachmentSettings(
      cloudSettings.customAttachments,
    );
  }

  return sanitizeBackupSettings(settings);
};

const backupSettingsToCloudSettings = (settings: Record<string, any> = {}) => {
  const cloudSettings: Record<string, any> = {};

  if (settings.user_username !== undefined) {
    cloudSettings.username = settings.user_username;
  }
  if (settings.user_metric !== undefined) {
    cloudSettings.metric = settings.user_metric;
  }
  if (settings.rest_time !== undefined) {
    cloudSettings.restTime = Number(settings.rest_time);
  }
  if (settings.rest_timer_enabled !== undefined) {
    cloudSettings.restTimerEnabled = !!settings.rest_timer_enabled;
    cloudSettings.timerEnabled = !!settings.rest_timer_enabled;
  }
  if (settings.auto_check_enabled !== undefined) {
    cloudSettings.autoCheckEnabled = !!settings.auto_check_enabled;
  }
  if (settings.rpe_tracking_enabled !== undefined) {
    cloudSettings.rpeTrackingEnabled = !!settings.rpe_tracking_enabled;
  }
  if (settings.plate_calc_enabled !== undefined) {
    cloudSettings.plateCalcEnabled = !!settings.plate_calc_enabled;
  }
  if (settings.next_session_notes_enabled !== undefined) {
    cloudSettings.nextSessionNotesEnabled =
      !!settings.next_session_notes_enabled;
  }
  if (settings.plates_kg !== undefined) {
    cloudSettings.platesKg = settings.plates_kg;
  }
  if (settings.plates_lbs !== undefined) {
    cloudSettings.platesLbs = settings.plates_lbs;
  }
  if (settings.plate_inventory !== undefined) {
    cloudSettings.plateInventory = settings.plate_inventory;
  }
  if (settings.setup_complete !== undefined) {
    cloudSettings.setupComplete = !!settings.setup_complete;
  }
  if (settings.last_used_gym !== undefined) {
    cloudSettings.lastUsedGym = settings.last_used_gym;
  }
  if (settings.active_split_folder !== undefined) {
    cloudSettings.activeSplitFolderId = settings.active_split_folder;
  }
  if (settings.custom_attachments !== undefined) {
    cloudSettings.customAttachments = sanitizeCustomAttachmentSettings(
      settings.custom_attachments,
    );
  }

  return cloudSettings;
};

const readCloudRestorePayload = async () => {
  const [
    workouts,
    templates,
    folders,
    personalExercises,
    favoriteExercises,
    gyms,
    machineBrands,
    settings,
  ] = await Promise.all([
    fetchWorkoutsFromCloud(),
    getCloudConfigArrayForRestore("templates"),
    getCloudConfigArrayForRestore("folders"),
    getCloudConfigArrayForRestore("personal_exercises"),
    getCloudConfigArrayForRestore("favorite_exercises"),
    getCloudConfigArrayForRestore("gyms"),
    getCloudConfigArrayForRestore("global_variants"),
    readCloudSettingsForRestore(),
  ]);

  const reconciled = reconcileTemplatesAndFoldersForStorage(
    sanitizeBackupObjectArray(templates, LIMITS.templatesPerUser),
    sanitizeBackupObjectArray(folders, LIMITS.foldersPerUser),
  );

  return {
    readAt: Date.now(),
    workouts: sanitizeBackupWorkoutArray(workouts),
    templates: reconciled.templates,
    folders: reconciled.folders,
    personalExercises: cleanStoredCustomExercises(
      sanitizeBackupObjectArray(personalExercises, LIMITS.customExercisesPerUser),
    ),
    favoriteExercises: dedupeStringArray(
      parseBackupStringArray(favoriteExercises),
    ),
    gyms: sanitizeGymsForStorage(
      sanitizeBackupObjectArray(gyms, LIMITS.gymsPerUser),
    ),
    machineBrands: sanitizeMachineBrandsForStorage(
      parseBackupStringArray(machineBrands),
    ),
    settings,
  };
};

export const previewCloudCategoryRestore = async () => {
  const uid = getUid();
  if (!uid) {
    throw new Error("You must be logged in to restore cloud data.");
  }

  const payload = await readCloudRestorePayload();

  return {
    readAt: payload.readAt,
    categories: {
      workouts: payload.workouts.length,
      templates: payload.templates.length,
      folders: payload.folders.length,
      personalExercises: payload.personalExercises.length,
      favoriteExercises: payload.favoriteExercises.length,
      gyms: payload.gyms.length,
      machineBrands: payload.machineBrands.length,
      settings: Object.keys(payload.settings).length,
    } as Record<CloudRestoreCategory, number>,
  };
};

const saveLocalPreRestoreBackup = async (uid: string) => {
  try {
    const backup = await buildIronVaultBackup();
    await AsyncStorage.setItem(
      `@pre_restore_backup_${uid}`,
      JSON.stringify({ ...backup, savedAt: Date.now() }),
    );
  } catch (error) {
    console.log("Could not save pre-restore backup:", error);
  }
};

const syncObjectRestoreCategory = async (
  uid: string,
  configKey: ConfigKey,
  nextItems: any[],
  currentItems: any[],
) => {
  const removedIds = getIdsMissingFromNext(currentItems, nextItems);
  if (removedIds.length > 0) {
    await markConfigItemsDeletedLocally(
      configKey,
      removedIds.map((id) => ({ id })),
      uid,
    );
  }
  await clearConfigItemsDeletedLocally(configKey, nextItems, uid);

  const write = await syncConfigToCloud(configKey, nextItems);
  if (!write.synced) {
    throw write.error || new Error(`Could not restore ${configKey}.`);
  }
};

const syncStringRestoreCategory = async (
  uid: string,
  configKey: ConfigKey,
  nextItems: any[],
  currentItems: any[],
) => {
  const removedValues = getStringsMissingFromNext(currentItems, nextItems);
  if (removedValues.length > 0) {
    await markConfigValuesDeletedLocally(configKey, removedValues, uid);
  }
  await clearConfigValuesDeletedLocally(configKey, nextItems, uid);

  const write = await syncConfigToCloud(configKey, nextItems);
  if (!write.synced) {
    throw write.error || new Error(`Could not restore ${configKey}.`);
  }
};

const syncGymRestoreCategory = async (
  uid: string,
  nextGyms: any[],
  currentGyms: any[],
) => {
  const removedIds = getIdsMissingFromNext(currentGyms, nextGyms);
  if (removedIds.length > 0) {
    await markConfigItemsDeletedLocally(
      "gyms",
      removedIds.map((id) => ({ id })),
      uid,
    );
  }

  const nextById = new Map(
    nextGyms.map((gym: any) => [String(gym?.id || ""), gym]),
  );
  for (const currentGym of currentGyms) {
    const gymId = String(currentGym?.id || "");
    const nextGym: any = nextById.get(gymId);
    if (!gymId || !nextGym) continue;

    const removedVariants = getStringsMissingFromNext(
      Array.isArray(currentGym?.variants) ? currentGym.variants : [],
      Array.isArray(nextGym?.variants) ? nextGym.variants : [],
    );
    if (removedVariants.length > 0) {
      await markGymVariantsDeletedLocally(gymId, removedVariants, uid);
    }
  }

  await clearConfigItemsDeletedLocally("gyms", nextGyms, uid);
  await Promise.all(
    nextGyms.map((gym: any) =>
      clearGymVariantsDeletedLocally(
        String(gym?.id || ""),
        Array.isArray(gym?.variants) ? gym.variants : [],
        uid,
      ),
    ),
  );

  const write = await syncConfigToCloud("gyms", nextGyms);
  if (!write.synced) {
    throw write.error || new Error("Could not restore gyms.");
  }
};

export const restoreCloudCategories = async (
  selectedCategories: CloudRestoreCategory[] = [],
) => {
  const uid = getUid();
  if (!uid) {
    throw new Error("You must be logged in to restore cloud data.");
  }

  const selected = new Set(selectedCategories);
  if (selected.size === 0) {
    throw new Error("Choose at least one category to restore.");
  }

  await saveLocalPreRestoreBackup(uid);

  const [
    cloud,
    localWorkouts,
    localTemplates,
    localFolders,
    localPersonalExercises,
    localFavoriteExercises,
    localGyms,
    localMachineBrands,
  ] = await Promise.all([
    readCloudRestorePayload(),
    getLocalWorkoutHistory(uid),
    getLocalConfigArray(uid, "templates"),
    getLocalConfigArray(uid, "folders"),
    getLocalConfigArray(uid, "personal_exercises"),
    getLocalConfigArray(uid, "favorite_exercises"),
    getLocalConfigArray(uid, "gyms"),
    getLocalConfigArray(uid, "global_variants"),
  ]);

  const results: Record<CloudRestoreCategory, number> = {
    workouts: 0,
    templates: 0,
    folders: 0,
    personalExercises: 0,
    favoriteExercises: 0,
    gyms: 0,
    machineBrands: 0,
    settings: 0,
  };

  if (selected.has("workouts")) {
    const restoredWorkouts = cloud.workouts;
    const restoredIds = new Set(
      restoredWorkouts.map((workout: any) => String(workout?.id || "")),
    );
    const removedWorkoutIds = localWorkouts
      .map((workout: any) => String(workout?.id || ""))
      .filter((id) => id && !restoredIds.has(id));

    for (const id of removedWorkoutIds) {
      await markWorkoutDeletedLocally(id, uid);
    }
    for (const workout of restoredWorkouts) {
      await clearWorkoutDeletedLocally(String(workout?.id || ""), uid);
    }

    await saveLocalWorkoutHistory(restoredWorkouts, uid);
    await retryPendingWorkoutDeletes(uid);
    await pushWorkoutListToCloud(restoredWorkouts);
    results.workouts = restoredWorkouts.length;
  }

  const restoreTemplates = selected.has("templates");
  const restoreFolders = selected.has("folders");
  if (restoreTemplates || restoreFolders) {
    const currentCleanTemplates = sanitizeTemplatesForStorage(localTemplates);
    const currentCleanFolders = sanitizeFoldersForStorage(localFolders);
    const nextTemplatesSource = restoreTemplates
      ? cloud.templates
      : currentCleanTemplates;
    const nextFoldersSource = restoreFolders
      ? cloud.folders
      : currentCleanFolders;
    const reconciled = reconcileTemplatesAndFoldersForStorage(
      nextTemplatesSource,
      nextFoldersSource,
    );
    const templatesChanged =
      JSON.stringify(currentCleanTemplates) !==
      JSON.stringify(reconciled.templates);
    const foldersChanged =
      JSON.stringify(currentCleanFolders) !== JSON.stringify(reconciled.folders);

    await AsyncStorage.setItem(
      `@workout_templates_${uid}`,
      JSON.stringify(reconciled.templates),
    );
    await AsyncStorage.setItem(
      `@workout_folders_${uid}`,
      JSON.stringify(reconciled.folders),
    );

    if (restoreTemplates) {
      await syncObjectRestoreCategory(
        uid,
        "templates",
        reconciled.templates,
        currentCleanTemplates,
      );
      results.templates = reconciled.templates.length;
    } else if (templatesChanged) {
      const write = await syncConfigToCloud("templates", reconciled.templates);
      if (!write.synced) {
        throw write.error || new Error("Could not sync cleaned templates.");
      }
    }
    if (restoreFolders) {
      await syncObjectRestoreCategory(
        uid,
        "folders",
        reconciled.folders,
        currentCleanFolders,
      );
      results.folders = reconciled.folders.length;
    } else if (foldersChanged) {
      const write = await syncConfigToCloud("folders", reconciled.folders);
      if (!write.synced) {
        throw write.error || new Error("Could not sync cleaned folders.");
      }
    }
  }

  if (selected.has("personalExercises")) {
    const restoredPersonalExercises = cloud.personalExercises;
    await AsyncStorage.setItem(
      `@user_exercises_${uid}`,
      JSON.stringify(restoredPersonalExercises),
    );
    await syncObjectRestoreCategory(
      uid,
      "personal_exercises",
      restoredPersonalExercises,
      cleanStoredCustomExercises(localPersonalExercises),
    );
    results.personalExercises = restoredPersonalExercises.length;
  }

  if (selected.has("favoriteExercises")) {
    const restoredFavoriteExercises = cloud.favoriteExercises;
    await AsyncStorage.setItem(
      `@favorite_exercises_${uid}`,
      JSON.stringify(restoredFavoriteExercises),
    );
    await syncStringRestoreCategory(
      uid,
      "favorite_exercises",
      restoredFavoriteExercises,
      dedupeStringArray(parseBackupStringArray(localFavoriteExercises)),
    );
    results.favoriteExercises = restoredFavoriteExercises.length;
  }

  if (selected.has("gyms")) {
    const restoredGyms = cloud.gyms;
    await AsyncStorage.setItem(`@user_gyms_${uid}`, JSON.stringify(restoredGyms));
    await syncGymRestoreCategory(
      uid,
      restoredGyms,
      sanitizeGymsForStorage(localGyms),
    );
    results.gyms = restoredGyms.length;
  }

  if (selected.has("machineBrands")) {
    const restoredMachineBrands = cloud.machineBrands;
    await AsyncStorage.setItem(
      `@global_variants_${uid}`,
      JSON.stringify(restoredMachineBrands),
    );
    await syncStringRestoreCategory(
      uid,
      "global_variants",
      restoredMachineBrands,
      sanitizeMachineBrandsForStorage(localMachineBrands),
    );
    results.machineBrands = restoredMachineBrands.length;
  }

  if (selected.has("settings")) {
    for (const key of Object.keys(cloud.settings)) {
      await writeImportedSettingValue(uid, key, cloud.settings[key]);
    }
    const cloudSettings = backupSettingsToCloudSettings(cloud.settings);
    if (Object.keys(cloudSettings).length > 0) {
      await syncSettingsToCloud(cloudSettings);
    }
    results.settings = Object.keys(cloud.settings).length;
  }

  if (restoreTemplates || restoreFolders || selected.has("settings")) {
    await validateActiveSplitAfterFolderSync(uid);
  }

  const refreshedStatus = await getLocalCloudSyncStatus(uid);

  return {
    restored: results,
    selected: Array.from(selected),
    readAt: cloud.readAt,
    syncStatus: refreshedStatus,
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

  try {
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

    const templateFolderReconciliation =
      await reconcileLocalTemplatesAndFolders(uid);
    await validateActiveSplitAfterFolderSync(uid);

    const getConfigCount = (key: string) =>
      configs.find((item: any) => item.key === key)?.mergedCount ?? 0;
    const templatesCount = templateFolderReconciliation.templatesCount;
    const foldersCount = templateFolderReconciliation.foldersCount;

    const syncedAt = Date.now();
    const syncStatus: CloudSyncStatus = {
      lastSyncedAt: syncedAt,
      lastAttemptedAt: syncedAt,
      success: true,
      workouts: workouts.mergedCount,
      templates: templatesCount,
      folders: foldersCount,
      personalExercises: getConfigCount("personal_exercises"),
      favoriteExercises: getConfigCount("favorite_exercises"),
      gyms: getConfigCount("gyms"),
      machineBrands: getConfigCount("global_variants"),
      settingsSynced: !!settings.synced,
      uploadedWorkouts: workouts.uploaded,
    };

    await saveCloudSyncStatus(syncStatus, uid);

    return {
      workouts,
      configs: configs.map((config: any) => {
        if (config.key === "templates") {
          return { ...config, mergedCount: templatesCount };
        }
        if (config.key === "folders") {
          return { ...config, mergedCount: foldersCount };
        }
        return config;
      }),
      settings,
      syncStatus,
    };
  } catch (error) {
    await saveLocalCloudSyncFailure(uid, error);
    throw error;
  }
};
