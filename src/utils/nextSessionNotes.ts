import AsyncStorage from "@react-native-async-storage/async-storage";
import { LIMITS, cleanLimitedText } from "../constants/limits";

type NoteMap = Record<string, string>;

const PREFIX = "@template_next_session_notes";
const ENABLED_PREFIX = "@next_session_notes_enabled";

const getTemplateNextSessionNotesKey = (uid: string, templateId: string) =>
  `${PREFIX}_${uid}_${templateId}`;

const getNextSessionNotesEnabledKey = (uid: string) =>
  `${ENABLED_PREFIX}_${uid}`;

const normalizeNoteMap = (value: any): NoteMap => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.entries(value).reduce<NoteMap>((acc, [key, note]) => {
    if (typeof note !== "string") return acc;
    const cleanKey = cleanLimitedText(key, 120);
    const cleanNote = cleanLimitedText(note, LIMITS.noteChars);
    if (cleanKey && cleanNote) acc[cleanKey] = cleanNote;
    return acc;
  }, {});
};

export const getTemplateExerciseNoteKey = (exercise: any): string => {
  return cleanLimitedText(
    exercise?.templateBaseExercise?.id ||
      exercise?.templateBaseExercise?.originalExerciseId ||
      exercise?.templateExerciseId ||
      exercise?.originalExerciseId ||
      exercise?.id ||
      exercise?.name ||
      "",
    120,
  );
};

export const readTemplateNextSessionNotes = async (
  uid: string | undefined | null,
  templateId: string | undefined | null,
): Promise<NoteMap> => {
  if (!uid || !templateId) return {};

  try {
    const raw = await AsyncStorage.getItem(
      getTemplateNextSessionNotesKey(uid, templateId),
    );
    if (!raw) return {};
    return normalizeNoteMap(JSON.parse(raw));
  } catch {
    return {};
  }
};

export const writeTemplateNextSessionNote = async (
  uid: string | undefined | null,
  templateId: string | undefined | null,
  exercise: any,
  note: string,
): Promise<NoteMap> => {
  if (!uid || !templateId) return {};

  const key = getTemplateExerciseNoteKey(exercise);
  if (!key) return readTemplateNextSessionNotes(uid, templateId);

  const storageKey = getTemplateNextSessionNotesKey(uid, templateId);
  const notes = await readTemplateNextSessionNotes(uid, templateId);
  const cleanNote = cleanLimitedText(note, LIMITS.noteChars);

  if (cleanNote) notes[key] = cleanNote;
  else delete notes[key];

  if (Object.keys(notes).length === 0) {
    await AsyncStorage.removeItem(storageKey);
    return {};
  }

  await AsyncStorage.setItem(storageKey, JSON.stringify(notes));
  return notes;
};

export const deleteTemplateNextSessionNotes = async (
  uid: string | undefined | null,
  templateId: string | undefined | null,
) => {
  if (!uid || !templateId) return;
  await AsyncStorage.removeItem(getTemplateNextSessionNotesKey(uid, templateId));
};

export const readNextSessionNotesEnabled = async (
  uid: string | undefined | null,
): Promise<boolean> => {
  if (!uid) return false;
  try {
    return (
      (await AsyncStorage.getItem(getNextSessionNotesEnabledKey(uid))) === "true"
    );
  } catch {
    return false;
  }
};

export const writeNextSessionNotesEnabled = async (
  uid: string | undefined | null,
  enabled: boolean,
) => {
  if (!uid) return;
  await AsyncStorage.setItem(
    getNextSessionNotesEnabledKey(uid),
    String(enabled),
  );
};
