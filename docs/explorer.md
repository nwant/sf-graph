# Graph Explorer

Interactive terminal UI for navigating Salesforce metadata relationships.

## Usage

```bash
sf graph explore [--org <alias>] [--start-object <ObjectName>]
```

**Examples:**
```bash
sf graph explore                    # Start from Account
sf graph explore -o dev -s Contact  # Start from Contact in dev org
```

## Main View

The screen is split into two panes:

| Pane | Content |
|------|---------|
| Left | Object browser showing PARENTS and CHILDREN relationships |
| Right | Navigation path (breadcrumb tree) |

## Key Bindings

### Navigation
| Key | Action |
|-----|--------|
| `↑`/`↓` or `j`/`k` | Navigate list items |
| `Tab` | Switch between PARENTS/CHILDREN sections |
| `Enter` | Navigate to selected object |
| `b` | Go back in history |
| `r` | Reset to start object |
| `1`-`9` | Jump to path node by index |

### Filter Mode
| Key | Action |
|-----|--------|
| `/` | Start filtering |
| Type | Filter results in real-time |
| `Tab`/`Shift+Tab` | Navigate filtered results (cycles) |
| `Enter` | Select and exit filter |
| `Ctrl+O` | Select and navigate to object |
| `Escape` | Clear filter |

### Inspect
| Key | Action |
|-----|--------|
| `i` | Inspect selected field |
| `I` | Open object detail modal |
| `t` | Traverse to referenced object (in field inspect) |
| `c` | Copy API name to clipboard |

### Exit
| Key | Action |
|-----|--------|
| `q` or `Escape` | Quit explorer |
| `Ctrl+C` | Force quit |

## Status Bar

The bottom status bar shows context-sensitive key hints for the current view.
