//Base parser class with common functionality
import * as path from 'path';
import Parser from 'tree-sitter';
import { GraphNode, GraphEdge, LanguageParser } from '../Graph/knowledgeGraph';


export abstract class BaseParser implements LanguageParser {
  protected parser: Parser;
  protected language: any;
  protected rootPath: string;
  
  constructor(language: any, rootPath: string) {
    this.parser = new Parser();
    this.language = language;
    this.parser.setLanguage(language);
    this.rootPath = rootPath;
  }
  
  /**
   * Get all entities (classes, functions) from a file
   */
  abstract getFileEntities(filePath: string, fileContent: string): Promise<GraphNode[]>;
  
  /**
   * Get relationships between entities
   */
  abstract getRelationships(
    filePath: string, 
    fileContent: string, 
    allNodes: Map<string, GraphNode>
  ): Promise<GraphEdge[]>;
  
  /**
   * Helper to get line and column position
   */
  protected getPosition(point: Parser.Point, fileContent: string): { line: number, col: number } {
    return {
      line: point.row + 1, // Tree-sitter uses 0-based indexing
      col: point.column + 1
    };
  }
  
  /**
   * Generate a unique ID for a node
   */
  protected getNodeId(type: string, filePath: string, name?: string): string {
    if (type === 'file') {
      return `file:${path.relative(this.rootPath, filePath)}`;
    }
    return `${type}:${path.relative(this.rootPath, filePath)}:${name}`;
  }
}
  