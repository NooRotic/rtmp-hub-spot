'use strict';

/**
 * Pure construction of the FFmpeg pipe arguments for one stream config. Holds no
 * fluent-ffmpeg / electron / singleton state so it can be unit-tested in
 * isolation — and so the Map<streamKey, Pipe> refactor reuses it unchanged,
 * guaranteeing the encoder/audio/output flags don't drift.
 *
 * Audio strategy:
 *  - 'feed-*' keys come from a peer's MediaRecorder (WebM with real Opus audio):
 *    encode that track to AAC, no injected source.
 *  - 'grid'/canvas keys come from canvas.captureStream() (video only): inject an
 *    infinite silent lavfi source as input 1 and map it, so RTMP clients (OBS,
 *    VLC) get a valid audio codec header and don't reject the stream.
 *
 * @param {object} opts
 * @param {string} [opts.hwAccel='none'] - 'nvidia' | 'amd' | 'intel' | 'none'
 * @param {string} [opts.streamKey='grid']
 * @param {string} [opts.bitrate='2500k']
 * @param {string} [opts.preset='ultrafast'] - libx264-only preset
 * @param {number} [opts.fps=30]
 * @param {number} opts.rtmpPort
 * @returns {object} structured ffmpeg invocation description
 */
function buildFfmpegArgs({
  hwAccel = 'none',
  streamKey = 'grid',
  bitrate = '2500k',
  preset = 'ultrafast',
  fps = 30,
  rtmpPort,
} = {}) {
  const accelFlags = hwAccel === 'nvidia' ? ['-hwaccel nvdec'] : [];

  const inputOptions = [
    '-probesize 5000000',      // 5 MB probe budget — keeps VP8 header parsing reliable
    '-analyzeduration 500000', // 0.5 s ceiling; probesize is the real guard
    '-fflags nobuffer+igndts+genpts',
    '-flags low_delay',
    '-err_detect ignore_err',  // tolerate minor stream errors without crashing
    ...accelFlags,
  ];

  let encoderOptions;
  if (hwAccel === 'nvidia') {
    encoderOptions = ['-vcodec h264_nvenc', `-b:v ${bitrate}`, '-preset:v p1', '-tune:v ll'];
  } else if (hwAccel === 'amd') {
    encoderOptions = ['-vcodec h264_amf', `-b:v ${bitrate}`, '-quality speed', '-rc cbr'];
  } else if (hwAccel === 'intel') {
    encoderOptions = ['-vcodec h264_qsv', `-b:v ${bitrate}`, '-preset:v veryfast'];
  } else {
    encoderOptions = ['-vcodec libx264', `-b:v ${bitrate}`, `-preset ${preset}`, '-tune zerolatency'];
  }

  const hasFeedAudio = streamKey.startsWith('feed-');
  const audioOutputOptions = hasFeedAudio
    ? ['-c:a aac', '-b:a 128k', '-ar 44100']
    : ['-map 0:v:0', '-map 1:a:0', '-c:a aac', '-b:a 32k', '-ac 2', '-ar 44100'];

  const outputOptions = [
    '-f flv',
    ...encoderOptions,
    '-pix_fmt yuv420p',
    '-g 30',
    `-r ${fps}`,
    '-flush_packets 1',
    ...audioOutputOptions,
  ];

  return {
    accelFlags,
    inputOptions,
    needsSilentAudio: !hasFeedAudio,
    silentAudioInput: 'aevalsrc=0:channel_layout=stereo:sample_rate=44100',
    encoderOptions,
    audioOutputOptions,
    outputOptions,
    outputUrl: `rtmp://localhost:${rtmpPort}/live/${streamKey}`,
  };
}

module.exports = { buildFfmpegArgs };
