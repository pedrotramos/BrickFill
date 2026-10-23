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

const navClass = ({ isActive }: { isActive: boolean }) =>
  `touch-min inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

function Navigation({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('common:nav.label')} className="flex flex-col gap-1 md:flex-row">
      <NavLink className={navClass} end onClick={onClick} to="/">
        <LayoutDashboard className="h-4 w-4" />
        {t('common:nav.overview')}
      </NavLink>
      <NavLink className={navClass} onClick={onClick} to="/catalog">
        <PackageSearch className="h-4 w-4" />
        {t('common:nav.catalog')}
      </NavLink>
      <NavLink className={navClass} onClick={onClick} to="/settings">
        <SlidersHorizontal className="h-4 w-4" />
        {t('common:nav.settings')}
      </NavLink>
    </nav>
  );
}

/** BrickFill logo, plus "for <customer>" (and the customer's logo) when the deployment sets co-branding. */
function Brand() {
  const { t } = useTranslation();
  const { brand } = useAppConfig();
  return (
    <Link aria-label={t('common:app.home')} className="touch-min flex min-w-0 shrink-0 items-center gap-3" to="/">
      <BrandLogo />
      {brand.customerName || brand.customerLogoUrl ? (
        <span className="hidden min-w-0 items-center gap-2 border-l pl-3 text-sm text-muted-foreground sm:flex">
          {brand.customerLogoUrl ? (
            <img alt={brand.customerName ?? ''} className="h-6 max-w-28 object-contain" src={brand.customerLogoUrl} />
          ) : null}
          {brand.customerName ? (
            <span className="truncate">{t('common:app.forCustomer', { name: brand.customerName })}</span>
          ) : null}
        </span>
      ) : null}
    </Link>
  );
}

function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="border-t px-4 py-4 text-xs text-muted-foreground md:px-6">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-2">
        <span>{t('common:footer.product')}</span>
        <span>
          {t('common:footer.builtOn')} · {t('common:footer.webData')}
        </span>
      </div>
    </footer>
  );
}

function Layout() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* off screen until focused: the first Tab stop on every page */}
      <a
        className="fixed left-4 top-3 z-50 -translate-y-[200%] rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        href="#main"
      >
        {t('common:nav.skip')}
      </a>
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-4 px-4 md:gap-6 md:px-6">
          <Brand />
          <div className="hidden md:block">
            <Navigation />
          </div>
          <div className="ml-auto hidden text-xs text-muted-foreground xl:block">{t('common:app.tagline')}</div>
          <div className="ml-auto flex items-center gap-2 xl:ml-0">
            <LanguageSwitcher />
            <ArchitectureModal />
            <div className="md:hidden">
              <Sheet open={open} onOpenChange={setOpen}>
                <Button aria-label={t('common:nav.open')} onClick={() => setOpen(true)} size="icon" variant="ghost">
                  <Menu className="h-5 w-5" />
                </Button>
                <SheetContent side="left">
                  <SheetHeader>
                    <SheetTitle>
                      <BrandLogo />
                    </SheetTitle>
                  </SheetHeader>
                  <div className="mt-6 px-4">
                    <Navigation onClick={() => setOpen(false)} />
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-6 focus:outline-none md:px-6 md:py-8" id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
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
