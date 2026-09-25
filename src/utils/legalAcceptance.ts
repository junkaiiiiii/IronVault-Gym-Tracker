import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../config/firebaseConfig";
import { CURRENT_LEGAL_ACCEPTANCE } from "../constants/legal";
import {
  LegalAcceptance,
  isCurrentLegalAcceptance,
  normalizeLegalAcceptance,
} from "./legalVersions";

export { isCurrentLegalAcceptance } from "./legalVersions";

const termsKey = (uid: string) => `@legal_terms_version_${uid}`;
const privacyKey = (uid: string) => `@legal_privacy_version_${uid}`;
const acceptedAtKey = (uid: string) => `@legal_accepted_at_${uid}`;

export const getLocalLegalAcceptance = async (uid: string) => {
  const pairs = await AsyncStorage.multiGet([
    termsKey(uid),
    privacyKey(uid),
    acceptedAtKey(uid),
  ]);
  const values = Object.fromEntries(pairs);
  return normalizeLegalAcceptance({
    termsVersion: values[termsKey(uid)],
    privacyVersion: values[privacyKey(uid)],
    acceptedAt: values[acceptedAtKey(uid)],
  });
};

export const cacheLegalAcceptanceLocally = async (
  uid: string,
  acceptance: LegalAcceptance,
) => {
  if (!acceptance.termsVersion || !acceptance.privacyVersion) return;
  await AsyncStorage.multiSet([
    [termsKey(uid), acceptance.termsVersion],
    [privacyKey(uid), acceptance.privacyVersion],
    [acceptedAtKey(uid), String(acceptance.acceptedAt || Date.now())],
  ]);
};

export const recordLegalAcceptance = async (uid: string) => {
  const acceptedAt = Date.now();
  const acceptance = {
    ...CURRENT_LEGAL_ACCEPTANCE,
    acceptedAt,
  };

  await cacheLegalAcceptanceLocally(uid, acceptance);

  setDoc(
    doc(db, "users", uid),
    {
      legalAcceptance: acceptance,
      legalAcceptedAt: acceptedAt,
      termsVersion: acceptance.termsVersion,
      privacyVersion: acceptance.privacyVersion,
    },
    { merge: true },
  ).catch((error) => {
    console.log("Unable to save legal acceptance to cloud:", error);
  });

  return acceptance;
};

export const hasAcceptedCurrentLegal = async (uid: string) => {
  const localAcceptance = await getLocalLegalAcceptance(uid);
  if (isCurrentLegalAcceptance(localAcceptance)) return true;

  try {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (!userSnap.exists()) return false;

    const data = userSnap.data();
    const cloudAcceptance = normalizeLegalAcceptance({
      ...(data.legalAcceptance || data.legal || {}),
      termsVersion:
        data.legalAcceptance?.termsVersion ||
        data.legal?.termsVersion ||
        data.termsVersion,
      privacyVersion:
        data.legalAcceptance?.privacyVersion ||
        data.legal?.privacyVersion ||
        data.privacyVersion,
      acceptedAt:
        data.legalAcceptance?.acceptedAt ||
        data.legal?.acceptedAt ||
        data.legalAcceptedAt,
    });

    if (isCurrentLegalAcceptance(cloudAcceptance)) {
      await cacheLegalAcceptanceLocally(uid, cloudAcceptance);
      return true;
    }
  } catch (error) {
    console.log("Unable to check legal acceptance:", error);
  }

  return false;
};
