//Semantic knowledge graph of a codebase, 

import * as fs from 'fs';
import * as path from 'path';
import { PythonParser } from '../parsers/pythonParser';
import { CppParser } from '../parsers/cppParser';

/**
 * Represents a node in the knowledge graph (file, class, function, etc.)
 */
export interface GraphNode {
  id: string;
  type: 'file' | 'class' | 'function' | 'method' | 'variable' | 'namespace';
  name: string;
  displayName: string;
  location: {
    filePath: string;
    startLine: number;
    endLine: number;
    startCol?: number;
    endCol?: number;
  };
  metadata?: Record<string, any>;
}

/**
 * Represents a relationship between two nodes
 */
export interface GraphEdge {
  source: string; // Source node ID
  target: string; // Target node ID
  type: 'imports' | 'defines' | 'calls' | 'inherits' | 'contains' | 'references' | 'belongsTo';
  weight?: number; // Strength of relationship
  metadata?: Record<string, any>;
}

/**
 * The knowledge graph data structure
 */
export interface KnowledgeGraph {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

/**
 * Language-specific parser that extracts entities and relationships
 */
export interface LanguageParser {
  getFileEntities(filePath: string, fileContent: string): Promise<GraphNode[]>;
  getRelationships(filePath: string, fileContent: string, allNodes: Map<string, GraphNode>, allRelationships?: boolean): Promise<GraphEdge[]>;
}

/**
 * Builds a semantic knowledge graph of a codebase
 */
export class KnowledgeGraphBuilder {
  private graph: KnowledgeGraph;
  private parsers: Map<string, LanguageParser>;
  private rootPath: string;
  private storagePath: string;
  private includeDirectories: string[]; // Additional include directories to search

  constructor(rootPath: string, includeDirectories: string[] = [], storagePath?: string) {
    this.rootPath = rootPath;
    this.storagePath = storagePath || path.join(rootPath, '.knowledge-graph');
    this.includeDirectories = [rootPath, ...includeDirectories];
    this.graph = {
      nodes: new Map<string, GraphNode>(),
      edges: []
    };
    
    // Initialize parsers for supported languages
    this.parsers = new Map<string, LanguageParser>();
    this.parsers.set('.py', new PythonParser(rootPath));
    this.parsers.set('.cpp', new CppParser(rootPath));
    this.parsers.set('.h', new CppParser(rootPath));
    this.parsers.set('.hpp', new CppParser(rootPath));
  }

  /**
   * Build the knowledge graph from given file paths
   */
  public async buildGraph(
    filePaths: string[], 
    onlyFileNode?: boolean, 
    progressCallback?: (message: string) => void
  ): Promise<KnowledgeGraph> {
    progressCallback?.("Building knowledge graph: extracting entities...");
    
    // Create a map of normalized file paths for quick lookup
    const normalizedFilePathMap = new Map<string, string>();
    for (const filePath of filePaths) {
      const normalizedPath = path.normalize(filePath).toLowerCase();
      normalizedFilePathMap.set(normalizedPath, filePath);
      
      // Also map the filename alone for potential include matching
      const fileName = path.basename(filePath);
      normalizedFilePathMap.set(fileName.toLowerCase(), filePath);
    }
    // First pass: Extract all semantic entities (files, classes, functions)
    let processed = 0;
    for (const filePath of filePaths) {
      try {
        const ext = path.extname(filePath).toLowerCase();
        const parser = this.parsers.get(ext);
        
        if (parser) {
          const fileContent = await fs.promises.readFile(filePath, 'utf8');
          
          // Create a basic file node
          const fileNode: GraphNode = {
            id: this.getNodeId('file', filePath),
            type: 'file',
            name: path.basename(filePath),
            displayName: path.relative(this.rootPath, filePath),
            location: {
              filePath,
              startLine: 0,
              endLine: fileContent.split('\n').length - 1
            }
          };
          this.graph.nodes.set(fileNode.id, fileNode);
          
          if (onlyFileNode) continue;
          // Extract all entities in the file
          const entities = await parser.getFileEntities(filePath, fileContent);
          for (const entity of entities) {
            this.graph.nodes.set(entity.id, entity);
            
            // Add "contains" relationship from file to entity
            this.graph.edges.push({
              source: fileNode.id,
              target: entity.id,
              type: 'contains'
            });
          }
        }
        
        processed++;
        if (processed % 10 === 0) {
          progressCallback?.(`Extracted entities from ${processed}/${filePaths.length} files`);
        }
      } catch (error) {
        console.error(`Error extracting entities from ${filePath}:`, error);
      }
    }
    
    // Second pass: Extract relationships between entities
    processed = 0;
    progressCallback?.("Building knowledge graph: analyzing relationships...");
    
    // Collect all include relationships first
    const includeRelationships: GraphEdge[] = [];
    
    for (const filePath of filePaths) {
      try {
        const ext = path.extname(filePath).toLowerCase();
        const parser = this.parsers.get(ext);
        
        if (parser) {
          const fileContent = await fs.promises.readFile(filePath, 'utf8');
          const relationships = await parser.getRelationships(filePath, fileContent, this.graph.nodes, onlyFileNode);
          
          // Filter out include relationships for special handling
          for (const edge of relationships) {
            if (edge.type === 'imports' && edge.metadata?.importType === 'include') {
              includeRelationships.push(edge);
            } else {
              this.graph.edges.push(edge);
            }
          }
        }
        
        processed++;
        if (processed % 10 === 0) {
          progressCallback?.(`Analyzed relationships for ${processed}/${filePaths.length} files`);
        }
      } catch (error) {
        console.error(`Error extracting relationships from ${filePath}:`, error);
      }
    }
    
    // Process include relationships with proper resolution
    progressCallback?.("Resolving include relationships...");
    await this.resolveIncludeRelationships(includeRelationships, normalizedFilePathMap);
    
    // Post-processing: Calculate relationship weights based on call frequency, etc.
    // this.calculateRelationshipWeights();
    
    await this.saveGraph();
    
    progressCallback?.(
      `Knowledge graph complete. ${this.graph.nodes.size} entities and ${this.graph.edges.length} relationships.`
    );
    
    return this.graph;
  }
  
  /**
   * Resolve include relationships to actual files in the codebase
   */
  private async resolveIncludeRelationships(
    includeRelationships: GraphEdge[],
    normalizedFilePathMap: Map<string, string>
  ): Promise<void> {
    for (const edge of includeRelationships) {
      // The target is in the format "file:includePath"
      const includePath = edge.target; //.substring(5); // Remove "file:" prefix
      console.log(`include path: ${includePath}, normalizedpath: ${normalizedFilePathMap}`);
      // Try to resolve the include path to an actual file in the codebase
      const resolvedPath = await this.resolveIncludePath(includePath, normalizedFilePathMap);
      console.log(`include resolved: ${resolvedPath}`);
      
      if (resolvedPath) {
        // Update the edge to point to the resolved file
        edge.target = this.getNodeId('file', resolvedPath);
        
        // Add the resolved edge to the graph
        this.graph.edges.push(edge);
      } else {
        // For includes we couldn't resolve, still add the edge but mark it
        edge.metadata = {
          ...edge.metadata,
          resolved: false
        };
        this.graph.edges.push(edge);
      }
    }
  }
  
  /**
   * Try to resolve an include path to an actual file in the codebase
   */
  private async resolveIncludePath(
    includePath: string, 
    normalizedFilePathMap: Map<string, string>
  ): Promise<string | null> {
    // Case 1: Direct match with a file in our codebase
    const normalizedIncludePath = includePath.toLowerCase();
    if (normalizedFilePathMap.has(normalizedIncludePath)) {
      return normalizedFilePathMap.get(normalizedIncludePath)!;
    }
    
    // Case 2: Just the filename matches
    const includeFileName = path.basename(includePath).toLowerCase();
    if (normalizedFilePathMap.has(includeFileName)) {
      return normalizedFilePathMap.get(includeFileName)!;
    }
    
    // Case 3: Search in include directories
    for (const dir of this.includeDirectories) {
      const potentialPath = path.join(dir, includePath);
      if (fs.existsSync(potentialPath)) {
        return potentialPath;
      }
    }
    
    return null;
  }
  
  // /**
  //  * Calculate weights for relationships based on frequency
  //  */
  // private calculateRelationshipWeights(): void {
  //   // Group edges by type and count occurrences
  //   const edgeCounts = new Map<string, number>();
    
  //   for (const edge of this.graph.edges) {
  //     const key = `${edge.source}:${edge.target}:${edge.type}`;
  //     edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  //   }
    
  //   // Assign weights based on occurrence counts
  //   for (const edge of this.graph.edges) {
  //     const key = `${edge.source}:${edge.target}:${edge.type}`;
  //     edge.weight = edgeCounts.get(key) || 1;
  //   }
  // }
  
  /**
   * Save the knowledge graph to disk
   */
  private async saveGraph(filename: string = 'knowledge-graph.json'): Promise<void> {
    // Ensure directory exists
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
    }
    
    // Convert to serializable format
    const serializable = {
      nodes: Array.from(this.graph.nodes.values()),
      edges: this.graph.edges
    };
    
    const graphPath = path.join(this.storagePath, filename);
    await fs.promises.writeFile(graphPath, JSON.stringify(serializable, null, 2));
  }
  
  /**
   * Generate a unique ID for a node
   */
  private getNodeId(type: string, filePath: string, name?: string): string {
    if (type === 'file') {
      return `file:${path.relative(this.rootPath, filePath)}`;
    }
    return `${type}:${path.relative(this.rootPath, filePath)}:${name}`;
  }
  
  /**
   * Get the graph data
   */
  public getGraph(): KnowledgeGraph {
    return this.graph;
  }
}