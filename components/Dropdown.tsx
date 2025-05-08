import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  Modal, 
  FlatList, 
  SafeAreaView 
} from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import Colors from '@/constants/colors';

interface DropdownOption {
  id: string;
  label: string;
}

interface DropdownProps {
  options: DropdownOption[];
  selectedOption?: DropdownOption;
  onSelect: (option: DropdownOption) => void;
  placeholder?: string;
}

export default function Dropdown({ 
  options, 
  selectedOption, 
  onSelect, 
  placeholder = 'Select an option' 
}: DropdownProps) {
  const [modalVisible, setModalVisible] = useState(false);
  
  const toggleModal = () => {
    setModalVisible(!modalVisible);
  };
  
  const handleSelect = (option: DropdownOption) => {
    onSelect(option);
    toggleModal();
  };
  
  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={styles.dropdownButton} 
        onPress={toggleModal}
        activeOpacity={0.7}
      >
        <Text style={[
          styles.selectedText,
          !selectedOption && styles.placeholderText
        ]}>
          {selectedOption ? selectedOption.label : placeholder}
        </Text>
        <ChevronDown size={20} color={Colors.dark.text} />
      </TouchableOpacity>
      
      <Modal
        visible={modalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={toggleModal}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{placeholder}</Text>
              <TouchableOpacity onPress={toggleModal}>
                <Text style={styles.closeButton}>Close</Text>
              </TouchableOpacity>
            </View>
            
            <FlatList
              data={options}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.optionItem,
                    selectedOption?.id === item.id && styles.selectedOption
                  ]}
                  onPress={() => handleSelect(item)}
                >
                  <Text 
                    style={[
                      styles.optionText,
                      selectedOption?.id === item.id && styles.selectedOptionText
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              )}
              contentContainerStyle={styles.optionsList}
            />
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.dark.text,
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  selectedText: {
    color: Colors.dark.background,
    fontSize: 16,
  },
  placeholderText: {
    color: '#9CA3AF',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: Colors.dark.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  modalTitle: {
    color: Colors.dark.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeButton: {
    color: Colors.dark.accent,
    fontSize: 16,
  },
  optionsList: {
    paddingBottom: 24,
  },
  optionItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  selectedOption: {
    backgroundColor: 'rgba(46, 91, 255, 0.1)',
  },
  optionText: {
    color: Colors.dark.text,
    fontSize: 16,
  },
  selectedOptionText: {
    color: Colors.dark.accent,
    fontWeight: 'bold',
  },
});