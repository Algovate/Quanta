export class DrawdownTracker {
  private steps: number[];
  private peakEquity?: number;
  private nextIdx: number = 0;

  constructor(steps: number[]) {
    this.steps = [...steps].sort((a, b) => a - b);
  }

  update(equity: number): { crossed: number | null; ddPct: number } {
    this.peakEquity = Math.max(this.peakEquity ?? equity, equity);
    const ddPct = this.peakEquity > 0 ? ((this.peakEquity - equity) / this.peakEquity) * 100 : 0;
    if (this.nextIdx < this.steps.length && ddPct >= this.steps[this.nextIdx]) {
      const crossed = this.steps[this.nextIdx];
      this.nextIdx++;
      return { crossed, ddPct };
    }
    return { crossed: null, ddPct };
  }

  reset(): void {
    this.peakEquity = undefined;
    this.nextIdx = 0;
  }
}
