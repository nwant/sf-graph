import Hapi from '@hapi/hapi';
import Inert from '@hapi/inert';
import Vision from '@hapi/vision';
import HapiSwagger from 'hapi-swagger';
import { createLogger } from './core/index.js';
import { initSalesforceConnection } from './services/salesforce.js';
import { initNeo4jDriver } from './services/neo4j/index.js';
import { routes } from './routes/metadata.js';
import { mcpRoutes } from './routes/mcp.js';
import { soqlRoutes } from './routes/soql.js';
import { loadConfig } from './agent/config.js';

const log = createLogger('server');

const init = async () => {
  log.info('Starting server initialization...');

  const config = loadConfig();
  const server = Hapi.server({
    port: config.serverPort || 3000,
    host: config.serverHost || '0.0.0.0',
    routes: {
      cors: {
        origin: ['http://localhost:5173'],
        credentials: true,
      },
    },
  });

  log.debug('Server created, registering plugins...');

  const swaggerOptions: HapiSwagger.RegisterOptions = {
    info: {
      title: 'API Documentation',
      version: '1.0.0',
    },
    schemes: ['http'],
    host: 'localhost:3000',
  };

  try {
    log.debug('Registering Inert...');
    await server.register(Inert);

    log.debug('Registering Vision...');
    await server.register(Vision);

    log.debug('Registering Swagger...');
    await server.register({
      plugin: HapiSwagger,
      options: swaggerOptions,
    });

    log.debug('All plugins registered successfully');

    // Initialize connections
    log.debug('Initializing Salesforce connection...');
    await initSalesforceConnection();

    log.debug('Initializing Neo4j connection...');
    await initNeo4jDriver();

    // Register routes
    log.debug('Registering metadata routes...');
    // @ts-ignore - Route types mismatch with Hapi types sometimes due to strictness
    server.route(routes);

    log.debug('Registering MCP routes...');
    // @ts-ignore
    server.route(mcpRoutes);

    log.debug('Registering SOQL routes...');
    // @ts-ignore
    server.route(soqlRoutes);

    // Add health check route
    log.debug('Registering health check route...');
    server.route({
      method: 'GET',
      path: '/health',
      handler: (_request, _h) => {
        return {
          status: 'ok',
          timestamp: new Date().toISOString(),
        };
      },
      options: {
        description: 'Health check endpoint',
        tags: ['api', 'health'],
      },
    });

    log.debug('Starting server...');
    await server.start();

    log.info({ uri: server.info.uri }, 'Server running');
    log.info({ docs: `${server.info.uri}/documentation` }, 'Documentation available');
  } catch (err) {
    log.error({ err }, 'Error during server initialization');
    process.exit(1);
  }
};

process.on('unhandledRejection', (err) => {
  log.error({ err }, 'UnhandledRejection');
  process.exit(1);
});

init();
