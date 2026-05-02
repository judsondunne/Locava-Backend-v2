import { incrementDbOps } from "../../observability/request-context.js";
import { recordFallback, recordTimeout } from "../../observability/request-context.js";
import { AuthBootstrapFirestoreAdapter } from "../source-of-truth/auth-bootstrap-firestore.adapter.js";
import { enforceSourceOfTruthStrictness } from "../source-of-truth/strict-mode.js";

export type SessionRecord = {
  viewerId: string;
  role: string;
  authenticated: boolean;
  issuedAt: string;
  expiresAt: string;
};

export type ViewerSummary = {
  uid: string;
  canonicalUserId: string;
  viewerReady: boolean;
  profileHydrationStatus: "ready" | "minimal_fallback";
  email: string | null;
  handle: string;
  name: string | null;
  profilePic: string | null;
  profilePicSmallPath: string | null;
  profilePicMediumPath: string | null;
  profilePicLargePath: string | null;
  badge: string;
  onboardingComplete: boolean | null;
};

export type BootstrapSeed = {
  shellVersion: string;
  unreadCount: number;
  experiments: string[];
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AuthBootstrapRepository {
  constructor(private readonly firestoreAdapter: AuthBootstrapFirestoreAdapter = new AuthBootstrapFirestoreAdapter()) {}

  async getSessionRecord(viewerId: string): Promise<SessionRecord> {
    const now = new Date();
    const expires = new Date(now.getTime() + 60 * 60 * 1000);

    return {
      viewerId,
      role: viewerId === "anonymous" ? "guest" : "member",
      authenticated: viewerId !== "anonymous",
      issuedAt: now.toISOString(),
      expiresAt: expires.toISOString()
    };
  }

  async getViewerSummary(viewerId: string, slowMs = 0): Promise<ViewerSummary> {
    if (this.firestoreAdapter.isEnabled()) {
      try {
        const firestore = await this.firestoreAdapter.getViewerBootstrapFields(viewerId);
        incrementDbOps("queries", firestore.queryCount);
        incrementDbOps("reads", firestore.readCount);
        if (slowMs > 0) {
          await delay(slowMs);
        }
        return {
          uid: firestore.data.uid,
          canonicalUserId: firestore.data.uid,
          viewerReady: true,
          profileHydrationStatus: "ready",
          email: firestore.data.email,
          handle: firestore.data.handle,
          name: firestore.data.name,
          profilePic: firestore.data.profilePic,
          profilePicSmallPath: firestore.data.profilePicSmallPath,
          profilePicMediumPath: firestore.data.profilePicMediumPath,
          profilePicLargePath: firestore.data.profilePicLargePath,
          badge: firestore.data.badge,
          onboardingComplete: firestore.data.onboardingComplete
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("_timeout")) {
          recordTimeout("auth_bootstrap_viewer_firestore");
          this.firestoreAdapter.markUnavailableBriefly();
        }
        if (error instanceof Error && error.message === "auth_bootstrap_user_not_found") {
          recordFallback("auth_bootstrap_user_doc_missing");
          return {
            uid: viewerId,
            canonicalUserId: viewerId,
            viewerReady: false,
            profileHydrationStatus: "minimal_fallback",
            email: null,
            handle: "",
            name: null,
            profilePic: null,
            profilePicSmallPath: null,
            profilePicMediumPath: null,
            profilePicLargePath: null,
            badge: "standard",
            onboardingComplete: null
          };
        } else {
          recordFallback("auth_bootstrap_viewer_firestore_fallback");
          enforceSourceOfTruthStrictness("auth_bootstrap_viewer_firestore");
        }
      }
    }

    incrementDbOps("queries", 1);
    incrementDbOps("reads", 1);

    if (slowMs > 0) {
      await delay(slowMs);
    }

    return {
      uid: viewerId,
      canonicalUserId: viewerId,
      viewerReady: viewerId === "anonymous",
      profileHydrationStatus: viewerId === "anonymous" ? "ready" : "minimal_fallback",
      email: null,
      handle: viewerId === "anonymous" ? "guest" : "",
      name: viewerId === "anonymous" ? "Guest" : null,
      profilePic: null,
      profilePicSmallPath: null,
      profilePicMediumPath: null,
      profilePicLargePath: null,
      badge: viewerId === "anonymous" ? "none" : "standard",
      onboardingComplete: viewerId === "anonymous" ? true : null
    };
  }

  async getBootstrapSeed(viewerId: string, slowMs = 0): Promise<BootstrapSeed> {
    if (this.firestoreAdapter.isEnabled()) {
      try {
        const firestore = await this.firestoreAdapter.getViewerBootstrapFields(viewerId);
        incrementDbOps("queries", firestore.queryCount);
        incrementDbOps("reads", firestore.readCount);
        if (slowMs > 0) {
          await delay(slowMs);
        }
        return {
          shellVersion: "2026.04.v2-alpha",
          unreadCount: firestore.data.unreadCount,
          experiments: viewerId === "anonymous" ? [] : ["bootstrap-lite", "observer-v2"]
        };
      } catch (error) {
        if (error instanceof Error && error.message.includes("_timeout")) {
          recordTimeout("auth_bootstrap_seed_firestore");
          this.firestoreAdapter.markUnavailableBriefly();
        }
        if (error instanceof Error && error.message === "auth_bootstrap_user_not_found") {
          recordFallback("auth_bootstrap_user_doc_missing");
        } else {
          recordFallback("auth_bootstrap_seed_firestore_fallback");
          enforceSourceOfTruthStrictness("auth_bootstrap_seed_firestore");
        }
      }
    }

    incrementDbOps("queries", 1);
    incrementDbOps("reads", 2);

    if (slowMs > 0) {
      await delay(slowMs);
    }

    return {
      shellVersion: "2026.04.v2-alpha",
      unreadCount: viewerId === "anonymous" ? 0 : 3,
      experiments: viewerId === "anonymous" ? [] : ["bootstrap-lite", "observer-v2"]
    };
  }
}
