import { Platform } from "react-native";

export const Colors = {
  background: "#000000",
  surface: "#111113",
  card: "#1C1C1E",
  cardAlt: "#202022",
  elevated: "#2C2C2E",
  border: "#2C2C2E",
  borderStrong: "#3A3A3C",
  text: "#FFFFFF",
  textMuted: "#8E8E93",
  textSubtle: "#636366",
  accent: "#32D74B",
  accentSoft: "rgba(50, 215, 75, 0.14)",
  accentBorder: "rgba(50, 215, 75, 0.35)",
  danger: "#FF453A",
  dangerAlt: "#FF3B30",
  dangerSoft: "rgba(255, 69, 58, 0.14)",
  warning: "#FFD60A",
  blue: "#0A84FF",
  white: "#FFFFFF",
  black: "#000000",
  tabBar: "#050505",
} as const;

export const Spacing = {
  xxs: 4,
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 28,
  section: 32,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  pill: 999,
} as const;

export const Typography = {
  screenTitle: {
    fontSize: 34,
    fontWeight: "900" as const,
    color: Colors.text,
    letterSpacing: -0.8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "900" as const,
    color: Colors.textMuted,
    textTransform: "uppercase" as const,
    letterSpacing: 1.1,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "900" as const,
    color: Colors.text,
    letterSpacing: -0.2,
  },
  body: {
    fontSize: 15,
    fontWeight: "700" as const,
    color: Colors.textMuted,
    lineHeight: 21,
  },
  caption: {
    fontSize: 12,
    fontWeight: "800" as const,
    color: Colors.textMuted,
  },
} as const;

export const Layout = {
  screenPadding: Spacing.xl,
  bottomTabExtraPadding: 120,
  headerHeight: 58,
  minTouchTarget: 44,
  listBottomPadding: 128,
} as const;

export const Shadows = {
  card: Platform.select({
    ios: {
      shadowColor: Colors.black,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.18,
      shadowRadius: 16,
    },
    android: {
      elevation: 3,
    },
    default: {},
  }),
  tabBar: Platform.select({
    ios: {
      shadowColor: Colors.black,
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.24,
      shadowRadius: 12,
    },
    android: {
      elevation: 16,
    },
    default: {},
  }),
} as const;

export const HitSlop = {
  sm: { top: 8, bottom: 8, left: 8, right: 8 },
  md: { top: 12, bottom: 12, left: 12, right: 12 },
} as const;

export const commonStyles = {
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowBetween: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
  },
  center: {
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
};
