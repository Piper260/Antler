// The full-size image preview.
// Mixed into ArtistSearchTool (see utils/mixMethods.js).
export default class ArtistSearchPreview {
/**
 * View full size post in modal
 */
viewFullSizePost(post) {
  const imageUrl = this.getPostImageUrl(post);
  if (imageUrl) {
    this.showImagePreviewModal(post, imageUrl);
  } else {
    this.showToast('No full size image available', 'warning');
  }
}

/**
 * Show image preview modal
 */
showImagePreviewModal(post, imageUrl) {
  this.previewPost = post;

  // Create modal if it doesn't exist
  let modal = document.getElementById('image-preview-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'image-preview-modal';
    modal.className = 'image-preview-modal';
    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3>Post #<span id="modal-post-id"></span></h3>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-download-btn">
              <i class="fas fa-download"></i> Download
            </button>
            <button class="btn btn-secondary" id="modal-open-original">
              <i class="fas fa-external-link-alt"></i> Open Original
            </button>
            <button class="btn btn-secondary" id="modal-close-btn">
              <i class="fas fa-times"></i> Close
            </button>
          </div>
        </div>
        <div class="modal-body">
          <img id="modal-image" src="" alt="Loading..." />
          <div class="modal-loading">
            <div class="loading-spinner"></div>
            <p>Loading image...</p>
          </div>
        </div>
        <div class="modal-footer">
          <div class="post-metadata">
            <span class="meta-item">Score: <span id="modal-score"></span></span>
            <span class="meta-item">Rating: <span id="modal-rating"></span></span>
            <span class="meta-item">Size: <span id="modal-dimensions"></span></span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Add event listeners
    this.on(modal.querySelector('#modal-close-btn'), 'click', () => this.hideImagePreviewModal());
    this.on(modal.querySelector('#modal-backdrop'), 'click', () => this.hideImagePreviewModal());
    
    this.on(modal.querySelector('#modal-download-btn'), 'click', () => {
      if (this.previewPost) {
        this.downloadSinglePost(this.previewPost, this.getDownloadFolderPath());
        this.hideImagePreviewModal();
      }
    });
    
    this.on(modal.querySelector('#modal-open-original'), 'click', () => {
      const img = modal.querySelector('#modal-image');
      if (img && img.src) {
        window.open(img.src, '_blank');
      }
    });
    
    // ESC key to close
    this.onDocument('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        this.hideImagePreviewModal();
      }
    });
  }
  
  // Update modal content
  modal.querySelector('#modal-post-id').textContent = post.id;
  modal.querySelector('#modal-score').textContent = post.metadata?.score || 0;
  modal.querySelector('#modal-rating').textContent = post.metadata?.rating || 'safe';
  modal.querySelector('#modal-dimensions').textContent = 
    post.metadata?.dimensions ? `${post.metadata.dimensions.width}×${post.metadata.dimensions.height}` : 'Unknown';
  
  const modalImage = modal.querySelector('#modal-image');
  const loadingDiv = modal.querySelector('.modal-loading');
  
  // Show loading state
  loadingDiv.style.display = 'flex';
  modalImage.style.display = 'none';
  
  // Load image
  modalImage.onload = () => {
    loadingDiv.style.display = 'none';
    modalImage.style.display = 'block';
  };
  modalImage.onerror = () => {
    loadingDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i><p>Failed to load image</p>';
  };
  modalImage.src = imageUrl;
  
  // Show modal
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden'; // Prevent background scroll
}

/**
 * Hide image preview modal
 */
hideImagePreviewModal() {
  const modal = document.getElementById('image-preview-modal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = ''; // Restore scroll
  }
}
}
