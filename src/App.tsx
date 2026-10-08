import { useState } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { NationalTracker } from './components/NationalTracker';
import { OfficialTracker } from './components/OfficialTracker';
import './App.css';

function App() {
  const [tab, setTab] = useState<'national' | 'official'>(() => location.hash === '#official' ? 'official' : 'national');
  function navigate(next: 'national' | 'official') { setTab(next); history.replaceState(null, '', `#${next}`); }
  return <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#2563eb', borderRadius: 12, fontFamily: 'inherit' } }}>
    <div className="app-shell">
      <header className="app-header"><div className="brand-mark" aria-hidden="true">⌂</div><div><h1>二手房价格跟踪</h1>
        <p>关注城市，查看月度变化</p></div></header>
      <nav className="tab-navigation" aria-label="价格数据类型">
        <button aria-current={tab === 'national' ? 'page' : undefined} onClick={() => navigate('national')}>全国参考均价</button>
        <button aria-current={tab === 'official' ? 'page' : undefined} onClick={() => navigate('official')}>70城官方指数</button>
      </nav>
      <main>{tab === 'national' ? <NationalTracker onShowOfficial={() => navigate('official')} /> : <OfficialTracker />}</main>
      <footer>二手房价格跟踪 · 数据月份和统计口径以各来源为准</footer>
    </div>
  </ConfigProvider>;
}
export default App;
