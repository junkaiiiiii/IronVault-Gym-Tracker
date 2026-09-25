import React from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { styles } from "../constants/globalStyles";
import { CUSTOM_ATTACHMENT_NAME_LIMIT } from "../utils/customAttachments";

type CustomAttachmentModalProps = {
  visible: boolean;
  value: string;
  error?: string;
  customAttachments?: string[];
  editingAttachment?: string | null;
  onChangeText: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onEditAttachment?: (attachment: string) => void;
  onDeleteAttachment?: (attachment: string) => void;
};

export default function CustomAttachmentModal({
  visible,
  value,
  error,
  customAttachments = [],
  editingAttachment,
  onChangeText,
  onCancel,
  onSave,
  onEditAttachment,
  onDeleteAttachment,
}: CustomAttachmentModalProps) {
  const isEditing = !!editingAttachment;
  const shouldAutoFocusInput = isEditing || customAttachments.length === 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.modalOverlay}
      >
        <View style={[styles.modalContent, { maxHeight: "82%" }]}>
          <Text style={styles.modalTitle}>Custom Attachment</Text>
          <Text style={[styles.actionMenuSubtitle, { marginBottom: 14 }]}>
            {isEditing
              ? "Rename this custom attachment."
              : "Add a handle or cable attachment that is not in the default list."}
          </Text>
          <TextInput
            style={[
              styles.modalInput,
              { marginBottom: error ? 8 : 16, textAlign: "left" },
            ]}
            value={value}
            onChangeText={onChangeText}
            maxLength={CUSTOM_ATTACHMENT_NAME_LIMIT}
            placeholder="e.g. Prime ROT8 Handle"
            placeholderTextColor="#48484A"
            selectionColor="#32D74B"
            autoFocus={shouldAutoFocusInput}
            returnKeyType="done"
            onSubmitEditing={onSave}
          />
          {!!error && (
            <Text
              style={{
                alignSelf: "stretch",
                color: "#FF453A",
                fontSize: 13,
                fontWeight: "800",
                marginBottom: 14,
              }}
            >
              {error}
            </Text>
          )}
          <View style={styles.modalButtonRow}>
            <TouchableOpacity onPress={onCancel}>
              <Text style={styles.modalActionText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onSave}>
              <Text
                style={[
                  styles.modalActionText,
                  { fontWeight: "bold", color: "#32D74B" },
                ]}
              >
                {isEditing ? "Save" : "Add"}
              </Text>
            </TouchableOpacity>
          </View>

          {customAttachments.length > 0 && (
            <View style={{ alignSelf: "stretch", marginTop: 18 }}>
              <Text
                style={{
                  color: "#8E8E93",
                  fontSize: 12,
                  fontWeight: "900",
                  letterSpacing: 1.6,
                  marginBottom: 10,
                  textTransform: "uppercase",
                }}
              >
                Saved Custom Attachments
              </Text>
              <ScrollView
                style={{ maxHeight: 220 }}
                contentContainerStyle={{ paddingBottom: 4 }}
                keyboardShouldPersistTaps="always"
              >
                {customAttachments.map((attachment) => (
                  <View
                    key={attachment}
                    style={{
                      minHeight: 48,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor:
                        attachment === editingAttachment
                          ? "#32D74B"
                          : "#2C2C2E",
                      backgroundColor: "#1C1C1E",
                      paddingLeft: 14,
                      paddingRight: 8,
                      marginBottom: 8,
                      flexDirection: "row",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        flex: 1,
                        color: "#F2F2F7",
                        fontSize: 14,
                        fontWeight: "800",
                        marginRight: 10,
                      }}
                      numberOfLines={1}
                    >
                      {attachment}
                    </Text>
                    <TouchableOpacity
                      onPress={() => onEditAttachment?.(attachment)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="pencil" size={18} color="#8E8E93" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => onDeleteAttachment?.(attachment)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="trash-outline" size={18} color="#FF453A" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
