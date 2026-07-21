'use client'

import AufaQueueView from './AufaQueueView'

// Helpdesk — single shared view for everyone (2026-07-21, Rian: "tampilannya
// sama semua di semua orang"). Used to split owner (full shadow view) vs
// Aufa (role='qa', decision queue only), plus an owner-only "preview as
// Aufa" toggle — all superseded now that the queue itself is open to the
// whole team for transparency. See AufaQueueView.tsx for the actual view;
// PASS stays gated to owner/role='qa' there, Poll Now stays owner-only.
export default function HelpdeskPanel() {
  return <AufaQueueView />
}
