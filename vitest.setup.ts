/**
 * The core talks to IndexedDB and WebCrypto. Node 20+ provides WebCrypto on
 * `globalThis.crypto`; IndexedDB, it does not. `fake-indexeddb/auto` installs
 * a spec-compliant implementation, which lets us test the real storage rather
 * than a test double that would lie about its behaviour.
 */
import 'fake-indexeddb/auto'
