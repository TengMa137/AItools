import Parser from 'tree-sitter';
import Cpp from 'tree-sitter-cpp';
import { GraphNode, GraphEdge } from '../Graph/knowledgeGraph';
import { BaseParser } from './baseParser'

export class CppParser extends BaseParser {
    constructor(rootPath: string) {
      super(Cpp, rootPath);
    }
  
    /**
     * Extract classes and functions from C++ file
     */
    async getFileEntities(filePath: string, fileContent: string): Promise<GraphNode[]> {
      const nodes: GraphNode[] = [];
      const tree = this.parser.parse(fileContent);
      const root = tree.rootNode;
      
      // Find all namespace, class, and function definitions (recursively)
      const namespaceNodes = this.findNodes(root, 'namespace_definition');
      const classNodes = this.findNodes(root, 'class_specifier');
      const structNodes = this.findNodes(root, 'struct_specifier');
      const functionNodes = this.findNodes(root, 'function_definition');
      
      // Create a map to store class declarations for later linking to external methods
      const classDeclarationMap = new Map<string, GraphNode>();
      
      // Keep track of namespace context for nested elements
      const processNamespaceContext = (
        nsNode: Parser.SyntaxNode, 
        namespaceName: string,
        parentNamespacePath: string = ''
      ) => {
        // Build full namespace path
        const fullNamespacePath = parentNamespacePath 
          ? `${parentNamespacePath}::${namespaceName}`
          : namespaceName;
        
        // Create namespace node
        const nameNode = nsNode.childForFieldName('name');
        if (nameNode) {
          const startPos = this.getPosition(nsNode.startPosition, fileContent);
          const endPos = this.getPosition(nsNode.endPosition, fileContent);
          
          const namespaceNode: GraphNode = {
            id: this.getNodeId('namespace', filePath, fullNamespacePath),
            type: 'namespace',
            name: namespaceName,
            displayName: fullNamespacePath,
            location: {
              filePath,
              startLine: startPos.line,
              endLine: endPos.line,
              startCol: startPos.col,
              endCol: endPos.col
            }
          };
          
          nodes.push(namespaceNode);
          
          // Process nested namespaces
          const nestedNamespaces = this.findNodes(nsNode, 'namespace_definition');
          for (const nestedNs of nestedNamespaces) {
            const nestedNameNode = nestedNs.childForFieldName('name');
            if (!nestedNameNode) continue;
            
            const nestedNsName = fileContent.substring(nestedNameNode.startIndex, nestedNameNode.endIndex);
            processNamespaceContext(nestedNs, nestedNsName, fullNamespacePath);
          }
          
          // Process classes in this namespace
          const nsClassNodes = this.findNodes(nsNode, 'class_specifier');
          const nsStructNodes = this.findNodes(nsNode, 'struct_specifier');
          for (const classNode of [...nsClassNodes, ...nsStructNodes]) {
            processClassNode(classNode, fullNamespacePath);
          }
          
          // Process functions in this namespace
          const nsFunctionNodes = this.findNodes(nsNode, 'function_definition');
          for (const funcNode of nsFunctionNodes) {
            // Skip methods already handled inside classes
            if (this.isInsideClass(funcNode)) continue;
            
            processFunctionNode(funcNode, fullNamespacePath);
          }
        }
      };
      
      // Process class nodes with namespace context
      const processClassNode = (
        node: Parser.SyntaxNode, 
        namespaceContext: string = ''
      ) => {
        const nameNode = node.childForFieldName('name');
        if (!nameNode) return;
        
        const className = fileContent.substring(nameNode.startIndex, nameNode.endIndex);
        const startPos = this.getPosition(node.startPosition, fileContent);
        const endPos = this.getPosition(node.endPosition, fileContent);
        
        // Build fully qualified name with namespace
        const fullClassName = namespaceContext 
          ? `${namespaceContext}::${className}` 
          : className;
        
        const classNode: GraphNode = {
          id: this.getNodeId('class', filePath, fullClassName),
          type: 'class',
          name: className,
          displayName: fullClassName,
          location: {
            filePath,
            startLine: startPos.line,
            endLine: endPos.line,
            startCol: startPos.col,
            endCol: endPos.col
          },
          metadata: {
            // Get class inheritance
            inherits: this.extractCppInheritance(node, fileContent),
            namespace: namespaceContext || undefined
          }
        };
        
        nodes.push(classNode);
        classDeclarationMap.set(fullClassName, classNode);
        
        // Find method declarations inside the class
        const methodDeclarations = this.findNodes(node, 'function_declarator');
        for (const mDecl of methodDeclarations) {
          // Get the parent to make sure this is a declaration and not a definition
          const parent = mDecl.parent;
          if (!parent || parent.type !== 'declaration') continue;
          
          const methodNameNode = this.findDeepestIdentifier(mDecl.firstChild);
          if (!methodNameNode) continue;
          
          const methodName = fileContent.substring(methodNameNode.startIndex, methodNameNode.endIndex);
          
          // Store this method name as declared within this class
          // Ensure metadata exists
          classNode.metadata = classNode.metadata || {};
          if (!classNode.metadata.declaredMethods) {
            classNode.metadata.declaredMethods = [];
          }
          classNode.metadata.declaredMethods.push(methodName);
        }
        
        // Get methods defined inside the class
        const methods = this.findNodes(node, 'function_definition');
        for (const mNode of methods) {
          const methodNameNode = this.findFunctionName(mNode);
          if (!methodNameNode) continue;
          
          const methodName = fileContent.substring(methodNameNode.startIndex, methodNameNode.endIndex);
          const methodStartPos = this.getPosition(mNode.startPosition, fileContent);
          const methodEndPos = this.getPosition(mNode.endPosition, fileContent);
          
          // Build fully qualified method name with namespace and class
          const fullMethodName = `${fullClassName}::${methodName}`;
          
          const methodNode: GraphNode = {
            id: this.getNodeId('method', filePath, fullMethodName),
            type: 'method',
            name: methodName,
            displayName: fullMethodName,
            location: {
              filePath,
              startLine: methodStartPos.line,
              endLine: methodEndPos.line,
              startCol: methodStartPos.col,
              endCol: methodEndPos.col
            },
            metadata: {
              parentClass: classNode.id,
              parameters: this.extractCppFunctionParams(mNode, fileContent),
              namespace: namespaceContext || undefined
            }
          };
          
          nodes.push(methodNode);
        }
      };
      
      // Process function nodes with namespace context
      const processFunctionNode = (
        node: Parser.SyntaxNode, 
        namespaceContext: string = ''
      ) => {
        // Skip methods already handled inside classes
        if (this.isInsideClass(node)) return;
        
        const nameNode = this.findFunctionName(node);
        if (!nameNode) return;
        
        const funcNameText = fileContent.substring(nameNode.startIndex, nameNode.endIndex);
        const startPos = this.getPosition(node.startPosition, fileContent);
        const endPos = this.getPosition(node.endPosition, fileContent);
        
        // Check if this is a method defined outside class using scope resolution operator
        const isExternalMethod = this.isExternalClassMethod(node, fileContent);
        if (isExternalMethod) {
          const { className, methodName } = this.parseExternalMethodName(funcNameText);
          
          // Handle class in namespace correctly
          // If className already includes namespace components, use it as is
          // Otherwise, prepend the current namespace context
          const fullClassName = className.includes('::') || !namespaceContext
            ? className 
            : `${namespaceContext}::${className}`;
          
          // Find the class this method belongs to
          const parentClass = classDeclarationMap.get(fullClassName);
          if (parentClass) {
            const fullMethodName = `${fullClassName}::${methodName}`;
            
            const methodNode: GraphNode = {
              id: this.getNodeId('method', filePath, fullMethodName),
              type: 'method',
              name: methodName,
              displayName: fullMethodName,
              location: {
                filePath,
                startLine: startPos.line,
                endLine: endPos.line,
                startCol: startPos.col,
                endCol: endPos.col
              },
              metadata: {
                parentClass: parentClass.id,
                parameters: this.extractCppFunctionParams(node, fileContent),
                isExternalDefinition: true,
                namespace: namespaceContext || undefined
              }
            };
            
            nodes.push(methodNode);
          } else {
            // Class not found in this file, create a regular function node
            // but mark it as potentially being an external method
            const fullFuncName = namespaceContext 
              ? `${namespaceContext}::${funcNameText}` 
              : funcNameText;
              
            const functionNode: GraphNode = {
              id: this.getNodeId('function', filePath, fullFuncName),
              type: 'function',
              name: funcNameText,
              displayName: fullFuncName,
              location: {
                filePath,
                startLine: startPos.line,
                endLine: endPos.line,
                startCol: startPos.col,
                endCol: endPos.col
              },
              metadata: {
                parameters: this.extractCppFunctionParams(node, fileContent),
                returnType: this.extractCppReturnType(node, fileContent),
                potentialExternalMethod: true,
                namespace: namespaceContext || undefined
              }
            };
            
            nodes.push(functionNode);
          }
        } else {
          // This is a regular function
          const fullFuncName = namespaceContext 
            ? `${namespaceContext}::${funcNameText}` 
            : funcNameText;
            
          const functionNode: GraphNode = {
            id: this.getNodeId('function', filePath, fullFuncName),
            type: 'function',
            name: funcNameText,
            displayName: fullFuncName,
            location: {
              filePath,
              startLine: startPos.line,
              endLine: endPos.line,
              startCol: startPos.col,
              endCol: endPos.col
            },
            metadata: {
              parameters: this.extractCppFunctionParams(node, fileContent),
              returnType: this.extractCppReturnType(node, fileContent),
              namespace: namespaceContext || undefined
            }
          };
          
          nodes.push(functionNode);
        }
      };
      
      // Process top-level namespaces
      for (const node of namespaceNodes) {
        // Skip nested namespaces - they are processed by the parent namespace handler
        if (this.isInsideNamespace(node)) continue;
        
        const nameNode = node.childForFieldName('name');
        if (!nameNode) continue;
        
        const namespaceName = fileContent.substring(nameNode.startIndex, nameNode.endIndex);
        processNamespaceContext(node, namespaceName);
      }
      
      // Process top-level classes (not in namespaces)
      for (const node of [...classNodes, ...structNodes]) {
        // Skip classes inside namespaces - they are processed by the namespace handler
        if (this.isInsideNamespace(node)) continue;
        
        processClassNode(node);
      }
      
      // Process top-level functions (not in namespaces)
      for (const node of functionNodes) {
        // Skip functions inside namespaces - they are processed by the namespace handler
        if (this.isInsideNamespace(node)) continue;
        
        // Skip methods already handled inside classes
        if (this.isInsideClass(node)) continue;
        
        processFunctionNode(node);
      }
      
      return nodes;
    }
  
    /**
     * Extract relationships between C++ entities
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
      
      // Find include statements
      this.findIncludeRelationships(root, fileContent, filePath, edges);
      if (onlyFileRelationship){
        return edges;
      }
      
      // Find class inheritance relationships
      this.findCppInheritanceRelationships(root, fileContent, filePath, allNodes, edges);
      
      // Find function calls
      this.findCppFunctionCallRelationships(root, fileContent, filePath, allNodes, edges);
      
      // Add namespace membership relationships
      this.findNamespaceMembershipRelationships(allNodes, edges);
      
      return edges;
    }
    
    /**
     * Find namespace membership relationships
     */
    private findNamespaceMembershipRelationships(
      allNodes: Map<string, GraphNode>,
      edges: GraphEdge[]
    ): void {
      // Map to store namespaces by their full path
      const namespaceMap = new Map<string, string>();
      
      // First, identify all namespaces
      for (const [nodeId, node] of allNodes.entries()) {
        if (node.type === 'namespace') {
          namespaceMap.set(node.displayName, nodeId);
        }
      }
      
      // Then, connect nodes to their parent namespace
      for (const [nodeId, node] of allNodes.entries()) {
        if (node.metadata?.namespace) {
          const namespaceId = namespaceMap.get(node.metadata.namespace);
          if (namespaceId) {
            edges.push({
              source: nodeId,
              target: namespaceId,
              type: 'belongsTo',
              metadata: {
                membershipType: 'namespace'
              }
            });
          }
        }
      }
    }
    
    /**
     * Find all nodes of a specific type - fully recursive implementation
     */
    private findNodes(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode[] {
      const results: Parser.SyntaxNode[] = [];
      
      // First check the current node
      if (node.type === type) {
        results.push(node);
      }
      
      // Then traverse the entire tree recursively
      const cursor = node.walk();
      
      let continueTraversal = cursor.gotoFirstChild();
      while (continueTraversal) {
        // Check this node
        if (cursor.nodeType === type) {
          results.push(cursor.currentNode);
        }
        
        // Recursively check children
        const childNodes = this.findNodes(cursor.currentNode, type);
        results.push(...childNodes);
        
        // Move to next sibling
        continueTraversal = cursor.gotoNextSibling();
      }
      
      return results;
    }

    /**
     * Check if a node is inside a class definition
     */
    private isInsideClass(node: Parser.SyntaxNode): boolean {
      let current: Parser.SyntaxNode | null = node.parent;
      while (current) {
        if (current.type === 'class_specifier' || current.type === 'struct_specifier') {
          return true;
        }
        current = current.parent;
      }
      return false;
    }
    
    /**
     * Check if a node is inside a namespace definition
     */
    private isInsideNamespace(node: Parser.SyntaxNode): boolean {
      let current: Parser.SyntaxNode | null = node.parent;
      while (current) {
        if (current.type === 'namespace_definition') {
          return true;
        }
        current = current.parent;
      }
      return false;
    }
    
    /**
     * Checks if a function definition is a method defined outside its class using scope resolution
     */
    private isExternalClassMethod(node: Parser.SyntaxNode, fileContent: string): boolean {
      const declarator = node.childForFieldName('declarator');
      if (!declarator) return false;
      
      // Get the function name text 
      const nameNode = this.findFunctionName(node);
      if (!nameNode) return false;
      
      const funcName = fileContent.substring(nameNode.startIndex, nameNode.endIndex);
      
      // Check if it contains scope resolution operator ::
      return funcName.includes('::');
    }
    
    /**
     * Parse class name and method name from a scoped name like "ClassName::methodName"
     * or "Namespace::ClassName::methodName"
     */
    private parseExternalMethodName(fullName: string): { className: string, methodName: string } {
      const parts = fullName.split('::');
      const methodName = parts.pop() || '';
      const className = parts.join('::'); // Support nested namespaces/classes
      
      return { className, methodName };
    }
    
    /**
     * Extract C++ inheritance information from a class
     */
    private extractCppInheritance(classNode: Parser.SyntaxNode, fileContent: string): string[] {
      const inheritance: string[] = [];
      const baseClassClause = this.findNodes(classNode, 'base_class_clause')[0];
      
      if (baseClassClause) {
        const baseSpecifiers = this.findNodes(baseClassClause, 'base_specifier');
        for (const baseSpecifier of baseSpecifiers) {
          const typeNode = baseSpecifier.childForFieldName('type');
          if (typeNode) {
            inheritance.push(fileContent.substring(typeNode.startIndex, typeNode.endIndex));
          }
        }
      }
      
      return inheritance;
    }
    
    /**
     * Extract C++ function parameters
     */
    private extractCppFunctionParams(funcNode: Parser.SyntaxNode, fileContent: string): Array<{name: string, type: string}> {
      const params: Array<{name: string, type: string}> = [];
      const parameterList = this.findNodes(funcNode, 'parameter_list')[0];
      
      if (parameterList) {
        const parameters = this.findNodes(parameterList, 'parameter_declaration');
        for (const param of parameters) {
          const declarator = param.childForFieldName('declarator');
          const typeNode = param.childForFieldName('type');
          
          if (declarator && typeNode) {
            const name = fileContent.substring(declarator.startIndex, declarator.endIndex);
            const type = fileContent.substring(typeNode.startIndex, typeNode.endIndex);
            
            params.push({ name, type });
          }
        }
      }
      
      return params;
    }
    
    /**
     * Extract C++ function return type
     */
    private extractCppReturnType(funcNode: Parser.SyntaxNode, fileContent: string): string {
      const declarator = funcNode.childForFieldName('declarator');
      if (!declarator) return 'void';
      
      const typeNode = funcNode.childForFieldName('type');
      if (!typeNode) return 'void';
      
      return fileContent.substring(typeNode.startIndex, typeNode.endIndex).trim();
    }
    
    /**
     * Find the function name node from a function definition
     */
    private findFunctionName(funcNode: Parser.SyntaxNode): Parser.SyntaxNode | null {
      const declarator = funcNode.childForFieldName('declarator');
      if (!declarator) return null;
      
      // C++ function names can be nested in various declarator types
      // First, try to find a function declarator
      const functionDeclarator = this.findNodes(declarator, 'function_declarator')[0];
      if (functionDeclarator) {
        // The first child is typically the function name or another nested declarator
        return this.findDeepestIdentifier(functionDeclarator.firstChild);
      }
      
      // If that fails, look for an identifier directly
      return this.findNodes(declarator, 'identifier')[0] || null;
    }
    
    /**
     * Recursively find the deepest identifier in a nested declarator structure
     */
    private findDeepestIdentifier(node: Parser.SyntaxNode | null): Parser.SyntaxNode | null {
      if (!node) return null;
      
      if (node.type === 'identifier') {
        return node;
      }
      
      // If it's a nested structure, search through all children
      if (node.firstChild) {
        const fromFirstChild = this.findDeepestIdentifier(node.firstChild);
        if (fromFirstChild) return fromFirstChild;
      }
      
      // If it's a qualified identifier (ClassName::method)
      if (node.type === 'qualified_identifier') {
        const nameChild = node.childForFieldName('name');
        if (nameChild) {
          return nameChild;
        }
      }
      
      // Try siblings if nothing found in firstChild
      let sibling = node.nextSibling;
      while (sibling) {
        const fromSibling = this.findDeepestIdentifier(sibling);
        if (fromSibling) return fromSibling;
        sibling = sibling.nextSibling;
      }
      
      return null;
    }
    
    /**
     * Find include relationships in C++
     */
    private findIncludeRelationships(
      root: Parser.SyntaxNode, 
      fileContent: string, 
      filePath: string, 
      edges: GraphEdge[]
    ): void {
      const includeNodes = this.findNodes(root, 'preproc_include');
      
      for (const node of includeNodes) {
        // Extract the include path
        const pathNode = node.lastChild;
        if (!pathNode) continue;
        
        let includePath = fileContent.substring(pathNode.startIndex, pathNode.endIndex);
        
        // Clean up the path (remove quotes or angle brackets)
        includePath = includePath.replace(/[<>"]/g, '').trim();
        
        edges.push({
          source: this.getNodeId('file', filePath),
          target: `${includePath}`,
          type: 'imports',
          metadata: {
            importType: 'include'
          }
        });
      }
    }
    
    /**
     * Find class inheritance relationships in C++
     */
    private findCppInheritanceRelationships(
      root: Parser.SyntaxNode, 
      fileContent: string, 
      filePath: string, 
      allNodes: Map<string, GraphNode>, 
      edges: GraphEdge[]
    ): void {
      const classNodes = [...this.findNodes(root, 'class_specifier'), ...this.findNodes(root, 'struct_specifier')];
      
      for (const classNode of classNodes) {
        const nameNode = classNode.childForFieldName('name');
        if (!nameNode) continue;
        
        // Get class name
        const className = fileContent.substring(nameNode.startIndex, nameNode.endIndex);
        
        // Get namespace context if class is within a namespace
        let namespaceContext = '';
        let currentNode: Parser.SyntaxNode | null = classNode.parent;
        while (currentNode) {
          if (currentNode.type === 'namespace_definition') {
            const nsNameNode = currentNode.childForFieldName('name');
            if (nsNameNode) {
              const nsName = fileContent.substring(nsNameNode.startIndex, nsNameNode.endIndex);
              namespaceContext = namespaceContext 
                ? `${nsName}::${namespaceContext}` 
                : nsName;
            }
          }
          currentNode = currentNode.parent;
        }
        
        // Build fully qualified class name with namespace
        const fullClassName = namespaceContext 
          ? `${namespaceContext}::${className}` 
          : className;
        
        const sourceId = this.getNodeId('class', filePath, fullClassName);
        
        const baseClasses = this.extractCppInheritance(classNode, fileContent);
        
        for (const baseClass of baseClasses) {
          // Try to find if the base class is defined in the codebase
          for (const [nodeId, node] of allNodes.entries()) {
            if (node.type === 'class') {
              // Compare with the display name (which includes namespace)
              if (node.displayName === baseClass || node.name === baseClass) {
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
    }
    
    /**
     * Find function call relationships in C++
     */
    private findCppFunctionCallRelationships(
      root: Parser.SyntaxNode, 
      fileContent: string, 
      filePath: string, 
      allNodes: Map<string, GraphNode>, 
      edges: GraphEdge[]
    ): void {
      // Find all function calls
      const callNodes = this.findNodes(root, 'call_expression');
      
      for (const callNode of callNodes) {
        const functionNode = callNode.childForFieldName('function');
        if (!functionNode) continue;
        
        // Get full function name including any qualified name (namespace::class::function)
        const functionName = fileContent.substring(functionNode.startIndex, functionNode.endIndex);
        
        // Find containing function or method
        let currentNode: Parser.SyntaxNode | null = callNode;
        while (currentNode && 
               currentNode.type !== 'function_definition' && 
               currentNode.type !== 'class_specifier' &&
               currentNode.type !== 'struct_specifier') {
          currentNode = currentNode.parent;
        }
        
        if (!currentNode || currentNode.type !== 'function_definition') continue;
        
        let sourceName = '';
        let sourceType = '';
        let namespaceContext = '';
        
        // Get namespace context if function is within a namespace
        let nsNode: Parser.SyntaxNode | null = currentNode.parent;
        while (nsNode) {
          if (nsNode.type === 'namespace_definition') {
            const nsNameNode = nsNode.childForFieldName('name');
            if (nsNameNode) {
              const nsName = fileContent.substring(nsNameNode.startIndex, nsNameNode.endIndex);
              namespaceContext = namespaceContext 
                ? `${nsName}::${namespaceContext}` 
                : nsName;
            }
          }
          nsNode = nsNode.parent;
        }
        
        // Get the function name where this call occurs
        const nameNode = this.findFunctionName(currentNode);
        if (!nameNode) continue;
        
        sourceName = fileContent.substring(nameNode.startIndex, nameNode.endIndex);
        
        // Check if this function is a method (either inside class or external)
        if (this.isInsideClass(currentNode)) {
          // Method defined inside class
          let classNode = currentNode.parent;
          while (classNode && 
                classNode.type !== 'class_specifier' && 
                classNode.type !== 'struct_specifier') {
            classNode = classNode.parent;
          }
          
          if (!classNode) continue;
          
          const classNameNode = classNode.childForFieldName('name');
          if (!classNameNode) continue;
          
          const className = fileContent.substring(classNameNode.startIndex, classNameNode.endIndex);
          sourceType = 'method';
          
          // Build fully qualified name with namespace and class
          sourceName = namespaceContext 
            ? `${namespaceContext}::${className}::${sourceName}`
            : `${className}::${sourceName}`;
        } else if (this.isExternalClassMethod(currentNode, fileContent)) {
          // Method defined outside class
          sourceType = 'method';
          
          // If sourceName already contains class::method format but not namespace
          if (!sourceName.includes('::') && namespaceContext) {
            sourceName = `${namespaceContext}::${sourceName}`;
          }
        } else {
          // Regular function
          sourceType = 'function';
          
          // Add namespace if present
          if (namespaceContext) {
            sourceName = `${namespaceContext}::${sourceName}`;
          }
        }
        
        // Try to match the called function to nodes in our graph
        for (const [nodeId, node] of allNodes.entries()) {
          if ((node.type === 'function' || node.type === 'method')) {
            // Handle qualified names (with :: separators) in C++
            const simpleFunctionName = functionName.split('::').pop() || '';
            
            // Try to match by name and displayName for flexibility
            if (node.name === simpleFunctionName || node.displayName === functionName) {
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
  }