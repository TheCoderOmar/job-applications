import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Companies from './pages/Companies';
import CompanyDetail from './pages/CompanyDetail';
import Jobs from './pages/Jobs';
import JobDetail from './pages/JobDetail';
import MapPage from './pages/MapPage';
import Settings from './pages/Settings';
import Contacts from './pages/Contacts';
import Openings from './pages/Openings';
import QuickAdd from './pages/QuickAdd';
import Cvs from './pages/Cvs';

export default function App() {
  return (
    <Routes>
      {/* The browser extension's small window: no menu, just the form. */}
      <Route path="quick" element={<QuickAdd />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="companies" element={<Companies />} />
        <Route path="companies/:id" element={<CompanyDetail />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="jobs/:id" element={<JobDetail />} />
        <Route path="cvs" element={<Cvs />} />
        <Route path="openings" element={<Openings />} />
        <Route path="contacts" element={<Contacts />} />
        <Route path="map" element={<MapPage />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
