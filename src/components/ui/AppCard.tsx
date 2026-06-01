import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { Colors, Radius, Spacing, Shadows } from "../../theme";

type AppCardProps = {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  padded?: boolean;
  elevated?: boolean;
};

export default function AppCard({
  children,
  style,
  padded = true,
  elevated = false,
}: AppCardProps) {
  return (
    <View
      style={[
        styles.card,
        padded && styles.padded,
        elevated && Shadows.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  padded: {
    padding: Spacing.lg,
  },
});
