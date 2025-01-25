/**
 * Toolbar Component
 * Controls for layout, zoom, and depth
 */

import {
  makeStyles,
  tokens,
  Button,
  Select,
  Tooltip,
} from '@fluentui/react-components';
import {
  ArrowExpand24Regular,
  ZoomIn24Regular,
  ZoomOut24Regular,
} from '@fluentui/react-icons';

const useStyles = makeStyles({
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingVerticalS,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  spacer: {
    flex: 1,
  },
  depthSelect: {
    width: '120px',
  },
});

interface ToolbarProps {
  children?: React.ReactNode;
  depth: number;
  onDepthChange: (depth: number) => void;
  onFitToScreen?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
}

export function Toolbar({
  children,
  depth,
  onDepthChange,
  onFitToScreen,
  onZoomIn,
  onZoomOut,
}: ToolbarProps) {
  const styles = useStyles();

  return (
    <div className={styles.toolbar}>
      {children}

      <div className={styles.spacer} />

      <Select
        className={styles.depthSelect}
        value={String(depth)}
        onChange={(_, data) => onDepthChange(parseInt(data.value, 10))}
      >
        <option value="1">Depth: 1</option>
        <option value="2">Depth: 2</option>
        <option value="3">Depth: 3</option>
      </Select>

      <Tooltip content="Zoom In" relationship="label">
        <Button
          icon={<ZoomIn24Regular />}
          appearance="subtle"
          onClick={onZoomIn}
          aria-label="Zoom in"
        />
      </Tooltip>

      <Tooltip content="Zoom Out" relationship="label">
        <Button
          icon={<ZoomOut24Regular />}
          appearance="subtle"
          onClick={onZoomOut}
          aria-label="Zoom out"
        />
      </Tooltip>

      <Tooltip content="Fit to Screen" relationship="label">
        <Button
          icon={<ArrowExpand24Regular />}
          appearance="subtle"
          onClick={onFitToScreen}
          aria-label="Fit to screen"
        />
      </Tooltip>
    </div>
  );
}
