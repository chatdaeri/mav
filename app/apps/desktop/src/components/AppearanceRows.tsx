import type { ReactNode } from "react";
import type { AppearanceKey, ResolvedAppearance } from "../lib/appearanceSettings";
import type { PropertiesMode } from "../lib/editor/frontmatter";
import {
  EDITOR_MEASURE_SLIDER_MAX,
  EDITOR_MEASURE_SLIDER_MIN,
  EDITOR_MEASURE_STEP,
  measureLabel,
  measureToSlider,
  sliderToMeasure,
} from "../lib/editorMeasure";
import {
  EDITOR_FONT_SIZE_MAX,
  EDITOR_FONT_SIZE_MIN,
  EDITOR_FONT_SIZE_STEP,
  PROPERTIES_MODES,
} from "../lib/prefs";
import type { ThemeMode } from "../lib/theme";
import { ContentWidthPreview } from "./ContentWidthPreview";
import { MenuSelect } from "./MenuSelect";
import { Switch } from "./Switch";
import { ThemeToggle } from "./ThemeToggle";

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "시스템" },
  { value: "light", label: "밝게" },
  { value: "dark", label: "어둡게" },
];

/**
 * The six appearance rows, shared by Account Settings → Appearance (personal)
 * and Vault Settings → Appearance (defaults for everyone). Both pages render
 * the same controls with a concrete value on every row.
 *
 * personal: the EFFECTIVE values, plus `trailing(key)` (the "Vault default"
 *   tag or the "Reset to vault default" link).
 * vault: the vault's values (saved value, else the app default). The theme is
 *   a select here because it edits the vault, not this device's ThemeToggle.
 *   `readOnly` disables every control.
 */
export function AppearanceRows(props: {
  mode: "personal" | "vault";
  /** What each control shows. */
  values: ResolvedAppearance;
  onChange: <K extends AppearanceKey>(key: K, value: ResolvedAppearance[K]) => void;
  readOnly?: boolean;
  trailing?: (key: AppearanceKey) => ReactNode;
}) {
  const { mode, values, onChange, readOnly = false, trailing } = props;
  const vault = mode === "vault";
  const tail = (k: AppearanceKey) => trailing?.(k) ?? null;

  return (
    <>
      <div className="menu-row">
        <span className="menu-row-label">테마</span>
        {tail("theme")}
        {vault ? (
          <MenuSelect<ThemeMode>
            value={values.theme}
            options={THEME_OPTIONS}
            onSelect={(v) => onChange("theme", v)}
            disabled={readOnly}
            ariaLabel="테마"
            triggerClassName="role-field-trigger"
          />
        ) : (
          <ThemeToggle />
        )}
      </div>
      <label className="menu-row toggle-row">
        <span className="menu-row-label">
          파일 자동 색상
          <span className="field-hint">
            색이 없는 모든 파일과 폴더에 개인별로 고정된 색을 입혀요.
          </span>
        </span>
        {tail("autoColors")}
        <Switch
          checked={values.autoColors}
          disabled={readOnly}
          ariaLabel="파일 자동 색상"
          onChange={(next) => onChange("autoColors", next)}
        />
      </label>
      {/* The slider applies on every change rather than on release: the
          preview under it — and the note behind the card — are the answer to
          "how wide is that?", and they have to move with the thumb. */}
      <div className="menu-row measure-row">
        {/* A real <label>, not the row: wrapping a range in one would hijack
            the drag. The row's text is still a click target for the slider. */}
        <label className="menu-row-label" htmlFor={`content-width-${mode}`}>
          본문 너비
          <span className="field-hint">
            줄바꿈되기 전까지 텍스트가 차지하는 너비예요. 끝까지 끌면 창 전체를 써요.
          </span>
        </label>
        {tail("contentWidth")}
        <span className="range-field">
          <input
            id={`content-width-${mode}`}
            className="range-input"
            type="range"
            min={EDITOR_MEASURE_SLIDER_MIN}
            max={EDITOR_MEASURE_SLIDER_MAX}
            step={EDITOR_MEASURE_STEP}
            value={measureToSlider(values.contentWidth)}
            disabled={readOnly}
            // The <label> also carries the hint line; name the control with the
            // row's title alone rather than reading the whole paragraph out.
            aria-label="본문 너비"
            aria-valuetext={measureLabel(values.contentWidth)}
            onChange={(e) => onChange("contentWidth", sliderToMeasure(Number(e.target.value)))}
          />
          <span className="range-value">{measureLabel(values.contentWidth)}</span>
        </span>
        <ContentWidthPreview measure={values.contentWidth} />
      </div>
      <div className="menu-row measure-row">
        <label className="menu-row-label" htmlFor={`editor-text-size-${mode}`}>
          글자 크기
          <span className="field-hint">편집기에서 노트 글자의 크기예요.</span>
        </label>
        {tail("textSize")}
        <span className="range-field">
          <input
            id={`editor-text-size-${mode}`}
            className="range-input"
            type="range"
            min={EDITOR_FONT_SIZE_MIN}
            max={EDITOR_FONT_SIZE_MAX}
            step={EDITOR_FONT_SIZE_STEP}
            value={values.textSize}
            disabled={readOnly}
            aria-label="글자 크기"
            aria-valuetext={`${values.textSize}픽셀`}
            onChange={(e) => onChange("textSize", Number(e.target.value))}
          />
          <span className="range-value">{values.textSize}px</span>
        </span>
      </div>
      <label className="menu-row toggle-row">
        <span className="menu-row-label">
          줄 번호
          <span className="field-hint">편집기에 줄 번호 영역을 보여줘요.</span>
        </span>
        {tail("lineNumbers")}
        <Switch
          checked={values.lineNumbers}
          disabled={readOnly}
          ariaLabel="줄 번호"
          onChange={(next) => onChange("lineNumbers", next)}
        />
      </label>
      {/* How the editor draws, so device-local unless a vault sets a default. */}
      <div className="menu-row">
        <span className="menu-row-label">
          문서 속성
          <span className="field-hint">
            노트 맨 위에 YAML 프런트매터를 보여주는 방식이에요.
          </span>
        </span>
        {tail("properties")}
        <MenuSelect<PropertiesMode>
          value={values.properties}
          options={PROPERTIES_MODES.map((m) => ({ value: m.id, label: m.label, hint: m.hint }))}
          onSelect={(m) => onChange("properties", m)}
          disabled={readOnly}
          ariaLabel="문서 속성"
          triggerClassName="role-field-trigger"
        />
      </div>
    </>
  );
}
