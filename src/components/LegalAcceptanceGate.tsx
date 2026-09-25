import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { signOut, User } from "firebase/auth";
import { auth } from "../config/firebaseConfig";
import { LEGAL_DOCUMENTS, LegalDocumentType } from "../constants/legal";
import LegalDocument from "./LegalDocument";
import {
  hasAcceptedCurrentLegal,
  recordLegalAcceptance,
} from "../utils/legalAcceptance";

type Props = {
  user: User | null;
};

export default function LegalAcceptanceGate({ user }: Props) {
  const [isChecking, setIsChecking] = useState(false);
  const [isRequired, setIsRequired] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [selectedType, setSelectedType] =
    useState<LegalDocumentType>("terms");

  useEffect(() => {
    let isMounted = true;

    const checkAcceptance = async () => {
      if (!user?.uid || !user.emailVerified) {
        setIsRequired(false);
        setIsChecking(false);
        return;
      }

      setIsChecking(true);
      try {
        const accepted = await hasAcceptedCurrentLegal(user.uid);
        if (isMounted) setIsRequired(!accepted);
      } finally {
        if (isMounted) setIsChecking(false);
      }
    };

    checkAcceptance();
    return () => {
      isMounted = false;
    };
  }, [user?.uid, user?.emailVerified]);

  const acceptLegal = async () => {
    if (!user?.uid) return;
    setIsAccepting(true);
    try {
      await recordLegalAcceptance(user.uid);
      setIsRequired(false);
    } finally {
      setIsAccepting(false);
    }
  };

  if (!user?.uid || isChecking || !isRequired) return null;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet">
      <View style={styles.container}>
        <SafeAreaView edges={["top"]} style={styles.safeArea}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Legal Update</Text>
              <Text style={styles.subtitle}>Review to continue using IronVault</Text>
            </View>
            <TouchableOpacity
              style={styles.signOutButton}
              onPress={() => signOut(auth)}
            >
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        <View style={styles.tabRow}>
          {(["terms", "privacy"] as LegalDocumentType[]).map((type) => {
            const active = selectedType === type;
            return (
              <TouchableOpacity
                key={type}
                style={[styles.tabButton, active && styles.tabButtonActive]}
                onPress={() => setSelectedType(type)}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {LEGAL_DOCUMENTS[type].title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView contentContainerStyle={styles.documentContent}>
          <LegalDocument
            type={selectedType}
            textStyle={styles.legalText}
            headingStyle={styles.legalHeading}
          />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.acceptButton, isAccepting && { opacity: 0.75 }]}
            disabled={isAccepting}
            onPress={acceptLegal}
          >
            {isAccepting ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.acceptText}>Accept & Continue</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  safeArea: {
    backgroundColor: "#000",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#2C2C2E",
  },
  title: {
    color: "#FFF",
    fontSize: 20,
    fontWeight: "900",
  },
  subtitle: {
    color: "#8E8E93",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  signOutButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  signOutText: {
    color: "#8E8E93",
    fontSize: 14,
    fontWeight: "800",
  },
  tabRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1C1C1E",
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: "#1C1C1E",
    borderWidth: 1,
    borderColor: "#2C2C2E",
  },
  tabButtonActive: {
    backgroundColor: "#32D74B",
    borderColor: "#32D74B",
  },
  tabText: {
    color: "#8E8E93",
    fontSize: 13,
    fontWeight: "900",
  },
  tabTextActive: {
    color: "#000",
  },
  documentContent: {
    padding: 24,
    paddingBottom: 40,
  },
  legalText: {
    color: "#D1D1D6",
    fontSize: 15,
    lineHeight: 24,
  },
  legalHeading: {
    color: "#FFF",
    fontSize: 16,
    fontWeight: "900",
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: "#2C2C2E",
    backgroundColor: "#000",
  },
  acceptButton: {
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: "#32D74B",
    alignItems: "center",
    justifyContent: "center",
  },
  acceptText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "900",
  },
});
