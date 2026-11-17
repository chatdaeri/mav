import { describe, expect, it } from "vitest";
import {
  editorEmptyPrompt,
  emptyVaultState,
  nothingSharedBody,
  type EmptyVaultInput,
} from "./emptyVaultState";

const base: EmptyVaultInput = {
  signedIn: true,
  synced: true,
  live: true,
  readableItems: 0,
  hiddenContent: true,
  isOwner: false,
};

describe("emptyVaultState", () => {
  it("is nothing-shared for a live member with zero readable items and hidden content", () => {
    expect(emptyVaultState(base)).toBe("nothing-shared");
  });
  it("is none when signed out", () => {
    expect(emptyVaultState({ ...base, signedIn: false })).toBe("none");
  });
  it("is none for a local (unsynced) vault", () => {
    expect(emptyVaultState({ ...base, synced: false })).toBe("none");
  });
  it("is none until the channel is live", () => {
    expect(emptyVaultState({ ...base, live: false })).toBe("none");
  });
  it("is none before any listing arrived", () => {
    expect(emptyVaultState({ ...base, readableItems: null })).toBe("none");
  });
  it("is none once anything is readable", () => {
    expect(emptyVaultState({ ...base, readableItems: 1 })).toBe("none");
  });
  it("is none when the server lacks the field", () => {
    expect(emptyVaultState({ ...base, hiddenContent: null })).toBe("none");
  });
  it("is empty-vault when nothing is hidden", () => {
    expect(emptyVaultState({ ...base, hiddenContent: false })).toBe("empty-vault");
  });
  it("is none for the owner even with hidden content", () => {
    expect(emptyVaultState({ ...base, isOwner: true })).toBe("none");
  });
});

describe("empty-state copy", () => {
  it("names the owner and vault, falling back when unknown", () => {
    expect(nothingSharedBody("Sara", "Acme")).toBe(
      "Sara님이 Acme의 폴더나 노트에 대한 접근 권한을 아직 주지 않았어요. 공유해 달라고 요청해 보세요.",
    );
    expect(nothingSharedBody(null, "Acme")).toMatch(/^소유자님이 Acme의 폴더나 노트/);
  });
  it("drops ⌘N only when the root create is refused", () => {
    expect(editorEmptyPrompt(false)).toBe("노트를 선택하세요.");
    expect(editorEmptyPrompt(true)).toBe("노트를 선택하거나 ⌘N을 눌러 새로 만드세요.");
    expect(editorEmptyPrompt(null)).toBe("노트를 선택하거나 ⌘N을 눌러 새로 만드세요.");
  });
});
