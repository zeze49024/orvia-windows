// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { test, expect } from "vitest";
import { deriveVaultKey, sealVault, openVault } from "./vault-crypto";
import { WorkspaceStore } from "./storage";
import { vaultSession } from "./vault";
import { newDocument } from "./model";
import { savePosition, readPosition } from "./writing-position";
test("authenticated encryption hides content, uses fresh IVs, rejects wrong passwords and tampering", async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    password = "a strong test passphrase 中文",
    key = await deriveVaultKey(password, salt);
  expect(key.extractable).toBe(false);
  const data = { body: "private content 中文", history: ["old content"] };
  const a = await sealVault(data, key, salt),
    b = await sealVault(data, key, salt);
  expect(a).not.toEqual(b);
  expect(new TextDecoder().decode(a)).not.toContain(data.body);
  expect((await openVault(a, password)).value).toEqual(data);
  await expect(openVault(a, "wrong password")).rejects.toThrow(
    "VAULT_PASSWORD_OR_DAMAGED",
  );
  const changed = JSON.parse(new TextDecoder().decode(a));
  changed.ciphertext =
    (changed.ciphertext[0] === "A" ? "B" : "A") + changed.ciphertext.slice(1);
  await expect(
    openVault(new TextEncoder().encode(JSON.stringify(changed)), password),
  ).rejects.toThrow("VAULT_PASSWORD_OR_DAMAGED");
});
test("private workspace stays separate from public SQLite preview and locks secrets and writing positions", async () => {
  const s = new WorkspaceStore();
  await s.load();
  const normal = newDocument(
    s.data.libraries[0].id,
    "Public note",
    "public text",
  );
  s.change((w) => ({ ...w, documents: [normal] }));
  await s.flush();
  await s.createVault("long private password 中文");
  expect(s.vaultMode).toBe("private");
  expect(s.data.documents).toHaveLength(0);
  const secret = newDocument(
    s.data.libraries[0].id,
    "SECRET TITLE",
    "SECRET BODY 中文",
  );
  s.change((w) => ({ ...w, documents: [secret] }));
  await s.flush();
  savePosition(secret.id, {
    mode: "rich",
    rich: { from: 3, to: 3 },
    source: { from: 0, to: 0, scroll: 0 },
    scroll: 200,
  });
  await s.flush();
  expect(localStorage.getItem("orvia-writing-positions-v1")).toBeNull();
  const backup = await vaultSession.backup();
  expect(new TextDecoder().decode(backup)).not.toContain("SECRET TITLE");
  await s.lockVault();
  expect(vaultSession.key).toBeNull();
  expect(s.data.documents).toHaveLength(0);
  await expect(s.unlockVault("incorrect password")).rejects.toThrow();
  expect(vaultSession.key).toBeNull();
  await s.unlockVault("long private password 中文");
  expect(s.data.documents[0].body).toBe("SECRET BODY 中文");
  expect(readPosition(secret.id)?.scroll).toBe(200);
  const opened=await openVault(backup,"long private password 中文");
  const payload=await vaultSession.validate(opened.value);
  await s.mergeVaultBackup(payload);
  expect(s.data.documents.filter(d=>d.title==="SECRET TITLE")).toHaveLength(2);
  expect(new Set(s.data.documents.map(d=>d.id)).size).toBe(2);
  await s.changeVaultPassword("a changed private passphrase");
  await s.lockVault();
  await expect(s.unlockVault("long private password 中文")).rejects.toThrow();
  await s.unlockVault("a changed private passphrase");
  expect(s.data.documents[0].title).toBe("SECRET TITLE");
  await s.openPublic();
  expect(s.vaultMode).toBe("public");
  expect(s.data.documents.find((d) => d.id === normal.id)?.body).toBe(
    "public text",
  );
  expect(s.data.documents.some((d) => d.id === secret.id)).toBe(false);
}, 20000);
