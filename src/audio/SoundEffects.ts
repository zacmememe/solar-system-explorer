/**
 * 纯 Web Audio API 离线程序化深空环境音效引擎
 * 100% 离线运行，0 外部音频文件依赖，0 网络带宽开销
 * 1. 深空微弱背景低鸣 (Cosmic Ambient Pad)
 * 2. 镜头空间曲率平移 (Warp Whoosh)
 * 3. 遥测交互轻音 (Telemetry Click)
 * 4. 雷达与近红外穿透扫描脉冲 (Radar / Infrared Scan)
 */

class SoundEffectsEngine {
  private ctx: AudioContext | null = null;
  private isMuted: boolean = true; // 默认静音，尊重用户控制，支持随时开启
  private droneGain: GainNode | null = null;
  private droneOsc1: OscillatorNode | null = null;
  private droneOsc2: OscillatorNode | null = null;
  private masterGain: GainNode | null = null;

  constructor() {
    // 检查本地持久化静音设置
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('solar_explorer_audio_muted');
      if (saved !== null) {
        this.isMuted = saved === 'true';
      }
    }
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : 0.35, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (typeof window !== 'undefined') {
      localStorage.setItem('solar_explorer_audio_muted', this.isMuted.toString());
    }

    const ctx = this.ensureContext();
    if (ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : 0.35, ctx.currentTime, 0.05);
    }

    if (!this.isMuted) {
      this.startAmbientDrone();
    } else {
      this.stopAmbientDrone();
    }

    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }

  /**
   * 启动极低频空灵深空背景音（双微调正弦波 + 动态低通滤波）
   */
  public startAmbientDrone(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (this.droneGain) return; // 已经在运行

    try {
      this.droneGain = ctx.createGain();
      this.droneGain.gain.setValueAtTime(0.001, ctx.currentTime);
      this.droneGain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 3.0);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(140, ctx.currentTime);

      this.droneOsc1 = ctx.createOscillator();
      this.droneOsc1.type = 'sine';
      this.droneOsc1.frequency.setValueAtTime(55, ctx.currentTime); // A1 基频

      this.droneOsc2 = ctx.createOscillator();
      this.droneOsc2.type = 'sine';
      this.droneOsc2.frequency.setValueAtTime(110.3, ctx.currentTime); // A2 谐波伴随微弱拍频

      this.droneOsc1.connect(filter);
      this.droneOsc2.connect(filter);
      filter.connect(this.droneGain);
      this.droneGain.connect(this.masterGain);

      this.droneOsc1.start();
      this.droneOsc2.start();
    } catch {
      // 容错处理
    }
  }

  public stopAmbientDrone(): void {
    if (!this.droneGain || !this.ctx) return;
    try {
      this.droneGain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.8);
      setTimeout(() => {
        this.droneOsc1?.stop();
        this.droneOsc2?.stop();
        this.droneOsc1?.disconnect();
        this.droneOsc2?.disconnect();
        this.droneGain?.disconnect();
        this.droneGain = null;
        this.droneOsc1 = null;
        this.droneOsc2 = null;
      }, 900);
    } catch {
      this.droneGain = null;
    }
  }

  /**
   * 界面遥测点击微响 (Soft UI Telemetry Click)
   */
  public playClick(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch {
      // 忽略
    }
  }

  /**
   * 飞向目标天体时的低频曲率平移微声 (Warp Whoosh)
   */
  public playWarp(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(120, ctx.currentTime);
      filter.frequency.linearRampToValueAtTime(480, ctx.currentTime + 0.8);
      filter.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 2.0);

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(70, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(140, ctx.currentTime + 0.8);
      osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 2.0);

      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.6);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.0);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc.start();
      osc.stop(ctx.currentTime + 2.1);
    } catch {
      // 忽略
    }
  }

  /**
   * 雷达/近红外穿透扫描脉冲音 (Radar / IR Ping)
   */
  public playRadarPing(): void {
    if (this.isMuted) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.22);

      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(this.masterGain);

      osc.start();
      osc.stop(ctx.currentTime + 0.26);
    } catch {
      // 忽略
    }
  }
}

export const soundEffects = new SoundEffectsEngine();
