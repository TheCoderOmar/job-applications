import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import Icon, { type IconName } from './Icon';

const nav: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/companies', label: 'Companies', icon: 'building' },
  { to: '/jobs', label: 'Applications', icon: 'briefcase' },
  { to: '/cvs', label: 'CVs', icon: 'file' },
  { to: '/openings', label: 'Openings', icon: 'search' },
  { to: '/contacts', label: 'Contacts', icon: 'users' },
  { to: '/map', label: 'Map', icon: 'map' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export default function Layout() {
  const { pathname } = useLocation();
  const fullBleed = pathname === '/map';
  // Desktop only: full menu or icons only. Remembered in this browser.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('nav-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('nav-collapsed', c ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !c;
    });

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className={`flex shrink-0 items-center gap-1 border-b border-line bg-surface/70 px-3 py-2 backdrop-blur ${collapsed ? 'md:w-[72px]' : 'md:w-60'} md:px-4 md:flex-col md:items-stretch md:gap-1 md:border-b-0 md:border-r md:py-6`}>
        <div className={`mr-3 flex h-10 items-center gap-2.5 overflow-hidden md:mb-8 md:mr-0 md:px-0.5`}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand-light shadow-glow">
            <Icon name="briefcase" className="h-5 w-5" />
          </div>
          <div className={`hidden ${collapsed ? '' : 'md:block'}`}>
            <div className="text-sm font-semibold leading-tight">Job Tracker</div>
            <div className="text-xs text-muted">Your application hub</div>
          </div>
        </div>
        <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto md:flex-col">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 whitespace-nowrap h-9 rounded-lg px-3 text-sm transition ${
                  isActive
                    ? 'bg-brand/15 text-brand-light shadow-[inset_2px_0_0_#3b82f6]'
                    : 'text-muted hover:bg-raised hover:text-fg'
                }`
              }
            >
              <Icon name={item.icon} />
              <span className={collapsed ? 'md:hidden' : ''}>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <button
          onClick={toggle}
          className={`mt-2 hidden items-center gap-3 h-9 rounded-lg px-3 text-sm text-muted transition hover:bg-raised hover:text-fg md:flex`}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
        >
          <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </aside>
      <main className={`min-h-0 min-w-0 flex-1 ${fullBleed ? 'relative' : 'overflow-y-auto'}`}>
        {fullBleed ? (
          <Outlet />
        ) : (
          <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
            <Outlet />
          </div>
        )}
      </main>
    </div>
  );
}
