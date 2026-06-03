'use strict';

/**
 * Returns true for loopback hosts whose self-signed certificates this app trusts:
 * the HTTPS signaling server and the Vite dev server both serve self-signed certs
 * on localhost. Used by the session certificate-verify proc so that ALL requests
 * are covered — crucially including the renderer's `wss://localhost` Socket.IO
 * connection, which `app.on('certificate-error')` does not reliably handle.
 *
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopbackHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

module.exports = { isLoopbackHost };
