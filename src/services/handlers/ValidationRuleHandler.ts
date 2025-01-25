import { Transaction, ManagedTransaction } from 'neo4j-driver';
import { MetadataItem } from '../salesforce.js';
import { BaseHandler } from './BaseHandler.js';

export class ValidationRuleHandler extends BaseHandler {
  async process(tx: Transaction | ManagedTransaction, item: MetadataItem): Promise<void> {
    // item.fullName is typically 'Object.RuleName'
    const parts = item.name.split('.'); // Assuming name or fullName? BaseHandler passes MetadataItem which has name.
    const objectName = parts[0];
    const ruleName = parts.length > 1 ? parts[1] : item.name;

    const content = this.normalizeContent(item, 'ValidationRule');
    const description = (content.description as string) || '';
    const errorConditionFormula = (content.errorConditionFormula as string) || '';
    const errorMessage = (content.errorMessage as string) || '';

    // Create the ValidationRule node
    await tx.run(
      `
            MERGE (vr:ValidationRule {fullName: $fullName, orgId: $orgId})
            ON CREATE SET
                vr.name = $ruleName,
                vr.description = $description,
                vr.errorConditionFormula = $errorConditionFormula,
                vr.errorMessage = $errorMessage,
                vr.lastRefreshed = datetime()
            ON MATCH SET
                vr.name = $ruleName,
                vr.description = $description,
                vr.errorConditionFormula = $errorConditionFormula,
                vr.errorMessage = $errorMessage,
                vr.lastRefreshed = datetime()
            `,
      {
        fullName: item.name, // Use item.name instead of item.fullName if they are same, based on interface
        ruleName,
        description,
        errorConditionFormula,
        errorMessage,
        orgId: item.orgId || null
      }
    );

    // Link to Parent Object if dot notation exists
    if (parts.length > 1) {
      await tx.run(
        `
                MATCH (o:Object), (vr:ValidationRule)
                WHERE toLower(o.apiName) = toLower($objectName) AND ($orgId IS NULL OR o.orgId = $orgId)
                AND vr.fullName = $fullName AND ($orgId IS NULL OR vr.orgId = $orgId)
                MERGE (o)-[:HAS_VALIDATION_RULE]->(vr)
                MERGE (vr)-[:BELONGS_TO]->(o)
                `,
        {
          objectName,
          fullName: item.name,
          orgId: item.orgId || null
        }
      );
    } else {
      console.warn(
        `ValidationRule ${item.name} does not follow 'Object.Rule' naming convention. Created as a standalone node.`
      );
    }
  }
}
