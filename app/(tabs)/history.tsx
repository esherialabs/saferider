import React from 'react';
import { StyleSheet, FlatList, SafeAreaView, Text, View } from 'react-native';
import { useSafetyStore } from '@/store/safetyStore';
import HistoryItem from '@/components/HistoryItem';
import Colors from '@/constants/colors';

export default function HistoryScreen() {
  const { history } = useSafetyStore();
  
  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={history}
        renderItem={({ item }) => <HistoryItem item={item} />}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No history yet</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  listContent: {
    padding: 16,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    color: Colors.dark.tabIconDefault,
    fontSize: 16,
    textAlign: 'center',
  },
});