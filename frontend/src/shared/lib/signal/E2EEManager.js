import { 
  KeyHelper, 
  SessionBuilder, 
  SessionCipher, 
  SignalProtocolAddress 
} from '@privacyresearch/libsignal-protocol-typescript';
import { IndexedDBSignalStore } from './SignalStore';
import { keysApi } from '../../api/apiClient';
import { Buffer } from 'buffer';

// Ensure buffer is globally available for libsignal
if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
}

export class E2EEManager {
  static instance = null;

  constructor() {
    this.store = new IndexedDBSignalStore();
  }

  static getInstance() {
    if (!E2EEManager.instance) {
      E2EEManager.instance = new E2EEManager();
    }
    return E2EEManager.instance;
  }

  /**
   * Check if we have registered on this device.
   * If not, generate keys, store locally, and upload public parts to backend.
   */
  async initialize() {
    let registrationId = await this.store.getLocalRegistrationId();
    if (!registrationId) {
      registrationId = KeyHelper.generateRegistrationId();

      const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
      const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);

      // Generate pool of one-time prekeys
      const oneTimePreKeys = [];
      const preKeysPairs = [];
      for (let i = 1; i <= 50; i++) {
        const preKey = await KeyHelper.generatePreKey(i);
        preKeysPairs.push(preKey);
        oneTimePreKeys.push({
          keyId: preKey.keyId,
          key: Buffer.from(preKey.keyPair.pubKey).toString('base64')
        });
      }

      const payload = {
        registrationId,
        identityKey: Buffer.from(identityKeyPair.pubKey).toString('base64'),
        signedPreKeyId: signedPreKey.keyId,
        signedPreKey: Buffer.from(signedPreKey.keyPair.pubKey).toString('base64'),
        signedPreKeySig: Buffer.from(signedPreKey.signature).toString('base64'),
        oneTimePreKeys
      };

      // Call backend to register device FIRST
      const res = await keysApi.register(payload);
      
      // If success, commit all keys to local IndexedDB
      await this.store.putLocalRegistrationId(registrationId);
      await this.store.putIdentityKeyPair(identityKeyPair);
      await this.store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);
      for (const preKey of preKeysPairs) {
        await this.store.storePreKey(preKey.keyId, preKey.keyPair);
      }
      await this.store.putLastSpkRotation(Date.now());

      const deviceId = res.deviceId;
      // Store our deviceId locally so we can send it in WS handshakes
      localStorage.setItem('meetifyy_deviceId', deviceId);
    } else {
      // Check OPK status on startup
      this.checkAndReplenishOPKs().catch(console.error);
      // Check SPK rotation
      this.checkAndRotateSPK().catch(console.error);
    }
  }

  async checkAndReplenishOPKs() {
    try {
      const deviceId = localStorage.getItem('meetifyy_deviceId');
      if (!deviceId) return; // E2EE not initialized yet
      const statusRes = await keysApi.getStatus(deviceId);
      if (statusRes.opkCount < 20) {
        const oneTimePreKeys = [];
        // Generate new batch of 50
        // Find max existing keyId to avoid collisions
        // For simplicity, we just generate random IDs or rely on a timestamp/counter
        // Let's use a random start index for the batch to avoid overlaps
        const arr = new Uint32Array(1);
        crypto.getRandomValues(arr);
        const startId = (arr[0] % 1_000_000) + 100_000;
        for (let i = startId; i < startId + 50; i++) {
          const preKey = await KeyHelper.generatePreKey(i);
          await this.store.storePreKey(preKey.keyId, preKey.keyPair);
          oneTimePreKeys.push({
            keyId: preKey.keyId,
            key: Buffer.from(preKey.keyPair.pubKey).toString('base64')
          });
        }
        
        await keysApi.replenish({
          deviceId: localStorage.getItem('meetifyy_deviceId'),
          oneTimePreKeys
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  async checkAndRotateSPK() {
    try {
      const deviceId = localStorage.getItem('meetifyy_deviceId');
      if (!deviceId) return; // E2EE not initialized yet
      const lastRotation = await this.store.getLastSpkRotation();
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      
      if (!lastRotation || Date.now() - lastRotation > SEVEN_DAYS) {
        
        const identityKeyPair = await this.store.getIdentityKeyPair();
        const newKeyId = (Math.floor(Date.now() / 1000) % 10000) + 10; // Simple increment-ish
        const newSignedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, newKeyId);

        const payload = {
          deviceId: localStorage.getItem('meetifyy_deviceId'),
          signedPreKeyId: newSignedPreKey.keyId,
          signedPreKey: Buffer.from(newSignedPreKey.keyPair.pubKey).toString('base64'),
          signedPreKeySig: Buffer.from(newSignedPreKey.signature).toString('base64')
        };

        // 1. Upload first
        await keysApi.rotateSpk(payload);
        
        // 2. Commit locally only on success
        await this.store.storeSignedPreKey(newSignedPreKey.keyId, newSignedPreKey.keyPair);
        await this.store.putLastSpkRotation(Date.now());
      }
    } catch (e) {
      console.error(e);
    }
  }

  /**
   * Establishes a session with a remote user's device if one doesn't exist.
   * Fetches PreKey bundle from backend.
   */
  async ensureSession(remoteUserId, remoteDeviceId) {
    const address = new SignalProtocolAddress(remoteUserId, parseInt(remoteDeviceId.replace(/[^0-9]/g, '').slice(0, 5) || '1', 10)); 
    // Signal Protocol Address requires an integer device ID. Since ours are UUIDs, we have to map them or use a pseudo device id.
    // For this prototype, we'll use a hash or just standard 1 if we map it correctly.
    // Better yet: we just use the remoteUserId and deviceId combination as the 'name' in Address.
    const uniqueName = `${remoteUserId}::${remoteDeviceId}`;
    const remoteAddress = new SignalProtocolAddress(uniqueName, 1);

    const session = await this.store.getSession(uniqueName);
    if (!session) {
      const res = await keysApi.getBundle(remoteUserId);
      const bundleData = res.bundles.find(b => b.deviceId === remoteDeviceId);
      if (!bundleData) throw new Error("Could not find prekey bundle for target device");

      // Verify Identity Key if we have a verified contact
      const incomingIdentityBase64 = bundleData.identityKey;
      const verifiedKeyBase64 = await this.store.getVerifiedKey(remoteUserId);
      
      if (verifiedKeyBase64 && verifiedKeyBase64 !== incomingIdentityBase64) {
        await this.store.deleteVerifiedKey(remoteUserId);
        // Alert the user (in a real app we'd dispatch an event or throw a specific error, here we use console.warn and an alert for demonstration)
        const msg = `SECURITY WARNING: The security key for user ${remoteUserId} has changed! Please re-verify.`;
        console.warn(msg);
        alert(msg); // Surface warning
        throw new Error("Identity Key mismatch. Possible MITM attack or new device registration.");
      }

      // Reconstruct buffer representations
      const preKeyBundle = {
        identityKey: Buffer.from(bundleData.identityKey, 'base64'),
        registrationId: bundleData.registrationId,
        signedPreKey: {
          keyId: bundleData.signedPreKey.keyId,
          publicKey: Buffer.from(bundleData.signedPreKey.publicKey, 'base64'),
          signature: Buffer.from(bundleData.signedPreKey.signature, 'base64')
        },
        preKey: bundleData.preKey ? {
          keyId: bundleData.preKey.keyId,
          publicKey: Buffer.from(bundleData.preKey.publicKey, 'base64')
        } : undefined
      };

      const sessionBuilder = new SessionBuilder(this.store, remoteAddress);
      await sessionBuilder.processPreKey(preKeyBundle);

      // Async check our OPKs since establishing a session might mean we are active
      this.checkAndReplenishOPKs().catch(console.error);
    }
    return remoteAddress;
  }

  async encryptMessage(remoteUserId, remoteDeviceId, plaintext) {
    const remoteAddress = await this.ensureSession(remoteUserId, remoteDeviceId);
    const cipher = new SessionCipher(this.store, remoteAddress);
    const ciphertext = await cipher.encrypt(Buffer.from(plaintext, 'utf8').buffer);
    return ciphertext;
  }

  async decryptMessage(remoteUserId, remoteDeviceId, type, ciphertext) {
    const uniqueName = `${remoteUserId}::${remoteDeviceId}`;
    const remoteAddress = new SignalProtocolAddress(uniqueName, 1);
    const cipher = new SessionCipher(this.store, remoteAddress);
    
    let plaintextBuffer;
    if (type === 3) {
      plaintextBuffer = await cipher.decryptPreKeyWhisperMessage(ciphertext, 'base64');
    } else {
      plaintextBuffer = await cipher.decryptWhisperMessage(ciphertext, 'base64');
    }
    return Buffer.from(plaintextBuffer).toString('utf8');
  }

  // ---- Sent Message History (Option A) ----
  async saveSentMessage(conversationId, messageObj) {
    await this.store.saveSentMessage(conversationId, messageObj);
  }

  async getSentMessages(conversationId) {
    return await this.store.getSentMessages(conversationId);
  }

  // ---- Identity Verification ----
  async getLocalIdentityPublicKeyBase64() {
    const keyPair = await this.store.getIdentityKeyPair();
    return Buffer.from(keyPair.pubKey).toString('base64');
  }

  async verifyContact(userId, incomingIdentityBase64) {
    await this.store.putVerifiedKey(userId, incomingIdentityBase64);
  }

  async computeSafetyNumber(remoteIdentityKeyBase64) {
    let localIdentityKeyBase64 = '';
    try {
      localIdentityKeyBase64 = await this.getLocalIdentityPublicKeyBase64();
    } catch {
      localIdentityKeyBase64 = 'local_fallback_identity_key';
    }
    const keys = [localIdentityKeyBase64, remoteIdentityKeyBase64 || 'remote_fallback_key'].sort();
    const combined = keys.join('');

    // Web Crypto API is only available in Secure Contexts (HTTPS / localhost)
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle && typeof window.crypto.subtle.digest === 'function') {
      try {
        const encoder = new TextEncoder();
        let data = encoder.encode(combined);
        for (let i = 0; i < 5200; i++) {
          data = await crypto.subtle.digest('SHA-512', data);
        }
        const hashArray = Array.from(new Uint8Array(data));
        const hashHex = hashArray.map(b => b.toString(10).padStart(3, '0')).join('');
        return hashHex.substring(0, 60).match(/.{1,5}/g).join(' ');
      } catch (err) {
        console.warn('Crypto.subtle digest failed, using JS hash fallback:', err);
      }
    }

    // Pure JS Hash Fallback for HTTP / Non-Secure Local Network Origins (e.g. http://192.168.x.x)
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < combined.length; i++) {
      const ch = combined.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    let digits = '';
    for (let i = 0; i < 12; i++) {
      const val = Math.abs((h1 * (i + 1) + h2 * (12 - i) + i * 99991) % 100000);
      digits += String(val).padStart(5, '0');
    }

    return digits.substring(0, 60).match(/.{1,5}/g).join(' ');
  }

  // ---- Authenticated Session Resets ----
  
  async signResetPayload(payloadStr, remoteUserId, remoteDeviceId) {
    if (!remoteUserId || !remoteDeviceId) {
      throw new Error("Missing remote identifier to generate shared HMAC secret");
    }
    const uniqueName = `${remoteUserId}::${remoteDeviceId}`;
    const sessionRecord = await this.store.getSession(uniqueName);
    if (!sessionRecord) throw new Error("No active session with remote device");
    
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle && typeof window.crypto.subtle.importKey === 'function') {
      try {
        const sessionKeyBytes = new TextEncoder().encode(JSON.stringify(sessionRecord)).slice(0, 32);
        const cryptoKey = await crypto.subtle.importKey(
          'raw',
          sessionKeyBytes,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        );
        const encoder = new TextEncoder();
        const data = encoder.encode(payloadStr);
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, data);
        return Buffer.from(signature).toString('base64');
      } catch (e) {
        console.warn("Crypto.subtle HMAC sign failed, using fallback:", e);
      }
    }

    const sessionStr = JSON.stringify(sessionRecord) + payloadStr;
    let h1 = 0xdeadbeef;
    for (let i = 0; i < sessionStr.length; i++) {
      h1 = Math.imul(h1 ^ sessionStr.charCodeAt(i), 2654435761);
    }
    return Buffer.from(String(h1)).toString('base64');
  }

  async verifyResetPayload(payloadStr, signatureBase64, remoteUserId, remoteDeviceId) {
    try {
      const computed = await this.signResetPayload(payloadStr, remoteUserId, remoteDeviceId);
      return computed === signatureBase64;
    } catch {
      return false;
    }
  }

  async resetSession(remoteUserId, remoteDeviceId) {
    const uniqueName = `${remoteUserId}::${remoteDeviceId}`;
    await this.store.removeSession(uniqueName);
  }
}
