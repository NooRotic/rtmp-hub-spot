import { toneFor } from './toneFor';

/**
 * Status pill with redundant encoding (border color + dot + text label) for
 * at-a-glance reading and color-vision accessibility (spec §3). Falls back to the
 * raw state string when no label is given.
 */
export function StatusTag({ state, label }: { state: string; label?: string }) {
  const tone = toneFor(state);
  return (
    <span className={`ntd-tag ntd-tag--${tone}`} data-tone={tone}>
      <span className={`ntd-dot ntd-dot--${tone}`} aria-hidden="true" />
      {label ?? state}
    </span>
  );
}
