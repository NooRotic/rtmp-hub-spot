'use strict';

/**
 * Pure construction of the FFmpeg relay arguments: pull one stream from the
 * local NMS and copy it (no re-encode) to an external RTMP destination. Mirror
 * of buildFfmpegArgs for the copy-relay path; holds no fluent-ffmpeg/electron/
 * singleton state so it unit-tests in isolation.
 *
 * @param {object} opts
 * @param {string} opts.sourceKey - local NMS stream to relay (e.g. 'grid')
 * @param {{url:string, streamKey:string}} opts.destination - external target
 * @param {number} opts.rtmpPort - local NMS RTMP port
 * @returns {{inputUrl:string, inputOptions:string[], outputOptions:string[], outputUrl:string}}
 */
function buildRelayArgs({ sourceKey, destination, rtmpPort }) {
  const inputUrl = `rtmp://localhost:${rtmpPort}/live/${sourceKey}`;
  const inputOptions = ['-fflags nobuffer', '-flags low_delay'];
  const outputOptions = ['-c copy', '-f flv', '-flush_packets 1'];
  const base = destination.url.replace(/\/+$/, '');
  const outputUrl = `${base}/${destination.streamKey}`;
  return { inputUrl, inputOptions, outputOptions, outputUrl };
}

module.exports = { buildRelayArgs };
