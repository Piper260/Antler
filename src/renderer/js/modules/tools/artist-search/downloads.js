import { sanitizeForFilesystem, underscoresToSpaces } from '../../../utils/stringUtils.js';

// Downloading posts and their tags, and where they go.
// Mixed into ArtistSearchTool (see utils/mixMethods.js).
export default class ArtistSearchDownloads {
/**
 * Open the current artist's or character's dataset folder, or the folder
 * that holds them all when nothing has been searched yet.
 */
async openDatasetFolder() {
  const name = this.currentArtist ? this.getDownloadFolderName() : '';
  try {
    const result = await window.electronAPI.utils.openDownloadsFolder(name, this.getDownloadType());
    if (!result?.success) this.showToast(result?.message || 'Could not open the folder', 'error');
  } catch (error) {
    console.error('❌ Error opening folder:', error);
    this.showToast('Could not open the folder', 'error');
  }
}

/**
 * Download the selected posts. Runs in the background: progress shows in the
 * sidebar's Processes section, and the tool can be left (it is kept alive)
 * or used for a new search while it runs. Everything the download needs is
 * captured up front so a new search or selection doesn't change it midway.
 */
async downloadSelectedPosts() {
  if (this.selectedPosts.size === 0) {
    this.showToast('No posts selected for download', 'warning');
    return;
  }

  const folderPath = this.getDownloadFolderPath();
  const selectedIds = Array.from(this.selectedPosts);
  const posts = selectedIds.map(id => this.currentPosts.find(p => p.id === id)).filter(Boolean);
  const searchType = this.searchMode === 'artist' ? 'artist' : 'character';
  const searchName = this.currentArtist;
  const tagsOnly = this.elements.tags_only_toggle?.checked ?? false;

  console.log(`⬇️ Starting batch download: ${posts.length} posts for ${searchType} "${searchName}" to ${folderPath}/${tagsOnly ? ' [tags only]' : ''}`);

  // The queued posts leave the selection now, so the same posts can't be
  // queued twice and a new selection can be built while this runs.
  posts.forEach(post => {
    this.selectedPosts.delete(post.id);
    this.updatePostSelectionUI(post.id);
  });
  this.updateSelectionUI();

  const process = this.app?.startProcess?.({
    toolId: this.id,
    label: `${tagsOnly ? 'Updating tags' : 'Downloading'}: ${searchName}`,
    total: posts.length
  });
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < posts.length; i++) {
    process?.update({ done: i, detail: `Post ${posts[i].id}` });
    try {
      await this.downloadSinglePost(posts[i], folderPath, tagsOnly);
      successCount++;
    } catch (error) {
      console.error(`❌ Failed to download post ${posts[i].id}:`, error);
      errorCount++;
    }
  }

  process?.finish({
    message: errorCount > 0 ? `${successCount} done, ${errorCount} failed` : `${successCount} done`,
    failed: successCount === 0 && errorCount > 0,
    warning: errorCount > 0
  });

  if (errorCount === 0) {
    const modeLabel = tagsOnly ? 'tag files' : 'posts';
    this.showToast(`Updated ${successCount} ${modeLabel} in ${folderPath}/ folder`, 'success');
  } else {
    this.showToast(`Downloaded ${successCount} posts, ${errorCount} failed`, 'warning');
  }
}

/**
 * Download a single post
 */
async downloadSinglePost(post, folderPath = null, tagsOnly = this.elements.tags_only_toggle?.checked ?? false) {
  const postId = post.id;
  const downloadPath = folderPath || this.getDownloadFolderPath();
  
  const tasks = [this.downloadPostTags(post, downloadPath)];
  if (!tagsOnly) {
    tasks.push(this.downloadPostImage(post, downloadPath));
  }

  // Download image (unless tags-only) and tags
  await Promise.all(tasks);
  
  // Mark as downloaded so the card border highlights
  this.downloadedPosts.add(postId);
  this.updateDownloadStatusUI(postId, true);
  
  console.log(`✅ Downloaded post ${postId} to ${downloadPath}/${tagsOnly ? ' (tags only)' : ''}`);
}

/**
 * Download post image
 */
async downloadPostImage(post, folderPath) {
  const imageUrl = this.getPostImageUrl(post);
  if (!imageUrl) {
    throw new Error('No image URL available');
  }
  
  const fileName = `${post.id}.${post.metadata?.fileType || 'jpg'}`;
  const folderName = this.getDownloadFolderName();
  const downloadType = this.getDownloadType();
  const subFolder = this.postCategories.get(post.id) || '';

  const result = await window.electronAPI.utils.downloadImage({
    url: imageUrl,
    artistName: folderName,
    fileName,
    downloadType,
    subFolder
  });

  if (!result.success) {
    throw new Error(result.message);
  }
}

/**
 * Download post tags
 */
async downloadPostTags(post, folderPath) {
  const tags = this.getPostTrainingTags(post);
  // Convert underscores to spaces for saved tags (e.g. "blue_eyes" -> "blue eyes")
  const processedTags = tags.map(tag => underscoresToSpaces(tag));
  const content = processedTags.join(', ');
  const fileName = `${post.id}.txt`;
  const folderName = this.getDownloadFolderName();
  const downloadType = this.getDownloadType();
  const subFolder = this.postCategories.get(post.id) || '';

  const result = await window.electronAPI.utils.saveToDownloads({
    artistName: folderName,
    fileName,
    content,
    downloadType,
    subFolder
  });

  if (!result.success) {
    throw new Error(result.message);
  }
}

/**
 * Get image URL from post
 */
getPostImageUrl(post) {
  const fileUrls = post.fileUrls;
  return fileUrls?.original || fileUrls?.sample || fileUrls?.preview || null;
}

/**
 * Get training tags from post
 */
getPostTrainingTags(post) {
  const tags = [];
  
  if (post.tags?.character) {
    tags.push(...post.tags.character);
  }

  if (post.tags?.copyright) {
    tags.push(...post.tags.copyright);
  }

  if (post.tags?.species) {
    tags.push(...post.tags.species);
  }
  
  if (post.tags?.general) {
    tags.push(...post.tags.general);
  }
  
  return [...new Set(tags)].sort();
}

/**
 * Get folder name for downloads (without type prefix)
 */
getDownloadFolderName() {
  // Convert underscores to spaces, then sanitize for filesystem
  const nameWithSpaces = underscoresToSpaces(this.currentArtist) || 'unknown';
  return sanitizeForFilesystem(nameWithSpaces);
}

/**
 * Get download type based on search mode
 */
getDownloadType() {
  return this.searchMode === 'artist' ? 'artist' : 'character';
}

/**
 * Get folder path for downloads based on search mode (legacy)
 */
getDownloadFolderPath() {
  const searchType = this.searchMode === 'artist' ? 'artists' : 'characters';
  return `${searchType}/${this.getDownloadFolderName()}`;
}

/**
 * Get artist name for folder creation (legacy compatibility)
 */
getArtistName() {
  return this.getDownloadFolderName();
}
}
