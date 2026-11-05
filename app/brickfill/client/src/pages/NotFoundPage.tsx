import { Link } from 'react-router';
import { Button } from '@databricks/appkit-ui/react';
import { ArrowLeft, Compass } from 'lucide-react';
import { useTranslation } from '../i18n/react';

/** An address the app does not know: said plainly, with the way back. */
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col items-start gap-4 py-10">
      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <Compass aria-hidden className="h-5 w-5" />
      </span>
      <div className="space-y-1">
        <h1 className="text-[1.375rem] leading-7 font-semibold">{t('common:notFound.title')}</h1>
        <p className="max-w-xl text-sm text-muted-foreground">{t('common:notFound.description')}</p>
      </div>
      <Button asChild variant="outline">
        <Link to="/">
          <ArrowLeft aria-hidden className="mr-1 h-4 w-4" />
          {t('common:notFound.home')}
        </Link>
      </Button>
    </div>
  );
}
