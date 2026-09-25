export const LIMITS = {
  setWeightMax: 1500,
  setWeightDecimals: 2,
  repsMax: 99,
  warmupSetsPerExercise: 10,
  workingSetsPerExercise: 10,
  totalSetsPerExercise: 20,
  exercisesPerWorkout: 25,
  workoutDurationHours: 24,
  nameChars: 50,
  cueChars: 150,
  noteChars: 150,
  restSecondsMin: 15,
  restSecondsMax: 600,
  customExercisesPerUser: 100,
  gymsPerUser: 25,
  templatesPerUser: 50,
  foldersPerUser: 20,
} as const;

export const MAX_WORKOUT_DURATION_MS =
  LIMITS.workoutDurationHours * 60 * 60 * 1000;
export const MAX_WORKOUT_DURATION_SECONDS =
  LIMITS.workoutDurationHours * 60 * 60;

export const limitText = (value: any, maxLength: number) =>
  String(value ?? "").slice(0, maxLength);

export const cleanLimitedText = (value: any, maxLength: number) =>
  limitText(value, maxLength).trim();

export const clampNumber = (value: any, min: number, max: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
};

export const sanitizeDecimalInput = (
  value: string,
  max: number,
  decimals = 2,
  previousValue?: string,
): string => {
  const normalized = String(value ?? "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  const [integer = "", ...decimalParts] = normalized.split(".");
  const decimal = decimalParts.join("").slice(0, decimals);
  const hasDecimal = normalized.includes(".");
  const next = hasDecimal ? `${integer}.${decimal}` : integer;
  if (next === "" || next === ".") return next === "." ? "0." : "";

  const parsed = Number(next);
  if (!Number.isFinite(parsed)) return "";
  if (parsed > max) {
    return previousValue === undefined
      ? String(max)
      : sanitizeDecimalInput(previousValue, max, decimals);
  }
  return next;
};

export const sanitizeSetWeightInput = (value: string, previousValue?: string) =>
  sanitizeDecimalInput(
    value,
    LIMITS.setWeightMax,
    LIMITS.setWeightDecimals,
    previousValue,
  );

export const sanitizeWholeNumberInput = (value: string, max: number) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return "";
  return String(Math.min(max, parsed));
};

export const sanitizeRepsInput = (value: string) =>
  sanitizeWholeNumberInput(value, LIMITS.repsMax);

export const clampRestSeconds = (value: any) =>
  Math.round(clampNumber(value, LIMITS.restSecondsMin, LIMITS.restSecondsMax));

export const clampWorkoutDurationSeconds = (value: any) =>
  Math.round(clampNumber(value, 0, MAX_WORKOUT_DURATION_SECONDS));
