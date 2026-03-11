/**
 * Message creation and manipulation utilities
 * Provides helper functions for creating and updating message objects
 */

// Module-level sequence counter to avoid ID collisions when multiple
// notifications are created within the same millisecond.
let _notifSeq = 0;

export interface AttachmentMeta {
  file: File;
  dataUrl: string;
  type: string;
}

export interface ContentSegment {
  type: string;
  content: string;
  [key: string]: unknown;
}

export interface UserMessage {
  id: string;
  role: 'user';
  content: string;
  contentType: string;
  timestamp: Date;
  isStreaming: boolean;
  attachments?: AttachmentMeta[];
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  content: string;
  contentType: string;
  timestamp: Date;
  isStreaming: boolean;
  contentSegments: ContentSegment[];
  reasoningProcesses: Record<string, unknown>;
  toolCallProcesses: Record<string, unknown>;
  todoListProcesses: Record<string, unknown>;
}

export type NotificationVariant = 'info' | 'success' | 'warning';

export interface NotificationMessage {
  id: string;
  role: 'notification';
  content: string;
  variant: NotificationVariant;
  timestamp: Date;
}

export type ChatMessage = UserMessage | AssistantMessage | NotificationMessage;

/**
 * Creates a user message object
 */
export function createUserMessage(message: string, attachments: AttachmentMeta[] | null = null): UserMessage {
  const msg: UserMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    content: message,
    contentType: 'text',
    timestamp: new Date(),
    isStreaming: false,
  };
  if (attachments && attachments.length > 0) {
    msg.attachments = attachments;
  }
  return msg;
}

/**
 * Creates an assistant message placeholder
 */
export function createAssistantMessage(messageId: string | null = null): AssistantMessage {
  const id = messageId || `assistant-${Date.now()}`;
  return {
    id,
    role: 'assistant',
    content: '',
    contentType: 'text',
    timestamp: new Date(),
    isStreaming: true,
    contentSegments: [],
    reasoningProcesses: {},
    toolCallProcesses: {},
    todoListProcesses: {},
  };
}

/**
 * Updates a specific message in the messages array
 */
export function updateMessage(
  messages: ChatMessage[],
  messageId: string,
  updater: (msg: ChatMessage) => ChatMessage,
): ChatMessage[] {
  return messages.map((msg) => {
    if (msg.id !== messageId) return msg;
    return updater(msg);
  });
}

/**
 * Inserts a message at a specific index in the messages array
 */
export function insertMessage(
  messages: ChatMessage[],
  insertIndex: number,
  newMessage: ChatMessage,
): ChatMessage[] {
  return [
    ...messages.slice(0, insertIndex),
    newMessage,
    ...messages.slice(insertIndex),
  ];
}

/**
 * Appends a message to the end of the messages array
 */
export function appendMessage(messages: ChatMessage[], newMessage: ChatMessage): ChatMessage[] {
  return [...messages, newMessage];
}

/**
 * Creates a notification message for inline dividers (e.g. summarization, offload)
 */
export function createNotificationMessage(text: string, variant: NotificationVariant = 'info'): NotificationMessage {
  return {
    id: `notification-${Date.now()}-${_notifSeq++}`,
    role: 'notification',
    content: text,
    variant,
    timestamp: new Date(),
  };
}
