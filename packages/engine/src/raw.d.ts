// Vite raw imports (bundled shims loaded as source strings).
declare module "*?raw" {
  const content: string;
  export default content;
}
