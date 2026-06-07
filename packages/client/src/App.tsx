import { isElectron } from './hooks/useElectronBridge';
import AdminApp from './AdminApp';
import { ClientPortal } from './ClientPortal';

// RtmpPlayerTile/localFlvUrl re-exported here for back-compat (App.rtmp-preview.test imports from './App').
export { RtmpPlayerTile, localFlvUrl } from './components/RtmpPlayerTile';

/**
 * Determines whether the current session is an admin/host session.
 * True when running inside Electron OR when the browser URL carries ?role=admin.
 * Uses the same criteria as AdminApp's internal `isAdminMode`.
 */
function isAdminRole(): boolean {
  if (isElectron) return true;
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('role') === 'admin';
}

/**
 * Top-level mode router.
 * Admin/Electron → <AdminApp /> (full broadcast console)
 * Browser participant → <ClientPortal /> (join flow + participant view)
 */
export default function App() {
  return isAdminRole() ? <AdminApp /> : <ClientPortal />;
}
