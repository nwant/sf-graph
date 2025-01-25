# summary
List few-shot SOQL examples

# description
Display examples in the few-shot store used for dynamic prompting.

# examples
- <%= config.bin %> <%= command.id %> --limit 10
- <%= config.bin %> <%= command.id %> --pattern polymorphic

# flags.pattern.summary
Filter by pattern tag (e.g., polymorphic, aggregate, join)

# flags.limit.summary
Maximum number of examples to show

# flags.json.summary
Format output as JSON

# info.no-examples
No examples found. Run "sf graph ai examples seed" first.

# info.list-header
Few-Shot Examples (%s of %s):

# info.showing-pattern
Showing examples with pattern "%s".

# info.hint
Use --limit to see more, or --pattern to filter.
