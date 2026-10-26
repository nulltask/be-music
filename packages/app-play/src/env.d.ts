/// <reference types="vite/client" />

/** Short source commit of this build (`vite.config.ts` `define`); empty when it could not be resolved. */
declare const __BE_MUSIC_BUILD__: string;

/**
 * Virtual module of the `be-music:acknowledgements` Vite plugin (`scripts/acknowledgements.ts`): loads the Help's Open
 * source list, one entry per third-party package the build bundled, from `acknowledgements.json`.
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
  export default function loadAcknowledgements(): Promise<Acknowledgement[]>;
}

declare const __BE_MUSIC_BUILD_TIME__: string;
declare const __BE_MUSIC_BUILD_REVISION__: string;
