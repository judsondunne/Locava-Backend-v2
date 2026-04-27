type PostSocialMutationState = {
  likesDelta: number;
  likedViewers: Set<string>;
};

type ViewerSavedState = {
  saved: boolean;
  savedAtMs: number;
};

class MutationStateRepository {
  private readonly postSocialState = new Map<string, PostSocialMutationState>();
  private readonly followState = new Map<string, Set<string>>();
  private readonly viewerSavedState = new Map<string, Map<string, ViewerSavedState>>();

  likePost(viewerId: string, postId: string): { liked: boolean; changed: boolean } {
    const state = this.postSocialState.get(postId) ?? { likesDelta: 0, likedViewers: new Set<string>() };
    if (state.likedViewers.has(viewerId)) {
      return { liked: true, changed: false };
    }
    state.likedViewers.add(viewerId);
    state.likesDelta += 1;
    this.postSocialState.set(postId, state);
    return { liked: true, changed: true };
  }

  unlikePost(viewerId: string, postId: string): { liked: boolean; changed: boolean } {
    const state = this.postSocialState.get(postId) ?? { likesDelta: 0, likedViewers: new Set<string>() };
    if (!state.likedViewers.has(viewerId)) {
      return { liked: false, changed: false };
    }
    state.likedViewers.delete(viewerId);
    state.likesDelta -= 1;
    this.postSocialState.set(postId, state);
    return { liked: false, changed: true };
  }

  getPostLikeDelta(postId: string): number {
    return this.postSocialState.get(postId)?.likesDelta ?? 0;
  }

  hasViewerLikedPost(viewerId: string, postId: string): boolean {
    return this.postSocialState.get(postId)?.likedViewers.has(viewerId) ?? false;
  }

  /** All post ids this viewer has liked in the current process (mirrors v2 like mutation state). */
  listViewerLikedPostIds(viewerId: string): string[] {
    const out: string[] = [];
    for (const [postId, state] of this.postSocialState.entries()) {
      if (state.likedViewers.has(viewerId)) out.push(postId);
    }
    return out;
  }

  followUser(viewerId: string, targetUserId: string): { following: boolean; changed: boolean } {
    const set = this.followState.get(viewerId) ?? new Set<string>();
    if (set.has(targetUserId)) {
      return { following: true, changed: false };
    }
    set.add(targetUserId);
    this.followState.set(viewerId, set);
    return { following: true, changed: true };
  }

  unfollowUser(viewerId: string, targetUserId: string): { following: boolean; changed: boolean } {
    const set = this.followState.get(viewerId) ?? new Set<string>();
    if (!set.has(targetUserId)) {
      return { following: false, changed: false };
    }
    set.delete(targetUserId);
    this.followState.set(viewerId, set);
    return { following: false, changed: true };
  }

  isFollowing(viewerId: string, targetUserId: string): boolean {
    return this.followState.get(viewerId)?.has(targetUserId) ?? false;
  }

  savePost(viewerId: string, postId: string): { saved: boolean; changed: boolean; savedAtMs: number } {
    const byPost = this.viewerSavedState.get(viewerId) ?? new Map<string, ViewerSavedState>();
    const existing = byPost.get(postId);
    if (existing?.saved) {
      return { saved: true, changed: false, savedAtMs: existing.savedAtMs };
    }
    const next = { saved: true, savedAtMs: Date.now() };
    byPost.set(postId, next);
    this.viewerSavedState.set(viewerId, byPost);
    return { saved: true, changed: true, savedAtMs: next.savedAtMs };
  }

  unsavePost(viewerId: string, postId: string): { saved: boolean; changed: boolean } {
    const byPost = this.viewerSavedState.get(viewerId) ?? new Map<string, ViewerSavedState>();
    const existing = byPost.get(postId);
    if (existing && !existing.saved) {
      return { saved: false, changed: false };
    }
    const next = { saved: false, savedAtMs: existing?.savedAtMs ?? 0 };
    byPost.set(postId, next);
    this.viewerSavedState.set(viewerId, byPost);
    return { saved: false, changed: existing?.saved !== false };
  }

  resolveViewerSavedPost(viewerId: string, postId: string, fallback: boolean): boolean {
    const state = this.viewerSavedState.get(viewerId)?.get(postId);
    if (!state) return fallback;
    return state.saved;
  }

  listViewerSavedState(viewerId: string): Array<{ postId: string; saved: boolean; savedAtMs: number }> {
    const byPost = this.viewerSavedState.get(viewerId);
    if (!byPost) return [];
    return Array.from(byPost.entries()).map(([postId, state]) => ({
      postId,
      saved: state.saved,
      savedAtMs: state.savedAtMs
    }));
  }

  resetForTests(): void {
    this.postSocialState.clear();
    this.followState.clear();
    this.viewerSavedState.clear();
  }
}

export const mutationStateRepository = new MutationStateRepository();
