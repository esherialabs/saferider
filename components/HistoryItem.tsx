import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { HistoryItem as HistoryItemType } from '@/types';
import Colors from '@/constants/colors';

interface HistoryItemProps {
  item: HistoryItemType;
}

export default function HistoryItem({ item }: HistoryItemProps) {
  const getStatusColor = () => {
    switch (item.status) {
      case 'safe':
        return Colors.dark.safeStatus;
      case 'warning':
        return Colors.dark.warningStatus;
      case 'danger':
        return Colors.dark.dangerStatus;
      default:
        return Colors.dark.safeStatus;
    }
  };
  
  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  
  return (
    <View style={styles.container}>
      <View style={[styles.statusIndicator, { backgroundColor: getStatusColor() }]} />
      <View style={styles.content}>
        <Text style={styles.date}>{formatDate(item.date)}</Text>
        <Text style={styles.description}>{item.description}</Text>
        {item.location && <Text style={styles.location}>{item.location}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: Colors.dark.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
    marginTop: 4,
  },
  content: {
    flex: 1,
  },
  date: {
    color: Colors.dark.tabIconDefault,
    fontSize: 12,
    marginBottom: 4,
  },
  description: {
    color: Colors.dark.text,
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  location: {
    color: Colors.dark.tabIconDefault,
    fontSize: 14,
  },
});