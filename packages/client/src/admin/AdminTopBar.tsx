import { useAdminData } from './AdminDataProvider';
import { serverRollup } from './serverRollup';
import { StatusDot } from '../ui/StatusDot';
import { NTButton } from '../ui/NTButton';
import { clientJoinUrl } from './clientUrl';

interface AdminTopBarProps {
  onSettings: () => void;
  onChat: () => void;
  onRecordings: () => void;
  onAddFeed: () => void;
  chatUnread?: number;
}

/**
 * Global status bar (left = ServerStatusBar content verbatim) + right-aligned
 * action cluster (Settings / Chat / Recordings / Add Feed toggles).
 * Standalone — not yet wired into AdminApp; a later task swaps it in.
 */
export function AdminTopBar({ onSettings, onChat, onRecordings, onAddFeed, chatUnread = 0 }: AdminTopBarProps) {
  const { socketStatus, isConnected, serverStatus, sources, relays, roomAccess } = useAdminData();
  const { liveSources, activeDestinations } = serverRollup(sources, relays);

  const signalState = isConnected ? 'live' : socketStatus === 'connecting' ? 'connecting' : 'error';
  const joinUrl = clientJoinUrl(serverStatus?.local, window.location);

  return (
    <div className="ntd ntd-statusbar">
      {/* ── LEFT: reproduced verbatim from ServerStatusBar ── */}
      <span className="ntd-statusbar__item">
        <StatusDot state={signalState} />
        <span className="ntd-statusbar__label">Signaling</span>
      </span>
      <span className="ntd-statusbar__item">
        <span className="ntd-statusbar__label">IP</span> {serverStatus?.local ?? '—'}
      </span>
      {joinUrl && (
        <span className="ntd-statusbar__item">
          <span className="ntd-statusbar__label">Join</span>
          <code className="ntd-statusbar__join">{joinUrl}</code>
          <span title={roomAccess.locked ? 'Room locked — PIN required' : 'Room open'}>
            {roomAccess.locked ? '🔒' : '🔓'}
          </span>
        </span>
      )}
      <span className="ntd-statusbar__item">
        <span className="ntd-statusbar__label">Clients</span> {serverStatus?.clientCount ?? 0}
      </span>
      <span className="ntd-statusbar__item">
        <span className="ntd-statusbar__label">Publishers</span> {serverStatus?.rtmpCount ?? 0}
      </span>
      <span className="ntd-statusbar__rollup">
        <StatusDot state={liveSources > 0 ? 'live' : 'idle'} />
        {liveSources} sources → {activeDestinations} destinations
      </span>

      {/* ── RIGHT: action cluster ── */}
      <div className="ntd-topbar__actions">
        <NTButton onClick={onAddFeed} title="Add RTMP feed">＋ Feed</NTButton>
        <NTButton onClick={onRecordings} title="Recordings">📁</NTButton>
        <span className="ntd-topbar__btn">
          <NTButton onClick={onChat} title="Chat">💬</NTButton>
          {chatUnread > 0 && <span className="ntd-topbar__badge">{chatUnread}</span>}
        </span>
        <NTButton onClick={onSettings} title="Settings">⚙</NTButton>
      </div>
    </div>
  );
}
