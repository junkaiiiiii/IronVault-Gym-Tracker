const fs = require("fs");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");

const PROJECT_ID = "ironvault-rules-test";
const TERMS_VERSION = "terms-2026-06-23";
const PRIVACY_VERSION = "privacy-2026-06-23";

const tests = [];
let testEnv;

const test = (name, fn) => tests.push({ name, fn });

const authedDb = (uid) => testEnv.authenticatedContext(uid).firestore();
const guestDb = () => testEnv.unauthenticatedContext().firestore();

const userDoc = (db, uid) => db.collection("users").doc(uid);
const workoutDoc = (db, uid, workoutId) =>
  userDoc(db, uid).collection("workouts").doc(workoutId);
const configDoc = (db, uid, configId) =>
  userDoc(db, uid).collection("configs").doc(configId);
const usernameDoc = (db, username) => db.collection("usernames").doc(username);

const legalAcceptance = (acceptedAt = 1782220000000) => ({
  legalAcceptance: {
    termsVersion: TERMS_VERSION,
    privacyVersion: PRIVACY_VERSION,
    acceptedAt,
  },
  legalAcceptedAt: acceptedAt,
  termsVersion: TERMS_VERSION,
  privacyVersion: PRIVACY_VERSION,
});

const workout = (overrides = {}) => ({
  id: "workout-1",
  date: "2026-06-23",
  workoutName: "Push Day",
  volume: 1200,
  isKg: true,
  fullWorkoutData: [{ exercise: "Bench Press", sets: [] }],
  ...overrides,
});

const listOf = (count, prefix) =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    name: `${prefix} ${index + 1}`,
  }));

test("auth is required for profile and username reads", async () => {
  const db = guestDb();
  await assertFails(userDoc(db, "alice").get());
  await assertFails(usernameDoc(db, "alice").get());
});

test("users can create and update their own legal/profile fields", async () => {
  const db = authedDb("alice");

  await assertSucceeds(userDoc(db, "alice").set(legalAcceptance()));
  await assertSucceeds(
    userDoc(db, "alice").set(
      {
        username: "alice_1",
        usernameLower: "alice_1",
        metric: "KG",
        restTime: 120,
        restTimerEnabled: true,
        timerEnabled: true,
        autoCheckEnabled: false,
        rpeTrackingEnabled: true,
        plateCalcEnabled: true,
        nextSessionNotesEnabled: true,
        customAttachments: ["Prime ROT8 Handle", "Long Strap"],
        updatedAt: 1782220000001,
      },
      { merge: true },
    ),
  );

  await assertFails(
    userDoc(db, "alice").set(
      {
        customAttachments: Array.from(
          { length: 21 },
          (_, index) => `Attachment ${index + 1}`,
        ),
      },
      { merge: true },
    ),
  );
  await assertFails(
    userDoc(db, "alice").set(
      { rpeTrackingEnabled: "yes" },
      { merge: true },
    ),
  );
});

test("users cannot write other users or unknown profile fields", async () => {
  const aliceDb = authedDb("alice");
  const bobDb = authedDb("bob");

  await assertFails(userDoc(bobDb, "alice").set({ username: "bob" }));
  await assertFails(userDoc(aliceDb, "alice").set({ isAdmin: true }));
});

test("username claims are owner-only and validated", async () => {
  const aliceDb = authedDb("alice");
  const bobDb = authedDb("bob");

  await assertSucceeds(
    usernameDoc(aliceDb, "alice_1").set({
      uid: "alice",
      username: "alice_1",
      usernameLower: "alice_1",
      display_name: "Alice",
      updatedAt: 1782220000000,
    }),
  );
  await assertFails(
    usernameDoc(bobDb, "alice_1").set({
      uid: "bob",
      username: "alice_1",
      usernameLower: "alice_1",
      updatedAt: 1782220000001,
    }),
  );
  await assertFails(
    usernameDoc(aliceDb, "BadName").set({
      uid: "alice",
      username: "BadName",
      usernameLower: "BadName",
      updatedAt: 1782220000002,
    }),
  );
});

test("workouts respect ownership, id matching, and exercise cap", async () => {
  const aliceDb = authedDb("alice");
  const bobDb = authedDb("bob");

  await assertSucceeds(
    workoutDoc(aliceDb, "alice", "workout-1").set(
      workout({
        rpeTrackingEnabled: true,
        fullWorkoutData: [
          { exercise: "Bench Press", sets: [{ completed: true, rpe: "8.5" }] },
        ],
      }),
    ),
  );
  await assertFails(workoutDoc(bobDb, "alice", "workout-2").set(workout({ id: "workout-2" })));
  await assertFails(
    workoutDoc(aliceDb, "alice", "workout-oversized").set(
      workout({
        id: "workout-oversized",
        fullWorkoutData: listOf(26, "exercise"),
      }),
    ),
  );
  await assertFails(
    workoutDoc(aliceDb, "alice", "workout-1").set(
      workout({
        id: "different-id",
        workoutName: "Mismatched",
      }),
      { merge: true },
    ),
  );
  await assertFails(
    workoutDoc(aliceDb, "alice", "workout-invalid-rpe-mode").set(
      workout({
        id: "workout-invalid-rpe-mode",
        rpeTrackingEnabled: "yes",
      }),
    ),
  );
});

test("configs enforce per-user ownership and configured caps", async () => {
  const aliceDb = authedDb("alice");
  const bobDb = authedDb("bob");

  await assertSucceeds(
    configDoc(aliceDb, "alice", "templates").set({
      data: listOf(50, "template"),
      updatedAt: 1782220000000,
      deletedIds: [{ id: "template-old", deletedAt: 1782220000000 }],
    }),
  );
  await assertSucceeds(
    configDoc(aliceDb, "alice", "gyms").set({
      data: listOf(2, "gym"),
      updatedAt: 1782220000001,
      deletedIds: [{ id: "gym-old", deletedAt: 1782220000001 }],
      deletedVariantValues: [
        { parentId: "gym-1", value: "old-brand", deletedAt: 1782220000001 },
      ],
    }),
  );
  await assertSucceeds(
    configDoc(aliceDb, "alice", "favorite_exercises").set({
      data: ["Bench Press"],
      updatedAt: 1782220000002,
      deletedValues: [{ value: "old favorite", deletedAt: 1782220000002 }],
    }),
  );
  await assertFails(
    configDoc(aliceDb, "alice", "templates").set({
      data: [],
      updatedAt: 1782220000003,
      deletedValues: [{ value: "not-valid-for-templates", deletedAt: 1782220000003 }],
    }),
  );
  await assertFails(
    configDoc(aliceDb, "alice", "templates").set({
      data: listOf(51, "template"),
      updatedAt: 1782220000004,
    }),
  );
  await assertFails(
    configDoc(aliceDb, "alice", "gyms").set({
      data: listOf(26, "gym"),
      updatedAt: 1782220000005,
    }),
  );
  await assertFails(
    configDoc(bobDb, "alice", "folders").set({
      data: [],
      updatedAt: 1782220000006,
    }),
  );
});

async function run() {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync("firestore.rules", "utf8"),
    },
  });

  let passed = 0;
  try {
    for (const { name, fn } of tests) {
      await testEnv.clearFirestore();
      await fn();
      passed += 1;
      console.log(`PASS ${name}`);
    }
    console.log(`\n${passed} Firestore rules tests passed.`);
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
