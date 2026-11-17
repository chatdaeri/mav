import { describe, expect, it } from "vitest";
import { DOCUMENTS_DENIED_PREFIX, folderErrorText, isDocumentsDenied } from "../folderErrors";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("folderErrors", () => {
  const denied = `${DOCUMENTS_DENIED_PREFIX}macOS blocked 마이 세컨드 브레인 from using your Documents folder, so it couldn't create /Users/x/Documents/mav.`;

  it("recognises the documents_denied prefix on a string or an Error", () => {
    expect(isDocumentsDenied(denied)).toBe(true);
    expect(isDocumentsDenied(new Error(denied))).toBe(true);
    expect(isDocumentsDenied("Couldn't create the vaults folder /x: os error 2")).toBe(false);
    expect(isDocumentsDenied(null)).toBe(false);
  });

  it("strips the code prefix and leaves other messages alone", () => {
    expect(folderErrorText(denied)).toMatch(/^macOS blocked 마이 세컨드 브레인/);
    const refusal = "홈 폴더 자체는 볼트로 쓸 수 없어요. 그 안의 폴더를 고르거나, Documents/mav 폴더를 자동으로 만들게 해 주세요.";
    expect(folderErrorText(new Error(refusal))).toBe(refusal);
  });

  it("matches the prefix Rust emits", () => {
    const rust = readFileSync(resolve(__dirname, "../../../../src-tauri/src/folder_safety.rs"), "utf8");
    expect(rust).toContain(`pub const DOCUMENTS_DENIED: &str = "${DOCUMENTS_DENIED_PREFIX}";`);
  });
});
