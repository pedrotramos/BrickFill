import type { FilePolicy } from '@databricks/appkit';

const readActions = new Set(['list', 'read', 'download', 'raw', 'exists', 'metadata', 'preview']);

export function resolveEvidenceVolumePath(value: string | undefined): string | undefined {
  const root = value?.replace(/\/+$/, '');
  if (!root) return undefined;
  if (/^\/Volumes\/[^/.]+\/[^/.]+\/[^/.]+$/.test(root)) return root;
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(root)) return `/Volumes/${root.replace(/\./g, '/')}`;
  return undefined;
}

export function createEvidenceReadPolicy(volumeRoot: string | undefined, volumeKey = 'evidence'): FilePolicy {
  const root = volumeRoot?.replace(/\/+$/, '');
  return (action, resource) => {
    if (!root || !/^\/Volumes\/[^/]+\/[^/]+\/[^/]+$/.test(root)) return false;
    if (resource.volume !== volumeKey || !readActions.has(action)) return false;
    const path = resource.path;
    if (path.includes('\0') || path.includes('\\') || path.split('/').includes('..')) return false;
    return !path.startsWith('/') || path === root || path.startsWith(`${root}/`);
  };
}
