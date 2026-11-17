// SPDX-License-Identifier: Apache-2.0

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AttachmentLocalOnlyNoticeView,
  attachmentNoticeVisible,
} from "../AttachmentSyncNotice";

describe("AttachmentLocalOnlyNoticeView", () => {
  it("requires both a server refusal and a detected local attachment", () => {
    expect(attachmentNoticeVisible(true, true)).toBe(true);
    expect(attachmentNoticeVisible(true, false)).toBe(false);
    expect(attachmentNoticeVisible(false, true)).toBe(false);
  });
  it("explains that other-format notes remain previewable while text notes keep syncing", () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentLocalOnlyNoticeView, {
        show: true,
        showUpgrade: true,
        onUpgrade: vi.fn(),
      }),
    );

    expect(html).toContain("독립 파일 동기화는 Team 플랜에서 쓸 수 있어요");
    expect(html).toContain("노트와 노트에 포함된 첨부 파일은 계속 동기화돼요");
    expect(html).toContain("포함된 첨부 파일");
    expect(html).toContain("이 기기에서 미리 볼 수 있어요");
    expect(html).toContain("Team으로 업그레이드");
    expect(html).not.toContain("Health");
  });

  it("does not offer managed billing when the server has billing disabled", () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentLocalOnlyNoticeView, {
        show: true,
        showUpgrade: false,
        onUpgrade: vi.fn(),
      }),
    );

    expect(html).toContain("독립 파일 동기화는 Team 플랜에서 쓸 수 있어요");
    expect(html).not.toContain("업그레이드");
  });

  it("renders nothing until the server explicitly refuses attachment sync", () => {
    const html = renderToStaticMarkup(
      createElement(AttachmentLocalOnlyNoticeView, {
        show: false,
        showUpgrade: true,
        onUpgrade: vi.fn(),
      }),
    );

    expect(html).toBe("");
  });
});
