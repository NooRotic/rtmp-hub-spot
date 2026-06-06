import { useAdminData } from './AdminDataProvider';
import { serverRollup } from './serverRollup';
import { StatusDot } from '../ui/StatusDot';

/** L1 server status strip (spec §4). Always visible; consumes useAdminData. */
export function ServerStatusBar() {
  const { socketStatus, isConnected, serverStatus, sources, relays } = useAdminData();
  const { liveSources, activeDestinations } = serverRollup(sources, relays);

  const signalState = isConnected ? 'live' : socketStatus === 'connecting' ? 'connecting' : 'error';

  return (
    <div className="ntd ntd-statusbar">
      <span className="ntd-statusbar__item">
        <StatusDot state={signalState} />
        <span className="ntd-statusbar__label">Signaling</span>
      </span>
      <span className="ntd-statusbar__item">
        <span className="ntd-statusbar__label">IP</span> {serverStatus?.local ?? '—'}
      </span>
      <span className="ntd-statusbar__item">
        <span className="ntd-statusbar__label">Clients</span> {serverStatus?.clientCount ?? 0}
      </span>
      <span className="ntd-statusbar__item">
        <span className="ntd-statusbar__label">Publishers</span> {serverStatus?.rtmpCount ?? 0}
      </span>
      <span className="ntd-statusbar__rollup">
        <StatusDot state={liveSources > 0 ? 'live' : 'idle'} />
        {liveSources} sources → {activeDestinations} destinations
      </span>
    </div>
  );
}
