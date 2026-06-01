import React, { useState, useEffect } from "react";
import {
  NavigationContainer,
  DarkTheme,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { View, ActivityIndicator, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as Notifications from "expo-notifications";

import { onAuthStateChanged, User } from "firebase/auth";
import { auth, db } from "./src/config/firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import { syncEverythingWithCloud } from "./src/utils/firebaseSync";
import { Colors, Shadows } from "./src/theme";

import LoginScreen from "./src/screens/LoginScreen";
import InitialSetupScreen from "./src/screens/InitialSetupScreen";
import HomeScreen from "./src/screens/HomeScreen";
import WorkoutScreen from "./src/screens/WorkoutScreen";
import HistoryScreen from "./src/screens/HistoryScreen";
import ProgressStatsScreen from "./src/screens/ProgressStatsScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import TemplatesScreen from "./src/screens/TemplatesScreen";
import EditTemplateScreen from "./src/screens/EditTemplateScreen";
import ManageExercisesScreen from "./src/screens/ManageExercisesScreen";
import SearchScreen from "./src/screens/SearchScreen";
import OnboardingGuide from "./src/components/OnboardingGuide";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef<any>();

const MyDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.background,
  },
};

function MainTabs() {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(
    insets.bottom,
    Platform.OS === "android" ? 12 : 8,
  );
  const tabBarHeight = 62 + bottomInset;

  return (
    <Tab.Navigator
      initialRouteName="HomeTab"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          backgroundColor: Colors.tabBar,
          borderTopColor: Colors.card,
          borderTopWidth: 1,
          height: tabBarHeight,
          paddingTop: 8,
          paddingBottom: bottomInset,
          ...Shadows.tabBar,
        },
        tabBarItemStyle: {
          minHeight: 52,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          lineHeight: 13,
          fontWeight: "800",
          marginTop: 1,
        },
        tabBarIcon: ({ color, focused, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = "home";

          if (route.name === "HomeTab") {
            iconName = focused ? "home" : "home-outline";
          } else if (route.name === "History") {
            iconName = focused ? "time" : "time-outline";
          } else if (route.name === "Templates") {
            iconName = focused ? "clipboard" : "clipboard-outline";
          } else if (route.name === "ExerciseLibrary") {
            iconName = focused ? "barbell" : "barbell-outline";
          } else if (route.name === "Settings") {
            iconName = focused ? "settings" : "settings-outline";
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{ title: "Home", tabBarLabel: "Home" }}
      />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Templates" component={TemplatesScreen} />
      <Tab.Screen
        name="ExerciseLibrary"
        component={ManageExercisesScreen}
        options={{ title: "Exercises", tabBarLabel: "Exercises" }}
      />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isFirstTime, setIsFirstTime] = useState(true);

  const handleRestTimerNotificationPress = async (
    response: Notifications.NotificationResponse,
  ) => {
    const data = response.notification.request.content.data || {};
    if (data.type !== "REST_TIMER_COMPLETE") return;

    const notificationId = response.notification.request.identifier;
    try {
      await Notifications.dismissNotificationAsync(notificationId);
      await Notifications.dismissAllNotificationsAsync();
    } catch (error) {
      console.log("Unable to clear rest timer notification:", error);
    }

    if (navigationRef.isReady()) {
      navigationRef.navigate("Workout");
    }
  };

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      handleRestTimerNotificationPress,
    );

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleRestTimerNotificationPress(response);
      })
      .catch((error) => {
        console.log("Unable to read last notification response:", error);
      });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authenticatedUser) => {
      if (authenticatedUser) {
        const setupComplete = await AsyncStorage.getItem(
          `@setup_complete_${authenticatedUser.uid}`,
        );

        if (setupComplete === "true") {
          setIsFirstTime(false);
          syncEverythingWithCloud().catch((error) => {
            console.log("Background full app sync skipped:", error);
          });
        } else {
          try {
            const userRef = doc(db, "users", authenticatedUser.uid);
            const userSnap = await getDoc(userRef);

            if (userSnap.exists() && userSnap.data().username) {
              await AsyncStorage.setItem(
                `@setup_complete_${authenticatedUser.uid}`,
                "true",
              );
              setIsFirstTime(false);
              syncEverythingWithCloud().catch((error) => {
                console.log("Background full app sync skipped:", error);
              });
            } else {
              setIsFirstTime(true);
            }
          } catch (error) {
            console.log("Error checking cloud status:", error);
            setIsFirstTime(true);
          }
        }
      }

      setUser(authenticatedUser);
      if (initializing) setInitializing(false);
    });
    return unsubscribe;
  }, [initializing]);

  if (initializing) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          backgroundColor: Colors.background,
        }}
      >
        <ActivityIndicator size="large" color="#32D74B" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <NavigationContainer ref={navigationRef} theme={MyDarkTheme}>
          <Stack.Navigator
            screenOptions={{
              contentStyle: { backgroundColor: Colors.background },
              headerShown: false,
            }}
          >
            {user && user.emailVerified ? (
              <>
                {isFirstTime ? (
                  <Stack.Screen
                    name="InitialSetup"
                    component={InitialSetupScreen}
                    initialParams={{ onFinish: () => setIsFirstTime(false) }}
                  />
                ) : (
                  <>
                    <Stack.Screen
                      name="Home"
                      component={MainTabs}
                      options={{ gestureEnabled: false }}
                    />
                    <Stack.Screen
                      name="Workout"
                      component={WorkoutScreen}
                      options={{ gestureEnabled: false }}
                    />
                    <Stack.Screen
                      name="ProgressStats"
                      component={ProgressStatsScreen}
                      options={{
                        gestureEnabled: true,
                        gestureDirection: "horizontal",
                      }}
                    />
                    <Stack.Screen
                      name="EditTemplate"
                      component={EditTemplateScreen}
                      options={{
                        gestureEnabled: true,
                        gestureDirection: "horizontal",
                      }}
                    />
                    <Stack.Screen
                      name="Search"
                      component={SearchScreen}
                      options={{
                        presentation: "card",
                        gestureEnabled: true,
                        gestureDirection: "horizontal",
                      }}
                    />
                    <Stack.Screen
                      name="OnboardingGuide"
                      component={OnboardingGuide}
                      options={{
                        gestureEnabled: true,
                        gestureDirection: "horizontal",
                      }}
                    />
                  </>
                )}
              </>
            ) : (
              <Stack.Screen name="Login" component={LoginScreen} />
            )}
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
