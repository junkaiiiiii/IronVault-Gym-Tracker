import React from "react";
import { Text, TouchableOpacity, StyleSheet, ViewStyle } from "react-native";
import { Colors, Radius, Spacing, HitSlop } from "../../theme";

type FilterChipProps = {
  label: string;
  active?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
};

export default function FilterChip({
  label,
  active,
  onPress,
  style,
}: FilterChipProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.78}
      hitSlop={HitSlop.sm}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive, style]}
    >
      <Text style={[styles.text, active && styles.textActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 40,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: {
    backgroundColor: Colors.white,
    borderColor: Colors.white,
  },
  text: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: "900",
  },
  textActive: {
    color: Colors.black,
  },
});
