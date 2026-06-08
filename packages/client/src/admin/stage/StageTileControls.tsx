/**
 * StageTileControls — per-tile overlay buttons for stage video tiles.
 *
 * Exposes:
 *   ★  Spotlight  — toggle this peer as the spotlighted (featured) feed
 *   ✕  Kick       — remove this peer from the session (HOST-ONLY, hidden when isHost=false)
 *
 * 🔇 Mute is intentionally OMITTED: isAudioEnabled/setIsAudioEnabled in the codebase
 * are self-mute controls (the admin's own mic), not per-peer server-side mutes.
 * There is no per-peer mute mechanism to wire. If one is added later, add an
 * optional `onMute?: (id: string) => void` prop and restore the button here.
 */

interface StageTileControlsProps {
  peerId: string;
  isHost: boolean;
  spotlighted: boolean;
  onSpotlight: (id: string) => void;
  onKick: (id: string) => void;
}

export function StageTileControls({
  peerId,
  isHost,
  spotlighted,
  onSpotlight,
  onKick,
}: StageTileControlsProps) {
  return (
    <div className="ntd-tile-controls" style={{ display: 'flex', gap: 4 }}>
      <button
        title="Spotlight"
        onClick={() => onSpotlight(peerId)}
        style={{
          fontSize: 10,
          padding: '1px 4px',
          cursor: 'pointer',
          background: spotlighted ? 'var(--ntd-navy-b)' : 'var(--ntd-face-2)',
          color: spotlighted ? '#fff' : 'var(--ntd-text)',
          border: '1px solid var(--ntd-sh)',
        }}
      >
        ★
      </button>
      {isHost && (
        <button
          title="Remove from session"
          onClick={() => onKick(peerId)}
          style={{
            fontSize: 10,
            padding: '1px 4px',
            cursor: 'pointer',
            background: '#ff000022',
            color: 'var(--ntd-error)',
            border: '1px solid var(--ntd-error)',
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
