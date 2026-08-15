// Vite raw imports (used by @knockport/engine's vendored shim bundle).
declare module "*?raw" {
  const content: string;
  export default content;
}
