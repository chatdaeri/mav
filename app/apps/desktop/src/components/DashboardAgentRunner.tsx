// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  appendAgentLog, cancelDashboardAgent, detectInstalledAgents, runDashboardAgent,
  type InstalledAgent,
} from "../lib/dashboard/agent";
import { DASHBOARD_AGENT_LAUNCH, type DashboardAgentLaunch } from "../lib/dashboard/agentLaunch";
import { toast } from "../lib/toast";
import "./DashboardAgentRunner.css";
import claudeLogo from "../assets/agents/claude-color.svg";
import codexLogo from "../assets/agents/codex.svg";

function useInstalledAgents() {
  const [agents, setAgents] = useState<InstalledAgent[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    void detectInstalledAgents().then((value) => { if (alive) setAgents(value); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, []);
  return { agents, error };
}

function AgentGlyph({ agent }: { agent: string | null }) {
  return <img className={`agent-brand agent-brand-${agent}`} src={agent === "claude" ? claudeLogo : codexLogo} alt="" aria-hidden="true" />;
}

/** Trusted app chrome only: never expose this component through the page bridge. */
export function DashboardAgentRunner({ path, expectedEpoch, launchTarget, showLaunchers = true, rightPanelOpen = false, onOpen }: { path: string | null; expectedEpoch: number; launchTarget?: HTMLElement | null; showLaunchers?: boolean; rightPanelOpen?: boolean; onOpen?: () => void }) {
  const { agents, error: detectionError } = useInstalledAgents();
  const [selectedAgent, setSelectedAgent] = useState<InstalledAgent["agent"] | null>(null);
  const [open, setOpen] = useState(false);
  const [sessionPath, setSessionPath] = useState<string | null>(null);
  const installed = agents?.find((a) => a.agent === selectedAgent);
  const agentName = selectedAgent === "claude" ? "Claude" : "Codex";
  const [prompt, setPrompt] = useState("");
  const [log, setLog] = useState("");
  const [history, setHistory] = useState<Array<{ request: string; response: string }>>([]);
  const [submitted, setSubmitted] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("");
  const [phase, setPhase] = useState<"idle" | "running" | "stopping" | "success" | "stopped" | "error">("idle");
  const lastText = useRef("");
  const stopping = useRef(false);
  const followOutput = useRef(true);
  const runId = useRef<string | null>(null);
  const alive = useRef(true);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const launchButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const output = useRef<HTMLDivElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (runId.current) void cancelDashboardAgent(runId.current).catch(() => {});
    };
  }, []);
  useEffect(() => {
    const previousRun = runId.current;
    runId.current = null;
    if (previousRun) void cancelDashboardAgent(previousRun).catch(() => {});
    setSelectedAgent(null); setOpen(false); setSessionPath(null); setRunning(false); setPrompt(""); setLog(""); setHistory([]); setSubmitted(""); setStatus(""); setPhase("idle");
  }, [expectedEpoch]);
  useEffect(() => { if (open) (running ? dialog.current : promptInput.current ?? dialog.current)?.focus(); }, [open]);
  useEffect(() => { if (rightPanelOpen) setOpen(false); }, [rightPanelOpen]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || dialog.current?.contains(target)) return;
      if (target instanceof Element && target.closest(".dashboard-agent-launch")) return;
      setOpen(false);
    };
    // Window blur covers other apps as well as focus moving into an iframe.
    const dismiss = () => setOpen(false);
    let disposed = false;
    let unlisten: (() => void) | undefined;
    // Native focus events also cover WebViews that retain DOM focus on app blur.
    void Promise.resolve().then(() => getCurrentWindow().onFocusChanged(({ payload }) => {
      if (!disposed && !payload) dismiss();
    })).then((stop) => {
      if (disposed) stop(); else unlisten = stop;
    }).catch(() => { /* Browser previews use DOM blur instead. */ });
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", dismiss);
      disposed = true;
      unlisten?.();
    };
  }, [open]);
  useEffect(() => { if (output.current && followOutput.current) output.current.scrollTop = output.current.scrollHeight; }, [log]);

  useEffect(() => {
    const launch = (event: Event) => {
      const request = (event as CustomEvent<DashboardAgentLaunch>).detail;
      if (!request || request.expectedEpoch !== expectedEpoch || !request.path
        || !["claude", "codex"].includes(request.agent)) return;
      onOpen?.();
      launchButton.current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
      if (runId.current) {
        if (request.agent !== selectedAgent || request.path !== sessionPath) {
          toast("이미 업데이트가 실행 중이에요. 끝나거나 중지한 뒤에 새로 시작하세요.", "neutral");
        }
        setOpen(true);
        return;
      }
      if (request.agent !== selectedAgent || request.path !== sessionPath) {
        setSelectedAgent(request.agent); setSessionPath(request.path);
        setPrompt(""); setLog(""); setHistory([]); setSubmitted(""); setStatus(""); setPhase("idle");
      }
      setOpen(true);
    };
    window.addEventListener(DASHBOARD_AGENT_LAUNCH, launch);
    return () => window.removeEventListener(DASHBOARD_AGENT_LAUNCH, launch);
  }, [expectedEpoch, selectedAgent, sessionPath, onOpen]);

  const close = () => {
    setOpen(false);
    const trigger = launchButton.current?.isConnected ? launchButton.current
      : launchTarget?.querySelector<HTMLButtonElement>(`button[data-agent="${selectedAgent}"]`);
    trigger?.focus();
  };
  const stop = async () => {
    const id = runId.current;
    if (!id) return;
    stopping.current = true;
    setPhase("stopping");
    setStatus(`${agentName} 중지하는 중…`);
    try { await cancelDashboardAgent(id); }
    catch {
      if (!alive.current || runId.current !== id) return;
      stopping.current = false; setPhase("running");
      setStatus("취소를 요청하지 못했어요. 제한 시간이 지나면 실행이 중지돼요.");
    }
  };
  const start = async () => {
    if (!selectedAgent || !sessionPath || !installed?.runnable || runId.current || !prompt.trim()) return;
    const previous = submitted ? [...history, { request: submitted, response: log }].slice(-6) : history;
    setHistory(previous); setSubmitted(prompt.trim()); setPrompt("");
    const context = previous.length ? `Previous conversation about this dashboard (context only):\n${previous.map((turn) => `User: ${turn.request}\nAssistant: ${turn.response}`).join("\n\n").slice(-16000)}\n\nCurrent request:\n${prompt}` : prompt;
    const id = crypto.randomUUID(); runId.current = id;
    lastText.current = ""; stopping.current = false; followOutput.current = true;
    setRunning(true); setPhase("running"); setLog(""); setStatus(`${agentName} 시작하는 중…`);
    try {
      await runDashboardAgent({ agent: selectedAgent, prompt: context, dashboardPath: sessionPath, expectedEpoch, runId: id }, (event) => {
        if (!alive.current || runId.current !== id) {
          if (event.type === "started") void cancelDashboardAgent(id).catch(() => {});
          return;
        }
        if (event.type === "text" && event.text.trim() && event.text.trim() !== lastText.current) {
          lastText.current = event.text.trim();
          setLog((previous) => appendAgentLog(previous, event.text.trim()));
        }
        if (event.type === "status" && !stopping.current) setStatus(event.text);
        if (event.type === "started" && !stopping.current) setStatus(`${agentName}가 대시보드를 업데이트하고 있어요…`);
        if (event.type === "finished") {
          setPhase(event.cancelled ? "stopped" : event.success ? "success" : "error");
          setStatus(event.cancelled ? "중지했어요. 이미 저장된 변경 사항은 볼트에 남아요." : event.success ? "완료했어요. 파일이 바뀌면 대시보드가 다시 불러와져요." : `${agentName}가 작업을 마치지 못했어요. 아래 출력과 로그인 상태, 계정 한도를 확인하세요.`);
        }
      });
    } catch (error) {
      if (alive.current && runId.current === id) { setPhase("error"); setStatus(String(error)); }
    } finally {
      if (alive.current && runId.current === id) { setRunning(false); runId.current = null; }
    }
  };

  const launchButtons = (["claude", "codex"] as const).filter((agent) => path || (agent === selectedAgent && sessionPath)).map((agent) => <button key={agent} type="button" data-agent={agent} className={`ghost-pill sm dashboard-agent-launch${agent === selectedAgent && phase !== "idle" ? ` agent-launch-${phase}` : ""}`} aria-label={`${agent === "claude" ? "Claude" : "Codex"}로 업데이트${agent === selectedAgent && phase !== "idle" ? `: ${phase === "running" ? "작업 중" : phase === "stopping" ? "중지 중" : phase === "success" ? "완료" : phase === "stopped" ? "중지됨" : "실패"}` : ""}`} title={agent === selectedAgent && sessionPath ? `${agent === "claude" ? "Claude" : "Codex"} · ${sessionPath}${phase !== "idle" ? ` · ${phase === "running" ? "작업 중" : phase === "stopping" ? "중지 중" : phase === "success" ? "완료" : phase === "stopped" ? "중지됨" : "실패"}` : ""}` : `${agent === "claude" ? "Claude" : "Codex"}로 업데이트`}
      disabled={running && agent !== selectedAgent}
      onClick={(event) => {
        onOpen?.();
        launchButton.current = event.currentTarget;
        if (agent !== selectedAgent || !sessionPath) {
          if (!path || running) return;
          setSelectedAgent(agent); setSessionPath(path); setPrompt(""); setLog(""); setHistory([]); setSubmitted(""); setStatus(""); setPhase("idle");
        }
        setOpen(true);
      }}>
      <AgentGlyph agent={agent} />{agent === "claude" ? "Claude" : "Codex"}<span className="dashboard-agent-launch-prefix">로 업데이트</span>
      {agent === selectedAgent && phase !== "idle" && <span className="dashboard-agent-launch-status"><i aria-hidden="true" />{phase === "running" ? "작업 중" : phase === "stopping" ? "중지 중" : phase === "success" ? "완료" : phase === "stopped" ? "중지됨" : "실패"}</span>}
    </button>);
  return <>
    {!open && selectedAgent && phase !== "idle" && <span className="dashboard-agent-announcement" role="status">{agentName}: {status}</span>}
    {showLaunchers && (launchTarget === undefined ? launchButtons : launchTarget ? createPortal(launchButtons, launchTarget) : null)}
    {open && !rightPanelOpen && createPortal(
      <div className={`dashboard-agent-backdrop provider-${selectedAgent}`} onPointerDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
        <div ref={dialog} role="dialog" tabIndex={-1} aria-modal="false" aria-labelledby="dashboard-agent-title" className="dashboard-agent-dialog"
          onKeyDownCapture={(event) => {
            if ((event.metaKey || event.ctrlKey) && ["n", "w", "f", "k", "p", "g", "h"].includes(event.key.toLowerCase())) {
              event.preventDefault(); event.stopPropagation();
            }
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }

          }}>
          <div className="dashboard-agent-heading">
            <span className="dashboard-agent-avatar"><AgentGlyph agent={selectedAgent} /></span>
            <div className="dashboard-agent-heading-copy">
              <h2 id="dashboard-agent-title">Update with {agentName}</h2>
              <span className="dashboard-agent-path" title={sessionPath ?? undefined}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M14 3H5v18h14V8zm0 0v5h5" /></svg>{sessionPath?.split("/").pop()}</span>
            </div>
            <button type="button" className="icon-btn" onClick={close} aria-label="에이전트 대화상자 닫기" title={running ? "대화 숨기기 (업데이트는 계속돼요)" : "닫기"}>×</button>
          </div>
          <section className={`dashboard-agent-progress phase-${phase}`} aria-label="업데이트 진행 상황">
            <div className="dashboard-agent-status" role="status">
              <span className="dashboard-agent-status-pill"><span className="dashboard-agent-status-icon" aria-hidden="true" />{phase === "running" ? "작업 중" : phase === "stopping" ? "중지 중" : phase === "success" ? "완료" : phase === "stopped" ? "중지됨" : phase === "error" ? "확인 필요" : installed?.runnable ? "준비됨" : agents === null && !detectionError ? "확인 중" : "설정 필요"}</span>
              <span key={status} className="dashboard-agent-status-text">{status || (installed?.runnable ? "변경 사항이 대시보드에 바로 나타나요." : "설치된 에이전트를 연결해 시작하세요.")}</span>
            </div>
            <div ref={output} className="dashboard-agent-output" aria-label="최근 에이전트 출력"
              onScroll={() => { const el = output.current; if (el) followOutput.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
              {history.map((turn, index) => <div className="dashboard-chat-turn" key={index}><div className="dashboard-chat-user">{turn.request}</div><div className="dashboard-agent-message">{turn.response.split(/\n\s*\n/).map((p, i) => <p key={i}>{p}</p>)}</div></div>)}
              {submitted && <div className="dashboard-chat-user">{submitted}</div>}
              {log ? <div className="dashboard-agent-message"><span className="dashboard-agent-message-author"><span className="dashboard-agent-mini-avatar"><AgentGlyph agent={selectedAgent} /></span>{agentName}</span><div>{log.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></div>
                : <div className="dashboard-agent-output-empty">
                  <span className="dashboard-agent-empty-glyph"><AgentGlyph agent={selectedAgent} /></span>
                  <strong>{phase === "idle" ? installed?.runnable ? "대시보드를 내 입맛대로 바꿔 보세요" : `${agentName} 설정` : running ? `${agentName}가 작업 중이에요` : phase === "success" ? "업데이트를 마쳤어요" : phase === "stopped" ? "업데이트가 중지됐어요" : "업데이트를 마치지 못했어요"}</strong>
                  <p>{phase === "idle" ? installed?.runnable ? "아래에 바꾸고 싶은 내용을 적어 주세요. 에이전트가 볼트의 맥락을 활용해 이 대시보드를 업데이트해요." : detectionError ? "설치된 에이전트를 확인하지 못했어요. 마이 세컨드 브레인을 다시 시작한 뒤 시도해 주세요." : agents === null ? "설치된 에이전트를 확인하는 중…" : installed?.detail ?? `터미널에서 ${agentName}를 설치하고 로그인한 뒤 마이 세컨드 브레인을 다시 시작하세요.` : running ? "작업하는 동안 응답이 여기에 나타나요." : "텍스트 응답이 없어요."}</p>
                  {running && <span className="dashboard-agent-thinking" aria-hidden="true"><i /><i /><i /></span>}
                </div>}
            </div>
          </section>
          {installed?.runnable && <div className={`dashboard-agent-composer${running ? " is-running" : ""}`}>
            <label htmlFor="dashboard-agent-prompt">{running ? "다음 메시지" : "무엇을 바꾸고 싶나요?"}</label>
            <textarea id="dashboard-agent-prompt" ref={promptInput} rows={3} maxLength={8000} value={prompt}
              placeholder="바꾸고 싶은 내용을 적어 주세요…"
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void start(); } }}
              onChange={(event) => setPrompt(event.target.value)} />
            <div className="dashboard-agent-actions">
              {!running && path && path !== sessionPath ? <button type="button" className="dashboard-agent-retarget" onClick={() => { setSessionPath(path); setPrompt(""); setLog(""); setHistory([]); setSubmitted(""); setStatus(""); setPhase("idle"); }}>현재 대시보드 사용</button> : <span>{running ? "대화를 닫아도 업데이트는 계속돼요." : `내 ${agentName} 계정`}</span>}
              {running ? <button type="button" className="dashboard-agent-stop" disabled={phase === "stopping"} onClick={() => void stop()}>{phase === "stopping" ? "중지 중…" : "중지"}</button> : <button type="button" className="primary" disabled={!prompt.trim()} onClick={() => void start()}>{agentName} 실행</button>}
            </div>
          </div>}
        </div>
      </div>, document.body,
    )}
  </>;
}

/** Account Settings → About. Detection is cached until 마브 restarts. */
export function InstalledAgentsStatus() {
  const { agents, error } = useInstalledAgents();
  return <div className="installed-agents-status">
    <h3>설치된 에이전트</h3>
    {error ? <p>미리보기에서는 감지할 수 없어요.</p> : agents === null ? <p>설치된 클라이언트를 확인하는 중…</p> : !agents.length ? <p>지원하는 CLI를 찾지 못했어요. 터미널에서 Claude나 Codex를 설치하고 로그인한 뒤 마이 세컨드 브레인을 다시 시작하세요.</p> : agents.map((agent) =>
      <div key={agent.agent} className="installed-agent-row">
        <strong>{agent.agent === "codex" ? "Codex" : "Claude"}</strong>
        <span>{agent.version} · {agent.signedIn ? "로그인됨" : "로그인 확인 안 됨"}</span>
        <p>{agent.detail}</p>
      </div>,
    )}
    <p className="dashboard-agent-description">마이 세컨드 브레인을 다시 시작하면 감지 결과가 새로 고쳐져요. 대시보드 업데이트는 선택한 CLI와 로그인된 계정을 사용해요.</p>
  </div>;
}

/** Account Settings → About, the Installed agents row's list (profile-row style). */
export function InstalledAgentsList() {
  const { agents, error } = useInstalledAgents();
  if (error) return <p className="muted">미리보기에서는 감지할 수 없어요.</p>;
  if (agents === null) return <p className="muted">설치된 클라이언트를 확인하는 중…</p>;
  if (!agents.length) {
    return <p className="muted">지원하는 CLI를 찾지 못했어요. 터미널에서 Claude나 Codex를 설치하고 로그인한 뒤 마이 세컨드 브레인을 다시 시작하세요.</p>;
  }
  return <ul className="about-agents">
    {agents.map((agent) => <li key={agent.agent} className="about-agent">
      <span className="about-agent-glyph" aria-hidden="true"><AgentGlyph agent={agent.agent} /></span>
      <span className="about-agent-text">
        <b>{agent.agent === "codex" ? "Codex" : "Claude"} <span className="about-agent-version">{agent.version}</span></b>
        <small title={agent.detail}>{agent.detail}</small>
      </span>
      <span className={`about-agent-tag${agent.signedIn ? "" : " is-off"}`}>{agent.signedIn ? "로그인됨" : "로그인 안 됨"}</span>
    </li>)}
  </ul>;
}
