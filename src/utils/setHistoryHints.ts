import {
  cleanExerciseNameForAttachments,
  getExerciseAttachmentForStorage,
  isMachineBrandApplicable,
} from "./helpers";
import { LIMITS } from "../constants/limits";

export type HistoricalSetHint = {
  weight: string;
  reps: string;
  repsL: string;
  repsR: string;
};

export type HistoricalSetPositionHints = {
  warmup: Array<HistoricalSetHint | undefined>;
  working: Array<HistoricalSetHint | undefined>;
};

export type HistoricalWeightPrefillEntry =
  | { mode: "eligible" }
  | { mode: "auto"; value: string }
  | { mode: "manual" };

export type HistoricalWeightPrefillState = Record<
  string,
  HistoricalWeightPrefillEntry
>;

type HistoricalSetCandidate = {
  hint: HistoricalSetHint;
  weight: number;
  repScore: number;
  balanceScore: number;
  timestamp: number;
};

const normalizeText = (value: any) =>
  String(value || "")
    .trim()
    .toLowerCase();

const getExerciseBrandKey = (exercise: any) =>
  normalizeText(
    exercise?.equipmentTag || exercise?.machineBrand || exercise?.brand,
  );

const getExerciseVariantKey = (exercise: any) =>
  normalizeText(exercise?.exerciseVariant || exercise?.variation || "Normal");

const getExerciseAttachmentKey = (exercise: any) =>
  normalizeText(getExerciseAttachmentForStorage(exercise) || "None");

const getExerciseStableId = (exercise: any) =>
  normalizeText(exercise?.originalExerciseId || exercise?.exerciseId);

export const getHistoricalSetHintIdentityKey = (exercise: any) => {
  const brandApplicable = isMachineBrandApplicable(exercise);
  return [
    normalizeText(cleanExerciseNameForAttachments(exercise)),
    getExerciseVariantKey(exercise),
    getExerciseAttachmentKey(exercise),
    brandApplicable
      ? `brand:${getExerciseBrandKey(exercise)}`
      : "brand:not-applicable",
    exercise?.is_unilateral ? "unilateral" : "bilateral",
  ].join("::");
};

const exercisesMatch = (target: any, historical: any) => {
  if (
    normalizeText(cleanExerciseNameForAttachments(target)) !==
    normalizeText(cleanExerciseNameForAttachments(historical))
  ) {
    return false;
  }
  const targetStableId = getExerciseStableId(target);
  const historicalStableId = getExerciseStableId(historical);
  if (
    targetStableId &&
    historicalStableId &&
    targetStableId !== historicalStableId
  ) {
    return false;
  }
  if (getExerciseVariantKey(target) !== getExerciseVariantKey(historical)) {
    return false;
  }
  if (
    getExerciseAttachmentKey(target) !== getExerciseAttachmentKey(historical)
  ) {
    return false;
  }
  if (
    isMachineBrandApplicable(target) &&
    getExerciseBrandKey(target) !== getExerciseBrandKey(historical)
  ) {
    return false;
  }
  return true;
};

const toPositiveNumber = (value: any) => {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const convertWeight = (
  weight: number,
  historicalWorkoutUsesKg: boolean,
  displayUsesKg: boolean,
) => {
  if (historicalWorkoutUsesKg === displayUsesKg) return weight;
  return displayUsesKg ? weight / 2.20462 : weight * 2.20462;
};

const formatWeight = (weight: number) => {
  const rounded = Math.round(weight * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

const getWorkoutTimestamp = (workout: any) => {
  const values = [workout?.finishedAt, workout?.startedAt, workout?.id];
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  const parsed = Date.parse(String(workout?.date || ""));
  return Number.isFinite(parsed) ? parsed : 0;
};

const makeCandidate = (
  targetExercise: any,
  historicalExercise: any,
  set: any,
  workout: any,
  displayUsesKg: boolean,
): HistoricalSetCandidate | null => {
  if (!set?.completed) return null;

  const rawWeight = toPositiveNumber(set?.weight);
  if (rawWeight === null) return null;

  const isUnilateral =
    !!targetExercise?.is_unilateral || !!historicalExercise?.is_unilateral;
  const reps = toPositiveNumber(set?.reps);
  const repsL = toPositiveNumber(set?.repsL);
  const repsR = toPositiveNumber(set?.repsR);

  if (isUnilateral ? repsL === null || repsR === null : reps === null) {
    return null;
  }

  const historicalWorkoutUsesKg =
    typeof workout?.isKg === "boolean" ? workout.isKg : displayUsesKg;
  const convertedWeight =
    Math.round(
      convertWeight(rawWeight, historicalWorkoutUsesKg, displayUsesKg) * 100,
    ) / 100;
  if (convertedWeight <= 0 || convertedWeight > LIMITS.setWeightMax) {
    return null;
  }

  return {
    hint: {
      weight: formatWeight(convertedWeight),
      reps: reps === null ? "0" : String(reps),
      repsL: repsL === null ? "0" : String(repsL),
      repsR: repsR === null ? "0" : String(repsR),
    },
    weight: convertedWeight,
    repScore: isUnilateral ? (repsL || 0) + (repsR || 0) : reps || 0,
    balanceScore: isUnilateral ? Math.min(repsL || 0, repsR || 0) : reps || 0,
    timestamp: getWorkoutTimestamp(workout),
  };
};

const isBetterCandidate = (
  candidate: HistoricalSetCandidate,
  current?: HistoricalSetCandidate,
) => {
  if (!current) return true;
  if (candidate.weight !== current.weight) {
    return candidate.weight > current.weight;
  }
  if (candidate.repScore !== current.repScore) {
    return candidate.repScore > current.repScore;
  }
  if (candidate.balanceScore !== current.balanceScore) {
    return candidate.balanceScore > current.balanceScore;
  }
  return candidate.timestamp > current.timestamp;
};

export const buildBestHistoricalSetPositionHints = (
  targetExercise: any,
  workoutHistory: any[],
  displayUsesKg: boolean,
): HistoricalSetPositionHints => {
  const candidates: {
    warmup: Array<HistoricalSetCandidate | undefined>;
    working: Array<HistoricalSetCandidate | undefined>;
  } = { warmup: [], working: [] };

  (workoutHistory || []).forEach((workout) => {
    (workout?.fullWorkoutData || []).forEach((historicalExercise: any) => {
      if (!exercisesMatch(targetExercise, historicalExercise)) return;

      let warmupPosition = 0;
      let workingPosition = 0;

      (historicalExercise?.sets || []).forEach((set: any) => {
        const bucket = set?.isWarmup ? "warmup" : "working";
        const position = set?.isWarmup
          ? warmupPosition++
          : workingPosition++;
        const candidate = makeCandidate(
          targetExercise,
          historicalExercise,
          set,
          workout,
          displayUsesKg,
        );
        if (!candidate) return;

        if (isBetterCandidate(candidate, candidates[bucket][position])) {
          candidates[bucket][position] = candidate;
        }
      });
    });
  });

  return {
    warmup: candidates.warmup.map((candidate) => candidate?.hint),
    working: candidates.working.map((candidate) => candidate?.hint),
  };
};

const getSetId = (set: any) => String(set?.id || "").trim();

const getSetWeight = (set: any) => String(set?.weight ?? "").trim();

const normalizePrefillEntry = (
  entry: any,
  set: any,
): HistoricalWeightPrefillEntry => {
  const currentWeight = getSetWeight(set);
  if (set?.completed) return { mode: "manual" };

  if (entry?.mode === "auto") {
    const storedValue = String(entry?.value ?? "").trim();
    if (storedValue && currentWeight === storedValue) {
      return { mode: "auto", value: storedValue };
    }
    return { mode: "manual" };
  }

  if (entry?.mode === "eligible" && !currentWeight) {
    return { mode: "eligible" };
  }

  return { mode: "manual" };
};

export const createHistoricalWeightPrefillState = (
  exercises: any[] = [],
): HistoricalWeightPrefillState => {
  const result: HistoricalWeightPrefillState = {};
  exercises.forEach((exercise) => {
    (exercise?.sets || []).forEach((set: any) => {
      const setId = getSetId(set);
      if (!setId) return;
      result[setId] =
        !set?.completed && !getSetWeight(set)
          ? { mode: "eligible" }
          : { mode: "manual" };
    });
  });
  return result;
};

export const restoreHistoricalWeightPrefillState = (
  rawState: any,
  exercises: any[] = [],
): HistoricalWeightPrefillState => {
  const source =
    rawState && typeof rawState === "object" && !Array.isArray(rawState)
      ? rawState
      : {};
  const result: HistoricalWeightPrefillState = {};

  exercises.forEach((exercise) => {
    (exercise?.sets || []).forEach((set: any) => {
      const setId = getSetId(set);
      if (!setId) return;
      result[setId] = normalizePrefillEntry(source[setId], set);
    });
  });

  return result;
};

export const markHistoricalWeightPrefillManual = (
  state: HistoricalWeightPrefillState,
  setId: any,
): HistoricalWeightPrefillState => {
  const key = String(setId || "").trim();
  if (!key || state[key]?.mode === "manual") return state;
  return { ...state, [key]: { mode: "manual" } };
};

export const reconcileHistoricalWeightPrefills = (
  exercises: any[] = [],
  hintsByExercise: HistoricalSetPositionHints[] = [],
  currentState: HistoricalWeightPrefillState = {},
) => {
  let exercisesChanged = false;
  const nextState: HistoricalWeightPrefillState = {};

  const nextExercises = exercises.map((exercise, exerciseIndex) => {
    let warmupPosition = 0;
    let workingPosition = 0;
    let setsChanged = false;
    const hints = hintsByExercise[exerciseIndex];

    const nextSets = (exercise?.sets || []).map((set: any) => {
      const setId = getSetId(set);
      const bucket = set?.isWarmup ? "warmup" : "working";
      const position = set?.isWarmup ? warmupPosition++ : workingPosition++;
      if (!setId) return set;

      const currentWeight = getSetWeight(set);
      let entry = currentState[setId]
        ? normalizePrefillEntry(currentState[setId], set)
        : currentWeight || set?.completed
          ? ({ mode: "manual" } as const)
          : ({ mode: "eligible" } as const);

      if (entry.mode === "manual") {
        nextState[setId] = entry;
        return set;
      }

      const desiredWeight = String(hints?.[bucket]?.[position]?.weight || "").trim();
      if (!desiredWeight) {
        nextState[setId] = { mode: "eligible" };
        if (entry.mode === "auto" && currentWeight) {
          setsChanged = true;
          return { ...set, weight: "" };
        }
        return set;
      }

      nextState[setId] = { mode: "auto", value: desiredWeight };
      if (currentWeight === desiredWeight) return set;
      setsChanged = true;
      return { ...set, weight: desiredWeight };
    });

    if (!setsChanged) return exercise;
    exercisesChanged = true;
    return { ...exercise, sets: nextSets };
  });

  return {
    exercises: exercisesChanged ? nextExercises : exercises,
    state: nextState,
    changed: exercisesChanged,
  };
};
