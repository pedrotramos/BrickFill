import { createApp, files, lakebase, server } from '@databricks/appkit';
import { manualEvidenceStore, setupCatalogRoutes } from './routes/catalog-routes';
import { setupConfigRoutes } from './routes/config-routes';
import { setupLakebaseQueryRoutes } from './routes/lakebase-query-routes';
import { setupSettingsRoutes } from './routes/settings-routes';
import { createEvidenceReadPolicy, resolveEvidenceVolumePath } from './evidence-policy';
import { MAX_SCREENSHOT_BYTES, createManualEvidencePolicy } from './manual-evidence';
import { setupStaticAssets } from './static-assets';

const evidenceRoot = resolveEvidenceVolumePath(process.env.DATABRICKS_VOLUME_EVIDENCE);
if (evidenceRoot) {
  process.env.DATABRICKS_VOLUME_EVIDENCE = evidenceRoot;
  // AppKit 0.38.1 also validates the static default resource even for named volumes.
  process.env.DATABRICKS_VOLUME_FILES = evidenceRoot;
}
// Reviewers' screenshots: the only Volume the app writes (WRITE_VOLUME), always through the catalog routes.
const manualEvidenceRoot = resolveEvidenceVolumePath(process.env.DATABRICKS_VOLUME_MANUAL_EVIDENCE);
if (manualEvidenceRoot) process.env.DATABRICKS_VOLUME_MANUAL_EVIDENCE = manualEvidenceRoot;
createApp({
  plugins: [
    files({
      volumes: {
        evidence: { policy: createEvidenceReadPolicy(evidenceRoot) },
        manual_evidence: {
          policy: createManualEvidencePolicy(manualEvidenceRoot),
          maxUploadSize: MAX_SCREENSHOT_BYTES,
        },
        files: { policy: files.policy.denyAll() },
      },
    }),
    lakebase(),
    server(),
  ],
  async onPluginsReady(appkit) {
    appkit.server.extend((app) => setupStaticAssets(app));
    setupConfigRoutes(appkit);
    await setupCatalogRoutes(appkit, manualEvidenceStore(appkit, manualEvidenceRoot));
    await setupSettingsRoutes(appkit);
    setupLakebaseQueryRoutes(appkit);
  },
}).catch(console.error);
