import { INITIAL_EXERCISES, MUSCLE_GROUPS } from "../constants/data";
import { z } from "zod";

export const genId = (prefix = "") =>
  prefix + Date.now().toString() + Math.random().toString(36).substring(2, 9);

export const calculate1RM = (w: string, r: string) => {
  const weight = parseFloat(w);
  const reps = parseInt(r);
  if (!weight || !reps || reps > 36) return 0;
  return Math.round(weight * (36 / (37 - reps)));
};

export const normalizeExerciseMuscleGroup = (value: any): string => {
  const raw = String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (!raw) return "Others";
  if (raw === "chest") return "Chest";
  if (raw === "back") return "Back";
  if (raw === "shoulders" || raw === "shoulder" || raw.includes("delt")) {
    return "Shoulders";
  }
  if (
    raw === "arms" ||
    raw.includes("bicep") ||
    raw.includes("tricep") ||
    raw.includes("forearm")
  ) {
    return "Arms";
  }
  if (
    raw === "legs" ||
    raw.includes("quad") ||
    raw.includes("hamstring") ||
    raw.includes("glute") ||
    raw.includes("calf") ||
    raw.includes("calves") ||
    raw.includes("adductor") ||
    raw.includes("abductor")
  ) {
    return "Legs";
  }
  if (
    raw === "others" ||
    raw === "other" ||
    raw.includes("abs") ||
    raw.includes("core") ||
    raw.includes("cardio") ||
    raw.includes("full body")
  ) {
    return "Others";
  }

  const titleCase = raw
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return MUSCLE_GROUPS.includes(titleCase) ? titleCase : "Others";
};

const normalizeSearchText = (value: any) =>
  String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const searchTokens = (value: any) =>
  normalizeSearchText(value).split(" ").filter(Boolean);

const tokenMatches = (candidateTokens: string[], term: string) =>
  candidateTokens.some(
    (token) => token === term || token.startsWith(term) || token.includes(term),
  );

export const DEFAULT_CABLE_ATTACHMENTS = [
  "Rope",
  "Straight Bar",
  "EZ Bar",
  "V-Bar",
  "D-Handle",
  "D-Handles",
  "Lat Pulldown Bar",
  "Wide Grip Bar",
  "Neutral Grip Bar",
  "MAG Grip",
  "Ankle Strap",
  "Cuff",
] as const;

export const NO_ATTACHMENT_OPTION_LABEL = "No Attachment";

const ATTACHMENT_ALIASES: Record<string, string> = {
  rope: "Rope",
  "rope attachment": "Rope",
  "straight bar": "Straight Bar",
  "straight bar attachment": "Straight Bar",
  "ez bar": "EZ Bar",
  "ez attachment": "EZ Bar",
  "ez bar attachment": "EZ Bar",
  "v bar": "V-Bar",
  "v-bar": "V-Bar",
  "d handle": "D-Handle",
  "d-handle": "D-Handle",
  "single d handle": "D-Handle",
  "single handle": "D-Handle",
  "single handles": "D-Handles",
  handle: "D-Handle",
  "d handles": "D-Handles",
  "d-handles": "D-Handles",
  "dual d handles": "D-Handles",
  "dual handles": "D-Handles",
  "double d handle": "Double D Handle",
  "double d handles": "Double D Handle",
  "lat pulldown bar": "Lat Pulldown Bar",
  "wide grip bar": "Wide Grip Bar",
  "neutral grip bar": "Neutral Grip Bar",
  "mag grip": "MAG Grip",
  "triangle row handle": "Triangle Row Handle",
  "triangle handle": "Triangle Row Handle",
  stirrup: "Stirrup Handle",
  "stirrup handle": "Stirrup Handle",
  "ankle strap": "Ankle Strap",
  cuff: "Cuff",
  "cuff attachment": "Cuff",
  "ab crunch strap": "Ab Crunch Strap",
  "crunch strap": "Ab Crunch Strap",
};

const ATTACHMENT_OPTIONS_BY_BASE_NAME: Record<string, string[]> = {
  "lat pulldown": [
    "Straight Bar",
    "V-Bar",
    "EZ Bar",
    "D-Handles",
    "MAG Grip",
    "Wide Grip Bar",
    "Neutral Grip Bar",
  ],
  "single arm lat pulldown": ["D-Handle"],
  "straight arm pulldown": ["Straight Bar", "EZ Bar"],
  "cable row": [
    "V-Bar",
    "Straight Bar",
    "EZ Bar",
    "D-Handles",
    "Triangle Row Handle",
    "Neutral Grip Bar",
    "MAG Grip",
    "Wide Grip Bar",
  ],
  "low cable row": [
    "V-Bar",
    "Straight Bar",
    "EZ Bar",
    "D-Handles",
    "Triangle Row Handle",
    "Neutral Grip Bar",
    "MAG Grip",
    "Wide Grip Bar",
  ],
  "high cable row": [
    "V-Bar",
    "Straight Bar",
    "EZ Bar",
    "D-Handles",
    "Triangle Row Handle",
    "Neutral Grip Bar",
    "MAG Grip",
    "Wide Grip Bar",
  ],
  "single arm cable row": ["D-Handle"],
  "cable chest fly": ["D-Handles"],
  "cable front raise": ["Straight Bar", "Rope", "D-Handles"],
  "single arm cable front raise": ["D-Handle", "Cuff"],
  "single arm cable lateral raise": ["D-Handle", "Cuff"],
  "cable rear delt fly": ["D-Handles", "D-Handle", "Cuff"],
  "upright row": ["Straight Bar", "Rope"],
  "face pull": ["Rope", "Straight Bar"],
  "cable pushdown": ["Straight Bar", "EZ Bar", "Rope"],
  "single arm pushdown": ["D-Handle", "Cuff", "Rope"],
  "cable hammer curl": ["Rope", "Cuff"],
  "single arm cable hammer curl": ["Rope", "Cuff"],
  "single arm cable reverse curl": ["Cuff", "D-Handle"],
  "overhead cable extension": ["Rope", "EZ Bar", "Straight Bar"],
  "single arm overhead cable extension": ["D-Handle", "Cuff", "Rope"],
  "cable kickback": ["D-Handle", "Ankle Strap", "Cuff", "Rope"],
  "bayesian cable curl": ["D-Handle", "Cuff"],
  "cable curl": ["Straight Bar", "EZ Bar", "Rope", "D-Handle"],
  "cable wrist curl": ["Straight Bar", "EZ Bar", "D-Handles"],
  "single arm cable wrist curl": ["D-Handle", "Cuff"],
  "reverse cable curl": ["Straight Bar", "EZ Bar", "D-Handles"],
  "cable pull through": ["Rope"],
  "cable crunch": ["Rope", "Straight Bar", "D-Handles", "Ab Crunch Strap"],
  "pallof press": ["D-Handle"],
  woodchopper: ["Rope", "D-Handle"],
  "crossbody cable tricep extension": ["D-Handle", "Cuff", "Rope"],
};

const normalizeAttachmentKey = (value: any) =>
  String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const EXERCISE_BASE_NAME_ALIASES: Record<string, string> = {
  "rope hammer curl": "Cable Hammer Curl",
  "single arm rope hammer curl": "Single Arm Cable Hammer Curl",
};

const applyExerciseBaseNameAlias = (name: any) => {
  const trimmed = String(name || "").trim();
  return EXERCISE_BASE_NAME_ALIASES[normalizeAttachmentKey(trimmed)] || trimmed;
};

const dedupeStrings = (values: any[] = []) => {
  const seen = new Set<string>();
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value) => {
      const key = normalizeAttachmentKey(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const normalizeExerciseAttachment = (value: any): string => {
  const key = normalizeAttachmentKey(value);
  if (!key) return "";
  if (key === "no attachment" || key === "none") return "";
  return ATTACHMENT_ALIASES[key] || String(value || "").trim();
};

const getCableLikeExerciseKey = (exercise: any = {}) =>
  normalizeSearchText(
    `${exercise?.name || ""} ${exercise?.equipment || ""} ${
      exercise?.equipmentType || ""
    }`,
  );

const isCableLikeExercise = (exercise: any = {}) => {
  const key = getCableLikeExerciseKey(exercise);
  return (
    key.includes("cable") ||
    key.includes("lat pulldown") ||
    key.includes("pulldown") ||
    key.includes("pallof") ||
    key.includes("woodchopper")
  );
};

const NO_ATTACHMENT_ARM_SHOULDER_BASE_NAMES = new Set(
  [
    "cable front raise",
    "single arm cable front raise",
    "single arm cable lateral raise",
    "cable lateral raise",
    "cable rear delt fly",
    "upright row",
    "face pull",
    "cable pushdown",
    "single arm pushdown",
    "cable hammer curl",
    "single arm cable hammer curl",
    "single arm cable reverse curl",
    "overhead cable extension",
    "bayesian cable curl",
    "cable curl",
    "cable wrist curl",
    "single arm cable wrist curl",
    "reverse cable curl",
    "crossbody cable tricep extension",
  ].map(normalizeAttachmentKey),
);

const isNamedArmOrShoulderCableExercise = (exercise: any = {}) => {
  const parsed = parseExerciseAttachmentFromName(exercise);
  const baseKey = normalizeAttachmentKey(parsed.baseName || exercise?.name);
  if (NO_ATTACHMENT_ARM_SHOULDER_BASE_NAMES.has(baseKey)) return true;

  const searchable = getCableLikeExerciseKey({
    ...exercise,
    name: parsed.baseName || exercise?.name,
  });
  if (!isCableLikeExercise({ ...exercise, name: parsed.baseName })) return false;

  return (
    searchable.includes("bicep") ||
    searchable.includes("tricep") ||
    searchable.includes("curl") ||
    searchable.includes("pushdown") ||
    searchable.includes("wrist") ||
    searchable.includes("forearm") ||
    searchable.includes("lateral raise") ||
    searchable.includes("front raise") ||
    searchable.includes("rear delt") ||
    searchable.includes("face pull") ||
    searchable.includes("upright row")
  );
};

export const shouldAllowNoAttachmentOption = (exercise: any = {}) => {
  const muscle = normalizeExerciseMuscleGroup(exercise?.muscle);
  if ((muscle === "Arms" || muscle === "Shoulders") && isCableLikeExercise(exercise)) {
    return true;
  }

  if (muscle !== "Others") return false;

  return isNamedArmOrShoulderCableExercise(exercise);
};

export const hasExplicitNoAttachment = (exercise: any = {}) => {
  if (!shouldAllowNoAttachmentOption(exercise)) return false;

  const value = exercise?.attachment;
  if (value === "" || value === null) return true;

  const key = normalizeAttachmentKey(value);
  return key === "no attachment" || key === "none";
};

const isClearlyAttachmentSuffix = (suffix: string) => {
  const key = normalizeAttachmentKey(suffix);
  return (
    key.includes("attachment") ||
    key.includes("handle") ||
    key.includes("rope") ||
    key.includes("strap") ||
    key.includes("cuff") ||
    key.includes("mag") ||
    key === "v bar"
  );
};

export const parseExerciseAttachmentFromName = (exercise: any = {}) => {
  const rawName = String(exercise?.name || exercise || "").trim();
  const match = rawName.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!match) {
    return { baseName: applyExerciseBaseNameAlias(rawName), attachment: "" };
  }

  const suffix = match[2].trim();
  const attachment = normalizeExerciseAttachment(suffix);
  if (!attachment) {
    return { baseName: applyExerciseBaseNameAlias(rawName), attachment: "" };
  }

  const isKnownAttachment =
    DEFAULT_CABLE_ATTACHMENTS.includes(attachment as any) ||
    Object.values(ATTACHMENT_ALIASES).includes(attachment);

  if (
    !isKnownAttachment ||
    (!isCableLikeExercise(exercise) && !isClearlyAttachmentSuffix(suffix))
  ) {
    return { baseName: applyExerciseBaseNameAlias(rawName), attachment: "" };
  }

  return {
    baseName: applyExerciseBaseNameAlias(match[1].trim() || rawName),
    attachment,
  };
};

export const cleanExerciseNameForAttachments = (exercise: any = {}) =>
  parseExerciseAttachmentFromName(exercise).baseName || "Exercise";

const cleanAttachmentOptions = (values: any[] = []) =>
  dedupeStrings(values.map(normalizeExerciseAttachment)).slice(0, 16);

const BLOCKED_BACK_ATTACHMENT_OPTIONS_BY_BASE_NAME: Record<string, string[]> = {
  "lat pulldown": [
    "Ankle Strap",
    "Cuff",
    "D-Handle",
    "Lat Pulldown Bar",
    "Rope",
  ],
  "cable row": ["Ankle Strap", "Cuff", "D-Handle", "Rope"],
  "low cable row": ["Ankle Strap", "Cuff", "D-Handle", "Rope"],
  "high cable row": ["Ankle Strap", "Cuff", "D-Handle", "Rope"],
  "straight arm pulldown": ["Ankle Strap", "Cuff", "D-Handle", "D-Handles", "Rope"],
  "single arm lat pulldown": ["Ankle Strap", "Cuff", "D-Handles", "Rope"],
  "single arm cable row": ["Ankle Strap", "Cuff", "D-Handles", "Rope"],
};

const BLOCKED_ATTACHMENT_OPTIONS_BY_BASE_NAME: Record<string, string[]> = {
  "cable chest fly": ["D-Handle", "Cuff"],
  "cable pushdown": [
    "V-Bar",
    "D-Handle",
    "D-Handles",
    "Lat Pulldown Bar",
    "Wide Grip Bar",
    "Neutral Grip Bar",
    "MAG Grip",
    "Ankle Strap",
    "Cuff",
  ],
  "single arm cable hammer curl": ["D-Handle"],
};

const isImplicitBaseAttachment = (exercise: any = {}, attachment: any) => {
  const parsed = parseExerciseAttachmentFromName(exercise);
  const baseKey = normalizeAttachmentKey(parsed.baseName || exercise?.name);
  return (
    baseKey === "lat pulldown" &&
    normalizeAttachmentKey(attachment) === "lat pulldown bar"
  );
};

const shouldSkipAutoDefaultAttachment = (exercise: any = {}) => {
  const parsed = parseExerciseAttachmentFromName(exercise);
  const baseKey = normalizeAttachmentKey(parsed.baseName || exercise?.name);
  return baseKey === "lat pulldown";
};

const filterAttachmentOptionsForExercise = (
  exercise: any = {},
  options: string[] = [],
) => {
  const parsed = parseExerciseAttachmentFromName(exercise);
  const baseKey = normalizeAttachmentKey(parsed.baseName || exercise?.name);
  const blocked = [
    ...(BLOCKED_BACK_ATTACHMENT_OPTIONS_BY_BASE_NAME[baseKey] || []),
    ...(BLOCKED_ATTACHMENT_OPTIONS_BY_BASE_NAME[baseKey] || []),
  ];
  if (blocked.length === 0) return options;

  const blockedKeys = new Set(blocked.map(normalizeAttachmentKey));
  return options.filter(
    (attachment) => !blockedKeys.has(normalizeAttachmentKey(attachment)),
  );
};

export const getExerciseAttachmentOptions = (exercise: any = {}): string[] => {
  if (exercise?.supportsAttachments === false) return [];

  const parsed = parseExerciseAttachmentFromName(exercise);
  const explicit = Array.isArray(exercise?.attachmentOptions)
    ? exercise.attachmentOptions
    : Array.isArray(exercise?.attachments)
      ? exercise.attachments
      : Array.isArray(exercise?.cableAttachments)
        ? exercise.cableAttachments
        : [];
  const baseKey = normalizeAttachmentKey(parsed.baseName || exercise?.name);
  const defaults = ATTACHMENT_OPTIONS_BY_BASE_NAME[baseKey] || [];
  const shouldUseBroadCableDefaults =
    explicit.length === 0 &&
    defaults.length === 0 &&
    isCableLikeExercise({
      ...exercise,
      name: parsed.baseName,
    });
  const cableDefaults = shouldUseBroadCableDefaults ? DEFAULT_CABLE_ATTACHMENTS : [];
  const options = filterAttachmentOptionsForExercise(exercise, cleanAttachmentOptions([
    ...defaults,
    ...explicit,
    ...cableDefaults,
    parsed.attachment,
    exercise?.attachment,
  ]));

  if (options.length > 0) return options;

  return [];
};

export const getExerciseAttachmentForStorage = (exercise: any = {}) => {
  if (hasExplicitNoAttachment(exercise)) return "";

  const selected = normalizeExerciseAttachment(exercise?.attachment);
  if (selected && !isImplicitBaseAttachment(exercise, selected)) return selected;

  const parsed = parseExerciseAttachmentFromName(exercise);
  if (
    parsed.attachment &&
    !isImplicitBaseAttachment(
      { ...exercise, name: parsed.baseName },
      parsed.attachment,
    )
  ) {
    return parsed.attachment;
  }

  return "";
};

export const getDefaultExerciseAttachment = (exercise: any = {}) => {
  if (hasExplicitNoAttachment(exercise)) return "";

  const selected = getExerciseAttachmentForStorage(exercise);
  if (selected) return selected;
  if (shouldSkipAutoDefaultAttachment(exercise)) return "";
  return getExerciseAttachmentOptions(exercise)[0] || "";
};

export const getExerciseAttachmentForSave = (exercise: any = {}) => {
  const attachment = getDefaultExerciseAttachment(exercise);
  return (attachment || hasExplicitNoAttachment(exercise))
    ? attachment
    : undefined;
};

export const normalizeExerciseForAttachmentLibrary = (exercise: any = {}) => {
  const parsed = parseExerciseAttachmentFromName(exercise);
  const name = parsed.baseName || exercise?.name || "Exercise";
  const attachmentOptions = getExerciseAttachmentOptions({
    ...exercise,
    name,
    attachment: parsed.attachment || exercise?.attachment,
  });

  return {
    ...exercise,
    name,
    attachment: undefined,
    attachmentOptions:
      attachmentOptions.length > 0 ? attachmentOptions : undefined,
    supportsAttachments:
      attachmentOptions.length > 0
        ? true
        : exercise?.supportsAttachments === true
          ? true
          : undefined,
  };
};

export const normalizeExerciseForAttachmentStorage = (exercise: any = {}) => {
  const parsed = parseExerciseAttachmentFromName(exercise);
  const name = parsed.baseName || exercise?.name || "Exercise";
  const exerciseWithName = { ...exercise, name };
  const explicitNoAttachment = hasExplicitNoAttachment(exerciseWithName);
  const attachmentOptions = getExerciseAttachmentOptions({
    ...exercise,
    name,
    attachment: exercise?.attachment || parsed.attachment,
  });
  const attachment = getDefaultExerciseAttachment({
    ...exercise,
    name,
    attachment: exercise?.attachment || parsed.attachment,
    attachmentOptions,
  });

  return {
    ...exercise,
    name,
    attachment: explicitNoAttachment ? "" : attachment || undefined,
    attachmentOptions:
      attachmentOptions.length > 0 ? attachmentOptions : undefined,
    supportsAttachments:
      attachmentOptions.length > 0
        ? true
        : exercise?.supportsAttachments === true
          ? true
          : undefined,
  };
};

const mergeAttachmentExerciseDuplicates = (exercises: any[] = []) => {
  const byKey = new Map<string, any>();
  const order: string[] = [];

  exercises.forEach((exercise) => {
    if (!exercise?.name) return;
    const normalized = normalizeExerciseForAttachmentLibrary(exercise);
    const key = [
      normalizeSearchText(normalized.name),
      normalizeSearchText(normalized.muscle),
      normalizeSearchText(normalized.equipment || normalized.equipmentType),
    ].join("::");

    if (!byKey.has(key)) {
      byKey.set(key, normalized);
      order.push(key);
      return;
    }

    const existing = byKey.get(key);
    const attachmentOptions = cleanAttachmentOptions([
      ...(existing?.attachmentOptions || []),
      ...(normalized?.attachmentOptions || []),
    ]);
    byKey.set(key, {
      ...existing,
      ...normalized,
      id: existing?.id || normalized?.id,
      image: existing?.image || normalized?.image,
      reminder: existing?.reminder || normalized?.reminder,
      attachmentOptions:
        attachmentOptions.length > 0 ? attachmentOptions : undefined,
      supportsAttachments:
        attachmentOptions.length > 0
          ? true
          : existing?.supportsAttachments || normalized?.supportsAttachments,
      is_unilateral: !!(existing?.is_unilateral || normalized?.is_unilateral),
      machineBrandApplicable: !!(
        existing?.machineBrandApplicable || normalized?.machineBrandApplicable
      ),
      brandApplicable: !!(
        existing?.brandApplicable || normalized?.brandApplicable
      ),
    });
  });

  return order.map((key) => byKey.get(key)).filter(Boolean);
};

export const rankExerciseSearchMatch = (exercise: any, query: string) => {
  const normalizedQuery = normalizeSearchText(query);
  if (!exercise || !normalizedQuery) return 0;

  const terms = searchTokens(normalizedQuery);
  if (terms.length === 0) return 0;

  const name = normalizeSearchText(exercise?.name);
  const equipment = normalizeSearchText(
    `${exercise?.equipment || ""} ${exercise?.equipmentType || ""} ${
      Array.isArray(exercise?.attachmentOptions)
        ? exercise.attachmentOptions.join(" ")
        : ""
    } ${exercise?.attachment || ""}`,
  );
  const muscle = normalizeSearchText(exercise?.muscle);
  const normalizedMuscle = normalizeSearchText(
    normalizeExerciseMuscleGroup(exercise?.muscle),
  );

  const nameTokens = searchTokens(name);
  const equipmentTokens = searchTokens(equipment);
  const muscleTokens = searchTokens(`${muscle} ${normalizedMuscle}`);
  const nameAndEquipmentTokens = [...nameTokens, ...equipmentTokens];
  const allTokens = [...nameAndEquipmentTokens, ...muscleTokens];

  if (name === normalizedQuery) return 1000;
  if (name.includes(normalizedQuery)) return 900;

  // Multi-word searches should primarily match exercise names/equipment.
  // This prevents searches like "leg extension" from matching "Hip Extension"
  // just because its muscle group is Legs. Muscle/category matching is still
  // useful for single-word broad searches and the dedicated muscle filters.
  if (terms.every((term) => tokenMatches(nameTokens, term))) return 800;
  if (terms.every((term) => tokenMatches(nameAndEquipmentTokens, term)))
    return 650;

  if (
    terms.length === 1 &&
    terms.every((term) => tokenMatches(allTokens, term))
  ) {
    return tokenMatches(nameTokens, terms[0]) ? 500 : 250;
  }

  return 0;
};

export const filterAndRankExercisesBySearch = (
  exercises: any[] = [],
  query: string,
) => {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return exercises;

  return exercises
    .map((exercise, index) => ({
      exercise,
      index,
      score: rankExerciseSearchMatch(exercise, normalizedQuery),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(a.exercise?.name || "").localeCompare(
        String(b.exercise?.name || ""),
      );
    })
    .map((item) => item.exercise);
};

export const getActiveBuiltInExercises = (globalExercises: any[] = []) => {
  const latestRemoteExercises = Array.isArray(globalExercises)
    ? globalExercises.filter(
        (exercise) => exercise && String(exercise?.name || "").trim(),
      )
    : [];

  // When the GitHub JSON has loaded, it is the source of truth. Do not merge it
  // with INITIAL_EXERCISES, because INITIAL_EXERCISES may still contain old
  // built-ins that were intentionally deleted from my-exercises.json.
  return mergeAttachmentExerciseDuplicates(
    latestRemoteExercises.length > 0
      ? latestRemoteExercises
      : INITIAL_EXERCISES,
  );
};

export const prepareSections = (data: any[], filter: string) => {
  if (!data || !Array.isArray(data)) return [];

  const normalizedFilter =
    filter === "All" ? "All" : normalizeExerciseMuscleGroup(filter);
  const filtered =
    normalizedFilter === "All"
      ? data
      : data.filter(
          (ex) =>
            ex && normalizeExerciseMuscleGroup(ex.muscle) === normalizedFilter,
        );

  return MUSCLE_GROUPS.reduce((acc: any, muscle) => {
    const exercises = filtered.filter(
      (ex) => ex && normalizeExerciseMuscleGroup(ex.muscle) === muscle,
    );
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      `https://raw.githubusercontent.com/junkaiiiiii/ironvault-exercises/main/my-exercises.json?ts=${Date.now()}`,
      {
        signal: controller.signal,
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      },
    );
    if (!response.ok) return [];

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > 2 * 1024 * 1024) return [];

    const raw = await response.text();
    if (raw.length > 2 * 1024 * 1024) return [];

    const data = JSON.parse(raw);
    return sanitizeRemoteExercises(data);
  } catch (error) {
    console.error("Error fetching from GitHub:", error);
    return [];
  } finally {
    clearTimeout(timeout);
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

export const normalizeExerciseImageUrl = (url?: string | null): string => {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.trim();
  if (!trimmed) return "";

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

  try {
    const parsed = new URL(trimmed);
    const allowedHosts = new Set([
      "github.com",
      "raw.githubusercontent.com",
      "user-images.githubusercontent.com",
      "private-user-images.githubusercontent.com",
      "firebasestorage.googleapis.com",
    ]);

    if (parsed.protocol !== "https:" || !allowedHosts.has(parsed.hostname)) {
      return "";
    }

    return trimmed.length <= 500 ? trimmed : "";
  } catch {
    return "";
  }
};

const RemoteExerciseSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string().trim().min(1).max(120),
    muscle: z.string().max(80).optional(),
    equipment: z.string().max(100).optional(),
    equipmentType: z.string().max(100).optional(),
    image: z.string().max(500).optional().nullable(),
    reminder: z.string().max(500).optional(),
    instructions: z
      .union([z.string().max(3000), z.array(z.string().max(500)).max(20)])
      .optional(),
    variationOptions: z.array(z.string().max(40)).max(12).optional(),
    executionVariants: z.array(z.string().max(40)).max(12).optional(),
    exerciseVariants: z.array(z.string().max(40)).max(12).optional(),
    supportsVariants: z.boolean().optional(),
    attachment: z.string().max(60).optional(),
    attachmentOptions: z.array(z.string().max(60)).max(16).optional(),
    attachments: z.array(z.string().max(60)).max(16).optional(),
    cableAttachments: z.array(z.string().max(60)).max(16).optional(),
    supportsAttachments: z.boolean().optional(),
    is_unilateral: z.boolean().optional(),
    machineBrandApplicable: z.boolean().optional(),
    brandApplicable: z.boolean().optional(),
    brand: z.string().max(80).optional(),
    machineBrand: z.string().max(80).optional(),
  })
  .strip();

export const sanitizeRemoteExercises = (value: any) => {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 1000)
    .map((exercise) => RemoteExerciseSchema.safeParse(exercise))
    .filter((result) => result.success)
    .map((result: any) =>
      normalizeExerciseForAttachmentLibrary({
        ...result.data,
        id:
          result.data.id !== undefined
            ? String(result.data.id).slice(0, 100)
            : undefined,
        muscle: normalizeExerciseMuscleGroup(result.data.muscle),
        image: normalizeExerciseImageUrl(result.data.image),
      }),
    )
    .reduce((acc: any[], exercise: any) => {
      acc.push(exercise);
      return acc;
    }, []);
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

  if (exercise?.supportsVariants === false) return [];

  return [];
};

export const getExerciseSupportsVariantsForStorage = (exercise: any) => {
  if (getExerciseVariationOptions(exercise).length > 0) return true;
  if (exercise?.supportsVariants === false) return false;
  return undefined;
};

const stripTransientExerciseFields = (exercise: any = {}) => {
  const {
    sets,
    equipmentTag,
    templateBaseExercise,
    replacementForGymId,
    replacedOriginalName,
    __index,
    ...rest
  } = exercise || {};
  return rest;
};

export const createGymReplacementEntry = (exercise: any = {}) => {
  const attachmentExercise = normalizeExerciseForAttachmentStorage(exercise);
  const variationOptions = getExerciseVariationOptions(attachmentExercise);
  const attachmentOptions = getExerciseAttachmentOptions(attachmentExercise);
  return {
    id: attachmentExercise?.id || attachmentExercise?.originalExerciseId || null,
    exerciseId:
      attachmentExercise?.id || attachmentExercise?.originalExerciseId || null,
    name: attachmentExercise?.name || "Exercise",
    muscle: attachmentExercise?.muscle,
    equipment: attachmentExercise?.equipment,
    equipmentType: attachmentExercise?.equipmentType,
    machineBrandApplicable: attachmentExercise?.machineBrandApplicable,
    brandApplicable: attachmentExercise?.brandApplicable,
    image: attachmentExercise?.image,
    reminder: attachmentExercise?.reminder || "",
    exerciseVariant: variationOptions.length > 0 ? "Normal" : undefined,
    variationOptions,
    supportsVariants: getExerciseSupportsVariantsForStorage(attachmentExercise),
    attachment: getExerciseAttachmentForSave(attachmentExercise),
    attachmentOptions:
      attachmentOptions.length > 0 ? attachmentOptions : undefined,
    supportsAttachments: attachmentOptions.length > 0 ? true : undefined,
    is_unilateral: !!attachmentExercise?.is_unilateral,
    brand: attachmentExercise?.brand,
    machineBrand: attachmentExercise?.machineBrand,
  };
};

export const normalizeGymReplacements = (value: any = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value).reduce((acc: any, [gymId, replacement]: any) => {
    const key = String(gymId || "").trim();
    if (!key || !replacement?.name) return acc;
    acc[key] = createGymReplacementEntry(replacement);
    return acc;
  }, {});
};

export const getGymReplacementForExercise = (
  exercise: any,
  gymId?: string | null,
) => {
  if (!exercise || !gymId) return null;
  const source = exercise.templateBaseExercise || exercise;
  const replacements = normalizeGymReplacements(source.gymReplacements);
  return replacements[String(gymId)] || null;
};

export const applyGymReplacementToExerciseSlot = (
  exercise: any,
  gymId?: string | null,
) => {
  const replacement = getGymReplacementForExercise(exercise, gymId);
  if (!replacement) return { ...exercise };

  const baseExercise = exercise.templateBaseExercise
    ? stripTransientExerciseFields(exercise.templateBaseExercise)
    : stripTransientExerciseFields(exercise);
  const attachmentReplacement =
    normalizeExerciseForAttachmentStorage(replacement);
  const variationOptions = getExerciseVariationOptions(attachmentReplacement);
  const attachmentOptions = getExerciseAttachmentOptions(attachmentReplacement);

  return {
    ...exercise,
    templateBaseExercise: {
      ...baseExercise,
      gymReplacements: normalizeGymReplacements(baseExercise.gymReplacements),
    },
    originalExerciseId:
      exercise.originalExerciseId ||
      baseExercise.id ||
      baseExercise.originalExerciseId,
    replacementForGymId: gymId,
    replacedOriginalName: baseExercise.name || exercise.name,
    name: attachmentReplacement.name || exercise.name,
    muscle: attachmentReplacement.muscle,
    equipment: attachmentReplacement.equipment,
    equipmentType: attachmentReplacement.equipmentType,
    machineBrandApplicable: attachmentReplacement.machineBrandApplicable,
    brandApplicable: attachmentReplacement.brandApplicable,
    image: attachmentReplacement.image,
    reminder: attachmentReplacement.reminder || exercise.reminder || "",
    exerciseVariant: variationOptions.length > 0 ? "Normal" : undefined,
    variationOptions,
    supportsVariants:
      getExerciseSupportsVariantsForStorage(attachmentReplacement),
    attachment: getExerciseAttachmentForSave(attachmentReplacement),
    attachmentOptions:
      attachmentOptions.length > 0 ? attachmentOptions : undefined,
    supportsAttachments: attachmentOptions.length > 0 ? true : undefined,
    is_unilateral: !!attachmentReplacement.is_unilateral,
    brand: attachmentReplacement.brand,
    machineBrand: attachmentReplacement.machineBrand,
    equipmentTag: undefined,
  };
};

export const applyGymReplacementsToExerciseSlots = (
  exercises: any[] = [],
  gymId?: string | null,
) =>
  exercises.map((exercise) =>
    applyGymReplacementToExerciseSlot(exercise, gymId),
  );

export const formatExerciseDisplayName = (exercise: any) => {
  const name = cleanExerciseNameForAttachments(exercise) || "Exercise";
  const variation = exercise?.exerciseVariant;
  const attachment = getExerciseAttachmentForStorage(exercise);
  const parts = [name];
  if (variation && variation !== "Normal") parts.push(variation);
  if (attachment) parts.push(attachment);
  return parts.join(" · ");
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

const BRAND_APPLICABLE_NAME_KEYWORDS = [
  "machine",
  "cable",
  "smith",
  "assisted",
  "plate loaded",
  "plate-loaded",
  "selectorized",
  "lever",
  "pec deck",
  "reverse pec deck",
  "lat pulldown",
  "pulldown",
  "pushdown",
  "leg press",
  "hack squat",
  "pendulum squat",
  "belt squat",
  "leg extension",
  "leg curl",
  "seated row",
  "high row",
  "low row",
  "t-bar row",
  "t bar row",
  "chest supported t-bar",
  "chest supported t bar",
  "preacher curl machine",
  "machine curl",
  "rope hammer curl",
  "single arm rope hammer curl",
  "lateral raise machine",
  "shoulder press machine",
  "chest press",
  "tricep extension machine",
  "calf raise machine",
  "hip thrust machine",
  "hip abduction",
  "hip adduction",
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

  const equipment = normalizeForEquipmentCheck(
    exercise.equipment || exercise.equipmentType || exercise.type,
  );
  const name = normalizeForEquipmentCheck(exercise.name);

  const equipmentSaysBrandApplies = BRAND_APPLICABLE_EQUIPMENT_KEYWORDS.some(
    (keyword) => equipment.includes(keyword),
  );
  const nameSaysBrandApplies = BRAND_APPLICABLE_NAME_KEYWORDS.some((keyword) =>
    name.includes(keyword),
  );

  // Equipment should be the source of truth for machine-brand relevance.
  // This prevents older cached exercises with machineBrandApplicable: false
  // from hiding brand selection for Cable / Machine / Smith movements.
  if (equipmentSaysBrandApplies || nameSaysBrandApplies) return true;

  if (typeof exercise.machineBrandApplicable === "boolean") {
    return exercise.machineBrandApplicable;
  }

  if (typeof exercise.brandApplicable === "boolean") {
    return exercise.brandApplicable;
  }

  if (
    equipment &&
    NON_BRAND_APPLICABLE_EQUIPMENT_KEYWORDS.some((keyword) =>
      equipment.includes(keyword),
    )
  ) {
    return false;
  }

  return false;
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
  const selectedIndexSet = new Set(unique);
  const anchorIndex = unique[0];

  const supersetMembers = unique.map((idx, order) => ({
    ...items[idx],
    supersetId,
    supersetOrder: order + 1,
  }));

  const remainingItems = items.filter((_, idx) => !selectedIndexSet.has(idx));
  const insertIndex = items
    .slice(0, anchorIndex)
    .filter((_, idx) => !selectedIndexSet.has(idx)).length;

  return cleanInvalidSupersets([
    ...remainingItems.slice(0, insertIndex),
    ...supersetMembers,
    ...remainingItems.slice(insertIndex),
  ]);
};

export const cleanInvalidSupersets = (items: any[] = []) => {
  const counts: Record<string, number> = {};

  items.forEach((item) => {
    const id = item?.supersetId;
    if (!id) return;
    counts[id] = (counts[id] || 0) + 1;
  });

  const orderByGroup: Record<string, number> = {};

  return items.map((item) => {
    const id = item?.supersetId;

    if (!id || counts[id] < 2) {
      if (!id) return item;
      return {
        ...item,
        supersetId: null,
        supersetOrder: undefined,
      };
    }

    orderByGroup[id] = (orderByGroup[id] || 0) + 1;

    return {
      ...item,
      supersetOrder: orderByGroup[id],
    };
  });
};

export const removeSupersetFromExercise = (
  items: any[] = [],
  index: number,
) => {
  const targetId = items[index]?.supersetId;
  if (!targetId) return cleanInvalidSupersets(items);
  return cleanInvalidSupersets(
    items.map((item) =>
      item?.supersetId === targetId
        ? { ...item, supersetId: null, supersetOrder: undefined }
        : item,
    ),
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
  cleanInvalidSupersets(
    blocks.flatMap((block) => {
      if (block?.blockType === "superset") {
        return (block.members || []).map((member: any, index: number) => ({
          ...member,
          supersetId: block.id,
          supersetOrder: index + 1,
        }));
      }
      return block?.members || [];
    }),
  );
