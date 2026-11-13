// Finding larger copies of e621 results on Pawchive, and reviewing the
// close calls. The matching runs in the main process (UpgradeFinder.js);
// this file links the artist to a Pawchive creator, shows the results on the
// cards, and asks about pairs it isn't sure of.
// Mixed into ArtistSearchTool (see utils/mixMethods.js).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dims = (o) => (o?.width && o?.height ? `${o.width}×${o.height}` : 'size unknown');
const pixels = (o) => (o?.width || 0) * (o?.height || 0);
const ratioOf = (r) => (pixels(r.original) ? pixels(r.candidate) / pixels(r.original) : 0);
const BIGGER = 1.05; // matches imageMatch.BIGGER

function bytes(n) {
  if (!n) return '';
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

const STATUS_TEXT = { upgrade: null, same: 'Same size', variant: 'Variant', ask: 'Check' };

export default class ArtistSearchUpgrades {
/** Upgrades are looked for from e621/e926 artist results. */
upgradeAvailable() {
  return (this.source === 'e621' || this.source === 'e926') && this.searchMode === 'artist';
}

updateUpgradeButton() {
  const show = this.upgradeAvailable();
  if (this.elements.find_upgrades_btn) this.elements.find_upgrades_btn.style.display = show ? '' : 'none';
  if (this.elements.find_on_x_btn) this.elements.find_on_x_btn.style.display = show ? '' : 'none';
  if (this.elements.upgrade_divider) this.elements.upgrade_divider.style.display = show ? '' : 'none';
  if (!show && this.elements.upgrade_bar) this.elements.upgrade_bar.style.display = 'none';
  else this.renderUpgradeBar();
}

resetUpgrades() {
  this.upgradeResults = new Map();
  this.missingCount = 0;
  this.missingHidden = 0;
  this.upgradeRun = null;
  this.reviewSession = { same: 0, variant: 0, different: 0 };
  this.renderUpgradeBar();
}

/** The whole flow: link the artist if needed, match, show, offer a review. */
async findUpgrades() {
  if (!this.upgradeAvailable() || !this.currentArtist || !this.currentPosts.length) {
    this.showToast('Search an artist on e621 first', 'warning');
    return;
  }
  if (this.upgradeBusy) return;
  const artist = this.currentArtist;

  let link = (await window.electronAPI.pawchive.getLink(artist))?.link;
  if (!link) {
    link = await this.chooseCreator(artist);
    if (!link) return;
  }

  this.upgradeBusy = true;
  this.setUpgradeButtonBusy(true);
  const process = this.app?.startProcess?.({ toolId: this.id, label: `Pulling from Pawchive: ${artist}`, total: 100 });
  const weights = { posts: [0, 10], fingerprints: [10, 50], catalog: [50, 90], sizes: [90, 100] };
  const off = window.electronAPI.pawchive.onUpgradeProgress((p) => {
    const [from, to] = weights[p.stage] || [0, 100];
    const share = p.total ? p.done / p.total : 0;
    process?.update({ done: Math.round(from + (to - from) * share), detail: p.message });
  });

  try {
    // Only what matching needs crosses the bridge.
    const posts = this.currentPosts.map(p => ({
      id: p.id,
      metadata: { fileType: p.upgrade?.originalType || p.metadata?.fileType, dimensions: p.upgrade?.originalDims || p.metadata?.dimensions, fileSize: p.upgrade?.originalSize ?? p.metadata?.fileSize },
      fileUrls: { preview: p.fileUrls?.preview, sample: p.fileUrls?.sample }
    }));
    const result = await window.electronAPI.pawchive.findUpgrades({ artist, posts, site: this.source });
    if (artist !== this.currentArtist) {
      process?.finish({ message: 'Search changed; results dropped', warning: true });
      return;
    }
    if (!result?.success) {
      process?.finish({ message: result?.message || 'Failed', failed: true });
      if (result?.type === 'needs-link') await this.chooseCreator(artist);
      else this.showToast(result?.message || 'Could not look for upgrades', 'error');
      return;
    }

    // Results replace any earlier run's; applied upgrades are undone first.
    for (const post of this.currentPosts) this.revertUpgrade(post);
    this.upgradeResults = new Map(result.results.map(r => [r.postId, r]));
    this.upgradeRun = result;
    for (const r of result.results) {
      const post = this.currentPosts.find(p => p.id === r.postId);
      if (post && r.status === 'upgrade') this.applyUpgrade(post, r);
    }
    this.showMissingPosts(result.missing || []);
    this.refreshUpgradeBadges();
    this.renderUpgradeBar();

    const counts = this.upgradeCounts();
    const missing = (result.missing || []).length;
    process?.finish({ message: `${counts.upgrade} upgrades, ${counts.ask} to review, ${missing} only on Pawchive` });
    // Always say what came in, and where to look for it.
    const where = this.searchFilters?.sortBy === 'id' ? 'by date' : this.searchFilters?.sortBy === 'training' ? 'ranked for training' : 'at the end';
    const said = [
      missing ? `${missing} new ${missing === 1 ? 'image' : 'images'} added ${where}` : 'no new images',
      `${counts.upgrade} larger ${counts.upgrade === 1 ? 'copy' : 'copies'}`,
      counts.ask ? `${counts.ask} to review (press Review)` : ''
    ].filter(Boolean).join(', ');
    this.showToast(`Pulled from Pawchive: ${said}`, missing || counts.upgrade ? 'success' : 'info');
  } catch (error) {
    console.error('❌ Upgrade search failed:', error);
    process?.finish({ message: 'Failed', failed: true });
    this.showToast('Could not look for upgrades', 'error');
  } finally {
    off?.();
    this.upgradeBusy = false;
    this.setUpgradeButtonBusy(false);
  }
}

/**
 * The creator's Pawchive images that aren't on e621, mixed into the results
 * as posts of their own (they download from Pawchive): by date when sorted
 * by newest, ranked with the rest when sorted for training, and at the end
 * for score or favourites, which Pawchive doesn't have. A new run replaces
 * the last run's.
 */
showMissingPosts(missing) {
  const old = this.currentPosts.filter(p => p.onlyOnPawchive);
  if (old.length) {
    const gone = new Set(old.map(p => p.id));
    this.currentPosts = this.currentPosts.filter(p => !gone.has(p.id));
    for (const id of gone) {
      this.selectedPosts.delete(id);
      document.querySelector(`[data-post-id="${CSS.escape(String(id))}"]`)?.remove();
    }
  }
  // With Refine words set, only Pawchive-only posts whose title or tags have
  // them all (filters like rating:e don't apply to titles and are skipped).
  const words = String(this.currentTagFilter || '').toLowerCase().split(/[\s,]+/)
    .filter(w => w && !w.includes(':') && !w.startsWith('-'))
    .map(w => w.replace(/_/g, ' '));
  const text = (p) => [p.metadata?.description, ...(p.tags?.general || [])].join(' ').toLowerCase().replace(/_/g, ' ');
  const shown = words.length ? missing.filter(p => words.every(w => text(p).includes(w))) : missing;
  this.missingCount = shown.length;
  this.missingHidden = missing.length - shown.length;
  if (shown.length) {
    const posts = shown.map(p => ({ ...p, onlyOnPawchive: true }));
    this.currentPosts = this.mixInPosts(this.currentPosts, posts);
  }
  if (shown.length || old.length) this.displayPosts(this.currentPosts);
  this.updatePostCounts?.();
  this.updateSelectionUI?.();
}

/**
 * Posts from elsewhere placed among the results: a Pawchive image whose
 * post also has an image on e621 (nextTo) goes right after that e621 post,
 * so a post's images stay together; the rest go by the current sort.
 */
mixInPosts(current, extra) {
  const present = new Set(current.map(p => String(p.id)));
  const beside = extra.filter(p => p.nextTo != null && present.has(String(p.nextTo)));
  const placed = this.sortMixed(current, extra.filter(p => !beside.includes(p)));
  if (!beside.length) return placed;
  const after = new Map();
  for (const p of beside) {
    const key = String(p.nextTo);
    if (!after.has(key)) after.set(key, []);
    after.get(key).push(p);
  }
  const out = [];
  for (const p of placed) {
    out.push(p);
    const group = after.get(String(p.id));
    if (group) out.push(...group);
  }
  return out;
}

/** The current sort over results plus posts from elsewhere. */
sortMixed(current, extra) {
  const sort = this.searchFilters?.sortBy;
  if (sort === 'training' && window.TrainingScore) {
    return window.TrainingScore.rankPosts([...current, ...extra], this.searchMode);
  }
  if (sort === 'id') {
    // Newest first, by when each was posted (Pawchive ids aren't e621 ids).
    const time = (p) => Date.parse(p.metadata?.uploadedAt || '') || 0;
    return [...current, ...extra].sort((a, b) => time(b) - time(a));
  }
  return [...current, ...extra];
}

selectMissingPosts() {
  for (const post of this.currentPosts) {
    if (post.onlyOnPawchive && !this.selectedPosts.has(post.id)) {
      this.selectedPosts.add(post.id);
      this.updatePostSelectionUI(post.id);
    }
  }
  this.updateSelectionUI();
}

setUpgradeButtonBusy(busy) {
  const btn = this.elements.find_upgrades_btn;
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle('is-boosting', busy);
  const label = btn.querySelector('span') || btn;
  label.textContent = busy ? 'Pulling from Pawchive...' : 'Pull from Pawchive';
}

upgradeCounts() {
  const counts = { upgrade: 0, same: 0, variant: 0, ask: 0 };
  for (const r of this.upgradeResults?.values() || []) counts[r.status] = (counts[r.status] || 0) + 1;
  return counts;
}

/** Point the post's download at the Pawchive file, remembering the e621 one. */
applyUpgrade(post, r) {
  if (post.upgrade?.applied) return;
  post.upgrade = {
    applied: true,
    originalUrl: post.fileUrls?.original || null,
    originalType: post.metadata?.fileType || null,
    originalDims: post.metadata?.dimensions || null,
    originalSize: post.metadata?.fileSize || 0
  };
  post.fileUrls = { ...post.fileUrls, original: r.candidate.url };
  post.metadata = {
    ...post.metadata,
    fileType: r.candidate.format || post.metadata?.fileType,
    dimensions: { width: r.candidate.width, height: r.candidate.height },
    fileSize: r.candidate.fileSize || 0
  };
}

revertUpgrade(post) {
  if (!post?.upgrade?.applied) return;
  const u = post.upgrade;
  post.fileUrls = { ...post.fileUrls, original: u.originalUrl };
  post.metadata = { ...post.metadata, fileType: u.originalType, dimensions: u.originalDims, fileSize: u.originalSize };
  delete post.upgrade;
}

/** Called from createPostElement, so re-rendered cards keep their badge. */
addUpgradeBadge(postDiv, post) {
  if (post.onlyOnPawchive) {
    const badge = document.createElement('span');
    badge.className = 'post-upgrade-badge status-missing';
    badge.textContent = 'Only on Pawchive';
    badge.title = [post.metadata?.description, 'Not found among the artist\'s e621 posts; downloads from Pawchive.'].filter(Boolean).join('\n');
    postDiv.appendChild(badge);
    return;
  }
  const r = this.upgradeResults?.get(post.id);
  if (!r) return;
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = `post-upgrade-badge status-${r.status}`;
  badge.textContent = STATUS_TEXT[r.status] || `${dims(r.candidate)}`;
  const ratio = ratioOf(r);
  badge.title = [
    `Pawchive: ${dims(r.candidate)}${r.candidate.fileSize ? `, ${bytes(r.candidate.fileSize)}` : ''}`,
    `e621: ${dims(r.original)}${r.original.fileSize ? `, ${bytes(r.original.fileSize)}` : ''}`,
    ratio ? `${ratio.toFixed(1)}× the pixels` : '',
    `Fingerprint difference: ${r.distance} of 64`,
    'Click to compare'
  ].filter(Boolean).join('\n');
  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    this.openReview([post.id]);
  });
  postDiv.appendChild(badge);
}

refreshUpgradeBadges() {
  for (const post of this.currentPosts) {
    const card = this.root?.querySelector?.(`[data-post-id="${CSS.escape(String(post.id))}"]`) || document.querySelector(`[data-post-id="${CSS.escape(String(post.id))}"]`);
    if (!card) continue;
    card.querySelector('.post-upgrade-badge')?.remove();
    this.addUpgradeBadge(card, post);
  }
}

renderUpgradeBar() {
  const bar = this.elements.upgrade_bar;
  if (!bar) return;
  if (!this.upgradeRun || !this.upgradeAvailable()) {
    bar.style.display = 'none';
    return;
  }
  const c = this.upgradeCounts();
  const upgraded = [...this.upgradeResults.values()].filter(r => r.status === 'upgrade');
  const avg = upgraded.length ? upgraded.reduce((s, r) => s + ratioOf(r), 0) / upgraded.length : 0;
  const run = this.upgradeRun;
  const missing = this.missingCount || 0;
  const parts = [
    `${c.upgrade} ${c.upgrade === 1 ? 'upgrade' : 'upgrades'}${avg ? ` (average ${avg.toFixed(1)}× the pixels)` : ''}`,
    `${c.same} same size`,
    c.variant ? `${c.variant} variants` : '',
    `${c.ask} to review`,
    `${missing} only on Pawchive${this.missingHidden ? ` matching "${this.currentTagFilter}" (${this.missingHidden} more without it)` : ''}`
  ].filter(Boolean);
  const session = this.reviewSession || {};
  const reviewed = (session.same || 0) + (session.variant || 0) + (session.different || 0);

  this.elements.upgrade_bar_text.textContent =
    `Pawchive: ${run.creator.name} (${run.creator.service}) - ${parts.join(', ')}. ` +
    `Scanned ${run.scannedPosts} posts, ${run.scannedImages} images` +
    (run.allPostsCompared ? `, compared with all ${run.allPostsCompared}${run.allPostsComplete ? '' : '+'} e621 posts` : ', compared with the loaded posts only') +
    (reviewed ? `. Reviewed this session: ${reviewed}` : '') + '.';
  this.elements.upgrade_bar_text.title = `Pairs at or under ${run.cutoff} of 64 differing bits, with the same shape, are accepted without asking. Your review answers move this.`;
  this.elements.review_upgrades_btn.textContent = c.ask ? `Review (${c.ask})` : 'Review';
  this.elements.review_upgrades_btn.disabled = !c.ask;
  this.elements.select_upgrades_btn.disabled = !c.upgrade;
  if (this.elements.select_missing_btn) {
    this.elements.select_missing_btn.style.display = missing ? '' : 'none';
    this.elements.select_missing_btn.textContent = `Select Pawchive-only (${missing})`;
  }
  bar.style.display = '';
}

selectUpgradedPosts() {
  for (const post of this.currentPosts) {
    if (post.upgrade?.applied && !this.selectedPosts.has(post.id)) {
      this.selectedPosts.add(post.id);
      this.updatePostSelectionUI(post.id);
    }
  }
  this.updateSelectionUI();
}

/* ---------- Modal shell shared by the creator picker and the review ---------- */

upgradeModal() {
  let modal = document.getElementById('upgrade-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'upgrade-modal';
    modal.className = 'image-preview-modal upgrade-modal';
    modal.innerHTML = `
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="upgrade-modal-title"></h3>
          <div class="modal-actions">
            <span class="upgrade-modal-count"></span>
            <button class="btn btn-secondary upgrade-modal-close"><i class="fas fa-times"></i> Close</button>
          </div>
        </div>
        <div class="modal-body upgrade-modal-body"></div>
        <div class="modal-footer upgrade-modal-footer"></div>
      </div>`;
    document.body.appendChild(modal);
  }
  return modal;
}

closeUpgradeModal() {
  const modal = document.getElementById('upgrade-modal');
  if (modal) modal.style.display = 'none';
  if (this.upgradeKeyHandler) {
    document.removeEventListener('keydown', this.upgradeKeyHandler, true);
    this.upgradeKeyHandler = null;
  }
  this.upgradeModalResolve?.(null);
  this.upgradeModalResolve = null;
}

/** Shows the modal; Escape and Close call closeUpgradeModal. `onKey` gets other keys. */
showUpgradeModal({ title, count = '', body, footer = '', onKey = null }) {
  const modal = this.upgradeModal();
  modal.querySelector('.upgrade-modal-title').textContent = title;
  modal.querySelector('.upgrade-modal-count').textContent = count;
  modal.querySelector('.upgrade-modal-body').innerHTML = body;
  modal.querySelector('.upgrade-modal-footer').innerHTML = footer;
  modal.querySelector('.upgrade-modal-footer').style.display = footer ? '' : 'none';
  modal.querySelector('.upgrade-modal-close').onclick = () => this.closeUpgradeModal();
  modal.querySelector('.modal-backdrop').onclick = () => this.closeUpgradeModal();
  if (this.upgradeKeyHandler) document.removeEventListener('keydown', this.upgradeKeyHandler, true);
  // Captured so the tool's own shortcuts don't also fire while this is open.
  this.upgradeKeyHandler = (e) => {
    if (e.target.matches?.('input, textarea, select') && e.key !== 'Escape') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.closeUpgradeModal();
      return;
    }
    if (onKey && onKey(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener('keydown', this.upgradeKeyHandler, true);
  modal.style.display = 'flex';
  return modal;
}

/* ---------- Linking an e621 artist to a Pawchive creator ---------- */

/** Resolves to the chosen creator (also saved), or null. */
chooseCreator(artist) {
  return new Promise((resolve) => {
    const render = async (query) => {
      const modal = this.showUpgradeModal({
        title: `Which Pawchive creator is ${artist}?`,
        body: `
          <div class="upgrade-creator-search">
            <input type="text" class="form-input upgrade-creator-input" value="${esc(query)}" placeholder="Search Pawchive creators">
            <button class="btn btn-secondary upgrade-creator-go">Search</button>
          </div>
          <div class="upgrade-creator-list"><p class="upgrade-muted">Loading creators (the first time takes a few seconds)...</p></div>`,
        footer: '<span class="upgrade-muted">Saved for this artist; change it later from the upgrade bar.</span>'
      });
      this.upgradeModalResolve = resolve;
      const input = modal.querySelector('.upgrade-creator-input');
      const go = () => render(input.value.trim() || artist);
      modal.querySelector('.upgrade-creator-go').onclick = go;
      input.onkeydown = (e) => { if (e.key === 'Enter') go(); };

      const list = modal.querySelector('.upgrade-creator-list');
      const res = await window.electronAPI.pawchive.findCreators(query.replace(/_/g, ' '), 10);
      if (!res?.success) {
        list.innerHTML = `<p class="upgrade-muted">${esc(res?.message || 'Could not load creators')}</p>`;
        return;
      }
      if (!res.creators.length) {
        list.innerHTML = '<p class="upgrade-muted">No creators with that name. Try another spelling.</p>';
        return;
      }
      list.innerHTML = res.creators.map((c, i) => `
        <button class="upgrade-creator" data-index="${i}">
          <span class="upgrade-creator-name">${esc(c.name)}</span>
          <span class="upgrade-muted">${esc(c.service)} · ${c.favorited} favourites</span>
        </button>`).join('');
      list.querySelectorAll('.upgrade-creator').forEach(btn => {
        btn.onclick = async () => {
          const creator = res.creators[Number(btn.dataset.index)];
          const saved = await window.electronAPI.pawchive.setLink(artist, creator);
          this.upgradeModalResolve = null;
          this.closeUpgradeModal();
          resolve(saved?.link || creator);
        };
      });
    };
    render(artist);
  });
}

async changeCreator() {
  if (!this.currentArtist) return;
  const creator = await this.chooseCreator(this.currentArtist);
  if (creator) this.findUpgrades();
}

/* ---------- Reviewing pairs ---------- */

/** Opens the review for the given posts, or for every pair still to review. */
openReview(postIds = null) {
  const queue = (postIds || [...this.upgradeResults.values()].filter(r => r.status === 'ask').map(r => r.postId))
    .filter(id => this.upgradeResults.has(id));
  if (!queue.length) {
    this.showToast('Nothing left to review', 'info');
    return;
  }
  this.reviewQueue = queue;
  this.reviewIndex = 0;
  this.showReviewItem();
}

showReviewItem() {
  const id = this.reviewQueue?.[this.reviewIndex];
  const r = id != null ? this.upgradeResults.get(id) : null;
  if (!r) {
    this.closeUpgradeModal();
    this.renderUpgradeBar();
    const s = this.reviewSession;
    this.showToast(`Review done: ${s.same} same, ${s.variant} variants, ${s.different} different`, 'success');
    return;
  }
  const ratio = ratioOf(r);
  const shape = r.aspectOff == null ? 'unknown' : r.aspectOff <= 0.03 ? 'matches' : `differs by ${Math.round(r.aspectOff * 100)}%`;
  const fmt = (o) => [dims(o), bytes(o.fileSize), String(o.format || '').toUpperCase()].filter(Boolean).join(' · ');

  const modal = this.showUpgradeModal({
    title: 'Is this the same picture?',
    count: `${this.reviewIndex + 1} of ${this.reviewQueue.length}`,
    body: `
      <div class="upgrade-compare">
        <figure>
          <img class="upgrade-img-e621" src="${esc(r.original.preview)}" alt="e621 post ${esc(r.postId)}">
          <figcaption><strong>e621</strong> #${esc(r.postId)}<br>${esc(fmt(r.original))}</figcaption>
        </figure>
        <figure>
          <img class="upgrade-img-pawchive" src="${esc(r.candidate.thumb)}" alt="${esc(r.candidate.name)}">
          <figcaption><strong>Pawchive</strong> ${esc(r.candidate.postTitle || r.candidate.name)}<br>${esc(fmt(r.candidate))}</figcaption>
        </figure>
      </div>`,
    footer: `
      <div class="post-metadata">
        <span class="meta-item">Fingerprint difference: <span>${r.distance} of 64</span></span>
        <span class="meta-item">Shape: <span>${esc(shape)}</span></span>
        <span class="meta-item">Pixels: <span>${ratio ? `${ratio.toFixed(1)}×` : 'unknown'}</span></span>
        ${r.answer ? `<span class="meta-item">Your answer: <span>${esc(r.answer)}</span></span>` : ''}
      </div>
      <div class="upgrade-answers">
        <button class="btn btn-primary" data-answer="same" title="Same picture (1)">1 Same</button>
        <button class="btn btn-secondary" data-answer="variant" title="Same picture, edited: text, colours, crop (2)">2 Variant</button>
        <button class="btn btn-secondary" data-answer="different" title="Not the same picture (3)">3 Different</button>
        <button class="btn btn-secondary" data-answer="skip" title="Decide later (S)">Skip</button>
        <button class="btn btn-secondary" data-answer="open" title="Open the Pawchive post (O)"><i class="fas fa-external-link-alt"></i></button>
      </div>`,
    onKey: (e) => {
      const map = { 1: 'same', 2: 'variant', 3: 'different', s: 'skip', S: 'skip', ArrowRight: 'skip', o: 'open', O: 'open' };
      const answer = map[e.key];
      if (!answer) return false;
      this.answerReview(answer);
      return true;
    }
  });
  modal.querySelectorAll('[data-answer]').forEach(btn => { btn.onclick = () => this.answerReview(btn.dataset.answer); });

  // The thumbnail shows at once; the full file replaces it once loaded, so
  // detail can be compared too.
  const full = new Image();
  full.onload = () => {
    const img = modal.querySelector('.upgrade-img-pawchive');
    if (img && this.reviewQueue?.[this.reviewIndex] === id) img.src = full.src;
  };
  full.src = r.candidate.url;
  const e621Full = this.currentPosts.find(p => p.id === r.postId)?.upgrade?.originalUrl
    || this.currentPosts.find(p => p.id === r.postId)?.fileUrls?.original;
  if (e621Full) {
    const big = new Image();
    big.onload = () => {
      const img = modal.querySelector('.upgrade-img-e621');
      if (img && this.reviewQueue?.[this.reviewIndex] === id) img.src = big.src;
    };
    big.src = e621Full;
  }
}

async answerReview(answer) {
  const id = this.reviewQueue?.[this.reviewIndex];
  const r = this.upgradeResults.get(id);
  if (!r) return;
  if (answer === 'open') {
    window.electronAPI.utils?.openExternal?.(r.candidate.postUrl) ?? window.open(r.candidate.postUrl, '_blank');
    return;
  }
  if (answer !== 'skip') {
    const res = await window.electronAPI.pawchive.recordDecision(r.postId, r.candidate.hash, answer, r.distance);
    if (!res?.success) {
      this.showToast(res?.message || 'Could not save the answer', 'error');
      return;
    }
    if (this.upgradeRun && res.cutoff != null) this.upgradeRun.cutoff = res.cutoff;
    this.reviewSession[answer] = (this.reviewSession[answer] || 0) + 1;
    const post = this.currentPosts.find(p => p.id === r.postId);
    r.answer = answer;
    if (answer === 'different') {
      this.upgradeResults.delete(r.postId);
      this.revertUpgrade(post);
    } else if (answer === 'variant') {
      r.status = 'variant';
      this.revertUpgrade(post);
    } else {
      r.status = ratioOf(r) >= BIGGER ? 'upgrade' : 'same';
      if (post && r.status === 'upgrade') this.applyUpgrade(post, r);
      else this.revertUpgrade(post);
    }
    this.refreshUpgradeBadges();
    this.renderUpgradeBar();
  }
  this.reviewIndex++;
  this.showReviewItem();
}
}
