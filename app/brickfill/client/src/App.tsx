import { useState } from 'react';
import { createBrowserRouter, Link, NavLink, Outlet, RouterProvider, useParams } from 'react-router';
import { Button, Sheet, SheetContent, SheetHeader, SheetTitle } from '@databricks/appkit-ui/react';
import { LayoutDashboard, Menu, PackageSearch, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from './i18n/react';
import { AppConfigProvider } from './components/AppConfigProvider';
import { ArchitectureModal } from './components/ArchitectureModal';
import { BrandLogo } from './components/BrandLogo';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { useAppConfig } from './lib/app-config';
import { CatalogPage } from './pages/CatalogPage';
import { OverviewPage } from './pages/OverviewPage';
import { ProductPage } from './pages/ProductPage';
import { SettingsPage } from './pages/SettingsPage';

/** Sidebar items as in the workspace: compact rows, the current page on a blue wash with blue text. */
const itemClass =
  'touch-min flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const navClass = ({ isActive }: { isActive: boolean }) =>
  `${itemClass} ${
    isActive
      ? 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground'
      : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
  }`;

function Navigation({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('common:nav.label')} className="flex flex-col gap-0.5">
      <NavLink className={navClass} end onClick={onClick} to="/">
        <LayoutDashboard aria-hidden className="h-4 w-4" />
        {t('common:nav.overview')}
      </NavLink>
      <NavLink className={navClass} onClick={onClick} to="/catalog">
        <PackageSearch aria-hidden className="h-4 w-4" />
        {t('common:nav.catalog')}
      </NavLink>
      <NavLink className={navClass} onClick={onClick} to="/settings">
        <SlidersHorizontal aria-hidden className="h-4 w-4" />
        {t('common:nav.settings')}
      </NavLink>
    </nav>
  );
}

/** BrickFill logo, plus "for <customer>" (and the customer's logo) when the deployment sets co-branding. */
function Brand({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation();
  const { brand } = useAppConfig();
  return (
    <div className="min-w-0 space-y-2">
      <Link
        aria-label={t('common:app.home')}
        className="touch-min flex w-fit items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onClick}
        to="/"
      >
        <BrandLogo markClassName="h-7 w-7" />
      </Link>
      {brand.customerName || brand.customerLogoUrl ? (
        <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {brand.customerLogoUrl ? (
            <img alt={brand.customerName ?? ''} className="h-5 max-w-24 object-contain" src={brand.customerLogoUrl} />
          ) : null}
          {brand.customerName ? (
            <span className="truncate">{t('common:app.forCustomer', { name: brand.customerName })}</span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function Credits({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p className={`text-xs leading-5 text-muted-foreground ${className}`.trim()}>
      {t('common:footer.product')}
      <br />
      {t('common:footer.builtOn')} · {t('common:footer.webData')}
    </p>
  );
}

/** Everything the sidebar holds, shared by the fixed desktop sidebar and the mobile sheet. */
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-6 px-3 py-4">
      <div className="px-1">
        <Brand onClick={onNavigate} />
      </div>
      <Navigation onClick={onNavigate} />
      <div className="mt-auto space-y-2">
        <ArchitectureModal triggerClassName={`${itemClass} text-sidebar-foreground hover:bg-sidebar-accent/60`} />
        <LanguageSwitcher wide />
        <Credits className="px-1 pt-3" />
      </div>
    </div>
  );
}

function Layout() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      {/* off screen until focused: the first Tab stop on every page */}
      <a
        className="fixed left-4 top-3 z-50 -translate-y-[200%] rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        href="#main"
      >
        {t('common:nav.skip')}
      </a>
      {/* the column runs the page's full height; only its content sticks to the viewport */}
      <aside className="hidden border-r border-sidebar-border bg-sidebar md:block">
        <div className="sticky top-0 h-screen overflow-y-auto">
          <SidebarContent />
        </div>
      </aside>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-sidebar px-4 md:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <Button aria-label={t('common:nav.open')} onClick={() => setOpen(true)} size="icon" variant="ghost">
            <Menu className="h-5 w-5" />
          </Button>
          <SheetContent className="w-72 gap-0 bg-sidebar p-0" side="left">
            <SheetHeader className="sr-only">
              <SheetTitle>{t('common:nav.label')}</SheetTitle>
            </SheetHeader>
            <SidebarContent onNavigate={() => setOpen(false)} />
          </SheetContent>
        </Sheet>
        <Link aria-label={t('common:app.home')} className="touch-min flex items-center" to="/">
          <BrandLogo markClassName="h-7 w-7" />
        </Link>
        <div className="ml-auto">
          <LanguageSwitcher />
        </div>
      </header>
      <main className="min-w-0 px-4 py-6 focus:outline-none md:px-8 md:py-7" id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

/** One page instance per product: open edits, drafts and filters never carry over to the next product of the queue. */
function ProductRoute() {
  const { ean = '' } = useParams();
  return <ProductPage key={ean} />;
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <OverviewPage /> },
      { path: '/catalog', element: <CatalogPage /> },
      { path: '/catalog/:ean', element: <ProductRoute /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
]);

export default function App() {
  return (
    <AppConfigProvider>
      <RouterProvider router={router} />
    </AppConfigProvider>
  );
}
