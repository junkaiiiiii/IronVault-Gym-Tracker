import { CURRENT_LEGAL_ACCEPTANCE } from "../constants/legal";

export type LegalAcceptance = {
  termsVersion?: string | null;
  privacyVersion?: string | null;
  acceptedAt?: number | null;
};

export const normalizeLegalAcceptance = (value: any): LegalAcceptance => ({
  termsVersion: value?.termsVersion || value?.terms || null,
  privacyVersion: value?.privacyVersion || value?.privacy || null,
  acceptedAt: Number(value?.acceptedAt || value?.legalAcceptedAt || 0) || null,
});

export const isCurrentLegalAcceptance = (value: any) => {
  const acceptance = normalizeLegalAcceptance(value);
  return (
    acceptance.termsVersion === CURRENT_LEGAL_ACCEPTANCE.termsVersion &&
    acceptance.privacyVersion === CURRENT_LEGAL_ACCEPTANCE.privacyVersion
  );
};
