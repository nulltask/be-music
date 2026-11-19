import * as api from '@be-music/service-avatar';
import type { BenchmarkPackageDefinition } from '../exports.types.ts';

export const serviceAvatarBenchmarkPackage: BenchmarkPackageDefinition = {
  module: api,
  registerCases(define) {
    const bytes = Uint8Array.of(0xff, 0xd8, 0xff);
    define('service-avatar.detectAvatarType', {
      run: () => {
        api.detectAvatarType(bytes);
      },
    });
    define('service-avatar.generatedAvatarSVG', {
      run: () => {
        api.generatedAvatarSVG('user');
      },
    });
    define('service-avatar.prepareAvatarUpload', {
      run: async () => {
        await api.prepareAvatarUpload('user', bytes);
      },
    });
  },
};
