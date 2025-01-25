/**
 * ObjectPanel Component
 * Side panel showing selected node details with expandable field list
 */

import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Divider,
  Button,
  Spinner,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
} from '@fluentui/react-components';
import { Dismiss24Regular } from '@fluentui/react-icons';
import type { CytoscapeNode, CytoscapeEdge } from '../types/graph';
import { useObjectFields } from '../hooks/useObjectFields';

const useStyles = makeStyles({
  panel: {
    width: '320px',
    backgroundColor: tokens.colorNeutralBackground1,
    borderLeft: `1px solid ${tokens.colorNeutralStroke1}`,
    padding: tokens.spacingHorizontalL,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase500,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  sectionTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  stat: {
    display: 'flex',
    justifyContent: 'space-between',
  },
  relationshipItem: {
    padding: tokens.spacingVerticalXS,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground2Hover,
    },
  },
  fieldItem: {
    padding: tokens.spacingVerticalXS,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
    marginBottom: tokens.spacingVerticalXS,
  },
  fieldType: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    fontFamily: 'monospace',
  },
  empty: {
    color: tokens.colorNeutralForeground3,
    textAlign: 'center' as const,
    padding: tokens.spacingVerticalXXL,
  },
  fieldList: {
    maxHeight: '300px',
    overflowY: 'auto',
  },
});

interface ObjectPanelProps {
  selectedNode: CytoscapeNode | null;
  relatedEdges: CytoscapeEdge[];
  onClose: () => void;
  onNavigate: (nodeId: string) => void;
}

export function ObjectPanel({
  selectedNode,
  relatedEdges,
  onClose,
  onNavigate,
}: ObjectPanelProps) {
  const styles = useStyles();
  const { fields, loading: fieldsLoading } = useObjectFields(
    selectedNode?.data.id || null
  );

  if (!selectedNode) {
    return (
      <div className={styles.panel}>
        <div className={styles.empty}>
          <Text>Select an object to view details</Text>
        </div>
      </div>
    );
  }

  const { data } = selectedNode;
  const outgoing = relatedEdges.filter((e) => e.data.source === data.id);
  const incoming = relatedEdges.filter((e) => e.data.target === data.id);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <Text className={styles.title}>{data.label}</Text>
          <br />
          <Text className={styles.subtitle}>{data.id}</Text>
        </div>
        <Button
          icon={<Dismiss24Regular />}
          appearance="subtle"
          onClick={onClose}
          aria-label="Close panel"
        />
      </div>

      <Badge appearance="outline" color={data.category === 'custom' ? 'important' : 'informative'}>
        {data.category}
      </Badge>

      {data.description && (
        <Text size={200}>{data.description}</Text>
      )}

      <Divider />

      <div className={styles.section}>
        <div className={styles.stat}>
          <Text>Fields</Text>
          <Text weight="semibold">{data.fieldCount ?? fields.length}</Text>
        </div>
        <div className={styles.stat}>
          <Text>Depth</Text>
          <Text weight="semibold">{data.depth ?? 0}</Text>
        </div>
      </div>

      {/* Field Details Section */}
      <Accordion collapsible>
        <AccordionItem value="fields">
          <AccordionHeader>
            Fields ({fields.length})
          </AccordionHeader>
          <AccordionPanel>
            {fieldsLoading ? (
              <Spinner size="tiny" label="Loading fields..." />
            ) : (
              <div className={styles.fieldList}>
                {fields.map((field) => (
                  <div key={field.apiName} className={styles.fieldItem}>
                    <Text weight="semibold" size={200}>{field.label}</Text>
                    <br />
                    <Text className={styles.fieldType}>
                      {field.apiName} • {field.type}
                      {field.referenceTo && field.referenceTo.length > 0 && (
                        <> → {field.referenceTo.join(', ')}</>
                      )}
                    </Text>
                  </div>
                ))}
              </div>
            )}
          </AccordionPanel>
        </AccordionItem>
      </Accordion>

      {outgoing.length > 0 && (
        <>
          <Divider />
          <div className={styles.section}>
            <Text className={styles.sectionTitle}>
              Lookups ({outgoing.length})
            </Text>
            {outgoing.map((edge) => (
              <div
                key={edge.data.id}
                className={styles.relationshipItem}
                onClick={() => onNavigate(edge.data.target)}
              >
                <Text weight="semibold">{edge.data.target}</Text>
                <br />
                <Text size={200}>via {edge.data.label || edge.data.fieldApiName}</Text>
              </div>
            ))}
          </div>
        </>
      )}

      {incoming.length > 0 && (
        <>
          <Divider />
          <div className={styles.section}>
            <Text className={styles.sectionTitle}>
              Referenced by ({incoming.length})
            </Text>
            {incoming.map((edge) => (
              <div
                key={edge.data.id}
                className={styles.relationshipItem}
                onClick={() => onNavigate(edge.data.source)}
              >
                <Text weight="semibold">{edge.data.source}</Text>
                <br />
                <Text size={200}>via {edge.data.label || edge.data.fieldApiName}</Text>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
