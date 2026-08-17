// Core-tier wasm boot — lazy, non-blocking (API_CLIENT_WEB_PAYLOAD.md §2.1):
// the ~450 KB tropel core tier (dynamic $variable catalog now; auth signing /
// import parsing later) loads after first paint. Until it is ready,
// packages/core degrades to its TS fallback port of the same catalog, so
// sends are never blocked on the fetch. The Vite `?url` asset import lives
// here (not in packages/core) so core stays bundler-agnostic.
import { ensureTropelCore } from "@knockport/core";
import tropelCoreWasmUrl from "@tropel/core-wasm/wasm/tropel_core_wasm_bg.wasm?url";

void ensureTropelCore(tropelCoreWasmUrl);
