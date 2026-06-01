import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Colors, Radius, Spacing } from "../theme";

interface AlertButton {
  text: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
}

interface CustomAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons: AlertButton[];
  onClose: () => void;
}

export default function CustomAlert({
  visible,
  title,
  message,
  buttons,
  onClose,
}: CustomAlertProps) {
  // If there are 3 buttons (like the Leave Workout menu), stack them vertically.
  // If 1 or 2 buttons, put them side-by-side.
  const isStacked = buttons.length > 2;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        {/* We wrap the inner box in an activeOpacity={1} Touchable so tapping INSIDE the box doesn't trigger the onClose overlay */}
        <TouchableOpacity activeOpacity={1} style={styles.alertBox}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <View
            style={[
              styles.buttonContainer,
              isStacked && styles.buttonContainerStacked,
            ]}
          >
            {buttons.map((btn, index) => {
              const isDestructive = btn.style === "destructive";
              const isCancel = btn.style === "cancel";

              return (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.button,
                    !isStacked && styles.buttonSideBySide,
                    isDestructive && {
                      backgroundColor: Colors.dangerSoft,
                    },
                    isCancel && { backgroundColor: Colors.elevated },
                  ]}
                  onPress={() => {
                    if (btn.onPress) btn.onPress();
                    onClose();
                  }}
                >
                  <Text
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.85}
                    style={[
                      styles.buttonText,
                      isDestructive && { color: Colors.danger },
                      isCancel && { color: Colors.textMuted, fontWeight: "700" },
                    ]}
                  >
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent: "center",
    alignItems: "center",
  },
  alertBox: {
    backgroundColor: Colors.card,
    width: "86%",
    maxWidth: 420,
    borderRadius: Radius.xxl,
    padding: Spacing.xxl,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "900",
    marginBottom: 10,
    textAlign: "center",
  },
  message: {
    color: Colors.textMuted,
    fontSize: 15,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  buttonContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    gap: 10,
  },
  buttonContainerStacked: {
    flexDirection: "column",
  },
  button: {
    backgroundColor: Colors.accent,
    minHeight: 50,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: Radius.lg,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  buttonSideBySide: {
    flex: 1,
    width: "auto",
  },
  buttonText: {
    color: Colors.background,
    fontSize: 16,
    fontWeight: "800",
  },
});
