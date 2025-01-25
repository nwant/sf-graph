# Graph Visualization SPA

Interactive web-based visualization of Salesforce metadata relationships using Cytoscape.js.

## Quick Start

```bash
# Terminal 1: Start API server (from project root)
npm run dev

# Terminal 2: Start SPA (from web directory)
cd web && npm run dev
```

Open http://localhost:5173

## Features

- **Interactive Graph** — Concentric layout showing object relationships
- **Search** — Fuzzy search with debounced autocomplete
- **Object Details** — Click any node to see fields, lookups, and references
- **Depth Control** — Adjust neighborhood depth (1-3 hops)
- **URL Persistence** — State saved in URL params and localStorage

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 18 + Vite |
| Graph | Cytoscape.js + react-cytoscapejs |
| UI | Fluent UI v9 |
| Routing | react-router-dom |
| Types | TypeScript |

## Project Structure

```
web/src/
├── components/
│   ├── GraphViewer.tsx    # Cytoscape canvas
│   ├── SearchBar.tsx      # Autocomplete search
│   ├── ObjectPanel.tsx    # Details sidebar  
│   ├── Toolbar.tsx        # Controls
│   └── ErrorBoundary.tsx
├── hooks/
│   ├── useGraphData.ts
│   ├── useGraphNavigation.ts
│   ├── useDebouncedSearch.ts
│   └── useObjectFields.ts
├── services/api.ts
└── types/graph.ts
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /objects?q=&limit=` | Search objects |
| `GET /objects/{apiName}?include=fields` | Object + fields |
| `GET /objects/{apiName}/neighborhood?depth=2` | Graph data |

## Development

```bash
cd web
npm install      # Install deps
npm run dev      # Dev server
npm run build    # Production build
```
