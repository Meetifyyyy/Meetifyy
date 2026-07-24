import { idb } from './idb'; // A simple idb wrapper we'll create

export class IndexedDBSignalStore {
  constructor(storeName = 'signal_store') {
    this.storeName = storeName;
  }

  async getIdentityKeyPair() {
    return idb.get(this.storeName, 'identityKey');
  }

  async getLocalRegistrationId() {
    return idb.get(this.storeName, 'registrationId');
  }

  async isTrustedIdentity(identifier, identityKey, direction) {
    if (identifier === null) return Promise.resolve(true);
    const trusted = await idb.get(this.storeName, `identityKey${identifier}`);
    if (trusted === undefined) {
      return Promise.resolve(true);
    }
    return Promise.resolve(
      Buffer.from(trusted).toString('base64') === Buffer.from(identityKey).toString('base64')
    );
  }

  async loadPreKey(keyId) {
    let res = await idb.get(this.storeName, `25519KeypreKey${keyId}`);
    return res?.keyPair || res;
  }

  async loadSession(identifier) {
    return idb.get(this.storeName, `session${identifier}`);
  }

  async loadSignedPreKey(keyId) {
    let res = await idb.get(this.storeName, `25519KeysignedKey${keyId}`);
    return res?.keyPair || res;
  }

  async removePreKey(keyId) {
    return idb.remove(this.storeName, `25519KeypreKey${keyId}`);
  }

  async saveIdentity(identifier, identityKey) {
    if (identifier === null || identifier === undefined) {
      throw new Error("Tried to put identity key for undefined/null key");
    }
    return idb.put(this.storeName, `identityKey${identifier}`, identityKey);
  }

  async getIdentity(identifier) {
    return idb.get(this.storeName, `identityKey${identifier}`);
  }

  async storeSession(identifier, record) {
    return idb.put(this.storeName, `session${identifier}`, record);
  }

  async storePreKey(keyId, keyPair) {
    return idb.put(this.storeName, `25519KeypreKey${keyId}`, keyPair);
  }

  async storeSignedPreKey(keyId, keyPair) {
    return idb.put(this.storeName, `25519KeysignedKey${keyId}`, keyPair);
  }

  async removeSignedPreKey(keyId) {
    return idb.remove(this.storeName, `25519KeysignedKey${keyId}`);
  }

  async getSession(identifier) {
    return idb.get(this.storeName, `session${identifier}`);
  }

  async removeSession(identifier) {
    return idb.remove(this.storeName, `session${identifier}`);
  }
  
  async removeAllSessions(identifier) {
    // Basic implementation
    return idb.remove(this.storeName, `session${identifier}`);
  }

  // Basic utility to store our own key pair
  async putIdentityKeyPair(keyPair) {
    return idb.put(this.storeName, 'identityKey', keyPair);
  }

  async putLocalRegistrationId(id) {
    return idb.put(this.storeName, 'registrationId', id);
  }

  // ---- SPK Rotation Tracking ----
  async getLastSpkRotation() {
    return idb.get(this.storeName, 'lastSpkRotation');
  }

  async putLastSpkRotation(timestamp) {
    return idb.put(this.storeName, 'lastSpkRotation', timestamp);
  }

  // ---- Verified Identity Keys ----
  async getVerifiedKey(userId) {
    return idb.get(this.storeName, `verified_${userId}`);
  }

  async putVerifiedKey(userId, keyBase64) {
    return idb.put(this.storeName, `verified_${userId}`, keyBase64);
  }

  async deleteVerifiedKey(userId) {
    return idb.delete(this.storeName, `verified_${userId}`);
  }

  // ---- Sent Messages Handling ----
  async saveSentMessage(conversationId, messageObj) {
    let existing = await idb.get('sent_messages', conversationId) || [];
    existing.push(messageObj);
    return idb.put('sent_messages', conversationId, existing);
  }

  async getSentMessages(conversationId) {
    return (await idb.get('sent_messages', conversationId)) || [];
  }
}
