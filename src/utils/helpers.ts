import { MUSCLE_GROUPS } from "../constants/data";

export const genId = (prefix = "") =>
  prefix + Date.now().toString() + Math.random().toString(36).substring(2, 9);

export const calculate1RM = (w: string, r: string) => {
  const weight = parseFloat(w);
  const reps = parseInt(r);
  if (!weight || !reps || reps > 36) return 0;
  return Math.round(weight * (36 / (37 - reps)));
};

export const prepareSections = (data: any[], filter: string) => {
  if (!data || !Array.isArray(data)) return [];
  const filtered =
    filter === "All" ? data : data.filter((ex) => ex && ex.muscle === filter);
  return MUSCLE_GROUPS.reduce((acc: any, muscle) => {
    const exercises = filtered.filter((ex) => ex && ex.muscle === muscle);
    if (exercises.length > 0) {
      acc.push({
        title: muscle,
        data: exercises.sort((a, b) => {
          const nameA = a?.name || "";
          const nameB = b?.name || "";
          return nameA.localeCompare(nameB);
        }),
      });
    }
    return acc;
  }, []);
};

export const fetchGitHubExercises = async () => {
  try {
    // UPDATED URL to your custom GitHub repository
    const response = await fetch(
      "https://raw.githubusercontent.com/junkaiiiiii/ironvault-exercises/main/my-exercises.json",
    );
    const data = await response.json();

    // The data is already perfectly formatted from your JSON,
    // so we can just return it directly without the old mapping logic!
    return data;
  } catch (error) {
    console.error("Error fetching from GitHub:", error);
    return [];
  }
};

export const formatDuration = (startTimeMs: number, endTimeMs: number) => {
  const totalSeconds = Math.floor((endTimeMs - startTimeMs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${seconds}s`;
};

export const normalizeExerciseImageUrl = (url?: string | null) => {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.includes("github.com") && trimmed.includes("/blob/")) {
    return trimmed
      .replace("https://github.com/", "https://raw.githubusercontent.com/")
      .replace("/blob/", "/");
  }

  if (trimmed.includes("github.com") && trimmed.includes("?raw=true")) {
    return trimmed
      .replace("https://github.com/", "https://raw.githubusercontent.com/")
      .replace("/blob/", "/")
      .replace("?raw=true", "");
  }

  return trimmed;
};

export const POWERLIFTING_VARIATION_OPTIONS = [
  "Normal",
  "Paused",
  "Tempo",
] as const;

const normalizeExerciseNameForVariants = (value: any) =>
  String(value?.name || value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const DEFAULT_VARIANT_EXERCISE_NAMES = new Set([
  "bench press",
  "barbell bench press",
  "low bar squat",
  "back squat",
  "sumo deadlift",
  "conventional deadlift",
]);

export const isDefaultVariantExercise = (exercise: any) => {
  const normalized = normalizeExerciseNameForVariants(exercise);
  return DEFAULT_VARIANT_EXERCISE_NAMES.has(normalized);
};

export const getExerciseVariationOptions = (exercise: any): string[] => {
  if (exercise?.supportsVariants === false) return [];

  const explicit =
    exercise?.variationOptions ||
    exercise?.executionVariants ||
    exercise?.exerciseVariants;

  if (Array.isArray(explicit) && explicit.length > 0) {
    const cleaned = explicit
      .map((v: any) => String(v || "").trim())
      .filter(Boolean);
    return cleaned.includes("Normal") ? cleaned : ["Normal", ...cleaned];
  }

  if (
    exercise?.supportsVariants === true ||
    isDefaultVariantExercise(exercise)
  ) {
    return [...POWERLIFTING_VARIATION_OPTIONS];
  }

  return [];
};

export const formatExerciseDisplayName = (exercise: any) => {
  const name = exercise?.name || "Exercise";
  const variation = exercise?.exerciseVariant;
  if (!variation || variation === "Normal") return name;
  return `${name} · ${variation}`;
};

const BRAND_APPLICABLE_EQUIPMENT_KEYWORDS = [
  "machine",
  "cable",
  "smith",
  "selectorized",
  "plate loaded",
  "plate-loaded",
  "assisted",
  "lever",
];

const NON_BRAND_APPLICABLE_EQUIPMENT_KEYWORDS = [
  "barbell",
  "dumbbell",
  "bodyweight",
  "kettlebell",
  "ez bar",
  "ez-bar",
  "resistance band",
  "band",
  "landmine",
];

const normalizeForEquipmentCheck = (value: any) =>
  String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .trim();

export const isMachineBrandApplicable = (exercise: any): boolean => {
  if (!exercise) return false;

  if (typeof exercise.machineBrandApplicable === "boolean") {
    return exercise.machineBrandApplicable;
  }

  if (typeof exercise.brandApplicable === "boolean") {
    return exercise.brandApplicable;
  }

  const equipment = normalizeForEquipmentCheck(
    exercise.equipment || exercise.equipmentType || exercise.type,
  );
  const name = normalizeForEquipmentCheck(exercise.name);

  if (
    equipment &&
    NON_BRAND_APPLICABLE_EQUIPMENT_KEYWORDS.some((keyword) =>
      equipment.includes(keyword),
    ) &&
    !BRAND_APPLICABLE_EQUIPMENT_KEYWORDS.some((keyword) =>
      equipment.includes(keyword),
    )
  ) {
    return false;
  }

  return BRAND_APPLICABLE_EQUIPMENT_KEYWORDS.some(
    (keyword) => equipment.includes(keyword) || name.includes(keyword),
  );
};

export const getSupersetLabel = (index: number): string => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return alphabet[index] || `#${index + 1}`;
};

export const getSupersetGroups = (items: any[] = []) => {
  const groups: Record<string, any[]> = {};
  const order: string[] = [];

  items.forEach((item, index) => {
    const id = item?.supersetId;
    if (!id) return;
    if (!groups[id]) {
      groups[id] = [];
      order.push(id);
    }
    groups[id].push({ ...item, __index: index });
  });

  return order
    .map((id, groupIndex) => ({
      id,
      label: getSupersetLabel(groupIndex),
      exercises: groups[id].sort(
        (a, b) =>
          (Number(a.supersetOrder) || 0) - (Number(b.supersetOrder) || 0) ||
          (Number(a.__index) || 0) - (Number(b.__index) || 0),
      ),
    }))
    .filter((group) => group.exercises.length > 1);
};

export const getSupersetInfo = (
  items: any[] = [],
  supersetId?: string | null,
) => {
  if (!supersetId) return null;
  return (
    getSupersetGroups(items).find((group) => group.id === supersetId) || null
  );
};

export const isFirstInSuperset = (
  items: any[] = [],
  index: number,
): boolean => {
  const current = items[index];
  if (!current?.supersetId) return false;
  const members = items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item?.supersetId === current.supersetId)
    .sort(
      (a, b) =>
        (Number(a.item.supersetOrder) || 0) -
          (Number(b.item.supersetOrder) || 0) || a.idx - b.idx,
    );
  return members[0]?.idx === index;
};

export const isLastInSuperset = (items: any[] = [], index: number): boolean => {
  const current = items[index];
  if (!current?.supersetId) return true;
  const members = items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => item?.supersetId === current.supersetId)
    .sort(
      (a, b) =>
        (Number(a.item.supersetOrder) || 0) -
          (Number(b.item.supersetOrder) || 0) || a.idx - b.idx,
    );
  return members[members.length - 1]?.idx === index;
};

export const createSupersetId = () =>
  `ss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const assignSuperset = (items: any[] = [], indexes: number[]) => {
  const unique = Array.from(new Set(indexes)).filter(
    (idx) => idx >= 0 && idx < items.length,
  );
  if (unique.length < 2) return items;
  const supersetId = createSupersetId();
  return items.map((item, idx) => {
    const order = unique.indexOf(idx);
    if (order === -1) return item;
    return { ...item, supersetId, supersetOrder: order + 1 };
  });
};

export const removeSupersetFromExercise = (
  items: any[] = [],
  index: number,
) => {
  const targetId = items[index]?.supersetId;
  if (!targetId) return items;
  return items.map((item) =>
    item?.supersetId === targetId
      ? { ...item, supersetId: null, supersetOrder: undefined }
      : item,
  );
};

export const buildReorderBlocks = (items: any[] = []) => {
  const seen = new Set<string>();
  const blocks: any[] = [];

  items.forEach((item, index) => {
    if (item?.supersetId) {
      if (seen.has(item.supersetId)) return;
      seen.add(item.supersetId);
      const members = items
        .filter((candidate) => candidate?.supersetId === item.supersetId)
        .sort(
          (a, b) =>
            (Number(a.supersetOrder) || 0) - (Number(b.supersetOrder) || 0),
        );
      blocks.push({
        blockType: "superset",
        id: item.supersetId,
        members,
        originalIndex: index,
      });
      return;
    }

    blocks.push({
      blockType: "exercise",
      id: item.id || `${item.name}-${index}`,
      members: [item],
      originalIndex: index,
    });
  });

  return blocks;
};

export const flattenReorderBlocks = (blocks: any[] = []) =>
  blocks.flatMap((block) => {
    if (block?.blockType === "superset") {
      return (block.members || []).map((member: any, index: number) => ({
        ...member,
        supersetId: block.id,
        supersetOrder: index + 1,
      }));
    }
    return block?.members || [];
  });
