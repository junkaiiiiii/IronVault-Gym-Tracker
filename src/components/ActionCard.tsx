import React from "react";
import { View, Text, TouchableOpacity, Image, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Radius, Spacing, Typography, HitSlop } from "../theme";

export const ActionCard = ({
  item,
  label,
  title,
  subtext,
  onPress,
  onOptions,
  actionIcon = "ellipsis-horizontal",
}: any) => {
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={onPress}
      activeOpacity={0.78}
    >
      {item.image ? (
        <Image source={{ uri: item.image }} style={styles.image} />
      ) : (
        <View style={styles.placeholderImage}>
          <Ionicons name="barbell" size={24} color={Colors.textMuted} />
        </View>
      )}

      <View style={styles.textContainer}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtext} numberOfLines={2}>
          {subtext}
        </Text>
      </View>

      {onOptions && (
        <TouchableOpacity
          style={styles.optionsBtn}
          onPress={() => onOptions(item)}
          hitSlop={HitSlop.sm}
        >
          <Ionicons name={actionIcon} size={24} color={Colors.textMuted} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    minHeight: 76,
  },
  image: {
    width: 52,
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.border,
  },
  placeholderImage: {
    width: 52,
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  textContainer: {
    flex: 1,
    marginLeft: Spacing.lg,
  },
  label: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: Spacing.xs,
  },
  title: {
    ...Typography.cardTitle,
    fontSize: 18,
    marginBottom: Spacing.xs,
  },
  subtext: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 19,
  },
  optionsBtn: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
