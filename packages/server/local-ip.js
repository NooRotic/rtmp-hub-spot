const os = require('os');

/**
 * Interface-name patterns for virtual / host-only adapters that must NEVER be
 * advertised to LAN clients. Their addresses (e.g. Hyper-V's 172.x "Default
 * Switch", WSL, Docker bridges) are unreachable from other devices, yet their
 * names contain substrings like "Ethernet" that a naive `name.includes('Ethernet')`
 * match would wrongly select — which made the server hand out an RTMP/host IP that
 * VLC and remote browsers on the LAN could not reach.
 */
const VIRTUAL_IFACE = /vEthernet|Hyper-V|Default Switch|\bWSL\b|Docker|VMware|VirtualBox|VPN|TAP-|Loopback|Tailscale|ZeroTier|Npcap|Bluetooth/i;

/**
 * Choose the LAN IPv4 address to advertise to clients (the RTMP pull URL and the
 * host shown in the UI). Skips virtual/host-only adapters, then prefers physical
 * interfaces in priority order (Ethernet, then Wi-Fi, then any other external
 * IPv4). Falls back to 127.0.0.1 when nothing qualifies.
 *
 * Unlike the previous inline scan, preference is applied by PRIORITY rather than
 * OS interface-iteration order, so a wired Ethernet address always wins over
 * Wi-Fi regardless of how `os.networkInterfaces()` happens to order them.
 *
 * @param {ReturnType<typeof os.networkInterfaces>} [networkInterfaces] - defaults to os.networkInterfaces()
 * @param {string[]} [preferred] - interface-name substrings to prefer, highest priority first
 * @returns {string} the chosen IPv4 address, or '127.0.0.1' if none found
 */
function pickLocalIP(networkInterfaces = os.networkInterfaces(), preferred = ['Ethernet', 'Wi-Fi', 'en0', 'wlan0']) {
  const candidates = [];
  for (const name in networkInterfaces) {
    if (VIRTUAL_IFACE.test(name)) continue; // never advertise a virtual/host-only adapter
    for (const iface of networkInterfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({ name, address: iface.address });
      }
    }
  }

  for (const pref of preferred) {
    const hit = candidates.find((c) => c.name.includes(pref));
    if (hit) return hit.address;
  }
  return candidates.length ? candidates[0].address : '127.0.0.1';
}

module.exports = { pickLocalIP, VIRTUAL_IFACE };
