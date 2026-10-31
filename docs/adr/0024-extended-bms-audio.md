[日本語](./0024-extended-bms-audio.ja.md)

# 0024: Extended BMS audio effects are prepared before host tempo changes

## Context

The [original MacBeat MOD specification](http://harinezumi.s14.xrea.com/download/mbm.txt) defines WAVCMD pitch, percentage volume and sounding time. Earlier helper comments incorrectly described signed pitch, a 127-based volume and a loop point. The [EXWAV reference](https://hitkey.nekokan.dyndns.info/cmds.htm#EXWAVXX) defines frequency and stereo balance but does not define composition with MacBeat commands. Web Audio decoding resamples to the context rate, which loses the native rate needed to interpret frequency.

## Decision

Use these Be-Music rules consistently in browser, Node and offline playback:

| Parameter | Rule                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| WAVCMD 00 | Clamp the authored pitch to 0–127; rate is `2 ** ((pitch - 60) / 12)`.                                           |
| WAVCMD 01 | Percentage gain; 100 is unity.                                                                                   |
| WAVCMD 02 | Positive values limit sounding time to `value / 2000` seconds; zero restores the natural end. Never loop or pad. |
| EXWAV f   | Clamp to 100–100000 Hz; multiply pitch rate by `frequency / nativeSampleRate`.                                   |
| EXWAV p   | Clamp to -10000–10000. Attenuate only the opposite channel by `10 ** (-abs(pan) / 2000)`; the extremes mute it.  |
| EXWAV v   | Clamp to -10000–0, apply hundredths-of-dB attenuation, and mute at the minimum.                                  |

The [DirectSound pan reference](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/ee418148%28v%3Dvs.85%29) defines attenuation without stereo crossfeed: right panning cannot transfer a left-only recording into the right channel. Duplicate WAVCMD parameters resolve last-wins independently. Compose frequency and pitch multiplicatively, then limit sounding time. These cross-dialect and duration-order rules are Be-Music policy rather than verified native-player parity.

Resolve filenames through `resolveBmsWAVResources`: valid EXWAV owns a shared WAV slot, including EXWAV-only declarations; malformed EXWAV retains WAV. Keep authored maps unchanged. NONSTOP allocates separate slots and remaps raw declarations into stage-owned asset paths.

Resolve effect parameters in chart-model and transform PCM with the runtime-neutral `transformStereoPCM`. Offline and Node decoding use the decoder's native rate before output-rate conversion. The browser reads native metadata with Mediabunny when frequency is present, then prepares separate slot buffers before keep-pitch stretching. A path alone cannot identify an effected sample: two slots can share a file with different pitch, duration or balance. Prepared cache keys retain slot case for base-62 charts. Raw buffers are not mutated.

Host tempo/FIT processing follows preparation, so authored pitch remains audible in Keep Pitch mode and sounding time follows the host tempo. Seek, retrigger, pause and replay reuse prepared buffers with their actual durations. For externally decoded browser buffers, EXWAV frequency requires prepared slot buffers or `WebAudioSessionContext.nativeSampleRates`; missing metadata must not silently substitute the device rate.

## Consequences

The public `BmsWAVCmdParam` discriminator uses `duration` for command 02. The deprecated byte-named volume helper delegates to the percentage helper. The legacy EXWAV volume field/function names remain for API compatibility; their numerical unit is a hundredth of a decibel.

Linear sample interpolation matches the existing offline resampler; device/browser resampling can produce different individual PCM values. Tests verify pitch, time, channel separation and backend wiring, not bit-identical browser/Node decoding. NONSTOP preserves exact per-stage VOLWAV in optional `resources.wavGain`, multiplied by any existing intrinsic gain. Shared slot-volume resolution applies it once across browser, Node and offline playback. JSON retains this metadata; BMS output only converts it when an integer percentage reproduces the combined gain exactly, and bmson rejects non-unity values. See the [IR specification](../json-spec.md#intrinsic-sample-gain).

A runtime-only stage-gain sidecar was rejected because serializing a stitched chart must retain its audio level. Adding optional IR metadata preserves existing JSON without gains and keeps raw native directives unchanged; exporting formats with coarser volume units has an explicit representability boundary.
