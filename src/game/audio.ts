/** tiny webaudio synth for feedback blips — zero assets, everything is oscillators */
export class AudioEngine {
    private ctx: AudioContext | null = null;
    muted = false;

    /** browsers require a user gesture before audio; call this from any input handler */
    unlock(): void {
        this.ensure();
    }

    private ensure(): AudioContext {
        if (!this.ctx) this.ctx = new AudioContext();
        if (this.ctx.state === "suspended") void this.ctx.resume();
        return this.ctx;
    }

    private blip(
        freq: number,
        duration: number,
        type: OscillatorType,
        gain: number,
        delay = 0
    ): void {
        if (this.muted || !this.ctx) return;
        const ctx = this.ctx;
        const t = ctx.currentTime + delay;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        osc.connect(g).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + duration);
    }

    /** crit blip: pitch and presence climb with the chain tier; silent for normal hits */
    attack(tier: number): void {
        if (tier < 1 || !this.ctx) return;
        const freq = 220 * Math.pow(1.26, tier);
        this.blip(freq, 0.12 + tier * 0.02, "square", Math.min(0.02 + tier * 0.012, 0.1));
        if (tier >= 4) this.blip(freq * 1.5, 0.25, "sawtooth", 0.05, 0.03);
    }

    /** golden hits get a little coin arpeggio */
    golden(): void {
        this.blip(880, 0.1, "triangle", 0.08);
        this.blip(1174, 0.1, "triangle", 0.08, 0.07);
        this.blip(1568, 0.18, "triangle", 0.08, 0.14);
    }

    /** purchase confirmation: two-note thunk-chime */
    buy(): void {
        this.blip(196, 0.08, "square", 0.07);
        this.blip(392, 0.15, "triangle", 0.09, 0.06);
    }

    /** frenzy ignition: rising four-note sweep */
    frenzy(): void {
        [330, 440, 587, 784].forEach((f, i) => this.blip(f, 0.14, "sawtooth", 0.07, i * 0.07));
    }

    /** jackpot catch: big slot-machine payout arpeggio */
    jackpot(): void {
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.blip(f, 0.2, "triangle", 0.1, i * 0.06));
        this.blip(262, 0.5, "square", 0.05, 0.1);
    }
}
