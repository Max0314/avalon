"""Render three original acoustic chamber loops with NumPy and FFmpeg."""

from pathlib import Path
import subprocess

import numpy as np


RATE = 32_000
TAU = 2 * np.pi
OUTPUT = Path(__file__).resolve().parents[1] / 'audio' / 'night'


def frequency(note):
    return 440 * 2 ** ((note - 69) / 12)


def soft_edges(t, attack, release):
    return np.sin(np.pi / 2 * np.minimum(t / attack, 1)) ** 2 * (
        np.sin(np.pi / 2 * np.minimum((t[-1] - t) / release, 1)) ** 2
    )


def bow(note, t, rng):
    """A gut string spoken with a slow bow; resonances belong to the wooden body."""
    f = frequency(note)
    vibrato = .0022 * np.sin(TAU * rng.uniform(4.3, 5.1) * t) * (1 - np.exp(-3 * t))
    drift_times = np.arange(0, t[-1] + .26, .25)
    drift = np.interp(t, drift_times, rng.normal(0, .0008, len(drift_times)))
    phase = np.cumsum(TAU * f / RATE * (1 + vibrato + drift))
    pressure = .76 + .14 * np.sin(np.pi * t / t[-1]) + .07 * np.sin(TAU * .71 * t)
    wave = np.zeros_like(t)
    for h in range(1, 19):
        hz = h * f
        body = .40 + .75 * np.exp(-((hz - 255) / 135) ** 2) + .48 * np.exp(-((hz - 780) / 285) ** 2)
        weight = body / h ** 1.12 * np.exp(-hz / 2850)
        wave += weight * np.sin(h * phase + .25 * h) * (1 - np.exp(-(32 / h + 2) * t))
    grain = np.convolve(rng.normal(0, 1, len(t)), np.ones(8) / 8, mode='same')
    return (wave + .025 * grain) * pressure * soft_edges(t, rng.uniform(.13, .28), .22)


def lute(note, t, rng):
    """Two slightly detuned strings plucked off-centre, with frequency-dependent decay."""
    f = frequency(note)
    pluck_point = rng.uniform(.17, .25)
    drift = rng.uniform(.0006, .0019)
    phase = TAU * f * t
    wave = np.zeros_like(t)
    for h in range(1, 16):
        # Position of the finger suppresses selected harmonics of the string.
        weight = np.sin(np.pi * h * pluck_point) / h ** 1.42
        decay = np.exp(-(1.8 + .28 * h + .0009 * f) * t)
        pair = np.sin(h * phase) + .48 * np.sin(h * phase * (1 + drift) - .41 * h)
        wave += weight * decay * pair
    pick = rng.normal(0, .11, len(t)) * np.exp(-120 * t)
    return (wave + pick) * soft_edges(t, .004, .12)


def frame_drum(note, t, rng):
    f = frequency(note)
    attack = .44 * (1 - np.exp(-32 * t))
    skin = np.sin(TAU * (f * t + attack)) + .32 * np.sin(TAU * (1.59 * f * t + attack))
    rustle = np.convolve(rng.normal(0, 1, len(t)), np.ones(5) / 5, mode='same')
    return (skin * np.exp(-7 * t) + .29 * rustle * np.exp(-34 * t)) * soft_edges(t, .006, .10)


def bronze(note, t, _rng):
    # A muted, distant bronze strike with inharmonic modes.
    phase = TAU * frequency(note) * t
    wave = sum(level * np.sin(ratio * phase) * np.exp(-t / decay)
               for ratio, level, decay in ((1, .7, 1.35), (2.41, .29, .92),
                                           (3.02, .17, .72), (4.18, .12, .38)))
    return wave * soft_edges(t, .013, .22)


class Ensemble:
    def __init__(self, bars, meter, beat, seed):
        self.beat = beat
        self.meter = meter
        self.rng = np.random.default_rng(seed)
        self.stereo = np.zeros((round(RATE * bars * meter * beat), 2))

    def play(self, instrument, bar, offset, note, beats, level, pan):
        t = np.arange(round(beats * self.beat * RATE)) / RATE
        wave = instrument(note, t, self.rng) * level
        onset = (bar * self.meter + offset) * self.beat + self.rng.uniform(-.009, .009)
        first = round(onset * RATE) % len(self.stereo)
        # Ring a note across the bar-line, including the final bar of the loop.
        wave = wave[:, None] * np.sqrt([1 - pan, pan])
        before_end = min(len(wave), len(self.stereo) - first)
        self.stereo[first:first + before_end] += wave[:before_end]
        self.stereo[:len(wave) - before_end] += wave[before_end:]

    def mix(self, decay, level):
        # Circular convolution keeps the previous phrase's reverberation at sample zero.
        dry = self.stereo
        mix = dry.copy()
        early = ((.031, .090), (.049, .075), (.081, .060), (.126, .045))
        for delay, gain in early:
            mix += np.roll(dry[:, ::-1], round(delay * RATE), axis=0) * gain
        tail_t = np.arange(round(decay * RATE)) / RATE
        mono_spectrum = np.fft.rfft(dry.mean(axis=1))
        for channel in range(2):
            tail = self.rng.normal(0, 1, len(tail_t)) * np.exp(-6.91 * tail_t / decay)
            tail *= 1 - np.exp(-24 * tail_t)
            tail = np.convolve(tail, np.ones(13) / 13, mode='same')
            tail *= .09 / np.sqrt(np.sum(tail ** 2))
            wet = np.fft.irfft(mono_spectrum * np.fft.rfft(tail, n=len(dry)), n=len(dry))
            mix[:, channel] += np.roll(wet, round(.058 * RATE))
        mix -= mix.mean(axis=0)
        mix *= min(level / np.sqrt(np.mean(mix ** 2)), .60 / np.max(np.abs(mix)))
        return np.round(mix * 32767).astype('<i2').tobytes()


def hall():
    # A slow triple metre in D. The bowed answer enters only after the lute's call.
    ensemble = Ensemble(16, 3, .91, 410)
    basses = (38, 38, 41, 36, 34, 38, 43, 33, 38, 41, 36, 43, 34, 38, 33, 33)
    calls = ((62, 69), (65,), (60, 65), (), (62, 65), (57,), (62, 67), (61,),
             (65, 69), (72,), (67, 64), (), (65, 62), (57,), (64, 61), ())
    answers = {1:(57, 4.2), 3:(55, 2.4), 5:(53, 4.4), 7:(52, 2.6),
               9:(60, 4.4), 11:(58, 2.5), 13:(53, 3.4), 15:(52, 2.5)}
    for bar, (bass, call) in enumerate(zip(basses, calls)):
        ensemble.play(bow, bar, .04, bass, 3.2, .19, .43)
        for i, note in enumerate(call):
            ensemble.play(lute, bar, .38 + i * 1.34, note, 2.85, .33 - .07 * i, .33)
        if bar in answers:
            note, beats = answers[bar]
            ensemble.play(bow, bar, .53, note, beats, .155, .65)
    return ensemble.mix(1.76, .076)


def quest():
    # A frame drum and two lute courses articulate a loping 6/8 beneath short viol phrases.
    ensemble = Ensemble(16, 6, .405, 932)
    roots = (40, 40, 38, 36, 40, 43, 38, 35, 40, 43, 45, 41, 40, 38, 35, 35)
    melody = ((59, 62), (64,), (62, 57), (), (59, 64), (67,), (62, 60), (59,),
              (64, 67), (71,), (69, 64), (65,), (67, 64), (62, 57), (59, 54), ())
    for bar, (root, phrase) in enumerate(zip(roots, melody)):
        ensemble.play(bow, bar, .06, root, 4.9, .16, .47)
        for i, offset in enumerate((0, 2, 3.12, 5) if bar % 4 != 3 else (0, 3)):
            note = (root + 12, root + 19, root + 12, root + 7)[i]
            ensemble.play(lute, bar, offset, note, 2.8, (.31, .19, .235, .17)[i], .35)
        for i, note in enumerate(phrase):
            ensemble.play(bow, bar, .72 + 2.85 * i, note, 3.65 if len(phrase) == 1 else 2.3,
                          .165, .64)
        ensemble.play(frame_drum, bar, 0, 38, 1.23, .17, .51)
        if bar % 4 in (1, 2):
            ensemble.play(frame_drum, bar, 3.08, 43, 1.02, .083, .54)
    return ensemble.mix(1.15, .072)


def dusk():
    # A semitone above the open C keeps returning; long rests let the bronze ring out.
    ensemble = Ensemble(12, 4, 1.02, 673)
    roots = (36, 36, 37, 34, 36, 32, 37, 31, 36, 34, 37, 31)
    inner = ((55, 4.6), (51, 2.5), (53, 4.4), (50, 2.8),
             (55, 4.4), (51, 2.85), (49, 4.8), (50, 2.1),
             (51, 3.6), (53, 3.5), (49, 4.2), (50, 2.9))
    plucks = {0:(60, 61), 2:(65,), 3:(58,), 4:(63, 60), 6:(61,),
              7:(55,), 8:(60, 63), 9:(58,), 10:(61,), 11:(59,)}
    for bar, root in enumerate(roots):
        ensemble.play(bow, bar, 0, root, 4.3, .165, .44)
        note, beats = inner[bar]
        ensemble.play(bow, bar, .33, note, beats, .13, .64)
        for i, pitch in enumerate(plucks.get(bar, ())):
            ensemble.play(lute, bar, .75 + 1.52 * i, pitch, 2.75, .235 - .065 * i, .37)
        if bar in (1, 5, 10):
            ensemble.play(bronze, bar, 2.6, (60 if bar == 1 else 55), 4.25, .105, .63)
    return ensemble.mix(2.45, .074)


if __name__ == '__main__':
    OUTPUT.mkdir(exist_ok=True)
    for name, movement in [('hall', hall), ('quest', quest), ('dusk', dusk)]:
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 's16le', '-ar', str(RATE), '-ac', '2', '-i', 'pipe:0',
            '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '96k', str(OUTPUT / f'{name}.mp3'),
        ], input=movement(), check=True)
