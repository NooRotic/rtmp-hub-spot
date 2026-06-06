import React, { useState } from 'react';

interface ChatBoxProps {
  messages: { senderName: string, message: string, timestamp: number }[];
  onSendMessage: (msg: string) => void;
}

const ChatBox: React.FC<ChatBoxProps> = ({ messages, onSendMessage }) => {
  const [text, setText] = useState('');

  const handleSend = () => {
    if (text.trim()) {
      onSendMessage(text);
      setText('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend();
  };

  return (
    <div className="window chat-window ntd">
      <div className="window-title">
        <span>Global Network Chat</span>
      </div>
      <div className="window-content" style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '5px' }}>
        <div className="chat-log inset-field">
          {messages.map((m, i) => (
            <div key={i}>
              <span style={{ color: 'var(--ntd-navy-b)', fontWeight: 'bold' }}>[{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]</span>
              {' '}
              <span style={{ fontWeight: 'bold' }}>{m.senderName}:</span> {m.message}
            </div>
          ))}
          {messages.length === 0 && <div style={{ color: 'var(--ntd-text-dim)', fontStyle: 'italic' }}>Waiting for messages...</div>}
        </div>
        <div className="chat-input-area">
          <input 
            className="inset-field" 
            style={{ flex: 1 }} 
            value={text} 
            onChange={(e) => setText(e.target.value)} 
            onKeyPress={handleKeyPress}
            placeholder="Type message..."
          />
          <button className="ntd-btn" onClick={handleSend} style={{ padding: '0 10px' }}>SEND</button>
        </div>
      </div>
    </div>
  );
};

export default ChatBox;
