import React from "react";
import { Text, StyleSheet, View, ViewStyle } from "react-native";
import { Typography, Spacing } from "../../theme";

type SectionTitleProps = {
  title: string;
  right?: React.ReactNode;
  style?: ViewStyle;
};

export default function SectionTitle({
  title,
  right,
  style,
}: SectionTitleProps) {
  return (
    <View style={[styles.row, style]}>
      <Text style={styles.title}>{title}</Text>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: Spacing.xxl,
    marginBottom: Spacing.md,
  },
  title: Typography.sectionTitle,
});
