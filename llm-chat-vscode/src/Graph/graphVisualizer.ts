

import * as fs from 'fs';
import * as path from 'path';
import { KnowledgeGraph } from './knowledgeGraph';

/**
 * Utility class to visualize the knowledge graph in different formats
 */
export class GraphVisualizer {
  private graph: KnowledgeGraph;
  private outputPath: string;

  constructor(graph: KnowledgeGraph, outputPath: string) {
    this.graph = graph;
    this.outputPath = outputPath;

    // Ensure output directory exists
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
    }
  }
  
  /**
   * Generate a D3 force-directed graph visualization (HTML file)
   */
  public async generateD3Visualization(): Promise<string> {
    
    // Convert nodes and edges to format needed by D3
    const d3Nodes = Array.from(this.graph.nodes.values()).map(node => ({
      id: node.id,
      type: node.type,
      name: node.displayName,
      group: this.getNodeGroup(node.type)
    }));
    
    // Create a Set of all node IDs for faster lookup
    const existingNodeIds = new Set(d3Nodes.map(node => node.id));
    const d3Links = this.graph.edges
      .filter(edge => existingNodeIds.has(edge.source) && existingNodeIds.has(edge.target))
      .map(edge => ({
        source: edge.source,
        target: edge.target,
        type: edge.type,
        value: edge.weight || 1
    }));
    
    // Create HTML with embedded D3 visualization
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Code Knowledge Graph</title>
      <script src="https://d3js.org/d3.v7.min.js"></script>
      <style>
        body { 
          margin: 0;
          font-family: Arial, sans-serif;
        }
        .container {
          width: 100%;
          height: 100vh;
          display: flex;
          flex-direction: column;
        }
        #graph {
          flex-grow: 1;
          border: 1px solid #ccc;
        }
        .controls {
          padding: 10px;
          background: #f5f5f5;
        }
        .node {
          stroke: #fff;
          stroke-width: 1.5px;
        }
        .link {
          stroke-opacity: 0.6;
        }
        .node-label {
          font-size: 10px;
          pointer-events: none;
        }
        .legend {
          position: absolute;
          top: 10px;
          right: 10px;
          background: rgba(255, 255, 255, 0.8);
          padding: 10px;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        .legend-item {
          display: flex;
          align-items: center;
          margin-bottom: 5px;
        }
        .legend-color {
          width: 15px;
          height: 15px;
          margin-right: 5px;
          border-radius: 50%;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="controls">
          <label for="filter">Filter by type: </label>
          <select id="filter">
            <option value="all">All</option>
            <option value="file">Files</option>
            <option value="class">Classes</option>
            <option value="function">Functions</option>
            <option value="method">Methods</option>
          </select>
          <input type="text" id="search" placeholder="Search by name...">
          <button id="resetButton">Reset View</button>
        </div>
        <div id="graph"></div>
        <div class="legend">
          <div class="legend-item"><div class="legend-color" style="background: #4285F4;"></div>File</div>
          <div class="legend-item"><div class="legend-color" style="background: #EA4335;"></div>Class</div>
          <div class="legend-item"><div class="legend-color" style="background: #FBBC05;"></div>Function</div>
          <div class="legend-item"><div class="legend-color" style="background: #34A853;"></div>Method</div>
          <div class="legend-item"><div class="legend-color" style="background: #8334E3;"></div>Other</div>
        </div>
      </div>
      <script>
        // Graph data
        const graphData = {
          nodes: ${JSON.stringify(d3Nodes)},
          links: ${JSON.stringify(d3Links)}
        };
        
        // D3 visualization code
        const width = document.getElementById('graph').clientWidth;
        const height = document.getElementById('graph').clientHeight;
        
        // Color scale for node types
        const color = d3.scaleOrdinal()
          .domain(['file', 'class', 'function', 'method', 'variable'])
          .range(['#4285F4', '#EA4335', '#FBBC05', '#34A853', '#8334E3']);
          
        // Create the force simulation
        const simulation = d3.forceSimulation(graphData.nodes)
          .force('link', d3.forceLink(graphData.links).id(d => d.id).distance(100))
          .force('charge', d3.forceManyBody().strength(-200))
          .force('center', d3.forceCenter(width / 2, height / 2))
          .force('collision', d3.forceCollide().radius(30));
          
        // Create the SVG container
        const svg = d3.select('#graph')
          .append('svg')
          .attr('width', '100%')
          .attr('height', '100%')
          .call(d3.zoom().on('zoom', event => {
            g.attr('transform', event.transform);
          }));
          
        const g = svg.append('g');
          
        // Create the links
        const link = g.append('g')
          .selectAll('line')
          .data(graphData.links)
          .enter().append('line')
          .attr('class', 'link')
          .attr('stroke', d => {
            if (d.type === 'inherits') return '#ff8800';
            if (d.type === 'calls') return '#00aa00';
            if (d.type === 'imports') return '#0000ff';
            return '#999';
          })
          .attr('stroke-width', d => Math.sqrt(d.value));
          
        // Create the nodes
        const node = g.append('g')
          .selectAll('circle')
          .data(graphData.nodes)
          .enter().append('circle')
          .attr('class', 'node')
          .attr('r', d => {
            if (d.type === 'file') return 8;
            if (d.type === 'class') return 7;
            return 5;
          })
          .attr('fill', d => color(d.type))
          .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended));
            
        // Add node labels
        const label = g.append('g')
          .selectAll('text')
          .data(graphData.nodes)
          .enter().append('text')
          .attr('class', 'node-label')
          .attr('dx', 12)
          .attr('dy', '.35em')
          .text(d => d.name.split('/').pop());
        
        // Add titles for mouseover
        node.append('title')
          .text(d => d.name);
          
        // Event handlers for the simulation
        simulation.on('tick', () => {
          link
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);
            
          node
            .attr('cx', d => d.x)
            .attr('cy', d => d.y);
            
          label
            .attr('x', d => d.x)
            .attr('y', d => d.y);
        });
        
        // Drag functions
        function dragstarted(event) {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          event.subject.fx = event.subject.x;
          event.subject.fy = event.subject.y;
        }
        
        function dragged(event) {
          event.subject.fx = event.x;
          event.subject.fy = event.y;
        }
        
        function dragended(event) {
          if (!event.active) simulation.alphaTarget(0);
          event.subject.fx = null;
          event.subject.fy = null;
        }
        
        // Filter functionality
        document.getElementById('filter').addEventListener('change', function() {
          const filterValue = this.value;
          
          if (filterValue === 'all') {
            node.style('display', 'block');
            link.style('display', 'block');
          } else {
            node.style('display', d => d.type === filterValue ? 'block' : 'none');
            
            // Show links only if both source and target are visible
            link.style('display', d => {
              const sourceNode = graphData.nodes.find(n => n.id === d.source.id);
              const targetNode = graphData.nodes.find(n => n.id === d.target.id);
              return sourceNode.type === filterValue && targetNode.type === filterValue ? 'block' : 'none';
            });
          }
        });
        
        // Search functionality
        document.getElementById('search').addEventListener('input', function() {
          const searchTerm = this.value.toLowerCase();
          
          if (searchTerm === '') {
            node.style('display', 'block');
            link.style('display', 'block');
            return;
          }
          
          // Find matching nodes
          const matchingNodeIds = new Set();
          node.each(d => {
            if (d.name.toLowerCase().includes(searchTerm)) {
              matchingNodeIds.add(d.id);
            }
          });
          
          // Show only matching nodes and their connections
          node.style('display', d => matchingNodeIds.has(d.id) ? 'block' : 'none');
          link.style('display', d => {
            return matchingNodeIds.has(d.source.id) && matchingNodeIds.has(d.target.id) ? 'block' : 'none';
          });
        });
        
        // Reset button
        document.getElementById('resetButton').addEventListener('click', function() {
          document.getElementById('filter').value = 'all';
          document.getElementById('search').value = '';
          
          node.style('display', 'block');
          link.style('display', 'block');
          
          svg.transition().duration(750).call(
            d3.zoom().transform,
            d3.zoomIdentity.translate(width / 2, height / 2).scale(1)
          );
        });
      </script>
    </body>
    </html>
    `;
    
    const htmlPath = path.join(this.outputPath, 'knowledge-graph.html');
    fs.writeFileSync(htmlPath, html);
    
    return htmlPath;
  }
  
  /**
   * Generate a JSON representation of the graph for use with external tools
   */
  public async exportGraphJson(): Promise<string> {
    const json = {
      nodes: Array.from(this.graph.nodes.values()),
      edges: this.graph.edges
    };
    
    const jsonPath = path.join(this.outputPath, 'knowledge-graph-data.json');
    fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));
    
    return jsonPath;
  }

  /**
   * Map node types to group numbers for visualization
   */
  private getNodeGroup(type: string): number {
    switch (type) {
      case 'file': return 1;
      case 'class': return 2;
      case 'function': return 3;
      case 'method': return 4;
      case 'variable': return 5;
      default: return 0;
    }
  }
}