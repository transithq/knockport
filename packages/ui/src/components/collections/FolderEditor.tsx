import type { Collection, Folder, FolderVariable } from "@knockport/core";
import { FolderCog } from "lucide-react";
import { useAppStore } from "../../store/app-store";
import { PlainVarsTable } from "../common/PlainVarsTable";

function findFolder(folders: Folder[], folderId: string): Folder | undefined {
  for (const f of folders) {
    if (f.id === folderId) return f;
    const nested = findFolder(f.folders, folderId);
    if (nested) return nested;
  }
  return undefined;
}

/** Breadcrumb path from the collection root to a folder (inclusive). */
function folderPath(folders: Folder[], folderId: string, trail: string[] = []): string[] | undefined {
  for (const f of folders) {
    const here = [...trail, f.name];
    if (f.id === folderId) return here;
    const deeper = folderPath(f.folders, folderId, here);
    if (deeper) return deeper;
  }
  return undefined;
}

/**
 * Full-area folder editor tab (Bruno FolderSettings). A2 ships the Variables
 * section; the remaining sections (headers, auth, scripts, tests, docs) are
 * the J1 work.
 */
export function FolderEditor({ collectionId, folderId }: { collectionId: string; folderId: string }) {
  const collections = useAppStore((s) => s.collections);
  const updateFolder = useAppStore((s) => s.updateFolder);

  const collection: Collection | undefined = collections.find((c) => c.id === collectionId);
  const folder = collection ? findFolder(collection.folders, folderId) : undefined;
  if (!collection || !folder) return null;

  const path = folderPath(collection.folders, folderId) ?? [folder.name];
  const variables = folder.variables ?? [];
  const setVars = (vars: FolderVariable[]) => updateFolder(collection.id, folder.id, { variables: vars });

  return (
    <div className="kp-collection-editor kp-scroll">
      <div className="kp-collection-head">
        <span className="kp-collection-icon">
          <FolderCog size={17} />
        </span>
        <input
          className="kp-collection-name"
          value={folder.name}
          onChange={(e) => updateFolder(collection.id, folder.id, { name: e.target.value })}
          aria-label="Folder name"
        />
      </div>
      <div className="kp-collection-meta">
        <span>{collection.name} / {path.join(" / ")}</span>
        <span>·</span>
        <span>folder settings</span>
      </div>

      <div className="kp-collection-body">
        <div className="kp-collection-section">
          <PlainVarsTable
            title="Folder variables"
            hint="Variables defined here apply to every request inside this folder (and its subfolders). They override collection and environment variables with the same key, and lose to request-level variables."
            variables={variables}
            onChange={setVars}
          />
        </div>
      </div>
    </div>
  );
}
