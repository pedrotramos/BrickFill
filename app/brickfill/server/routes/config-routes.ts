import type { Application } from 'express';
import { readPublicConfig } from '../app-config';

interface AppKitWithServer {
  server: {
    extend(fn: (app: Application) => void): void;
  };
}

/** GET /api/config: default UI language and optional customer co-branding, read once from the environment. */
export function setupConfigRoutes(appkit: AppKitWithServer) {
  const config = readPublicConfig();
  appkit.server.extend((app) => {
    app.get('/api/config', (_req, res) => {
      res.json(config);
    });
  });
}
