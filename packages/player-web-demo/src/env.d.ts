/// <reference types="vite/client" />

/**
 * Virtual module produced by the `be-music:acknowledgements` Vite plugin (see `vite.config.ts`). Walks the production
 * dependency tree at build start and exposes one entry per third-party package shipped in the bundle.
 *
 * The demo imports this once and renders it inside the Acknowledgements modal — no runtime fetch, no manual
 * maintenance.
 */
declare module 'virtual:acknowledgements' {
  export interface Acknowledgement {
    name: string;
    version: string;
    license?: string;
    author?: string;
    homepage?: string;
    repository?: string;
    licenseText?: string;
  }
  const acknowledgements: ReadonlyArray<Acknowledgement>;
  export default acknowledgements;
}
