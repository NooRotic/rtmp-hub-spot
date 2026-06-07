import type { InputHTMLAttributes } from 'react';
import type { Tone } from './toneFor';

/** Dark inset input with a white highlight edge and a status-colored border. */
export function NTField({
  tone = 'idle',
  className,
  ...rest
}: { tone?: Tone } & InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`ntd-field ntd-field--${tone}${className ? ` ${className}` : ''}`} {...rest} />;
}
