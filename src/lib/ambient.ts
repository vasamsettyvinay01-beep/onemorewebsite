/**
 * Opt-in ambient bed. Either loops a supplied track or, until one exists,
 * synthesises a slow, warm pad (a Dmaj9 voicing through a breathing low-pass
 * and a generated room reverb). Everything fades — nothing ever cuts.
 */

const PAD_VOICES = [73.42, 110, 146.83, 185, 277.18, 329.63];
const FADE_IN = 2.8;
const FADE_OUT = 1.2;

export interface AmbientEngine {
  start: () => Promise<void>;
  stop: () => void;
  dispose: () => void;
}

export function createAmbient({ src, volume }: { src: string | null; volume: number }): AmbientEngine {
  const AudioCtx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AudioCtx();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  let suspendTimer: number | undefined;
  let element: HTMLAudioElement | null = null;

  if (src) {
    element = new Audio(src);
    element.loop = true;
    element.crossOrigin = "anonymous";
    ctx.createMediaElementSource(element).connect(master);
  } else {
    buildPad(ctx, master);
  }

  const target = src ? volume : volume * 0.16;

  return {
    async start() {
      window.clearTimeout(suspendTimer);
      await ctx.resume();
      if (element) await element.play();
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(target, now + FADE_IN);
    },
    stop() {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + FADE_OUT);
      suspendTimer = window.setTimeout(() => {
        element?.pause();
        void ctx.suspend();
      }, FADE_OUT * 1000 + 100);
    },
    dispose() {
      window.clearTimeout(suspendTimer);
      element?.pause();
      void ctx.close();
    },
  };
}

function buildPad(ctx: AudioContext, out: AudioNode) {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  filter.Q.value = 0.6;

  const filterLfo = ctx.createOscillator();
  const filterDepth = ctx.createGain();
  filterLfo.frequency.value = 0.045;
  filterDepth.gain.value = 420;
  filterLfo.connect(filterDepth).connect(filter.frequency);
  filterLfo.start();

  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = 0.55;
  wet.gain.value = 0.75;
  const reverb = ctx.createConvolver();
  reverb.buffer = roomImpulse(ctx, 4.5);

  filter.connect(dry).connect(out);
  filter.connect(reverb).connect(wet).connect(out);

  PAD_VOICES.forEach((freq, i) => {
    const voice = ctx.createGain();
    voice.gain.value = 0.5 / PAD_VOICES.length;

    // each voice swells on its own slow cycle so the chord keeps shifting
    const swell = ctx.createOscillator();
    const swellDepth = ctx.createGain();
    swell.frequency.value = 0.03 + i * 0.017;
    swellDepth.gain.value = voice.gain.value * 0.6;
    swell.connect(swellDepth).connect(voice.gain);
    swell.start();

    for (const [type, cents] of [
      ["sine", -6],
      ["triangle", 5],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = cents;
      osc.connect(voice);
      osc.start();
    }

    voice.connect(filter);
  });
}

function roomImpulse(ctx: AudioContext, seconds: number) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6);
    }
  }
  return buffer;
}
