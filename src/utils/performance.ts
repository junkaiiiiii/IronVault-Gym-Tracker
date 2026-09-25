import {
  cleanExerciseNameForAttachments,
  getExerciseAttachmentForStorage,
} from "./helpers";

export type WorkoutPRType =
  | "BEST_WEIGHT"
  | "BEST_E1RM"
  | "BEST_VOLUME_SET"
  | "REP_MAX";

export type WorkoutPRRecord = {
  id: string;
  exerciseName: string;
  displayName: string;
  variant?: string | null;
  attachment?: string | null;
  type: WorkoutPRType;
  label: string;
  weight: number;
  reps: number;
  repsLabel: string;
  value: number;
  previousValue?: number | null;
  estimated1RM?: number;
  setVolume?: number;
  unit?: string;
};

const CANONICAL_REP_PR_TARGETS = [1, 3, 5, 8, 10, 12, 15, 20];

const toNumber = (value: any): number => {
  const parsed =
    typeof value === "number" ? value : parseFloat(String(value ?? "0"));
  return Number.isFinite(parsed) ? parsed : 0;
};

const toInt = (value: any): number => {
  const parsed =
    typeof value === "number" ? value : parseInt(String(value ?? "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

const roundStat = (value: number) => Number(value.toFixed(1));

export const calculateEstimated1RM = (
  weightInput: any,
  repsInput: any,
): number => {
  const weight = toNumber(weightInput);
  const reps = toInt(repsInput);
  if (weight <= 0 || reps <= 0 || reps > 36) return 0;
  return roundStat(weight * (1 + reps / 30));
};

export const getSetRepsInfo = (set: any, isUnilateral?: boolean) => {
  if (isUnilateral) {
    const repsL = toInt(set?.repsL);
    const repsR = toInt(set?.repsR);
    const bestSide = Math.max(repsL, repsR);
    const total = repsL + repsR;
    return {
      bestSide,
      total,
      label: `${repsL || 0}L / ${repsR || 0}R`,
    };
  }

  const reps = toInt(set?.reps);
  return {
    bestSide: reps,
    total: reps,
    label: `${reps || 0}`,
  };
};

export const calculateSetVolume = (
  set: any,
  isUnilateral?: boolean,
): number => {
  const weight = toNumber(set?.weight);
  const reps = getSetRepsInfo(set, isUnilateral);
  if (weight <= 0 || reps.total <= 0) return 0;
  return roundStat(weight * reps.total);
};

const normalizeName = (value: any) =>
  String(value || "")
    .trim()
    .toLowerCase();

const getVariant = (exercise: any) => {
  const variant = exercise?.exerciseVariant || exercise?.variation || null;
  if (!variant || variant === "Normal") return "Normal";
  return String(variant);
};

const getAttachment = (exercise: any) =>
  getExerciseAttachmentForStorage(exercise) || "None";

export const getExercisePerformanceKey = (exercise: any) =>
  `${normalizeName(cleanExerciseNameForAttachments(exercise))}::${getVariant(
    exercise,
  )}::${getAttachment(exercise)}`;

export const formatExercisePerformanceName = (exercise: any) => {
  const name = cleanExerciseNameForAttachments(exercise) || "Exercise";
  const variant = getVariant(exercise);
  const attachment = getExerciseAttachmentForStorage(exercise);
  const parts = [name];
  if (variant && variant !== "Normal") parts.push(variant);
  if (attachment) parts.push(attachment);
  return parts.join(" · ");
};

const getExerciseKey = getExercisePerformanceKey;
const formatDisplayName = formatExercisePerformanceName;

const getCompletedWorkingSets = (exercise: any) => {
  const sets = Array.isArray(exercise?.sets) ? exercise.sets : [];
  return sets.filter((set: any) => {
    if (!set || set.isWarmup || !set.completed) return false;
    const weight = toNumber(set.weight);
    const reps = getSetRepsInfo(set, !!exercise?.is_unilateral);
    return weight > 0 && reps.bestSide > 0;
  });
};

const makeSetRecord = (exercise: any, set: any, workout?: any) => {
  const weight = toNumber(set.weight);
  const reps = getSetRepsInfo(set, !!exercise?.is_unilateral);
  const estimated1RM = calculateEstimated1RM(weight, reps.bestSide);
  const setVolume = calculateSetVolume(set, !!exercise?.is_unilateral);

  return {
    exerciseName: cleanExerciseNameForAttachments(exercise),
    displayName: formatDisplayName(exercise),
    variant: getVariant(exercise),
    attachment: getExerciseAttachmentForStorage(exercise) || null,
    weight,
    reps: reps.bestSide,
    repsLabel: reps.label,
    estimated1RM,
    setVolume,
    workoutId: workout?.id,
    workoutDate: workout?.startedAt || workout?.finishedAt || workout?.id,
  };
};

const collectExerciseSetRecords = (workouts: any[] = []) => {
  const recordsByKey = new Map<string, any[]>();

  workouts.forEach((workout: any) => {
    const exercises = Array.isArray(workout?.fullWorkoutData)
      ? workout.fullWorkoutData
      : [];

    exercises.forEach((exercise: any) => {
      if (!exercise?.name) return;
      const key = getExerciseKey(exercise);
      const completedSets = getCompletedWorkingSets(exercise);

      completedSets.forEach((set: any) => {
        const record = makeSetRecord(exercise, set, workout);
        if (!recordsByKey.has(key)) recordsByKey.set(key, []);
        recordsByKey.get(key)?.push(record);
      });
    });
  });

  return recordsByKey;
};

const maxBy = (items: any[], selector: (item: any) => number): number => {
  if (!items.length) return 0;
  return items.reduce((max, item) => Math.max(max, selector(item)), 0);
};

const bestRecordBy = (items: any[], selector: (item: any) => number) => {
  return items.reduce((best: any, item: any) => {
    if (!best) return item;
    const currentValue = selector(item);
    const bestValue = selector(best);
    if (currentValue > bestValue) return item;
    if (currentValue === bestValue) {
      if (item.weight > best.weight) return item;
      if (item.weight === best.weight && item.reps > best.reps) return item;
    }
    return best;
  }, null);
};

const bestWeightForRep = (items: any[], reps: number): number => {
  const matching = items.filter((item) => item.reps === reps);
  if (!matching.length) return 0;
  return maxBy(matching, (item) => item.weight);
};

const prId = (exerciseName: string, type: WorkoutPRType, value: any) =>
  `${normalizeName(exerciseName)}-${type}-${String(value)}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;

const buildPR = ({
  record,
  type,
  label,
  value,
  previousValue,
  unit,
}: {
  record: any;
  type: WorkoutPRType;
  label: string;
  value: number;
  previousValue: number | null;
  unit: string;
}): WorkoutPRRecord | null => {
  if (!record || value <= 0) return null;
  return {
    id: prId(record.exerciseName, type, value),
    exerciseName: record.exerciseName,
    displayName: record.displayName,
    variant: record.variant,
    attachment: record.attachment || null,
    type,
    label,
    weight: record.weight,
    reps: record.reps,
    repsLabel: record.repsLabel,
    value: roundStat(value),
    previousValue: previousValue ? roundStat(previousValue) : null,
    estimated1RM: record.estimated1RM,
    setVolume: record.setVolume,
    unit,
  };
};

export const detectWorkoutPRs = (
  currentExercises: any[] = [],
  previousWorkouts: any[] = [],
  options: { isKg?: boolean } = {},
): WorkoutPRRecord[] => {
  const previousRecords = collectExerciseSetRecords(previousWorkouts);
  const unit = options.isKg === false ? "lbs" : "kg";
  const prs: WorkoutPRRecord[] = [];

  currentExercises.forEach((exercise: any) => {
    if (!exercise?.name) return;
    const key = getExerciseKey(exercise);
    const previous = previousRecords.get(key) || [];

    // Do not label the user's first logged session for an exercise as a PR.
    if (previous.length === 0) return;

    const currentRecords = getCompletedWorkingSets(exercise).map((set: any) =>
      makeSetRecord(exercise, set),
    );
    if (currentRecords.length === 0) return;

    const previousBestWeight = maxBy(previous, (item) => item.weight);
    const previousBestE1RM = maxBy(previous, (item) => item.estimated1RM);
    const previousBestVolumeSet = maxBy(previous, (item) => item.setVolume);

    const bestWeightRecord = bestRecordBy(
      currentRecords,
      (item) => item.weight,
    );
    const bestE1RMRecord = bestRecordBy(
      currentRecords,
      (item) => item.estimated1RM,
    );
    const bestVolumeSetRecord = bestRecordBy(
      currentRecords,
      (item) => item.setVolume,
    );

    const weightPR = buildPR({
      record: bestWeightRecord,
      type: "BEST_WEIGHT",
      label: "Best Weight",
      value: bestWeightRecord?.weight || 0,
      previousValue: previousBestWeight || null,
      unit,
    });
    if (weightPR && weightPR.value > previousBestWeight) prs.push(weightPR);

    const e1rmPR = buildPR({
      record: bestE1RMRecord,
      type: "BEST_E1RM",
      label: "Best Estimated 1RM",
      value: bestE1RMRecord?.estimated1RM || 0,
      previousValue: previousBestE1RM || null,
      unit,
    });
    if (e1rmPR && e1rmPR.value > previousBestE1RM) prs.push(e1rmPR);

    const volumeSetPR = buildPR({
      record: bestVolumeSetRecord,
      type: "BEST_VOLUME_SET",
      label: "Best Volume Set",
      value: bestVolumeSetRecord?.setVolume || 0,
      previousValue: previousBestVolumeSet || null,
      unit,
    });
    if (volumeSetPR && volumeSetPR.value > previousBestVolumeSet) {
      prs.push(volumeSetPR);
    }

    const repCandidatesByTarget = new Map<
      number,
      { record: any; previousRepBest: number }
    >();

    currentRecords
      .filter((record: any) => CANONICAL_REP_PR_TARGETS.includes(record.reps))
      .map((record: any) => {
        const previousRepBest = bestWeightForRep(previous, record.reps);
        return { record, previousRepBest };
      })
      .filter(
        ({
          record,
          previousRepBest,
        }: {
          record: any;
          previousRepBest: number;
        }) => record.weight > previousRepBest,
      )
      .forEach((candidate: { record: any; previousRepBest: number }) => {
        const existing = repCandidatesByTarget.get(candidate.record.reps);
        if (!existing) {
          repCandidatesByTarget.set(candidate.record.reps, candidate);
          return;
        }

        const candidateImprovement =
          candidate.record.weight - candidate.previousRepBest;
        const existingImprovement =
          existing.record.weight - existing.previousRepBest;

        if (candidateImprovement > existingImprovement) {
          repCandidatesByTarget.set(candidate.record.reps, candidate);
          return;
        }

        if (candidateImprovement === existingImprovement) {
          if (candidate.record.weight > existing.record.weight) {
            repCandidatesByTarget.set(candidate.record.reps, candidate);
          }
        }
      });

    Array.from(repCandidatesByTarget.values())
      .sort((a, b) => a.record.reps - b.record.reps)
      .forEach((candidate) => {
        const repPR = buildPR({
          record: candidate.record,
          type: "REP_MAX",
          label: `New ${candidate.record.reps}RM`,
          value: candidate.record.weight,
          previousValue: candidate.previousRepBest || null,
          unit,
        });
        if (repPR) prs.push(repPR);
      });
  });

  return prs.sort(comparePRDisplayPriority);
};

const prDisplayPriority: Record<WorkoutPRType, number> = {
  REP_MAX: 0,
  BEST_WEIGHT: 1,
  BEST_E1RM: 2,
  BEST_VOLUME_SET: 3,
};

const getPRExerciseGroupKey = (record: WorkoutPRRecord) =>
  `${normalizeName(record?.exerciseName)}::${record?.variant || "Normal"}::${
    record?.attachment || "None"
  }`;

const comparePRDisplayPriority = (a: WorkoutPRRecord, b: WorkoutPRRecord) => {
  const priorityDiff = prDisplayPriority[a.type] - prDisplayPriority[b.type];
  if (priorityDiff !== 0) return priorityDiff;

  if (a.type === "REP_MAX" && b.type === "REP_MAX") {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.reps - a.reps;
  }

  return b.value - a.value;
};

const getPRCategoryKey = (record: WorkoutPRRecord) => {
  const baseKey = getPRExerciseGroupKey(record);
  if (record.type === "REP_MAX") return `${baseKey}::REP_MAX::${record.reps}`;
  return `${baseKey}::${record.type}`;
};

export const getTopPRPerExercise = (
  prs: WorkoutPRRecord[] = [],
  limit?: number,
): WorkoutPRRecord[] => {
  const groupedByCategory = new Map<string, WorkoutPRRecord[]>();

  prs.forEach((record) => {
    if (!record?.exerciseName) return;
    const key = getPRCategoryKey(record);
    if (!groupedByCategory.has(key)) groupedByCategory.set(key, []);
    groupedByCategory.get(key)?.push(record);
  });

  const displayRecords = Array.from(groupedByCategory.values())
    .map((records) => [...records].sort(comparePRDisplayPriority)[0])
    .filter(Boolean)
    .sort((a, b) => {
      const exerciseDiff = getPRExerciseGroupKey(a).localeCompare(
        getPRExerciseGroupKey(b),
      );
      if (exerciseDiff !== 0) return exerciseDiff;
      return comparePRDisplayPriority(a, b);
    });

  return typeof limit === "number"
    ? displayRecords.slice(0, limit)
    : displayRecords;
};

export type WorkoutPRGroup = {
  key: string;
  exerciseName: string;
  displayName: string;
  records: WorkoutPRRecord[];
};

export const getGroupedWorkoutPRs = (
  prs: WorkoutPRRecord[] = [],
  limit?: number,
): WorkoutPRGroup[] => {
  const grouped = new Map<string, WorkoutPRRecord[]>();

  getTopPRPerExercise(prs).forEach((record) => {
    if (!record?.exerciseName) return;
    const key = getPRExerciseGroupKey(record);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)?.push(record);
  });

  const groups = Array.from(grouped.entries())
    .map(([key, records]) => {
      const sortedRecords = [...records].sort(comparePRDisplayPriority);
      const first = sortedRecords[0];
      return {
        key,
        exerciseName: first?.exerciseName || "Exercise",
        displayName: first?.displayName || first?.exerciseName || "Exercise",
        records: sortedRecords,
      };
    })
    .sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));

  return typeof limit === "number" ? groups.slice(0, limit) : groups;
};

export const formatPRSummaryLabel = (record: WorkoutPRRecord) =>
  record.label.replace(/^New /, "New ");

export const getUniquePRExerciseCount = (
  prs: WorkoutPRRecord[] = [],
): number => {
  const exerciseKeys = new Set<string>();
  prs.forEach((record) => {
    if (record?.exerciseName) exerciseKeys.add(getPRExerciseGroupKey(record));
  });
  return exerciseKeys.size;
};

export const getWorkoutPRDisplayCount = (prs: WorkoutPRRecord[] = []): number =>
  getTopPRPerExercise(prs).length;

export const formatPRValue = (record: WorkoutPRRecord) => {
  const unit = record.unit || "kg";
  if (record.type === "BEST_E1RM") {
    return `${record.value.toFixed(2)} ${unit}`;
  }
  if (record.type === "BEST_VOLUME_SET") {
    return `${Math.round(record.value)} ${unit} vol`;
  }
  return `${Number.isInteger(record.weight) ? record.weight.toFixed(0) : record.weight.toFixed(2)} ${unit} × ${record.repsLabel}`;
};

const getWorkoutSortTimestamp = (workout: any): number => {
  const raw =
    workout?.startedAt ||
    workout?.finishedAt ||
    workout?.id ||
    workout?.timestamp;
  const parsed =
    typeof raw === "number" ? raw : parseInt(String(raw || "0"), 10);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const buildHistoricalWorkoutPRMap = (
  workouts: any[] = [],
  options: { isKg?: boolean } = {},
): Record<string, WorkoutPRRecord[]> => {
  const sorted = [...workouts]
    .filter((workout) => workout && workout.id)
    .sort((a, b) => getWorkoutSortTimestamp(a) - getWorkoutSortTimestamp(b));

  const prMap: Record<string, WorkoutPRRecord[]> = {};
  const previousWorkouts: any[] = [];

  sorted.forEach((workout) => {
    const existingPrs = Array.isArray(workout?.prs) ? workout.prs : [];
    const computedPrs = detectWorkoutPRs(
      Array.isArray(workout?.fullWorkoutData) ? workout.fullWorkoutData : [],
      previousWorkouts,
      options,
    );

    // Prefer the current PR rules for historical display so older saved raw PR arrays
    // do not keep over-counting every set-level achievement. Fall back to saved PRs
    // only when this workout cannot be recomputed for some reason.
    const prs =
      computedPrs.length > 0 || existingPrs.length === 0
        ? computedPrs
        : existingPrs;
    prMap[String(workout.id)] = prs;
    previousWorkouts.push(workout);
  });

  return prMap;
};
