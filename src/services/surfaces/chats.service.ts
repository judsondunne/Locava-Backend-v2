import { dedupeInFlight } from "../../cache/in-flight-dedupe.js";
import { withConcurrencyLimit } from "../../lib/concurrency-limit.js";
import { withMutationLock } from "../../lib/mutation-lock.js";
import type { ChatsRepository } from "../../repositories/surfaces/chats.repository.js";

export class ChatsService {
  constructor(private readonly repository: ChatsRepository) {}

  async loadInboxPage(input: { viewerId: string; cursor: string | null; limit: number }) {
    const cursorPart = input.cursor ?? "start";
    return dedupeInFlight(`chats:inbox:${input.viewerId}:${cursorPart}:${input.limit}`, () =>
      withConcurrencyLimit("chats-inbox-repo", 10, async () => {
        // Repository already batch-hydrates participant and sender profiles; avoid a second
        // per-user entity-cache round trip that duplicated work and inflated cold latency.
        return this.repository.listInbox(input);
      })
    );
  }

  async markConversationRead(input: { viewerId: string; conversationId: string }) {
    return dedupeInFlight(`chats:mark-read:${input.viewerId}:${input.conversationId}`, () =>
      withConcurrencyLimit("chats-mark-read", 8, () =>
        withMutationLock(`chats-mark-read:${input.viewerId}:${input.conversationId}`, () => this.repository.markRead(input))
      )
    );
  }

  async markConversationUnread(input: { viewerId: string; conversationId: string }) {
    return dedupeInFlight(`chats:mark-unread:${input.viewerId}:${input.conversationId}`, () =>
      withConcurrencyLimit("chats-mark-unread", 8, () =>
        withMutationLock(`chats-mark-unread:${input.viewerId}:${input.conversationId}`, () => this.repository.markUnread(input))
      )
    );
  }

  async loadThreadPage(input: { viewerId: string; conversationId: string; cursor: string | null; limit: number }) {
    const cursorPart = input.cursor ?? "start";
    return dedupeInFlight(`chats:thread:${input.viewerId}:${input.conversationId}:${cursorPart}:${input.limit}`, () =>
      withConcurrencyLimit("chats-thread-repo", 8, async () => {
        const page = await this.repository.listThreadMessages(input);
        const items = page.items.map((item) => ({
          ...item,
          ownedByViewer: item.senderId === input.viewerId,
          seenByViewer: item.seenBy.includes(input.viewerId)
        }));
        return { ...page, items };
      })
    );
  }

  async sendMessage(input: {
    viewerId: string;
    conversationId: string;
    messageType: "text" | "photo" | "gif" | "post";
    text: string | null;
    photoUrl: string | null;
    gifUrl: string | null;
    gif: null | {
      provider: "giphy";
      gifId: string;
      title?: string;
      previewUrl: string;
      fixedHeightUrl?: string;
      mp4Url?: string;
      width?: number;
      height?: number;
      originalUrl?: string;
    };
    postId: string | null;
    replyingToMessageId: string | null;
    clientMessageId: string | null;
  }) {
    const replayKey = input.clientMessageId ?? "none";
    return dedupeInFlight(`chats:send-text:${input.viewerId}:${input.conversationId}:${replayKey}`, () =>
      withConcurrencyLimit("chats-send-text", 6, () =>
        withMutationLock(`chats-send-text:${input.viewerId}:${input.conversationId}`, () =>
          this.repository.sendMessage(input)
        )
      )
    );
  }

  async updateGroupMetadata(input: {
    viewerId: string;
    conversationId: string;
    groupName?: string;
    displayPhotoURL?: string | null;
  }) {
    return withMutationLock(`chats-update-group:${input.viewerId}:${input.conversationId}`, () =>
      this.repository.updateGroupMetadata(input)
    );
  }

  async createOrGetDirectConversation(input: { viewerId: string; otherUserId: string }) {
    return withMutationLock(`chats-create-direct:${input.viewerId}:${input.otherUserId}`, () =>
      this.repository.createOrGetDirectConversation(input)
    );
  }

  async createGroupConversation(input: {
    viewerId: string;
    participantIds: string[];
    groupName: string;
    displayPhotoUrl?: string | null;
  }) {
    return withMutationLock(`chats-create-group:${input.viewerId}:${input.groupName}`, () =>
      this.repository.createGroupConversation(input)
    );
  }

  async deleteConversation(input: { viewerId: string; conversationId: string }) {
    return withMutationLock(`chats-delete:${input.viewerId}:${input.conversationId}`, () =>
      this.repository.deleteConversation(input)
    );
  }

  async deleteMessage(input: { viewerId: string; conversationId: string; messageId: string }) {
    return withMutationLock(`chats-delete-message:${input.viewerId}:${input.conversationId}:${input.messageId}`, () =>
      this.repository.deleteMessage(input)
    );
  }

  async setMessageReaction(input: { viewerId: string; conversationId: string; messageId: string; emoji: string }) {
    return withMutationLock(`chats-reaction:${input.viewerId}:${input.conversationId}:${input.messageId}`, () =>
      this.repository.setMessageReaction(input)
    );
  }
}
