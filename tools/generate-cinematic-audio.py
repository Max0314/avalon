"""Render original Avalon prop Foley cues as deterministic mono MP3s."""
from math import exp, pi, sin
from pathlib import Path
from random import Random
import struct
import subprocess

RATE = 24000
OUT = Path(__file__).resolve().parent.parent / 'audio' / 'cinematics'


class Cue:
    def __init__(self, seconds, seed):
        self.frames = [0.0] * int(seconds * RATE)
        self.random = Random(seed)

    def add(self, start, length, generator):
        start_frame = int(start * RATE)
        for frame in range(min(len(self.frames) - start_frame, int(length * RATE))):
            self.frames[start_frame + frame] += generator(frame / RATE)

    def rustle(self, at, length, volume, color=.22):
        soft = 0
        pulse = self.random.uniform(37, 62)

        def sound(t):
            nonlocal soft
            white = self.random.uniform(-1, 1)
            soft += color * (white - soft)
            sweep = sin(pi * t / length) ** 1.7
            fray = .72 + .2 * sin(2 * pi * pulse * t) + .08 * sin(2 * pi * 146 * t)
            return (soft - .23 * white) * sweep * fray * volume

        self.add(at, length, sound)

    def impact(self, at, weight, volume, color):
        self.rustle(at, .054, volume * .75, color)
        self.ring(at, weight, .15, volume * .66, (.9, 2.3, 3.9), decay=36)

    def ring(self, at, pitch, length, volume, partials=(1, 2.12, 3.49), decay=5):
        def sound(t):
            attack = min(1, t * 340)
            release = min(1, (length - t) * 90)
            harmonics = sum(sin(2 * pi * pitch * n * t) / (i + 1) ** 1.8
                            for i, n in enumerate(partials))
            return harmonics * attack * release * exp(-decay * t) * volume

        self.add(at, length, sound)

    def drop(self, at, pitch, volume):
        def sound(t):
            bend = pitch * t + pitch * 7 * t * t
            return sin(2 * pi * bend) * min(1,t*450) * exp(-36*t) * volume

        self.add(at,.19,sound)

    def write(self, name):
        peak = max(abs(value) for value in self.frames) or 1
        gain = min(1, .55 / peak)
        data = struct.pack('<' + 'h' * len(self.frames), *(int(x * gain * 32767) for x in self.frames))
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','s16le',
                        '-ar',str(RATE),'-ac','1','-i','pipe:0','-map_metadata','-1',
                        '-c:a','libmp3lame','-b:a','56k',str(OUT / (name + '.mp3'))],
                       input=data,check=True)


def paper(cue):
    cue.rustle(.014,.24,.44,.54)
    cue.rustle(.191,.22,.31,.38)
    cue.impact(.276,157,.033,.71)


def wax(cue):
    cue.rustle(.036,.16,.18,.42)
    cue.impact(.19,110,.37,.61)
    cue.impact(.228,171,.085,.71)


def seal(cue):
    cue.rustle(.07,.38,.32,.5)
    cue.impact(.59,97,.45,.36)
    cue.rustle(.72,.23,.21,.62)
    cue.impact(.87,158,.28,.62)
    cue.ring(.91,205,.76,.13)
    cue.ring(.96,305,.68,.092)


def card(cue):
    cue.rustle(.022,.16,.46,.59)
    cue.impact(.22,136,.28,.48)
    cue.rustle(.33,.25,.11,.49)


def scroll(cue):
    cue.rustle(.08,.26,.31,.35)
    cue.rustle(.24,.43,.38,.56)
    cue.impact(.63,103,.32,.48)
    cue.ring(.63,141,.6,.1,decay=9)


def ballot(cue, approved):
    cue.rustle(.09,.38,.21,.49)
    cue.impact(.73,140 if approved else 75,.44,.43)
    cue.ring(.76,318 if approved else 130,.69,.17)
    cue.ring(.85,476 if approved else 97,.82,.086,decay=3.7)


def shield(cue, success):
    for at, weight in [(.19,129),(.33,142),(.49,126)]:
        cue.rustle(at,.15,.22,.56)
        cue.impact(at+.09,weight,.22,.42)
    cue.impact(1.02,84 if success else 51,.46,.48)
    cue.ring(1.05,233 if success else 117,1.14,.24,decay=3.8)
    cue.ring(1.13,350 if success else 98,.89,.095)


def water(cue):
    cue.rustle(.06,.87,.14,.13)
    for at,pitch in [(.35,670),(.52,498),(.61,724),(.79,523)]:
        cue.drop(at,pitch,.16)
    cue.ring(.77,364,.98,.08,decay=2.7)


def oath(cue):
    cue.rustle(.1,.69,.22,.09)
    cue.impact(.76,66,.46,.29)
    cue.ring(.76,103,1.02,.21,decay=3.3)
    cue.ring(.87,156,.86,.092)


def crown(cue, light):
    cue.rustle(.11,.62,.18,.19)
    cue.impact(.94,111 if light else 60,.4,.46)
    tones = (220,330,440) if light else (110,156,195)
    for index,pitch in enumerate(tones):
        cue.ring(1+index*.07,pitch,1.5-index*.08,.15-index*.027,decay=2.2)


if __name__ == '__main__':
    OUT.mkdir(parents=True,exist_ok=True)
    score = [
        ('paper',.49,paper),('wax',.45,wax),('seal',1.7,seal),('card',.68,card),
        ('scroll',1.35,scroll),('vote-yes',1.84,lambda cue:ballot(cue,True)),
        ('vote-no',1.84,lambda cue:ballot(cue,False)),
        ('shield-light',2.22,lambda cue:shield(cue,True)),('shield-dark',2.22,lambda cue:shield(cue,False)),
        ('water',1.85,water),('oath',1.86,oath),('crown-light',2.62,lambda cue:crown(cue,True)),
        ('crown-dark',2.62,lambda cue:crown(cue,False)),
    ]
    for seed,(name,length,render) in enumerate(score):
        cue = Cue(length,seed)
        render(cue)
        cue.write(name)
