/**
 * Multi-Org E2E Sync Verification Test
 * Tests syncing the same object from two different orgs to ensure they exist as distinct nodes.
 *
 * Prerequisites:
 * - SF CLI authenticated for 'dev' and '25jscert'
 * - Neo4j running
 */
import { initSalesforceConnection, fetchObjectMetadata } from '../../dist/services/salesforce.js';
import { getOrgConnection } from '../../dist/services/sf-cli.js';
import { refreshObjectNodes } from '../../dist/services/neo4j/sync-service.js';
import { setupE2ETest, teardownE2ETest } from '../testUtils.js';


const ORG_1_ALIAS = 'dev';
const ORG_2_ALIAS = '25jscert';

describe('Multi-Org End-to-End Sync Verification', () => {
  let driver;

  beforeAll(async () => {
    driver = await setupE2ETest();
  }, 30000);

  afterAll(async () => {
    await teardownE2ETest();
  });

  test('should sync Account from both orgs and create distinct nodes', async () => {
    try {
        // --- Sync from Org 1 (dev) ---
        console.log(`\n=== Syncing from Org 1: ${ORG_1_ALIAS} ===`);
        await initSalesforceConnection(ORG_1_ALIAS);
        const conn1 = await getOrgConnection(ORG_1_ALIAS);
        const orgId1 = conn1.orgId;
        console.log(`Org 1 ID: ${orgId1}`);

        // Fetch & Sync Account
        const meta1 = await fetchObjectMetadata('Account');
        expect(meta1).toBeDefined();
        await refreshObjectNodes([{
            type: 'CustomObject',
            fullName: 'Account',
            name: 'Account',
            content: meta1
        }], true, false, orgId1);

        // --- Sync from Org 2 (25jscert) ---
        console.log(`\n=== Syncing from Org 2: ${ORG_2_ALIAS} ===`);
        await initSalesforceConnection(ORG_2_ALIAS);
        const conn2 = await getOrgConnection(ORG_2_ALIAS);
        const orgId2 = conn2.orgId;
        console.log(`Org 2 ID: ${orgId2}`);

        // Fetch & Sync Account
        const meta2 = await fetchObjectMetadata('Account');
        expect(meta2).toBeDefined();
        await refreshObjectNodes([{
            type: 'CustomObject',
            fullName: 'Account',
            name: 'Account',
            content: meta2
        }], true, false, orgId2);

        // --- Verify ---
        console.log('\n=== Verifying Graph Data ===');
        const session = driver.session();
        
        // Check for 2 Account nodes
        const result = await session.run('MATCH (n:Object {apiName: "Account"}) RETURN n.orgId as orgId, n.apiName as apiName ORDER BY n.orgId');
        
        console.log('Found Account nodes:', result.records.map(r => r.toObject()));
        
        expect(result.records.length).toBe(2);
        
        const orgIdsFound = result.records.map(r => r.get('orgId'));
        expect(orgIdsFound).toContain(orgId1);
        expect(orgIdsFound).toContain(orgId2);
        expect(orgIdsFound[0]).not.toEqual(orgIdsFound[1]); // Ensure they are different

        await session.close();

    } catch (error) {
        console.error('Test failed:', error);
        throw error;
    }
  }, 300000); // 5 minute timeout
});
