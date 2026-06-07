import type { Platform } from '../../../shared';

export interface PlatformInfo {
  label: string;
  /** Prefilled RTMP/RTMPS ingest URL (empty for dashboard-provided platforms). */
  ingestUrl: string;
  hint: string;
}

/** Platform ingest reference (spec §8). RTMP publish = {ingest}/{app}/{streamKey}. */
export const PLATFORM_INFO: Record<Platform, PlatformInfo> = {
  youtube: { label: 'YouTube', ingestUrl: 'rtmp://a.rtmp.youtube.com/live2', hint: 'Stream key from YouTube Studio → Go Live.' },
  twitch: { label: 'Twitch', ingestUrl: 'rtmp://live.twitch.tv/app', hint: '⚠ 6000 kbps cap. Use a regional ingest for best results.' },
  kick: { label: 'Kick', ingestUrl: '', hint: 'Copy the RTMP ingest URL + key from your Kick dashboard.' },
  tiktok: { label: 'TikTok', ingestUrl: '', hint: 'Access-gated; URL + key from TikTok Live Studio.' },
  facebook: { label: 'Facebook', ingestUrl: 'rtmps://live-api-s.facebook.com:443/rtmp', hint: 'RTMPS required (FFmpeg handles it).' },
  custom: { label: 'Custom', ingestUrl: '', hint: 'Enter your RTMP/RTMPS ingest URL.' },
};

export const PLATFORMS = Object.keys(PLATFORM_INFO) as Platform[];

export function platformInfo(platform: Platform): PlatformInfo {
  return PLATFORM_INFO[platform];
}
