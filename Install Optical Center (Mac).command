#!/bin/bash
# Optical Center: macOS installer for Illustrator 2024 / 2025 / 2026
# Double-click this file (if macOS blocks it: right-click, then Open).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
EXT_ID="com.jro.opticalcenter"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions"

echo ""
echo "  Optical Center: installer"
echo "  -------------------------"

# 1. Panel (CEP extension, per-user, no admin password needed). Runtime files only.
mkdir -p "$DEST"
rm -rf "$DEST/$EXT_ID"
mkdir -p "$DEST/$EXT_ID"
cp -R "$HERE/CSXS" "$HERE/css" "$HERE/fonts" "$HERE/js" "$HERE/jsx" "$HERE/index.html" "$HERE/.debug" "$DEST/$EXT_ID/"
xattr -dr com.apple.quarantine "$DEST/$EXT_ID" 2>/dev/null || true
echo "  ✓ Panel installed to: $DEST/$EXT_ID"

# 2. Allow unsigned panels (needed for any self-made CEP panel)
for v in 9 10 11 12 13 14; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
killall cfprefsd 2>/dev/null || true
echo "  ✓ PlayerDebugMode enabled (CSXS 9–14)"

echo ""
echo "  Done. Quit and reopen Illustrator, then open:"
echo "    Window → Extensions → Optical Center"
echo "  Presets are kept in: ~/Library/Application Support/JRO/optical-center/presets.json"
echo ""
read -n 1 -s -r -p "  Press any key to close…"
echo ""
