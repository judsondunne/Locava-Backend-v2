# Branch Invite + Group Parity Checklist

Use this checklist against the current `Locava-Native` app pointed at `Locava Backendv2`.

## User Invite

- [ ] Fresh install, logged out, open a legacy Branch user invite link.
- [ ] Sign up with email.
- [ ] Confirm signup completes successfully.
- [ ] Confirm the invited-by modal appears exactly once after auth/onboarding.
- [ ] Confirm dismissing the modal does not block normal app startup.
- [ ] Confirm following the inviter from the modal succeeds.

## Group Invite

- [ ] Fresh install, logged out, open a legacy Branch group invite link.
- [ ] Sign up with email or OAuth.
- [ ] Confirm the group invite modal appears exactly once after auth/onboarding.
- [ ] If the group requires college verification, confirm the verification UI appears and accepts a matching school email.
- [ ] Confirm Join succeeds.
- [ ] Confirm the joined group opens after success.
- [ ] Confirm the joined group appears on the profile/account surface where groups previously appeared.
- [ ] Confirm the joined group chat/thread appears where expected.

## Existing Users

- [ ] Existing logged-in user opens a legacy Branch user invite link while the app is foregrounded.
- [ ] Confirm attribution is merged without logging out and the invited-by modal appears once when appropriate.
- [ ] Existing logged-in user opens a legacy Branch group invite link while the app is foregrounded.
- [ ] Confirm the group invite modal appears once and Join succeeds immediately.

## Edge Cases

- [ ] Invalid user invite link fails cleanly and app startup continues normally.
- [ ] Invalid or expired group invite link fails cleanly and the user is not stuck.
- [ ] Already joined group invite is safe and idempotent.
- [ ] App killed -> open user invite link -> auth flow completes with attribution preserved.
- [ ] App killed -> open group invite link -> auth flow completes with join preserved.
- [ ] App backgrounded -> open user invite link -> intent resolves correctly.
- [ ] App backgrounded -> open group invite link -> intent resolves correctly.
- [ ] Non-group invite links are never treated as group invites.
- [ ] Group invite links are never treated as regular user invites.
- [ ] Branch SDK returns no params -> app startup/navigation stays healthy.

## Truth Checks

- [ ] Confirm the user document stores Branch attribution in legacy-compatible `branchData.links[]`.
- [ ] Confirm referral fields (`referredByUserId`, `referredByHandle`, `referredByName`, `referredByProfilePic`, `referralInviteType`, `referralInviteToken`) are present for user invites when appropriate.
- [ ] Confirm `cohortKeys` is populated when campaign/campus data exists.
- [ ] Confirm suggested-user results include invite-derived candidates when applicable.
- [ ] Confirm group membership is written to `groups/{groupId}/members/{userId}`.
- [ ] Confirm the viewer/user document reflects the joined `primaryGroup` when expected.

## Production Validation

- [ ] Repeat the user invite flow with a production/TestFlight Branch link.
- [ ] Repeat the group invite flow with a production/TestFlight Branch link.
- [ ] Confirm cold start, warm start, and already-authenticated flows all match production expectations.
