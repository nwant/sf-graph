# Docker Setup for sf-graph

This document explains how to run Neo4j using Docker for the sf-graph application.

## Prerequisites

- Docker and Docker Compose installed on your system

## Quick Start

```bash
# Start Neo4j
docker compose up -d

# In another terminal, run the app locally
npm run dev
```

## Configuration

Configure the application using CLI commands:

```bash
# Configure Neo4j connection
sf graph config set neo4jUri bolt://localhost:7687
sf graph config set neo4jPassword your_neo4j_password

# Set default Salesforce org
sf graph config set defaultOrg my-org
```

Before syncing, authenticate with Salesforce CLI:

```bash
sf org login web --alias my-org
```

## Accessing Services

- **Neo4j Browser**: http://localhost:7474
- **API** (when running locally): http://localhost:3000
- **API Documentation**: http://localhost:3000/documentation

## Stopping Neo4j

```bash
docker compose down
```

To remove all data volumes as well:

```bash
docker compose down -v
```

