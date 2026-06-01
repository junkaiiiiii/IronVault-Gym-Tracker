import React, { useState, useEffect } from "react";
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Modal,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";
import * as AppleAuthentication from "expo-apple-authentication";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { auth, db } from "../config/firebaseConfig";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithCredential,
  setPersistence,
  inMemoryPersistence,
  sendEmailVerification,
  signOut,
  sendPasswordResetEmail,
  getAdditionalUserInfo,
  OAuthProvider,
} from "firebase/auth";

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [loading, setLoading] = useState(false);

  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [staySignedIn, setStaySignedIn] = useState(true);

  const [isTermsVisible, setIsTermsVisible] = useState(false);
  const [isPrivacyVisible, setIsPrivacyVisible] = useState(false);

  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId:
      "1077182608968-bsuekmvophah31fvpmoah14m8n360ho2.apps.googleusercontent.com",
    webClientId:
      "1077182608968-tah6rt77rvjfqj2hnj6e4f10memjnjnv.apps.googleusercontent.com",
    androidClientId:
      "1077182608968-g65foaj6u34s2o6ohe8u3pmn8u41tvj7.apps.googleusercontent.com",
  });

  const syncUserSettingsFromCloud = async (uid: string) => {
    try {
      const userRef = doc(db, "users", uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const data = userSnap.data();

        let fetchedUsername = data.username;
        if (!fetchedUsername) {
          const q = query(collection(db, "usernames"), where("uid", "==", uid));
          const qSnap = await getDocs(q);
          if (!qSnap.empty) {
            fetchedUsername = qSnap.docs[0].data().display_name;
            await setDoc(
              userRef,
              { username: fetchedUsername },
              { merge: true },
            );
          }
        }

        if (fetchedUsername) {
          await AsyncStorage.setItem(`@user_username_${uid}`, fetchedUsername);
          await AsyncStorage.setItem(`@setup_complete_${uid}`, "true");
        }

        if (data.metric)
          await AsyncStorage.setItem(`@user_metric_${uid}`, data.metric);
        if (data.restTime)
          await AsyncStorage.setItem(
            `@rest_time_${uid}`,
            data.restTime.toString(),
          );
        if (data.restTimerEnabled !== undefined)
          await AsyncStorage.setItem(
            `@rest_timer_enabled_${uid}`,
            data.restTimerEnabled.toString(),
          );
        if (data.autoCheckEnabled !== undefined)
          await AsyncStorage.setItem(
            `@auto_check_enabled_${uid}`,
            data.autoCheckEnabled.toString(),
          );
        if (data.plateCalcEnabled !== undefined)
          await AsyncStorage.setItem(
            `@plate_calc_enabled_${uid}`,
            data.plateCalcEnabled.toString(),
          );

        console.log("Cloud settings successfully synced to local device.");
      } else {
        await setDoc(
          userRef,
          {
            metric: "LBS",
            restTime: 90,
            restTimerEnabled: true,
            autoCheckEnabled: false,
            plateCalcEnabled: true,
            createdAt: Date.now(),
          },
          { merge: true },
        );

        await AsyncStorage.setItem(`@user_metric_${uid}`, "LBS");
        await AsyncStorage.setItem(`@rest_time_${uid}`, "90");
      }
    } catch (error) {
      console.log("Failed to sync user settings from cloud:", error);
    }
  };

  useEffect(() => {
    if (response?.type === "success") {
      const { id_token, access_token } = response.params;

      const credential = id_token
        ? GoogleAuthProvider.credential(id_token)
        : GoogleAuthProvider.credential(null, access_token);

      setLoading(true);

      const applyPersistence = staySignedIn
        ? Promise.resolve()
        : setPersistence(auth, inMemoryPersistence);

      applyPersistence
        .then(() => signInWithCredential(auth, credential))
        .then(async (userCredential) => {
          const uid = userCredential.user.uid;

          await syncUserSettingsFromCloud(uid);

          const additionalInfo = getAdditionalUserInfo(userCredential);
          if (!additionalInfo?.isNewUser) {
            await AsyncStorage.setItem(`@has_completed_setup_${uid}`, "true");
            await AsyncStorage.setItem(`@has_completed_setup`, "true");
          }
        })
        .catch((error) => {
          Alert.alert("Login Failed", getFriendlyErrorMessage(error.code));
        })
        .finally(() => setLoading(false));
    } else if (response?.type === "error") {
      Alert.alert(
        "Google Sign-In Failed",
        response.error?.message ?? "Something went wrong.",
      );
    }
  }, [response]);

  const getFriendlyErrorMessage = (errorCode?: string) => {
    switch (errorCode) {
      case "auth/invalid-credential":
      case "auth/user-not-found":
      case "auth/wrong-password":
        return "The email or password is incorrect. Please check your details and try again.";
      case "auth/email-already-in-use":
        return "An account with this email already exists. Try logging in instead.";
      case "auth/weak-password":
        return "Password should be at least 6 characters.";
      case "auth/invalid-email":
        return "Please enter a valid email address.";
      case "auth/too-many-requests":
        return "Too many attempts. Please wait a moment before trying again.";
      case "auth/network-request-failed":
        return "Network connection failed. Check your internet connection and try again.";
      case "auth/popup-closed-by-user":
      case "ERR_REQUEST_CANCELED":
        return "Sign-in was cancelled.";
      case "auth/account-exists-with-different-credential":
        return "An account already exists with this email using a different sign-in method. Try signing in with the original provider.";
      default:
        return "Something went wrong. Please try again.";
    }
  };

  const handleEmailAuth = async () => {
    if (!agreedToTerms) {
      return Alert.alert(
        "Required",
        "You must agree to the Terms of Service and Privacy Policy to continue.",
      );
    }
    const normalizedEmail = email.trim();

    if (!normalizedEmail || !password) {
      return Alert.alert("Required", "Please fill in all fields.");
    }

    if (!isLoginMode && password !== confirmPassword) {
      return Alert.alert("Password Mismatch", "Your passwords do not match.");
    }

    setLoading(true);
    try {
      if (!staySignedIn) {
        await setPersistence(auth, inMemoryPersistence);
      }

      if (isLoginMode) {
        const userCredential = await signInWithEmailAndPassword(
          auth,
          normalizedEmail,
          password,
        );
        const user = userCredential.user;

        if (!user.emailVerified) {
          Alert.alert(
            "Email Not Verified",
            "Please verify your email address to log in.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Resend Email",
                onPress: async () => {
                  await sendEmailVerification(user);
                  Alert.alert(
                    "Sent!",
                    "A new verification email has been sent. Please check your spam/junk folder if you don't see it.",
                  );
                },
              },
            ],
          );
          await signOut(auth);
          setLoading(false);
          return;
        }

        await syncUserSettingsFromCloud(user.uid);

        await AsyncStorage.setItem(`@has_completed_setup_${user.uid}`, "true");
        await AsyncStorage.setItem(`@has_completed_setup`, "true");
      } else {
        const userCredential = await createUserWithEmailAndPassword(
          auth,
          normalizedEmail,
          password,
        );
        const user = userCredential.user;

        await sendEmailVerification(user);

        Alert.alert(
          "Verify Your Email",
          "We've sent a verification link to your email. Please check your spam/junk folder and click the link to activate your account before logging in.",
        );

        await signOut(auth);

        setIsLoginMode(true);
        setPassword("");
        setConfirmPassword("");
      }
    } catch (error: any) {
      Alert.alert(
        isLoginMode ? "Login Failed" : "Registration Failed",
        getFriendlyErrorMessage(error.code),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = () => {
    if (!agreedToTerms) {
      return Alert.alert(
        "Required",
        "You must agree to the Terms of Service and Privacy Policy to continue.",
      );
    }
    if (!request) {
      return Alert.alert(
        "Google Sign-In Unavailable",
        "Google sign-in is still loading. Please try again in a moment.",
      );
    }

    promptAsync();
  };

  const handleAppleAuth = async () => {
    if (!agreedToTerms) {
      return Alert.alert(
        "Required",
        "You must agree to the Terms of Service and Privacy Policy to continue.",
      );
    }

    try {
      setLoading(true);
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (credential.identityToken) {
        const provider = new OAuthProvider("apple.com");
        const authCredential = provider.credential({
          idToken: credential.identityToken,
        });

        const applyPersistence = staySignedIn
          ? Promise.resolve()
          : setPersistence(auth, inMemoryPersistence);

        await applyPersistence;
        const userCredential = await signInWithCredential(auth, authCredential);
        const uid = userCredential.user.uid;

        await syncUserSettingsFromCloud(uid);

        const additionalInfo = getAdditionalUserInfo(userCredential);
        if (!additionalInfo?.isNewUser) {
          await AsyncStorage.setItem(`@has_completed_setup_${uid}`, "true");
          await AsyncStorage.setItem(`@has_completed_setup`, "true");
        }
      }
    } catch (error: any) {
      if (error.code !== "ERR_REQUEST_CANCELED") {
        Alert.alert(
          "Apple Sign-In Failed",
          getFriendlyErrorMessage(error.code),
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      return Alert.alert(
        "Required",
        "Please enter your email address in the field above first so we know where to send the reset link.",
      );
    }

    try {
      await sendPasswordResetEmail(auth, normalizedEmail);
      Alert.alert(
        "Reset Request Received",
        "If an account with that email exists, we have sent a password reset link to your inbox. Please check your spam/junk folder.",
      );
    } catch (error: any) {
      Alert.alert("Error", getFriendlyErrorMessage(error.code));
    }
  };

  const theme = {
    background: "#000",
    textPrimary: "#FFF",
    textSecondary: "#8E8E93",
    accent: "#32D74B",
    inputBorder: "#3A3A3C",
    googleBtn: "#FFF",
    modalBg: "#1C1C1E",
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: theme.background }]}
    >
      <Modal
        visible={isTermsVisible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View
          style={[styles.modalContainer, { backgroundColor: theme.modalBg }]}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Terms of Service</Text>
            <TouchableOpacity onPress={() => setIsTermsVisible(false)}>
              <Text style={styles.modalCloseText}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalScrollContent}>
            <Text style={styles.legalText}>
              <Text style={styles.legalBold}>Last Updated: May 2026</Text>
              {"\n\n"}
              <Text style={styles.legalBold}>1. Acceptance of Terms</Text>
              {"\n"}
              By creating an account or using IronVault, you agree to these
              Terms of Service and the Privacy Policy.{"\n\n"}
              <Text style={styles.legalBold}>2. Fitness and Medical Disclaimer</Text>
              {"\n"}
              IronVault is a workout logging and training organisation tool. It
              does not provide medical advice, diagnosis, treatment, coaching,
              or emergency assistance. Always consult a qualified healthcare or
              fitness professional before beginning or changing an exercise
              program. Weightlifting and physical exercise involve risk, and you
              are responsible for training safely, using proper equipment, and
              stopping if you feel pain, dizziness, or unsafe symptoms.{"\n\n"}
              <Text style={styles.legalBold}>3. User Responsibility</Text>
              {"\n"}
              You are responsible for the workouts, exercises, weights, notes,
              custom exercises, gyms, machine brands, templates, and other
              information you create or enter in IronVault. You agree not to use
              the app to abuse, disrupt, reverse engineer, or attempt to breach
              any service, account, or database.{"\n\n"}
              <Text style={styles.legalBold}>4. Sync, Backup, and Data Loss</Text>
              {"\n"}
              IronVault provides cloud sync and export/import tools to help keep
              your data available. You are encouraged to keep backups. While we
              work to maintain reliability, no sync or storage system can be
              guaranteed to be error-free.{"\n\n"}
              <Text style={styles.legalBold}>5. Account Deletion</Text>
              {"\n"}
              You may request or initiate deletion of your account and
              associated app data from within the app where supported. Some
              deletion or backup operations may take time to complete.{"\n\n"}
              <Text style={styles.legalBold}>6. Limitation of Liability</Text>
              {"\n"}
              To the maximum extent permitted by law, IronVault and its
              creator(s) are not liable for direct, indirect, incidental, or
              consequential damages, including physical injury, lost progress,
              or data loss, resulting from use of the app.{"\n\n"}
              <Text style={styles.legalBold}>7. Changes to Terms</Text>
              {"\n"}
              These terms may be updated as IronVault changes. Continued use of
              the app after updates means you accept the revised terms.
            </Text>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={isPrivacyVisible}
        animationType="slide"
        presentationStyle="pageSheet"
      >
        <View
          style={[styles.modalContainer, { backgroundColor: theme.modalBg }]}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Privacy Policy</Text>
            <TouchableOpacity onPress={() => setIsPrivacyVisible(false)}>
              <Text style={styles.modalCloseText}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalScrollContent}>
            <Text style={styles.legalText}>
              <Text style={styles.legalBold}>Last Updated: May 2026</Text>
              {"\n\n"}
              <Text style={styles.legalBold}>1. Information We Collect</Text>
              {"\n"}
              IronVault collects the information needed to provide workout
              tracking, app personalisation, sync, and backup features:
              {"\n"}• Account information: email address, authentication
              identifiers, and username/display name.
              {"\n"}• Workout and fitness data: workouts, exercises, sets,
              reps, weights, duration, volume, workout history, records, and
              progress/statistics generated from your logs.
              {"\n"}• Training organisation data: templates, folders, split
              days, rest days, favorite exercises, recent exercises, and custom
              exercises.
              {"\n"}• Gym and equipment data: gym names, machine brands,
              machine brand defaults, exercise variants, and gym-specific
              history filters.
              {"\n"}• App preferences: KG/LBS, default rest timer, auto-check
              sets, plate calculator settings, setup/onboarding preferences,
              and sync/backup settings.{"\n\n"}
              <Text style={styles.legalBold}>2. How We Use Information</Text>
              {"\n"}
              Your information is used to create your account, save and sync
              workouts, personalise the Home screen, manage templates and
              exercise libraries, calculate statistics, filter history, support
              backup/import/export, and maintain app reliability. We do not sell
              your personal information or workout data to third-party data
              brokers.{"\n\n"}
              <Text style={styles.legalBold}>3. Third-Party Services</Text>
              {"\n"}
              IronVault uses Google Firebase for authentication, database
              hosting, and cloud sync. Email/password and social sign-in data
              are handled through Firebase authentication services. IronVault
              may also include open-source exercise data provided under public
              or permissive licences.{"\n\n"}
              <Text style={styles.legalBold}>4. Sync, Export, and Import</Text>
              {"\n"}
              Sync and backup features may store or restore workouts,
              templates, folders, exercises, favorites, gyms, machine brands,
              and settings. Exported backup files are created for your own use;
              you are responsible for storing those files safely.{"\n\n"}
              <Text style={styles.legalBold}>5. Your Rights and Choices</Text>
              {"\n"}
              You can manage many app settings inside IronVault. You may export
              data, import backups, sign out, or request/initiate account and
              data deletion where supported. Deleting your account is intended
              to remove associated app data from IronVault systems, subject to
              technical, legal, and backup limitations.{"\n\n"}
              <Text style={styles.legalBold}>6. Data Security</Text>
              {"\n"}
              We use Firebase and reasonable technical safeguards to protect
              data, but no internet-connected service can guarantee absolute
              security.{"\n\n"}
              <Text style={styles.legalBold}>7. Contact</Text>
              {"\n"}
              For privacy, support, or account deletion questions, contact the
              app support address listed on IronVault’s App Store or Google Play
              listing.
            </Text>
          </ScrollView>
        </View>
      </Modal>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.keyboardView}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
        >
          <View style={styles.header}>
            <Text style={[styles.brandText, { color: theme.textPrimary }]}>
              IRONVAULT
            </Text>
            <Text style={[styles.subText, { color: theme.textSecondary }]}>
              {isLoginMode ? "Welcome back." : "Start your journey."}
            </Text>
            <Text style={styles.disclaimerText}>
              Workout logging only. IronVault does not provide medical advice.
            </Text>
          </View>

          <View style={styles.inputContainer}>
            <TextInput
              placeholder="Email"
              placeholderTextColor={theme.textSecondary}
              value={email}
              onChangeText={setEmail}
              style={[
                styles.input,
                {
                  color: theme.textPrimary,
                  borderBottomColor: theme.inputBorder,
                },
              ]}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TextInput
              placeholder="Password"
              placeholderTextColor={theme.textSecondary}
              value={password}
              onChangeText={setPassword}
              style={[
                styles.input,
                {
                  color: theme.textPrimary,
                  borderBottomColor: theme.inputBorder,
                  marginTop: 20,
                },
              ]}
              secureTextEntry
            />

            {!isLoginMode && (
              <TextInput
                placeholder="Confirm Password"
                placeholderTextColor={theme.textSecondary}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                style={[
                  styles.input,
                  {
                    color: theme.textPrimary,
                    borderBottomColor: theme.inputBorder,
                    marginTop: 20,
                  },
                ]}
                secureTextEntry
              />
            )}

            {isLoginMode && (
              <TouchableOpacity
                onPress={handleForgotPassword}
                style={{ marginTop: 16, alignSelf: "flex-end" }}
              >
                <Text
                  style={{
                    color: theme.accent,
                    fontWeight: "600",
                    fontSize: 14,
                  }}
                >
                  Forgot Password?
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.checkboxGroup}>
            <View style={styles.checkboxRow}>
              <TouchableOpacity
                onPress={() => setStaySignedIn(!staySignedIn)}
                style={styles.checkboxIcon}
              >
                <Ionicons
                  name={staySignedIn ? "checkbox" : "square-outline"}
                  size={24}
                  color={staySignedIn ? theme.accent : theme.textSecondary}
                />
              </TouchableOpacity>
              <Text
                style={[styles.checkboxText, { color: theme.textSecondary }]}
              >
                Stay signed in
              </Text>
            </View>

            <View style={styles.checkboxRow}>
              <TouchableOpacity
                onPress={() => setAgreedToTerms(!agreedToTerms)}
                style={styles.checkboxIcon}
              >
                <Ionicons
                  name={agreedToTerms ? "checkbox" : "square-outline"}
                  size={24}
                  color={agreedToTerms ? theme.accent : theme.textSecondary}
                />
              </TouchableOpacity>
              <Text
                style={[styles.checkboxText, { color: theme.textSecondary }]}
              >
                I agree to the{" "}
                <Text
                  style={{ color: theme.accent, fontWeight: "600" }}
                  onPress={() => setIsTermsVisible(true)}
                >
                  Terms
                </Text>{" "}
                and{" "}
                <Text
                  style={{ color: theme.accent, fontWeight: "600" }}
                  onPress={() => setIsPrivacyVisible(true)}
                >
                  Privacy Policy
                </Text>
                .
              </Text>
            </View>
          </View>

          <View style={styles.actionContainer}>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: theme.accent }]}
              onPress={handleEmailAuth}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {isLoginMode ? "Sign In" : "Sign Up"}
                </Text>
              )}
            </TouchableOpacity>

            {/* 👇 FIX: Updated Google Button Layout */}
            <TouchableOpacity
              style={[
                styles.googleButton,
                { backgroundColor: theme.googleBtn },
              ]}
              onPress={handleGoogleAuth}
              disabled={!request || loading}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons
                  name="logo-google"
                  size={20}
                  color="#000"
                  style={{ marginRight: 10 }}
                />
                <Text style={styles.googleButtonText}>
                  Continue with Google
                </Text>
              </View>
            </TouchableOpacity>

            {/* 👇 FIX: Custom Apple Button with matched height and layout */}
            {Platform.OS === "ios" && (
              <TouchableOpacity
                style={[
                  styles.googleButton,
                  { backgroundColor: theme.googleBtn },
                ]}
                onPress={handleAppleAuth}
                disabled={loading}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Ionicons
                    name="logo-apple"
                    size={22}
                    color="#000"
                    style={{ marginRight: 10, marginBottom: 2 }}
                  />
                  <Text style={styles.googleButtonText}>
                    Sign in with Apple
                  </Text>
                </View>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => {
                setIsLoginMode(!isLoginMode);
                setPassword("");
                setConfirmPassword("");
              }}
              style={{ alignItems: "center", marginTop: 20 }}
            >
              <Text style={{ color: theme.textSecondary }}>
                {isLoginMode ? "Need an account? " : "Already have? "}
                <Text style={{ color: theme.textPrimary, fontWeight: "600" }}>
                  {isLoginMode ? "Sign Up" : "Log In"}
                </Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  keyboardView: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 30,
    paddingVertical: 20,
  },
  header: { marginBottom: 40, marginTop: 40 },
  brandText: {
    fontSize: 42,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 8,
  },
  subText: { fontSize: 18, fontWeight: "500" },
  disclaimerText: {
    color: "#8E8E93",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    marginTop: 12,
  },
  inputContainer: { marginBottom: 20 },
  input: { fontSize: 18, paddingVertical: 12, borderBottomWidth: 1 },

  checkboxGroup: {
    marginBottom: 30,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    paddingRight: 20,
  },
  checkboxIcon: {
    marginRight: 10,
  },
  checkboxText: {
    fontSize: 14,
    lineHeight: 20,
  },

  actionContainer: { marginTop: 10, marginBottom: 40 },
  /* 👇 FIX: Replaced paddingVertical with an explicit height of 52 for uniformity */
  primaryButton: {
    height: 52,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  primaryButtonText: { color: "#000", fontSize: 16, fontWeight: "700" },
  googleButton: {
    height: 52,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  googleButtonText: { color: "#000", fontSize: 16, fontWeight: "700" },

  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 20 : 40,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: "#3A3A3C",
  },
  modalTitle: {
    color: "#FFF",
    fontSize: 18,
    fontWeight: "700",
  },
  modalCloseText: {
    color: "#32D74B",
    fontSize: 16,
    fontWeight: "600",
  },
  modalScrollContent: {
    padding: 24,
    paddingBottom: 60,
  },
  legalText: {
    color: "#D1D1D6",
    fontSize: 15,
    lineHeight: 24,
  },
  legalBold: {
    color: "#FFF",
    fontWeight: "700",
    fontSize: 16,
  },
});
