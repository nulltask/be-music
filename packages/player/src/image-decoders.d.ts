declare module 'pngjs' {
  interface DecodedPng {
    width: number;
    height: number;
    data: Uint8Array;
  }

  export const PNG: {
    sync: {
      read(buffer: Uint8Array): DecodedPng;
    };
  };
}
