import { toneFor } from './toneFor';

/** A small colored status dot. `state` is any relay/ffmpeg/binding state string. */
export function StatusDot({ state }: { state: string }) {
  const tone = toneFor(state);
  return <span className={`ntd-dot ntd-dot--${tone}`} data-tone={tone} aria-hidden="true" />;
}
