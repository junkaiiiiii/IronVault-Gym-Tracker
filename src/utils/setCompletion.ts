export const toSetInputValue = (value: any) =>
  value === undefined || value === null ? "" : String(value);

const isPositiveSetNumber = (value: any) => {
  const parsed = Number(toSetInputValue(value).trim());
  return Number.isFinite(parsed) && parsed > 0;
};

export const hasValidSetInputs = (exercise: any, set: any) => {
  if (!isPositiveSetNumber(set?.weight)) return false;

  if (exercise?.is_unilateral) {
    return (
      isPositiveSetNumber(set?.repsL) && isPositiveSetNumber(set?.repsR)
    );
  }

  return isPositiveSetNumber(set?.reps);
};

export const isValidCompletedSet = (
  exercise: any,
  set: any,
  options: { includeWarmup?: boolean } = {},
) =>
  !!set?.completed &&
  (options.includeWarmup !== false || !set?.isWarmup) &&
  hasValidSetInputs(exercise, set);
