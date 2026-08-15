import React from "react";
import ReactDOM from "react-dom/client";
import {
  AppShell,
  useAppStore,
  createSeedCollection,
  createSeedEnvironment,
  createProductionEnvironment,
} from "@knockport/ui";
import "@knockport/ui/styles/globals.css";
import "./styles.css";

// Seed the store with a sample collection + environments on first load so the
// UI reflects the reference design instead of being empty. On subsequent loads
// collections/environments come from IndexedDB.
async function seed() {
  const store = useAppStore.getState();
  await store.loadCollections();
  await store.loadEnvironments();

  if (useAppStore.getState().collections.length === 0) {
    const collection = createSeedCollection();
    store.addCollection(collection);

    const dev = createSeedEnvironment();
    const prod = createProductionEnvironment();
    store.addEnvironment(dev);
    store.addEnvironment(prod);
    store.setActiveEnvironment(dev.id);

    // Open a couple of tabs to mirror the design (Get Profile active).
    const login = collection.folders[0].requests[0];
    const getProfile = collection.folders[1].requests[0];
    store.openTab(login);
    store.openTab(getProfile);
    store.setActiveRequestPanel("params");
  }

  // Load persisted history from IndexedDB.
  store.loadHistory();
}

seed();

const root = document.getElementById("root")!;
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
