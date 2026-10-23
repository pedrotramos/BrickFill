import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@databricks/appkit-ui/react';
import i18n from './i18n';
import { BrandLogo } from './components/BrandLogo';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/** Last-resort screen. Class component, so it reads translations from the i18n instance instead of the hook. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    const { error, errorInfo } = this.state;
    if (!error) return this.props.children;
    const t = i18n.t.bind(i18n);
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="mx-auto mt-8 max-w-2xl space-y-4">
          <BrandLogo />
          <Card>
            <CardHeader>
              <CardTitle aria-level={1} className="text-destructive" role="heading">
                {t('common:errorBoundary.title')}
              </CardTitle>
              <p className="text-sm text-muted-foreground">{t('common:errorBoundary.description')}</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button onClick={() => window.location.reload()}>{t('common:errorBoundary.reload')}</Button>
              <div>
                <h2 className="mb-2 font-semibold">{t('common:errorBoundary.message')}</h2>
                <pre className="overflow-auto rounded bg-muted p-3 text-sm">{error.toString()}</pre>
              </div>
              {errorInfo?.componentStack ? (
                <details>
                  <summary className="cursor-pointer font-semibold">{t('common:errorBoundary.componentStack')}</summary>
                  <pre className="mt-2 overflow-auto rounded bg-muted p-3 text-sm">{errorInfo.componentStack}</pre>
                </details>
              ) : null}
              {error.stack ? (
                <details>
                  <summary className="cursor-pointer font-semibold">{t('common:errorBoundary.stackTrace')}</summary>
                  <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-3 text-sm">{error.stack}</pre>
                </details>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
}
