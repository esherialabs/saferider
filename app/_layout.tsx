import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { ErrorBoundary } from "./error-boundary";
import Colors from "@/constants/colors";
import CustomSplashScreen from "@/components/SplashScreen";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    ...FontAwesome.font,
  });
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    if (error) {
      console.error(error);
      throw error;
    }
  }, [error]);

  useEffect(() => {
    if (loaded) {
      // Hide the native splash screen
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  const handleSplashFinish = () => {
    setShowSplash(false);
  };

  if (!loaded) {
    return null;
  }

  if (showSplash) {
    return <CustomSplashScreen onFinish={handleSplashFinish} />;
  }

  return (
    <ErrorBoundary>
      <RootLayoutNav />
    </ErrorBoundary>
  );
}

function RootLayoutNav() {
  return (
    <Stack
      screenOptions={{
        headerBackTitle: "Back",
        headerStyle: {
          backgroundColor: Colors.dark.background,
        },
        headerTintColor: Colors.dark.text,
        headerTitleStyle: {
          fontWeight: 'bold',
        },
        contentStyle: {
          backgroundColor: Colors.dark.background,
        },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen 
        name="report" 
        options={{ 
          title: "Report Emergency",
          presentation: "modal",
          headerStyle: {
            backgroundColor: Colors.dark.dangerStatus,
          },
        }} 
      />
      <Stack.Screen 
        name="add-contact" 
        options={{ 
          title: "Add Contact",
          presentation: "modal",
        }} 
      />
      <Stack.Screen 
        name="report-incident" 
        options={{ 
          headerShown: false,
        }} 
      />
      <Stack.Screen 
        name="report-incident/step2" 
        options={{ 
          headerShown: false,
        }} 
      />
      <Stack.Screen 
        name="report-incident/step3" 
        options={{ 
          headerShown: false,
        }} 
      />
    </Stack>
  );
}