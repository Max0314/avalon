"""Render Avalon's three original instrumental loops with NumPy and FFmpeg."""

from dataclasses import dataclass
from pathlib import Path
import subprocess

import numpy as np


RATE = 32_000
TAU = 2 * np.pi
OUTPUT = Path(__file__).resolve().parents[1] / 'audio'


@dataclass(frozen=True)
class Movement:
    beat: float
    meter: int
    chords: tuple
    melody: tuple


# Each chord gives the bass and three plucked notes. Zero in a melody is a rest.
HALL = Movement(.76, 3, (
    (50, 57, 62, 65), (46, 53, 58, 62), (48, 55, 60, 64), (45, 52, 57, 64),
    (50, 57, 62, 65), (46, 53, 58, 65), (43, 50, 55, 62), (45, 52, 57, 61),
), (
    (69, 67, 65, 62), (65, 62, 60, 62), (64, 67, 69, 72), (69, 64, 0, 67),
    (77, 76, 74, 69), (70, 69, 65, 70), (67, 65, 62, 67), (69, 65, 64, 61),
    (74, 77, 81, 77), (74, 72, 70, 65), (72, 69, 67, 64), (69, 71, 72, 76),
    (77, 81, 79, 77), (74, 72, 70, 74), (67, 65, 62, 58), (61, 64, 69, 0),
))

QUEST = Movement(.62, 4, (
    (45, 57, 60, 64), (43, 55, 59, 62), (48, 55, 60, 64), (40, 52, 55, 62),
    (45, 57, 60, 64), (41, 53, 57, 60), (38, 53, 57, 62), (40, 52, 56, 62),
), (
    (69, 72, 71, 69), (67, 71, 74, 71), (72, 67, 69, 72), (67, 64, 62, 0),
    (69, 76, 74, 72), (69, 72, 77, 76), (74, 72, 69, 65), (68, 71, 64, 0),
    (76, 79, 77, 76), (74, 71, 67, 71), (72, 76, 79, 76), (74, 71, 67, 74),
    (76, 84, 83, 81), (77, 76, 72, 69), (74, 77, 76, 74), (71, 74, 68, 0),
))

DUSK = Movement(.87, 3, (
    (38, 50, 57, 60), (46, 53, 58, 65), (36, 55, 60, 62), (45, 52, 57, 61),
    (38, 50, 57, 65), (43, 55, 58, 62), (39, 51, 58, 65), (45, 52, 57, 61),
), (
    (74, 69, 0, 72), (70, 65, 0, 69), (67, 72, 74, 67), (69, 64, 0, 67),
    (65, 69, 74, 77), (74, 70, 0, 65), (67, 65, 63, 62), (61, 64, 69, 0),
    (77, 72, 69, 72), (70, 74, 77, 0), (79, 77, 74, 72), (69, 73, 76, 0),
    (77, 76, 74, 72), (70, 74, 77, 74), (75, 77, 70, 67), (69, 64, 61, 0),
))


def tone(note, seconds, instrument, rng):
    t = np.arange(round(seconds * RATE)) / RATE
    f = 440 * 2 ** ((note - 69) / 12)
    phase = TAU * f * t
    if instrument == 'pluck':
        env = np.minimum(t / .007, 1) * np.exp(-3.7 * t)
        string = np.sin(phase) + .34 * np.sin(2.004 * phase) * np.exp(-3 * t)
        string += .16 * np.sin(3.012 * phase) * np.exp(-7 * t)
        return env * (string + .035 * rng.uniform(-1, 1, len(t)) * np.exp(-85 * t))
    if instrument == 'drum':
        body = np.sin(TAU * (58 * t + 3.2 * (1 - np.exp(-23 * t))))
        return np.minimum(t / .006, 1) * np.exp(-11 * t) * (body + .15 * rng.uniform(-1, 1, len(t)))
    if instrument == 'bow':
        vibrato = phase + .18 * np.sin(TAU * 4.45 * t)
        body = np.sin(vibrato) + .25 * np.sin(2.002 * vibrato) + .12 * np.sin(3 * vibrato)
        env = np.minimum(t / .27, 1) * np.minimum((seconds - t) / .35, 1)
        return env * body * (.84 + .16 * np.cos(TAU * .57 * t))
    vibrato = phase + .17 * np.sin(TAU * 4.9 * t) * (1 - np.exp(-7 * t))
    env = np.minimum(t / .068, 1) * np.minimum((seconds - t) / .155, 1)
    return env * (np.sin(vibrato) + .19 * np.sin(2 * vibrato) + .073 * np.sin(3 * vibrato))


def render(movement, mood):
    rng = np.random.default_rng(241)
    beat = movement.beat
    bar_length = beat * movement.meter
    count = len(movement.melody)
    stereo = np.zeros((round(RATE * bar_length * count), 2))

    def add(start, note, seconds, instrument, level, pan):
        wave = tone(note, seconds, instrument, rng) * level
        first = round(start * RATE)
        indices = (first + np.arange(len(wave))) % len(stereo)
        stereo[indices, 0] += wave * np.sqrt(1 - pan)
        stereo[indices, 1] += wave * np.sqrt(pan)

    for bar, phrase in enumerate(movement.melody):
        base = bar * bar_length
        bass, *chord = movement.chords[bar % len(movement.chords)]
        add(base, bass, bar_length + .2, 'bow', .145, .5)
        if bar % 2 == 0:
            add(base + .17 * beat, bass + 12, bar_length * .88, 'bow', .055, .66)
        plucks = (0, .75, 1.5, 2.35) if movement.meter == 3 else (0, .5, 1.25, 2, 2.75, 3.5)
        for index, position in enumerate(plucks):
            note = bass if index == 0 else chord[(index + bar) % 3]
            add(base + position * beat, note, 1.55, 'pluck', .134 if index == 0 else .102, .24 + .14 * (index % 4))
        entries = (0, 1, 1.5, 2.25) if movement.meter == 3 else (0, 1.5, 2.25, 3.0)
        for index, note in enumerate(phrase):
            if not note:
                continue
            until = entries[index + 1] if index < 3 else movement.meter
            if index < 3 and phrase[index + 1] == 0:
                until += .35
            hold = (until - entries[index] + .02) * beat
            if mood == 'dusk' and index % 2 == 1:
                add(base + entries[index] * beat, note - 12, 1.45, 'pluck', .108, .68)
            else:
                add(base + entries[index] * beat, note, hold, 'wind', .177 if mood == 'hall' else .164, .56)
        if mood == 'quest':
            add(base, bass, .38, 'drum', .085, .45)
            add(base + 2.5 * beat, bass, .34, 'drum', .045, .67)
    dry = stereo.copy()
    # The reflected sound crosses the loop seam together with the instruments.
    for delay, level in ((.071, .115), (.137, .08), (.229, .062), (.372, .045)):
        stereo += np.roll(dry[:, ::-1], round(delay * RATE), axis=0) * level
    # Match perceived loudness across the three arrangements, then leave peak headroom.
    stereo *= min(.095 / np.sqrt(np.mean(stereo ** 2)), .44 / np.max(np.abs(stereo)))
    return np.round(stereo * 32767).astype('<i2').tobytes()


if __name__ == '__main__':
    OUTPUT.mkdir(exist_ok=True)
    for name, score in [('hall', HALL), ('quest', QUEST), ('dusk', DUSK)]:
        subprocess.run([
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
            '-f', 's16le', '-ar', str(RATE), '-ac', '2', '-i', 'pipe:0',
            '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '96k', str(OUTPUT / f'{name}.mp3'),
        ], input=render(score, name), check=True)
