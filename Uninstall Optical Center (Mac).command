#!/bin/bash
# Removes the Optical Center panel. Leaves Adobe's PlayerDebugMode setting and your saved presets
# alone, because other unsigned panels you use may rely on the first and the second is your data.
rm -rf "$HOME/Library/Application Support/Adobe/CEP/extensions/com.jro.opticalcenter"
echo "✓ Optical Center removed. Restart Illustrator."
echo "  Presets stay in ~/Library/Application Support/JRO/optical-center/"
read -n 1 -s -r -p "Press any key to close…"; echo
