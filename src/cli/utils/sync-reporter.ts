import { SyncProgress } from '../../core/types.js';

export class SyncReporter {
  private spinnerFrames = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];
  private spinnerIdx = 0;
  private currentPhase: string | null = null;
  private phaseStartTime = Date.now();
  private lastCounts = { current: 0, total: 0 };
  private headerMsg: string;

  constructor(headerMsg: string) {
    this.headerMsg = headerMsg;
    process.stdout.write(headerMsg);
  }

  public onProgress(progress: SyncProgress): void {
    // Check if we're starting a new phase
    if (this.currentPhase !== progress.phase) {
      const wasHidden = this.isHidden(this.currentPhase);
      const isVisible = !this.isHidden(progress.phase);

      // Transition from hidden/null to visible
      if (wasHidden && isVisible) {
        process.stdout.write(`\r\x1b[K${this.headerMsg}\n\n`);
      }

      // Complete previous phase
      if (this.currentPhase !== null && !wasHidden) {
        this.completePhase(this.currentPhase);
      }

      // Start new phase
      this.currentPhase = progress.phase;
      this.phaseStartTime = Date.now();
      this.lastCounts = { current: 0, total: 0 };
    }

    // Track state
    this.lastCounts = { current: progress.current, total: progress.total };

    // Update display
    if (!this.isHidden(this.currentPhase)) {
      this.renderVisibleProgress(progress);
    } else {
      this.renderHiddenProgress();
    }
  }

  public finish(): void {
    if (this.currentPhase !== null && !this.isHidden(this.currentPhase)) {
      this.completePhase(this.currentPhase);
    } else {
      process.stdout.write('\r\x1b[K');
    }
  }

  /**
   * Restart reporter for post-sync phases (embeddings, categorization).
   */
  public startPostSyncPhases(headerMsg: string): void {
    this.headerMsg = headerMsg;
    this.currentPhase = null;
    process.stdout.write(headerMsg);
  }

  private isHidden(phase: string | null): boolean {
    return phase === null || phase === 'listing' || phase === 'describing';
  }

  private completePhase(phase: string): void {
    const duration = Date.now() - this.phaseStartTime;
    const label = this.getPhaseLabel(phase);
    process.stdout.write(
      `\r\x1b[K${label}: ${this.lastCounts.current}/${this.lastCounts.total}...done [${duration}ms]\n`
    );
  }

  private renderVisibleProgress(progress: SyncProgress): void {
    const pct = progress.total > 0 
      ? Math.round((progress.current / progress.total) * 100) 
      : 0;
    const label = this.getPhaseLabel(progress.phase);
    const frame = this.getFrame();
    process.stdout.write(
      `\r${label}: ${progress.current}/${progress.total}... ${frame} [${pct}%]`
    );
  }

  private renderHiddenProgress(): void {
    const frame = this.getFrame();
    process.stdout.write(`\r${this.headerMsg}${frame}`);
  }

  private getFrame(): string {
    return this.spinnerFrames[this.spinnerIdx++ % this.spinnerFrames.length];
  }

  private getPhaseLabel(phase: string): string {
    switch (phase) {
      case 'objects': return 'Objects';
      case 'fields': return 'Fields';
      case 'picklistValues': return 'Picklist Values';
      case 'picklistEnrichment': return 'Picklist Enrichments';
      case 'relationships': return 'Relationships';
      case 'dependencies': return 'Field Dependencies';
      case 'objectEmbeddings': return 'Object Embeddings';
      case 'fieldEmbeddings': return 'Field Embeddings';
      case 'categorization': return 'Categorization';
      default: return phase;
    }
  }
}
