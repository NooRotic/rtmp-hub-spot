import ChatBox from '../../components/ChatBox';

interface ChatMsg {
  senderName: string;
  message: string;
  timestamp: number;
}

/** Chat docked into the bottom zone beside the Broadcast Console (NOT an overlay).
 *  Visibility is the top-bar 💬 toggle (collapse via the header button or 💬);
 *  the unread badge is handled by useChatUnread while collapsed. */
export function ChatPanel({
  messages,
  onSendMessage,
  onClose,
}: {
  messages: ChatMsg[];
  onSendMessage: (msg: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="ntd ntd-chatdock">
      <div className="ntd-chatdock__head">
        <span>Global Network Chat</span>
        <button className="ntd-btn" onClick={onClose} title="Collapse chat" aria-label="Collapse chat">–</button>
      </div>
      <div className="ntd-chatdock__body">
        <ChatBox messages={messages} onSendMessage={onSendMessage} />
      </div>
    </div>
  );
}
