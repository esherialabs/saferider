export interface ChatMessage {
  id: string;
  text: string;
  isUser: boolean;
  timestamp: Date;
}

export interface ChatState {
  messages: ChatMessage[];
  addMessage: (text: string, isUser: boolean) => void;
}