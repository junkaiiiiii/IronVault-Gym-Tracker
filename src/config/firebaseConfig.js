import { initializeApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import AsyncStorage from "@react-native-async-storage/async-storage";

const firebaseConfig = {
  apiKey: "AIzaSyCjdRQdgfwgFk0n7is8isGBqnD4j2pNQIY",
  authDomain: "gymtracker-128ca.firebaseapp.com",
  projectId: "gymtracker-128ca",
  storageBucket: "gymtracker-128ca.firebasestorage.app",
  messagingSenderId: "1077182608968",
  appId: "1:1077182608968:web:25cdffe6b7555666440a7d",
  measurementId: "G-T71W70H1MG",
};

const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const db = getFirestore(app);
