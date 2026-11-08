// Download categories: the toolbar and the per-post category badge.
// Mixed into ArtistSearchTool (see utils/mixMethods.js).
export default class ArtistSearchCategories {
/**
 * Detect existing style/category subfolders under the current artist or
 * character's download folder (e.g. jrjresq/flat, /shaded, /sketch) and
 * refresh the toolbar/per-post controls that let results be routed into them.
 */
async refreshAvailableCategories() {
  this.availableCategories = [];

  if (this.currentArtist) {
    try {
      const folderName = this.getDownloadFolderName();
      const downloadType = this.getDownloadType();
      const result = await window.electronAPI.utils.getCategorySubfolders({ folderName, downloadType });
      if (result?.success) {
        this.availableCategories = result.subFolders || [];
      }
    } catch (error) {
      console.warn('⚠️ Could not load category subfolders:', error);
    }
  }

  this.updateCategoryToolbarUI();
}

/**
 * Show/hide and populate the bulk "Apply category" toolbar controls based
 * on whether any category subfolders were detected for the current artist.
 */
updateCategoryToolbarUI() {
  const hasCategories = this.availableCategories.length > 0;

  if (this.elements.category_toolbar_divider) {
    this.elements.category_toolbar_divider.style.display = hasCategories ? 'block' : 'none';
  }
  if (this.elements.apply_category_btn) {
    this.elements.apply_category_btn.style.display = hasCategories ? 'inline-flex' : 'none';
  }
  if (this.elements.bulk_category_select) {
    this.elements.bulk_category_select.style.display = hasCategories ? 'inline-block' : 'none';
    this.elements.bulk_category_select.innerHTML =
      `<option value="">Category: (root)</option>${this._buildCategoryOptionsHtml('', false)}`;
  }
}

/**
 * Build <option> HTML for the detected categories. When includeRoot is
 * false the caller already supplied its own "(root)" option (bulk select).
 */
_buildCategoryOptionsHtml(selected, includeRoot = true) {
  let html = includeRoot ? `<option value="">(root)</option>` : '';
  for (const cat of this.availableCategories) {
    const isSelected = selected === cat ? ' selected' : '';
    html += `<option value="${this.escapeHtml(cat)}"${isSelected}>${this.escapeHtml(cat)}</option>`;
  }
  return html;
}

/**
 * Assign (or clear) a category for a single post and refresh its dropdown/badge.
 */
setPostCategory(postId, category) {
  if (category) {
    this.postCategories.set(postId, category);
  } else {
    this.postCategories.delete(postId);
  }
  this.updatePostCategoryBadge(postId);
}

/**
 * Sync a post card's persistent category badge and dropdown value with
 * the current this.postCategories state.
 */
updatePostCategoryBadge(postId) {
  const postEl = document.querySelector(`[data-post-id="${postId}"]`);
  if (!postEl) return;

  const category = this.postCategories.get(postId) || '';

  const badge = postEl.querySelector('.post-category-badge');
  if (badge) {
    badge.textContent = category;
    badge.title = category ? `Category: ${category}` : '';
    badge.style.display = category ? 'flex' : 'none';
  }

  const select = postEl.querySelector('.post-category-select');
  if (select) select.value = category;
}

/**
 * Apply the toolbar's chosen category to every currently selected post.
 */
applyCategoryToSelected() {
  if (this.selectedPosts.size === 0) {
    this.showToast('No posts selected', 'warning');
    return;
  }

  const category = this.elements.bulk_category_select?.value || '';
  this.selectedPosts.forEach(postId => this.setPostCategory(postId, category));

  const label = category || '(root)';
  this.showToast(`Set category "${label}" for ${this.selectedPosts.size} selected post(s)`, 'success');
}
}
