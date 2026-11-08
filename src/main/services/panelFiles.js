/**
 * Where a panel's exported files are. A panel keeps the file name it was
 * exported under (box.exportName), because its number in the page changes
 * when panels are deleted or reordered. Exported images may since have been
 * upscaled, possibly into another format, so any image with the panel's name
 * counts as that panel's image and is never replaced.
 */
const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.tiff', '.tif', '.bmp'];

const panelFileName = (baseName, number) => `${baseName}_p${String(number).padStart(2, '0')}`;

/** The image already exported under `name`, if there is one. */
function findPanelImage(folder, name) {
  for (const extension of IMAGE_EXTENSIONS) {
    const filePath = path.join(folder, `${name}${extension}`);
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

/** The first name from `number` up that no panel or image is using; adds it to `taken`. */
function freePanelName(baseName, number, folder, taken) {
  for (let n = number; ; n++) {
    const name = panelFileName(baseName, n);
    if (taken.has(name) || findPanelImage(folder, name)) continue;
    taken.add(name);
    return name;
  }
}

module.exports = { panelFileName, findPanelImage, freePanelName };
