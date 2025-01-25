import { executeRead, executeWrite } from './neo4j/graph-service.js';
import { createLogger } from '../core/index.js';


const log = createLogger('graph-rag-service');

export interface GlobalSummary {
  objectCount: number;
  topObjects: string[];
  keyRelationships: string[];
  businessDomainSummary: string;
  lastUpdated: string;
}

/**
 * Service to handle "Global" queries using GraphRAG Lite principles.
 * Retrieves high-level summary context when the user asks broad questions.
 */
export class GraphRagService {
  private static instance: GraphRagService;

  private constructor() {}

  public static getInstance(): GraphRagService {
    if (!GraphRagService.instance) {
      GraphRagService.instance = new GraphRagService();
    }
    return GraphRagService.instance;
  }

  /**
   * Detect if a query has "Global Intent" and retrieve context if so.
   * Global Intent examples: "Summarize sales", "How is my data structured?", "Overview of the org".
   */
  public async getGlobalContext(query: string): Promise<string | null> {
    try {
      // 1. Detect Intent
      const isGlobal = await this.detectGlobalIntent(query);
      if (!isGlobal) {
        return null;
      }

      // 2. Fetch Summary Node
      const summary = await this.getGlobalSummary();
      if (!summary) {
        log.debug('Global intent detected but no summary node found.');
        return null;
      }

      // 3. Format for LLM
      return this.formatSummaryForPrompt(summary);
    } catch (error) {
      log.warn({ err: error }, 'Failed to retrieve global context');
      return null;
    }
  }

  /**
   * Simple heuristic + NLP check for global intent.
   */
  private async detectGlobalIntent(query: string): Promise<boolean> {
    const normalize = query.toLowerCase();
    
    // 1. Keyword Heuristics
    const globalKeywords = [
      'overview', 'summarize', 'summary', 'structure', 'schema', 
      'how is my data', 'what objects', 'top objects', 'data model',
      'big picture', 'all data', 'trends'
    ];
    
    if (globalKeywords.some(kw => normalize.includes(kw))) {
      return true;
    }

    // 2. NLP Processor Check (if keywords aren't enough, we could check intent string)
    // 2. NLP Processor Check (if keywords aren't enough, we could check intent string)
    // For now, let's stick to heuristics for speed as per "Lite" implementation.

    return false;
  }

  /**
   * Fetch the singleton GlobalSummary node from Neo4j.
   */
  private async getGlobalSummary(): Promise<GlobalSummary | null> {
    const result = await executeRead<{ summary: GlobalSummary }>(
      `
      MATCH (n:GlobalSummary {id: 'main'})
      RETURN n {
        .objectCount,
        .topObjects,
        .keyRelationships,
        .businessDomainSummary,
        .lastUpdated
      } as summary
      `
    );

    if (result.length === 0) {
      return null;
    }

    return result[0].get('summary');
  }

  /**
   * Update or Create the Global Summary node.
   * This would typically be run by a nightly job or explicit CLI command.
   */
  public async updateGlobalSummary(): Promise<void> {
    log.info('Updating Global Summary node...');

    // Aggregation Query
    // 1. Count objects
    // 2. Find top 5 connected objects (PageRank-ish or just degree centrality)
    // 3. Identify custom vs standard ratio
    
    await executeWrite(
      `
      // Calculate Stats
      MATCH (o:Object)
      WITH count(o) as objCount, collect(o) as allObjs
      
      // Top Objects by Relationship Count
      MATCH (n:Object)-[r]-()
      WITH objCount, n, count(r) as degree
      ORDER BY degree DESC
      LIMIT 5
      WITH objCount, collect(n.apiName + ' (' + degree + ' rels)') as topObjs
      
      // Merge Summary Node
      MERGE (s:GlobalSummary {id: 'main'})
      SET s.objectCount = objCount,
          s.topObjects = topObjs,
          s.lastUpdated = datetime()
          
      // Note: keyRelationships and businessDomainSummary would ideally be populated 
      // by an LLM analyzing the schema, but we'll leave them empty or placeholder for now.
      `
    );
    
    log.info('Global Summary node updated.');
  }

  private formatSummaryForPrompt(summary: GlobalSummary): string {
    return `
GLOBAL ORG CONTEXT:
- Total Objects: ${summary.objectCount}
- Key/Central Objects: ${summary.topObjects.join(', ')}
${summary.businessDomainSummary ? `- Domain Summary: ${summary.businessDomainSummary}` : ''}
${summary.keyRelationships ? `- Key Patterns: ${summary.keyRelationships.join(', ')}` : ''}
(Use this high-level context if the user asks for an overview or broad summaries.)
    `.trim();
  }
}

export const graphRagService = GraphRagService.getInstance();
