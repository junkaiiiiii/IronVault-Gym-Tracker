#!/usr/bin/env node

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");

const asyncStorageMemory = new Map();
const asyncStorageMock = {
  getItem: async (key) => asyncStorageMemory.get(key) ?? null,
  setItem: async (key, value) => {
    asyncStorageMemory.set(key, String(value));
  },
  removeItem: async (key) => {
    asyncStorageMemory.delete(key);
  },
  multiGet: async (keys) => keys.map((key) => [key, asyncStorageMemory.get(key) ?? null]),
  multiSet: async (pairs) => {
    pairs.forEach(([key, value]) => asyncStorageMemory.set(key, String(value)));
  },
  multiRemove: async (keys) => {
    keys.forEach((key) => asyncStorageMemory.delete(key));
  },
  getAllKeys: async () => Array.from(asyncStorageMemory.keys()),
};

const firebaseFirestoreMock = {
  doc: (...args) => ({ type: "doc", args }),
  collection: (...args) => ({ type: "collection", args }),
  query: (...args) => ({ type: "query", args }),
  orderBy: (...args) => ({ type: "orderBy", args }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  getDocs: async () => ({ docs: [], empty: true }),
  setDoc: async () => undefined,
  writeBatch: () => ({
    set: () => undefined,
    commit: async () => undefined,
  }),
};

const originalLoad = Module._load;
Module._load = function loadWithMocks(request, parent, isMain) {
  if (request === "@react-native-async-storage/async-storage") {
    return { __esModule: true, default: asyncStorageMock };
  }
  if (request === "expo-crypto") {
    return {
      CryptoDigestAlgorithm: { SHA256: "SHA-256" },
      digestStringAsync: async (_algorithm, value) =>
        crypto.createHash("sha256").update(String(value)).digest("hex"),
    };
  }
  if (request === "firebase/firestore") return firebaseFirestoreMock;
  if (request === "../config/firebaseConfig" || request.endsWith("/config/firebaseConfig")) {
    return { auth: { currentUser: null }, db: {} };
  }
  return originalLoad.call(this, request, parent, isMain);
};

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const fromRoot = (relativePath) => path.join(projectRoot, relativePath);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("limits sanitize and clamp user input", () => {
  const {
    LIMITS,
    MAX_WORKOUT_DURATION_SECONDS,
    clampRestSeconds,
    clampWorkoutDurationSeconds,
    cleanLimitedText,
    limitText,
    sanitizeRepsInput,
    sanitizeSetWeightInput,
  } = require(fromRoot("src/constants/limits.ts"));

  assert.equal(sanitizeSetWeightInput("12,345kg"), "12.34");
  assert.equal(sanitizeSetWeightInput("1500.999"), String(LIMITS.setWeightMax));
  assert.equal(sanitizeSetWeightInput("1501", "150"), "150");
  assert.equal(sanitizeSetWeightInput("1500.1", "1500."), "1500.");
  assert.equal(sanitizeSetWeightInput("."), "0.");
  assert.equal(sanitizeRepsInput("120 reps"), String(LIMITS.repsMax));
  assert.equal(sanitizeRepsInput("9a"), "9");
  assert.equal(clampRestSeconds(1), LIMITS.restSecondsMin);
  assert.equal(clampRestSeconds(999), LIMITS.restSecondsMax);
  assert.equal(clampWorkoutDurationSeconds(999999), MAX_WORKOUT_DURATION_SECONDS);
  assert.equal(limitText("abcdef", 3), "abc");
  assert.equal(cleanLimitedText("  hello  ", 20), "hello");
});

test("remote exercise data strips undeclared fields", () => {
  const { sanitizeRemoteExercises } = require(fromRoot("src/utils/helpers.ts"));
  const [exercise] = sanitizeRemoteExercises([
    {
      id: "remote-1",
      name: "Cable Curl",
      muscle: "Arms",
      equipment: "Cable",
      is_unilateral: false,
      is_custom: true,
      createdByUser: true,
      sets: [{ weight: 999, reps: 999 }],
      gymReplacements: { attacker: "Injected Exercise" },
    },
  ]);

  assert.equal(exercise.name, "Cable Curl");
  assert.equal(exercise.is_custom, undefined);
  assert.equal(exercise.createdByUser, undefined);
  assert.equal(exercise.sets, undefined);
  assert.equal(exercise.gymReplacements, undefined);
});

test("RPE input accepts half steps and preserves historical tracking", () => {
  const {
    chooseHeaviestRpeSet,
    formatRpeValue,
    parseRpeValue,
    sanitizeRpeInput,
    workoutUsesRpeTracking,
  } = require(fromRoot("src/utils/rpe.ts"));

  assert.equal(sanitizeRpeInput("7.5", "7"), "7.5");
  assert.equal(sanitizeRpeInput("7.3", "7."), "7.");
  assert.equal(sanitizeRpeInput("10.5", "10."), "10.");
  assert.equal(sanitizeRpeInput("11", "10"), "10");
  assert.equal(formatRpeValue("8.0"), "8");
  assert.equal(parseRpeValue("9.5"), 9.5);
  assert.equal(parseRpeValue(""), null);
  assert.equal(
    workoutUsesRpeTracking({
      fullWorkoutData: [{ sets: [{ completed: true, rpe: "8.5" }] }],
    }),
    true,
  );
  assert.equal(workoutUsesRpeTracking({ rpeTrackingEnabled: true }), true);
  assert.equal(workoutUsesRpeTracking({ fullWorkoutData: [] }), false);
  assert.deepEqual(
    chooseHeaviestRpeSet(
      { weight: 100, rpe: 9.5 },
      { weight: 110, rpe: 8 },
    ),
    { weight: 110, rpe: 8 },
  );
  assert.deepEqual(
    chooseHeaviestRpeSet(
      { weight: 110, rpe: 8 },
      { weight: 110, rpe: 9 },
    ),
    { weight: 110, rpe: 9 },
  );
});

test("RPE progress keeps exercise variants and attachments separate", () => {
  const {
    formatExercisePerformanceName,
    getExercisePerformanceKey,
  } = require(fromRoot("src/utils/performance.ts"));

  const normalBench = {
    name: "Barbell Bench Press",
    exerciseVariant: "Normal",
  };
  const pausedBench = {
    name: "Barbell Bench Press",
    exerciseVariant: "Paused",
  };
  const ropePushdown = {
    name: "Cable Pushdown",
    attachment: "Rope",
  };
  const straightBarPushdown = {
    name: "Cable Pushdown",
    attachment: "Straight Bar",
  };

  assert.notEqual(
    getExercisePerformanceKey(normalBench),
    getExercisePerformanceKey(pausedBench),
  );
  assert.notEqual(
    getExercisePerformanceKey(ropePushdown),
    getExercisePerformanceKey(straightBarPushdown),
  );
  assert.equal(
    formatExercisePerformanceName(pausedBench),
    "Barbell Bench Press · Paused",
  );
});

test("set placeholders keep position and select the best historical set", () => {
  const {
    buildBestHistoricalSetPositionHints,
  } = require(fromRoot("src/utils/setHistoryHints.ts"));

  const target = {
    name: "Barbell Bench Press",
    equipment: "Barbell",
    exerciseVariant: "Normal",
    is_unilateral: false,
  };
  const history = [
    {
      id: 1000,
      isKg: true,
      fullWorkoutData: [
        {
          ...target,
          sets: [
            { completed: true, isWarmup: true, weight: "60", reps: "5" },
            { completed: true, isWarmup: true, weight: "80", reps: "3" },
            { completed: true, weight: "100", reps: "5" },
            { completed: true, weight: "90", reps: "8" },
          ],
        },
      ],
    },
    {
      id: 2000,
      isKg: true,
      fullWorkoutData: [
        {
          ...target,
          sets: [
            { completed: true, isWarmup: true, weight: "65", reps: "5" },
            { completed: true, isWarmup: true, weight: "80", reps: "5" },
            { completed: true, weight: "100", reps: "7" },
            { completed: true, weight: "95", reps: "6" },
          ],
        },
        {
          ...target,
          exerciseVariant: "Paused",
          sets: [{ completed: true, weight: "200", reps: "10" }],
        },
      ],
    },
  ];

  const hints = buildBestHistoricalSetPositionHints(target, history, true);
  assert.deepEqual(hints.warmup, [
    { weight: "65", reps: "5", repsL: "0", repsR: "0" },
    { weight: "80", reps: "5", repsL: "0", repsR: "0" },
  ]);
  assert.deepEqual(hints.working, [
    { weight: "100", reps: "7", repsL: "0", repsR: "0" },
    { weight: "95", reps: "6", repsL: "0", repsR: "0" },
  ]);
});

test("set placeholders preserve empty positions, brands, and units", () => {
  const {
    buildBestHistoricalSetPositionHints,
  } = require(fromRoot("src/utils/setHistoryHints.ts"));

  const target = {
    name: "Leg Press",
    equipment: "Machine",
    equipmentTag: "Precor",
    is_unilateral: false,
  };
  const history = [
    {
      id: 1000,
      isKg: true,
      fullWorkoutData: [
        {
          ...target,
          sets: [
            { completed: false, weight: "200", reps: "1" },
            { completed: true, weight: "100", reps: "8" },
          ],
        },
        {
          ...target,
          equipmentTag: "Hammer Strength",
          sets: [{ completed: true, weight: "300", reps: "10" }],
        },
      ],
    },
  ];

  const hints = buildBestHistoricalSetPositionHints(target, history, false);
  assert.equal(hints.working[0], undefined);
  assert.deepEqual(hints.working[1], {
    weight: "220.46",
    reps: "8",
    repsL: "0",
    repsR: "0",
  });
});

test("historical weights become real values while reps stay empty", () => {
  const {
    buildBestHistoricalSetPositionHints,
    createHistoricalWeightPrefillState,
    reconcileHistoricalWeightPrefills,
  } = require(fromRoot("src/utils/setHistoryHints.ts"));

  const exercise = {
    name: "Barbell Back Squat",
    originalExerciseId: "squat",
    exerciseVariant: "Normal",
    sets: [
      { id: "warmup-1", isWarmup: true, weight: "", reps: "" },
      { id: "working-1", isWarmup: false, weight: "", reps: "" },
    ],
  };
  const history = [
    {
      id: 1000,
      isKg: true,
      fullWorkoutData: [
        {
          ...exercise,
          sets: [
            { completed: true, isWarmup: true, weight: "100", reps: "3" },
            { completed: true, isWarmup: false, weight: "150", reps: "2" },
          ],
        },
      ],
    },
  ];
  const hints = [
    buildBestHistoricalSetPositionHints(exercise, history, true),
  ];
  const result = reconcileHistoricalWeightPrefills(
    [exercise],
    hints,
    createHistoricalWeightPrefillState([exercise]),
  );

  assert.equal(result.exercises[0].sets[0].weight, "100");
  assert.equal(result.exercises[0].sets[0].reps, "");
  assert.equal(result.exercises[0].sets[1].weight, "150");
  assert.equal(result.exercises[0].sets[1].reps, "");
  assert.deepEqual(result.state["working-1"], {
    mode: "auto",
    value: "150",
  });
});

test("automatic weights refresh safely without replacing manual values", () => {
  const {
    createHistoricalWeightPrefillState,
    markHistoricalWeightPrefillManual,
    reconcileHistoricalWeightPrefills,
  } = require(fromRoot("src/utils/setHistoryHints.ts"));

  const exercise = {
    name: "Cable Pushdown",
    attachment: "Rope",
    sets: [
      { id: "set-1", weight: "", reps: "" },
      { id: "set-2", weight: "", reps: "" },
    ],
  };
  const firstHints = [
    {
      warmup: [],
      working: [
        { weight: "30", reps: "10", repsL: "0", repsR: "0" },
        { weight: "25", reps: "12", repsL: "0", repsR: "0" },
      ],
    },
  ];
  const initial = reconcileHistoricalWeightPrefills(
    [exercise],
    firstHints,
    createHistoricalWeightPrefillState([exercise]),
  );
  const manuallyCleared = [
    {
      ...initial.exercises[0],
      sets: [
        { ...initial.exercises[0].sets[0], weight: "" },
        initial.exercises[0].sets[1],
      ],
    },
  ];
  const stateAfterManualClear = markHistoricalWeightPrefillManual(
    initial.state,
    "set-1",
  );
  const changedHints = [
    {
      warmup: [],
      working: [
        { weight: "35", reps: "8", repsL: "0", repsR: "0" },
        { weight: "27.5", reps: "10", repsL: "0", repsR: "0" },
      ],
    },
  ];
  const refreshed = reconcileHistoricalWeightPrefills(
    manuallyCleared,
    changedHints,
    stateAfterManualClear,
  );

  assert.equal(refreshed.exercises[0].sets[0].weight, "");
  assert.equal(refreshed.state["set-1"].mode, "manual");
  assert.equal(refreshed.exercises[0].sets[1].weight, "27.5");
  assert.deepEqual(refreshed.state["set-2"], {
    mode: "auto",
    value: "27.5",
  });
});

test("position changes update only incomplete automatic weights", () => {
  const {
    createHistoricalWeightPrefillState,
    reconcileHistoricalWeightPrefills,
  } = require(fromRoot("src/utils/setHistoryHints.ts"));

  const exercise = {
    name: "Romanian Deadlift",
    sets: [
      { id: "set-1", weight: "", reps: "" },
      { id: "set-2", weight: "", reps: "" },
    ],
  };
  const hints = [
    {
      warmup: [],
      working: [
        { weight: "140", reps: "5", repsL: "0", repsR: "0" },
        { weight: "130", reps: "6", repsL: "0", repsR: "0" },
      ],
    },
  ];
  const initial = reconcileHistoricalWeightPrefills(
    [exercise],
    hints,
    createHistoricalWeightPrefillState([exercise]),
  );
  const afterRemoval = [
    {
      ...initial.exercises[0],
      sets: [initial.exercises[0].sets[1]],
    },
  ];
  const shifted = reconcileHistoricalWeightPrefills(
    afterRemoval,
    hints,
    initial.state,
  );
  assert.equal(shifted.exercises[0].sets[0].weight, "140");

  const completed = [
    {
      ...shifted.exercises[0],
      sets: [{ ...shifted.exercises[0].sets[0], completed: true }],
    },
  ];
  const completedResult = reconcileHistoricalWeightPrefills(
    completed,
    [
      {
        warmup: [],
        working: [
          { weight: "160", reps: "3", repsL: "0", repsR: "0" },
        ],
      },
    ],
    shifted.state,
  );
  assert.equal(completedResult.exercises[0].sets[0].weight, "140");
  assert.equal(completedResult.state["set-2"].mode, "manual");
});

test("resumed prefill metadata is validated and invalid history is skipped", () => {
  const {
    buildBestHistoricalSetPositionHints,
    reconcileHistoricalWeightPrefills,
    restoreHistoricalWeightPrefillState,
  } = require(fromRoot("src/utils/setHistoryHints.ts"));

  const exercise = {
    name: "Custom Press",
    originalExerciseId: "custom-a",
    sets: [
      { id: "auto", weight: "100", reps: "" },
      { id: "legacy", weight: "", reps: "" },
    ],
  };
  const restored = restoreHistoricalWeightPrefillState(
    { auto: { mode: "auto", value: "100" } },
    [exercise],
  );
  assert.deepEqual(restored.auto, { mode: "auto", value: "100" });
  assert.equal(restored.legacy.mode, "manual");

  const history = [
    {
      id: 2000,
      isKg: true,
      fullWorkoutData: [
        {
          ...exercise,
          sets: [
            { completed: true, weight: "1600", reps: "1" },
            { completed: true, weight: "120", reps: "5" },
          ],
        },
        {
          ...exercise,
          originalExerciseId: "custom-b",
          sets: [{ completed: true, weight: "500", reps: "10" }],
        },
      ],
    },
  ];
  const hints = buildBestHistoricalSetPositionHints(exercise, history, true);
  assert.equal(hints.working[0], undefined);
  assert.deepEqual(hints.working[1], {
    weight: "120",
    reps: "5",
    repsL: "0",
    repsR: "0",
  });

  const result = reconcileHistoricalWeightPrefills(
    [exercise],
    [hints],
    restored,
  );
  assert.equal(result.exercises[0].sets[0].weight, "");
  assert.equal(result.exercises[0].sets[1].weight, "");
});

test("legal versions accept only the current terms and privacy versions", () => {
  const { CURRENT_LEGAL_ACCEPTANCE } = require(fromRoot("src/constants/legal.ts"));
  const {
    isCurrentLegalAcceptance,
    normalizeLegalAcceptance,
  } = require(fromRoot("src/utils/legalVersions.ts"));

  assert.equal(isCurrentLegalAcceptance(CURRENT_LEGAL_ACCEPTANCE), true);
  assert.equal(
    isCurrentLegalAcceptance({
      termsVersion: "terms-old",
      privacyVersion: CURRENT_LEGAL_ACCEPTANCE.privacyVersion,
    }),
    false,
  );
  assert.deepEqual(
    normalizeLegalAcceptance({
      terms: CURRENT_LEGAL_ACCEPTANCE.termsVersion,
      privacy: CURRENT_LEGAL_ACCEPTANCE.privacyVersion,
      legalAcceptedAt: 123,
    }),
    {
      termsVersion: CURRENT_LEGAL_ACCEPTANCE.termsVersion,
      privacyVersion: CURRENT_LEGAL_ACCEPTANCE.privacyVersion,
      acceptedAt: 123,
    },
  );
});

test("firestore normalization strips unsupported undefined values", () => {
  const { __firebaseSyncTestables } = require(fromRoot("src/utils/firebaseSync.ts"));
  const normalized = __firebaseSyncTestables.normalizeForFirestore({
    keep: 1,
    drop: undefined,
    list: [undefined, 2, { nestedDrop: undefined, nestedKeep: "yes" }],
    object: { blank: undefined, nil: null },
  });

  assert.deepEqual(normalized, {
    keep: 1,
    list: [2, { nestedKeep: "yes" }],
    object: { nil: null },
  });
});

test("arm and shoulder cable exercises can explicitly select no attachment", () => {
  const {
    getExerciseAttachmentSelectionOptions,
  } = require(fromRoot("src/utils/customAttachments.ts"));
  const {
    NO_ATTACHMENT_OPTION_LABEL,
    getExerciseAttachmentForSave,
  } = require(fromRoot("src/utils/helpers.ts"));

  assert.equal(
    getExerciseAttachmentSelectionOptions({
      name: "Cable Pushdown",
      equipment: "Cable",
    })[0],
    NO_ATTACHMENT_OPTION_LABEL,
  );
  assert.equal(
    getExerciseAttachmentSelectionOptions({
      name: "Single Arm Cable Lateral Raise",
      equipment: "Cable",
    })[0],
    NO_ATTACHMENT_OPTION_LABEL,
  );
  assert.equal(
    getExerciseAttachmentForSave({
      name: "Cable Pushdown",
      equipment: "Cable",
      attachment: "",
    }),
    "",
  );
  assert.notEqual(
    getExerciseAttachmentSelectionOptions({
      name: "Lat Pulldown",
      equipment: "Cable",
    })[0],
    NO_ATTACHMENT_OPTION_LABEL,
  );
});

test("back cable attachment options stay specific to back movements", () => {
  const {
    formatExerciseDisplayName,
    getExerciseAttachmentForSave,
    getExerciseAttachmentOptions,
  } = require(fromRoot("src/utils/helpers.ts"));

  const latPulldownOptions = getExerciseAttachmentOptions({
    name: "Lat Pulldown",
    muscle: "Back",
    equipment: "Cable",
    attachmentOptions: [
      "Straight Bar",
      "V-Bar",
      "Rope",
      "EZ Bar",
      "D-Handle",
      "D-Handles",
      "Lat Pulldown Bar",
      "Ankle Strap",
      "Cuff",
    ],
  });

  assert.deepEqual(latPulldownOptions, [
    "Straight Bar",
    "V-Bar",
    "EZ Bar",
    "D-Handles",
    "MAG Grip",
    "Wide Grip Bar",
    "Neutral Grip Bar",
  ]);
  assert.equal(
    formatExerciseDisplayName({
      name: "Lat Pulldown",
      muscle: "Back",
      equipment: "Cable",
      attachment: "Lat Pulldown Bar",
    }),
    "Lat Pulldown",
  );
  assert.equal(
    getExerciseAttachmentForSave({
      name: "Lat Pulldown",
      muscle: "Back",
      equipment: "Cable",
    }),
    undefined,
  );

  const cableRowOptions = getExerciseAttachmentOptions({
    name: "Cable Row",
    muscle: "Back",
    equipment: "Cable",
  });
  assert.equal(cableRowOptions.includes("Ankle Strap"), false);
  assert.equal(cableRowOptions.includes("Cuff"), false);
  assert.equal(cableRowOptions.includes("D-Handle"), false);
  assert.equal(cableRowOptions.includes("Rope"), false);
  assert.equal(cableRowOptions.includes("D-Handles"), true);
});

test("vetted cable attachment defaults stay clean", () => {
  const {
    formatExerciseDisplayName,
    getExerciseAttachmentOptions,
  } = require(fromRoot("src/utils/helpers.ts"));

  assert.deepEqual(
    getExerciseAttachmentOptions({
      name: "Cable Chest Fly",
      muscle: "Chest",
      equipment: "Cable",
      attachmentOptions: ["D-Handles", "D-Handle", "Cuff"],
    }),
    ["D-Handles"],
  );
  assert.deepEqual(
    getExerciseAttachmentOptions({
      name: "Cable Front Raise",
      muscle: "Shoulders",
      equipment: "Cable",
    }),
    ["Straight Bar", "Rope", "D-Handles"],
  );
  assert.deepEqual(
    getExerciseAttachmentOptions({
      name: "Cable Pushdown (V-Bar)",
      muscle: "Arms",
      equipment: "Cable",
      attachmentOptions: [
        "Straight Bar",
        "EZ Bar",
        "V-Bar",
        "Rope",
        "D-Handle",
        "Cuff",
      ],
    }),
    ["Straight Bar", "EZ Bar", "Rope"],
  );
  assert.deepEqual(
    getExerciseAttachmentOptions({
      name: "Single Arm Pushdown",
      muscle: "Arms",
      equipment: "Cable",
    }),
    ["D-Handle", "Cuff", "Rope"],
  );
  assert.deepEqual(
    getExerciseAttachmentOptions({
      name: "Single Arm Overhead Cable Extension",
      muscle: "Arms",
      equipment: "Cable",
    }),
    ["D-Handle", "Cuff", "Rope"],
  );
  assert.deepEqual(
    getExerciseAttachmentOptions({
      name: "Crossbody Cable Tricep Extension",
      muscle: "Arms",
      equipment: "Cable",
    }),
    ["D-Handle", "Cuff", "Rope"],
  );
  assert.deepEqual(
    getExerciseAttachmentOptions({
      name: "Cable Kickback",
      muscle: "Arms",
      equipment: "Cable",
    }),
    ["D-Handle", "Ankle Strap", "Cuff", "Rope"],
  );
  assert.deepEqual(
    getExerciseAttachmentOptions({
      name: "Reverse Cable Curl",
      muscle: "Arms",
      equipment: "Cable",
    }),
    ["Straight Bar", "EZ Bar", "D-Handles"],
  );
  assert.deepEqual(
    getExerciseAttachmentOptions({
      name: "Cable Hammer Curl",
      muscle: "Arms",
      equipment: "Cable",
    }),
    ["Rope", "Cuff"],
  );
  assert.deepEqual(
    getExerciseAttachmentOptions({
      name: "Single Arm Cable Hammer Curl",
      muscle: "Arms",
      equipment: "Cable",
      attachmentOptions: ["Cuff", "Rope", "D-Handle"],
    }),
    ["Rope", "Cuff"],
  );
  assert.equal(
    formatExerciseDisplayName({
      name: "Rope Hammer Curl",
      muscle: "Arms",
      equipment: "Cable",
      attachment: "Rope",
    }),
    "Cable Hammer Curl · Rope",
  );
});

test("history exercise migration preserves factual old attachments", () => {
  const { __firebaseSyncTestables } = require(fromRoot("src/utils/firebaseSync.ts"));

  const workout = {
    id: "history-attachment-test",
    date: "2026-07-25",
    workoutName: "Arms",
    volume: 1000,
    fullWorkoutData: [
      { name: "Cable Pushdown (V-Bar)", muscle: "Arms", equipment: "Cable" },
      { name: "Rope Hammer Curl", muscle: "Arms", equipment: "Cable" },
      {
        name: "Single Arm Rope Hammer Curl",
        muscle: "Arms",
        equipment: "Cable",
      },
      {
        name: "Cable Chest Fly (Single Handles)",
        muscle: "Chest",
        equipment: "Cable",
      },
      { name: "Cable Pushdown", muscle: "Arms", equipment: "Cable" },
    ],
    prs: [
      {
        id: "pr-1",
        exerciseName: "Rope Hammer Curl",
        displayName: "Rope Hammer Curl",
        variant: "Normal",
        attachment: null,
      },
    ],
  };

  const [migrated] =
    __firebaseSyncTestables.normalizeWorkoutHistoryExerciseRecords([workout]);

  assert.deepEqual(
    migrated.fullWorkoutData.map((exercise) => ({
      name: exercise.name,
      attachment: exercise.attachment,
    })),
    [
      { name: "Cable Pushdown", attachment: "V-Bar" },
      { name: "Cable Hammer Curl", attachment: "Rope" },
      { name: "Single Arm Cable Hammer Curl", attachment: "Rope" },
      { name: "Cable Chest Fly", attachment: "D-Handles" },
      { name: "Cable Pushdown", attachment: undefined },
    ],
  );
  assert.equal(migrated.prs[0].exerciseName, "Cable Hammer Curl");
  assert.equal(migrated.prs[0].displayName, "Cable Hammer Curl · Rope");
  assert.equal(migrated.prs[0].attachment, "Rope");

  const sanitized =
    __firebaseSyncTestables.sanitizeWorkoutForStorage(workout);
  assert.equal(sanitized.fullWorkoutData[0].attachment, "V-Bar");
  assert.equal(sanitized.fullWorkoutData[4].attachment, undefined);
});

test("backup validation and merge helpers reject unsafe shapes and skip duplicates", () => {
  const { __firebaseSyncTestables } = require(fromRoot("src/utils/firebaseSync.ts"));
  const validData = { workouts: [], templates: [] };

  assert.equal(
    __firebaseSyncTestables.validateIronVaultBackupShape({
      app: "IronVault",
      type: "ironvault-backup",
      version: 1,
      data: validData,
    }),
    validData,
  );
  assert.throws(
    () =>
      __firebaseSyncTestables.validateIronVaultBackupShape({
        app: "Other",
        type: "ironvault-backup",
        data: {},
      }),
    /valid IronVault backup/,
  );
  assert.throws(
    () =>
      __firebaseSyncTestables.validateIronVaultBackupShape({
        app: "IronVault",
        type: "ironvault-backup",
        version: 2,
        data: {},
      }),
    /newer IronVault version/,
  );

  assert.deepEqual(
    __firebaseSyncTestables.mergeMissingWorkoutsOnly(
      [{ id: "w1" }],
      [{ id: "w1" }, { id: "w2" }, { noId: true }],
    ),
    { merged: [{ id: "w1" }, { id: "w2" }], added: 1 },
  );
  assert.deepEqual(
    __firebaseSyncTestables.mergeMissingObjectsOnly(
      [{ name: "Bench Press" }],
      [{ name: "bench press" }, { id: "custom_1", name: "Incline Press" }],
    ),
    {
      merged: [
        { name: "Bench Press" },
        { id: "custom_1", name: "Incline Press" },
      ],
      added: 1,
    },
  );
  assert.deepEqual(
    __firebaseSyncTestables.mergeMissingObjectsOnly(
      [{ id: "gym-a", name: "Anytime Fitness" }],
      [
        { id: "gym-b", name: "anytime   fitness" },
        { id: "gym-c", name: "Home Gym" },
      ],
    ),
    {
      merged: [
        { id: "gym-a", name: "Anytime Fitness" },
        { id: "gym-c", name: "Home Gym" },
      ],
      added: 1,
    },
  );
  assert.deepEqual(
    __firebaseSyncTestables.mergeMissingStringsOnly(["Squat"], ["Squat", "Deadlift"]),
    { merged: ["Squat", "Deadlift"], added: 1 },
  );
});

test("config sanitizers collapse duplicate gyms/templates from delayed sync", () => {
  const { __firebaseSyncTestables } = require(fromRoot("src/utils/firebaseSync.ts"));

  assert.deepEqual(
    __firebaseSyncTestables.sanitizeGymsForStorage([
      { id: "gym-local", name: "Anytime Fitness", variants: ["Prime"] },
      {
        id: "gym-cloud",
        name: "anytime   fitness",
        variants: ["Prime", "Rogue"],
      },
    ]),
    [
      {
        id: "gym-local",
        name: "Anytime Fitness",
        defaultMachineBrand: null,
        variants: ["Prime", "Rogue"],
      },
    ],
  );

  const reconciled =
    __firebaseSyncTestables.reconcileTemplatesAndFoldersForStorage(
      [
        {
          id: "tpl-old",
          name: "Upper A",
          exercises: [{ name: "Bench", sets: [{ isWarmup: false }] }],
          updatedAt: 1,
        },
        {
          id: "tpl-new",
          name: "upper   a",
          exercises: [
            { name: "Bench", sets: [{ isWarmup: false }] },
            { name: "Row", sets: [{ isWarmup: false }] },
          ],
          updatedAt: 2,
        },
      ],
      [
        {
          id: "folder-1",
          name: "Split",
          templateIds: ["tpl-old"],
          days: [{ dayNumber: 1, type: "template", templateId: "tpl-old" }],
        },
      ],
    );

  assert.equal(reconciled.templates.length, 1);
  assert.equal(reconciled.templates[0].id, "tpl-new");
  assert.deepEqual(reconciled.folders[0].templateIds, ["tpl-new"]);
  assert.equal(reconciled.folders[0].days[0].templateId, "tpl-new");
});

test("backup settings sanitizer keeps only safe supported settings", () => {
  const { __firebaseSyncTestables } = require(fromRoot("src/utils/firebaseSync.ts"));
  const sanitized = __firebaseSyncTestables.sanitizeBackupSettings({
    user_metric: "KILOGRAMS".repeat(40),
    rest_time: 90,
    rest_timer_enabled: true,
    rpe_tracking_enabled: "false",
    plates_kg: [20, 10, 5],
    unknown_key: "remove me",
    plates_lbs: Array.from({ length: 101 }, (_, index) => index),
  });

  assert.equal(sanitized.user_metric.length, 200);
  assert.equal(sanitized.rest_time, 90);
  assert.equal(sanitized.rest_timer_enabled, true);
  assert.equal(sanitized.rpe_tracking_enabled, false);
  assert.deepEqual(sanitized.plates_kg, [20, 10, 5]);
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized, "unknown_key"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(sanitized, "plates_lbs"), false);
});

test("deleted config markers dedupe ids and drop stale records", () => {
  const { __firebaseSyncTestables } = require(fromRoot("src/utils/firebaseSync.ts"));
  const now = Date.now();
  const old = now - 181 * 24 * 60 * 60 * 1000;

  assert.deepEqual(
    __firebaseSyncTestables.normalizeDeletedConfigRecords([
      { id: "folder-1", deletedAt: now - 2000 },
      { id: "folder-1", deletedAt: now - 1000 },
      { id: "folder-2", deletedAt: now },
      { id: "folder-old", deletedAt: old },
      { id: "", deletedAt: now },
      null,
    ]),
    [
      { id: "folder-2", deletedAt: now },
      { id: "folder-1", deletedAt: now - 1000 },
    ],
  );

  assert.deepEqual(
    __firebaseSyncTestables.normalizeDeletedConfigValueRecords([
      { value: "Prime", deletedAt: now - 2000 },
      { value: " prime ", deletedAt: now - 1000 },
      { value: "Hammer   Strength", deletedAt: now },
      { value: "old", deletedAt: old },
      { value: "", deletedAt: now },
      null,
    ]),
    [
      { value: "hammer strength", deletedAt: now },
      { value: "prime", deletedAt: now - 1000 },
    ],
  );

  assert.deepEqual(
    __firebaseSyncTestables.normalizeDeletedConfigNestedValueRecords([
      { parentId: "gym-1", value: "Prime", deletedAt: now - 2000 },
      { gymId: "gym-1", value: " prime ", deletedAt: now - 1000 },
      { parentId: "gym-2", name: "Hammer   Strength", deletedAt: now },
      { parentId: "gym-3", value: "old", deletedAt: old },
      { parentId: "", value: "Prime", deletedAt: now },
      null,
    ]),
    [
      { parentId: "gym-2", value: "hammer strength", deletedAt: now },
      { parentId: "gym-1", value: "prime", deletedAt: now - 1000 },
    ],
  );
});

test("template sharing creates local validated files and rejects tampering", async () => {
  const {
    buildTemplateImportPreview,
    createTemplateShareEnvelope,
    parseTemplateShareFile,
    serializeTemplateShareEnvelope,
  } = require(fromRoot("src/utils/templateSharing.ts"));

  const envelope = await createTemplateShareEnvelope(
    {
      name: "Upper A",
      exercises: [
        {
          name: "Barbell Bench Press",
          exerciseVariant: "Paused",
          muscle: "Chest",
          sets: [{ isWarmup: true }, { isWarmup: false }],
        },
        {
          name: "Custom Press",
          muscle: "Chest",
          sets: [{ isWarmup: false }],
        },
      ],
    },
    [
      {
        name: "Custom Press",
        muscle: "Chest",
        is_custom: true,
        reminder: "Keep elbows tucked",
      },
    ],
  );

  const payload = await parseTemplateShareFile(
    serializeTemplateShareEnvelope(envelope),
  );
  const preview = buildTemplateImportPreview(payload, []);

  assert.equal(payload.template.name, "Upper A");
  assert.deepEqual(payload.template.exercises[0].variationOptions, [
    "Normal",
    "Paused",
    "Tempo",
  ]);
  assert.equal(preview.exerciseCount, 2);
  assert.equal(preview.setCount, 3);
  assert.equal(preview.customExercisesToAdd.length, 1);
  assert.equal(preview.customExercisesToAdd[0].name, "Custom Press");

  const tampered = JSON.parse(serializeTemplateShareEnvelope(envelope));
  tampered.payload.template.name = "Edited Name";
  await assert.rejects(
    () => parseTemplateShareFile(JSON.stringify(tampered)),
    /changed|corrupted/,
  );
});

(async () => {
  let failures = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}`);
      console.error(error);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} smoke test${failures === 1 ? "" : "s"} failed.`);
    process.exit(1);
  }

  console.log(`\n${tests.length} smoke tests passed.`);
})();
