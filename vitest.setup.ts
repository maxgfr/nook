/**
 * Le core parle à IndexedDB et à WebCrypto. Node 20+ fournit WebCrypto sur
 * `globalThis.crypto` ; IndexedDB, non. `fake-indexeddb/auto` installe une
 * implémentation conforme à la spec, ce qui permet de tester le stockage
 * réel plutôt qu'un double de test qui mentirait sur son comportement.
 */
import 'fake-indexeddb/auto'
