export const RPE_MIN = 1;
export const RPE_MAX = 10;
export const RPE_HARD_SET_MIN = 9;

export type RpePerformanceSet = {
  weight: number;
  rpe: number;
};

export const chooseHeaviestRpeSet = (
  current: RpePerformanceSet | null,
  candidate: RpePerformanceSet | null,
): RpePerformanceSet | null => {
  if (!candidate) return current;
  if (!current) return candidate;
  if (candidate.weight > current.weight) return candidate;
  if (candidate.weight === current.weight && candidate.rpe > current.rpe) {
    return candidate;
  }
  return current;
};

const isHalfStep = (value: number) =>
  Math.abs(value * 2 - Math.round(value * 2)) < Number.EPSILON;

export const parseRpeValue = (value: any): number | null => {
  if (value === null || value === undefined || value === "") return null;

  const parsed = Number(String(value).trim());
  if (!Number.isFinite(parsed)) return null;
  if (parsed < RPE_MIN || parsed > RPE_MAX || !isHalfStep(parsed)) return null;
  return parsed;
};

export const formatRpeValue = (value: any): string => {
  const parsed = parseRpeValue(value);
  if (parsed === null) return "";
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(1);
};

// Allows a trailing decimal while typing, but never accepts an invalid final step.
export const sanitizeRpeInput = (nextValue: string, previousValue = ""): string => {
  const raw = String(nextValue || "").replace(",", ".").trim();
  if (!raw) return "";
  if (!/^\d{1,2}(?:\.\d?)?$/.test(raw)) return previousValue;

  const parsed = Number(raw.endsWith(".") ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(parsed) || parsed < RPE_MIN || parsed > RPE_MAX) {
    return previousValue;
  }

  if (raw.endsWith(".")) return raw;
  return isHalfStep(parsed) ? raw : previousValue;
};

export const workoutHasRecordedRpe = (workout: any): boolean =>
  (workout?.fullWorkoutData || []).some((exercise: any) =>
    (exercise?.sets || []).some(
      (set: any) => parseRpeValue(set?.rpe) !== null,
    ),
  );

export const workoutUsesRpeTracking = (workout: any): boolean =>
  workout?.rpeTrackingEnabled === true || workoutHasRecordedRpe(workout);
