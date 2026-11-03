/** Fixed metadata shared by the shell footer and Help. */
export const PLAYER_BUILD_INFO =
  typeof __BE_MUSIC_BUILD_TIME__ === 'string'
    ? { builtAt: __BE_MUSIC_BUILD_TIME__, revision: __BE_MUSIC_BUILD_REVISION__ }
    : undefined;
