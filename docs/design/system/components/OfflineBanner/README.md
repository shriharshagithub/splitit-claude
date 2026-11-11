A banner under the header that shows connection and sync state. It is calm by design: offline is normal.

- States: offline with a pending count, syncing, and a conflict notice after sync.
- Provide: the state and the number of queued changes.
- Never use `danger` here. The conflict notice is dismissible and names the expense that was overwritten.
