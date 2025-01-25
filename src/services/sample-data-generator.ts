/**
 * Sample data generator service for Salesforce objects
 * Generates realistic sample data based on object metadata
 */
import { getObjectByApiName, getObjectFields, getObjectRelationships, GraphField } from './neo4j/graph-service.js';

interface SampleRecord extends Record<string, any> {
  Id: string;
}

interface SampleDataOptions {
  // Add options if needed
  [key: string]: unknown;
}

/**
 * Generate sample data for a Salesforce object
 * @param {string} objectApiName - API name of the Salesforce object
 * @param {number} count - Number of records to generate
 * @param {Object} options - Additional options for data generation
 * @returns {Promise<SampleRecord[]>} - Array of generated sample records
 */
export async function generateSampleData(
  objectApiName: string,
  count = 5,
  options: SampleDataOptions = {}
): Promise<SampleRecord[]> {
  try {
    console.log(`Generating ${count} sample records for object: ${objectApiName}`);

    // Get object metadata
    const object = await getObjectByApiName(objectApiName);
    if (!object) {
      throw new Error(`Object with API name '${objectApiName}' not found.`);
    }

    // Get fields for this object
    const fields = await getObjectFields(objectApiName);

    // Generate sample records
    const records: SampleRecord[] = [];
    for (let i = 0; i < count; i++) {
      const record: SampleRecord = {
        Id: generateMockId(objectApiName, i),
      };

      // Generate values for each field
      for (const field of fields) {
        // Skip Id field as we've already set it
        if (field.apiName === 'Id') continue;

        // Generate value based on field type
        record[field.apiName] = generateFieldValue(field, i, options);
      }

      records.push(record);
    }

    return records;
  } catch (error) {
    console.error(`Error generating sample data for ${objectApiName}:`, error);
    throw new Error(
      `Failed to generate sample data: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Generate a mock Salesforce ID
 * @param {string} objectPrefix - Prefix for the object type
 * @param {number} index - Index for uniqueness
 * @returns {string} - Mock Salesforce ID
 */
function generateMockId(objectPrefix: string, index: number): string {
  // Create a prefix based on the object name (first 3 chars)
  const prefix = objectPrefix.substring(0, 3).toUpperCase();

  // Generate a unique ID with the format: XXX000000001YYY
  const uniqueId = `${prefix}${String(index + 1).padStart(9, '0')}AAA`;

  return uniqueId;
}

/**
 * Generate a value for a specific field based on its type
 * @param {GraphField} field - Field metadata
 * @param {number} index - Index for uniqueness
 * @param {SampleDataOptions} _options - Additional options for data generation
 * @returns {any} - Generated field value
 */
function generateFieldValue(field: GraphField, index: number, _options: SampleDataOptions): string | number | boolean | null {
  const { apiName, type, nillable } = field;

  // Handle null values for nullable fields (10% chance if nullable)
  if (nillable && Math.random() < 0.1) {
    return null;
  }

  // Generate value based on field type
  switch (type?.toLowerCase()) {
    case 'id':
      return generateMockId(apiName, index);

    case 'string':
    case 'text':
      return `Sample ${apiName} ${index + 1}`;

    case 'textarea':
    case 'longtextarea':
    case 'richtextarea':
      return `This is a sample long text for ${apiName} record ${index + 1}. It contains multiple sentences to simulate real data.`;

    case 'boolean':
      return Math.random() > 0.5;

    case 'int':
    case 'integer':
      return Math.floor(Math.random() * 1000) + 1;

    case 'double':
    case 'currency':
    case 'percent':
      return parseFloat((Math.random() * 1000).toFixed(2));

    case 'date':
      return generateRandomDate(false);

    case 'datetime':
      return generateRandomDate(true);

    case 'email':
      return `sample${index + 1}@example.com`;

    case 'phone':
      return `(555) ${String(Math.floor(Math.random() * 900) + 100)}-${String(Math.floor(Math.random() * 9000) + 1000)}`;

    case 'url':
      return `https://example.com/sample${index + 1}`;

    case 'picklist':
    case 'multipicklist':
      // For picklists, we'd ideally use the actual picklist values from metadata
      // For now, just return a sample value
      return `Option ${(index % 5) + 1}`;

    case 'reference':
      // For reference fields, we'd ideally generate valid IDs of related objects
      // For now, just return a mock ID
      return generateMockId(apiName, index);

    default:
      return `Sample ${apiName} ${index + 1}`;
  }
}

/**
 * Generate a random date
 * @param {boolean} includeTime - Whether to include time component
 * @returns {string} - ISO date string
 */
function generateRandomDate(includeTime: boolean): string {
  // Generate a random date within the last 2 years
  const now = new Date();
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(now.getFullYear() - 2);

  const randomTimestamp =
    twoYearsAgo.getTime() + Math.random() * (now.getTime() - twoYearsAgo.getTime());
  const randomDate = new Date(randomTimestamp);

  if (includeTime) {
    return randomDate.toISOString();
  } else {
    // Return YYYY-MM-DD
    return randomDate.toISOString().split('T')[0];
  }
}

/**
 * Generate related sample data for a Salesforce object
 * This creates sample data that respects relationships between objects
 * @param {string} objectApiName - API name of the Salesforce object
 * @param {number} count - Number of records to generate
 * @param {Object} options - Additional options for data generation
 * @returns {Promise<Record<string, SampleRecord[]>>} - Object containing generated sample records for multiple related objects
 */
export async function generateRelatedSampleData(
  objectApiName: string,
  count = 5,
  options: SampleDataOptions = {}
): Promise<Record<string, SampleRecord[]>> {
  try {
    console.log(`Generating related sample data for object: ${objectApiName}`);

    // Get object metadata
    const object = await getObjectByApiName(objectApiName);
    if (!object) {
      throw new Error(`Object with API name '${objectApiName}' not found.`);
    }

    // Get relationships for this object
    const relationships = await getObjectRelationships(objectApiName);

    // Generate primary object data
    const primaryRecords = await generateSampleData(objectApiName, count, options);

    // Initialize result object with primary records
    const result: Record<string, SampleRecord[]> = {
      [objectApiName]: primaryRecords,
    };

    // Generate related records for each relationship
    for (const relationship of relationships) {
      // Only process outgoing relationships (where this object references others)
      if (relationship.direction === 'outgoing') {
        const relatedObjectName = relationship.targetObject;

        // Generate a smaller number of related records
        const relatedCount = Math.max(1, Math.floor(count / 2));
        const relatedRecords = await generateSampleData(relatedObjectName, relatedCount, options);

        // Add to result if not already present
        if (!result[relatedObjectName]) {
          result[relatedObjectName] = relatedRecords;
        }

        // Link the records by updating reference fields in the primary records
        // This would require knowledge of which fields are the reference fields
        // For now, we'll just include the related records without linking
      }
    }

    return result;
  } catch (error) {
    console.error(`Error generating related sample data for ${objectApiName}:`, error);
    throw new Error(
      `Failed to generate related sample data: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
