/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

class SoundManager {
  private ctx: AudioContext | null = null;
  private masterVolume: number = 0.5;
  private sfxEnabled: boolean = true;
  private musicInterval: any = null;

  init() {
    if (this.ctx) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    } catch (e) {
      console.warn("Web Audio API not supported", e);
    }
  }

  setVolume(vol: number) {
    this.masterVolume = vol;
  }

  setSFXEnabled(enabled: boolean) {
    this.sfxEnabled = enabled;
  }

  private playTone(freq: number, type: OscillatorType, duration: number, slideTo?: number, delay: number = 0) {
    this.init();
    if (!this.ctx || !this.sfxEnabled || this.masterVolume === 0) return;

    setTimeout(() => {
      if (!this.ctx) return;
      try {
        const osc = this.ctx.createOscillator();
        const gainNode = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        
        if (slideTo) {
          osc.frequency.exponentialRampToValueAtTime(slideTo, this.ctx.currentTime + duration);
        }

        gainNode.gain.setValueAtTime(this.masterVolume * 0.2, this.ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);

        osc.connect(gainNode);
        gainNode.connect(this.ctx.destination);

        osc.start();
        osc.stop(this.ctx.currentTime + duration);
      } catch (e) {
        // Safe fail
      }
    }, delay * 1000);
  }

  playClick() {
    this.playTone(600, 'sine', 0.08, 200);
  }

  playMove() {
    this.playTone(220, 'triangle', 0.15, 440);
  }

  playHit() {
    this.playTone(150, 'sawtooth', 0.2, 50);
    // Add noise-like high-frequency element
    this.playTone(800, 'sine', 0.1, 100, 0.02);
  }

  playHeal() {
    this.playTone(330, 'sine', 0.4, 660);
    this.playTone(440, 'sine', 0.4, 880, 0.1);
    this.playTone(550, 'sine', 0.4, 1100, 0.2);
  }

  playFreeze() {
    this.playTone(900, 'sine', 0.3, 300);
    this.playTone(1200, 'triangle', 0.4, 400, 0.05);
  }

  playWall() {
    this.playTone(100, 'sawtooth', 0.3, 150);
    this.playTone(120, 'triangle', 0.35, 180, 0.05);
  }

  playDeath() {
    this.playTone(300, 'sawtooth', 0.5, 80);
    this.playTone(180, 'sine', 0.6, 50, 0.1);
  }

  playSuper() {
    const scale = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99];
    scale.forEach((freq, index) => {
      this.playTone(freq, 'sine', 0.3, freq * 1.2, index * 0.08);
    });
  }

  playVictory() {
    const fanfare = [392.00, 392.00, 392.00, 523.25, 659.25, 783.99];
    const timings = [0, 0.15, 0.3, 0.45, 0.6, 0.75];
    fanfare.forEach((freq, index) => {
      this.playTone(freq, 'triangle', 0.4, freq, timings[index]);
    });
  }
}

export const sound = new SoundManager();
