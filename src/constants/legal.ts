export type LegalDocumentType = "terms" | "privacy";

export const LEGAL_LAST_UPDATED = "June 2026";
export const LEGAL_TERMS_VERSION = "terms-2026-06-23";
export const LEGAL_PRIVACY_VERSION = "privacy-2026-06-23";
export const LEGAL_WEBSITE_URL = "https://gymtracker-128ca.web.app";
export const LEGAL_SUPPORT_EMAIL = "ironvault.app@gmail.com";

export const CURRENT_LEGAL_ACCEPTANCE = {
  termsVersion: LEGAL_TERMS_VERSION,
  privacyVersion: LEGAL_PRIVACY_VERSION,
} as const;

export const LEGAL_DOCUMENTS: Record<
  LegalDocumentType,
  {
    title: string;
    version: string;
    sections: { title: string; body: string }[];
  }
> = {
  terms: {
    title: "Terms of Service",
    version: LEGAL_TERMS_VERSION,
    sections: [
      {
        title: "1. Acceptance of Terms",
        body: "By creating an account or using IronVault, you agree to these Terms of Service and the Privacy Policy.",
      },
      {
        title: "2. Fitness and Medical Disclaimer",
        body: "IronVault is a workout logging, training organisation, and progress tracking tool. It does not provide medical advice, diagnosis, treatment, coaching, personalised programming, or emergency assistance. Statistics, PRs, trends, and estimates are informational only. Always consult a qualified healthcare or fitness professional before beginning or changing an exercise program. Weightlifting and physical exercise involve risk, and you are responsible for training safely, using proper equipment, and stopping if you feel pain, dizziness, or unsafe symptoms.",
      },
      {
        title: "3. User Responsibility",
        body: "You are responsible for the workouts, exercises, weights, reps, notes, remarks, templates, folders, split schedules, custom exercises, favorites, gyms, machine brands, gym-specific swaps, rest timer settings, imports, exports, and other information you create or enter in IronVault. You agree not to use the app to abuse, disrupt, reverse engineer, overload, scrape, or attempt to breach any service, account, or database.",
      },
      {
        title: "4. Sync, Backup, and Data Loss",
        body: "IronVault saves data locally on your device and provides cloud sync, backup export, and backup import tools to help keep your data available. Sync is merge-based where supported, but no sync, storage, import, export, or device system can be guaranteed to be error-free. You are encouraged to keep your own backups, especially before deleting accounts, changing devices, importing data, or making major routine changes.",
      },
      {
        title: "5. Account Deletion",
        body: "You may initiate account deletion from Settings where supported. Deletion is intended to remove your Firebase account, username reservation, workouts, and cloud-stored app configuration data associated with that account, subject to technical, legal, platform, and backup limitations. Deleting your account may not remove backup files you exported or data stored outside IronVault's systems. Some deletion or backup operations may take time to complete.",
      },
      {
        title: "6. Limitation of Liability",
        body: "To the maximum extent permitted by law, IronVault and its creator(s) are not liable for direct, indirect, incidental, or consequential damages, including physical injury, lost progress, or data loss, resulting from use of the app.",
      },
      {
        title: "7. Changes to Terms",
        body: "These terms may be updated as IronVault changes. Continued use of the app after updates means you accept the revised terms. If a change is material, IronVault may ask you to review the updated terms again.",
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    version: LEGAL_PRIVACY_VERSION,
    sections: [
      {
        title: "1. Information We Collect",
        body: "IronVault collects and stores the information needed to provide workout tracking, app personalisation, sync, backup, and account features:\n- Account information: email address, authentication identifiers, sign-in provider details, username/display name, and username reservation records.\n- Workout and fitness data: workouts, exercises, warm-up sets, working sets, reps, weights, duration, volume, workout history, exercise remarks, notes, PRs, records, and progress/statistics generated from your logs.\n- Training organisation data: templates, folders, split days, rest days, scheduled routines, favorite exercises, recent exercises, custom exercises, exercise cues, and gym-specific exercise swaps.\n- Gym and equipment data: gym names, machine brands, machine brand defaults, exercise variants, equipment tags, and gym or machine-brand history filters.\n- App preferences and status data: KG/LBS, rest timer and warm-up rest timer settings, auto-check sets, plate calculator settings, available plates, onboarding/setup choices, active session state, import/export details, sync status, and backup settings.",
      },
      {
        title: "2. How We Use Information",
        body: "Your information is used to create and secure your account, reserve usernames, save and sync workouts, resume active sessions, personalise the Home screen, manage templates, folders, split schedules, gyms, machine brands, gym-specific swaps, and exercise libraries, calculate statistics and PRs, filter history, support backup/import/export, troubleshoot reliability, and maintain app functionality. We do not sell your personal information or workout data to third-party data brokers.",
      },
      {
        title: "3. Third-Party Services",
        body: "IronVault uses Google Firebase for authentication, database hosting, cloud sync, and account-related services. Email/password, Google sign-in, and Apple sign-in data are handled through Firebase authentication and the relevant sign-in provider. IronVault may also include open-source exercise data provided under public or permissive licences.",
      },
      {
        title: "4. Sync, Export, and Import",
        body: "Sync and backup features may store, merge, export, or restore workouts, templates, folders, split settings, custom exercises, favorites, gyms, machine brands, gym-specific swaps, app preferences, and sync metadata. Exported backup files are created for your own use; you are responsible for storing and sharing those files safely.",
      },
      {
        title: "5. Your Rights and Choices",
        body: "You can manage many app settings inside IronVault. You may update your username, export data, import backups, sync with cloud, sign out, or initiate account and data deletion where supported. Deleting your account is intended to remove associated app data from IronVault systems, subject to technical, legal, platform, and backup limitations. It does not remove backup files you exported or data stored outside IronVault's systems.",
      },
      {
        title: "6. Data Security",
        body: "We use Firebase and reasonable technical safeguards to protect data, but no internet-connected service can guarantee absolute security.",
      },
      {
        title: "7. Contact",
        body: `For privacy, support, or account deletion questions, contact ${LEGAL_SUPPORT_EMAIL}.`,
      },
    ],
  },
};
