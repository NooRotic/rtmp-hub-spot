import { BroadcastConsole } from '../console/BroadcastConsole';
import { ChatPanel } from '../drawers/ChatPanel';

interface ChatMsg {
  senderName: string;
  message: string;
  timestamp: number;
}

export interface ConsoleZoneProps {
  /** The persistent broadcast console reads its data from AdminDataProvider context. */
  chatOpen: boolean;
  chatMessages: ChatMsg[];
  onSendMessage: (msg: string) => void;
  onCloseChat: () => void;
}

/**
 * ZONE 3 — the persistent BroadcastConsole + the docked ChatPanel (chatOpen-gated),
 * side by side. Pure presentational extraction; markup/styles verbatim.
 */
export function ConsoleZone({ chatOpen, chatMessages, onSendMessage, onCloseChat }: ConsoleZoneProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', overflow: 'hidden' }}>
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <BroadcastConsole />
      </div>
      {chatOpen && (
        <ChatPanel
          messages={chatMessages}
          onSendMessage={onSendMessage}
          onClose={onCloseChat}
        />
      )}
    </div>
  );
}
