/**
 * @knockport/plugin-host
 *
 * Sandboxed plugin runtime. Runs plugins in a Web Worker with capability-based
 * permissions brokered by the host. Deferred to M4.
 */

export interface PluginHostConfig {
  sandboxUrl?: string;
  capabilities?: string[];
}

export class PluginHost {
  private config: PluginHostConfig;

  constructor(config: PluginHostConfig = {}) {
    this.config = config;
  }

  async init(): Promise<void> {
    // M4: Initialize Worker sandbox + capability broker
  }

  async loadPlugin(_manifest: any): Promise<void> {
    // M4: Load and sandbox a plugin
  }

  dispose(): void {
    // M4: Terminate workers
  }
}
