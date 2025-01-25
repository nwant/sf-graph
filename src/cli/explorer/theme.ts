/**
 * Explorer Theme
 *
 * Color palette, border styles, and UI constants for the neo-blessed explorer.
 * Designed to match the dark theme shown in mockups.
 */

// === Colors ===

export const colors = {
  // Background colors
  bg: {
    primary: '#1a1a1a',
    secondary: '#2d2d2d',
    selected: '#3d3d3d',
    hover: '#4d4d4d',
  },

  // Foreground colors
  fg: {
    primary: '#ffffff',
    secondary: '#b0b0b0',
    muted: '#707070',
    accent: '#e06c75',
    success: '#98c379',
    warning: '#e5c07b',
    info: '#61afef',
  },

  // Border colors
  border: {
    normal: '#505050',
    focus: '#707070',
    accent: '#e06c75',
  },
};

// === Styles ===

export const styles = {
  // Box styles
  box: {
    default: {
      fg: colors.fg.primary,
      bg: colors.bg.primary,
      border: {
        fg: colors.border.normal,
      },
    },
    focused: {
      fg: colors.fg.primary,
      bg: colors.bg.primary,
      border: {
        fg: colors.border.focus,
      },
    },
  },

  // List styles
  list: {
    item: {
      fg: colors.fg.secondary,
      bg: colors.bg.primary,
      hover: {
        fg: colors.fg.primary,
        bg: colors.bg.hover,
      },
    },
    selected: {
      fg: colors.fg.primary,
      bg: colors.bg.selected,
      bold: true,
    },
  },

  // Header styles
  header: {
    fg: colors.fg.muted,
    bg: colors.bg.primary,
    bold: true,
  },

  // Status bar styles
  statusBar: {
    fg: colors.fg.secondary,
    bg: colors.bg.secondary,
  },

  // Modal styles
  modal: {
    fg: colors.fg.primary,
    bg: colors.bg.secondary,
    border: {
      fg: colors.border.focus,
    },
  },
};

// === Layout ===

export const layout = {
  // Pane widths (percentage)
  leftPaneWidth: '50%',
  rightPaneWidth: '50%',

  // Status bar height
  statusBarHeight: 1,

  // Padding
  padding: {
    horizontal: 1,
    vertical: 0,
  },

  // Borders
  border: {
    type: 'line' as const,
  },
};

// === Icons/Symbols ===

export const symbols = {
  // Relationship indicators
  masterDetail: '[M-D]',
  polymorphic: '[poly]',

  // Navigation
  arrowRight: '→',
  arrowLeft: '←',
  arrowUp: '↑',
  arrowDown: '↓',
  branch: '└─',
  cycle: '○ cycle',

  // Selection
  cursor: '>',
  cursorSpace: ' ',

  // Status
  loading: '⟳',
  error: '✗',
  success: '✓',
};

// === Keybinding display ===

export const keyHints = {
  main: '↑/↓:nav  ←/→:toggle  enter:go  /:filter  x:fields  q:quit',
  fieldInspect: 't:traverse Account  c:copy  esc:back',
  objectModal: 'esc:close',
  objectView: '↑/↓:nav  g:group  enter:go  /:filter  esc:back',
  objectViewGrouped: '↑/↓:nav  ←/→:toggle  g:ungroup  enter:go  /:filter  esc:back',
  filter: 'enter:filter  ^o:go  esc:cancel',
};
