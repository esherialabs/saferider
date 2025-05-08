import React from "react";
import { Tabs } from "expo-router";
import { Info, FileText, Settings, MessageCircle } from "lucide-react-native";
import Colors from "@/constants/colors";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.dark.tabIconSelected,
        tabBarInactiveTintColor: Colors.dark.tabIconDefault,
        tabBarStyle: {
          backgroundColor: Colors.dark.tabBar,
          borderTopWidth: 0,
          elevation: 0,
          height: 60,
          paddingBottom: 8,
        },
        headerStyle: {
          backgroundColor: Colors.dark.background,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 0,
        },
        headerTitleStyle: {
          fontWeight: 'bold',
          color: Colors.dark.text,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarLabel: "Dashboard",
          tabBarIcon: ({ color }) => <Info size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarLabel: "History",
          tabBarIcon: ({ color }) => <FileText size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Legal Aid",
          tabBarLabel: "Chat",
          tabBarIcon: ({ color }) => <MessageCircle size={24} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => <Settings size={24} color={color} />,
        }}
      />
    </Tabs>
  );
}