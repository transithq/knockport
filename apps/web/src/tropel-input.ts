// Input-tier wasm URL wiring — lazy (API_CLIENT_WEB_PAYLOAD.md §2.3): the
// ~720 KB collection-parser slice (OpenAPI 3.x/Swagger 2.0, Postman v2.x,
// HAR) is fetched only when the import UI first opens. This file only records
// the bundled asset URL; packages/format kicks off the fetch on demand via
// `ensureTropelInput()`. The Vite `?url` asset import lives here (not in
// packages/format) so format stays bundler-agnostic.
import { registerTropelInputWasmUrl } from "@knockport/format";
import tropelInputWasmUrl from "@tropel/input-wasm/wasm/tropel_input_wasm_bg.wasm?url";

registerTropelInputWasmUrl(tropelInputWasmUrl);