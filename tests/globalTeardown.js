/**
 * Jest Global Teardown
 * Runs once after all test suites complete.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATE_FILE = path.join(__dirname, '.neo4j-test-state.json');

export default async function globalTeardown() {
  console.log('\n🧹 Jest Global Teardown: Cleaning up...');

  // Remove state file
  try {
    if (fs.existsSync(STATE_FILE)) {
      fs.unlinkSync(STATE_FILE);
      console.log('📝 Test state file removed');
    }
  } catch (error) {
    console.warn('⚠️  Could not remove state file:', error.message);
  }

  console.log('✅ Global teardown complete');
}
