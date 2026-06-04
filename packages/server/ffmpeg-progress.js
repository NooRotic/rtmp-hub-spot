'use strict';

/**
 * Pure parser for FFmpeg's periodic stderr progress line. Shared by pipe-manager
 * (source encode) and relay-manager (copy relay) so the regex lives in exactly
 * one place. Also captures the optional `drop=` field, which appears when an
 * output can't keep up — the key "falling behind" signal for relays.
 *
 * Lines with non-numeric bitrate/speed (e.g. 'bitrate=N/A', 'speed=N/Ax', emitted briefly at startup or during a full stall) do not match and return null by design — this preserves pipe-manager's prior behavior.
 *
 * @param {string} line - one stderr line from ffmpeg
 * @returns {null | {frame:number, fps:number, size:string, time:string,
 *                   bitrate:string, speed:number, droppedFrames:(number|undefined)}}
 */
function parseFfmpegProgress(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(
    /frame=\s*(\d+)\s+fps=\s*([\d.]+).*?size=\s*([\d.]+\s*\w+).*?time=([\d:.]+).*?bitrate=\s*([\d.]+\s*\S+).*?speed=\s*([\d.]+)x/,
  );
  if (!m) return null;
  const drop = line.match(/drop=\s*(\d+)/);
  return {
    frame: parseInt(m[1], 10),
    fps: parseFloat(m[2]),
    size: m[3].trim(),
    time: m[4],
    bitrate: m[5].trim(),
    speed: parseFloat(m[6]),
    droppedFrames: drop ? parseInt(drop[1], 10) : undefined,
  };
}

module.exports = { parseFfmpegProgress };
