import { z } from "zod";
const KDF_ITERATIONS = 600_000;
const envelopeSchema = z.object({
  format: z.literal("orvia-encrypted-vault"),
  version: z.literal(1),
  salt: z.string().max(64),
  iv: z.string().max(64),
  iterations: z.literal(KDF_ITERATIONS),
  ciphertext: z.string().max(128 * 1024 * 1024),
});
export function toBase64(bytes: Uint8Array) {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192)
    parts.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(parts.join(""));
}
export function fromBase64(value: string) {
  if (value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new Error("VAULT_FORMAT");
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}
export async function deriveVaultKey(password: string, salt: Uint8Array) {
  if (!password || password.length > 1024) throw new Error("VAULT_PASSWORD");
  const raw = new TextEncoder().encode(password);
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      raw,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: new Uint8Array(salt).buffer,
        iterations: KDF_ITERATIONS,
        hash: "SHA-256",
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    raw.fill(0);
  }
}
const aad = (salt: string) =>
  new TextEncoder().encode(
    `orvia-encrypted-vault:1:PBKDF2-SHA256:${KDF_ITERATIONS}:${salt}:AES-256-GCM`,
  );
export async function sealVault(
  value: unknown,
  key: CryptoKey,
  salt: Uint8Array,
) {
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  if (plaintext.length > 80 * 1024 * 1024) {
    plaintext.fill(0);
    throw new Error("VAULT_SIZE");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12)),
    s = toBase64(salt);
  try {
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(s), tagLength: 128 },
      key,
      plaintext,
    );
    return new TextEncoder().encode(
      JSON.stringify({
        format: "orvia-encrypted-vault",
        version: 1,
        iterations: KDF_ITERATIONS,
        salt: s,
        iv: toBase64(iv),
        ciphertext: toBase64(new Uint8Array(encrypted)),
      }),
    );
  } finally {
    plaintext.fill(0);
  }
}
export function parseVaultEnvelope(bytes: Uint8Array) {
  if (bytes.length > 128 * 1024 * 1024) throw new Error("VAULT_SIZE");
  const e = envelopeSchema.parse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  );
  const salt = fromBase64(e.salt),
    iv = fromBase64(e.iv);
  if (salt.length !== 16 || iv.length !== 12) throw new Error("VAULT_FORMAT");
  return { ...e, saltBytes: salt, ivBytes: iv };
}
export async function decryptVaultWithKey(bytes: Uint8Array, key: CryptoKey) {
  const e = parseVaultEnvelope(bytes);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: new Uint8Array(e.ivBytes).buffer,
        additionalData: aad(e.salt),
        tagLength: 128,
      },
      key,
      new Uint8Array(fromBase64(e.ciphertext)).buffer,
    );
  } catch {
    throw new Error("VAULT_PASSWORD_OR_DAMAGED");
  }
  const data = new Uint8Array(plain);
  try {
    if (data.length > 80 * 1024 * 1024) throw new Error("VAULT_SIZE");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } finally {
    data.fill(0);
  }
}
export async function openVault(bytes: Uint8Array, password: string) {
  const e = parseVaultEnvelope(bytes),
    key = await deriveVaultKey(password, e.saltBytes);
  return {
    value: await decryptVaultWithKey(bytes, key),
    key,
    salt: e.saltBytes,
  };
}
