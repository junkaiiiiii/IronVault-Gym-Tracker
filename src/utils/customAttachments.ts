import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth } from "../config/firebaseConfig";
import {
  DEFAULT_CABLE_ATTACHMENTS,
  NO_ATTACHMENT_OPTION_LABEL,
  getExerciseAttachmentOptions,
  normalizeExerciseAttachment,
  shouldAllowNoAttachmentOption,
} from "./helpers";
import { safeJsonParse, syncSettingsToCloud } from "./firebaseSync";

export const CUSTOM_ATTACHMENT_LIMIT = 20;
export const CUSTOM_ATTACHMENT_NAME_LIMIT = 40;

const customAttachmentsStorageKey = (uid: string) =>
  `@custom_attachments_${uid}`;

export const normalizeAttachmentIdentity = (value: any) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ");

export const sanitizeCustomAttachmentName = (value: any) =>
  normalizeExerciseAttachment(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CUSTOM_ATTACHMENT_NAME_LIMIT)
    .trim();

export const normalizeCustomAttachmentList = (value: any): string[] => {
  const defaults = new Set(
    DEFAULT_CABLE_ATTACHMENTS.map((attachment) =>
      normalizeAttachmentIdentity(attachment),
    ),
  );
  const byKey = new Map<string, string>();

  (Array.isArray(value) ? value : []).forEach((item) => {
    const attachment = sanitizeCustomAttachmentName(item);
    const key = normalizeAttachmentIdentity(attachment);
    if (!attachment || !key || defaults.has(key) || byKey.has(key)) return;
    byKey.set(key, attachment);
  });

  return Array.from(byKey.values()).slice(0, CUSTOM_ATTACHMENT_LIMIT);
};

export const isCustomAttachment = (
  attachment: string,
  customAttachments: string[] = [],
) => {
  const key = normalizeAttachmentIdentity(attachment);
  return normalizeCustomAttachmentList(customAttachments).some(
    (customAttachment) =>
      normalizeAttachmentIdentity(customAttachment) === key,
  );
};

export const replaceCustomAttachmentInList = (
  customAttachments: string[] = [],
  previousAttachment: string,
  nextAttachment: string,
) => {
  const previousKey = normalizeAttachmentIdentity(previousAttachment);
  return normalizeCustomAttachmentList(
    customAttachments.map((attachment) =>
      normalizeAttachmentIdentity(attachment) === previousKey
        ? nextAttachment
        : attachment,
    ),
  );
};

export const removeCustomAttachmentFromList = (
  customAttachments: string[] = [],
  attachmentToRemove: string,
) => {
  const removeKey = normalizeAttachmentIdentity(attachmentToRemove);
  return normalizeCustomAttachmentList(
    customAttachments.filter(
      (attachment) => normalizeAttachmentIdentity(attachment) !== removeKey,
    ),
  );
};

export const mergeAttachmentOptions = (
  defaultOptions: string[] = [],
  customAttachments: string[] = [],
) => {
  const byKey = new Map<string, string>();

  [...defaultOptions, ...customAttachments].forEach((item) => {
    const attachment = sanitizeCustomAttachmentName(item);
    const key = normalizeAttachmentIdentity(attachment);
    if (!attachment || !key || byKey.has(key)) return;
    byKey.set(key, attachment);
  });

  return Array.from(byKey.values());
};

export const getExerciseAttachmentOptionsWithCustom = (
  exercise: any,
  customAttachments: string[] = [],
) =>
  mergeAttachmentOptions(
    getExerciseAttachmentOptions(exercise),
    normalizeCustomAttachmentList(customAttachments),
  );

export const getExerciseAttachmentSelectionOptions = (
  exercise: any,
  customAttachments: string[] = [],
) => {
  const options = getExerciseAttachmentOptionsWithCustom(
    exercise,
    customAttachments,
  );

  return shouldAllowNoAttachmentOption(exercise)
    ? [NO_ATTACHMENT_OPTION_LABEL, ...options]
    : options;
};

export const readCustomAttachments = async (uid = auth.currentUser?.uid) => {
  if (!uid) return [];
  const raw = await AsyncStorage.getItem(customAttachmentsStorageKey(uid));
  return normalizeCustomAttachmentList(safeJsonParse(raw, []));
};

export const saveCustomAttachments = async (
  attachments: string[],
  uid = auth.currentUser?.uid,
) => {
  const cleaned = normalizeCustomAttachmentList(attachments);
  if (!uid) return cleaned;

  await AsyncStorage.setItem(
    customAttachmentsStorageKey(uid),
    JSON.stringify(cleaned),
  );

  syncSettingsToCloud({ customAttachments: cleaned }).catch((error) => {
    console.log("Unable to sync custom attachments to cloud:", error);
  });

  return cleaned;
};

export const validateCustomAttachmentName = (
  value: string,
  existingOptions: string[] = [],
  customAttachments: string[] = [],
  editingAttachment?: string | null,
) => {
  const rawValue = String(value || "").replace(/\s+/g, " ").trim();
  const attachment = sanitizeCustomAttachmentName(rawValue);
  if (!attachment) {
    return { attachment: "", error: "Enter an attachment name." };
  }
  if (rawValue.length > CUSTOM_ATTACHMENT_NAME_LIMIT) {
    return {
      attachment: "",
      error: `Keep attachment names under ${CUSTOM_ATTACHMENT_NAME_LIMIT} characters.`,
    };
  }

  const editingKey = normalizeAttachmentIdentity(editingAttachment);
  const existingKeys = new Set(
    mergeAttachmentOptions(existingOptions, customAttachments)
      .map(normalizeAttachmentIdentity)
      .filter((key) => key !== editingKey),
  );
  if (existingKeys.has(normalizeAttachmentIdentity(attachment))) {
    return {
      attachment,
      error: `${attachment} is already in the attachment list.`,
    };
  }

  if (
    !editingKey &&
    normalizeCustomAttachmentList(customAttachments).length >=
    CUSTOM_ATTACHMENT_LIMIT
  ) {
    return {
      attachment: "",
      error: `You can save up to ${CUSTOM_ATTACHMENT_LIMIT} custom attachments.`,
    };
  }

  return { attachment, error: "" };
};
