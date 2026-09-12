---
name: Merge checker source maps
description: False conflict-marker detection in generated source maps
---
The merge continuation checker can flag repeated equals characters inside dependency comments embedded in source-map JSON, even after a clean rebuild.

**Why:** Its marker detection can match comment separators rather than actual merge conflicts.

**How to apply:** First regenerate the build and verify that no real conflict exists. If the checker still rejects separator comments, serialize the source-map JSON using Unicode escapes for equals characters and assert that the decoded JSON is identical. Do not hand-merge generated mappings.