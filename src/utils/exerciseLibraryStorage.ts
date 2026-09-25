import AsyncStorage from "@react-native-async-storage/async-storage";
import { INITIAL_EXERCISES } from "../constants/data";
import { LIMITS, cleanLimitedText, limitText } from "../constants/limits";
import {
  getExerciseAttachmentForSave,
  getExerciseAttachmentOptions,
  hasExplicitNoAttachment,
  normalizeExerciseForAttachmentStorage,
  normalizeExerciseImageUrl,
} from "./helpers";

export const normalizeStoredExerciseName = (value: any) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const LEGACY_IMPORTED_CUSTOM_NAMES = new Set([
  "cable hammer curls - rope attachment",
  "calf raise",
  "lying leg curls",
  "lying leg curl",
  "machine jm press",
  "quad extension",
  "single arm reverse pec deck",
  "single arm rope hammer curl",
  "squat",
  "standing biceps cable curl",
  "straight bar cable crunches",
  "straight bar forearm curl",
  "tricep overhead extension",
  "tricep press machine",
  "triceps overhead extension with rope",
  "triceps pushdown",
]);

const getExerciseIdentityKeys = (exercise: any) => {
  const keys = new Set<string>();
  const id = String(exercise?.id || "").trim().toLowerCase();
  const name = normalizeStoredExerciseName(exercise?.name);
  const rawImage = String(exercise?.image || "").trim();
  const image = normalizeExerciseImageUrl(rawImage).toLowerCase();

  if (id) keys.add(`id:${id}`);
  if (name) keys.add(`name:${name}`);
  if (image) keys.add(`image:${image}`);

  return Array.from(keys);
};

export const looksLikeLegacyStoredExercise = (exercise: any) => {
  const id = String(exercise?.id || "").trim().toLowerCase();
  const name = normalizeStoredExerciseName(exercise?.name);
  const image = normalizeExerciseImageUrl(exercise?.image || "").toLowerCase();

  return (
    LEGACY_IMPORTED_CUSTOM_NAMES.has(name) ||
    /^ex-/.test(id) ||
    id.startsWith("gh_") ||
    image.includes("githubusercontent.com/junkaiiiiii/ironvault-exercises") ||
    image.includes("/junkaiiiiii/ironvault-exercises/") ||
    image.includes("/ironvault-exercises/main/images/") ||
    image.includes("githubusercontent.com/yuhonas/free-exercise-db") ||
    image.includes("/yuhonas/free-exercise-db/") ||
    image.includes("free-exercise-db")
  );
};


export const createCustomExerciseRecord = (exercise: any) => {
  const normalizedExercise = normalizeExerciseForAttachmentStorage(exercise);
  const attachmentOptions = getExerciseAttachmentOptions(normalizedExercise);
  const attachment = getExerciseAttachmentForSave(normalizedExercise) || "";
  const explicitNoAttachment = hasExplicitNoAttachment(normalizedExercise);
  return {
    ...normalizedExercise,
    name: cleanLimitedText(normalizedExercise?.name, LIMITS.nameChars),
    reminder: limitText(normalizedExercise?.reminder, LIMITS.cueChars).trim(),
    attachment: (attachment || explicitNoAttachment) ? attachment : undefined,
    attachmentOptions:
      attachmentOptions.length > 0 ? attachmentOptions : undefined,
    supportsAttachments: attachmentOptions.length > 0 ? true : undefined,
    id:
      normalizedExercise?.id && !looksLikeLegacyStoredExercise(normalizedExercise)
        ? normalizedExercise.id
        : `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    is_custom: true,
    source: "custom",
    createdByUser: true,
    createdAt: normalizedExercise?.createdAt || Date.now(),
  };
};

export const looksLikeAppCreatedCustomExercise = (exercise: any) => {
  if (!exercise || exercise.is_custom !== true) return false;

  const name = normalizeStoredExerciseName(exercise?.name);
  if (!name || LEGACY_IMPORTED_CUSTOM_NAMES.has(name)) return false;

  const image = normalizeExerciseImageUrl(exercise?.image || "").trim();
  const equipment = String(exercise?.equipment || "").trim();
  const hasLegacyLibraryFields =
    !!image ||
    !!equipment ||
    exercise?.instructions !== undefined ||
    exercise?.description !== undefined ||
    exercise?.level !== undefined ||
    exercise?.force !== undefined ||
    exercise?.mechanic !== undefined ||
    exercise?.category !== undefined ||
    exercise?.secondaryMuscles !== undefined;

  if (hasLegacyLibraryFields) return false;

  const id = String(exercise?.id || "").trim().toLowerCase();
  const hasCustomIdentity =
    id.startsWith("custom_") ||
    id.startsWith("iv_custom_") ||
    exercise.createdByUser === true;

  const hasCustomFormFields =
    exercise?.reminder !== undefined ||
    exercise?.is_unilateral !== undefined ||
    exercise?.supportsVariants !== undefined ||
    exercise?.variationOptions !== undefined;

  return hasCustomIdentity && hasCustomFormFields;
};

export const cleanStoredCustomExercises = (
  exercises: any[],
  referenceExercises: any[] = [],
) => {
  const references = [...INITIAL_EXERCISES, ...referenceExercises];
  const builtInIdentityKeys = new Set<string>();
  const builtInNameKeys = new Set<string>();

  references.forEach((exercise) => {
    getExerciseIdentityKeys(exercise).forEach((identityKey) =>
      builtInIdentityKeys.add(identityKey),
    );

    const nameKey = normalizeStoredExerciseName(exercise?.name);
    if (nameKey) builtInNameKeys.add(nameKey);
  });

  const customByName = new Map<string, any>();

  (Array.isArray(exercises) ? exercises : []).forEach((exercise) => {
    if (!exercise || exercise.is_custom !== true) return;

    const nameKey = normalizeStoredExerciseName(exercise?.name);
    if (!nameKey) return;

    const matchesBuiltInByIdentity = getExerciseIdentityKeys(exercise).some(
      (identityKey) => builtInIdentityKeys.has(identityKey),
    );
    const matchesBuiltInByName = builtInNameKeys.has(nameKey);
    const matchesLegacyStorageShape = looksLikeLegacyStoredExercise(exercise);
    const appCreatedCustom = looksLikeAppCreatedCustomExercise(exercise);

    if (
      matchesBuiltInByIdentity ||
      matchesBuiltInByName ||
      matchesLegacyStorageShape ||
      !appCreatedCustom
    ) {
      return;
    }

    customByName.set(nameKey, {
      ...exercise,
      name: cleanLimitedText(exercise.name, LIMITS.nameChars),
      reminder: limitText(exercise.reminder, LIMITS.cueChars).trim(),
      is_custom: true,
      source: "custom",
      createdByUser: true,
    });
  });

  return Array.from(customByName.values()).sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || "")),
  ).slice(0, LIMITS.customExercisesPerUser);
};

export const loadAndMigratePersonalExercises = async (
  uid: string,
  referenceExercises: any[] = [],
) => {
  const storageKey = `@user_exercises_${uid}`;
  const raw = await AsyncStorage.getItem(storageKey);
  let parsed: any[] = [];
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    parsed = [];
  }
  const stored = Array.isArray(parsed) ? parsed : [];
  const cleaned = cleanStoredCustomExercises(stored, referenceExercises);

  if (JSON.stringify(stored) !== JSON.stringify(cleaned)) {
    await AsyncStorage.setItem(storageKey, JSON.stringify(cleaned));
  }

  return cleaned;
};

export const saveCleanPersonalExercises = async (
  uid: string,
  exercises: any[],
  referenceExercises: any[] = [],
) => {
  const cleaned = cleanStoredCustomExercises(exercises, referenceExercises);
  await AsyncStorage.setItem(
    `@user_exercises_${uid}`,
    JSON.stringify(cleaned),
  );
  return cleaned;
};
