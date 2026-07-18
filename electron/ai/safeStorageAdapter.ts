import { safeStorage } from 'electron'
import type { AICredentialCryptoAdapter } from './credentialService'

export function createSafeStorageCredentialAdapter(): AICredentialCryptoAdapter {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plaintext) => safeStorage.encryptString(plaintext),
    decrypt: (ciphertext) => safeStorage.decryptString(ciphertext),
  }
}
