export type Tone = 'live' | 'warn' | 'error' | 'idle';

/**
 * Collapse any relay/ffmpeg/binding state string to one of four UI tones
 * (single source of status→color for the dark-NT primitives, spec §3).
 */
export function toneFor(state: string): Tone {
  switch (state) {
    case 'live':
    case 'running':
      return 'live';
    case 'connecting':
    case 'starting':
    case 'reconnecting':
      return 'warn';
    case 'error':
      return 'error';
    default:
      return 'idle'; // idle, stopped, disabled, unknown
  }
}
