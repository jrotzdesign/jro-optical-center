# Optical Center

Illustrator CEP panel that aligns objects by visual mass instead of bounding box. Work in progress.

## Tests

```
npm test
```

## Known limits

- **Groups:** member areas are summed, so overlapping members count twice. A group of two overlapping squares weighs the overlap double. This is pinned by a test, not an oversight.
- **Compound paths:** subpaths must nest or stay apart. Subpaths that cross each other are not handled.
- **Open paths:** treated as closed by a straight line when computing area, which is how Illustrator fills them.
