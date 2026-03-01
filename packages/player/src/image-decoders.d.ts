declare module 'bmp-js' {
  interface DecodedBmp {
    width: number;
    height: number;
    data: Uint8Array;
  }

  function decode(buffer: Uint8Array): DecodedBmp;

  const bmp: {
    decode: typeof decode;
  };

  export default bmp;
}

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
