import { NTDrawer } from '../../ui/NTDrawer';
import ChatBox from '../../components/ChatBox';

interface ChatMsg {
  senderName: string;
  message: string;
  timestamp: number;
}

export function ChatDrawer({
  open,
  onClose,
  messages,
  onSendMessage,
}: {
  open: boolean;
  onClose: () => void;
  messages: ChatMsg[];
  onSendMessage: (msg: string) => void;
}) {
  return (
    <NTDrawer open={open} title="Global Network Chat" onClose={onClose}>
      <ChatBox messages={messages} onSendMessage={onSendMessage} />
    </NTDrawer>
  );
}
