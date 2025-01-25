# summary

Extract standard object documentation from Salesforce Docs.

# description

Scrapes official Salesforce Object Reference to extract descriptions and field properties for standard objects. Saves locally for use with `sf graph sync --docs`.

Run once per API version (Salesforce releases ~3x/year).

# examples

- `sf graph docs extract 63`
- `sf graph docs extract 63.0 --force`
- `sf graph docs extract 63 -b5 -d500`

# flags.force.summary

Overwrite existing file without prompting.

# flags.batch-size.summary

Objects to fetch in parallel.

# flags.delay-min.summary

Minimum delay between requests (ms).

# flags.delay-max.summary

Maximum delay between requests (ms).

# flags.save-interval.summary

Save progress every N objects.

# args.apiVersion.description

API version (e.g., 63 or 63.0).

# info.starting

Starting extraction for API version %s...

# info.settings

Settings: batchSize=%d, delay=%d-%dms, saveInterval=%d

# info.outputPath

Output: %s

# info.foundObjects

Found %d objects in documentation index.

# info.processing

Processing %d objects...

# info.complete

Complete: %d objects saved.

# info.alreadyComplete

All objects extracted. Use --force to re-extract.

# confirm.overwrite

v%s exists (%d objects). Overwrite?

# warnings.partialData

Partial data found. Resuming...

# errors.invalidVersion

Invalid version. Use format: 63 or 63.0

# info.cancelled

Cancelled.

# info.fetchingIndex

Fetching object index...

# info.savedProgress

Progress saved (%d/%d)
