// `signalsmith-stretch` ships no types. Its default export creates the stretch node; `time-stretch-signalsmith.ts`
// describes the part of the node it uses.
declare module 'signalsmith-stretch' {
  const SignalsmithStretch: (context: BaseAudioContext, options?: AudioWorkletNodeOptions) => Promise<AudioNode>;
  export default SignalsmithStretch;
}
