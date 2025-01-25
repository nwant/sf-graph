/**
 * E2E Sync Verification Test
 * Tests the full Salesforce metadata sync to Neo4j flow.
 *
 * Prerequisites:
 * - SF CLI authenticated: sf org login web --alias <alias>
 * - SF_DEFAULT_ORG set in .env
 * - Neo4j running
 */
import { initSalesforceConnection, fetchObjectMetadata } from '../../dist/services/salesforce.js';
import { getOrgConnection, getDefaultOrgAlias } from '../../dist/services/sf-cli.js';
import { refreshObjectNodes } from '../../dist/services/neo4j/sync-service.js';
import { setupE2ETest, teardownE2ETest } from '../testUtils.js';


// Helper to check if we have SF CLI org configured and Neo4j
const hasCredentials = process.env.SF_DEFAULT_ORG && process.env.NEO4J_URI;

// Only run if credentials exist, otherwise skip (prevents CI failures if secrets missing)
const runRealE2E = hasCredentials ? describe : describe.skip;

runRealE2E('End-to-End Sync Verification', () => {
  let driver;

  beforeAll(async () => {
    driver = await setupE2ETest();
  }, 30000); // Higher timeout for connection

  afterAll(async () => {
    await teardownE2ETest();
  });

  test('should fetch metadata and populate Neo4j graph', async () => {
    // 1. Fetch Metadata
    console.log('Fetching metadata for test...');
    const objectsToFetch = ['Account', 'Contact', 'Opportunity'];
    const metadata = [];

    for (const objName of objectsToFetch) {
      const meta = await fetchObjectMetadata(objName);
      expect(meta).toBeDefined();

      metadata.push({
        type: 'CustomObject',
        fullName: objName,
        name: objName,
        content: meta,
      });
    }

    expect(metadata.length).toBe(3);

    console.log('Syncing to Neo4j (using refreshObjectNodes to include fields)...');
    
    // Get orgId to pass to sync service
    await initSalesforceConnection(); // Ensure connection is init
    const alias = process.env.SF_DEFAULT_ORG || await getDefaultOrgAlias();
    const connInfo = await getOrgConnection(alias);
    const orgId = connInfo.orgId;
    console.log(`Using Org ID for sync: ${orgId}`);

    await refreshObjectNodes(metadata, true, false, orgId);

    // 3. Verify Data
    const session = driver.session();
    try {
      // Check Account Object node
      const resultAccount = await session.run('MATCH (n:Object {apiName: "Account"}) RETURN n');
      expect(resultAccount.records.length).toBe(1);
      const accountNode = resultAccount.records[0].get('n');
      expect(accountNode.properties.orgId).toBeDefined();
      console.log(`Verified: Account node has orgId: ${accountNode.properties.orgId}`);

      // Check Field count (rough check, assuming Account has >5 fields)
      const resultFields = await session.run(
        'MATCH (n:Object {apiName: "Account"})-[:HAS_FIELD]->(f:Field) RETURN count(f) as count'
      );
      const fieldCount = resultFields.records[0].get('count').toNumber();
      expect(fieldCount).toBeGreaterThan(5);

      console.log(`Verified: Account node exists and has ${fieldCount} fields.`);
    } finally {
      await session.close();
    }
  }, 120000); // 2 minute timeout for the full sync
});
