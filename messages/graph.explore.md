# summary

Explore the metadata graph interactively.

# description

Navigate through metadata objects and their relationships via a visual terminal interface with keyboard navigation. The explorer provides a multi-pane layout showing object details, fields, relationships, and navigation history.

Use arrow keys to navigate, Enter to select, and Escape to go back. Press 'q' to quit the explorer.

# flags.target-org.summary

The Salesforce org to explore.

# flags.start-object.summary

Object to start exploration from.

# examples

- Launch the explorer starting with Account:

  <%= config.bin %> <%= command.id %>

- Explore a specific org:

  <%= config.bin %> <%= command.id %> --target-org my-org

- Start exploring from Contact object:

  <%= config.bin %> <%= command.id %> --start-object Contact
