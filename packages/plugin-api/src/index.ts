/**
 * @knockport/plugin-api
 *
 * The public plugin SDK. Published to npm as the contract for third-party plugins.
 * Deferred to M4.
 */

import type { PluginManifest, PluginCapability } from "@knockport/core";

/**
 * Define a KnockPort plugin.
 */
export function definePlugin(config: PluginManifest): PluginManifest {
  return config;
}

export type { PluginManifest, PluginCapability };
