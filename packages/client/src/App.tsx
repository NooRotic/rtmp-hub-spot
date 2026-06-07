import AdminApp from './AdminApp';

// RtmpPlayerTile/localFlvUrl re-exported here for back-compat (App.rtmp-preview.test imports from './App').
export { RtmpPlayerTile, localFlvUrl } from './components/RtmpPlayerTile';

export default function App() {
  return <AdminApp />;
}
