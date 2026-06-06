import { useState } from 'react';
import { NTWindow } from '../ui/NTWindow';
import { LiveTab } from './tabs/LiveTab';
import { RecordingsTab } from './tabs/RecordingsTab';
import { SettingsTab } from './tabs/SettingsTab';
import { DestinationsTab } from './tabs/DestinationsTab';

type TabKey = 'live' | 'destinations' | 'recordings' | 'settings';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'live', label: 'Live' },
  { key: 'destinations', label: 'Destinations' },
  { key: 'recordings', label: 'Recordings' },
  { key: 'settings', label: 'Settings' },
];

/** Dark-NT tabbed admin workspace (spec §4). Each tab reads its slice of useAdminData. */
export function AdminWorkspace() {
  const [active, setActive] = useState<TabKey>('live');
  return (
    <NTWindow title="Workspace" className="ntd">
      <div className="ntd-tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`ntd-tab${active === t.key ? ' ntd-tab--active' : ''}`}
            onClick={() => setActive(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ntd-tabpanel">
        {active === 'live' && <LiveTab />}
        {active === 'recordings' && <RecordingsTab />}
        {active === 'settings' && <SettingsTab />}
        {active === 'destinations' && <DestinationsTab />}
      </div>
    </NTWindow>
  );
}
