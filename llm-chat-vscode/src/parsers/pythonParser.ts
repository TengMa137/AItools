//Python language parser using Tree-sitter

import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';
import { GraphNode, GraphEdge } from '../Graph/knowledgeGraph';
import { BaseParser } from './baseParser'

/**
 * Python language parser using Tree-sitter
 */
export class PythonParser extends BaseParser {
  constructor(rootPath: string) {
    super(Python, rootPath);
  }

  /**
   * Extract classes and functions from Python file
   */
  async getFileEntities(filePath: string, fileContent: string): Promise<GraphNode[]> {
    const nodes: GraphNode[] = [];
    const tree = this.parser.parse(fileContent);
    const root = tree.rootNode;
    
    // Find all class and function definitions (top-level, skip inner implementations)
    const classNodes = this.findNodes(root, 'class_definition');
    const functionNodes = this.findNodes(root, 'function_definition');
    
    // Process class definitions
    for (const node of classNodes) {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) continue;
      
      const className = fileContent.substring(nameNode.startIndex, nameNode.endIndex);
      const startPos = this.getPosition(node.startPosition, fileContent);
      const endPos = this.getPosition(node.endPosition, fileContent);
      
      const classNode: GraphNode = {
        id: this.getNodeId('class', filePath, className),
        type: 'class',
        name: className,
        displayName: className,
        location: {
          filePath,
          startLine: startPos.line,
          endLine: endPos.line,
          startCol: startPos.col,
          endCol: endPos.col
        },
        metadata: {
          // Get inheritance info
          inherits: this.extractInheritance(node, fileContent)
        }
      };
      
      nodes.push(classNode);
      
      // Get methods of this class (but skip their implementation details)
      const methods = this.findNodes(node, 'function_definition');
      for (const mNode of methods) {
        const methodNameNode = mNode.childForFieldName('name');
        if (!methodNameNode) continue;
        
        const methodName = fileContent.substring(methodNameNode.startIndex, methodNameNode.endIndex);
        const methodStartPos = this.getPosition(mNode.startPosition, fileContent);
        const methodEndPos = this.getPosition(mNode.endPosition, fileContent);
        
        const methodNode: GraphNode = {
          id: this.getNodeId('method', filePath, `${className}.${methodName}`),
          type: 'method',
          name: methodName,
          displayName: `${className}.${methodName}`,
          location: {
            filePath,
            startLine: methodStartPos.line,
            endLine: methodEndPos.line,
            startCol: methodStartPos.col,
            endCol: methodEndPos.col
          },
          metadata: {
            parentClass: classNode.id,
            parameters: this.extractFunctionParams(mNode, fileContent)
          }
        };
        
        nodes.push(methodNode);
      }
    }
    
    // Process top-level function definitions (skip inner functions)
    for (const node of functionNodes) {
      // Skip functions that are inside classes (already handled above)
      if (this.isInsideClass(node)) continue;
      
      const nameNode = node.childForFieldName('name');
      if (!nameNode) continue;
      
      const funcName = fileContent.substring(nameNode.startIndex, nameNode.endIndex);
      const startPos = this.getPosition(node.startPosition, fileContent);
      const endPos = this.getPosition(node.endPosition, fileContent);
      
      const functionNode: GraphNode = {
        id: this.getNodeId('function', filePath, funcName),
        type: 'function',
        name: funcName,
        displayName: funcName,
        location: {
          filePath,
          startLine: startPos.line,
          endLine: endPos.line,
          startCol: startPos.col,
          endCol: endPos.col
        },
        metadata: {
          parameters: this.extractFunctionParams(node, fileContent)
        }
      };
      
      nodes.push(functionNode);
    }
    
    return nodes;
  }

  /**
   * Extract relationships between Python entities
   */
  async getRelationships(
    filePath: string, 
    fileContent: string, 
    allNodes: Map<string, GraphNode>,
    onlyFileRelationship: boolean = false
  ): Promise<GraphEdge[]> {
    const edges: GraphEdge[] = [];
    const tree = this.parser.parse(fileContent);
    const root = tree.rootNode;
    
    // Find import statements
    this.findImportRelationships(root, fileContent, filePath, edges);
    if (onlyFileRelationship){
      return edges;
    }
    
    // Find class inheritance relationships
    this.findInheritanceRelationships(root, fileContent, filePath, allNodes, edges);
    
    // Find function calls
    this.findFunctionCallRelationships(root, fileContent, filePath, allNodes, edges);
    
    return edges;
  }
  
  /**
   * Find all nodes of a specific type
   */
  private findNodes(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
    const results: Parser.SyntaxNode[] = [];
    
    // Check if the root node itself matches the type
    if (node.type === type) {
      results.push(node);
    }

    // Special handling for function and class definitions
    if (type === 'function_definition' || type === 'class_definition') {
      // Only search direct children for these types
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child && (child.type === type)) {
          results.push(child);
        }
      }
    } else {
      // For other node types, perform a deeper search
      const cursor = node.walk();
      
      // First check the current node
      if (cursor.nodeType === type) {
        results.push(cursor.currentNode);
      }
      
      // Then traverse the tree
      let continueTraversal = true;
      
      do {
        // Try to go to first child
        if (cursor.gotoFirstChild()) {
          // Check this node
          if (cursor.nodeType === type) {
            results.push(cursor.currentNode);
          }
          continue;
        }
        
        // No children, try to go to next sibling
        if (cursor.gotoNextSibling()) {
          // Check this sibling
          if (cursor.nodeType === type) {
            results.push(cursor.currentNode);
          }
          continue;
        }
        
        // No siblings left, go up and to the right
        continueTraversal = false;
        while (cursor.gotoParent()) {
          if (cursor.gotoNextSibling()) {
            // Found a sibling after going up
            if (cursor.nodeType === type) {
              results.push(cursor.currentNode);
            }
            continueTraversal = true;
            break;
          }
        }
      } while (continueTraversal);
    }
    
    return results;
  }
  
  /**
   * Check if a node is inside a class definition
   */
  private isInsideClass(node: Parser.SyntaxNode): boolean {
    let current: Parser.SyntaxNode | null = node.parent;
    while (current) {
      if (current.type === 'class_definition') {
        return true;
      }
      current = current.parent;
    }
    return false;
  }
  
  /**
   * Extract inheritance information from a class
   */
  private extractInheritance(classNode: Parser.SyntaxNode, fileContent: string): string[] {
    const inheritance: string[] = [];
    const argumentList = classNode.childForFieldName('superclasses');
    
    if (argumentList) {
      for (let i = 0; i < argumentList.childCount; i++) {
        const child = argumentList.child(i);
        if (child && child.type === 'primary_expression') {
          inheritance.push(fileContent.substring(child.startIndex, child.endIndex));
        }
      }
    }
    
    return inheritance;
  }
  
  /**
   * Extract function parameters
   */
  private extractFunctionParams(funcNode: Parser.SyntaxNode, fileContent: string): string[] {
    const params: string[] = [];
    const parameterList = funcNode.childForFieldName('parameters');
    
    if (parameterList) {
      for (let i = 0; i < parameterList.childCount; i++) {
        const child = parameterList.child(i);
        if (child && child.type === 'identifier') {
          params.push(fileContent.substring(child.startIndex, child.endIndex));
        }
      }
    }
    
    return params;
  }
  
  /**
   * Find import relationships
   */
  private findImportRelationships(
    root: Parser.SyntaxNode, 
    fileContent: string, 
    filePath: string, 
    edges: GraphEdge[]
  ): void {
    const importNodes = this.findNodes(root, 'import_statement');
    const fromImportNodes = this.findNodes(root, 'from_import_statement');
    
    // Process regular imports
    for (const node of importNodes) {
      const moduleNames = this.findNodes(node, 'dotted_name');
      
      for (const moduleNode of moduleNames) {
        const moduleName = fileContent.substring(moduleNode.startIndex, moduleNode.endIndex);
        
        edges.push({
          source: this.getNodeId('file', filePath),
          target: `module:${moduleName}`,
          type: 'imports',
          metadata: {
            importType: 'module'
          }
        });
      }
    }
    
    // Process from imports
    for (const node of fromImportNodes) {
      const moduleNode = node.childForFieldName('module_name');
      if (!moduleNode) continue;
      
      const moduleName = fileContent.substring(moduleNode.startIndex, moduleNode.endIndex);
      const importedNames = this.findNodes(node, 'dotted_name');
      
      for (const nameNode of importedNames) {
        const name = fileContent.substring(nameNode.startIndex, nameNode.endIndex);
        
        edges.push({
          source: this.getNodeId('file', filePath),
          target: `module:${moduleName}.${name}`,
          type: 'imports',
          metadata: {
            importType: 'symbol',
            symbol: name
          }
        });
      }
    }
  }
  
  /**
   * Find class inheritance relationships
   */
  private findInheritanceRelationships(
    root: Parser.SyntaxNode, 
    fileContent: string, 
    filePath: string, 
    allNodes: Map<string, GraphNode>, 
    edges: GraphEdge[]
  ): void {
    const classNodes = this.findNodes(root, 'class_definition');
    
    for (const classNode of classNodes) {
      const nameNode = classNode.childForFieldName('name');
      if (!nameNode) continue;
      
      const className = fileContent.substring(nameNode.startIndex, nameNode.endIndex);
      const sourceId = this.getNodeId('class', filePath, className);
      
      const superclasses = this.extractInheritance(classNode, fileContent);
      
      for (const superclass of superclasses) {
        // Try to find if the superclass is defined in the codebase
        for (const [nodeId, node] of allNodes.entries()) {
          if (node.type === 'class' && node.name === superclass) {
            edges.push({
              source: sourceId,
              target: nodeId,
              type: 'inherits'
            });
            break;
          }
        }
      }
    }
  }
  
  /**
   * Find function call relationships
   */
  private findFunctionCallRelationships(
    root: Parser.SyntaxNode, 
    fileContent: string, 
    filePath: string, 
    allNodes: Map<string, GraphNode>, 
    edges: GraphEdge[]
  ): void {
    // Find all function/method calls
    const callNodes = this.findNodes(root, 'call');
    
    for (const callNode of callNodes) {
      const functionNode = callNode.childForFieldName('function');
      if (!functionNode) continue;
      
      const functionName = fileContent.substring(functionNode.startIndex, functionNode.endIndex);
      
      // Find containing function or method
      let currentNode: Parser.SyntaxNode | null = callNode;
      while (currentNode && currentNode.type !== 'function_definition' && currentNode.type !== 'class_definition') {
        currentNode = currentNode.parent;
      }
      
      if (!currentNode) continue;
      
      let sourceName = '';
      let sourceType = '';
      
      if (currentNode.type === 'function_definition') {
        const nameNode = currentNode.childForFieldName('name');
        if (!nameNode) continue;
        
        sourceName = fileContent.substring(nameNode.startIndex, nameNode.endIndex);
        
        // Check if this function is a method
        let classNode = currentNode.parent;
        while (classNode && classNode.type !== 'class_definition') {
          classNode = classNode.parent;
        }
        
        if (classNode) {
          const classNameNode = classNode.childForFieldName('name');
          if (!classNameNode) continue;
          
          const className = fileContent.substring(classNameNode.startIndex, classNameNode.endIndex);
          sourceType = 'method';
          sourceName = `${className}.${sourceName}`;
        } else {
          sourceType = 'function';
        }
      }
      
      // Find target function/method in the codebase
      for (const [nodeId, node] of allNodes.entries()) {
        if ((node.type === 'function' || node.type === 'method') && 
            node.name === functionName.split('.').pop()) {
          
          const sourceId = this.getNodeId(sourceType, filePath, sourceName);
          
          edges.push({
            source: sourceId,
            target: nodeId,
            type: 'calls'
          });
        }
      }
    }
  }
}
