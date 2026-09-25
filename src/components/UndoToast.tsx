import React, { useEffect } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Radius, Shadows } from "../theme";

type UndoToastProps = {
  visible: boolean;
  message: string;
  actionLabel?: string;
  durationMs?: number;
  bottomOffset?: number;
  onAction: () => void;
  onDismiss: () => void;
};

export default function UndoToast({
  visible,
  message,
  actionLabel = "Undo",
  durationMs = 5200,
  bottomOffset = 12,
  onAction,
  onDismiss,
}: UndoToastProps) {
  useEffect(() => {
    if (!visible) return;

    const timeout = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timeout);
  }, [durationMs, onDismiss, visible]);

  if (!visible) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrapper, { bottom: bottomOffset }]}
    >
      <View style={styles.toast}>
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark" size={16} color={Colors.background} />
        </View>
        <Text style={styles.message} numberOfLines={1}>
          {message}
        </Text>
        <TouchableOpacity
          activeOpacity={0.78}
          style={styles.action}
          onPress={onAction}
        >
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 50,
  },
  toast: {
    minHeight: 56,
    borderRadius: Radius.lg,
    backgroundColor: Colors.elevated,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    ...Shadows.card,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  message: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    fontWeight: "800",
    marginRight: 10,
  },
  action: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    color: Colors.background,
    fontSize: 13,
    fontWeight: "900",
  },
});
