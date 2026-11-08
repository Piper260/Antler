import { safeParseInt } from '../../../utils/parsers.js';

// Selecting posts: single, range, pattern, all, and inverting.
// Mixed into ArtistSearchTool (see utils/mixMethods.js).
export default class ArtistSearchSelection {
/**
 * Toggle post selection
 */
togglePostSelection(postId) {
  if (this.selectedPosts.has(postId)) {
    this.selectedPosts.delete(postId);
  } else {
    this.selectedPosts.add(postId);
  }
  
  this.updatePostSelectionUI(postId);
  this.updateSelectionUI();
}

/**
 * Update selection UI for a specific post
 */
updatePostSelectionUI(postId) {
  const postElement = document.querySelector(`[data-post-id="${postId}"]`);
  if (postElement) {
    if (this.selectedPosts.has(postId)) {
      postElement.classList.add('selected');
    } else {
      postElement.classList.remove('selected');
    }
  }
}

/**
 * Enhanced update selection UI with floating actions
 */
updateSelectionUI() {
  const selectedCount = this.selectedPosts.size;
  const totalPosts = this.currentPosts.length;
  
  if (this.elements.floating_selection_count) {
    this.elements.floating_selection_count.textContent = selectedCount;
  }
  
  if (this.elements.selected_count_text) {
    this.elements.selected_count_text.textContent = selectedCount === 0
      ? 'No posts selected'
      : `${selectedCount} of ${totalPosts} selected`;
  }
  if (this.elements.download_selected_btn) {
    this.elements.download_selected_btn.disabled = selectedCount === 0;
  }
  if (this.elements.download_selected_text) {
    this.elements.download_selected_text.textContent = selectedCount > 0 ? `Download ${selectedCount}` : 'Download';
  }
}

/**
 * Toggle selection mode
 */
toggleSelectionMode() {
  const modes = ['normal', 'range', 'pattern'];
  const currentIndex = modes.indexOf(this.selectionMode);
  const nextIndex = (currentIndex + 1) % modes.length;
  
  this.selectionMode = modes[nextIndex];
  
  if (this.elements.selection_mode_text) {
    this.elements.selection_mode_text.textContent = this.selectionMode.charAt(0).toUpperCase() + this.selectionMode.slice(1);
  }
  
  const modeDescriptions = {
    normal: 'Click to select individual posts',
    range: 'Click to select ranges of posts',
    pattern: 'Click to select every Nth post'
  };
  
  this.showToast(modeDescriptions[this.selectionMode], 'info');
  console.log(`🎯 Selection mode changed to: ${this.selectionMode}`);
}

/**
 * Select all visible posts
 */
selectAllVisiblePosts() {
  const visiblePosts = document.querySelectorAll('.post-thumbnail:not(.selected)');
  let selectedCount = 0;
  
  visiblePosts.forEach(postElement => {
    const postId = safeParseInt(postElement.getAttribute('data-post-id'), 0);
    if (postId && !this.selectedPosts.has(postId)) {
      this.selectedPosts.add(postId);
      postElement.classList.add('selected');
      selectedCount++;
    }
  });
  
  this.updateSelectionUI();
  this.showToast(`Selected ${selectedCount} visible posts`, 'success');
}

/**
 * Start range selection mode
 */
startRangeSelection() {
  this.selectionMode = 'range';
  this.lastSelectedIndex = -1;
  
  if (this.elements.selection_mode_text) {
    this.elements.selection_mode_text.textContent = 'Range';
  }
  
  this.showToast('Range selection enabled. Click two posts to select range.', 'info');
}

/**
 * Select range of posts
 */
selectRange(endIndex) {
  if (this.lastSelectedIndex === -1) {
    // First click - just select this post
    this.lastSelectedIndex = endIndex;
    const postId = this.currentPosts[endIndex]?.id;
    if (postId) {
      this.selectedPosts.add(postId);
      this.updatePostSelectionUI(postId);
    }
  } else {
    // Second click - select range
    const startIndex = Math.min(this.lastSelectedIndex, endIndex);
    const endIdx = Math.max(this.lastSelectedIndex, endIndex);
    
    let selectedCount = 0;
    for (let i = startIndex; i <= endIdx; i++) {
      const post = this.currentPosts[i];
      if (post && !this.selectedPosts.has(post.id)) {
        this.selectedPosts.add(post.id);
        this.updatePostSelectionUI(post.id);
        selectedCount++;
      }
    }
    
    this.showToast(`Selected ${selectedCount} posts in range`, 'success');
    this.lastSelectedIndex = -1;
  }
  
  this.updateSelectionUI();
}

/**
 * Start pattern selection
 */
startPatternSelection() {
  const pattern = prompt('Select every Nth post (e.g., 2 for every 2nd post, 3 for every 3rd):');
  const n = safeParseInt(pattern, 0);
  
  if (n < 1) {
    this.showToast('Invalid pattern. Please enter a number greater than 0.', 'error');
    return;
  }
  
  let selectedCount = 0;
  this.updateSelectionUI();
  this.showToast(`Selected ${selectedCount} posts with pattern ${n}`, 'success');
}

/**
 * Invert current selection
 */
invertSelection() {
  const newSelection = new Set();
  
  this.currentPosts.forEach(post => {
    if (!this.selectedPosts.has(post.id)) {
      newSelection.add(post.id);
    }
  });
  
  // Update selection
  this.selectedPosts = newSelection;
  
  // Update UI for all posts
  document.querySelectorAll('.post-thumbnail').forEach(postElement => {
    const postId = safeParseInt(postElement.getAttribute('data-post-id'), 0);
    if (this.selectedPosts.has(postId)) {
      postElement.classList.add('selected');
    } else {
      postElement.classList.remove('selected');
    }
  });
  
  this.updateSelectionUI();
  this.showToast(`Inverted selection: ${this.selectedPosts.size} posts selected`, 'success');
}

/**
 * Select all posts
 */
selectAllPosts() {
  this.currentPosts.forEach(post => {
    this.selectedPosts.add(post.id);
    this.updatePostSelectionUI(post.id);
  });
  
  this.updateSelectionUI();
  this.showToast(`Selected ${this.currentPosts.length} posts`, 'success');
}

/**
 * Select all loaded posts that already exist on disk (green-bordered posts).
 * Re-runs a fresh existence check first so newly scrolled-in posts are included.
 */
async selectExistedPosts() {
  if (!this.currentPosts.length) {
    this.showToast('No posts loaded', 'warning');
    return;
  }

  // Refresh existence status for all currently loaded posts, then select
  try {
    await this.checkDownloadStatus();
  } catch (_) { /* non-fatal */ }

  if (this.downloadedPosts.size === 0) {
    this.showToast('No downloaded posts found in this folder', 'info');
    return;
  }

  let count = 0;
  this.currentPosts.forEach(post => {
    if (this.downloadedPosts.has(post.id)) {
      this.selectedPosts.add(post.id);
      this.updatePostSelectionUI(post.id);
      count++;
    }
  });

  this.updateSelectionUI();
  this.showToast(`Selected ${count} already-downloaded post${count !== 1 ? 's' : ''}`, 'success');
}

/**
 * Deselect all posts
 */
deselectAllPosts() {
  const previousCount = this.selectedPosts.size;
  
  this.selectedPosts.clear();
  
  // Update UI for all posts
  document.querySelectorAll('.post-thumbnail.selected').forEach(element => {
    element.classList.remove('selected');
  });
  
  this.updateSelectionUI();
  this.showToast(`Deselected ${previousCount} posts`, 'info');
}
}
