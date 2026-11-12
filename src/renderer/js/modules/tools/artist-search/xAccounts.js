// Finding an e621 artist's X account and searching it. The accounts come from
// the links on the artist's e621 page; the one picked is saved for that
// artist, so searching their e621 name on X later goes to the same account.
// Uses the upgrade modal (upgrades.js). Mixed into ArtistSearchTool.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanHandle = (s) => String(s || '').trim().replace(/^.*(?:x|twitter)\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '').replace(/[^A-Za-z0-9_]/g, '');

export default class ArtistSearchXAccounts {
/** From an e621/e926 artist search: pick their X account, then search it. */
async findOnX() {
  const artist = this.currentArtist || this.elements.artist_input?.value?.trim();
  if (!artist) {
    this.showToast('Search an artist on e621 first', 'warning');
    return;
  }
  const handle = await this.chooseXAccount(artist);
  if (handle) this.searchOnX(handle);
}

chooseXAccount(artist) {
  return new Promise((resolve) => {
    const modal = this.showUpgradeModal({
      title: `${artist} on X`,
      body: `
        <div class="upgrade-creator-list"><p class="upgrade-muted">Reading ${esc(artist)}'s links on e621...</p></div>
        <div class="upgrade-creator-search x-account-other">
          <input type="text" class="form-input x-account-input" placeholder="Another account: @handle or x.com link">
          <button class="btn btn-secondary x-account-go">Use</button>
        </div>`,
      footer: '<span class="upgrade-muted">Saved for this artist, so searching their name on X goes to this account.</span>'
    });
    this.upgradeModalResolve = resolve;

    const pick = async (handle) => {
      const clean = cleanHandle(handle);
      if (!clean) return;
      await window.electronAPI.x.setLink(artist, clean);
      this.upgradeModalResolve = null;
      this.closeUpgradeModal();
      resolve(clean);
    };
    const input = modal.querySelector('.x-account-input');
    modal.querySelector('.x-account-go').onclick = () => pick(input.value);
    input.onkeydown = (e) => { if (e.key === 'Enter') pick(input.value); };

    const list = modal.querySelector('.upgrade-creator-list');
    window.electronAPI.x.findAccounts(artist).then((res) => {
      const rows = [];
      if (res?.saved) rows.push({ handle: res.saved, note: 'saved' });
      for (const f of res?.found || []) {
        if (rows.some(r => r.handle.toLowerCase() === f.handle.toLowerCase())) continue;
        rows.push({ handle: f.handle, note: f.active ? 'linked on e621' : 'linked on e621, marked inactive' });
      }
      if (!rows.length) {
        list.innerHTML = `<p class="upgrade-muted">${esc(res?.success === false ? res.message : `${artist}'s e621 page links no X account.`)} Type it below.</p>`;
        input.focus();
        return;
      }
      list.innerHTML = rows.map((r, i) => `
        <button class="upgrade-creator" data-index="${i}">
          <span class="upgrade-creator-name">@${esc(r.handle)}</span>
          <span class="upgrade-muted">${esc(r.note)}</span>
        </button>`).join('');
      list.querySelectorAll('.upgrade-creator').forEach(btn => {
        btn.onclick = () => pick(rows[Number(btn.dataset.index)].handle);
      });
    });
  });
}

/* ---------- Live indexing ---------- */

/** Follows the X job a search started: appends posts as they come, shows progress. */
watchXIndex(result) {
  this.xIndexKey = result.key;
  if (!this.offXProgress) {
    this.offXProgress = window.electronAPI.x.onIndexProgress((p) => this.onXProgress(p));
  }
  const p = result.progress || {};
  if (result.indexing) {
    this.xProcess?.finish({ message: 'Replaced', warning: true });
    this.xProcess = this.app?.startProcess?.({ toolId: this.id, label: `Indexing X: @${p.handle || this.currentArtist}`, total: p.total || 0 }) || null;
  }
  this.renderXIndex(p);
}

onXProgress(p) {
  if (!p || p.key !== this.xIndexKey) return;
  if (p.posts?.length) {
    const posts = this.prepareResults(p.posts);
    if (!this.currentPosts.length) {
      this.currentPosts = posts;
      this.displayPosts(posts, false);
    } else {
      this.currentPosts.push(...posts);
      this.appendNewPosts(posts);
    }
    this.checkDownloadStatus?.(posts);
    this.updatePostCounts();
    this.totalPostCount = Math.max(this.totalPostCount || 0, p.total || 0);
  }
  this.renderXIndex(p);
  if (p.finished) {
    const failed = p.error && !p.found;
    this.xProcess?.finish({ message: p.error ? 'Limited by X' : p.stopped ? `Stopped at ${p.found} posts` : `${p.found} posts`, failed, warning: !!(p.error || p.stopped) && !failed });
    this.xProcess = null;
    if (!this.currentPosts.length) this.showNoPosts();
    if (p.error) this.showToast(p.error, 'warning');
  }
}

renderXIndex(p) {
  const bar = this.elements.x_index_bar;
  if (!bar) return;
  bar.style.display = '';
  const n = (v) => Number(v || 0).toLocaleString();
  const handle = `@${p.handle || this.currentArtist}`;
  const fresh = p.cached ? p.found - p.cached : 0;
  let text;
  if (!p.finished) {
    text = p.cached
      ? `Checking ${handle} for new posts: ${n(fresh)} new, ${n(p.found)} saved in all`
      : `Indexing ${handle}: ${n(p.found)} posts with images or video, from ${n(p.tweets)} tweets`;
  } else if (p.error) {
    text = `${handle}: ${n(p.found)} posts. ${p.error}`;
  } else if (p.stopped) {
    text = `Stopped at ${n(p.found)} posts from ${n(p.tweets)} tweets. Searching ${handle} again continues from here.`;
  } else {
    text = `${handle}: ${n(p.found)} posts from ${n(p.tweets)} tweets${fresh > 0 ? `, ${n(fresh)} new` : ''}. Saved, so the next search only checks for new posts.`;
  }
  if (this.elements.x_index_text) this.elements.x_index_text.textContent = text;
  if (this.elements.x_index_stop_btn) this.elements.x_index_stop_btn.style.display = p.finished ? 'none' : '';

  // Determinate once X has said how many media tweets the account has.
  const track = this.elements.x_index_track;
  const fill = this.elements.x_index_fill;
  if (track && fill) {
    track.style.display = p.finished ? 'none' : '';
    const ratio = p.total ? Math.min(1, (p.mediaTweets || 0) / p.total) : 0;
    track.classList.toggle('is-determinate', !!p.total);
    fill.style.width = p.total ? `${Math.round(ratio * 100)}%` : '';
  }
  this.xProcess?.update({ done: Math.min(p.mediaTweets || 0, p.total || 0), detail: `${n(p.found)} posts` });
}

/** Hides the bar and lets go of the job (its events are ignored from now on). */
resetXIndex() {
  this.xIndexKey = null;
  if (this.elements.x_index_bar) this.elements.x_index_bar.style.display = 'none';
  this.xProcess?.finish({ message: 'Replaced', warning: true });
  this.xProcess = null;
}

/** An X search with nothing found yet: the empty grid, not "No posts found". */
showXWaiting() {
  this.showResults();
  if (this.elements.posts_grid) this.elements.posts_grid.style.display = 'flex';
  if (this.elements.posts_grid_content) this.elements.posts_grid_content.innerHTML = '';
  if (this.elements.artist_name_display) this.elements.artist_name_display.textContent = this.currentArtist;
  this.updatePostCounts();
}

/** Switches the source to X and searches the account. */
searchOnX(handle) {
  if (this.elements.source_select) this.elements.source_select.value = 'x';
  this.setSource('x');
  if (this.elements.artist_input) this.elements.artist_input.value = `@${handle}`;
  this.searchArtist();
}
}
