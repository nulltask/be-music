/**
 * User-facing copy for the web player. English is the reference. Japanese has the same shape.
 * The language follows the browser, and the Help language switch, the same way the Help panes do.
 * Product names (Leaderboard, LR2, beatoraja, Google, Discord) and ruleset tokens stay as they are.
 */

export type PlayerLang = 'en' | 'ja';

export function resolvePlayerLang(language: string | undefined): PlayerLang {
  return language?.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

const en = {
  shell: {
    search: 'Search title / artist / genre... (? for a filter)',
    dropTitle: 'Drop to load',
    dropFolder: 'BMS folder',
    submitPlays: 'Submit my plays to the Leaderboard',
    checkingAccount: 'Checking account…',
    leaderboard: 'Leaderboard',
    sound: 'Sound',
    systemCheck: 'System check',
    required: 'Required',
    optional: 'Optional',
    browserReady: 'Browser ready',
    optionalMissing: (count: number) => `Browser ready · ${count} optional missing`,
    browserUnsupported: 'Browser not supported',
    missingRequired: (names: string) => `Missing required: ${names}`,
    supported: 'supported',
    missingRequiredItem: 'missing (required)',
    missingOptionalItem: 'missing (optional)',
    signIn: 'Sign in',
    signInLead: 'Use the passkey of your Leaderboard account.',
    signInPasskey: 'Sign in with a passkey',
    or: 'or',
    signInGoogle: 'Sign in with Google',
    signInDiscord: 'Sign in with Discord',
    signInGoogleSoon: 'Sign in with Google is coming soon',
    signInDiscordSoon: 'Sign in with Discord is coming soon',
    comingSoon: 'Coming soon',
    noAccount: 'No account yet? Sign up',
    cancel: 'Cancel',
    signUpTitle: 'Create your account',
    signUpLead: 'Pick a handle and a name. Your browser then makes a passkey for it.',
    keepTitle: 'Keep this account',
    keepLead:
      'Give your anonymous account a handle and a name. Your browser then makes a passkey, so its plays join the rankings.',
    signUpGoogle: 'Sign up with Google',
    signUpDiscord: 'Sign up with Discord',
    signUpGoogleSoon: 'Sign up with Google is coming soon',
    signUpDiscordSoon: 'Sign up with Discord is coming soon',
    orPasskey: 'or with a passkey',
    handle: 'Handle',
    handleHint: '3 to 15 letters, digits or _. It names your page.',
    displayName: 'Name',
    nameHint: 'Up to 32 characters, in any script. The rankings show it.',
    createPasskey: 'Create passkey',
    skinDropLr2: 'Drop an LR2 skin',
    skinDropBeatoraja: 'Drop a beatoraja skin',
    skinDropHintLr2:
      'Drop the folder that holds your LR2 theme (<code>LR2files/Theme/…</code>, with its <code>.lr2skin</code> files).',
    skinDropHintBeatoraja:
      'Drop the folder that holds your beatoraja skin (its <code>.luaskin</code> or <code>.json</code> skin files).',
    skinSwitchTitle: 'Use the dropped skin?',
    skinSwitchHint: 'Switch to this skin? Cancel keeps your current skin. Charts in the drop will still be imported.',
    useLr2: 'Use LR2 skin',
    useBeatoraja: 'Use beatoraja skin',
    chartsMissing: 'Charts missing',
    ok: 'OK',
    optionUnavailable: 'Option not available',
    optionUnavailableHint:
      'The selected play options cannot be used with this chart. Change them and start the chart again.',
    loading: 'Loading…',
    help: 'Help',
    helpAbout: 'Help & About',
    close: 'Close',
    usage: 'Usage',
    options: 'Options',
    openSource: 'Open source',
    language: 'Language',
    pause: 'Pause',
    quit: 'Quit',
    rotateTitle: 'Rotate your device',
    rotateSubtitle: 'The player is laid out for landscape.',
    ossIntro:
      'This player is built on the open source libraries listed below: every third-party package this build includes. Each entry keeps the copyright / license text the package ships, or its upstream text where the package ships none; open it to read.',
    services: 'Services',
    ackLoading: 'Loading…',
    ackFailed: 'Could not load the list.',
    ackEmpty: 'No third-party packages were found in this build.',
    ackLicense: 'Copyright and license text',
    ackNoLicense: 'No LICENSE file shipped with this package.',
    yourPage: 'Your Leaderboard page (opens in a new tab)',
  },
  phases: {
    enumerating: 'Collecting files…',
    reading: 'Reading files…',
    parsing: 'Parsing charts…',
    theme: 'Loading LR2 theme…',
  },
  compatNotes: {
    webgl2: 'Pixi rendering pipeline (or WebGPU)',
    'web-audio': 'Keysound and BGM playback',
    'file-api': 'Loads BMS folders / LR2 themes from drag-drop',
    webassembly: 'BGA video transcode (ffmpeg.wasm)',
    worker: 'Off-main-thread BGA transcoding',
    webgpu: 'Preferred GPU path; auto-falls-back to WebGL2',
    webcodecs: 'Hardware-accelerated BGA encode',
    'media-recorder': 'Gameplay → WebM recording',
    'offscreen-canvas': 'LR2 bitmap-font conversion',
  },
  account: {
    notSignedIn: 'Not signed in',
    anonymous: 'anonymous',
    passkey: (count: number) => `${count} passkey${count === 1 ? '' : 's'}`,
    chipSignedOutTitle:
      'Not signed in to the Leaderboard. Open the Debug Menu’s Leaderboard folder to sign in with a passkey.',
    chipAnonymousTitle:
      'Signed in anonymously: create a passkey to keep this account and show its plays on the Leaderboard.',
    chipSignedInTitle: (name: string, handle: string) =>
      `Signed in as ${name} (@${handle}). Opens your Leaderboard page.`,
    startSignedOutHint: 'Sign in through Accounts before submitting plays. You can start with a guest account.',
    startAnonymousHint:
      'This account lives only in this browser, and rankings leave it out. Keep it with a passkey to join them.',
    signUp: 'Sign up',
    keep: 'Keep this account',
    signOut: 'Sign out',
    manage: 'Manage account',
    signInFailed: 'Sign-in failed',
    signUpFailed: 'Sign-up failed',
    couldNotSignOut: 'Could not sign out.',
    accountReadyPrefix: 'Your account is ready',
    handleReserved: 'That handle is reserved. Pick another.',
    handleFormat: 'Handles are 3 to 15 letters, digits or _.',
    nameEmpty: 'The name cannot be empty.',
    nameLength: 'Names are at most 32 characters.',
    nameCharacters: 'Names cannot contain line breaks or control characters.',
    handleTaken: 'That handle is taken.',
    signInFirst: 'Sign in first.',
    somethingWrong: (error: string) => `Something went wrong (${error}).`,
  },
  replay: {
    invalid: (message: string) => `Replay: invalid replay (${message})`,
    notLoaded: (title: string) => `Replay: chart not loaded (${title})`,
    untitled: 'untitled',
    loadChart: 'Load this chart to watch the replay, then drop the replay again.',
    replaying: (title: string) => `Replaying: ${title}`,
    failed: (message: string) => `Replay failed: ${message}`,
    slotUnreadable: (slot: number) => `Replay slot ${slot} could not be read`,
    replayingSlot: (slot: number, title: string) => `Replaying slot ${slot}: ${title}`,
    slotDeleted: (slot: number) => `Deleted the replay in slot ${slot}`,
    slotNotDeleted: (slot: number) => `Replay slot ${slot} could not be deleted`,
    invalidCourse: (message: string) => `Course replay: invalid course replay (${message})`,
    stagesMissing: (missing: number, total: number) =>
      `Course replay: ${missing} of ${total} stage charts are not loaded`,
    loadStages: (name: string) =>
      `Load these charts of ${name} to replay the course, then drop its course replay again.`,
    courseFailed: (message: string) => `Course replay failed: ${message}`,
    untitledChart: 'untitled chart',
    slotsTitle: 'Replay slots',
    save: 'Save',
    saved: 'Saved',
    savedNow: 'Saved now',
    empty: 'Empty',
    slot: (slot: number) => `Slot ${slot}`,
    saveHint: 'Save this play to a slot (keys 1-4). A slot keeps one replay.',
    cannotSave: 'This play cannot be saved to a slot.',
    replay: 'Replay',
    download: 'Download',
    delete: 'Delete',
  },
  lb: {
    notSubmitted: (error: string) => `Leaderboard: not submitted (${error})`,
    courseNotSubmitted: (error: string) => `Leaderboard: course not submitted (${error})`,
    network: 'Leaderboard: not submitted (network error)',
    courseNetwork: 'Leaderboard: course not submitted (network error)',
    stored: (reason: string, again: string) => `Leaderboard: stored, not ranked (${reason})${again}`,
    submitted: 'Leaderboard: submitted',
    ranked: (ruleset: string, rank: number, players: number, exScore: number, best: string, again: string) =>
      `Leaderboard ${ruleset}: #${rank} / ${players} · EX ${exScore}${best}${again}`,
    courseRanked: (ruleset: string, rank: number, players: number, exScore: number, best: string, again: string) =>
      `Leaderboard course ${ruleset}: #${rank} / ${players} · EX ${exScore}${best}${again}`,
    already: ' (already submitted)',
    newBest: (parts: string) => ` · new best ${parts}`,
    lamp: 'lamp',
    unranked: {
      'bmson-total': 'bmson TOTAL 0 used no recovery',
      tempo: 'a play at another tempo is practice',
      'course-stage': 'a course stage ranks with its course',
      unreleased: 'made and random courses are not ranked',
    },
    skipped: {
      'two-player': 'Leaderboard: not submitted (two-player plays have no single-player ranking)',
      'auto-play': 'Leaderboard: not submitted (an auto play is not sent)',
      'missing-fingerprint': 'Leaderboard: not submitted (this replay has no chart fingerprint)',
      'fingerprint-mismatch': 'Leaderboard: not submitted (the chart does not match the recorded play)',
    },
    courseSkipped: {
      'two-player': 'Leaderboard: course not submitted (two-player plays have no single-player ranking)',
      'auto-play': 'Leaderboard: course not submitted (an auto play is not sent)',
      aborted: 'Leaderboard: course not submitted (a stage before the last was given up)',
      'not-a-course-run': 'Leaderboard: course not submitted (the stages do not make one run)',
      'missing-fingerprint': 'Leaderboard: course not submitted (a stage chart has no fingerprint)',
      'fingerprint-mismatch': 'Leaderboard: course not submitted (a stage chart does not match the recorded play)',
    },
  },
  course: {
    making: 'Making a course: decide charts to add them, then save',
    newCourse: (kind: string) => `New ${kind} course`,
    decideCharts: 'Decide charts to add them (up to 5, in the first chart’s key mode).',
    chartCount: (count: number) => `${count} / 5 charts`,
    courseName: 'Course name',
    connection: 'Connection',
    removeLast: 'Remove last',
    save: 'Save',
    stopped: 'Stopped making the course',
    saved: (name: string) => `Saved the course "${name}"`,
    added: (title: string, count: number) => `Added ${title} to the course (${count} / 5)`,
    couldNotAdd: (title: string, reason: string) => `Could not add ${title}: ${reason}`,
    addReasons: {
      full: 'the course already has 5 charts',
      'key-mode': 'its key mode differs from the first chart’s',
      'no-md5': 'its chart could not be hashed',
      'not-making': 'no course is being made',
    },
    unsaved: 'Could not save your courses in this browser; they last until the page is closed',
    empty: 'No course yet. Decide NEW COURSE in a course folder to make one.',
    exportLr2: 'Export .lr2crs',
    exportBeatoraja: 'Export beatoraja .json',
    myCourses: 'My courses',
    myCoursesLead: 'Courses you made, kept in this browser.',
    delete: 'Delete',
    confirmDelete: (name: string) => `Delete the course "${name}"?`,
    close: 'Close',
    stageMissing: (name: string, count: number) =>
      count === 1 ? `${name}: 1 stage is not in the collection` : `${name}: ${count} stages are not in the collection`,
    randomNoChart: (name: string, stage: number) => `${name}: stage ${stage} matches no chart`,
    randomBadFilter: (name: string, stage: number, error: string) =>
      `${name}: stage ${stage} has an invalid filter (${error})`,
    nonstopLayout: (name: string, stage: string) =>
      `${name}: all NONSTOP stages must use the same generic keyboard layout${stage}`,
    nonstopStitch: (name: string, reason: string, stage: string) =>
      `${name}: cannot stitch the NONSTOP course: ${reason}${stage}`,
    stageNote: (stage: number) => ` (stage ${stage})`,
    constraints: {
      option: 'Lane option',
      speed: 'Hi-speed',
      judge: 'Judgment',
      gauge: 'Gauge',
      longNote: 'Long notes',
    },
    choices: {
      free: 'Free',
      normal: 'Normal',
      offOnly: 'Off only (CLASS)',
      offOrMirror: 'Off or MIRROR',
      randomFamily: 'Random family',
      locked: 'Locked',
      noGreat: 'No GREAT',
      noGood: 'No GOOD',
      playersChoice: 'Player’s choice',
      keys5: '5 keys',
      keys7: '7 keys',
      keys9: '9 keys',
      keys24: '24 keys',
      asCharted: 'As charted',
    },
    randomMix: {
      preferredLevel: 'Favorite level',
      maxLevel: 'Max level',
      minLevel: 'Min level',
      bpmRange: 'BPM range',
      maxBPM: 'Max BPM',
      minBPM: 'Min BPM',
      stageCount: 'Stages',
    },
  },
  embed: {
    needTrack: 'Add ?track= with the URL of a chart archive (.zip) to preview it.',
    loadFailed: (message: string) => `Could not load the track: ${message}`,
    noChart: 'The track holds no playable chart.',
    noStage: 'The course holds no playable stage.',
    loadingTrack: 'Loading track',
    downloading: (size: string) => `Downloading track… ${size}`,
    reading: (current: number, total: number) =>
      total > 0 ? `Reading charts… ${current} / ${total}` : 'Reading charts…',
    badCourseFile: 'Choose an LR2 .lr2crs or beatoraja .json course file.',
  },
};

const ja: typeof en = {
  shell: {
    search: 'タイトル / アーティスト / ジャンルを検索（? でフィルタ）',
    dropTitle: 'ドロップして読み込む',
    dropFolder: 'BMS フォルダ',
    submitPlays: 'プレイを Leaderboard に送信する',
    checkingAccount: 'アカウントを確認しています…',
    leaderboard: 'Leaderboard',
    sound: '音声',
    systemCheck: 'システムチェック',
    required: '必須',
    optional: '任意',
    browserReady: 'ブラウザは対応しています',
    optionalMissing: (count) => `ブラウザは対応しています · 任意の機能が ${count} 個不足`,
    browserUnsupported: 'このブラウザには対応していません',
    missingRequired: (names) => `必須の機能がありません: ${names}`,
    supported: '対応',
    missingRequiredItem: '不足（必須）',
    missingOptionalItem: '不足（任意）',
    signIn: 'ログイン',
    signInLead: 'Leaderboard アカウントのパスキーを使います。',
    signInPasskey: 'パスキーでログイン',
    or: 'または',
    signInGoogle: 'Google でログイン',
    signInDiscord: 'Discord でログイン',
    signInGoogleSoon: 'Google でのログインは準備中です',
    signInDiscordSoon: 'Discord でのログインは準備中です',
    comingSoon: '準備中',
    noAccount: 'アカウントがまだない場合は登録',
    cancel: 'キャンセル',
    signUpTitle: 'アカウントを作成',
    signUpLead: 'ユーザー名と表示名を決めます。そのあと、ブラウザがパスキーを作ります。',
    keepTitle: 'このアカウントを残す',
    keepLead:
      '匿名アカウントにユーザー名と表示名を付けます。ブラウザがパスキーを作ると、そのプレイがランキングに載ります。',
    signUpGoogle: 'Google で登録',
    signUpDiscord: 'Discord で登録',
    signUpGoogleSoon: 'Google での登録は準備中です',
    signUpDiscordSoon: 'Discord での登録は準備中です',
    orPasskey: 'またはパスキーで',
    handle: 'ユーザー名',
    handleHint: '英数字と _ で 3〜15 文字。ページの名前になります。',
    displayName: '表示名',
    nameHint: 'どの文字でも 32 文字まで。ランキングに表示されます。',
    createPasskey: 'パスキーを作成',
    skinDropLr2: 'LR2 スキンをドロップ',
    skinDropBeatoraja: 'beatoraja スキンをドロップ',
    skinDropHintLr2:
      'LR2 テーマのフォルダ（<code>.lr2skin</code> がある <code>LR2files/Theme/…</code>）をドロップしてください。',
    skinDropHintBeatoraja:
      'beatoraja スキンのフォルダ（<code>.luaskin</code> または <code>.json</code>）をドロップしてください。',
    skinSwitchTitle: 'ドロップしたスキンを使いますか？',
    skinSwitchHint:
      'このスキンに切り替えますか？キャンセルすると今のスキンのままです。ドロップ内の譜面は読み込まれます。',
    useLr2: 'LR2 スキンを使う',
    useBeatoraja: 'beatoraja スキンを使う',
    chartsMissing: '譜面がありません',
    ok: 'OK',
    optionUnavailable: '使えないオプション',
    optionUnavailableHint:
      '選んだプレイオプションはこの譜面では使えません。変更してから、もう一度譜面を始めてください。',
    loading: '読み込み中…',
    help: 'ヘルプ',
    helpAbout: 'ヘルプとこのプレイヤーについて',
    close: '閉じる',
    usage: '使い方',
    options: 'オプション',
    openSource: 'オープンソース',
    language: '言語',
    pause: '一時停止',
    quit: 'やめる',
    rotateTitle: '端末を横向きにしてください',
    rotateSubtitle: 'プレイヤーは横向きの画面向けです。',
    ossIntro:
      'このプレイヤーは、下に挙げるオープンソースのライブラリでできています。このビルドに含まれる第三者パッケージです。各項目には、パッケージに同梱の著作権・ライセンス文、同梱がないときは上流の文が入ります。開いて読んでください。',
    services: 'サービス',
    ackLoading: '読み込み中…',
    ackFailed: '一覧を読み込めませんでした。',
    ackEmpty: 'このビルドに第三者パッケージはありません。',
    ackLicense: '著作権とライセンスの本文',
    ackNoLicense: 'このパッケージに LICENSE ファイルはありません。',
    yourPage: 'あなたの Leaderboard ページ（新しいタブで開きます）',
  },
  phases: {
    enumerating: 'ファイルを集めています…',
    reading: 'ファイルを読んでいます…',
    parsing: '譜面を解析しています…',
    theme: 'LR2 テーマを読み込んでいます…',
  },
  compatNotes: {
    webgl2: 'Pixi の描画（または WebGPU）',
    'web-audio': 'キー音と BGM の再生',
    'file-api': 'ドラッグ＆ドロップで BMS フォルダと LR2 テーマを読み込む',
    webassembly: 'BGA 動画の変換（ffmpeg.wasm）',
    worker: 'メインスレッドの外で BGA を変換する',
    webgpu: '優先する GPU 経路。使えなければ WebGL2',
    webcodecs: 'ハードウェアによる BGA のエンコード',
    'media-recorder': 'プレイを WebM で録画',
    'offscreen-canvas': 'LR2 のビットマップフォント変換',
  },
  account: {
    notSignedIn: 'ログインしていません',
    anonymous: '匿名',
    passkey: (count) => `パスキー ${count}`,
    chipSignedOutTitle:
      'Leaderboard にログインしていません。デバッグメニューの Leaderboard からパスキーでログインできます。',
    chipAnonymousTitle: '匿名でログイン中です。パスキーを作ると、このアカウントとプレイを Leaderboard に残せます。',
    chipSignedInTitle: (name, handle) => `${name}（@${handle}）でログイン中です。Leaderboard のページを開きます。`,
    startSignedOutHint: 'プレイを送る前に Accounts でログインしてください。ゲストアカウントから始められます。',
    startAnonymousHint: 'このアカウントはこのブラウザにだけあり、ランキングには出ません。パスキーで残すと載ります。',
    signUp: '登録',
    keep: 'このアカウントを残す',
    signOut: 'ログアウト',
    manage: 'アカウント管理',
    signInFailed: 'ログインできませんでした',
    signUpFailed: '登録できませんでした',
    couldNotSignOut: 'ログアウトできませんでした。',
    accountReadyPrefix: 'アカウントを作成しました',
    handleReserved: 'このユーザー名は使えません。別のユーザー名を選んでください。',
    handleFormat: 'ユーザー名は英数字と _ で 3〜15 文字です。',
    nameEmpty: '表示名を入力してください。',
    nameLength: '表示名は 32 文字までです。',
    nameCharacters: '表示名に改行や制御文字は使えません。',
    handleTaken: 'このユーザー名はすでに使われています。',
    signInFirst: '先にログインしてください。',
    somethingWrong: (error) => `問題が発生しました（${error}）。`,
  },
  replay: {
    invalid: (message) => `リプレイ: 不正なリプレイです（${message}）`,
    notLoaded: (title) => `リプレイ: 譜面が読み込まれていません（${title}）`,
    untitled: '無題',
    loadChart: 'この譜面を読み込んでから、リプレイをもう一度ドロップしてください。',
    replaying: (title) => `リプレイ中: ${title}`,
    failed: (message) => `リプレイに失敗しました: ${message}`,
    slotUnreadable: (slot) => `リプレイスロット ${slot} を読めませんでした`,
    replayingSlot: (slot, title) => `スロット ${slot} をリプレイ中: ${title}`,
    slotDeleted: (slot) => `スロット ${slot} のリプレイを削除しました`,
    slotNotDeleted: (slot) => `リプレイスロット ${slot} を削除できませんでした`,
    invalidCourse: (message) => `コースリプレイ: 不正なコースリプレイです（${message}）`,
    stagesMissing: (missing, total) => `コースリプレイ: ${total} ステージ中 ${missing} の譜面が読み込まれていません`,
    loadStages: (name) => `${name} のこれらの譜面を読み込んでから、コースリプレイをもう一度ドロップしてください。`,
    courseFailed: (message) => `コースリプレイに失敗しました: ${message}`,
    untitledChart: '無題の譜面',
    slotsTitle: 'リプレイスロット',
    save: '保存',
    saved: '保存済み',
    savedNow: 'いま保存しました',
    empty: '空',
    slot: (slot) => `スロット ${slot}`,
    saveHint: 'このプレイをスロットに保存します（キー 1〜4）。1 スロットにリプレイは 1 つです。',
    cannotSave: 'このプレイはスロットに保存できません。',
    replay: 'リプレイ',
    download: 'ダウンロード',
    delete: '削除',
  },
  lb: {
    notSubmitted: (error) => `Leaderboard: 送信しませんでした（${error}）`,
    courseNotSubmitted: (error) => `Leaderboard: コースを送信しませんでした（${error}）`,
    network: 'Leaderboard: 送信しませんでした（ネットワークエラー）',
    courseNetwork: 'Leaderboard: コースを送信しませんでした（ネットワークエラー）',
    stored: (reason, again) => `Leaderboard: 保存しましたがランキング外です（${reason}）${again}`,
    submitted: 'Leaderboard: 送信しました',
    ranked: (ruleset, rank, players, exScore, best, again) =>
      `Leaderboard ${ruleset}: #${rank} / ${players} · EX ${exScore}${best}${again}`,
    courseRanked: (ruleset, rank, players, exScore, best, again) =>
      `Leaderboard コース ${ruleset}: #${rank} / ${players} · EX ${exScore}${best}${again}`,
    already: '（送信済み）',
    newBest: (parts) => ` · 自己ベスト更新 ${parts}`,
    lamp: 'ランプ',
    unranked: {
      'bmson-total': 'bmson の TOTAL 0 で回復なし',
      tempo: '別のテンポでのプレイは練習です',
      'course-stage': 'コースの 1 ステージはコースといっしょに順位が付きます',
      unreleased: '自作コースとランダムコースはランキングに入りません',
    },
    skipped: {
      'two-player': 'Leaderboard: 送信しませんでした（2 人プレイには 1 人用の順位がありません）',
      'auto-play': 'Leaderboard: 送信しませんでした（オートプレイは送りません）',
      'missing-fingerprint': 'Leaderboard: 送信しませんでした（このリプレイに譜面フィンガープリントがありません）',
      'fingerprint-mismatch': 'Leaderboard: 送信しませんでした（譜面が記録されたプレイと一致しません）',
    },
    courseSkipped: {
      'two-player': 'Leaderboard: コースを送信しませんでした（2 人プレイには 1 人用の順位がありません）',
      'auto-play': 'Leaderboard: コースを送信しませんでした（オートプレイは送りません）',
      aborted: 'Leaderboard: コースを送信しませんでした（最後より前のステージでリタイアしています）',
      'not-a-course-run': 'Leaderboard: コースを送信しませんでした（ステージが 1 回のコースランになっていません）',
      'missing-fingerprint':
        'Leaderboard: コースを送信しませんでした（ステージの譜面にフィンガープリントがありません）',
      'fingerprint-mismatch':
        'Leaderboard: コースを送信しませんでした（ステージの譜面が記録されたプレイと一致しません）',
    },
  },
  course: {
    making: 'コースを作成中: 譜面を決定して追加し、保存してください',
    newCourse: (kind) => `新しい ${kind} コース`,
    decideCharts: '決定すると譜面を追加します（最大 5 譜面、最初の譜面のモード）。',
    chartCount: (count) => `${count} / 5 譜面`,
    courseName: 'コース名',
    connection: '接続',
    removeLast: '最後を外す',
    save: '保存',
    stopped: 'コースの作成をやめました',
    saved: (name) => `コース「${name}」を保存しました`,
    added: (title, count) => `${title} をコースに追加しました（${count} / 5）`,
    couldNotAdd: (title, reason) => `${title} を追加できませんでした: ${reason}`,
    addReasons: {
      full: 'コースはすでに 5 譜面です',
      'key-mode': '最初の譜面とモードが違います',
      'no-md5': '譜面のハッシュを計算できませんでした',
      'not-making': 'コースを作成していません',
    },
    unsaved: 'このブラウザにコースを保存できませんでした。ページを閉じるまで残ります',
    empty: 'コースはまだありません。コースフォルダで NEW COURSE を決定すると作れます。',
    exportLr2: '.lr2crs を書き出す',
    exportBeatoraja: 'beatoraja .json を書き出す',
    myCourses: 'マイコース',
    myCoursesLead: 'このブラウザに保存した、自分で作ったコースです。',
    delete: '削除',
    confirmDelete: (name) => `コース「${name}」を削除しますか？`,
    close: '閉じる',
    stageMissing: (name, count) => `${name}: ${count} ステージがコレクションにありません`,
    randomNoChart: (name, stage) => `${name}: ステージ ${stage} に一致する譜面がありません`,
    randomBadFilter: (name, stage, error) => `${name}: ステージ ${stage} のフィルタが不正です（${error}）`,
    nonstopLayout: (name, stage) => `${name}: NONSTOP の全ステージは同じ汎用キーボード配置である必要があります${stage}`,
    nonstopStitch: (name, reason, stage) => `${name}: NONSTOP コースを繋げません: ${reason}${stage}`,
    stageNote: (stage) => `（ステージ ${stage}）`,
    constraints: {
      option: 'レーンオプション',
      speed: 'ハイスピード',
      judge: '判定',
      gauge: 'ゲージ',
      longNote: 'ロングノート',
    },
    choices: {
      free: '制限なし',
      normal: '通常',
      offOnly: 'OFF のみ（CLASS）',
      offOrMirror: 'OFF または MIRROR',
      randomFamily: 'ランダム系',
      locked: '固定',
      noGreat: 'GREAT なし',
      noGood: 'GOOD なし',
      playersChoice: 'プレイヤーの選択',
      keys5: '5 鍵',
      keys7: '7 鍵',
      keys9: '9 鍵',
      keys24: '24 鍵',
      asCharted: '譜面どおり',
    },
    randomMix: {
      preferredLevel: '好みのレベル',
      maxLevel: '最大レベル',
      minLevel: '最小レベル',
      bpmRange: 'BPM の幅',
      maxBPM: '最大 BPM',
      minBPM: '最小 BPM',
      stageCount: 'ステージ数',
    },
  },
  embed: {
    needTrack: 'プレビューするには、譜面アーカイブ（.zip）の URL を ?track= に指定してください。',
    loadFailed: (message) => `楽曲を読み込めませんでした: ${message}`,
    noChart: 'この楽曲にプレイできる譜面がありません。',
    noStage: 'このコースにプレイできるステージがありません。',
    loadingTrack: '楽曲を読み込み中',
    downloading: (size) => `楽曲をダウンロードしています… ${size}`,
    reading: (current, total) => (total > 0 ? `譜面を読んでいます… ${current} / ${total}` : '譜面を読んでいます…'),
    badCourseFile: 'LR2 の .lr2crs か beatoraja の .json コースファイルを選んでください。',
  },
};

const CATALOGS = { en, ja } as const;

export type PlayerCopy = typeof en;

let lang: PlayerLang = 'en';

export function playerLang(): PlayerLang {
  return lang;
}

export function playerText(): PlayerCopy {
  return CATALOGS[lang];
}

/** The language a browser reports, English when there is none (tests, workers). */
export function detectPlayerLang(): PlayerLang {
  return typeof navigator === 'undefined' ? 'en' : resolvePlayerLang(navigator.language);
}

/**
 * Remembers `next` and writes it onto the shell. Elements opt in with `data-i18n`, `data-i18n-aria`,
 * `data-i18n-placeholder` or `data-i18n-title`, whose value is a key of `shell`.
 */
export function setPlayerLang(next: PlayerLang, root?: ParentNode): void {
  lang = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  const scope = root ?? (typeof document === 'undefined' ? undefined : document);
  if (scope !== undefined) applyPlayerCopy(scope);
}

export function applyPlayerCopy(root: ParentNode): void {
  const shell = playerText().shell;
  const write = (selector: string, assign: (element: HTMLElement, value: string) => void): void => {
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      const key = element.getAttribute(selector.slice(1, -1));
      if (key === null || !(key in shell)) continue;
      const value = shell[key as keyof typeof shell];
      if (typeof value === 'string') assign(element, value);
    }
  };
  write('[data-i18n]', (element, value) => {
    element.textContent = value;
  });
  write('[data-i18n-aria]', (element, value) => {
    element.setAttribute('aria-label', value);
  });
  write('[data-i18n-placeholder]', (element, value) => {
    element.setAttribute('placeholder', value);
  });
  write('[data-i18n-title]', (element, value) => {
    element.setAttribute('title', value);
  });
  root.querySelector('footer.service-page-footer nav')?.setAttribute('aria-label', shell.services);
}
