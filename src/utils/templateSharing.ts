import * as Crypto from "expo-crypto";
import { INITIAL_EXERCISES } from "../constants/data";
import {
  LIMITS,
  cleanLimitedText,
  limitText,
} from "../constants/limits";
import {
  genId,
  getExerciseAttachmentForSave,
  getExerciseAttachmentOptions,
  getExerciseSupportsVariantsForStorage,
  getExerciseVariationOptions,
  hasExplicitNoAttachment,
  normalizeExerciseForAttachmentStorage,
  normalizeExerciseMuscleGroup,
} from "./helpers";
import {
  createCustomExerciseRecord,
  normalizeStoredExerciseName,
} from "./exerciseLibraryStorage";

export const TEMPLATE_SHARE_EXTENSION = "ironvault-template";
export const TEMPLATE_SHARE_MIME_TYPE = "application/vnd.ironvault.template";
export const MAX_TEMPLATE_SHARE_FILE_BYTES = 200 * 1024;
const TEMPLATE_SHARE_FILE_TYPE = "ironvault.template.share";
const TEMPLATE_SHARE_FILE_VERSION = 1;
const TEMPLATE_SHARE_CHECKSUM_ALGORITHM = "SHA-256";

export type TemplateImportPreview = {
  payload: any;
  suggestedName: string;
  exerciseCount: number;
  setCount: number;
  customExercisesToAdd: any[];
  existingCustomExerciseNames: string[];
  builtInExerciseNames: string[];
};

const isPlainObject = (value: any) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const stableStringify = (value: any): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
};

const createTemplateShareChecksum = async (payload: any) =>
  Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    stableStringify(payload),
  );

const assertTemplateShareCondition = (
  condition: boolean,
  message = "This is not a valid IronVault template file.",
) => {
  if (!condition) throw new Error(message);
};

const sanitizeVariationOptions = (value: any) => {
  if (!Array.isArray(value)) return undefined;
  const options = Array.from(
    new Set(
      value
        .map((item) => cleanLimitedText(item, LIMITS.nameChars))
        .filter(Boolean),
    ),
  ).slice(0, 6);
  return options.length > 0 ? options : undefined;
};

const sanitizeSetFlags = (exercise: any, strict = false) => {
  const sets = Array.isArray(exercise?.sets) ? exercise.sets : [];
  let warmups = 0;
  let working = 0;

  sets.forEach((set: any) => {
    if (strict && !isPlainObject(set)) {
      throw new Error("This template contains invalid set data.");
    }
    if (set?.isWarmup) warmups += 1;
    else working += 1;
  });

  if (sets.length === 0) {
    warmups = Math.max(
      0,
      Math.min(LIMITS.warmupSetsPerExercise, Number(exercise?.warmupSets || 0)),
    );
    working = Math.max(
      0,
      Math.min(
        LIMITS.workingSetsPerExercise,
        Number(exercise?.workingSets ?? exercise?.sets ?? 1),
      ),
    );
  }

  if (
    strict &&
    (warmups > LIMITS.warmupSetsPerExercise ||
      working > LIMITS.workingSetsPerExercise)
  ) {
    throw new Error("This template contains too many sets to import safely.");
  }

  warmups = Math.min(warmups, LIMITS.warmupSetsPerExercise);
  working = Math.min(working, LIMITS.workingSetsPerExercise);

  if (warmups + working === 0) working = 1;

  return [
    ...Array.from({ length: warmups }, () => ({ isWarmup: true })),
    ...Array.from({ length: working }, () => ({ isWarmup: false })),
  ];
};

export const getTemplateShareCounts = (template: any) => {
  const exercises = Array.isArray(template?.exercises)
    ? template.exercises
    : [];
  const setCount = exercises.reduce((total: number, exercise: any) => {
    if (Array.isArray(exercise?.sets)) return total + exercise.sets.length;
    return (
      total +
      Math.max(0, Number(exercise?.warmupSets || 0)) +
      Math.max(0, Number(exercise?.workingSets ?? exercise?.sets ?? 1))
    );
  }, 0);

  return {
    exerciseCount: exercises.length,
    setCount,
  };
};

const sanitizeTemplateExerciseForShare = (exercise: any, strict = false) => {
  if (strict && typeof exercise !== "string" && !isPlainObject(exercise)) {
    throw new Error("This template contains invalid exercise data.");
  }

  const source =
    typeof exercise === "string" ? { name: exercise, sets: 1 } : exercise || {};
  if (strict && typeof source.name !== "string") {
    throw new Error("This template contains an exercise with an invalid name.");
  }

  const name = cleanLimitedText(
    source.name || (strict ? "" : "Exercise"),
    LIMITS.nameChars,
  );
  if (!name) {
    if (strict) throw new Error("This template contains an unnamed exercise.");
    return null;
  }

  const exerciseForVariantLookup = normalizeExerciseForAttachmentStorage({
    ...source,
    name,
  });
  const variationOptions =
    sanitizeVariationOptions(source.variationOptions) ||
    getExerciseVariationOptions(exerciseForVariantLookup);
  const supportsVariants = getExerciseSupportsVariantsForStorage({
    ...exerciseForVariantLookup,
    variationOptions,
  });
  const attachmentOptions = getExerciseAttachmentOptions(exerciseForVariantLookup)
    .map((option) => cleanLimitedText(option, LIMITS.nameChars))
    .filter(Boolean)
    .slice(0, 16);
  const attachment = cleanLimitedText(
    getExerciseAttachmentForSave(exerciseForVariantLookup),
    LIMITS.nameChars,
  );
  const explicitNoAttachment =
    hasExplicitNoAttachment(exerciseForVariantLookup);

  const sanitized: any = {
    name: cleanLimitedText(
      exerciseForVariantLookup.name || name,
      LIMITS.nameChars,
    ),
    reminder: limitText(source.reminder || "", LIMITS.cueChars).trim(),
    muscle: normalizeExerciseMuscleGroup(exerciseForVariantLookup.muscle),
    exerciseVariant:
      cleanLimitedText(
        exerciseForVariantLookup.exerciseVariant ||
          (variationOptions.length > 0 ? "Normal" : ""),
        LIMITS.nameChars,
      ) || "Normal",
    is_unilateral: exerciseForVariantLookup.is_unilateral === true,
    supportsVariants: supportsVariants === true,
    sets: sanitizeSetFlags(source, strict),
  };

  if (variationOptions.length > 0) sanitized.variationOptions = variationOptions;
  if (attachment || explicitNoAttachment) sanitized.attachment = attachment;
  if (attachmentOptions.length > 0) {
    sanitized.attachmentOptions = attachmentOptions;
    sanitized.supportsAttachments = true;
  }

  const supersetId = cleanLimitedText(source.supersetId || "", 80);
  if (supersetId) sanitized.supersetId = supersetId;
  if (source.supersetOrder !== undefined && source.supersetOrder !== null) {
    const order = Math.max(1, Math.min(20, Math.round(Number(source.supersetOrder))));
    if (Number.isFinite(order)) sanitized.supersetOrder = order;
  }

  return sanitized;
};

const sanitizeCustomExerciseForShare = (exercise: any, strict = false) => {
  if (strict && !isPlainObject(exercise)) {
    throw new Error("This template contains invalid custom exercise data.");
  }

  if (strict && typeof exercise?.name !== "string") {
    throw new Error(
      "This template contains a custom exercise with an invalid name.",
    );
  }

  const name = cleanLimitedText(exercise?.name || "", LIMITS.nameChars);
  if (!name) {
    if (strict) {
      throw new Error("This template contains an unnamed custom exercise.");
    }
    return null;
  }

  const attachmentExercise = normalizeExerciseForAttachmentStorage({
    ...exercise,
    name,
  });
  const variationOptions = sanitizeVariationOptions(
    attachmentExercise?.variationOptions,
  );
  const supportsVariants = getExerciseSupportsVariantsForStorage({
    ...attachmentExercise,
    name,
    variationOptions,
  });
  const attachmentOptions = getExerciseAttachmentOptions(attachmentExercise)
    .map((option) => cleanLimitedText(option, LIMITS.nameChars))
    .filter(Boolean)
    .slice(0, 16);
  const attachment = cleanLimitedText(
    getExerciseAttachmentForSave(attachmentExercise),
    LIMITS.nameChars,
  );
  const explicitNoAttachment = hasExplicitNoAttachment(attachmentExercise);

  const sanitized: any = {
    name: cleanLimitedText(
      attachmentExercise.name || name,
      LIMITS.nameChars,
    ),
    muscle: normalizeExerciseMuscleGroup(attachmentExercise?.muscle),
    reminder: limitText(
      attachmentExercise?.reminder || "",
      LIMITS.cueChars,
    ).trim(),
    is_unilateral: attachmentExercise?.is_unilateral === true,
    supportsVariants: supportsVariants === true,
    is_custom: true,
    source: "custom",
    createdByUser: true,
  };

  if (variationOptions) sanitized.variationOptions = variationOptions;
  if (attachment || explicitNoAttachment) sanitized.attachment = attachment;
  if (attachmentOptions.length > 0) {
    sanitized.attachmentOptions = attachmentOptions;
    sanitized.supportsAttachments = true;
  }

  return sanitized;
};

export const buildTemplateShareInput = (
  template: any,
  personalExercises: any[] = [],
) => {
  const templateExercises = (Array.isArray(template?.exercises)
    ? template.exercises
    : []
  )
    .slice(0, LIMITS.exercisesPerWorkout)
    .map((exercise: any) => sanitizeTemplateExerciseForShare(exercise))
    .filter(Boolean);

  const customByName = new Map<string, any>();
  (Array.isArray(personalExercises) ? personalExercises : []).forEach(
    (exercise: any) => {
      if (!exercise?.is_custom) return;
      const key = normalizeStoredExerciseName(exercise.name);
      if (!key) return;
      customByName.set(key, exercise);
    },
  );

  const usedCustomExercises = new Map<string, any>();
  templateExercises.forEach((exercise: any) => {
    const key = normalizeStoredExerciseName(exercise.name);
    const custom = customByName.get(key);
    if (!custom) return;
    const sanitized = sanitizeCustomExerciseForShare(custom);
    if (sanitized) usedCustomExercises.set(key, sanitized);
  });

  return {
    template: {
      name:
        cleanLimitedText(template?.name || "Shared Template", LIMITS.nameChars) ||
        "Shared Template",
      exercises: templateExercises,
    },
    customExercises: Array.from(usedCustomExercises.values()),
  };
};

const sanitizeTemplateSharePayload = (input: any, strict = false) => {
  if (strict) {
    assertTemplateShareCondition(
      isPlainObject(input),
      "This is not a valid IronVault template file.",
    );
    assertTemplateShareCondition(
      input.schemaVersion === TEMPLATE_SHARE_FILE_VERSION,
      "This template file was created by an unsupported IronVault version.",
    );
    assertTemplateShareCondition(
      input.app === "IronVault",
      "This is not a valid IronVault template file.",
    );
    assertTemplateShareCondition(
      isPlainObject(input.template),
      "This template file does not contain a valid template.",
    );
  }

  const template = input?.template || {};
  const rawExercises = Array.isArray(template.exercises)
    ? template.exercises
    : [];

  if (strict) {
    assertTemplateShareCondition(
      rawExercises.length > 0,
      "This template does not contain any exercises.",
    );
    assertTemplateShareCondition(
      rawExercises.length <= LIMITS.exercisesPerWorkout,
      "This template contains too many exercises to import safely.",
    );
  }

  const exercises = rawExercises
    .slice(0, LIMITS.exercisesPerWorkout)
    .map((exercise: any) => sanitizeTemplateExerciseForShare(exercise, strict))
    .filter(Boolean);

  if (strict) {
    assertTemplateShareCondition(
      exercises.length === rawExercises.length,
      "This template contains invalid exercise data.",
    );
  }

  assertTemplateShareCondition(
    exercises.length > 0,
    "Template must include at least one exercise.",
  );

  const templateName =
    cleanLimitedText(template.name || "Shared Template", LIMITS.nameChars) ||
    "Shared Template";
  const templateExerciseNameKeys = new Set(
    exercises
      .map((exercise: any) => normalizeStoredExerciseName(exercise.name))
      .filter(Boolean),
  );
  const rawCustomExercises = Array.isArray(input?.customExercises)
    ? input.customExercises
    : [];

  if (strict) {
    assertTemplateShareCondition(
      rawCustomExercises.length <= LIMITS.exercisesPerWorkout,
      "This template contains too many custom exercises to import safely.",
    );
  }

  const customByName = new Map<string, any>();
  rawCustomExercises
    .slice(0, LIMITS.exercisesPerWorkout)
    .map((exercise: any) => sanitizeCustomExerciseForShare(exercise, strict))
    .filter(Boolean)
    .forEach((exercise: any) => {
      const key = normalizeStoredExerciseName(exercise.name);
      if (!key) return;

      if (strict) {
        assertTemplateShareCondition(
          templateExerciseNameKeys.has(key),
          "This template file contains custom exercises that are not used by the template.",
        );
      }

      customByName.set(key, exercise);
    });

  const exportedAt = Number(input?.exportedAt || Date.now());
  if (strict) {
    assertTemplateShareCondition(
      Number.isFinite(exportedAt),
      "This template file has invalid export metadata.",
    );
  }

  return {
    schemaVersion: TEMPLATE_SHARE_FILE_VERSION,
    app: "IronVault",
    exportedAt: Number.isFinite(exportedAt) ? exportedAt : Date.now(),
    template: {
      name: templateName,
      exercises,
    },
    customExercises: Array.from(customByName.values()),
  };
};

export const assertReasonableTemplateShareFileSize = (raw: string) => {
  if (String(raw || "").length > MAX_TEMPLATE_SHARE_FILE_BYTES) {
    throw new Error("This template file is too large to import safely.");
  }
};

export const createTemplateShareEnvelope = async (
  template: any,
  personalExercises: any[] = [],
) => {
  const payload = sanitizeTemplateSharePayload(
    buildTemplateShareInput(template, personalExercises),
  );

  return {
    type: TEMPLATE_SHARE_FILE_TYPE,
    version: TEMPLATE_SHARE_FILE_VERSION,
    format: "local-validation",
    checksumAlgorithm: TEMPLATE_SHARE_CHECKSUM_ALGORITHM,
    checksum: await createTemplateShareChecksum(payload),
    payload,
  };
};

export const parseTemplateShareFile = async (raw: string) => {
  assertReasonableTemplateShareFileSize(raw);
  let parsed: any;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("This is not a valid IronVault template file.");
  }

  if (
    !parsed ||
    parsed.type !== TEMPLATE_SHARE_FILE_TYPE ||
    parsed.version !== TEMPLATE_SHARE_FILE_VERSION ||
    parsed.format !== "local-validation" ||
    parsed.checksumAlgorithm !== TEMPLATE_SHARE_CHECKSUM_ALGORITHM ||
    typeof parsed.checksum !== "string" ||
    !parsed.payload
  ) {
    throw new Error("This is not a valid IronVault template file.");
  }

  const checksum = await createTemplateShareChecksum(parsed.payload);
  if (checksum !== parsed.checksum) {
    throw new Error("This template file was changed or corrupted.");
  }

  return sanitizeTemplateSharePayload(parsed.payload, true);
};

export const getTemplateShareFileName = (templateName: string) => {
  const safeName =
    cleanLimitedText(templateName || "IronVault Template", LIMITS.nameChars)
      .replace(/[^\w\s.-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "IronVault-Template";
  return `${safeName}.${TEMPLATE_SHARE_EXTENSION}`;
};

export const serializeTemplateShareEnvelope = (envelope: any) =>
  JSON.stringify(envelope);

const getBuiltInNameKeys = () =>
  new Set(
    INITIAL_EXERCISES.map((exercise: any) =>
      normalizeStoredExerciseName(exercise?.name),
    ).filter(Boolean),
  );

export const buildTemplateImportPreview = (
  payload: any,
  existingCustomExercises: any[] = [],
): TemplateImportPreview => {
  const template = payload?.template || {};
  const exercises = Array.isArray(template.exercises)
    ? template.exercises.slice(0, LIMITS.exercisesPerWorkout)
    : [];
  const builtInNameKeys = getBuiltInNameKeys();
  const existingCustomByName = new Map<string, any>();

  existingCustomExercises.forEach((exercise: any) => {
    const key = normalizeStoredExerciseName(exercise?.name);
    if (key) existingCustomByName.set(key, exercise);
  });

  const customExercisesToAdd: any[] = [];
  const existingCustomExerciseNames: string[] = [];
  const builtInExerciseNames: string[] = [];

  (Array.isArray(payload?.customExercises) ? payload.customExercises : [])
    .slice(0, LIMITS.exercisesPerWorkout)
    .map((exercise: any) => sanitizeCustomExerciseForShare(exercise))
    .filter(Boolean)
    .forEach((exercise: any) => {
      const key = normalizeStoredExerciseName(exercise.name);
      if (!key) return;

      if (existingCustomByName.has(key)) {
        existingCustomExerciseNames.push(exercise.name);
        return;
      }

      if (builtInNameKeys.has(key)) {
        builtInExerciseNames.push(exercise.name);
        return;
      }

      customExercisesToAdd.push(exercise);
      existingCustomByName.set(key, exercise);
    });

  const counts = getTemplateShareCounts({ exercises });

  return {
    payload,
    suggestedName:
      cleanLimitedText(template.name || "Imported Template", LIMITS.nameChars) ||
      "Imported Template",
    exerciseCount: counts.exerciseCount,
    setCount: counts.setCount,
    customExercisesToAdd,
    existingCustomExerciseNames,
    builtInExerciseNames,
  };
};

export const templateNameExists = (
  name: string,
  templates: any[] = [],
) => {
  const key = normalizeStoredExerciseName(name);
  if (!key) return false;
  return templates.some(
    (template: any) => normalizeStoredExerciseName(template?.name) === key,
  );
};

export const buildImportedTemplateRecord = (
  payload: any,
  templateName: string,
) => {
  const supersetIdMap = new Map<string, string>();

  const exercises = (Array.isArray(payload?.template?.exercises)
    ? payload.template.exercises
    : []
  )
    .slice(0, LIMITS.exercisesPerWorkout)
    .map((exercise: any) => sanitizeTemplateExerciseForShare(exercise))
    .filter(Boolean)
    .map((exercise: any) => {
      const nextExercise: any = {
        ...exercise,
        id: genId("ex-"),
        muscle: normalizeExerciseMuscleGroup(exercise.muscle),
        sets: sanitizeSetFlags(exercise),
      };

      delete nextExercise.gymReplacements;
      delete nextExercise.brand;
      delete nextExercise.machineBrand;
      delete nextExercise.equipmentTag;

      if (exercise.supersetId) {
        if (!supersetIdMap.has(exercise.supersetId)) {
          supersetIdMap.set(exercise.supersetId, genId("ss-"));
        }
        nextExercise.supersetId = supersetIdMap.get(exercise.supersetId);
      }

      return nextExercise;
    });

  return {
    id: genId("tpl-"),
    name:
      cleanLimitedText(templateName || "Imported Template", LIMITS.nameChars) ||
      "Imported Template",
    exercises,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    importedFromTemplateShare: true,
  };
};

export const buildImportedCustomExerciseRecords = (
  exercises: any[] = [],
) =>
  exercises
    .map((exercise: any) => sanitizeCustomExerciseForShare(exercise))
    .filter(Boolean)
    .map((exercise: any) =>
      createCustomExerciseRecord({
        name: exercise.name,
        muscle: normalizeExerciseMuscleGroup(exercise.muscle),
        reminder: exercise.reminder,
        is_unilateral: exercise.is_unilateral,
        supportsVariants: exercise.supportsVariants,
        variationOptions: exercise.variationOptions,
        attachment: exercise.attachment,
        attachmentOptions: exercise.attachmentOptions,
        supportsAttachments: exercise.supportsAttachments,
      }),
    );
