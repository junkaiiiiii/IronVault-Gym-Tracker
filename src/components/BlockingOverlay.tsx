import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

type BlockingOverlayProps = {
  visible: boolean;
  message?: string;
  color?: string;
};

export default function BlockingOverlay({
  visible,
  message = "Saving...",
  color = "#32D74B",
}: BlockingOverlayProps) {
  if (!visible) return null;

  return (
    <View
      pointerEvents="auto"
      accessibilityViewIsModal
      style={overlayStyles.backdrop}
    >
      <View style={overlayStyles.card}>
        <ActivityIndicator size="large" color={color} />
        <Text style={overlayStyles.message}>{message}</Text>
      </View>
    </View>
  );
}

const overlayStyles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    minWidth: 160,
    maxWidth: 260,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#3A3A3C",
    backgroundColor: "#1C1C1E",
    paddingHorizontal: 22,
    paddingVertical: 20,
    alignItems: "center",
  },
  message: {
    color: "#FFF",
    fontSize: 15,
    fontWeight: "800",
    marginTop: 12,
    textAlign: "center",
  },
});
